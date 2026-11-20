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
            maxEstimatedCost: 0.4, maxProviderCalls: 2,
            localOnly: false, permissions: ["READ_WRITE_WORKSPACE", "TERMINAL_SAFE"],
          },
        },
      };
    },
  };
  const makeStore = (repository) => createGoalModeRunStore({
    repository, now: () => clock, devProjectionService: projectionService,
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
  const dispatcher = {
    behaviour: null,
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
  const goal = { goalId: "goal-dispatch", status: "ACTIVE", userConfirmed: true, version: 2 };
  const goalStrategyEngine = { registry: { get: (goalId) => (goalId === goal.goalId ? { ...goal } : null) } };
  const syntheticInspector = () => {
    const callback = onInspect;
    onInspect = null;
    callback?.();
    return targetFingerprint;
  };
  const makeService = (store = storeA, overrides = {}) => createGoalModeDevDispatchService({
    runStore: store, goalStrategyEngine, devBudgetService, permissionSource, dispatcher,
    targetInspector: realRepository ? defaultGoalModeDevTargetInspector : syntheticInspector,
    now: () => new Date(clock),
    ...overrides,
  });
  return {
    file, directory, repositoryRoot, repositoryA, repositoryB, storeA, storeB, running,
    budget, live, goal, goalStrategyEngine, calls, dispatcher, makeStore, makeService,
    prepare(service) {
      return service.prepare(running.state.runId, {
        expectedRevision: storeA.get(running.state.runId).revision, stepId: "step-dispatch",
      });
    },
    latest() { return repositoryB.latest(running.state.runId); },
    status() { return repositoryB.latest(running.state.runId).state.executionReservations?.at(-1)?.status; },
    setTime(value) { clock = value; },
    setTargetFingerprint(value) { targetFingerprint = value; },
    setOnInspect(value) { onInspect = value; },
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
    const ticket = f.prepare(service);
    assert.equal(Object.isFrozen(ticket), true);
    assert.equal(JSON.stringify(ticket).includes("SYNTHETIC_PRIVATE_OBJECTIVE"), false);
    assert.equal(f.status(), "PREPARED");
    f.live.gitWrite = true; // un état vivant plus large n'élève rien
    f.live.destructiveActions = true;
    const result = await service.dispatch(ticket);
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
    assert.deepEqual(result.authority, { capabilitiesGranted: false, approvalGranted: false });
    assert.equal(f.status(), "MAY_HAVE_STARTED");
    await assert.rejects(() => service.dispatch(ticket),
      { code: "GOAL_MODE_DEV_DISPATCH_ALREADY_ATTEMPTED" });
    assert.equal(f.calls.length, 1);
    assert.equal(JSON.stringify(f.latest().state).includes("SYNTHETIC_PRIVATE_OBJECTIVE"), false);
  } finally { f.close(); }
});

test("4C-1B double appel concurrent : un seul dispatch, même ticket ou autre connexion", async () => {
  const f = fixture();
  try {
    const service = f.makeService();
    const ticket = f.prepare(service);
    const outcomes = await Promise.allSettled([service.dispatch(ticket), service.dispatch(ticket)]);
    assert.deepEqual(outcomes.map((item) => item.status).sort(), ["fulfilled", "rejected"]);
    assert.equal(outcomes.find((item) => item.status === "rejected").reason.code,
      "GOAL_MODE_DEV_DISPATCH_ALREADY_ATTEMPTED");
    assert.equal(f.calls.length, 1);
  } finally { f.close(); }

  const g = fixture();
  try {
    const service = g.makeService();
    const ticket = g.prepare(service);
    // Une autre connexion franchit la frontière pendant le recheck de A
    // (après la lecture du statut, avant le CAS) : le CAS de A doit perdre.
    let interposed = false;
    g.setOnInspect(() => {
      interposed = true;
      g.storeB.markExecutionMayHaveStarted(g.running.state.runId, {
        expectedRevision: ticket.reservedRevision, reservationId: ticket.reservationId,
      });
    });
    await assert.rejects(() => service.dispatch(ticket), { code: "GOAL_MODE_RUN_PERSISTENCE_CONFLICT" });
    assert.equal(interposed, true);
    assert.equal(g.calls.length, 0);
    assert.equal(g.status(), "MAY_HAVE_STARTED");
    assert.equal(g.latest().revision, ticket.reservedRevision + 1);
    await assert.rejects(() => service.dispatch(ticket),
      { code: "GOAL_MODE_DEV_DISPATCH_ALREADY_ATTEMPTED" });
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
    const ticket = f.prepare(service);
    await assert.rejects(() => service.dispatch(ticket), { code: "SYNTHETIC_CRASH" });
    assert.equal(f.calls.length, 0);
    assert.equal(f.status(), "MAY_HAVE_STARTED");
    await assert.rejects(() => service.dispatch(ticket),
      { code: "GOAL_MODE_DEV_DISPATCH_ALREADY_ATTEMPTED" });

    const reopenedDatabase = createPersonalDatabase(f.file);
    try {
      const reopenedStore = f.makeStore(createGoalModeRunRepository(reopenedDatabase));
      const restarted = f.makeService(reopenedStore);
      await assert.rejects(() => restarted.dispatch(ticket),
        { code: "GOAL_MODE_DEV_DISPATCH_TICKET_UNKNOWN" });
      await assert.rejects(() => restarted.dispatch({ ...ticket }),
        { code: "GOAL_MODE_DEV_DISPATCH_TICKET_UNKNOWN" });
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
      const ticket = f.prepare(service);
      let snapshot = f.storeB.markExecutionMayHaveStarted(f.running.state.runId, {
        expectedRevision: ticket.reservedRevision, reservationId: ticket.reservationId,
      });
      if (finalStatus === "UNKNOWN") {
        snapshot = f.storeB.markExecutionUnknown(f.running.state.runId, {
          expectedRevision: snapshot.revision, reservationId: ticket.reservationId,
        });
      }
      await assert.rejects(() => service.dispatch(ticket), (error) => {
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
    const ticket = f.prepare(service);
    f.budget.remaining = 0.39;
    await assert.rejects(() => service.dispatch(ticket),
      { code: "GOAL_MODE_DEV_DISPATCH_BUDGET_EXHAUSTED" });
    f.budget.remaining = Number.NaN;
    await assert.rejects(() => service.dispatch(ticket),
      { code: "GOAL_MODE_DEV_DISPATCH_BUDGET_EXHAUSTED" });
    f.budget.remaining = 10;
    f.budget.calls = 1;
    await assert.rejects(() => service.dispatch(ticket),
      { code: "GOAL_MODE_DEV_DISPATCH_RECONCILIATION_REQUIRED" });
    f.budget.calls = 0;
    f.setTime("2026-10-13T12:09:59.500Z"); // < 1 s avant l'échéance du run
    await assert.rejects(() => service.dispatch(ticket),
      { code: "GOAL_MODE_DEV_DISPATCH_TIME_BUDGET_BLOCKED" });
    assert.equal(f.calls.length, 0);
    assert.equal(f.status(), "PREPARED");
    assert.equal(f.latest().revision, ticket.reservedRevision);
    // Rien n'ayant été engagé, le même ticket reste dispatchable une fois rétabli.
    f.setTime("2026-10-13T12:00:03.000Z");
    await service.dispatch(ticket);
    assert.equal(f.calls.length, 1);
  } finally { f.close(); }
});

test("4C-1B permission retirée ou contrat élargi : refus sans CAS ni dispatch", async () => {
  const f = fixture();
  try {
    const service = f.makeService();
    const ticket = f.prepare(service);
    f.live.network = false;
    await assert.rejects(() => service.dispatch(ticket),
      { code: "GOAL_MODE_DEV_DISPATCH_PERMISSION_REVOKED" });
    f.live.network = true;
    f.live.repositoryWrite = false;
    await assert.rejects(() => service.dispatch(ticket),
      { code: "GOAL_MODE_DEV_DISPATCH_PERMISSION_REVOKED" });
    f.live.repositoryWrite = "yes"; // seule la valeur true compte
    await assert.rejects(() => service.dispatch(ticket),
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
      const ticket = g.prepare(service);
      await assert.rejects(() => service.dispatch(ticket),
        { code: "GOAL_MODE_DEV_DISPATCH_PERMISSION_ESCALATION" });
      assert.equal(g.calls.length, 0);
      assert.equal(g.status(), "PREPARED");
    } finally { g.close(); }
  }
});

test("4C-1B fichier cible modifié après préparation : refus sans CAS (repository Git réel)", async () => {
  const f = fixture({ realRepository: true });
  try {
    // Fichier suivi propre modifié ; la réservation refusée sort par UNKNOWN.
    const service = f.makeService();
    const ticket = f.prepare(service);
    fs.writeFileSync(path.join(f.repositoryRoot, "target.js"), "module.exports = 2;\n");
    await assert.rejects(() => service.dispatch(ticket),
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
      const ticket = g.prepare(service);
      mutate(g.repositoryRoot);
      await assert.rejects(() => service.dispatch(ticket),
        { code: "GOAL_MODE_DEV_DISPATCH_TARGET_CHANGED" });
      assert.equal(g.calls.length, 0);
      assert.equal(g.status(), "PREPARED");
    } finally { g.close(); }
  }

  const h = fixture({ realRepository: true });
  try {
    const service = h.makeService();
    const ticket = h.prepare(service);
    await service.dispatch(ticket); // cible inchangée : dispatch autorisé
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
    const ticket = f.prepare(service);
    await assert.rejects(() => service.dispatch(ticket), (error) => {
      assert.equal(error.code, "GOAL_MODE_DEV_DISPATCH_OUTCOME_UNCERTAIN");
      assert.equal(error.details.causeCode, "NATIVE_DEV_FAILED");
      assert.equal(error.details.reconciliationRequired, true);
      assert.equal(JSON.stringify(error.details).includes("SYNTHETIC_PRIVATE_OBJECTIVE"), false);
      assert.equal(error.message.includes("SYNTHETIC_PRIVATE_OBJECTIVE"), false);
      return true;
    });
    assert.equal(f.calls.length, 1);
    assert.equal(f.status(), "MAY_HAVE_STARTED");
    await assert.rejects(() => service.dispatch(ticket),
      { code: "GOAL_MODE_DEV_DISPATCH_ALREADY_ATTEMPTED" });
    assert.equal(f.calls.length, 1);
  } finally { f.close(); }
});

test("4C-1B ticket forgé ou d'une autre instance refusé ; dépendances requises", async () => {
  const f = fixture();
  try {
    const serviceA = f.makeService();
    const serviceB = f.makeService(f.storeB);
    const ticket = f.prepare(serviceA);
    await assert.rejects(() => serviceA.dispatch({ ...ticket }),
      { code: "GOAL_MODE_DEV_DISPATCH_TICKET_UNKNOWN" });
    await assert.rejects(() => serviceB.dispatch(ticket),
      { code: "GOAL_MODE_DEV_DISPATCH_TICKET_UNKNOWN" });
    await assert.rejects(() => serviceA.dispatch(null),
      { code: "GOAL_MODE_DEV_DISPATCH_TICKET_UNKNOWN" });
    assert.equal(f.calls.length, 0);
    assert.equal(f.status(), "PREPARED");
    assert.throws(() => createGoalModeDevDispatchService({}), TypeError);
  } finally { f.close(); }
});

test("4C-1B Goal en pause, archivé, non confirmé ou en nouvelle version : refus sans CAS", async () => {
  const f = fixture();
  try {
    const service = f.makeService();
    const ticket = f.prepare(service);
    const changes = [
      { status: "PAUSED" }, { status: "ABANDONED" }, { status: "SUPERSEDED" },
      { status: "ACHIEVED" }, { status: "DRAFT" }, { version: 3 },
      { userConfirmed: false }, { goalId: "goal-other" },
    ];
    for (const change of changes) {
      const saved = { ...f.goal };
      Object.assign(f.goal, change);
      await assert.rejects(() => service.dispatch(ticket),
        { code: "GOAL_MODE_DEV_DISPATCH_GOAL_STALE" }, JSON.stringify(change));
      Object.assign(f.goal, saved);
    }
    assert.equal(f.calls.length, 0);
    assert.equal(f.status(), "PREPARED");
    assert.equal(f.latest().revision, ticket.reservedRevision);
    // Goal rétabli à l'identique : rien n'ayant été engagé, le dispatch passe.
    await service.dispatch(ticket);
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
    const ticket = g.prepare(service);
    fail = true;
    await assert.rejects(() => service.dispatch(ticket), { code: "GOAL_MODE_DEV_DISPATCH_GOAL_STALE" });
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
    const ticket = await observed(() => f.prepare(service));
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

    await observed(() => service.dispatch(ticket));
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
