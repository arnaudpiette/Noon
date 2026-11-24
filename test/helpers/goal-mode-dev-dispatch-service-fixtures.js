"use strict";

// Shared setup for test/goal-mode-dev-dispatch-service*.test.js (moved verbatim from test/goal-mode-dev-dispatch-service.test.js, V3-L7).

const { execFileSync } = require("node:child_process");

const fs = require("node:fs");

const os = require("node:os");

const path = require("node:path");

const { createGoalModeRunContract } = require("../../services/goals/goal-mode-run-contract");

const { createGoalModeRunStore } = require("../../services/goals/goal-mode-run-store");

const {
  VERSION: PROJECTION_VERSION,
  deterministicGoalModeDevTaskId,
} = require("../../services/goals/goal-mode-dev-projection-service");

const {
  createGoalModeDevDispatchService,
  defaultGoalModeDevTargetInspector,
} = require("../../services/goals/goal-mode-dev-dispatch-service");

const { createPersonalDatabase } = require("../../services/persistence/database");

const { createApprovalEngine } = require("../../services/approvals/approval-engine");

const { createDevTaskJournal } = require("../../services/dev/dev-task-journal");

const { createNativeDevOrchestratorFacade } = require("../../services/dev/native-dev-orchestrator-facade");

const {
  createApprovalRepository,
} = require("../../services/persistence/repositories/approval-repository");

const {
  createGoalModeRunRepository,
} = require("../../services/persistence/repositories/goal-mode-run-repository");

const AT = "2026-10-13T12:00:00.000Z";

const FINGERPRINT = `sha256:${"c".repeat(64)}`;

function contract() {
  return createGoalModeRunContract({
    goal: {
      goalId: "goal-dispatch", title: "Goal DEV", status: "ACTIVE",
      outcomeDefinition: "Vérifier le dispatch DEV unique.",
      successCriteria: [{ criterionId: "criterion-dispatch", type: "BOOLEAN", targetValue: true }],
      linkedProjectIds: [], linkedWorkspaceIds: [], constraints: [],
      profileScope: "test", sensitivity: "NORMAL", userConfirmed: true, version: 2,
    },
    request: {
      userConfirmed: true,
      limits: {
        maxSteps: 4, maxRetries: 1, maxProviderCalls: 3,
        maxDuration: 600_000, maxEstimatedCost: 1,
      },
      capabilityCeilings: { network: true, gitWrite: false, destructiveActions: false },
    },
    now: () => new Date(AT), idFactory: () => "goal-run-dispatch",
  });
}

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function createRepository(directory) {
  const root = path.join(directory, "repo");
  fs.mkdirSync(root);
  git(root, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(root, "target.js"), "module.exports = 1;\n");
  git(root, "add", "target.js");
  git(root, "-c", "user.name=Synthetic", "-c", "user.email=synthetic@example.invalid",
    "-c", "commit.gpgsign=false", "commit", "-q", "-m", "init");
  return fs.realpathSync(root);
}

// 4C-1C : resume est la seule entrée publique vers le dispatch.
function resume(service, prepared, decision = "approve") {
  return service.resume({
    approvalId: prepared.approval.id, resumeToken: prepared.resumeToken, decision,
  });
}

