"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const { spawn, execFileSync } = require("node:child_process");

const { redactSecrets } = require("../security/redaction");
const { OUTCOMES } = require("../security/operational-security-policy");
const {
  COMMAND_CLASSES,
  classifyDevCommand,
} = require("../delegation/dev-command-policy");
const {
  inferDevProblemSource,
  parseDevProblems,
} = require("./dev-problems-service");

const {
  createDevGitDiffService,
} = require("./dev-git-diff-service");

const {
  createDevProcessRunner,
  createSandboxExecutionContractV1,
} = require("../security/dev-process-runner");
const { DevWorkspaceError, clean } = require("./workspace-terminal-shared");
const {
  emptyProblems,
  emptyGitDiff,
  publicTerminal,
  publicSession,
  refreshExecutionState,
  terminalFor,
  assertTerminalOrigin,
} = require("./workspace-terminal-projections");
const {
  listRepositoryCompletions,
} = require("./workspace-terminal-completions");
const { createWorkspaceGitDiffOperations } = require("./workspace-terminal-git-diff");

const TERMINAL_STATUSES = Object.freeze([
  "IDLE",
  "RUNNING",
  "EXITED",
  "CLOSED",
]);

const TERMINAL_OWNERS = Object.freeze([
  "USER",
  "NOON",
]);

const MAX_COMMAND_LENGTH = 8_000;
const MAX_OUTPUT_CHUNK = 16_000;
const MAX_OUTPUT_EVENTS = 400;


function sanitizedTerminalEnvironment(source = process.env) {
  const allowed = [
    "PATH",
    "HOME",
    "LANG",
    "LC_ALL",
    "TERM",
  ];

  const environment = Object.fromEntries(
    allowed
      .filter((key) => source[key] != null)
      .map((key) => [key, source[key]])
  );

  environment.CI = "1";
  environment.NO_COLOR = "1";

  return environment;
}

function gitState(root) {
  try {
    return {
      branch:
        execFileSync(
          "git",
          ["-C", root, "branch", "--show-current"],
          {
            encoding: "utf8",
            timeout: 2_000,
            stdio: ["ignore", "pipe", "ignore"],
          }
        ).trim() || null,

      dirty: Boolean(
        execFileSync(
          "git",
          ["-C", root, "status", "--porcelain"],
          {
            encoding: "utf8",
            timeout: 2_000,
            stdio: ["ignore", "pipe", "ignore"],
          }
        ).trim()
      ),
    };
  } catch {
    return {
      branch: null,
      dirty: null,
    };
  }
}

function contractFor(classification) {
  return {
    SAFE_READ: "read",
    WORKSPACE_WRITE: "write",
    PACKAGE_INSTALL: "write",
    GIT_LOCAL: "write",
    REMOTE: "external",
    SYSTEM: "destructive",
    DESTRUCTIVE: "destructive",
  }[classification] || "external";
}

function actionFor(classification) {
  return `terminal_${String(classification || "").toLowerCase()}`;
}

