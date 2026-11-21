"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createGoalModeRunContract } = require("../services/goals/goal-mode-run-contract");
const { createGoalModeRunStore } = require("../services/goals/goal-mode-run-store");
const {
  VERSION: PROJECTION_VERSION,
  deterministicGoalModeDevTaskId,
} = require("../services/goals/goal-mode-dev-projection-service");
const {
  createGoalModeDevDispatchService,
  defaultGoalModeDevTargetInspector,
} = require("../services/goals/goal-mode-dev-dispatch-service");
const { createPersonalDatabase } = require("../services/persistence/database");
const { createApprovalEngine } = require("../services/approvals/approval-engine");
const { createDevTaskJournal } = require("../services/dev/dev-task-journal");
const { createNativeDevOrchestratorFacade } = require("../services/dev/native-dev-orchestrator-facade");
const {
  createApprovalRepository,
} = require("../services/persistence/repositories/approval-repository");
const {
  createGoalModeRunRepository,
} = require("../services/persistence/repositories/goal-mode-run-repository");

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

test("4C-1B dispatch unique : CAS MAY_HAVE_STARTED avant l'effet, contrat exact sans élévation", async () => {
  const f = fixture();
  try {
    const service = f.makeService();
    const prepared = f.prepare(service);
    const ticket = prepared.ticket;
    assert.equal(Object.isFrozen(ticket), true);
    assert.equal(JSON.stringify(ticket).includes("SYNTHETIC_PRIVATE_OBJECTIVE"), false);
    assert.equal(f.status(), "PREPARED");
    f.live.gitWrite = true; // un état vivant plus large n'élève rien
    f.live.destructiveActions = true;
    const result = await resume(service, prepared);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].persistedStatus, "MAY_HAVE_STARTED");
    const sent = f.calls[0].payload;
    assert.equal(sent.objective, "SYNTHETIC_PRIVATE_OBJECTIVE");
    assert.deepEqual(sent.permissions, ["READ_WRITE_WORKSPACE", "TERMINAL_SAFE"]);
    assert.equal(sent.localOnly, false);
    assert.equal(Object.hasOwn(sent, "allowGitWrite"), false);
    assert.equal(Object.hasOwn(sent, "gitWriteAllowed"), false);
    sent.allowedPaths.push("/outside"); // copie neuve : n'altère pas le contrat remis
    assert.equal(Object.isFrozen(result), true);
    assert.equal(result.reservationId, ticket.reservationId);
    assert.equal(result.mayHaveStartedRevision, ticket.reservedRevision + 1);
    assert.equal(result.reconciliationRequired, true);
    assert.deepEqual(result.authority, { approvalConsumedBy: "ApprovalEngine", capabilitiesGranted: false });
    assert.equal(result.approvalId, prepared.approval.id);
    assert.equal(f.approvalRow(prepared.approval.id).status, "consumed");
    assert.equal(f.status(), "MAY_HAVE_STARTED");
    // 4C-1C : un second resume bute sur l'approbation consommée (usage unique).
    await assert.rejects(() => resume(service, prepared), { code: "APPROVAL_CONSUMED" });
    assert.equal(f.calls.length, 1);
    assert.equal(JSON.stringify(f.latest().state).includes("SYNTHETIC_PRIVATE_OBJECTIVE"), false);
  } finally { f.close(); }
});

test("4C-1B double appel concurrent : un seul dispatch, même ticket ou autre connexion", async () => {
  const f = fixture();
  try {
    const service = f.makeService();
    const prepared = f.prepare(service);
    const ticket = prepared.ticket;
    const outcomes = await Promise.allSettled([resume(service, prepared), resume(service, prepared)]);
    assert.deepEqual(outcomes.map((item) => item.status).sort(), ["fulfilled", "rejected"]);
    // 4C-1C : la seconde reprise simultanée bute sur l'approbation en vol.
    assert.equal(outcomes.find((item) => item.status === "rejected").reason.code,
      "APPROVAL_INVALID");
    assert.equal(f.calls.length, 1);
  } finally { f.close(); }

  const g = fixture();
  try {
    const service = g.makeService();
    const prepared = g.prepare(service);
    const ticket = prepared.ticket;
    // Une autre connexion franchit la frontière pendant le recheck de A
    // (après la lecture du statut, avant le CAS) : le CAS de A doit perdre.
    // 4C-1C : 3e mesure = recheck interne, juste avant consommation et CAS.
    let interposed = false;
    g.setOnInspect(() => {
      interposed = true;
      g.storeB.markExecutionMayHaveStarted(g.running.state.runId, {
        expectedRevision: ticket.reservedRevision, reservationId: ticket.reservationId,
      });
    }, 2);
    await assert.rejects(() => resume(service, prepared), { code: "GOAL_MODE_RUN_PERSISTENCE_CONFLICT" });
    assert.equal(interposed, true);
    assert.equal(g.calls.length, 0);
    assert.equal(g.status(), "MAY_HAVE_STARTED");
    assert.equal(g.latest().revision, ticket.reservedRevision + 1);
    // Approbation consommée avant le CAS perdu : brûlée, jamais réutilisable.
    assert.equal(g.approvalRow(prepared.approval.id).status, "consumed");
    await assert.rejects(() => resume(service, prepared), { code: "APPROVAL_CONSUMED" });
    assert.equal(g.calls.length, 0);
  } finally { g.close(); }
});

test("4C-1B crash entre CAS et dispatch : aucun replay, réconciliation requise après restart", async () => {
  const f = fixture();
  try {
    // Le CAS est commité puis le processus « meurt » avant l'appel dispatcher.
    const crashing = Object.freeze({
      ...f.storeA,
      markExecutionMayHaveStarted(...args) {
        f.storeA.markExecutionMayHaveStarted(...args);
        throw Object.assign(new Error("synthetic crash"), { code: "SYNTHETIC_CRASH" });
      },
    });
    const service = f.makeService(crashing);
    const prepared = f.prepare(service);
    const ticket = prepared.ticket;
    await assert.rejects(() => resume(service, prepared), { code: "SYNTHETIC_CRASH" });
    assert.equal(f.calls.length, 0);
    assert.equal(f.status(), "MAY_HAVE_STARTED");
    assert.equal(f.approvalRow(prepared.approval.id).status, "consumed");
    await assert.rejects(() => resume(service, prepared), { code: "APPROVAL_CONSUMED" });

    const reopenedDatabase = createPersonalDatabase(f.file);
    try {
      const reopenedStore = f.makeStore(createGoalModeRunRepository(reopenedDatabase));
      const restarted = f.makeService(reopenedStore, {
        approvalEngine: f.makeEngine(createApprovalRepository(reopenedDatabase)),
      });
      await assert.rejects(() => resume(restarted, prepared), { code: "APPROVAL_NOT_FOUND" });
      await assert.rejects(() => restarted.resume({
        approvalId: `approval_${"0".repeat(8)}-0000-0000-0000-${"0".repeat(12)}`,
        resumeToken: prepared.resumeToken,
      }), { code: "APPROVAL_NOT_FOUND" });
      assert.throws(() => restarted.prepare(f.running.state.runId, {
        expectedRevision: f.latest().revision, stepId: "step-dispatch",
      }), { code: "GOAL_MODE_EXECUTION_IN_FLIGHT" });
      assert.equal(f.calls.length, 0);
      assert.equal(f.status(), "MAY_HAVE_STARTED");
    } finally { reopenedDatabase.close(); }
  } finally { f.close(); }
});

test("4C-1B MAY_HAVE_STARTED ou UNKNOWN externe part en réconciliation, jamais en replay", async () => {
  for (const finalStatus of ["MAY_HAVE_STARTED", "UNKNOWN"]) {
    const f = fixture();
    try {
      const service = f.makeService();
      const prepared = f.prepare(service);
    const ticket = prepared.ticket;
      let snapshot = f.storeB.markExecutionMayHaveStarted(f.running.state.runId, {
        expectedRevision: ticket.reservedRevision, reservationId: ticket.reservationId,
      });
      if (finalStatus === "UNKNOWN") {
        snapshot = f.storeB.markExecutionUnknown(f.running.state.runId, {
          expectedRevision: snapshot.revision, reservationId: ticket.reservationId,
        });
      }
      await assert.rejects(() => resume(service, prepared), (error) => {
        assert.equal(error.code, "GOAL_MODE_DEV_DISPATCH_RECONCILIATION_REQUIRED");
        assert.equal(error.details.status, finalStatus);
        assert.equal(error.details.reservationId, ticket.reservationId);
        return true;
      });
      assert.equal(f.calls.length, 0);
      assert.equal(f.status(), finalStatus);
      assert.equal(f.latest().revision, snapshot.revision);
    } finally { f.close(); }
  }
});