function fixture({ realRepository = false } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noon-50d4c1b-"));
  const file = path.join(directory, "run.sqlite");
  const dbA = createPersonalDatabase(file);
  const dbB = createPersonalDatabase(file);
  const repositoryRoot = realRepository ? createRepository(directory) : "/private/synthetic-repo";
  let clock = "2026-10-13T12:00:02.000Z";
  const budget = { remaining: 10, calls: 0 };
  const live = { network: true, gitWrite: false, destructiveActions: false, repositoryWrite: true };
  let targetFingerprint = FINGERPRINT;
  let onInspect = null;
  let onInspectSkip = 0;
  let engineTime = null;
  let capabilityOverride = null;
  let storeA;
  const proposalFingerprint = `sha256:${"a".repeat(64)}`;
  const projectionService = {
    project({ runId, stepId }) {
      const snapshot = storeA.get(runId);
      const taskId = deterministicGoalModeDevTaskId(runId, stepId, proposalFingerprint);
      return {
        version: PROJECTION_VERSION,
        runRef: {
          runId, runRevision: snapshot.revision,
          goalId: snapshot.state.contract.goalRef.goalId,
          goalVersion: snapshot.state.contract.goalRef.goalVersion,
        },
        stepRef: {
          stepId, proposalFingerprint, targetKind: "MILESTONE",
          targetId: "milestone-1", targetFingerprint: `sha256:${"b".repeat(64)}`,
        },
        taskRef: {
          taskId, workspaceId: "workspace-1", projectId: "project-1",
          repositoryRoot, branch: "main",
        },
        accounting: {
          stepUpperBound: { steps: 1, retries: 0, providerCalls: 2, estimatedCost: 0.4 },
          devSecondaryCostCap: 0.4, consumed: false,
        },
        authorization: { capabilitiesGranted: false },
        authority: { executionAuthorized: false, capabilitiesGranted: false },
        devContract: {
          capabilities: {
            networkAllowed: true, gitWriteAllowed: false,
            destructiveActionsAllowed: false, executionAuthority: false,
            ...(capabilityOverride || {}),
          },
          devInput: {
            taskId, repositoryRoot, branch: "main",
            objective: "SYNTHETIC_PRIVATE_OBJECTIVE",
            allowedPaths: [repositoryRoot],
            maxEstimatedCost: 0.4, maxProviderCalls: 2, maxDuration: 300_000,
            localOnly: false, permissions: ["READ_WRITE_WORKSPACE", "TERMINAL_SAFE"],
          },
        },
      };
    },
  };
  // Journal Native DEV contrôlable (états par taskId, ABSENT par défaut).
  const journalStates = new Map();
  const devTaskJournal = {
    lookup(taskId) {
      const state = journalStates.get(taskId);
      if (state === "THROW") throw new Error("journal unavailable");
      return { status: state || "ABSENT" };
    },
  };
  // Règles projet (branchement B1) : résolues côté serveur, contrôlables ici.
  const rules = { list: ["SYNTHETIC_PROJECT_RULE"], throws: false, calls: 0, onResolve: null };
  const projectRulesResolver = {
    resolve(input) {
      rules.calls += 1;
      rules.lastInput = input;
      const hook = rules.onResolve;
      if (hook) hook(rules.calls);
      if (rules.throws) throw Object.assign(new Error("rules"), { code: "SYNTHETIC_RULES_FAILURE" });
      return [...rules.list];
    },
  };
  const makeStore = (repository) => createGoalModeRunStore({
    repository, now: () => clock, devProjectionService: projectionService,
    devTaskLedger: { taskProviderCalls: () => budget.calls }, devTaskJournal,
  });
  const repositoryA = createGoalModeRunRepository(dbA);
  const repositoryB = createGoalModeRunRepository(dbB);
  storeA = makeStore(repositoryA);
  const storeB = makeStore(repositoryB);
  const created = storeA.create(contract());
  const running = storeA.transition(created.state.runId, "RUNNING", {
    expectedRevision: created.revision, transitionedAt: "2026-10-13T12:00:01.000Z",
  });
  const calls = [];
  const cancels = [];
  const dispatcher = {
    behaviour: null,
    cancelBehaviour: null,
    cancelTask(taskId) {
      cancels.push(taskId);
      if (dispatcher.cancelBehaviour) return dispatcher.cancelBehaviour(taskId);
      return { cancelled: true, taskId };
    },
    getTaskStatus(taskId) {
      return {
        taskId, status: "RUNNING", finalVerdict: null, failureCategory: null,
        objective: "SYNTHETIC_PRIVATE_OBJECTIVE", repositoryRoot,
      };
    },
    async runTask(payload) {
      calls.push({
        payload,
        persistedStatus: repositoryB.latest(running.state.runId)
          .state.executionReservations.at(-1).status,
      });
      if (dispatcher.behaviour) return dispatcher.behaviour(payload);
      return { taskId: payload.taskId, finalVerdict: "SYNTHETIC_DONE" };
    },
  };
  const devBudgetService = {
    effectiveRemaining: () => budget.remaining,
    taskProviderCalls: () => budget.calls,
  };
  const permissionSource = { current: () => ({ ...live }) };
  const goal = { goalId: "goal-dispatch", title: "SYNTHETIC_GOAL_TITLE", status: "ACTIVE", userConfirmed: true, version: 2 };
  const goalStrategyEngine = { registry: { get: (goalId) => (goalId === goal.goalId ? { ...goal } : null) } };
  const syntheticInspector = () => {
    if (onInspect && onInspectSkip > 0) {
      onInspectSkip -= 1;
      return targetFingerprint;
    }
    const callback = onInspect;
    onInspect = null;
    callback?.();
    return targetFingerprint;
  };
  const audit = [];
  const approvalRepository = createApprovalRepository(dbA);
  const makeEngine = (repository = approvalRepository) => createApprovalEngine({
    repository,
    auditLog: { append(event, metadata) { audit.push({ event, metadata }); } },
    now: () => Date.parse(engineTime ?? clock),
  });
  const approvalEngine = makeEngine();
  const makeService = (store = storeA, overrides = {}) => createGoalModeDevDispatchService({
    runStore: store, goalStrategyEngine, devBudgetService, permissionSource, dispatcher,
    approvalEngine, devTaskJournal, projectRulesResolver,
    targetInspector: realRepository ? defaultGoalModeDevTargetInspector : syntheticInspector,
    now: () => new Date(clock),
    ...overrides,
  });
  return {
    file, directory, repositoryRoot, repositoryA, repositoryB, storeA, storeB, running,
    budget, live, goal, goalStrategyEngine, calls, cancels, dispatcher, makeStore, makeService,
    approvalEngine, approvalRepository, makeEngine, audit, dbA, devTaskJournal, journalStates,
    rules, projectRulesResolver,
    prepare(service) {
      return service.prepare(running.state.runId, {
        expectedRevision: storeA.get(running.state.runId).revision, stepId: "step-dispatch",
      });
    },
    latest() { return repositoryB.latest(running.state.runId); },
    status() { return repositoryB.latest(running.state.runId).state.executionReservations?.at(-1)?.status; },
    setTime(value) { clock = value; },
    setTargetFingerprint(value) { targetFingerprint = value; },
    setOnInspect(value, skip = 0) { onInspect = value; onInspectSkip = skip; },
    setEngineTime(value) { engineTime = value; },
    approvalRow(id) { return approvalRepository.get(id); },
    setCapabilityOverride(value) { capabilityOverride = value; },
    close() {
      dbA.close(); dbB.close();
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

module.exports = {
  FINGERPRINT,
  createApprovalRepository,
  createDevTaskJournal,
  createGoalModeDevDispatchService,
  createGoalModeRunRepository,
  createNativeDevOrchestratorFacade,
  createPersonalDatabase,
  createRepository,
  defaultGoalModeDevTargetInspector,
  deferred,
  deterministicGoalModeDevTaskId,
  fixture,
  git,
  resume,
};