function createDevWorkspaceTerminalService({
  workspaceEngine,
  operationalSecurityPolicy,
  gitDiffService =
    createDevGitDiffService(),
  observability = null,
  now = () => Date.now(),
  spawnProcess = spawn,
  environment = process.env,
  createSandboxRunner = createDevProcessRunner,
  createSandboxContract = createSandboxExecutionContractV1,
} = {}) {
  if (!workspaceEngine?.context) {
    throw new TypeError("WorkspaceEngine requis.");
  }

  if (!operationalSecurityPolicy?.evaluate) {
    throw new TypeError("OperationalSecurityPolicy requise.");
  }

  if (
    !gitDiffService?.inspect ||
    !gitDiffService?.readDiff
  ) {
    throw new TypeError(
      "DevGitDiffService requis."
    );
  }

  const sessions = new Map();

  const emit = (event, metadata = {}) => {
    try {
      observability?.(event, metadata);
    } catch {}
  };

  const iso = () => new Date(now()).toISOString();

  // Inspection et lecture du diff git (workspace-terminal-git-diff.js), avec les `emit`,
  // `gitDiffService` et `requireSession` de ce service.
  const { inspectGitDiff, readGitDiff } = createWorkspaceGitDiffOperations({ emit, gitDiffService, requireSession });

  function rootFor(workspaceId, requestedRoot = null) {
    const context = workspaceEngine.context(
      clean(workspaceId, 160)
    );

    const roots = (context.roots || [])
      .filter((root) => root?.path)
      .map((root) => {
        try {
          return {
            ...root,
            path: fs.realpathSync(root.path),
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    if (!roots.length) {
      throw new DevWorkspaceError(
        "WORKSPACE_ROOT_REQUIRED",
        "Cet espace DEV n’a aucun dépôt autorisé."
      );
    }

    let selected;

    if (requestedRoot) {
      let requestedReal;

      try {
        requestedReal = fs.realpathSync(
          String(requestedRoot)
        );
      } catch {
        throw new DevWorkspaceError(
          "WORKSPACE_ROOT_UNAVAILABLE",
          "Le dépôt demandé est indisponible."
        );
      }

      selected = roots.find(
        (root) => root.path === requestedReal
      );
    } else {
      selected = roots[0];
    }

    if (!selected) {
      throw new DevWorkspaceError(
        "WORKSPACE_ROOT_DENIED",
        "Le dépôt demandé n’est pas lié à cet espace autorisé."
      );
    }

    return {
      context,
      root: selected,
    };
  }

  function createSession(input = {}) {
    const { context, root } = rootFor(
      input.workspaceId,
      input.repositoryRoot
    );

    const id =
      `dev-workspace-${crypto.randomUUID()}`;

    const git = gitState(root.path);

    const session = {
      id,
      workspaceId: context.workspaceId,
      repositoryRoot: root.path,
      rootMode: root.mode,
      projectName:
        context.activeProject?.name ||
        context.displayName,
      branch: git.branch,
      dirty: git.dirty,
      terminals: new Map(),
      activeTerminalId: null,
      gitDiff:
        emptyGitDiff(),
      activeGitDiffRunId: null,
      problems:
        emptyProblems(),
      activeProblemsRunId: null,
      lastValidationState: null,
      executionState: "READY",
      createdAt: iso(),
    };

    sessions.set(id, session);

    emit("dev_workspace_created", {
      workspaceId: session.workspaceId,
    });

    return publicSession(session);
  }

  function requireSession(id) {
    const session = sessions.get(
      clean(id, 160)
    );

    if (!session) {
      throw new DevWorkspaceError(
        "DEV_WORKSPACE_NOT_FOUND",
        "Session DEV introuvable."
      );
    }

    return session;
  }

  function createTerminal(input = {}) {
    const session = requireSession(
      input.sessionId
    );

    const owner = String(
      input.owner || "USER"
    ).toUpperCase();

    if (!TERMINAL_OWNERS.includes(owner)) {
      throw new DevWorkspaceError(
        "TERMINAL_OWNER_INVALID",
        "Propriétaire de terminal invalide."
      );
    }

    const terminal = {
      id: `terminal-${crypto.randomUUID()}`,
      title: clean(
        input.title ||
          `Terminal ${session.terminals.size + 1}`,
        80
      ),
      owner,
      cwd: session.repositoryRoot,
      status: "IDLE",
      createdAt: iso(),
      lastActivityAt: iso(),
      exitCode: null,
      signal: null,
      cancelReason: null,
      child: null,
      runner: null,
      cleanupStatus: null,
      output: [],
      outputCursor: 0,
    };

    session.terminals.set(
      terminal.id,
      terminal
    );

    session.activeTerminalId =
      terminal.id;

    emit("dev_terminal_created", {
      workspaceId: session.workspaceId,
      terminalId: terminal.id,
      owner,
    });

    return publicTerminal(terminal);
  }

  function append(terminal, type, text) {
    const value = redactSecrets(
      String(text || "")
    ).slice(0, MAX_OUTPUT_CHUNK);

    if (!value) {
      return;
    }

    terminal.outputCursor += 1;

    terminal.output.push({
      sequence: terminal.outputCursor,
      type,
      text: value,
      at: iso(),
    });

    if (
      terminal.output.length >
      MAX_OUTPUT_EVENTS
    ) {
      terminal.output.splice(
        0,
        terminal.output.length -
          MAX_OUTPUT_EVENTS
      );
    }

    terminal.lastActivityAt = iso();
  }

  function policyFor(
    session,
    classification
  ) {
    const readOnly =
      session.rootMode !== "read-write";

    const mutating =
      classification !== "SAFE_READ";

    if (readOnly && mutating) {
      throw new DevWorkspaceError(
        "WORKSPACE_READ_ONLY",
        "Ce workspace est en lecture seule."
      );
    }

    const decision =
      operationalSecurityPolicy.evaluate({
        actionRequest: {
          origin: "trusted_ui",
          skillId: "terminal",
          operation:
            actionFor(classification),
          args: {
            path:
              session.repositoryRoot,
          },
          workspaceId:
            session.workspaceId,
          explicitOrder: true,
          localOnly: true,
        },

        skillPolicy: {
          level:
            contractFor(classification),
          networkAccess:
            classification === "REMOTE",
          destructive:
            classification ===
            "DESTRUCTIVE",
        },

        currentPermissions: {
          allowed:
            classification ===
              "SAFE_READ" ||
            session.rootMode ===
              "read-write",

          code:
            session.rootMode ===
            "read-write"
              ? "READ_WRITE_WORKSPACE"
              : "READ_ONLY_WORKSPACE",
        },
      });

    if (
      ![
        OUTCOMES.ALLOW,
        OUTCOMES.ALLOW_WITH_CONSTRAINTS,
      ].includes(decision.outcome)
    ) {
      throw new DevWorkspaceError(
        decision.requiredApproval
          ? "TERMINAL_APPROVAL_REQUIRED"
          : "TERMINAL_COMMAND_DENIED",

        decision.requiredApproval
          ? "Cette commande exige une approbation Noon."
          : "Cette commande est refusée par la politique Noon."
      );
    }

    return decision;
  }

  function claimAuthorizedValidation(input = {}) {
    const session = requireSession(input.sessionId);
    const command = String(input.command || "").trim();
    const state = session.lastValidationState;
    const decision = classifyDevCommand(command);

    const completedAt = Date.parse(
      state?.completedAt || ""
    );
    const ageMs = now() - completedAt;

    const validResult =
      (state?.status === "PASS" && state.exitCode === 0) ||
      (
        state?.status === "FAIL" &&
        Number.isInteger(state.exitCode) &&
        state.exitCode !== 0
      );

    const authorized = Boolean(
      command &&
      session.executionState === "READY" &&
      state &&
      state.command === command &&
      state.origin === "USER" &&
      state.nativeUiClaimedAt == null &&
      state.classification === "SAFE_READ" &&
      decision.allowed === true &&
      decision.classification === "SAFE_READ" &&
      state.reasonCode === decision.reasonCode &&
      [
        "AUTHORIZED_VALIDATION",
        "AUTHORIZED_TARGETED_VALIDATION",
      ].includes(state.reasonCode) &&
      state.signal == null &&
      validResult &&
      Number.isFinite(completedAt) &&
      ageMs >= 0 &&
      ageMs <= 30 * 60_000
    );

    if (!authorized) return false;

    // Claim serveur synchrone : une seule consommation.
    state.nativeUiClaimedAt = iso();

    return true;
  }

  function applyNativeValidationResult(input = {}) {
    const session = requireSession(input.sessionId);
    const workspaceId = clean(input.workspaceId, 160);
    const command = clean(input.command, MAX_COMMAND_LENGTH);
    const validation = input.validation && typeof input.validation === "object"
      ? input.validation
      : null;
    const nativeStartedAt = Date.parse(input.startedAt || "");
    const completedAt = Date.parse(input.completedAt || "");
    const currentAt = Date.parse(
      session.problems?.updatedAt ||
      session.lastValidationState?.completedAt ||
      ""
    );

    if (
      !workspaceId ||
      workspaceId !== session.workspaceId ||
      !command ||
      validation?.command !== command ||
      !["PASS", "FAIL"].includes(validation?.status) ||
      !Number.isFinite(nativeStartedAt) ||
      !Number.isFinite(completedAt)
    ) {
      return { applied: false, reason: "NATIVE_VALIDATION_CONTEXT_INVALID" };
    }

    if (
      session.problems?.status === "RUNNING" ||
      (
        session.problems?.origin !== "NATIVE" &&
        Number.isFinite(currentAt) &&
        currentAt > nativeStartedAt
      ) ||
      (Number.isFinite(currentAt) && completedAt <= currentAt)
    ) {
      return { applied: false, reason: "NATIVE_VALIDATION_STALE" };
    }

    if (
      session.problems?.command &&
      session.problems.command !== command
    ) {
      return { applied: false, reason: "NATIVE_VALIDATION_NOT_COVERED" };
    }

    const exitCode = Number.isInteger(validation.exitCode)
      ? validation.exitCode
      : null;
    const output = typeof validation.outputTail === "string"
      ? validation.outputTail
      : "";
    const truncated = validation.outputTruncated === true;

    if (!output && input.finalVerdict === "PASS") {
      return { applied: false, reason: "NATIVE_VALIDATION_PROOF_MISSING" };
    }

    let problems;

    if (!output || truncated || exitCode === null) {
      problems = {
        status: "UNRESOLVED",
        source: inferDevProblemSource(command),
        command,
        exitCode,
        counts: { total: 0, error: 0, warning: 0, info: 0 },
        truncated,
        problems: [],
      };
    } else {
      problems = parseDevProblems({
        command,
        repositoryRoot: session.repositoryRoot,
        exitCode,
        stdout: output,
      });

      const recognizableSuccess =
        /(?:TAP version|^1\.\.\d+|^ok\s+\d+|# pass\s+\d+|\btests?\s+\d+)/mi.test(
          output
        );

      if (
        exitCode === 0 &&
        problems.status === "EMPTY" &&
        !recognizableSuccess
      ) {
        problems.status = "UNRESOLVED";
      }
    }

    session.problems = {
      ...problems,
      terminalId: session.problems?.terminalId || null,
      updatedAt: new Date(completedAt).toISOString(),
      origin: "NATIVE",
      taskId: clean(input.taskId, 180) || null,
    };

    return { applied: true, status: session.problems.status };
  }

  function startNoonSandboxValidation({
    session,
    terminal,
    command,
    commandDecision,
    policyDecision,
  }) {
    const startedAt = now();
    const outputStartCursor = terminal.outputCursor;
    const problemRunId = crypto.randomUUID();
    const controller = new AbortController();
    let started = false;
    let record = null;

    const startState = (pid) => {
      if (started) return;
      started = true;
      record = {
        controller,
        pid: Number.isInteger(pid) ? pid : null,
      };
      terminal.runner = record;
      terminal.cleanupStatus = null;
      terminal.status = "RUNNING";
      terminal.exitCode = null;
      terminal.signal = null;
      append(terminal, "input", `$ ${command}`);
      session.activeProblemsRunId = problemRunId;
      session.problems = {
        status: "RUNNING",
        source: inferDevProblemSource(command),
        command,
        terminalId: terminal.id,
        exitCode: null,
        counts: { total: 0, error: 0, warning: 0, info: 0 },
        truncated: false,
        problems: [],
        updatedAt: iso(),
        origin: terminal.owner,
      };
      refreshExecutionState(session);
    };

    const complete = (result) => {
      if (!record || terminal.runner !== record) return;
      terminal.runner = null;
      if (terminal.status !== "CLOSED") terminal.status = "EXITED";
      terminal.exitCode = Number.isInteger(result.exitCode) ? result.exitCode : null;
      terminal.signal = result.signal || null;
      terminal.cleanupStatus = result.status === "CLEANUP_UNCONFIRMED"
        ? "CLEANUP_UNCONFIRMED"
        : result.cleanupConfirmed === true
          ? "CONFIRMED"
          : "UNCONFIRMED";
      terminal.lastActivityAt = iso();

      const currentProblemsRun =
        session.activeProblemsRunId === problemRunId;

      if (currentProblemsRun) {
        const parsedProblems = parseDevProblems({
          command,
          repositoryRoot: session.repositoryRoot,
          exitCode: terminal.exitCode,
          output: terminal.output.filter((event) => event.sequence > outputStartCursor),
        });
        parsedProblems.truncated = parsedProblems.truncated === true || result.outputTruncated === true;
        if (terminal.cancelReason === "USER_CANCELLED") {
          parsedProblems.status = "CANCELLED";
        } else if (
          result.status === "CLEANUP_UNCONFIRMED" ||
          result.status !== "PASS" ||
          result.cleanupConfirmed !== true
        ) {
          if (parsedProblems.status === "EMPTY") parsedProblems.status = "UNRESOLVED";
        }
        session.problems = {
          ...parsedProblems,
          terminalId: terminal.id,
          updatedAt: iso(),
          origin: terminal.owner,
        };
        session.activeProblemsRunId = null;
      }

      if (currentProblemsRun) {
        session.lastValidationState = {
          origin: terminal.owner,
          completedAt: iso(),
          nativeUiClaimedAt: null,
          command,
          classification: commandDecision.classification,
          reasonCode: result.reasonCode || commandDecision.reasonCode,
          exitCode: terminal.exitCode,
          signal: terminal.signal,
          durationMs: result.durationMs,
          status: terminal.cancelReason === "USER_CANCELLED"
            ? "CANCELLED"
            : result.status === "PASS"
              ? "PASS"
              : "FAIL",
          cleanupStatus: terminal.cleanupStatus,
        };
      }
      refreshExecutionState(session);
      emit("dev_terminal_exited", {
        workspaceId: session.workspaceId,
        terminalId: terminal.id,
        owner: terminal.owner,
        classification: commandDecision.classification,
        exitCode: terminal.exitCode,
        signal: terminal.signal,
        durationMs: result.durationMs,
        cleanupStatus: terminal.cleanupStatus,
      });
    };

    let runner;
    let contract;
    let pending;

    try {
      contract = createSandboxContract({
        executionId: `terminal-validation-${crypto.randomUUID()}`,
        workspaceId: session.workspaceId,
        workspaceSessionId: session.id,
        canonicalWorkspaceRoot: session.repositoryRoot,
        command,
        authority: {
          policyDecisionId: clean(policyDecision?.decisionId, 180) || null,
          policyVersion: clean(policyDecision?.policyVersion, 180) || null,
          actionFingerprint: clean(policyDecision?.actionFingerprint, 256) || null,
          budgetDecisionId: null,
          approvalId: null,
        },
      }, {
        now,
        environment,
      });

      runner = createSandboxRunner({
        spawnProcess,
        now,
        environment,
        resolveContext() {
          const current = requireSession(session.id);
          const { root } = rootFor(current.workspaceId, current.repositoryRoot);
          if (
            current !== session ||
            root.path !== session.repositoryRoot
          ) {
            throw Object.assign(new Error("Contexte terminal obsolète."), {
              code: "SANDBOX_CONTEXT_STALE",
            });
          }
          return {
            workspaceId: current.workspaceId,
            workspaceSessionId: current.id,
            canonicalWorkspaceRoot: root.path,
          };
        },
        revalidate() {
          policyFor(requireSession(session.id), commandDecision.classification);
          return { allowed: true };
        },
      });

      pending = runner.run(contract, {
        signal: controller.signal,
        onSpawn({ pid }) {
          startState(pid);
        },
        onOutput({ type, text }) {
          if (record && terminal.runner === record) append(terminal, type, text);
        },
      });
    } catch (error) {
      throw new DevWorkspaceError(
        clean(error?.code, 120) || "SANDBOX_TERMINAL_START_FAILED",
        "Impossible de démarrer la validation Sandbox."
      );
    }

    if (!started || !record) {
      controller.abort();
      Promise.resolve(pending).catch(() => {});
      throw new DevWorkspaceError(
        "SANDBOX_TERMINAL_SYNC_START_REQUIRED",
        "La validation Sandbox n'a pas confirmé son lancement immédiat."
      );
    }

    record.promise = pending;
    Promise.resolve(pending).then(
      complete,
      (error) => complete({
        status: "FAIL",
        reasonCode: clean(error?.code, 120) || "SANDBOX_EXECUTION_FAILED",
        exitCode: null,
        signal: null,
        durationMs: Math.max(0, now() - startedAt),
        outputTruncated: false,
        cleanupConfirmed: false,
      })
    );

    return {
      terminal: publicTerminal(terminal),
      classification: commandDecision.classification,
      reasonCode: commandDecision.reasonCode,
      execution: {
        executable: commandDecision.execution[0],
        args: [...commandDecision.execution[1]],
      },
    };
  }

  function runCommand(input = {}) {
    const session = requireSession(
      input.sessionId
    );

    const terminal = terminalFor(
      session,
      input.terminalId
    );

    if (terminal.child) {
      throw new DevWorkspaceError(
        "TERMINAL_BUSY",
        "Ce terminal exécute déjà une commande."
      );
    }

    assertTerminalOrigin(
      terminal,
      input.origin
    );

    const command = String(
      input.command || ""
    ).trim();

    if (
      !command ||
      command.length >
        MAX_COMMAND_LENGTH
    ) {
      throw new DevWorkspaceError(
        "COMMAND_INVALID",
        "Commande terminal invalide."
      );
    }

    const commandDecision =
      classifyDevCommand(command);

    if (
      commandDecision.allowed !== true ||
      !Array.isArray(
        commandDecision.execution
      ) ||
      typeof
        commandDecision.execution[0] !==
        "string" ||
      !Array.isArray(
        commandDecision.execution[1]
      )
    ) {
      throw new DevWorkspaceError(
        commandDecision.reasonCode ||
          "COMMAND_NOT_ALLOWLISTED",
        "Cette commande n’est pas autorisée dans le terminal DEV."
      );
    }

    const policyDecision = policyFor(
      session,
      commandDecision.classification
    );

    if (
      terminal.owner === "NOON" &&
      commandDecision.classification === "SAFE_READ"
    ) {
      return startNoonSandboxValidation({
        session,
        terminal,
        command,
        commandDecision,
        policyDecision,
      });
    }

    const [
      executable,
      args,
    ] = commandDecision.execution;

    const startedAt = now();

    const outputStartCursor =
      terminal.outputCursor;

    const problemRunId =
      commandDecision.classification ===
      "SAFE_READ"
        ? crypto.randomUUID()
        : null;

    terminal.status = "RUNNING";
    terminal.exitCode = null;
    terminal.signal = null;

    append(
      terminal,
      "input",
      `$ ${command}`
    );

    let child;

    try {
      child = spawnProcess(
        executable,
        [...args],
        {
          cwd: terminal.cwd,
          env:
            sanitizedTerminalEnvironment(
              environment
            ),
          stdio: [
            "ignore",
            "pipe",
            "pipe",
          ],
          detached: false,
          shell: false,
        }
      );
    } catch (error) {
      terminal.status = "EXITED";

      append(
        terminal,
        "stderr",
        error?.message ||
          "Impossible de démarrer la commande."
      );

      throw new DevWorkspaceError(
        "TERMINAL_SPAWN_FAILED",
        "Impossible de démarrer la commande."
      );
    }

    terminal.child = child;

    if (
      commandDecision.classification ===
      "SAFE_READ"
    ) {
      session.activeProblemsRunId =
        problemRunId;

      session.problems = {
        status: "RUNNING",
        source:
          inferDevProblemSource(
            command
          ),
        command,
        terminalId:
          terminal.id,
        exitCode: null,
        counts: {
          total: 0,
          error: 0,
          warning: 0,
          info: 0,
        },
        truncated: false,
        problems: [],
        updatedAt: iso(),
        origin: terminal.owner,
      };
    }

    refreshExecutionState(session);

    let finalized = false;

    const finalize = (
      code,
      signal,
      error = null
    ) => {
      if (finalized) return;
      finalized = true;

      terminal.child = null;

      if (
        terminal.status !== "CLOSED"
      ) {
        terminal.status = "EXITED";
      }

      terminal.exitCode =
        Number.isInteger(code)
          ? code
          : null;

      terminal.signal =
        signal || null;

      terminal.lastActivityAt =
        iso();

      const currentProblemsRun =
        commandDecision.classification === "SAFE_READ" &&
        session.activeProblemsRunId === problemRunId;

      if (currentProblemsRun) {
        const commandOutput =
          terminal.output.filter(
            (event) =>
              event.sequence >
              outputStartCursor
          );

        const parsedProblems =
          parseDevProblems({
            command,
            repositoryRoot:
              session.repositoryRoot,
            exitCode:
              terminal.exitCode,
            output:
              commandOutput,
          });

        if (terminal.cancelReason === "USER_CANCELLED") {
          parsedProblems.status = "CANCELLED";
        } else if ((error || terminal.signal) && parsedProblems.status === "EMPTY") {
          parsedProblems.status =
            "UNRESOLVED";
        }

        session.problems = {
          ...parsedProblems,
          terminalId:
            terminal.id,
          updatedAt: iso(),
          origin: terminal.owner,
        };

        session.activeProblemsRunId =
          null;
      }

      if (
        commandDecision.classification !== "SAFE_READ" ||
        currentProblemsRun
      ) {
        session.lastValidationState = {
          origin: terminal.owner,
          completedAt: iso(),
          nativeUiClaimedAt: null,

          command:
            commandDecision.classification ===
            "SAFE_READ"
              ? command
              : null,

          classification:
            commandDecision.classification,

          reasonCode:
            commandDecision.reasonCode,

          exitCode:
            terminal.exitCode,

          signal:
            terminal.signal,

          durationMs:
            now() - startedAt,

          status:
            terminal.cancelReason === "USER_CANCELLED"
              ? "CANCELLED"
              : error
              ? "FAILED"
              : terminal.exitCode === 0
                ? "PASS"
                : "FAIL",
        };
      }

      refreshExecutionState(session);

      emit("dev_terminal_exited", {
        workspaceId:
          session.workspaceId,
        terminalId:
          terminal.id,
        owner:
          terminal.owner,
        classification:
          commandDecision.classification,
        exitCode:
          terminal.exitCode,
        signal:
          terminal.signal,
        durationMs:
          now() - startedAt,
      });
    };

    child.stdout?.on(
      "data",
      (chunk) =>
        append(
          terminal,
          "stdout",
          chunk
        )
    );

    child.stderr?.on(
      "data",
      (chunk) =>
        append(
          terminal,
          "stderr",
          chunk
        )
    );

    child.once?.(
      "error",
      (error) => {
        append(
          terminal,
          "stderr",
          error?.message ||
            "Erreur terminal."
        );

        finalize(
          null,
          null,
          error
        );
      }
    );

    child.once?.(
      "close",
      (code, signal) => {
        finalize(
          code,
          signal
        );
      }
    );

    return {
      terminal:
        publicTerminal(terminal),

      classification:
        commandDecision.classification,

      reasonCode:
        commandDecision.reasonCode,

      execution: {
        executable,
        args: [...args],
      },
    };
  }

  function poll(input = {}) {
    const terminal = terminalFor(
      requireSession(input.sessionId),
      input.terminalId
    );

    const from = Math.max(
      0,
      Number(input.from) || 0
    );

    const output = terminal.output
      .filter(
        (event) =>
          event.sequence > from
      )
      .map(
        ({
          sequence: _sequence,
          ...event
        }) => event
      );

    return {
      terminal: publicTerminal(terminal),
      output,
      next: terminal.outputCursor,
    };
  }

  function closeTerminal(
    input = {}
  ) {
    const session = requireSession(
      input.sessionId
    );

    const terminal = terminalFor(
      session,
      input.terminalId
    );

    const child =
      terminal.child;

    const runner =
      terminal.runner;

    terminal.status = "CLOSED";
    terminal.cancelReason = input.reason === "USER_CANCELLED" ? "USER_CANCELLED" : null;
    if (runner) {
      terminal.cleanupStatus = "PENDING";
    } else {
      terminal.child = null;
    }
    terminal.lastActivityAt = iso();

    if (runner) {
      try {
        runner.controller.abort();
      } catch {}
    } else if (
      child &&
      !child.killed
    ) {
      try {
        child.kill("SIGTERM");
      } catch {}
    }

    if (
      session.activeTerminalId ===
      terminal.id
    ) {
      session.activeTerminalId = [
        ...session.terminals.values(),
      ].find(
        (item) =>
          item.status !== "CLOSED"
      )?.id || null;
    }

    refreshExecutionState(session);

    emit("dev_terminal_closed", {
      workspaceId:
        session.workspaceId,
      terminalId:
        terminal.id,
      owner:
        terminal.owner,
    });

    return {
      closed: true,
      activeTerminalId:
        session.activeTerminalId,
    };
  }

  function getCompletions(
    input = {}
  ) {
    const session =
      requireSession(
        input.sessionId
      );

    const completions =
      listRepositoryCompletions({
        repositoryRoot:
          session.repositoryRoot,
        query:
          input.query,
      });

    emit(
      "dev_terminal_completion_read",
      {
        workspaceId:
          session.workspaceId,
        count:
          completions.length,
      }
    );

    return {
      completions,
    };
  }

  function closeSession(id) {
    const session =
      requireSession(id);

    for (
      const terminal of
      session.terminals.values()
    ) {
      const child =
        terminal.child;

      terminal.status = "CLOSED";

      if (terminal.runner) {
        terminal.cleanupStatus = "PENDING";
        try {
          terminal.runner.controller.abort();
        } catch {}
      } else if (
        child &&
        !child.killed
      ) {
        terminal.child = null;
        try {
          child.kill("SIGTERM");
        } catch {}
      }
    }

    sessions.delete(
      session.id
    );

    return {
      closed: true,
    };
  }

  return {
    createSession,
    getSession: (id) =>
      publicSession(
        requireSession(id)
      ),
    inspectGitDiff,
    readGitDiff,
    getCompletions,
    createTerminal,
    runCommand,
    claimAuthorizedValidation,
    applyNativeValidationResult,
    poll,
    closeTerminal,
    closeSession,
    commandClasses:
      COMMAND_CLASSES,
    terminalOwners:
      TERMINAL_OWNERS,
  };
}

module.exports = {
  COMMAND_CLASSES,
  DevWorkspaceError,
  TERMINAL_OWNERS,
  TERMINAL_STATUSES,
  createDevWorkspaceTerminalService,
  sanitizedTerminalEnvironment,
};