test("4C-1B budget épuisé ou ledger engagé entre préparation et dispatch : refus sans CAS", async () => {
  const f = fixture();
  try {
    const service = f.makeService();
    const prepared = f.prepare(service);
    const ticket = prepared.ticket;
    f.budget.remaining = 0.39;
    await assert.rejects(() => resume(service, prepared),
      { code: "GOAL_MODE_DEV_DISPATCH_BUDGET_EXHAUSTED" });
    f.budget.remaining = Number.NaN;
    await assert.rejects(() => resume(service, prepared),
      { code: "GOAL_MODE_DEV_DISPATCH_BUDGET_EXHAUSTED" });
    f.budget.remaining = 10;
    f.budget.calls = 1;
    await assert.rejects(() => resume(service, prepared),
      { code: "GOAL_MODE_DEV_DISPATCH_RECONCILIATION_REQUIRED" });
    f.budget.calls = 0;
    f.setTime("2026-10-13T12:09:59.500Z"); // < 1 s avant l'échéance du run
    // 4C-1C : l'approbation (TTL plafonné par l'échéance − 1 s) expire avant.
    await assert.rejects(() => resume(service, prepared), { code: "approval_expired" });
    // Garde temporelle du recheck, isolée par une horloge d'approbation décalée.
    f.setEngineTime("2026-10-13T12:00:03.000Z");
    await assert.rejects(() => resume(service, prepared),
      { code: "GOAL_MODE_DEV_DISPATCH_TIME_BUDGET_BLOCKED" });
    assert.equal(f.calls.length, 0);
    assert.equal(f.status(), "PREPARED");
    assert.equal(f.latest().revision, ticket.reservedRevision);
    // Pré-contrôles refusés : l'approbation n'est ni consommée ni brûlée.
    assert.equal(f.approvalRow(prepared.approval.id).status, "pending");
    // Rien n'ayant été engagé, la même approbation reste utilisable une fois rétabli.
    f.setEngineTime(null);
    f.setTime("2026-10-13T12:00:03.000Z");
    await resume(service, prepared);
    assert.equal(f.calls.length, 1);
  } finally { f.close(); }
});

test("4C-1B permission retirée ou contrat élargi : refus sans CAS ni dispatch", async () => {
  const f = fixture();
  try {
    const service = f.makeService();
    const prepared = f.prepare(service);
    const ticket = prepared.ticket;
    f.live.network = false;
    await assert.rejects(() => resume(service, prepared),
      { code: "GOAL_MODE_DEV_DISPATCH_PERMISSION_REVOKED" });
    f.live.network = true;
    f.live.repositoryWrite = false;
    await assert.rejects(() => resume(service, prepared),
      { code: "GOAL_MODE_DEV_DISPATCH_PERMISSION_REVOKED" });
    f.live.repositoryWrite = "yes"; // seule la valeur true compte
    await assert.rejects(() => resume(service, prepared),
      { code: "GOAL_MODE_DEV_DISPATCH_PERMISSION_REVOKED" });
    assert.equal(f.calls.length, 0);
    assert.equal(f.status(), "PREPARED");
    assert.equal(f.latest().revision, ticket.reservedRevision);
  } finally { f.close(); }

  for (const override of [{ gitWriteAllowed: true }, { executionAuthority: true },
    { destructiveActionsAllowed: true }]) {
    const g = fixture();
    try {
      g.setCapabilityOverride(override);
      const service = g.makeService();
      const prepared = g.prepare(service);
    const ticket = prepared.ticket;
      await assert.rejects(() => resume(service, prepared),
        { code: "GOAL_MODE_DEV_DISPATCH_PERMISSION_ESCALATION" });
      assert.equal(g.calls.length, 0);
      assert.equal(g.status(), "PREPARED");
    } finally { g.close(); }
  }

  // B4a : le réseau est revérifié au dispatch (plafond ∩ contrat ∩ état vivant).
  // Un contrat sans réseau n'est jamais complété par le dispatch.
  for (const override of [{ networkAllowed: false }, { networkAllowed: "true" }]) {
    const n = fixture();
    try {
      n.setCapabilityOverride(override);
      const service = n.makeService();
      const prepared = n.prepare(service);
      await assert.rejects(() => resume(service, prepared),
        { code: "GOAL_MODE_DEV_DISPATCH_PERMISSION_REVOKED" });
      assert.equal(n.calls.length, 0);
      assert.equal(n.status(), "PREPARED");
    } finally { n.close(); }
  }
});

test("4C-1B fichier cible modifié après préparation : refus sans CAS (repository Git réel)", async () => {
  const f = fixture({ realRepository: true });
  try {
    // Fichier suivi propre modifié ; la réservation refusée sort par UNKNOWN.
    const service = f.makeService();
    const prepared = f.prepare(service);
    const ticket = prepared.ticket;
    fs.writeFileSync(path.join(f.repositoryRoot, "target.js"), "module.exports = 2;\n");
    await assert.rejects(() => resume(service, prepared),
      { code: "GOAL_MODE_DEV_DISPATCH_TARGET_CHANGED" });
    assert.equal(f.calls.length, 0);
    assert.equal(f.status(), "PREPARED");
    f.storeA.markExecutionUnknown(f.running.state.runId, {
      expectedRevision: f.latest().revision, reservationId: ticket.reservationId,
    });
    assert.throws(() => f.prepare(service), { code: "GOAL_MODE_EXECUTION_UNKNOWN_BLOCKED" });
  } finally { f.close(); }

  // Fichier déjà modifié re-modifié, nouveau fichier non suivi, changement de branche.
  for (const mutate of [
    (root) => fs.writeFileSync(path.join(root, "target.js"), "module.exports = 3;\n"),
    (root) => fs.writeFileSync(path.join(root, "new.js"), "x\n"),
    (root) => git(root, "checkout", "-q", "-b", "other"),
  ]) {
    const g = fixture({ realRepository: true });
    try {
      fs.writeFileSync(path.join(g.repositoryRoot, "target.js"), "module.exports = 2;\n");
      const service = g.makeService();
      const prepared = g.prepare(service);
    const ticket = prepared.ticket;
      mutate(g.repositoryRoot);
      await assert.rejects(() => resume(service, prepared),
        { code: "GOAL_MODE_DEV_DISPATCH_TARGET_CHANGED" });
      assert.equal(g.calls.length, 0);
      assert.equal(g.status(), "PREPARED");
    } finally { g.close(); }
  }

  const h = fixture({ realRepository: true });
  try {
    const service = h.makeService();
    const prepared = h.prepare(service);
    const ticket = prepared.ticket;
    await resume(service, prepared); // cible inchangée : dispatch autorisé
    assert.equal(h.calls.length, 1);
  } finally { h.close(); }
});

test("4C-1B cible non mesurable après CAS : PREPARED orphelin, sortie par UNKNOWN", () => {
  const f = fixture();
  try {
    const service = f.makeService(f.storeA, {
      targetInspector: defaultGoalModeDevTargetInspector, // /private/synthetic-repo absent
    });
    assert.throws(() => f.prepare(service), { code: "GOAL_MODE_DEV_TARGET_UNINSPECTABLE" });
    assert.equal(f.status(), "PREPARED");
    assert.throws(() => f.prepare(service), { code: "GOAL_MODE_EXECUTION_IN_FLIGHT" });
    const reservationId = f.latest().state.executionReservations.at(-1).reservationId;
    f.storeA.markExecutionUnknown(f.running.state.runId, {
      expectedRevision: f.latest().revision, reservationId,
    });
    assert.equal(f.status(), "UNKNOWN");
    assert.equal(f.calls.length, 0);
  } finally { f.close(); }
});

test("4C-1B issue dispatcher en erreur : incertaine, jamais rejouée, sans fuite", async () => {
  const f = fixture();
  try {
    f.dispatcher.behaviour = () => {
      throw Object.assign(new Error("SYNTHETIC_PRIVATE_OBJECTIVE leaked"), { code: "NATIVE_DEV_FAILED" });
    };
    const service = f.makeService();
    const prepared = f.prepare(service);
    const ticket = prepared.ticket;
    await assert.rejects(() => resume(service, prepared), (error) => {
      assert.equal(error.code, "GOAL_MODE_DEV_DISPATCH_OUTCOME_UNCERTAIN");
      assert.equal(error.details.causeCode, "NATIVE_DEV_FAILED");
      assert.equal(error.details.reconciliationRequired, true);
      assert.equal(JSON.stringify(error.details).includes("SYNTHETIC_PRIVATE_OBJECTIVE"), false);
      assert.equal(error.message.includes("SYNTHETIC_PRIVATE_OBJECTIVE"), false);
      return true;
    });
    assert.equal(f.calls.length, 1);
    assert.equal(f.status(), "MAY_HAVE_STARTED");
    // Erreur après consommation : l'approbation reste consommée, code audité.
    const row = f.approvalRow(prepared.approval.id);
    assert.equal(row.status, "consumed");
    assert.equal(row.failure_code, "GOAL_MODE_DEV_DISPATCH_OUTCOME_UNCERTAIN");
    await assert.rejects(() => resume(service, prepared), { code: "APPROVAL_CONSUMED" });
    assert.equal(f.calls.length, 1);
  } finally { f.close(); }
});

