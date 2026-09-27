"use strict";

const crypto = require("node:crypto");

const STATUSES = Object.freeze([
  "PLANNING", "READY", "EXECUTING", "VALIDATING", "OBSERVING",
  "COMPLETED", "FAILED", "BLOCKED", "CANCELLED",
]);
const DECISIONS = Object.freeze([
  "SUCCESS", "FAIL_STOP", "BLOCKED_APPROVAL", "PROPOSE_FIX",
  "APPLY_SINGLE_FIX", "CANCELLED",
]);
const TERMINAL = new Set(["COMPLETED", "FAILED", "BLOCKED", "CANCELLED"]);

class DevWorkspaceExecutionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DevWorkspaceExecutionError";
    this.code = code;
  }
}

function clean(value, max = 500) {
  return String(value || "").replace(/[\0\r\n]+/g, " ").trim().slice(0, max);
}

function createDevWorkspaceAgentExecutionLoop({
  terminalService,
  operationalSecurityPolicy,
  approvalEngine = null,
  planner = null,
  previewStateProvider = async () => null,
  observability = null,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  pollIntervalMs = 25,
} = {}) {
  if (!terminalService?.getSession || !terminalService?.runCommand || !terminalService?.poll) {
    throw new TypeError("WorkspaceTerminalService requis.");
  }
  if (!operationalSecurityPolicy?.evaluate) {
    throw new TypeError("OperationalSecurityPolicy requise.");
  }

  const executions = new Map();
  const activeBySession = new Map();
  const controllers = new Map();
  const emit = (event, execution, metadata = {}) => {
    try {
      observability?.(event, {
        executionId: execution.executionId,
        workspaceSessionId: execution.workspaceSessionId,
        phase: execution.phase,
        ...metadata,
      });
    } catch {}
  };
  const iso = () => new Date(now()).toISOString();

  function publicExecution(execution) {
    const { promise: _promise, previewObservation: _previewObservation, ...value } = execution;
    return JSON.parse(JSON.stringify(value));
  }

  function transition(execution, status, phase = status) {
    if (!STATUSES.includes(status)) throw new DevWorkspaceExecutionError("EXECUTION_STATUS_INVALID", "État d’exécution invalide.");
    execution.status = status;
    execution.phase = phase;
    execution.currentStep = execution.steps.length;
    execution.updatedAt = iso();
  }

  function assertCurrent(execution, signal) {
    if (signal.aborted || execution.status === "CANCELLED") {
      throw new DevWorkspaceExecutionError("EXECUTION_CANCELLED", "Exécution annulée.");
    }
    const session = terminalService.getSession(execution.workspaceSessionId);
    if (session.id !== execution.workspaceSessionId || session.repositoryRoot !== execution.repositoryRoot) {
      throw new DevWorkspaceExecutionError("WORKSPACE_SESSION_STALE", "La session Workspace a changé.");
    }
    return session;
  }

  function normalizePlan(value, input) {
    const raw = value && typeof value === "object" ? value : {};
    const actionCommand = clean(raw.actionCommand || input.actionCommand, 1000);
    const validationCommand = clean(raw.validationCommand || input.validationCommand, 1000);
    return {
      task: clean(raw.task || input.task, 1000),
      intent: clean(raw.intent || "DEV_WORKSPACE_TASK", 120),
      filesExpected: Array.isArray(raw.filesExpected) ? raw.filesExpected.map((item) => clean(item, 300)).slice(0, 50) : [],
      commandsExpected: [actionCommand, validationCommand].filter(Boolean),
      validationExpected: validationCommand || null,
      actionCommand: actionCommand || null,
      validationCommand: validationCommand || null,
      correctionCommand: clean(raw.correctionCommand, 1000) || null,
      riskLevel: clean(raw.riskLevel || "low", 40),
      requiresApproval: raw.requiresApproval === true,
      estimatedSteps: Math.min(6, Math.max(1, Number(raw.estimatedSteps) || 4)),
    };
  }

  async function runTerminalCommand(execution, command, kind, signal) {
    assertCurrent(execution, signal);
    let terminalId = execution.terminalExecutionRefs[0]?.terminalSessionId || null;
    if (!terminalId) {
      const terminal = terminalService.createTerminal({
        sessionId: execution.workspaceSessionId,
        owner: "NOON",
        title: "Noon Agent",
      });
      terminalId = terminal.id;
    }
    const startedAt = iso();
    const started = terminalService.runCommand({
      sessionId: execution.workspaceSessionId,
      terminalId,
      command,
      origin: "NOON",
    });
    const ref = {
      terminalSessionId: terminalId,
      commandExecutionId: `command-${crypto.randomUUID()}`,
      kind,
      command,
      startedAt,
      endedAt: null,
      exitCode: null,
      durationMs: null,
      stdoutSummary: null,
      stderrSummary: null,
    };
    execution.terminalExecutionRefs.push(ref);
    emit(kind === "VALIDATION" ? "validation_started" : "action_started", execution);
    const startMs = now();
    while (true) {
      assertCurrent(execution, signal);
      const result = terminalService.poll({ sessionId: execution.workspaceSessionId, terminalId, from: 0 });
      if (!result.terminal.running) {
        ref.endedAt = iso();
        ref.exitCode = result.terminal.exitCode;
        ref.durationMs = now() - startMs;
        ref.stdoutSummary = result.output.some((item) => item.stream === "stdout") ? "AVAILABLE_REDACTED" : null;
        ref.stderrSummary = result.output.some((item) => item.stream === "stderr") ? "AVAILABLE_REDACTED" : null;
        emit(kind === "VALIDATION" ? "validation_finished" : "action_finished", execution, { exitCode: ref.exitCode });
        return ref;
      }
      await sleep(pollIntervalMs);
    }
  }

  async function observe(execution, signal) {
    const session = assertCurrent(execution, signal);
    let gitDiff = session.gitDiff;
    try { gitDiff = await terminalService.inspectGitDiff({ sessionId: execution.workspaceSessionId }); } catch {}
    const refreshed = terminalService.getSession(execution.workspaceSessionId);
    const preview = await previewStateProvider({
      executionId: execution.executionId,
      workspaceSessionId: execution.workspaceSessionId,
      workspaceId: execution.workspaceId,
    }) || execution.previewObservation || { status: "UNCONFIGURED", url: null };
    assertCurrent(execution, signal);
    const last = execution.terminalExecutionRefs.at(-1) || null;
    const problems = refreshed.problems || {};
    const snapshot = {
      executionId: execution.executionId,
      workspaceSessionId: execution.workspaceSessionId,
      terminal: last ? { exitCode: last.exitCode, command: last.command, durationMs: last.durationMs } : null,
      problems: {
        status: clean(problems.status, 40),
        errors: Number(problems.counts?.error) || 0,
        warnings: Number(problems.counts?.warning) || 0,
        infos: Number(problems.counts?.info) || 0,
        items: Array.isArray(problems.problems) ? problems.problems.slice(0, 20) : [],
      },
      git: {
        changed: Number(gitDiff?.counts?.total) || 0,
        staged: Number(gitDiff?.counts?.staged) || 0,
        unstaged: Number(gitDiff?.counts?.unstaged) || 0,
        untracked: Number(gitDiff?.counts?.untracked) || 0,
        conflicts: Number(gitDiff?.counts?.conflicted) || 0,
        truncated: gitDiff?.truncated === true,
        unsafeOmitted: Number(gitDiff?.unsafeOmitted) || 0,
      },
      preview: {
        url: typeof preview?.url === "string" && /^https?:\/\/(localhost|127\.0\.0\.1)(?::\d+)?(?:\/|$)/.test(preview.url) ? preview.url : null,
        status: clean(preview?.status || "UNCONFIGURED", 40),
        loadState: clean(preview?.loadState || "UNKNOWN", 40),
      },
    };
    execution.problemSummary = snapshot.problems;
    execution.gitSummary = snapshot.git;
    execution.previewState = snapshot.preview;
    execution.observation = snapshot;
    emit("observation_created", execution);
    return snapshot;
  }

  async function execute(execution, input, controller) {
    try {
      transition(execution, "PLANNING", "PLAN");
      emit("execution_started", execution);
      const proposed = planner?.plan ? await planner.plan({ task: execution.task, workspaceSessionId: execution.workspaceSessionId }) : input.plan;
      assertCurrent(execution, controller.signal);
      execution.plan = normalizePlan(proposed, input);
      execution.steps.push({ phase: "PLAN", status: "COMPLETED", at: iso() });
      emit("plan_ready", execution);
      if (execution.plan.requiresApproval) {
        const preparedApproval = approvalEngine?.prepareAction ? approvalEngine.prepareAction({
          executionId: execution.executionId,
          skillName: "dev_workspace_agent",
          operation: "run bounded workspace task",
          normalizedArgs: { workspaceSessionId: execution.workspaceSessionId, task: execution.task },
          target: execution.workspaceId,
          permissionLevel: "write",
        }) : { status: "required" };
        const { resumeToken: _resumeToken, ...publicApproval } = preparedApproval;
        execution.approvalState = publicApproval;
        execution.decision = "BLOCKED_APPROVAL";
        execution.stopReason = "APPROVAL_REQUIRED";
        transition(execution, "BLOCKED", "STOP");
        emit("execution_failed", execution, { reason: execution.stopReason });
        return;
      }
      transition(execution, "READY", "ACTION");
      let action = null;
      if (execution.plan.actionCommand) {
        transition(execution, "EXECUTING", "ACTION");
        action = await runTerminalCommand(
          execution,
          execution.plan.actionCommand,
          "ACTION",
          controller.signal
        );
        execution.steps.push({
          phase: "ACTION",
          status: action.exitCode === 0 ? "PASS" : "FAIL",
          at: iso(),
        });
      }
      let validation = null;
      if (execution.plan.validationCommand) {
        transition(execution, "VALIDATING", "VALIDATION");
        validation = await runTerminalCommand(execution, execution.plan.validationCommand, "VALIDATION", controller.signal);
        execution.validationState = validation.exitCode === 0 ? "PASS" : "FAIL";
        execution.steps.push({ phase: "VALIDATION", status: execution.validationState, at: iso() });
      }
      transition(execution, "OBSERVING", "OBSERVATION");
      await observe(execution, controller.signal);
      execution.steps.push({ phase: "OBSERVATION", status: "COMPLETED", at: iso() });
      const actionPassed =
        !action ||
        action.exitCode === 0;
      const validationPassed =
        !validation ||
        validation.exitCode === 0;

      execution.decision =
        actionPassed && validationPassed
          ? "SUCCESS"
          : "FAIL_STOP";
      execution.stopReason = execution.decision;
      transition(execution, execution.decision === "SUCCESS" ? "COMPLETED" : "FAILED", "STOP");
      execution.endedAt = iso();
      emit(execution.status === "COMPLETED" ? "execution_completed" : "execution_failed", execution, { decision: execution.decision });
    } catch (error) {
      if (error.code === "EXECUTION_CANCELLED") {
        execution.decision = "CANCELLED";
        execution.stopReason = "USER_CANCELLED";
        transition(execution, "CANCELLED", "STOP");
        emit("execution_cancelled", execution);
      } else {
        execution.error = { code: clean(error.code || "EXECUTION_FAILED", 100), message: clean(error.message, 500) };
        execution.decision = "FAIL_STOP";
        execution.stopReason = execution.error.code;
        transition(execution, "FAILED", "STOP");
        emit("execution_failed", execution, { reason: execution.stopReason });
      }
      execution.endedAt = iso();
    } finally {
      activeBySession.delete(execution.workspaceSessionId);
      controllers.delete(execution.executionId);
    }
  }

  function start(input = {}) {
    const workspaceSessionId = clean(input.workspaceSessionId, 180);
    const session = terminalService.getSession(workspaceSessionId);
    if (activeBySession.has(workspaceSessionId)) throw new DevWorkspaceExecutionError("EXECUTION_ALREADY_RUNNING", "Une exécution Noon est déjà active pour ce Workspace.");
    const task = clean(input.task, 1000);
    if (!task) throw new DevWorkspaceExecutionError("EXECUTION_TASK_REQUIRED", "Tâche DEV requise.");
    const executionId = `dev-execution-${crypto.randomUUID()}`;
    const execution = {
      executionId, workspaceSessionId, workspaceId: session.workspaceId,
      repositoryRoot: session.repositoryRoot, task, status: "PLANNING", phase: "PLAN",
      startedAt: iso(), updatedAt: iso(), endedAt: null, currentStep: 0, steps: [],
      plan: null, validationState: "PENDING", problemSummary: null, gitSummary: null,
      previewState: null, terminalExecutionRefs: [], approvalState: null,
      observation: null, decision: null, stopReason: null, maxAutomaticCorrectionCycles: 1,
      previewObservation: input.previewObservation && typeof input.previewObservation === "object"
        ? { url: input.previewObservation.url, status: input.previewObservation.status, loadState: input.previewObservation.loadState }
        : null,
    };
    const controller = new AbortController();
    executions.set(executionId, execution);
    activeBySession.set(workspaceSessionId, executionId);
    controllers.set(executionId, controller);
    execution.promise = execute(execution, input, controller);
    return publicExecution(execution);
  }

  async function run(input = {}) {
    const started = start(input);
    const execution = executions.get(started.executionId);
    await execution.promise;
    return publicExecution(execution);
  }

  function get(executionId) {
    const execution = executions.get(clean(executionId, 180));
    return execution ? publicExecution(execution) : null;
  }

  function cancel(executionId) {
    const execution = executions.get(clean(executionId, 180));
    if (!execution || TERMINAL.has(execution.status)) return { cancelled: false, reason: "NOT_RUNNING" };
    controllers.get(execution.executionId)?.abort();
    const active = execution.terminalExecutionRefs.at(-1);
    if (active?.terminalSessionId && !active.endedAt) {
      try { terminalService.closeTerminal({ sessionId: execution.workspaceSessionId, terminalId: active.terminalSessionId, reason: "USER_CANCELLED" }); } catch {}
    }
    return { cancelled: true, executionId: execution.executionId };
  }

  return { start, run, get, cancel, statuses: STATUSES, decisions: DECISIONS };
}

module.exports = {
  DECISIONS,
  STATUSES,
  DevWorkspaceExecutionError,
  createDevWorkspaceAgentExecutionLoop,
};
