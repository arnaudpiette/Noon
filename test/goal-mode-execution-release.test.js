"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createGoalModeRunContract } = require("../services/goals/goal-mode-run-contract");
const { createGoalModeRunStore } = require("../services/goals/goal-mode-run-store");
const runState = require("../services/goals/goal-mode-run-state");
const {
  VERSION: PROJECTION_VERSION,
  deterministicGoalModeDevTaskId,
} = require("../services/goals/goal-mode-dev-projection-service");
const { createPersonalDatabase } = require("../services/persistence/database");
const {
  createGoalModeRunRepository,
} = require("../services/persistence/repositories/goal-mode-run-repository");

const ROOT = path.join(__dirname, "..");
const PRE_RELEASED_COMMIT = "68b91d3";
const PROPOSAL = `sha256:${"a".repeat(64)}`;
const TARGET = `sha256:${"b".repeat(64)}`;

function contract() {
  return createGoalModeRunContract({
    goal: {
      goalId: "goal-release", title: "Goal DEV", status: "ACTIVE",
      outcomeDefinition: "Vérifier la libération DEV.",
      successCriteria: [{ criterionId: "criterion-release", type: "BOOLEAN", targetValue: true }],
      linkedProjectIds: [], linkedWorkspaceIds: [], constraints: [],
      profileScope: "test", sensitivity: "NORMAL", userConfirmed: true, version: 2,
    },
    request: {
      userConfirmed: true,
      limits: {
        maxSteps: 4, maxRetries: 1, maxProviderCalls: 3,
        maxDuration: 600_000, maxEstimatedCost: 1,
      },
      capabilityCeilings: { network: false, gitWrite: false, destructiveActions: false },
    },
    now: () => new Date("2026-10-13T12:00:00.000Z"), idFactory: () => "goal-run-release",
  });
}

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noon-50d4c-release-"));
  const file = path.join(directory, "run.sqlite");
  const dbA = createPersonalDatabase(file);
  const dbB = createPersonalDatabase(file);
  let clock = Date.parse("2026-10-13T12:00:02.000Z");
  const tick = () => new Date(clock += 1000).toISOString();
  const ledger = { calls: 0, throws: false };
  let projections = 0;
  let afterProjection = null;
  let storeA;
  const projection = {
    project({ runId, stepId }) {
      projections += 1;
      const snapshot = storeA.get(runId);
      const callback = afterProjection;
      afterProjection = null;
      callback?.();
      return {
        version: PROJECTION_VERSION,
        runRef: {
          runId, runRevision: snapshot.revision,
          goalId: snapshot.state.contract.goalRef.goalId,
          goalVersion: snapshot.state.contract.goalRef.goalVersion,
        },
        stepRef: {
          stepId, proposalFingerprint: PROPOSAL, targetKind: "MILESTONE",
          targetId: "milestone-1", targetFingerprint: TARGET,
        },
        taskRef: { taskId: deterministicGoalModeDevTaskId(runId, stepId, PROPOSAL) },
        accounting: {
          stepUpperBound: { steps: 1, retries: 0, providerCalls: 1, estimatedCost: 0.2 },
          consumed: false,
        },
        authorization: { capabilitiesGranted: false },
        authority: { executionAuthorized: false, capabilitiesGranted: false },
        devContract: { devInput: { objective: "SYNTHETIC_PRIVATE_OBJECTIVE" } },
      };
    },
  };
  const devTaskLedger = {
    taskProviderCalls() {
      if (ledger.throws) throw new Error("ledger unavailable");
      return ledger.calls;
    },
  };
  const makeStore = (repository, overrides = {}) => createGoalModeRunStore({
    repository, now: tick, devProjectionService: projection, devTaskLedger, ...overrides,
  });
  const repositoryA = createGoalModeRunRepository(dbA);
  const repositoryB = createGoalModeRunRepository(dbB);
  storeA = makeStore(repositoryA);
  const storeB = makeStore(repositoryB);
  const created = storeA.create(contract());
  const running = storeA.transition(created.state.runId, "RUNNING", {
    expectedRevision: created.revision, transitionedAt: "2026-10-13T12:00:01.000Z",
  });
  const runId = running.state.runId;
  return {
    file, sqlite: dbA.database, repositoryA, repositoryB, storeA, storeB, running, runId,
    ledger, makeStore, tick,
    projections: () => projections,
    setAfterProjection(value) { afterProjection = value; },
    latest: () => repositoryB.latest(runId),
    last: () => repositoryB.latest(runId).state.executionReservations?.at(-1),
    reserve(stepId = "step-a", store = storeA) {
      return store.reserveExecution(runId, {
        expectedRevision: repositoryB.latest(runId).revision, stepId,
      });
    },
    release(store = storeA, reservationId = null) {
      const latest = repositoryB.latest(runId);
      return store.releaseExecution(runId, {
        expectedRevision: latest.revision,
        reservationId: reservationId ?? latest.state.executionReservations.at(-1).reservationId,
      });
    },
    close() {
      dbA.close(); dbB.close();
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

test("RELEASED : PREPARED libérée sans consommation, forme close et persistée", () => {
  const f = fixture();
  try {
    const prepared = f.reserve();
    const released = f.release();
    const record = released.state.executionReservations.at(-1);
    assert.equal(released.revision, prepared.revision + 1);
    assert.equal(record.status, "RELEASED");
    assert.equal(record.mayHaveStartedAt, null);
    assert.equal(typeof record.closedAt, "string");
    for (const key of ["observedSteps", "observedRetries", "observedProviderCalls",
      "observedActualCost", "accountedCost", "accountingUnit", "unknownReasonCode"]) {
      assert.equal(record[key], null, key);
    }
    assert.deepEqual(released.state.usage, f.running.state.usage);
    assert.deepEqual(record.binding, prepared.state.executionReservations.at(-1).binding);
    assert.equal(record.reservedCost, 0.2);
    assert.doesNotThrow(() => runState.assertGoalModeRunState(released.state));
    assert.equal(JSON.stringify(released.state).includes("SYNTHETIC_PRIVATE_OBJECTIVE"), false);
    const reopenedDatabase = createPersonalDatabase(f.file);
    try {
      const reopened = createGoalModeRunRepository(reopenedDatabase).latest(f.runId);
      assert.equal(reopened.revision, released.revision);
      assert.deepEqual(reopened.state, released.state);
    } finally { reopenedDatabase.close(); }
  } finally { f.close(); }
});

test("RELEASED : seule une réservation PREPARED est libérable", () => {
  const f = fixture();
  try {
    f.reserve();
    const prepared = f.latest();
    const reservationId = f.last().reservationId;
    const started = f.storeA.markExecutionMayHaveStarted(f.runId, {
      expectedRevision: prepared.revision, reservationId,
    });
    assert.throws(() => f.release(), { code: "GOAL_MODE_EXECUTION_TRANSITION_INVALID" });
    const unknown = f.storeA.markExecutionUnknown(f.runId, {
      expectedRevision: started.revision, reservationId,
    });
    assert.throws(() => f.release(), { code: "GOAL_MODE_EXECUTION_TRANSITION_INVALID" });
    assert.equal(f.latest().revision, unknown.revision);
    assert.equal(f.last().status, "UNKNOWN");
    // Au niveau état aussi : MAY_HAVE_STARTED et UNKNOWN refusés.
    assert.throws(() => runState.releaseGoalModeExecution(started.state, {
      reservationId, releasedAt: f.tick(),
    }), { code: "GOAL_MODE_EXECUTION_TRANSITION_INVALID" });
    assert.throws(() => runState.releaseGoalModeExecution(unknown.state, {
      reservationId, releasedAt: f.tick(),
    }), { code: "GOAL_MODE_EXECUTION_TRANSITION_INVALID" });
  } finally { f.close(); }

  const g = fixture();
  try {
    g.reserve();
    const released = g.release();
    const reservationId = g.last().reservationId;
    assert.throws(() => g.release(), { code: "GOAL_MODE_EXECUTION_TRANSITION_INVALID" });
    for (const action of [
      () => g.storeA.markExecutionMayHaveStarted(g.runId, {
        expectedRevision: released.revision, reservationId,
      }),
      () => g.storeA.markExecutionUnknown(g.runId, {
        expectedRevision: released.revision, reservationId,
      }),
      () => g.storeA.reconcileExecution(g.runId, {
        expectedRevision: released.revision, reservationId,
      }),
    ]) {
      assert.throws(action, (error) => /GOAL_MODE_EXECUTION_(TRANSITION_INVALID|OBSERVATION_REQUIRED)/
        .test(error.code));
    }
    assert.equal(g.latest().revision, released.revision);
    assert.equal(g.last().status, "RELEASED");
  } finally { g.close(); }
});

test("RELEASED : forme invalide et retour arrière refusés, même par save direct", () => {
  const f = fixture();
  try {
    f.reserve();
    const released = f.release();
    const base = released.state;
    const forged = (mutate) => {
      const state = structuredClone(base);
      mutate(state.executionReservations.at(-1), state);
      return state;
    };
    for (const mutate of [
      (record) => { record.mayHaveStartedAt = record.closedAt; },
      (record) => { record.closedAt = null; },
      (record) => { record.observedProviderCalls = 0; },
      (record) => { record.accountedCost = 0; record.accountingUnit = "USD"; },
      (record) => { record.unknownReasonCode = "OUTCOME_UNCERTAIN"; },
    ]) {
      assert.throws(() => runState.assertGoalModeRunState(forged(mutate)),
        (error) => /^GOAL_MODE_EXECUTION_/.test(error.code));
    }
    // Retour RELEASED → PREPARED par save direct : refusé.
    const backToPrepared = forged((record) => { record.status = "PREPARED"; record.closedAt = null; });
    assert.throws(() => f.repositoryA.save(backToPrepared, { expectedRevision: released.revision }),
      { code: "GOAL_MODE_EXECUTION_TRANSITION_INVALID" });
    // RELEASED qui consommerait de l'usage : refusé.
    const consuming = forged((record, state) => { state.usage = { ...state.usage, providerCalls: 1 }; });
    assert.throws(() => f.repositoryA.save(consuming, { expectedRevision: released.revision }));
    // PREPARED → RELEASED avec usage modifié dans le même save : refusé.
    const g = fixture();
    try {
      const prepared = g.reserve();
      const next = runState.releaseGoalModeExecution(prepared.state, {
        reservationId: prepared.state.executionReservations.at(-1).reservationId,
        releasedAt: g.tick(),
      });
      const withUsage = structuredClone(next);
      withUsage.usage = { ...withUsage.usage, estimatedCost: 0.1 };
      assert.throws(() => g.repositoryA.save(withUsage, { expectedRevision: prepared.revision }));
      assert.equal(g.latest().revision, prepared.revision);
    } finally { g.close(); }
    assert.equal(f.latest().revision, released.revision);
  } finally { f.close(); }
});

test("RELEASED : ledger requis à 0, sinon refus sans écriture", () => {
  const f = fixture();
  try {
    const prepared = f.reserve();
    for (const [setup, code] of [
      [() => { f.ledger.calls = 1; }, "GOAL_MODE_EXECUTION_RELEASE_LEDGER_ENGAGED"],
      [() => { f.ledger.calls = Number.NaN; }, "GOAL_MODE_EXECUTION_RELEASE_LEDGER_ENGAGED"],
      [() => { f.ledger.calls = -1; }, "GOAL_MODE_EXECUTION_RELEASE_LEDGER_ENGAGED"],
      [() => { f.ledger.calls = 0; f.ledger.throws = true; }, "GOAL_MODE_EXECUTION_RELEASE_LEDGER_ENGAGED"],
    ]) {
      setup();
      assert.throws(() => f.release(), { code });
    }
    f.ledger.throws = false;
    f.ledger.calls = 0;
    const noLedger = f.makeStore(f.repositoryA, { devTaskLedger: null });
    assert.throws(() => f.release(noLedger), { code: "GOAL_MODE_EXECUTION_RELEASE_LEDGER_REQUIRED" });
    assert.throws(() => f.release(f.storeA, "goal-dev-execution-other"),
      { code: "GOAL_MODE_EXECUTION_TRANSITION_INVALID" });
    assert.throws(() => f.storeA.releaseExecution(f.runId, {
      expectedRevision: prepared.revision - 1, reservationId: f.last().reservationId,
    }), { code: "GOAL_MODE_RUN_PERSISTENCE_CONFLICT" });
    assert.equal(f.latest().revision, prepared.revision);
    assert.equal(f.last().status, "PREPARED");
    f.release();
    assert.equal(f.last().status, "RELEASED");
  } finally { f.close(); }
});

test("RELEASED : nouvelle réservation pour un autre step, jamais pour le même", () => {
  const f = fixture();
  try {
    f.reserve("step-a");
    f.release();
    const projectionsBefore = f.projections();
    assert.throws(() => f.reserve("step-a"), { code: "GOAL_MODE_EXECUTION_DUPLICATE" });
    assert.equal(f.projections(), projectionsBefore + 1);
    const second = f.reserve("step-b");
    assert.equal(second.state.executionReservations.length, 2);
    assert.equal(second.state.executionReservations.at(-1).status, "PREPARED");
    assert.deepEqual(second.state.usage, f.running.state.usage);
    // Un UNKNOWN ultérieur bloque toujours, RELEASED antérieur ou non.
    const unknown = f.storeA.markExecutionUnknown(f.runId, {
      expectedRevision: second.revision, reservationId: f.last().reservationId,
    });
    assert.throws(() => f.reserve("step-c"), { code: "GOAL_MODE_EXECUTION_UNKNOWN_BLOCKED" });
    assert.equal(f.latest().revision, unknown.revision);
  } finally { f.close(); }
});

test("RELEASED : course libération / CAS de départ sur deux connexions, un seul gagnant", () => {
  const f = fixture();
  try {
    const prepared = f.reserve();
    const reservationId = f.last().reservationId;
    const released = f.release(f.storeB);
    assert.throws(() => f.storeA.markExecutionMayHaveStarted(f.runId, {
      expectedRevision: prepared.revision, reservationId,
    }), { code: "GOAL_MODE_RUN_PERSISTENCE_CONFLICT" });
    assert.equal(f.latest().revision, released.revision);
    assert.equal(f.last().status, "RELEASED");
  } finally { f.close(); }

  const g = fixture();
  try {
    const prepared = g.reserve();
    const reservationId = g.last().reservationId;
    g.storeB.markExecutionMayHaveStarted(g.runId, {
      expectedRevision: prepared.revision, reservationId,
    });
    assert.throws(() => g.storeA.releaseExecution(g.runId, {
      expectedRevision: prepared.revision, reservationId,
    }), { code: "GOAL_MODE_RUN_PERSISTENCE_CONFLICT" });
    assert.throws(() => g.release(), { code: "GOAL_MODE_EXECUTION_TRANSITION_INVALID" });
    assert.equal(g.last().status, "MAY_HAVE_STARTED");
  } finally { g.close(); }
});

test("RELEASED : erreur SQLite pendant la libération n'écrit rien", () => {
  const f = fixture();
  try {
    const prepared = f.reserve();
    f.sqlite.exec(`CREATE TRIGGER reject_goal_mode_release
      BEFORE INSERT ON goal_strategy_records
      WHEN NEW.record_type = 'GOAL_MODE_RUN_STATE' AND NEW.sequence = ${prepared.revision + 1}
      BEGIN SELECT RAISE(ABORT, 'SYNTHETIC_RELEASE_FAILURE'); END`);
    assert.throws(() => f.release(), /SYNTHETIC_RELEASE_FAILURE/);
    assert.equal(f.latest().revision, prepared.revision);
    assert.equal(f.last().status, "PREPARED");
  } finally { f.close(); }
});

function loadPreReleasedRunState() {
  let source;
  try {
    source = execFileSync("git", ["show", `${PRE_RELEASED_COMMIT}:services/goals/goal-mode-run-state.js`], {
      cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    });
  } catch { return null; }
  // Compilé en mémoire, résolu contre les vrais modules voisins ; aucun fichier écrit.
  const filename = path.join(ROOT, "services", "goals", "__pre-released-goal-mode-run-state.js");
  const legacy = new Module(filename, module);
  legacy.filename = filename;
  legacy.paths = Module._nodeModulePaths(path.dirname(filename));
  legacy._compile(source, filename);
  return legacy.exports;
}

test("compatibilité : ancien code ↔ nouveau code, et limite de downgrade", (t) => {
  const legacy = loadPreReleasedRunState();
  if (!legacy) {
    t.skip(`historique Git ${PRE_RELEASED_COMMIT} indisponible`);
    return;
  }
  assert.equal(legacy.EXECUTION_STATUSES.includes("RELEASED"), false);
  const f = fixture();
  try {
    // Base écrite avec l'ancien code (réservation → départ → UNKNOWN),
    // persistée et relue à l'identique par le nouveau code.
    const binding = {
      runId: f.runId, runRevision: f.running.revision, goalId: "goal-release", goalVersion: 2,
      stepId: "step-legacy", proposalFingerprint: PROPOSAL,
      taskId: deterministicGoalModeDevTaskId(f.runId, "step-legacy", PROPOSAL),
      targetKind: "MILESTONE", targetId: "milestone-1", targetFingerprint: TARGET,
    };
    let revision = f.running.revision;
    let state = f.running.state;
    const steps = [
      (current) => legacy.reserveGoalModeExecution(current, {
        binding, reservedProviderCalls: 1, reservedCost: 0.2, reservedAt: f.tick(),
      }),
      (current) => legacy.markGoalModeExecutionMayHaveStarted(current, {
        reservationId: current.executionReservations.at(-1).reservationId, markedAt: f.tick(),
      }),
      (current) => legacy.markGoalModeExecutionUnknown(current, {
        reservationId: current.executionReservations.at(-1).reservationId, markedAt: f.tick(),
      }),
    ];
    for (const step of steps) {
      state = step(state);
      const saved = f.repositoryA.save(state, { expectedRevision: revision });
      revision = saved.revision;
      assert.doesNotThrow(() => runState.assertGoalModeRunState(state));
    }
    const reopenedDatabase = createPersonalDatabase(f.file);
    try {
      const reopened = createGoalModeRunRepository(reopenedDatabase).latest(f.runId);
      assert.deepEqual(reopened.state, JSON.parse(JSON.stringify(state)));
      assert.equal(reopened.state.executionReservations.at(-1).status, "UNKNOWN");
    } finally { reopenedDatabase.close(); }
  } finally { f.close(); }

  const g = fixture();
  try {
    // Le nouveau code n'écrit rien d'illisible pour l'ancien… tant que RELEASED est absent.
    const prepared = g.reserve();
    assert.doesNotThrow(() => legacy.assertGoalModeRunState(prepared.state));
    const released = g.release();
    // Limite de downgrade (option A) : refus propre, typé, sans corruption.
    assert.throws(() => legacy.assertGoalModeRunState(released.state),
      { code: "GOAL_MODE_EXECUTION_INVALID" });
    assert.doesNotThrow(() => runState.assertGoalModeRunState(released.state));
  } finally { g.close(); }
});