test("4C-1B/1C approbation forgée, jeton faux ou autre instance refusés ; dispatch interne ; dépendances requises", async () => {
  const f = fixture();
  try {
    const serviceA = f.makeService();
    const serviceB = f.makeService(f.storeB);
    const prepared = f.prepare(serviceA);
    // dispatch n'est plus public (4C-1C) : resume est la seule entrée.
    assert.equal(serviceA.dispatch, undefined);
    await assert.rejects(() => serviceA.resume({
      approvalId: `approval_${"1".repeat(8)}-1111-1111-1111-${"1".repeat(12)}`,
      resumeToken: prepared.resumeToken,
    }), { code: "APPROVAL_NOT_FOUND" });
    await assert.rejects(() => serviceA.resume({
      approvalId: prepared.approval.id, resumeToken: "A".repeat(43),
    }), { code: "APPROVAL_TOKEN_INVALID" });
    await assert.rejects(() => serviceA.resume({}), { code: "APPROVAL_NOT_FOUND" });
    await assert.rejects(() => serviceA.resume({
      approvalId: prepared.approval.id, resumeToken: prepared.resumeToken, decision: "maybe",
    }), { code: "GOAL_MODE_DEV_DISPATCH_DECISION_INVALID" });
    // Même moteur d'approbation, autre instance de service : réservation inconnue.
    await assert.rejects(() => resume(serviceB, prepared),
      { code: "GOAL_MODE_DEV_DISPATCH_TICKET_UNKNOWN" });
    assert.equal(f.calls.length, 0);
    assert.equal(f.status(), "PREPARED");
    assert.equal(f.approvalRow(prepared.approval.id).status, "pending");
    assert.throws(() => createGoalModeDevDispatchService({}), TypeError);
    const { approvalEngine, ...withoutApprovals } = {
      runStore: f.storeA, goalStrategyEngine: f.goalStrategyEngine,
      devBudgetService: { effectiveRemaining: () => 1, taskProviderCalls: () => 0 },
      permissionSource: { current: () => ({}) }, dispatcher: f.dispatcher,
      approvalEngine: f.approvalEngine,
    };
    assert.ok(approvalEngine);
    assert.throws(() => createGoalModeDevDispatchService(withoutApprovals), TypeError);
  } finally { f.close(); }
});

test("4C-1B Goal en pause, archivé, non confirmé ou en nouvelle version : refus sans CAS", async () => {
  const f = fixture();
  try {
    const service = f.makeService();
    const prepared = f.prepare(service);
    const ticket = prepared.ticket;
    const changes = [
      { status: "PAUSED" }, { status: "ABANDONED" }, { status: "SUPERSEDED" },
      { status: "ACHIEVED" }, { status: "DRAFT" }, { version: 3 },
      { userConfirmed: false }, { goalId: "goal-other" },
    ];
    for (const change of changes) {
      const saved = { ...f.goal };
      Object.assign(f.goal, change);
      await assert.rejects(() => resume(service, prepared),
        { code: "GOAL_MODE_DEV_DISPATCH_GOAL_STALE" }, JSON.stringify(change));
      Object.assign(f.goal, saved);
    }
    assert.equal(f.calls.length, 0);
    assert.equal(f.status(), "PREPARED");
    assert.equal(f.latest().revision, ticket.reservedRevision);
    // Goal rétabli à l'identique : rien n'ayant été engagé, le dispatch passe.
    await resume(service, prepared);
    assert.equal(f.calls.length, 1);
  } finally { f.close(); }

  const g = fixture();
  try {
    let fail = false;
    const service = g.makeService(g.storeA, {
      goalStrategyEngine: {
        registry: {
          get: (goalId) => {
            if (fail) throw new Error("registry unavailable");
            return g.goalStrategyEngine.registry.get(goalId);
          },
        },
      },
    });
    const prepared = g.prepare(service);
    const ticket = prepared.ticket;
    fail = true;
    await assert.rejects(() => resume(service, prepared), { code: "GOAL_MODE_DEV_DISPATCH_GOAL_STALE" });
    assert.equal(g.calls.length, 0);
    assert.equal(g.status(), "PREPARED");
  } finally { g.close(); }
});

