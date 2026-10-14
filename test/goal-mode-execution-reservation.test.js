"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createGoalModeRunContract } = require("../services/goals/goal-mode-run-contract");
const { createGoalModeRunStore } = require("../services/goals/goal-mode-run-store");
const {
  createGoalModeRunState,
  markGoalModeExecutionMayHaveStarted,
  markGoalModeExecutionUnknown,
  reconcileGoalModeExecution,
  reserveGoalModeExecution,
  reserveGoalModePlanning,
  transitionGoalModeRun,
} = require("../services/goals/goal-mode-run-state");
const {
  VERSION: PROJECTION_VERSION,
  deterministicGoalModeDevTaskId,
} = require("../services/goals/goal-mode-dev-projection-service");
const { createPersonalDatabase } = require("../services/persistence/database");
const {
  createGoalModeRunRepository,
} = require("../services/persistence/repositories/goal-mode-run-repository");

const AT = "2026-10-13T12:00:00.000Z";

function contract(runId = "goal-run-execution") {
  return createGoalModeRunContract({
    goal: {
      goalId: "goal-execution", title: "Goal DEV", status: "ACTIVE",
      outcomeDefinition: "Vérifier la réservation DEV durable.",
      successCriteria: [{
        criterionId: "criterion-execution", type: "BOOLEAN", targetValue: true,
      }],
      linkedProjectIds: [], linkedWorkspaceIds: [], constraints: [],
      profileScope: "test", sensitivity: "NORMAL", userConfirmed: true,
      version: 2,
    },
    request: {
      userConfirmed: true,
      limits: {
        maxSteps: 4, maxRetries: 1, maxProviderCalls: 3,
        maxDuration: 600_000, maxEstimatedCost: 1,
      },
      capabilityCeilings: {
        network: false, gitWrite: false, destructiveActions: false,
      },
    },
    now: () => new Date(AT), idFactory: () => runId,
  });
}

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noon-50d4c0-"));
  const file = path.join(directory, "run.sqlite");
  const dbA = createPersonalDatabase(file);
  const dbB = createPersonalDatabase(file);
  const repositoryA = createGoalModeRunRepository(dbA);
  const repositoryB = createGoalModeRunRepository(dbB);
  let clock = "2026-10-13T12:00:02.000Z";
  let upper = { steps: 1, retries: 0, providerCalls: 2, estimatedCost: 0.4 };
  let observed = null;
  let projectionCalls = 0;
  let afterProjection = null;
  let storeA;
  const proposalFingerprint = `sha256:${"a".repeat(64)}`;
  const targetFingerprint = `sha256:${"b".repeat(64)}`;
  const projection = {
    project({ runId, stepId }) {
      projectionCalls += 1;
      const snapshot = storeA.get(runId);
      const result = {
        version: PROJECTION_VERSION,
        runRef: {
          runId, runRevision: snapshot.revision,
          goalId: snapshot.state.contract.goalRef.goalId,
          goalVersion: snapshot.state.contract.goalRef.goalVersion,
        },
        stepRef: {
          stepId, proposalFingerprint, targetKind: "MILESTONE",
          targetId: "milestone-1", targetFingerprint,
        },
        taskRef: {
          taskId: deterministicGoalModeDevTaskId(runId, stepId, proposalFingerprint),
          repositoryRoot: "/private/synthetic-repo",
        },
        accounting: { stepUpperBound: upper, consumed: false },
        authorization: { capabilitiesGranted: false },
        authority: { executionAuthorized: false, capabilitiesGranted: false },
        devContract: {
          devInput: { objective: "SYNTHETIC_PRIVATE_OBJECTIVE" },
        },
      };
      const callback = afterProjection;
      afterProjection = null;
      callback?.();
      return result;
    },
  };
  const reader = {
    read(binding) {
      return observed === null ? null : { ...binding, ...observed };
    },
  };
  storeA = createGoalModeRunStore({
    repository: repositoryA, now: () => clock,
    devProjectionService: projection, devObservationReader: reader,
  });
  const storeB = createGoalModeRunStore({
    repository: repositoryB, now: () => clock,
    devProjectionService: projection, devObservationReader: reader,
  });
  const created = storeA.create(contract());
  const running = storeA.transition(created.state.runId, "RUNNING", {
    expectedRevision: created.revision,
    transitionedAt: "2026-10-13T12:00:01.000Z",
  });
  const reserve = (snapshot = storeA.get(running.state.runId)) =>
    storeA.reserveExecution(running.state.runId, {
      expectedRevision: snapshot.revision, stepId: "step-execution",
    });
  const start = (snapshot = storeA.get(running.state.runId)) => {
    const reservationId = snapshot.state.executionReservations.at(-1).reservationId;
    return storeA.markExecutionMayHaveStarted(running.state.runId, {
      expectedRevision: snapshot.revision, reservationId,
    });
  };
  return {
    file, repositoryA, repositoryB, storeA, storeB, running,
    reserve, start,
    setTime(value) { clock = value; },
    setUpper(value) { upper = value; },
    setObservation(value) { observed = value; },
    setAfterProjection(value) { afterProjection = value; },
    projectionCalls() { return projectionCalls; },
    close() {
      dbA.close(); dbB.close();
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

function record(snapshot) {
  return snapshot.state.executionReservations.at(-1);
}

function executionId(binding) {
  const digest = crypto.createHash("sha256").update(JSON.stringify([
    binding.runId, binding.stepId, binding.taskId, binding.proposalFingerprint,
  ])).digest("hex");
  return `goal-dev-execution-${digest}`;
}

function complete(overrides = {}) {
  return {
    terminal: true, complete: true, stepEngaged: true,
    retries: 0, providerCalls: 2,
    actualCost: 0.3, accountedCost: 0.3, accountingUnit: "USD",
    ...overrides,
  };
}

function unsavedExecution(runId) {
  const initial = createGoalModeRunState({ contract: contract(runId) });
  const running = transitionGoalModeRun(initial, "RUNNING", {
    transitionedAt: "2026-10-13T12:00:01.000Z",
  });
  const proposalFingerprint = `sha256:${"a".repeat(64)}`;
  const prepared = reserveGoalModeExecution(running, {
    binding: {
      runId, runRevision: 2, goalId: "goal-execution", goalVersion: 2,
      stepId: "step-execution", proposalFingerprint,
      taskId: deterministicGoalModeDevTaskId(runId, "step-execution", proposalFingerprint),
      targetKind: "MILESTONE", targetId: "milestone-1",
      targetFingerprint: `sha256:${"b".repeat(64)}`,
    },
    reservedProviderCalls: 2, reservedCost: 0.4,
    reservedAt: "2026-10-13T12:00:02.000Z",
  });
  const reservationId = prepared.executionReservations[0].reservationId;
  const started = markGoalModeExecutionMayHaveStarted(prepared, {
    reservationId, markedAt: "2026-10-13T12:00:03.000Z",
  });
  return { initial, running, prepared, started, reservationId };
}

test("4C-0 save initial accepte seulement un état neuf canonique sur SQLite", () => {
  const f = fixture();
  try {
    const valid = unsavedExecution("fresh-canonical");
    const legacy = structuredClone(valid.initial);
    delete legacy.planningReservations;
    const created = f.repositoryA.save(legacy, { expectedRevision: 0 });
    assert.equal(created.revision, 1);
    assert.equal(created.state.executionReservations, undefined);

    const forged = unsavedExecution("forged-initial");
    const reconciled = reconcileGoalModeExecution(forged.started, {
      reservationId: forged.reservationId,
      observedSteps: 1, observedRetries: 0, observedProviderCalls: 2,
      observedActualCost: null, accountedCost: 0.3, accountingUnit: "USD",
      observationComplete: true, reconciledAt: "2026-10-13T12:00:04.000Z",
    });
    const unknown = markGoalModeExecutionUnknown(forged.started, {
      reservationId: forged.reservationId,
      reasonCode: "USAGE_INCOMPLETE", markedAt: "2026-10-13T12:00:04.000Z",
    });
    const accounted = structuredClone(forged.initial);
    accounted.usage.steps = 1;
    const candidates = [forged.running, forged.prepared, forged.started,
      reconciled, unknown, accounted];
    for (const state of candidates) {
      assert.throws(() => f.repositoryA.save(state, { expectedRevision: 0 }), {
        code: "GOAL_MODE_RUN_INITIAL_STATE_INVALID",
      });
      assert.equal(f.repositoryB.latest("forged-initial"), null);
      assert.deepEqual(f.repositoryB.history("forged-initial"), []);
    }
  } finally { f.close(); }
});

test("4C-0 save initial JSON refuse sans écriture partielle", () => {
  let data = { goal_strategy_records: [] };
  let saves = 0;
  const repository = createGoalModeRunRepository({
    kind: "json-fallback",
    load: () => structuredClone(data),
    save: (next) => { saves += 1; data = structuredClone(next); },
  });
  const forged = unsavedExecution("json-forged-initial");
  assert.throws(() => repository.save(forged.started, { expectedRevision: 0 }), {
    code: "GOAL_MODE_RUN_INITIAL_STATE_INVALID",
  });
  assert.equal(saves, 0);
  assert.deepEqual(repository.history("json-forged-initial"), []);
  const created = repository.save(forged.initial, { expectedRevision: 0 });
  assert.equal(created.revision, 1);
  assert.equal(saves, 1);
});

test("4C-0 PREPARED lie projection interne, révision et plafonds sans consommer", () => {
  const f = fixture();
  try {
    for (const invalid of [undefined, null, "2", 2.5, Number.MAX_SAFE_INTEGER]) {
      assert.throws(() => f.storeA.reserveExecution(f.running.state.runId, {
        expectedRevision: invalid, stepId: "step-execution",
      }), { code: "GOAL_MODE_RUN_REVISION_REQUIRED" });
    }
    const prepared = f.storeA.reserveExecution(f.running.state.runId, {
      expectedRevision: f.running.revision, stepId: "step-execution",
      binding: { goalId: "forged" }, reservedCost: 999,
    });
    const saved = record(prepared);
    assert.equal(f.projectionCalls(), 1);
    assert.equal(prepared.revision, f.running.revision + 1);
    assert.equal(saved.status, "PREPARED");
    assert.equal(saved.binding.runRevision, f.running.revision);
    assert.equal(saved.binding.goalId, "goal-execution");
    assert.equal(saved.binding.stepId, "step-execution");
    assert.equal(saved.reservedSteps, 1);
    assert.equal(saved.reservedRetries, 0);
    assert.equal(saved.reservedProviderCalls, 2);
    assert.equal(saved.reservedCost, 0.4);
    assert.match(saved.reservationId, /^goal-dev-execution-[a-f0-9]{64}$/);
    assert.deepEqual(prepared.state.usage, f.running.state.usage);
    assert.equal(JSON.stringify(saved).includes("forged"), false);
    assert.equal(JSON.stringify(saved).includes("repositoryRoot"), false);
    assert.equal(JSON.stringify(saved).includes("SYNTHETIC_PRIVATE_OBJECTIVE"), false);
    assert.throws(() => f.reserve(prepared), { code: "GOAL_MODE_EXECUTION_IN_FLIGHT" });
    assert.throws(() => f.storeA.consume(f.running.state.runId, {
      expectedRevision: prepared.revision, currentGoalVersion: 2,
      usageDelta: { steps: 1 },
    }), { code: "GOAL_MODE_EXECUTION_IN_FLIGHT" });
  } finally { f.close(); }
});

test("4C-0 CAS entre deux connexions et budget refusent sans retry", () => {
  const f = fixture();
  try {
    f.setUpper({ steps: 1, retries: 0, providerCalls: 4, estimatedCost: 0.4 });
    assert.throws(() => f.reserve(), { code: "GOAL_MODE_EXECUTION_BUDGET_BLOCKED" });
    f.setUpper({ steps: 1, retries: 1, providerCalls: 2, estimatedCost: 0.4 });
    assert.throws(() => f.reserve(), { code: "GOAL_MODE_EXECUTION_PROJECTION_INVALID" });
    f.setUpper({ steps: 1, retries: 0, providerCalls: 2, estimatedCost: 1.1 });
    assert.throws(() => f.reserve(), { code: "GOAL_MODE_EXECUTION_BUDGET_BLOCKED" });
    f.setUpper({ steps: 1, retries: 0, providerCalls: 2, estimatedCost: 0.4 });
    const pending = reserveGoalModeExecution(f.running.state, {
      binding: {
        runId: f.running.state.runId, runRevision: f.running.revision,
        goalId: "goal-execution", goalVersion: 2,
        stepId: "step-execution",
        proposalFingerprint: `sha256:${"a".repeat(64)}`,
        taskId: deterministicGoalModeDevTaskId(
          f.running.state.runId, "step-execution", `sha256:${"a".repeat(64)}`
        ),
        targetKind: "MILESTONE", targetId: "milestone-1",
        targetFingerprint: `sha256:${"b".repeat(64)}`,
      },
      reservedProviderCalls: 2, reservedCost: 0.4,
      reservedAt: "2026-10-13T12:00:02.000Z",
    });
    const winner = f.storeB.transition(f.running.state.runId, "PAUSED", {
      expectedRevision: f.running.revision,
      transitionedAt: "2026-10-13T12:00:02.000Z",
    });
    assert.throws(() => f.repositoryA.save(pending, {
      expectedRevision: f.running.revision,
    }), { code: "GOAL_MODE_RUN_PERSISTENCE_CONFLICT" });
    assert.equal(f.storeA.get(f.running.state.runId).revision, winner.revision);
    assert.equal(f.storeA.get(f.running.state.runId).state.executionReservations, undefined);
    assert.equal(f.storeA.history(f.running.state.runId).length, 3);
  } finally { f.close(); }
});

test("4C-0 mutation interposée après projection atteint le CAS sans retry", () => {
  const f = fixture();
  try {
    f.setAfterProjection(() => {
      f.storeB.transition(f.running.state.runId, "PAUSED", {
        expectedRevision: f.running.revision,
        transitionedAt: "2026-10-13T12:00:02.000Z",
      });
    });
    assert.throws(() => f.reserve(), {
      code: "GOAL_MODE_RUN_PERSISTENCE_CONFLICT",
    });
    assert.equal(f.projectionCalls(), 1);
    assert.equal(f.storeA.get(f.running.state.runId).state.status, "PAUSED");
    assert.equal(f.storeA.history(f.running.state.runId).length, 3);
  } finally { f.close(); }
});

test("4C-0 MAY_HAVE_STARTED survit à la réouverture, sans replay ni libération", () => {
  const f = fixture();
  try {
    const prepared = f.reserve();
    f.setTime("2026-10-13T12:00:03.000Z");
    const started = f.start(prepared);
    const reopenedDatabase = createPersonalDatabase(f.file);
    try {
      const reopened = createGoalModeRunStore({
        repository: createGoalModeRunRepository(reopenedDatabase),
        now: () => "2026-10-14T12:00:00.000Z",
      });
      assert.equal(record(reopened.get(f.running.state.runId)).status, "MAY_HAVE_STARTED");
      assert.throws(() => reopened.reconcileExecution(f.running.state.runId, {
        expectedRevision: started.revision,
        reservationId: record(started).reservationId,
        complete: true, accountedCost: 0,
      }), { code: "GOAL_MODE_EXECUTION_OBSERVATION_REQUIRED" });
      assert.throws(() => reopened.reserveExecution(f.running.state.runId, {
        expectedRevision: started.revision, stepId: "step-execution",
      }), { code: "GOAL_MODE_EXECUTION_PROJECTION_REQUIRED" });
      assert.throws(() => f.storeB.reserveExecution(f.running.state.runId, {
        expectedRevision: started.revision, stepId: "step-execution",
      }), { code: "GOAL_MODE_EXECUTION_IN_FLIGHT" });
      assert.deepEqual(reopened.get(f.running.state.runId).state.usage, f.running.state.usage);
    } finally { reopenedDatabase.close(); }
  } finally { f.close(); }
});

test("4C-0 UNKNOWN conserve l'observation partielle sans zéro fabriqué", () => {
  const f = fixture();
  try {
    const prepared = f.reserve();
    f.setTime("2026-10-13T12:00:03.000Z");
    const started = f.start(prepared);
    f.setObservation({ stepEngaged: true, providerCalls: 1, actualCost: null });
    f.setTime("2026-10-13T12:00:04.000Z");
    const unknown = f.storeA.markExecutionUnknown(f.running.state.runId, {
      expectedRevision: started.revision,
      reservationId: record(started).reservationId,
      reasonCode: "USAGE_INCOMPLETE",
      accountedCost: 0,
    });
    assert.equal(record(unknown).status, "UNKNOWN");
    assert.equal(record(unknown).observedSteps, 1);
    assert.equal(record(unknown).observedProviderCalls, 1);
    assert.equal(record(unknown).accountedCost, null);
    assert.equal(record(unknown).observedActualCost, null);
    assert.deepEqual(unknown.state.usage, f.running.state.usage);
    assert.throws(() => f.reserve(unknown), { code: "GOAL_MODE_EXECUTION_UNKNOWN_BLOCKED" });
    assert.throws(() => f.storeA.consume(f.running.state.runId, {
      expectedRevision: unknown.revision, currentGoalVersion: 2,
      usageDelta: { steps: 1 },
    }), { code: "GOAL_MODE_EXECUTION_UNKNOWN_BLOCKED" });
    assert.throws(() => f.storeA.reconcileExecution(f.running.state.runId, {
      expectedRevision: unknown.revision,
      reservationId: record(unknown).reservationId,
    }), { code: "GOAL_MODE_EXECUTION_TRANSITION_INVALID" });
  } finally { f.close(); }
});

test("4C-0 RECONCILED paie exactement une fois, zéro explicite conservé", () => {
  const f = fixture();
  try {
    const prepared = f.reserve();
    f.setTime("2026-10-13T12:00:03.000Z");
    const started = f.start(prepared);
    f.setObservation(complete({
      providerCalls: 0, actualCost: 0, accountedCost: 0,
      stdout: "SYNTHETIC_PRIVATE_OUTPUT",
    }));
    f.setTime("2026-10-13T12:00:04.000Z");
    const reconciled = f.storeA.reconcileExecution(f.running.state.runId, {
      expectedRevision: started.revision,
      reservationId: record(started).reservationId,
      observedSteps: 999, accountedCost: 999,
    });
    assert.deepEqual(reconciled.state.usage, {
      steps: 1, retries: 0, providerCalls: 0, estimatedCost: 0,
    });
    assert.equal(record(reconciled).observedActualCost, 0);
    assert.equal(record(reconciled).accountedCost, 0);
    assert.equal(JSON.stringify(record(reconciled)).includes("SYNTHETIC_PRIVATE_OUTPUT"), false);
    assert.throws(() => f.storeB.reconcileExecution(f.running.state.runId, {
      expectedRevision: reconciled.revision,
      reservationId: record(reconciled).reservationId,
    }), { code: "GOAL_MODE_EXECUTION_TRANSITION_INVALID" });
    assert.throws(() => f.storeA.consume(f.running.state.runId, {
      expectedRevision: reconciled.revision, currentGoalVersion: 2,
      usageDelta: { steps: 1 }, operationId: "caller-says-distinct",
    }), { code: "GOAL_MODE_RUN_LEGACY_CONSUME_UNAVAILABLE" });
    assert.throws(() => f.reserve(reconciled), {
      code: "GOAL_MODE_EXECUTION_DUPLICATE",
    });
    const forged = structuredClone(reconciled.state);
    forged.executionReservations[0].accountedCost = 0.2;
    forged.executionReservations[0].observedActualCost = 0.2;
    forged.usage.estimatedCost = 0.2;
    assert.throws(() => f.repositoryA.save(forged, {
      expectedRevision: reconciled.revision,
    }), { code: "GOAL_MODE_EXECUTION_TRANSITION_INVALID" });
    assert.equal(f.storeB.get(f.running.state.runId).state.usage.steps, 1);
  } finally { f.close(); }
});

test("4C-0 une nouvelle réservation canonique distincte suit une réconciliation", () => {
  const f = fixture();
  try {
    const started = f.start(f.reserve());
    f.setObservation(complete({ providerCalls: 1, actualCost: 0.3, accountedCost: 0.3 }));
    f.setTime("2026-10-13T12:00:04.000Z");
    const reconciled = f.storeA.reconcileExecution(f.running.state.runId, {
      expectedRevision: started.revision,
      reservationId: record(started).reservationId,
    });
    f.setTime("2026-10-13T12:00:05.000Z");
    const planned = f.storeA.reservePlanning(f.running.state.runId, {
      expectedRevision: reconciled.revision,
      binding: {
        runId: f.running.state.runId, runRevision: reconciled.revision,
        goalId: "goal-execution", goalVersion: 2,
        targetKind: "MILESTONE", targetId: "milestone-1",
        targetFingerprint: `sha256:${"b".repeat(64)}`,
      },
      reservedProviderCalls: 1, reservedCost: 0.1,
    });
    const planningId = planned.state.planningReservations[0].reservationId;
    f.setTime("2026-10-13T12:00:06.000Z");
    const planningStarted = f.storeA.markPlanningMayHaveStarted(f.running.state.runId, {
      expectedRevision: planned.revision, reservationId: planningId,
    });
    f.setTime("2026-10-13T12:00:07.000Z");
    const planningReconciled = f.storeA.reconcilePlanning(f.running.state.runId, {
      expectedRevision: planningStarted.revision, reservationId: planningId,
      observedProviderCalls: 1, observedCost: 0.1, observationComplete: true,
    });
    f.setUpper({ steps: 1, retries: 0, providerCalls: 1, estimatedCost: 0.2 });
    f.setTime("2026-10-13T12:00:08.000Z");
    const second = f.storeA.reserveExecution(f.running.state.runId, {
      expectedRevision: planningReconciled.revision,
      stepId: "step-second",
    });
    assert.equal(record(second).status, "PREPARED");
    assert.notEqual(record(second).reservationId, record(reconciled).reservationId);
    assert.deepEqual(second.state.usage, planningReconciled.state.usage);
    assert.equal(second.state.executionReservations.length, 2);
    assert.throws(() => f.storeB.reserveExecution(f.running.state.runId, {
      expectedRevision: planningReconciled.revision, stepId: "step-third",
    }), { code: "GOAL_MODE_RUN_PERSISTENCE_CONFLICT" });
  } finally { f.close(); }
});

test("4C-0 un step ou task déjà réconcilié ne reçoit pas une autre réservation, même par save direct", () => {
  const f = fixture();
  try {
    const started = f.start(f.reserve());
    f.setObservation(complete({ providerCalls: 0, actualCost: 0, accountedCost: 0 }));
    f.setTime("2026-10-13T12:00:04.000Z");
    const reconciled = f.storeA.reconcileExecution(f.running.state.runId, {
      expectedRevision: started.revision, reservationId: record(started).reservationId,
    });
    const binding = {
      ...record(reconciled).binding,
      runRevision: reconciled.revision,
      stepId: "step-second",
      taskId: deterministicGoalModeDevTaskId(
        f.running.state.runId, "step-second", record(reconciled).binding.proposalFingerprint
      ),
    };
    const distinct = reserveGoalModeExecution(reconciled.state, {
      binding, reservedProviderCalls: 1, reservedCost: 0.1,
      reservedAt: "2026-10-13T12:00:05.000Z",
    });
    assert.equal(distinct.executionReservations.at(-1).status, "PREPARED");
    for (const duplicateKey of ["stepId", "taskId"]) {
      const forged = structuredClone(distinct);
      const next = forged.executionReservations.at(-1);
      next.binding[duplicateKey] = record(reconciled).binding[duplicateKey];
      next.reservationId = executionId(next.binding);
      assert.throws(() => f.repositoryB.save(forged, {
        expectedRevision: reconciled.revision,
      }), { code: "GOAL_MODE_EXECUTION_DUPLICATE" });
    }
    assert.equal(f.repositoryB.latest(f.running.state.runId).revision, reconciled.revision);
    const saved = f.repositoryB.save(distinct, { expectedRevision: reconciled.revision });
    assert.equal(saved.revision, reconciled.revision + 1);
  } finally { f.close(); }
});

test("4C-0 coûts flottants planning → DEV → planning suivent l'ordre réellement compté", () => {
  const f = fixture();
  try {
    const plan = (snapshot, id, reservedAt, startedAt, reconciledAt, cost) => {
      f.setTime(reservedAt);
      const prepared = f.storeA.reservePlanning(f.running.state.runId, {
        expectedRevision: snapshot.revision,
        binding: {
          runId: f.running.state.runId, runRevision: snapshot.revision,
          goalId: "goal-execution", goalVersion: 2,
          targetKind: "MILESTONE", targetId: id,
          targetFingerprint: `sha256:${"b".repeat(64)}`,
        },
        reservedProviderCalls: 1, reservedCost: 0.1,
      });
      const reservationId = prepared.state.planningReservations.at(-1).reservationId;
      f.setTime(startedAt);
      const started = f.storeA.markPlanningMayHaveStarted(f.running.state.runId, {
        expectedRevision: prepared.revision, reservationId,
      });
      f.setTime(reconciledAt);
      return f.storeA.reconcilePlanning(f.running.state.runId, {
        expectedRevision: started.revision, reservationId,
        observedProviderCalls: 1, observedCost: cost, observationComplete: true,
      });
    };
    const first = plan(f.running, "milestone-1", "2026-10-13T12:00:02.000Z",
      "2026-10-13T12:00:03.000Z", "2026-10-13T12:00:04.000Z", 0.01);
    f.setUpper({ steps: 1, retries: 0, providerCalls: 1, estimatedCost: 0.1 });
    f.setTime("2026-10-13T12:00:05.000Z");
    const prepared = f.storeA.reserveExecution(f.running.state.runId, {
      expectedRevision: first.revision, stepId: "step-execution",
    });
    f.setTime("2026-10-13T12:00:06.000Z");
    const started = f.start(prepared);
    f.setObservation(complete({ providerCalls: 1, actualCost: 0.01, accountedCost: 0.01 }));
    f.setTime("2026-10-13T12:00:07.000Z");
    const executed = f.storeA.reconcileExecution(f.running.state.runId, {
      expectedRevision: started.revision, reservationId: record(started).reservationId,
    });
    const final = plan(executed, "milestone-2", "2026-10-13T12:00:08.000Z",
      "2026-10-13T12:00:09.000Z", "2026-10-13T12:00:10.000Z", 0.04);
    assert.equal(final.state.usage.estimatedCost, (0.01 + 0.01) + 0.04);
    assert.equal(final.state.usage.providerCalls, 3);
    assert.equal(f.repositoryB.latest(f.running.state.runId).state.usage.estimatedCost, 0.06);
  } finally { f.close(); }
});

test("4C-0 consume historique reste borné et ne se mélange pas aux réservations", () => {
  const f = fixture();
  try {
    const legacy = f.storeA.consume(f.running.state.runId, {
      expectedRevision: f.running.revision, currentGoalVersion: 2,
      usageDelta: { steps: 1, retries: 0, providerCalls: 0, estimatedCost: 0 },
      updatedAt: "2026-10-13T12:00:02.000Z",
    });
    assert.equal(legacy.state.usage.steps, 1);
    assert.throws(() => f.reserve(legacy), {
      code: "GOAL_MODE_RUN_UNATTRIBUTED_USAGE",
    });
    const proposalFingerprint = `sha256:${"a".repeat(64)}`;
    const prepared = reserveGoalModeExecution(f.running.state, {
      binding: {
        runId: f.running.state.runId, runRevision: legacy.revision,
        goalId: "goal-execution", goalVersion: 2,
        stepId: "step-execution", proposalFingerprint,
        taskId: deterministicGoalModeDevTaskId(
          f.running.state.runId, "step-execution", proposalFingerprint
        ),
        targetKind: "MILESTONE", targetId: "milestone-1",
        targetFingerprint: `sha256:${"b".repeat(64)}`,
      },
      reservedProviderCalls: 1, reservedCost: 0.2,
      reservedAt: "2026-10-13T12:00:02.000Z",
    });
    const direct = structuredClone(legacy.state);
    direct.executionReservations = structuredClone(prepared.executionReservations);
    assert.throws(() => f.repositoryA.save(direct, {
      expectedRevision: legacy.revision,
    }), { code: "GOAL_MODE_RUN_UNATTRIBUTED_USAGE" });
    assert.equal(f.storeB.get(f.running.state.runId).revision, legacy.revision);
  } finally { f.close(); }
});

test("4C-0 planning possède appels et coût; consume historique ne peut les recompter", () => {
  const f = fixture();
  try {
    const planned = f.storeA.reservePlanning(f.running.state.runId, {
      expectedRevision: f.running.revision,
      binding: {
        runId: f.running.state.runId, runRevision: f.running.revision,
        goalId: "goal-execution", goalVersion: 2,
        targetKind: "MILESTONE", targetId: "milestone-1",
        targetFingerprint: `sha256:${"b".repeat(64)}`,
      },
      reservedProviderCalls: 1, reservedCost: 0.2,
    });
    const reservationId = planned.state.planningReservations[0].reservationId;
    f.setTime("2026-10-13T12:00:03.000Z");
    const started = f.storeA.markPlanningMayHaveStarted(f.running.state.runId, {
      expectedRevision: planned.revision, reservationId,
    });
    f.setTime("2026-10-13T12:00:04.000Z");
    const reconciled = f.storeA.reconcilePlanning(f.running.state.runId, {
      expectedRevision: started.revision, reservationId,
      observedProviderCalls: 1, observedCost: 0.1, observationComplete: true,
    });
    assert.throws(() => f.storeA.consume(f.running.state.runId, {
      expectedRevision: reconciled.revision, currentGoalVersion: 2,
      usageDelta: { providerCalls: 1, estimatedCost: 0.1 },
    }), { code: "GOAL_MODE_RUN_LEGACY_CONSUME_UNAVAILABLE" });
    const direct = structuredClone(reconciled.state);
    direct.usage.providerCalls += 1;
    direct.usage.estimatedCost += 0.1;
    direct.updatedAt = "2026-10-13T12:00:05.000Z";
    assert.throws(() => f.repositoryA.save(direct, {
      expectedRevision: reconciled.revision,
    }), { code: "GOAL_MODE_RUN_LEGACY_CONSUME_UNAVAILABLE" });
    const legacyStep = f.storeA.consume(f.running.state.runId, {
      expectedRevision: reconciled.revision, currentGoalVersion: 2,
      usageDelta: { steps: 1, retries: 0, providerCalls: 0, estimatedCost: 0 },
      updatedAt: "2026-10-13T12:00:05.000Z",
    });
    assert.equal(legacyStep.state.usage.steps, 1);
    assert.equal(legacyStep.state.usage.providerCalls, 1);
    assert.throws(() => f.reserve(legacyStep), {
      code: "GOAL_MODE_RUN_UNATTRIBUTED_USAGE",
    });
  } finally { f.close(); }
});

test("4C-0 observation incomplète refusée, sans conversion en coût nul", () => {
  const f = fixture();
  try {
    const started = f.start(f.reserve());
    f.setObservation(complete({ actualCost: null, accountedCost: null }));
    assert.throws(() => f.storeA.reconcileExecution(f.running.state.runId, {
      expectedRevision: started.revision,
      reservationId: record(started).reservationId,
    }), { code: "GOAL_MODE_EXECUTION_USAGE_INCOMPLETE" });
    f.setObservation(complete({ taskId: "wrong-task" }));
    assert.throws(() => f.storeA.reconcileExecution(f.running.state.runId, {
      expectedRevision: started.revision,
      reservationId: record(started).reservationId,
    }), { code: "GOAL_MODE_EXECUTION_OBSERVATION_INVALID" });
    assert.equal(record(f.storeA.get(f.running.state.runId)).status, "MAY_HAVE_STARTED");
  } finally { f.close(); }
});

test("4C-0 coût réel inconnu reste distinct du coût comptabilisé par le ledger", () => {
  const f = fixture();
  try {
    const started = f.start(f.reserve());
    f.setObservation(complete({ actualCost: null, accountedCost: 0.4 }));
    const reconciled = f.storeA.reconcileExecution(f.running.state.runId, {
      expectedRevision: started.revision,
      reservationId: record(started).reservationId,
    });
    assert.equal(record(reconciled).observedActualCost, null);
    assert.equal(record(reconciled).accountedCost, 0.4);
    assert.equal(reconciled.state.usage.estimatedCost, 0.4);
  } finally { f.close(); }
});

test("4C-0 dépassement réel conservé, puis nouvelle dépense bloquée", () => {
  const f = fixture();
  try {
    const started = f.start(f.reserve());
    f.setObservation(complete({
      retries: 2, providerCalls: 5, actualCost: 1.4, accountedCost: 1.4,
    }));
    const reconciled = f.storeA.reconcileExecution(f.running.state.runId, {
      expectedRevision: started.revision,
      reservationId: record(started).reservationId,
    });
    assert.deepEqual(reconciled.state.usage, {
      steps: 1, retries: 2, providerCalls: 5, estimatedCost: 1.4,
    });
    assert.throws(() => f.reserve(reconciled), {
      code: "GOAL_MODE_EXECUTION_RESERVATION_EXCEEDED",
    });
    assert.throws(() => f.storeA.consume(f.running.state.runId, {
      expectedRevision: reconciled.revision, currentGoalVersion: 2,
      usageDelta: { steps: 1 },
    }), { code: "GOAL_MODE_EXECUTION_RESERVATION_EXCEEDED" });
  } finally { f.close(); }
});

test("4C-0 reconciliation reste possible après pause/annulation et conflit stale", () => {
  const f = fixture();
  try {
    const started = f.start(f.reserve());
    const paused = f.storeB.transition(f.running.state.runId, "PAUSED", {
      expectedRevision: started.revision,
      transitionedAt: "2026-10-13T12:00:04.000Z",
    });
    const cancelled = f.storeB.transition(f.running.state.runId, "CANCELLED", {
      expectedRevision: paused.revision,
      transitionedAt: "2026-10-13T12:00:05.000Z",
    });
    f.setTime("2026-10-13T12:00:06.000Z");
    f.setObservation(complete());
    assert.throws(() => f.storeA.reconcileExecution(f.running.state.runId, {
      expectedRevision: started.revision,
      reservationId: record(started).reservationId,
    }), { code: "GOAL_MODE_RUN_PERSISTENCE_CONFLICT" });
    const reconciled = f.storeA.reconcileExecution(f.running.state.runId, {
      expectedRevision: cancelled.revision,
      reservationId: record(started).reservationId,
    });
    assert.equal(reconciled.state.status, "CANCELLED");
    assert.equal(reconciled.state.usage.estimatedCost, 0.3);
  } finally { f.close(); }
});

test("4C-0 exclusivité planning/DEV et sauvegarde directe restent fermées", () => {
  const f = fixture();
  try {
    const prepared = f.reserve();
    const planningBinding = {
      runId: f.running.state.runId, runRevision: prepared.revision,
      goalId: "goal-execution", goalVersion: 2,
      targetKind: "MILESTONE", targetId: "milestone-1",
      targetFingerprint: `sha256:${"b".repeat(64)}`,
    };
    assert.throws(() => f.storeA.reservePlanning(f.running.state.runId, {
      expectedRevision: prepared.revision,
      binding: planningBinding, reservedProviderCalls: 1, reservedCost: 0.1,
    }), { code: "GOAL_MODE_EXECUTION_IN_FLIGHT" });
    const planningCandidate = reserveGoalModePlanning(f.running.state, {
      reservationId: "planning-concurrent",
      binding: {
        runId: f.running.state.runId, runRevision: f.running.revision,
        goalId: "goal-execution", goalVersion: 2,
        targetKind: "MILESTONE", targetId: "milestone-1",
        targetFingerprint: `sha256:${"b".repeat(64)}`,
      },
      reservedProviderCalls: 1, reservedCost: 0.1,
      reservedAt: "2026-10-13T12:00:02.000Z",
    });
    const forged = structuredClone(prepared.state);
    forged.planningReservations = structuredClone(planningCandidate.planningReservations);
    assert.throws(() => f.repositoryA.save(forged, {
      expectedRevision: prepared.revision,
    }), { code: "GOAL_MODE_RUN_USAGE_EXCEEDS_CONTRACT" });
    const mutated = structuredClone(prepared.state);
    mutated.executionReservations[0].reservedCost = 0.1;
    assert.throws(() => f.repositoryA.save(mutated, {
      expectedRevision: prepared.revision,
    }), { code: "GOAL_MODE_EXECUTION_TRANSITION_INVALID" });
    const badDate = structuredClone(prepared.state);
    badDate.executionReservations[0].reservedAt = 2026;
    assert.throws(() => f.repositoryA.save(badDate, {
      expectedRevision: prepared.revision,
    }), { code: "GOAL_MODE_EXECUTION_TIME_INVALID" });
    const bypass = structuredClone(prepared.state);
    bypass.usage.steps = 1;
    assert.throws(() => f.repositoryA.save(bypass, {
      expectedRevision: prepared.revision,
    }), { code: "GOAL_MODE_EXECUTION_IN_FLIGHT" });
  } finally { f.close(); }
});

test("4C-0 planning ouvert interdit la réservation DEV, y compris direct repository", () => {
  const f = fixture();
  try {
    const candidate = reserveGoalModeExecution(f.running.state, {
      binding: {
        runId: f.running.state.runId, runRevision: f.running.revision,
        goalId: "goal-execution", goalVersion: 2,
        stepId: "step-execution",
        proposalFingerprint: `sha256:${"a".repeat(64)}`,
        taskId: deterministicGoalModeDevTaskId(
          f.running.state.runId, "step-execution", `sha256:${"a".repeat(64)}`
        ),
        targetKind: "MILESTONE", targetId: "milestone-1",
        targetFingerprint: `sha256:${"b".repeat(64)}`,
      },
      reservedProviderCalls: 2, reservedCost: 0.4,
      reservedAt: "2026-10-13T12:00:02.000Z",
    });
    const planning = f.storeA.reservePlanning(f.running.state.runId, {
      expectedRevision: f.running.revision,
      binding: {
        runId: f.running.state.runId, runRevision: f.running.revision,
        goalId: "goal-execution", goalVersion: 2,
        targetKind: "MILESTONE", targetId: "milestone-1",
        targetFingerprint: `sha256:${"b".repeat(64)}`,
      },
      reservedProviderCalls: 1, reservedCost: 0.1,
    });
    assert.throws(() => f.reserve(planning), { code: "GOAL_MODE_PLANNING_IN_FLIGHT" });
    const mixed = structuredClone(planning.state);
    mixed.executionReservations = structuredClone(candidate.executionReservations);
    assert.throws(() => f.repositoryA.save(mixed, {
      expectedRevision: planning.revision,
    }), { code: "GOAL_MODE_RUN_USAGE_EXCEEDS_CONTRACT" });
    assert.equal(f.storeB.get(f.running.state.runId).revision, planning.revision);
  } finally { f.close(); }
});

test("4C-0 backend non atomique, historique absent et champ présent invalide", () => {
  let fallback = { goal_strategy_records: [] };
  const repository = createGoalModeRunRepository({
    kind: "json-fallback",
    load: () => structuredClone(fallback),
    save: (next) => { fallback = structuredClone(next); },
  });
  const store = createGoalModeRunStore({ repository });
  const created = store.create(contract("fallback-execution"));
  const running = store.transition(created.state.runId, "RUNNING", {
    expectedRevision: created.revision,
    transitionedAt: "2026-10-13T12:00:01.000Z",
  });
  assert.equal(running.state.executionReservations, undefined);
  assert.throws(() => store.reserveExecution(running.state.runId, {
    expectedRevision: running.revision, stepId: "step-execution",
  }), { code: "GOAL_MODE_EXECUTION_ATOMIC_BACKEND_REQUIRED" });
  const unknown = createGoalModeRunStore({ repository: { ...repository, kind: "sqlite" } });
  assert.throws(() => unknown.reserveExecution(running.state.runId, {
    expectedRevision: running.revision, stepId: "step-execution",
  }), { code: "GOAL_MODE_EXECUTION_ATOMIC_BACKEND_REQUIRED" });
  const f = fixture();
  try {
    for (const value of [null, {}, "bad", [{ status: "PREPARED" }]]) {
      const invalid = structuredClone(f.running.state);
      invalid.executionReservations = value;
      assert.throws(() => f.repositoryA.save(invalid, {
        expectedRevision: f.running.revision,
      }));
    }
    assert.equal(f.storeA.get(f.running.state.runId).state.executionReservations, undefined);
  } finally { f.close(); }
});