test("4C-1B chemins protégés : jamais ouverts ni hashés, leur modification ne déclenche pas TARGET_CHANGED", async () => {
  const f = fixture({ realRepository: true });
  const root = f.repositoryRoot;
  const write = (relative, content) => {
    const absolute = path.join(root, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    if (fs.existsSync(absolute)) fs.chmodSync(absolute, 0o600);
    fs.writeFileSync(absolute, content);
    fs.chmodSync(absolute, 0o000); // illisible : toute lecture ferait échouer l'empreinte
  };
  const protectedFiles = [
    "benchmark-workspaces/run-1/secret.txt",
    "dev-cost-ledger.json",
    "dev-task-journal/2026-11-20.md",
    ".env",
    "nested/node_modules/pkg/index.js",
    "local.sqlite",
    "nested/credentials.json",
  ];
  // Un fichier protégé suivi par Git, modifié ensuite : Git ne doit pas le relire.
  fs.mkdirSync(path.join(root, "config"));
  fs.writeFileSync(path.join(root, "config", "state.db"), "SYNTHETIC_DB_V1");
  git(root, "add", "config/state.db");
  git(root, "-c", "user.name=Synthetic", "-c", "user.email=synthetic@example.invalid",
    "-c", "commit.gpgsign=false", "commit", "-q", "-m", "tracked protected");
  fs.chmodSync(path.join(root, "config", "state.db"), 0o000);
  for (const relative of protectedFiles) write(relative, "SYNTHETIC_PROTECTED_V1");

  const accessed = [];
  let recording = false;
  const observed = async (action) => {
    recording = true;
    try { return await action(); } finally { recording = false; }
  };
  const spied = ["readFileSync", "lstatSync", "statSync", "readlinkSync", "openSync",
    "realpathSync", "readdirSync", "existsSync", "accessSync", "createReadStream"];
  const originals = Object.fromEntries(spied.map((name) => [name, fs[name]]));
  for (const name of spied) {
    fs[name] = function spy(target, ...rest) {
      if (recording && typeof target === "string" && target.startsWith(root)) accessed.push(target);
      return originals[name].call(this, target, ...rest);
    };
  }
  try {
    const service = f.makeService();
    const inspectNow = () => defaultGoalModeDevTargetInspector({ repositoryRoot: root, branch: "main" });
    const inspect = () => { recording = true; try { return inspectNow(); } finally { recording = false; } };
    const prepared = await observed(() => f.prepare(service));
    const baseline = inspect();

    for (const relative of protectedFiles) write(relative, "SYNTHETIC_PROTECTED_V2_LONGER");
    write("benchmark-workspaces/run-2/new.txt", "SYNTHETIC_NEW");
    write("dev-task-journal/2026-11-21.md", "SYNTHETIC_NEW");
    write(".env.local", "SYNTHETIC_NEW");
    write("config/state.db", "SYNTHETIC_DB_V2_LONGER");
    assert.equal(inspect(), baseline);

    // Contrôle : un fichier non protégé reste mesuré.
    fs.writeFileSync(path.join(root, "target.js"), "module.exports = 2;\n");
    assert.notEqual(inspect(), baseline);
    fs.writeFileSync(path.join(root, "target.js"), "module.exports = 1;\n");
    assert.equal(inspect(), baseline);

    await observed(() => resume(service, prepared));
    assert.equal(f.calls.length, 1);
    const leaked = accessed.filter((item) =>
      /benchmark-workspaces|dev-cost-ledger|dev-task-journal|\.env|node_modules|\.sqlite|credentials|state\.db/
        .test(item));
    assert.deepEqual(leaked, []);
    assert.ok(accessed.some((item) => item.endsWith("target.js")), "le spy observe bien les accès");
  } finally {
    for (const name of spied) fs[name] = originals[name];
    f.close();
  }
});

test("4C-1B filtre local des chemins protégés", () => {
  const { isProtectedGoalModeDevTargetPath: isProtected } =
    require("../services/goals/goal-mode-dev-dispatch-service");
  for (const relative of [
    "benchmark-workspaces", "benchmark-workspaces/", "benchmark-workspaces/a/b.txt",
    "dev-cost-ledger.json", "dev-task-journal/x.md", ".env", "sub/.env.local",
    "a/node_modules/b.js", "x.sqlite", "x.sqlite-wal", "db/app.db", "keys/server.pem",
    "credentials.json", "sub/token-google.json", "dist/app.js", "a/build/x", ".git/config",
  ]) assert.equal(isProtected(relative), true, relative);
  for (const relative of [
    "target.js", "src/dev-cost-ledger.json.md", "docs/benchmark.md", "services/env.js",
    "lib/database.js", "builder.js", "src/distance.js", "nested/benchmark-workspaces.js",
  ]) assert.equal(isProtected(relative), false, relative);
});

test("4C-1B pathspec Git : les chemins protégés ne sont pas inspectés par git status", () => {
  const { TARGET_STATUS_ARGS } = require("../services/goals/goal-mode-dev-dispatch-service");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noon-50d4c1b-git-"));
  try {
    const root = createRepository(directory);
    const files = [
      "benchmark-workspaces/run/x.txt", "dev-cost-ledger.json", "dev-task-journal/a.md",
      ".env", "sub/node_modules/p.js", "data.sqlite", "dist/app.js",
    ];
    for (const relative of files) {
      fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
      fs.writeFileSync(path.join(root, relative), "SYNTHETIC");
    }
    fs.writeFileSync(path.join(root, "visible.js"), "SYNTHETIC");
    const list = (args) => git(root, ...args).split("\0").filter(Boolean).map((item) => item.slice(3));
    const unfiltered = list(["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
    for (const relative of files) assert.ok(unfiltered.includes(relative), relative);
    assert.deepEqual(list(TARGET_STATUS_ARGS), ["visible.js"]);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("RELEASED × dispatch : aucune libération automatique, ticket invalidé, course à un seul gagnant", async () => {
  const f = fixture();
  try {
    const service = f.makeService();
    // 4C-1D ajoute pause/reprise/arrêt/statut ; toujours ni libération ni dispatch publics.
    // 4C-2 ajoute la réconciliation explicite et au démarrage (jamais de libération).
    assert.deepEqual(Object.keys(service).sort(), [
      "cancelExecution", "executionStatus", "pauseRun", "prepare", "reconcileAtStartup",
      "reconcileExecution", "renewApproval", "resume", "resumeRun", "stopRun",
    ]);
    assert.equal(Object.keys(service).some((key) => /release|dispatch/i.test(key)), false);
    const prepared = f.prepare(service);
    const ticket = prepared.ticket;
    f.live.network = false;
    await assert.rejects(() => resume(service, prepared),
      { code: "GOAL_MODE_DEV_DISPATCH_PERMISSION_REVOKED" });
    assert.equal(f.status(), "PREPARED"); // refus avant CAS : pas de libération implicite
    f.live.network = true;
    f.setTime("2026-10-13T12:00:03.000Z");
    f.storeB.releaseExecution(f.running.state.runId, {
      expectedRevision: ticket.reservedRevision, reservationId: ticket.reservationId,
    });
    assert.equal(f.status(), "RELEASED");
    await assert.rejects(() => resume(service, prepared),
      { code: "GOAL_MODE_DEV_DISPATCH_RESERVATION_CLOSED" });
    assert.equal(f.calls.length, 0);
  } finally { f.close(); }

  const g = fixture();
  try {
    const service = g.makeService();
    const prepared = g.prepare(service);
    const ticket = prepared.ticket;
    // Libération par une autre connexion pendant le recheck interne (3e mesure,
    // après pré-contrôle et préconditions) : le CAS du dispatch perd.
    g.setOnInspect(() => {
      g.storeB.releaseExecution(g.running.state.runId, {
        expectedRevision: ticket.reservedRevision, reservationId: ticket.reservationId,
      });
    }, 2);
    await assert.rejects(() => resume(service, prepared), { code: "GOAL_MODE_RUN_PERSISTENCE_CONFLICT" });
    assert.equal(g.calls.length, 0);
    assert.equal(g.status(), "RELEASED");
  } finally { g.close(); }

  const h = fixture();
  try {
    const service = h.makeService();
    const prepared = h.prepare(service);
    const ticket = prepared.ticket;
    await resume(service, prepared);
    assert.throws(() => h.storeB.releaseExecution(h.running.state.runId, {
      expectedRevision: ticket.reservedRevision, reservationId: ticket.reservationId,
    }), { code: "GOAL_MODE_RUN_PERSISTENCE_CONFLICT" });
    assert.throws(() => h.storeB.releaseExecution(h.running.state.runId, {
      expectedRevision: h.latest().revision, reservationId: ticket.reservationId,
    }), { code: "GOAL_MODE_EXECUTION_TRANSITION_INVALID" });
    assert.equal(h.status(), "MAY_HAVE_STARTED");
    assert.equal(h.calls.length, 1);
  } finally { h.close(); }
});

test("4C-1C approbation liée au contrat exact : identité, durée, affichage local", () => {
  const f = fixture();
  try {
    const service = f.makeService();
    const prepared = f.prepare(service);
    const { ticket, approval, display } = prepared;
    assert.equal(Object.isFrozen(prepared), true);
    assert.equal(approval.skillName, "goal_mode_dev");
    assert.equal(approval.operation, "dispatch_exact_contract");
    assert.equal(approval.target, ticket.taskId);
    assert.equal(approval.status, "pending");
    assert.equal(Object.hasOwn(approval, "resumeToken"), false);
    assert.match(prepared.resumeToken, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(Date.parse(approval.expiresAt) - Date.parse(approval.createdAt), 5 * 60_000);
    const exact = f.approvalEngine.getPreparedGoalModeDevDispatchExactAction({
      approvalId: approval.id, resumeToken: prepared.resumeToken,
    });
    assert.equal(exact.normalizedArgs.reservationId, ticket.reservationId);
    assert.equal(exact.normalizedArgs.reservedRevision, ticket.reservedRevision);
    assert.equal(exact.normalizedArgs.taskId, ticket.taskId);
    assert.equal(exact.normalizedArgs.targetFingerprint, FINGERPRINT);
    assert.match(exact.normalizedArgs.contractFingerprint, /^sha256:[0-9a-f]{64}$/);
    // Binding v2 : les règles projet approuvées sont liées par empreinte.
    assert.equal(exact.normalizedArgs.version, "goal-mode-dev-approval-binding-v2");
    assert.match(exact.normalizedArgs.rulesFingerprint, /^sha256:[0-9a-f]{64}$/);
    assert.deepEqual({ ...display, permissions: [...display.permissions], projectRules: [...display.projectRules] }, {
      goalTitle: "SYNTHETIC_GOAL_TITLE",
      instruction: "SYNTHETIC_PRIVATE_OBJECTIVE",
      repositoryRoot: f.repositoryRoot,
      branch: "main",
      permissions: ["READ_WRITE_WORKSPACE", "TERMINAL_SAFE", "NETWORK"],
      maxEstimatedCost: 0.4,
      maxProviderCalls: 2,
      maxDuration: 300_000,
      projectRules: ["SYNTHETIC_PROJECT_RULE"],
    });
    for (const value of ["SYNTHETIC_GOAL_TITLE", "SYNTHETIC_PRIVATE_OBJECTIVE", f.repositoryRoot,
      "READ_WRITE_WORKSPACE", "NETWORK", "0.4 USD", "Appels maximum : 2", "Durée maximale : 300 s", "Règles projet : 1"]) {
      assert.equal(approval.summary.includes(value), true, value);
    }
    // Rien de l'affichage n'est persisté : ni ligne d'approbation, ni audit, ni état du run.
    const persisted = JSON.stringify([f.approvalRow(approval.id), f.audit, f.latest().state]);
    for (const secret of ["SYNTHETIC_GOAL_TITLE", "SYNTHETIC_PRIVATE_OBJECTIVE", f.repositoryRoot]) {
      assert.equal(persisted.includes(secret), false, secret);
    }
  } finally { f.close(); }
});

test("4C-1C durée : 5 min plafonnées par l'échéance du run moins 1 s ; refus avant réservation", () => {
  const f = fixture();
  try {
    f.setTime("2026-10-13T12:07:00.000Z"); // échéance 12:10:00
    const prepared = f.prepare(f.makeService());
    assert.equal(prepared.approval.expiresAt, "2026-10-13T12:09:59.000Z");
  } finally { f.close(); }

  const g = fixture();
  try {
    g.setTime("2026-10-13T12:09:59.500Z");
    assert.throws(() => g.prepare(g.makeService()),
      { code: "GOAL_MODE_DEV_DISPATCH_TIME_BUDGET_BLOCKED" });
    assert.equal(g.latest().state.executionReservations, undefined);
  } finally { g.close(); }
});

test("4C-1C approbation d'un autre contrat ou d'une autre réservation : refus sans consommation ni CAS", async () => {
  for (const field of ["reservationId", "reservedRevision", "contractFingerprint",
    "targetFingerprint", "taskId", "goalVersion"]) {
    const f = fixture();
    try {
      // Moteur dont la lecture renverrait une action différente du contrat
      // remis : le service ne doit jamais l'accepter.
      const engine = f.approvalEngine;
      const tampered = {
        ...engine,
        getPreparedGoalModeDevDispatchExactAction(input) {
          const exact = engine.getPreparedGoalModeDevDispatchExactAction(input);
          const value = exact.normalizedArgs[field];
          return {
            ...exact,
            normalizedArgs: {
              ...exact.normalizedArgs,
              [field]: typeof value === "number" ? value + 1 : `${value}-other`,
            },
          };
        },
      };
      const service = f.makeService(f.storeA, { approvalEngine: tampered });
      const prepared = f.prepare(service);
      await assert.rejects(() => resume(service, prepared),
        { code: "GOAL_MODE_DEV_DISPATCH_APPROVAL_MISMATCH" }, field);
      assert.equal(f.approvalRow(prepared.approval.id).status, "pending");
      assert.equal(f.status(), "PREPARED");
      assert.equal(f.calls.length, 0);
    } finally { f.close(); }
  }
});

test("4C-1C changement entre pré-contrôle et préconditions : approval_stale, sans consommation ni CAS", async () => {
  const f = fixture();
  try {
    const service = f.makeService();
    const prepared = f.prepare(service);
    // 2e mesure = recheckPreconditions d'ApprovalEngine.
    f.setOnInspect(() => f.setTargetFingerprint(`sha256:${"d".repeat(64)}`), 1);
    await assert.rejects(() => resume(service, prepared), { code: "approval_stale" });
    assert.equal(f.approvalRow(prepared.approval.id).status, "failed");
    assert.equal(f.status(), "PREPARED");
    assert.equal(f.calls.length, 0);
    await assert.rejects(() => resume(service, prepared), { code: "APPROVAL_INVALID" });
  } finally { f.close(); }
});

test("4C-1C ordre : consommation durable avant le CAS, CAS avant le dispatcher", async () => {
  const f = fixture();
  try {
    const order = [];
    const observing = Object.freeze({
      ...f.storeA,
      markExecutionMayHaveStarted(...args) {
        order.push(["cas", f.approvalRow(prepared.approval.id).status]);
        return f.storeA.markExecutionMayHaveStarted(...args);
      },
    });
    f.dispatcher.behaviour = (payload) => {
      order.push(["dispatch", f.approvalRow(prepared.approval.id).status, f.status()]);
      return { taskId: payload.taskId };
    };
    const service = f.makeService(observing);
    const prepared = f.prepare(service);
    await resume(service, prepared);
    assert.deepEqual(order, [["cas", "consumed"], ["dispatch", "consumed", "MAY_HAVE_STARTED"]]);
    assert.ok(f.audit.some((item) => item.event === "approval.consumed" &&
      item.metadata.approvalId === prepared.approval.id && item.metadata.boundary === true));
  } finally { f.close(); }
});

test("4C-1C stockage indisponible à la consommation : ni CAS ni dispatch", async () => {
  const f = fixture();
  try {
    let casCalls = 0;
    const counting = Object.freeze({
      ...f.storeA,
      markExecutionMayHaveStarted(...args) { casCalls += 1; return f.storeA.markExecutionMayHaveStarted(...args); },
    });
    const failingRepository = {
      ...f.approvalRepository,
      save(record) {
        if (record.status === "consumed") throw new Error("SYNTHETIC_APPROVAL_STORAGE_FAILURE");
        return f.approvalRepository.save(record);
      },
    };
    const service = f.makeService(counting, { approvalEngine: f.makeEngine(failingRepository) });
    const prepared = f.prepare(service);
    await assert.rejects(() => resume(service, prepared), { code: "APPROVAL_STORAGE_ERROR" });
    assert.equal(casCalls, 0);
    assert.equal(f.calls.length, 0);
    assert.equal(f.status(), "PREPARED");
    assert.notEqual(f.approvalRow(prepared.approval.id).status, "consumed");
  } finally { f.close(); }
});

test("4C-1C CAS perdu après consommation : approbation brûlée, aucun rejeu", async () => {
  const f = fixture();
  try {
    const service = f.makeService();
    const prepared = f.prepare(service);
    const { ticket } = prepared;
    f.setOnInspect(() => {
      f.storeB.releaseExecution(f.running.state.runId, {
        expectedRevision: ticket.reservedRevision, reservationId: ticket.reservationId,
      });
    }, 2);
    await assert.rejects(() => resume(service, prepared), { code: "GOAL_MODE_RUN_PERSISTENCE_CONFLICT" });
    const row = f.approvalRow(prepared.approval.id);
    assert.equal(row.status, "consumed");
    assert.equal(row.failure_code, "GOAL_MODE_RUN_PERSISTENCE_CONFLICT");
    assert.equal(f.status(), "RELEASED");
    await assert.rejects(() => resume(service, prepared), { code: "APPROVAL_CONSUMED" });
    assert.throws(() => service.renewApproval({ reservationId: ticket.reservationId }),
      { code: "GOAL_MODE_DEV_DISPATCH_RENEW_UNAVAILABLE" });
    assert.equal(f.calls.length, 0);
  } finally { f.close(); }
});

test("4C-1C expiration, refus et renouvellement explicite audité ; ancien jeton inutilisable", async () => {
  const f = fixture();
  const events = [];
  try {
    const service = f.makeService(f.storeA, {
      observability: (event, metadata) => events.push({ event, metadata }),
    });
    const first = f.prepare(service);
    const reservationId = first.ticket.reservationId;
    // Expiration : refus, réservation intacte, aucune libération implicite.
    f.setEngineTime("2026-10-13T12:05:03.000Z");
    await assert.rejects(() => resume(service, first), { code: "approval_expired" });
    assert.equal(f.status(), "PREPARED");
    f.setEngineTime(null);
    // Renouvellement après expiration.
    const second = service.renewApproval({ reservationId });
    assert.notEqual(second.approval.id, first.approval.id);
    await assert.rejects(() => resume(service, first),
      (error) => ["approval_expired", "APPROVAL_INVALID"].includes(error.code));
    // Refus explicite : la réservation reste PREPARED, renouvellement possible.
    const rejected = await resume(service, second, "reject");
    assert.equal(rejected.status, "rejected");
    assert.equal(f.approvalRow(second.approval.id).status, "rejected");
    assert.equal(f.status(), "PREPARED");
    // Renouvellement pendant qu'une approbation est encore en attente.
    const third = service.renewApproval({ reservationId });
    const fourth = service.renewApproval({ reservationId });
    const superseded = f.approvalRow(third.approval.id);
    assert.equal(superseded.status, "cancelled");
    assert.equal(superseded.superseded_by, fourth.approval.id);
    await assert.rejects(() => resume(service, third), { code: "APPROVAL_INVALID" });
    assert.ok(f.audit.some((item) => item.event === "approval.cancelled" &&
      item.metadata.approvalId === third.approval.id &&
      item.metadata.supersededBy === fourth.approval.id));
    assert.deepEqual(events.map((item) => item.event), [
      "goal_mode_dev.approval_issued", "goal_mode_dev.approval_renewed",
      "goal_mode_dev.approval_renewed", "goal_mode_dev.approval_renewed",
    ]);
    assert.equal(JSON.stringify(events).includes("SYNTHETIC_PRIVATE_OBJECTIVE"), false);
    assert.equal(f.calls.length, 0);
    // Seule la dernière approbation ouvre le dispatch, une fois.
    await resume(service, fourth);
    assert.equal(f.calls.length, 1);
    assert.throws(() => service.renewApproval({ reservationId }),
      { code: "GOAL_MODE_DEV_DISPATCH_RENEW_UNAVAILABLE" });
    assert.throws(() => service.renewApproval({ reservationId: "goal-dev-execution-unknown" }),
      { code: "GOAL_MODE_DEV_DISPATCH_TICKET_UNKNOWN" });
  } finally { f.close(); }
});

test("4C-1C renouvellement refusé hors PREPARED (libérée par ailleurs)", () => {
  const f = fixture();
  try {
    const service = f.makeService();
    const prepared = f.prepare(service);
    f.setTime("2026-10-13T12:00:03.000Z");
    f.storeB.releaseExecution(f.running.state.runId, {
      expectedRevision: prepared.ticket.reservedRevision, reservationId: prepared.ticket.reservationId,
    });
    assert.throws(() => service.renewApproval({ reservationId: prepared.ticket.reservationId }),
      { code: "GOAL_MODE_DEV_DISPATCH_RENEW_UNAVAILABLE" });
    assert.equal(f.approvalRow(prepared.approval.id).status, "pending");
  } finally { f.close(); }
});

test("4C-1C redémarrage : approbation annulée, reprise impossible, libération explicite possible", async () => {
  const f = fixture();
  try {
    const service = f.makeService();
    const prepared = f.prepare(service);
    const reopenedDatabase = createPersonalDatabase(f.file);
    try {
      const engine = f.makeEngine(createApprovalRepository(reopenedDatabase));
      const row = createApprovalRepository(reopenedDatabase).get(prepared.approval.id);
      assert.equal(row.status, "cancelled");
      assert.equal(row.failure_code, "RESTART_RECONFIRMATION_REQUIRED");
      const reopenedStore = f.makeStore(createGoalModeRunRepository(reopenedDatabase));
      const restarted = f.makeService(reopenedStore, { approvalEngine: engine });
      await assert.rejects(() => resume(restarted, prepared), { code: "APPROVAL_NOT_FOUND" });
      assert.throws(() => restarted.renewApproval({ reservationId: prepared.ticket.reservationId }),
        { code: "GOAL_MODE_DEV_DISPATCH_TICKET_UNKNOWN" });
      assert.equal(f.status(), "PREPARED");
      f.setTime("2026-10-13T12:00:03.000Z");
      reopenedStore.releaseExecution(f.running.state.runId, {
        expectedRevision: prepared.ticket.reservedRevision,
        reservationId: prepared.ticket.reservationId,
      });
      assert.equal(f.status(), "RELEASED");
      assert.equal(f.calls.length, 0);
    } finally { reopenedDatabase.close(); }
  } finally { f.close(); }
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("4C-1D pause avec réservation PREPARED : approbation annulée, jamais dispatchable, même après reprise", async () => {
  const f = fixture();
  const events = [];
  try {
    const service = f.makeService(f.storeA, { observability: (event, metadata) => events.push({ event, metadata }) });
    const prepared = f.prepare(service);
    const { ticket } = prepared;
    const paused = service.pauseRun({
      runId: f.running.state.runId, expectedRevision: ticket.reservedRevision, reasonCode: "USER_PAUSE",
    });
    assert.equal(paused.status, "PAUSED");
    assert.equal(paused.revision, ticket.reservedRevision + 1);
    assert.deepEqual(paused.approvalsCancelled, [prepared.approval.id]);
    assert.deepEqual(paused.approvalCancelFailures, []);
    assert.equal(paused.release, null);
    assert.equal(f.latest().state.status, "PAUSED");
    assert.equal(f.status(), "PREPARED"); // aucune libération implicite
    assert.equal(f.approvalRow(prepared.approval.id).status, "cancelled");
    await assert.rejects(() => resume(service, prepared), { code: "APPROVAL_INVALID" });
    assert.throws(() => service.renewApproval({ reservationId: ticket.reservationId }),
      { code: "GOAL_MODE_DEV_DISPATCH_RENEW_UNAVAILABLE" });
    // Reprise : rien n'est réactivé, la réservation est signalée à libérer.
    const resumed = service.resumeRun({ runId: f.running.state.runId, expectedRevision: paused.revision });
    assert.equal(resumed.status, "RUNNING");
    assert.deepEqual(resumed.releaseRequired, [ticket.reservationId]);
    assert.deepEqual(resumed.reconciliationRequired, []);
    assert.throws(() => service.renewApproval({ reservationId: ticket.reservationId }),
      { code: "GOAL_MODE_DEV_DISPATCH_RENEW_UNAVAILABLE" });
    // Règle d'état 4C-0 : un départ direct est refusé après la transition.
    assert.throws(() => f.storeA.markExecutionMayHaveStarted(f.running.state.runId, {
      expectedRevision: resumed.revision, reservationId: ticket.reservationId,
    }), { code: "GOAL_MODE_EXECUTION_TRANSITION_INVALID" });
    assert.equal(f.calls.length, 0);
    // Sortie explicite : libération (ledger 0), puis nouveau step.
    f.setTime("2026-10-13T12:00:04.000Z");
    const released = f.storeA.releaseExecution(f.running.state.runId, {
      expectedRevision: resumed.revision, reservationId: ticket.reservationId,
    });
    assert.equal(f.status(), "RELEASED");
    const next = service.prepare(f.running.state.runId, {
      expectedRevision: released.revision, stepId: "step-next",
    });
    assert.notEqual(next.ticket.reservationId, ticket.reservationId);
    await resume(service, next);
    assert.equal(f.calls.length, 1);
    assert.ok(events.some((item) => item.event === "goal_mode_dev.run_halted" &&
      item.metadata.status === "PAUSED" && item.metadata.approvalsCancelled === 1));
    assert.equal(JSON.stringify(events).includes("SYNTHETIC_PRIVATE_OBJECTIVE"), false);
  } finally { f.close(); }
});

test("4C-1D annulation d'approbation en échec pendant la pause : rapportée, dispatch toujours impossible", async () => {
  const f = fixture();
  try {
    const failingEngine = {
      ...f.approvalEngine,
      cancel() { throw Object.assign(new Error("x"), { code: "SYNTHETIC_CANCEL_FAILURE" }); },
    };
    const service = f.makeService(f.storeA, { approvalEngine: failingEngine });
    const prepared = f.prepare(service);
    const paused = service.pauseRun({
      runId: f.running.state.runId, expectedRevision: prepared.ticket.reservedRevision,
    });
    assert.deepEqual(paused.approvalsCancelled, []);
    assert.deepEqual(paused.approvalCancelFailures,
      [{ approvalId: prepared.approval.id, code: "SYNTHETIC_CANCEL_FAILURE" }]);
    assert.equal(f.approvalRow(prepared.approval.id).status, "pending");
    await assert.rejects(() => resume(service, prepared), { code: "GOAL_MODE_DEV_DISPATCH_STALE" });
    const resumed = service.resumeRun({ runId: f.running.state.runId, expectedRevision: paused.revision });
    await assert.rejects(() => resume(service, prepared), { code: "GOAL_MODE_DEV_DISPATCH_STALE" });
    assert.equal(resumed.status, "RUNNING");
    assert.equal(f.status(), "PREPARED");
    assert.equal(f.calls.length, 0);
    assert.equal(f.approvalRow(prepared.approval.id).status, "pending");
  } finally { f.close(); }
});

test("4C-1D releasePrepared : libération explicite pendant la pause, auditée", () => {
  const f = fixture();
  const events = [];
  try {
    const service = f.makeService(f.storeA, { observability: (event, metadata) => events.push({ event, metadata }) });
    const prepared = f.prepare(service);
    f.setTime("2026-10-13T12:00:03.000Z");
    const paused = service.pauseRun({
      runId: f.running.state.runId, expectedRevision: prepared.ticket.reservedRevision,
      releasePrepared: true,
    });
    assert.deepEqual({ ...paused.release }, {
      requested: true, reservationId: prepared.ticket.reservationId, released: true, code: null,
    });
    assert.equal(paused.revision, prepared.ticket.reservedRevision + 2);
    assert.equal(f.latest().state.status, "PAUSED");
    assert.equal(f.status(), "RELEASED");
    assert.ok(events.some((item) => item.event === "goal_mode_dev.release_on_halt" &&
      item.metadata.released === true && item.metadata.reservationId === prepared.ticket.reservationId));
    // Par défaut, aucune libération.
    assert.throws(() => service.pauseRun({
      runId: f.running.state.runId, expectedRevision: paused.revision, releasePrepared: "yes",
    }), { code: "GOAL_MODE_DEV_RUN_TRANSITION_INVALID" });
  } finally { f.close(); }
});

test("4C-1D releasePrepared avec ledger non nul : la pause passe, la libération est refusée et rapportée", () => {
  const f = fixture();
  const events = [];
  try {
    const service = f.makeService(f.storeA, { observability: (event, metadata) => events.push({ event, metadata }) });
    const prepared = f.prepare(service);
    f.budget.calls = 1;
    f.setTime("2026-10-13T12:00:03.000Z");
    const paused = service.pauseRun({
      runId: f.running.state.runId, expectedRevision: prepared.ticket.reservedRevision,
      releasePrepared: true,
    });
    assert.equal(paused.status, "PAUSED");
    assert.equal(paused.revision, prepared.ticket.reservedRevision + 1);
    assert.deepEqual({ ...paused.release }, {
      requested: true, reservationId: prepared.ticket.reservationId, released: false,
      code: "GOAL_MODE_EXECUTION_RELEASE_LEDGER_ENGAGED",
    });
    assert.equal(f.latest().state.status, "PAUSED");
    assert.equal(f.status(), "PREPARED");
    const audit = events.find((item) => item.event === "goal_mode_dev.release_on_halt");
    assert.equal(audit.metadata.released, false);
    assert.equal(audit.metadata.code, "GOAL_MODE_EXECUTION_RELEASE_LEDGER_ENGAGED");
    // Sans réservation PREPARED : demande rapportée, pas d'erreur silencieuse.
    const resumed = service.resumeRun({ runId: f.running.state.runId, expectedRevision: paused.revision });
    f.budget.calls = 0;
    f.setTime("2026-10-13T12:00:04.000Z");
    const released = f.storeA.releaseExecution(f.running.state.runId, {
      expectedRevision: resumed.revision, reservationId: prepared.ticket.reservationId,
    });
    const again = service.pauseRun({
      runId: f.running.state.runId, expectedRevision: released.revision, releasePrepared: true,
    });
    assert.deepEqual({ ...again.release }, {
      requested: true, reservationId: null, released: false, code: "GOAL_MODE_DEV_NO_PREPARED_RESERVATION",
    });
  } finally { f.close(); }
});

test("4C-1D course pause / dispatch : la pause interposée avant le CAS empêche le dispatch", async () => {
  const f = fixture();
  try {
    const service = f.makeService();
    const prepared = f.prepare(service);
    const { ticket } = prepared;
    const other = f.makeService(f.storeB);
    f.setOnInspect(() => {
      other.pauseRun({ runId: f.running.state.runId, expectedRevision: ticket.reservedRevision });
    }, 2);
    await assert.rejects(() => resume(service, prepared), { code: "GOAL_MODE_RUN_PERSISTENCE_CONFLICT" });
    assert.equal(f.calls.length, 0);
    assert.equal(f.latest().state.status, "PAUSED");
    assert.equal(f.status(), "PREPARED");
  } finally { f.close(); }
});

test("4C-1D pause avec MAY_HAVE_STARTED : DEV n'est pas annulé, aucune nouvelle réservation", async () => {
  const f = fixture();
  try {
    const gate = deferred();
    f.dispatcher.behaviour = (payload) => gate.promise.then(() => ({ taskId: payload.taskId }));
    const service = f.makeService();
    const prepared = f.prepare(service);
    const running = resume(service, prepared);
    await new Promise((done) => setImmediate(done));
    assert.equal(f.calls.length, 1);
    assert.equal(f.status(), "MAY_HAVE_STARTED");
    const paused = service.pauseRun({
      runId: f.running.state.runId, expectedRevision: f.latest().revision,
    });
    assert.equal(paused.status, "PAUSED");
    assert.deepEqual(f.cancels, []); // la pause n'arrête pas DEV
    assert.equal(f.status(), "MAY_HAVE_STARTED");
    const resumed = service.resumeRun({ runId: f.running.state.runId, expectedRevision: paused.revision });
    assert.deepEqual(resumed.reconciliationRequired, [prepared.ticket.reservationId]);
    assert.throws(() => service.prepare(f.running.state.runId, {
      expectedRevision: resumed.revision, stepId: "step-other",
    }), { code: "GOAL_MODE_EXECUTION_IN_FLIGHT" });
    gate.resolve();
    const result = await running;
    assert.equal(result.reservationId, prepared.ticket.reservationId);
    assert.equal(f.status(), "MAY_HAVE_STARTED");
  } finally { f.close(); }
});

test("4C-1D BLOCKED et CANCELLED traités comme la pause ; reprise seulement depuis PAUSED ou BLOCKED", async () => {
  for (const status of ["BLOCKED", "CANCELLED"]) {
    const f = fixture();
    try {
      const service = f.makeService();
      const prepared = f.prepare(service);
      const halted = service.stopRun({
        runId: f.running.state.runId, expectedRevision: prepared.ticket.reservedRevision, status,
      });
      assert.equal(halted.status, status);
      assert.deepEqual(halted.approvalsCancelled, [prepared.approval.id]);
      assert.equal(f.status(), "PREPARED");
      await assert.rejects(() => resume(service, prepared), { code: "APPROVAL_INVALID" });
      if (status === "BLOCKED") {
        const resumed = service.resumeRun({ runId: f.running.state.runId, expectedRevision: halted.revision });
        assert.deepEqual(resumed.releaseRequired, [prepared.ticket.reservationId]);
      } else {
        assert.throws(() => service.resumeRun({ runId: f.running.state.runId, expectedRevision: halted.revision }),
          { code: "GOAL_MODE_DEV_RUN_NOT_PAUSED" });
      }
      assert.equal(f.calls.length, 0);
    } finally { f.close(); }
  }
  const g = fixture();
  try {
    const service = g.makeService();
    assert.throws(() => service.stopRun({ runId: g.running.state.runId, expectedRevision: g.running.revision, status: "PAUSED" }),
      { code: "GOAL_MODE_DEV_RUN_TRANSITION_INVALID" });
    assert.throws(() => service.resumeRun({ runId: g.running.state.runId, expectedRevision: g.running.revision }),
      { code: "GOAL_MODE_DEV_RUN_NOT_PAUSED" });
    assert.throws(() => service.pauseRun({ runId: g.running.state.runId, expectedRevision: g.running.revision - 1 }),
      { code: "GOAL_MODE_RUN_PERSISTENCE_CONFLICT" });
  } finally { g.close(); }
});

test("4C-1D l'échéance court pendant la pause : prepare et renouvellement refusés ensuite", () => {
  const f = fixture();
  try {
    const service = f.makeService();
    const prepared = f.prepare(service);
    const paused = service.pauseRun({ runId: f.running.state.runId, expectedRevision: prepared.ticket.reservedRevision });
    f.setTime("2026-10-13T12:09:59.500Z");
    const resumed = service.resumeRun({ runId: f.running.state.runId, expectedRevision: paused.revision });
    f.storeA.releaseExecution(f.running.state.runId, {
      expectedRevision: resumed.revision, reservationId: prepared.ticket.reservationId,
    });
    assert.throws(() => service.prepare(f.running.state.runId, {
      expectedRevision: f.latest().revision, stepId: "step-late",
    }), { code: "GOAL_MODE_DEV_DISPATCH_TIME_BUDGET_BLOCKED" });
  } finally { f.close(); }
});

test("4C-1D cancelExecution : arrêt demandé une fois, statut inchangé, issue incertaine", async () => {
  const f = fixture();
  const events = [];
  try {
    const gate = deferred();
    f.dispatcher.behaviour = () => gate.promise.then(() => {
      throw Object.assign(new Error("aborted"), { code: "CANCELLED" });
    });
    const service = f.makeService(f.storeA, { observability: (event, metadata) => events.push({ event, metadata }) });
    const prepared = f.prepare(service);
    const { ticket } = prepared;
    const runId = f.running.state.runId;
    assert.throws(() => service.cancelExecution({ runId, reservationId: ticket.reservationId }),
      (error) => error.code === "GOAL_MODE_DEV_CANCEL_UNAVAILABLE" && error.details.status === "PREPARED");
    const running = resume(service, prepared);
    await new Promise((done) => setImmediate(done));
    const first = service.cancelExecution({ runId, reservationId: ticket.reservationId });
    assert.equal(first.cancelRequested, true);
    assert.equal(first.alreadyRequested, false);
    assert.equal(first.nativeCancelled, true);
    assert.equal(first.reservationStatus, "MAY_HAVE_STARTED");
    assert.equal(first.reconciliationRequired, true);
    assert.deepEqual(f.cancels, [ticket.taskId]);
    const second = service.cancelExecution({ runId, reservationId: ticket.reservationId });
    assert.equal(second.alreadyRequested, true);
    assert.deepEqual(f.cancels, [ticket.taskId]);
    assert.equal(f.status(), "MAY_HAVE_STARTED");
    gate.resolve();
    await assert.rejects(() => running, { code: "GOAL_MODE_DEV_DISPATCH_OUTCOME_UNCERTAIN" });
    assert.equal(f.status(), "MAY_HAVE_STARTED"); // seule la réconciliation tranchera
    assert.ok(events.some((item) => item.event === "goal_mode_dev.execution_cancel_requested"));
    // Instance inconnue ou mauvais run : refus.
    const other = f.makeService(f.storeB);
    assert.throws(() => other.cancelExecution({ runId, reservationId: ticket.reservationId }),
      { code: "GOAL_MODE_DEV_DISPATCH_TICKET_UNKNOWN" });
    assert.throws(() => service.cancelExecution({ runId: "goal-run-other", reservationId: ticket.reservationId }),
      { code: "GOAL_MODE_DEV_DISPATCH_TICKET_UNKNOWN" });
  } finally { f.close(); }
});

test("4C-1D cancelExecution refusé pour RELEASED et UNKNOWN ; échec natif rapporté puis réessayable", async () => {
  const f = fixture();
  try {
    const service = f.makeService();
    const prepared = f.prepare(service);
    f.setTime("2026-10-13T12:00:03.000Z");
    f.storeA.releaseExecution(f.running.state.runId, {
      expectedRevision: prepared.ticket.reservedRevision, reservationId: prepared.ticket.reservationId,
    });
    assert.throws(() => service.cancelExecution({
      runId: f.running.state.runId, reservationId: prepared.ticket.reservationId,
    }), (error) => error.code === "GOAL_MODE_DEV_CANCEL_UNAVAILABLE" && error.details.status === "RELEASED");
  } finally { f.close(); }

  const g = fixture();
  try {
    const gate = deferred();
    g.dispatcher.behaviour = () => gate.promise;
    const service = g.makeService();
    const prepared = g.prepare(service);
    const running = resume(service, prepared);
    await new Promise((done) => setImmediate(done));
    g.dispatcher.cancelBehaviour = () => { throw Object.assign(new Error("x"), { code: "NATIVE_CANCEL_FAILED" }); };
    assert.throws(() => service.cancelExecution({
      runId: g.running.state.runId, reservationId: prepared.ticket.reservationId,
    }), (error) => error.code === "GOAL_MODE_DEV_CANCEL_FAILED" && error.details.causeCode === "NATIVE_CANCEL_FAILED");
    g.dispatcher.cancelBehaviour = null;
    const retried = service.cancelExecution({
      runId: g.running.state.runId, reservationId: prepared.ticket.reservationId,
    });
    assert.equal(retried.alreadyRequested, false);
    assert.equal(g.cancels.length, 2);
    // UNKNOWN : plus rien à arrêter.
    g.storeA.markExecutionUnknown(g.running.state.runId, {
      expectedRevision: g.latest().revision, reservationId: prepared.ticket.reservationId,
    });
    gate.resolve({ taskId: prepared.ticket.taskId });
    await running;
    const late = g.makeService();
    assert.throws(() => late.cancelExecution({
      runId: g.running.state.runId, reservationId: prepared.ticket.reservationId,
    }), { code: "GOAL_MODE_DEV_DISPATCH_TICKET_UNKNOWN" });
    assert.equal(g.status(), "UNKNOWN");
  } finally { g.close(); }
});

test("4C-1D executionStatus : projection minimale, sans donnée privée", async () => {
  const f = fixture();
  try {
    const service = f.makeService();
    const prepared = f.prepare(service);
    const runId = f.running.state.runId;
    const before = service.executionStatus({ runId, reservationId: prepared.ticket.reservationId });
    assert.deepEqual({ ...before }, {
      runId, runStatus: "RUNNING", runRevision: prepared.ticket.reservedRevision,
      reservationId: prepared.ticket.reservationId, reservationStatus: "PREPARED",
      dispatchedByThisInstance: false, cancelRequested: false, native: null,
      observation: null, // pas de lecteur d'observation dans ce fixture
    });
    const gate = deferred();
    f.dispatcher.behaviour = () => gate.promise;
    const running = resume(service, prepared);
    await new Promise((done) => setImmediate(done));
    const during = service.executionStatus({ runId, reservationId: prepared.ticket.reservationId });
    assert.equal(during.reservationStatus, "MAY_HAVE_STARTED");
    assert.equal(during.dispatchedByThisInstance, true);
    assert.deepEqual({ ...during.native }, { status: "RUNNING", finalVerdict: null, failureCategory: null });
    const serialized = JSON.stringify(during);
    assert.equal(serialized.includes("SYNTHETIC_PRIVATE_OBJECTIVE"), false);
    assert.equal(serialized.includes(f.repositoryRoot), false);
    assert.throws(() => service.executionStatus({ runId, reservationId: "goal-dev-execution-missing" }),
      { code: "GOAL_MODE_DEV_DISPATCH_RESERVATION_MISSING" });
    gate.resolve({ taskId: prepared.ticket.taskId });
    await running;
  } finally { f.close(); }
});

test("journal fiable : dispatch refusé si le journal connaît la tâche ou est illisible, approbation intacte", async () => {
  for (const [state, code] of [
    ["PRESENT", "GOAL_MODE_DEV_DISPATCH_RECONCILIATION_REQUIRED"],
    ["UNREADABLE", "GOAL_MODE_DEV_DISPATCH_JOURNAL_UNREADABLE"],
    ["THROW", "GOAL_MODE_DEV_DISPATCH_JOURNAL_UNREADABLE"],
  ]) {
    const f = fixture();
    try {
      const service = f.makeService();
      const prepared = f.prepare(service);
      f.journalStates.set(prepared.ticket.taskId, state);
      await assert.rejects(() => resume(service, prepared), { code }, state);
      assert.equal(f.approvalRow(prepared.approval.id).status, "pending", state);
      assert.equal(f.status(), "PREPARED", state);
      assert.equal(f.calls.length, 0, state);
    } finally { f.close(); }
  }
});

test("journal fiable : trace apparue entre pré-contrôle et recheck interne → refus avant consommation et CAS", async () => {
  const f = fixture();
  try {
    const service = f.makeService();
    const prepared = f.prepare(service);
    // 2e mesure = préconditions d'ApprovalEngine, entre pré-contrôle et execute.
    f.setOnInspect(() => f.journalStates.set(prepared.ticket.taskId, "PRESENT"), 1);
    await assert.rejects(() => resume(service, prepared),
      { code: "GOAL_MODE_DEV_DISPATCH_RECONCILIATION_REQUIRED" });
    assert.equal(f.approvalRow(prepared.approval.id).status, "failed");
    assert.equal(f.status(), "PREPARED");
    assert.equal(f.calls.length, 0);
  } finally { f.close(); }
});

test("journal fiable : prepare refusé dès la réservation si le journal connaît déjà la tâche", () => {
  for (const [state, code] of [
    ["PRESENT", "GOAL_MODE_EXECUTION_JOURNAL_ENGAGED"],
    ["UNREADABLE", "GOAL_MODE_EXECUTION_JOURNAL_UNREADABLE"],
  ]) {
    const f = fixture();
    try {
      const taskId = deterministicGoalModeDevTaskId(
        f.running.state.runId, "step-dispatch", `sha256:${"a".repeat(64)}`
      );
      f.journalStates.set(taskId, state);
      assert.throws(() => f.prepare(f.makeService()), { code }, state);
      assert.equal(f.latest().state.executionReservations, undefined, state);
      assert.equal(f.latest().revision, f.running.revision, state);
    } finally { f.close(); }
  }
  const g = fixture();
  try {
    const { devTaskJournal, ...withoutJournal } = {
      runStore: g.storeA, goalStrategyEngine: g.goalStrategyEngine,
      devBudgetService: { effectiveRemaining: () => 1, taskProviderCalls: () => 0 },
      permissionSource: { current: () => ({}) }, dispatcher: g.dispatcher,
      approvalEngine: g.approvalEngine, devTaskJournal: g.devTaskJournal,
    };
    assert.ok(devTaskJournal);
    assert.throws(() => createGoalModeDevDispatchService(withoutJournal), TypeError);
  } finally { g.close(); }
});

test("journal fiable : intégration façade réelle — CAS avant l'enregistrement de démarrage", async () => {
  const f = fixture();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noon-goal-journal-"));
  try {
    const journal = createDevTaskJournal({ directory });
    const seen = [];
    const facade = createNativeDevOrchestratorFacade({
      journal,
      featureMode: () => "LIMITED",
      orchestrator: {
        async runTask(input) {
          seen.push({
            reservation: f.status(),
            journal: journal.lookup(input.taskId).record?.state,
          });
          return {
            taskId: input.taskId, status: "COMPLETED", finalVerdict: "PASS", failureCategory: null,
            startedAt: "2026-10-13T12:00:03.000Z", endedAt: "2026-10-13T12:00:04.000Z",
            implementation: { backendReached: true, providerCalls: [], validations: [] },
            review: { finalVerdict: "PASS", changedFiles: [], validations: [] },
          };
        },
        getTaskStatus() { return null; },
        cancelTask() { return { cancelled: false }; },
      },
    });
    const service = f.makeService(f.storeA, { dispatcher: facade, devTaskJournal: journal });
    const prepared = f.prepare(service);
    assert.equal(journal.lookup(prepared.ticket.taskId).status, "ABSENT");
    await resume(service, prepared);
    assert.deepEqual(seen, [{ reservation: "MAY_HAVE_STARTED", journal: "CLAIMED" }]);
    assert.equal(journal.load(prepared.ticket.taskId).state, "PASS");
    assert.equal(f.status(), "MAY_HAVE_STARTED");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
    f.close();
  }
});

test("journal fiable : crash entre CAS et façade → MAY_HAVE_STARTED avec journal ABSENT (preuve pour 4C-2)", async () => {
  const f = fixture();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noon-goal-journal-"));
  try {
    const journal = createDevTaskJournal({ directory });
    let facadeCalls = 0;
    const facade = { async runTask() { facadeCalls += 1; } };
    const crashing = Object.freeze({
      ...f.storeA,
      markExecutionMayHaveStarted(...args) {
        f.storeA.markExecutionMayHaveStarted(...args);
        throw Object.assign(new Error("synthetic crash"), { code: "SYNTHETIC_CRASH" });
      },
    });
    const service = f.makeService(crashing, { dispatcher: facade, devTaskJournal: journal });
    const prepared = f.prepare(service);
    await assert.rejects(() => resume(service, prepared), { code: "SYNTHETIC_CRASH" });
    assert.equal(facadeCalls, 0);
    assert.equal(f.status(), "MAY_HAVE_STARTED");
    assert.equal(createDevTaskJournal({ directory }).lookup(prepared.ticket.taskId).status, "ABSENT");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
    f.close();
  }
});

test("B1 règles projet : résolues au prepare, liées au binding v2, envoyées à l'identique", async () => {
  const { rulesFingerprint } = require("../services/goals/goal-mode-dev-approval-action");
  const f = fixture();
  try {
    f.rules.list = ["Ne jamais pousser automatiquement.", "Préserver la structure."];
    const service = f.makeService();
    const prepared = f.prepare(service);
    assert.deepEqual({ ...f.rules.lastInput, constraints: [...f.rules.lastInput.constraints] },
      { workspaceId: "workspace-1", projectId: "project-1", constraints: [] });
    const exact = f.approvalEngine.getPreparedGoalModeDevDispatchExactAction({
      approvalId: prepared.approval.id, resumeToken: prepared.resumeToken,
    });
    assert.equal(exact.normalizedArgs.rulesFingerprint, rulesFingerprint(f.rules.list));
    assert.deepEqual([...prepared.display.projectRules], f.rules.list);
    await resume(service, prepared);
    assert.deepEqual(f.calls[0].payload.projectInstructions, f.rules.list);
    f.calls[0].payload.projectInstructions.push("forged");
    assert.deepEqual([...prepared.display.projectRules], ["Ne jamais pousser automatiquement.", "Préserver la structure."]);
    // Rien des règles n'est persisté (approbation, audit, état du run).
    const persisted = JSON.stringify([f.approvalRow(prepared.approval.id), f.audit, f.latest().state]);
    assert.equal(persisted.includes("Ne jamais pousser"), false);
  } finally { f.close(); }
});

test("B1 règles modifiées après l'approbation : RULES_CHANGED au pré-contrôle, approbation intacte, sans CAS", async () => {
  const f = fixture();
  try {
    const service = f.makeService();
    const prepared = f.prepare(service);
    f.rules.list = ["SYNTHETIC_PROJECT_RULE", "NEW_RULE"];
    await assert.rejects(() => resume(service, prepared), { code: "GOAL_MODE_DEV_DISPATCH_RULES_CHANGED" });
    assert.equal(f.approvalRow(prepared.approval.id).status, "pending");
    assert.equal(f.status(), "PREPARED");
    assert.equal(f.calls.length, 0);
    f.rules.list = ["SYNTHETIC_PROJECT_RULE"];
    f.rules.throws = true;
    await assert.rejects(() => resume(service, prepared), { code: "GOAL_MODE_DEV_DISPATCH_RULES_UNAVAILABLE" });
    assert.equal(f.status(), "PREPARED");
    // Règles rétablies à l'identique : la même approbation reste utilisable.
    f.rules.throws = false;
    await resume(service, prepared);
    assert.equal(f.calls.length, 1);
  } finally { f.close(); }
});

test("B1 règles modifiées entre préconditions et recheck interne : refus avant consommation et CAS", async () => {
  const f = fixture();
  try {
    const service = f.makeService();
    const prepared = f.prepare(service);
    const base = f.rules.calls;
    // Appels : pré-contrôle (+1), préconditions (+2), recheck interne (+3).
    f.rules.onResolve = (calls) => {
      if (calls === base + 3) f.rules.list = ["CHANGED_BEFORE_CAS"];
    };
    await assert.rejects(() => resume(service, prepared), { code: "GOAL_MODE_DEV_DISPATCH_RULES_CHANGED" });
    assert.equal(f.approvalRow(prepared.approval.id).status, "failed");
    assert.equal(f.status(), "PREPARED");
    assert.equal(f.calls.length, 0);
  } finally { f.close(); }

  const g = fixture();
  try {
    const service = g.makeService();
    const prepared = g.prepare(service);
    const base = g.rules.calls;
    // Changement visible dès les préconditions : approval_stale.
    g.rules.onResolve = (calls) => {
      if (calls === base + 2) g.rules.list = ["CHANGED_AT_PRECONDITIONS"];
    };
    await assert.rejects(() => resume(service, prepared), { code: "approval_stale" });
    assert.equal(g.status(), "PREPARED");
    assert.equal(g.calls.length, 0);
  } finally { g.close(); }
});

test("B1 règles indisponibles ou invalides au prepare : réservation à libérer, aucune approbation", () => {
  for (const setup of [
    (f) => { f.rules.throws = true; },
    (f) => { f.rules.list = [42]; },
    (f) => { f.rules.list = ["  "]; },
    (f) => { f.rules.list = Array.from({ length: 21 }, (_, index) => `rule-${index}`); },
    (f) => { f.rules.list = ["x".repeat(2_001)]; },
  ]) {
    const f = fixture();
    try {
      setup(f);
      assert.throws(() => f.prepare(f.makeService()), (error) =>
        error.code === "GOAL_MODE_DEV_DISPATCH_RULES_UNAVAILABLE" && error.details.releaseRequired === true);
      assert.equal(f.status(), "PREPARED");
      assert.equal(f.audit.some((item) => item.event === "approval.created"), false);
    } finally { f.close(); }
  }
});
