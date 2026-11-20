"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  NEVER_LAUNCHED_GRACE_MS,
  createGoalModeDevObservationBroker,
  createGoalModeDevObservationReader,
} = require("../services/goals/goal-mode-dev-observation");
const runState = require("../services/goals/goal-mode-run-state");

const binding = Object.freeze({ runId: "r-1", stepId: "s-1", taskId: "goal-mode-dev-a", reservationId: "res-1" });
const record = Object.freeze({ mayHaveStartedAt: "2026-10-13T12:00:00.000Z" });
const T0 = Date.parse(record.mayHaveStartedAt);

function reader({ journal = { status: "ABSENT" }, entries = [], journalThrows = false, ledgerThrows = false } = {}) {
  return createGoalModeDevObservationReader({
    devTaskJournal: { lookup() { if (journalThrows) throw new Error("x"); return journal; } },
    devBudgetService: { entries() { if (ledgerThrows) throw new Error("x"); return entries; } },
  });
}

const terminal = (state = "PASS") => ({
  status: "PRESENT",
  record: { taskId: binding.taskId, state, createdAt: "2026-10-13T12:00:01.000Z", completedAt: "2026-10-13T12:00:31.000Z", objective: "SYNTHETIC_PRIVATE_OBJECTIVE" },
});
const running = { status: "PRESENT", record: { taskId: binding.taskId, state: "EDIT", createdAt: "2026-10-13T12:00:01.000Z" } };
const entry = (status, estimatedCost, actualCost = null, taskId = binding.taskId) => ({ taskId, status, estimatedCost, actualCost });
const ctx = (overrides = {}) => ({ trigger: "RESUME_END", inProgress: false, cancelRequested: false, devResult: null, lockHeld: false, now: T0, ...overrides });

test("4C-2 lecteur : journal terminal + ledger réglé → RECONCILE exact ou prudent", () => {
  let v = reader({ journal: terminal(), entries: [entry("RECONCILED", 0.1, 0.08), entry("RECONCILED", 0.2, 0.15)] })
    .observe({ binding, record, context: ctx() });
  assert.equal(v.decision, "RECONCILE");
  assert.equal(v.basis, "ACTUAL");
  assert.deepEqual(v.observation, { stepEngaged: true, providerCalls: 2, retries: 0, actualCost: 0.08 + 0.15, accountedCost: 0.08 + 0.15, accountingUnit: "USD" });
  assert.equal(v.durationMs, 30_000);
  // Coût réel absent : estimation, borne haute, actualCost null.
  v = reader({ journal: terminal(), entries: [entry("RECONCILED", 0.1, null)] }).observe({ binding, record, context: ctx() });
  assert.equal(v.basis, "ESTIMATED_UPPER_BOUND");
  assert.equal(v.observation.actualCost, null);
  assert.equal(v.observation.accountedCost, 0.1);
  // Appel au résultat inconnu : RECONCILE prudent (décision 2).
  v = reader({ journal: terminal(), entries: [entry("RECONCILED", 0.1, 0.1), entry("UNKNOWN_PENDING_RECONCILIATION", 0.3)] })
    .observe({ binding, record, context: ctx() });
  assert.equal(v.decision, "RECONCILE");
  assert.equal(v.basis, "ESTIMATED_UPPER_BOUND");
  assert.equal(v.observation.providerCalls, 2);
  // Annulation terminale observée complètement.
  v = reader({ journal: terminal("CANCELLED"), entries: [] }).observe({ binding, record, context: ctx() });
  assert.equal(v.decision, "RECONCILE");
  assert.equal(v.observation.providerCalls, 0);
  assert.equal(v.observation.stepEngaged, true);
  // Entrées d'un autre taskId et RELEASED ignorées.
  v = reader({ journal: terminal(), entries: [entry("RECONCILED", 9, 9, "other"), entry("RELEASED", 9)] })
    .observe({ binding, record, context: ctx() });
  assert.equal(v.observation.providerCalls, 0);
  assert.equal(v.observation.accountedCost, 0);
});

test("4C-2 lecteur : incomplet ou incohérent → UNKNOWN ; en cours ou illisible → NONE", () => {
  // Coût inconnu des deux côtés.
  let v = reader({ journal: terminal(), entries: [entry("RECONCILED", null, null)] }).observe({ binding, record, context: ctx() });
  assert.deepEqual([v.decision, v.reason], ["UNKNOWN", "USAGE_INCOMPLETE"]);
  // Résultat en mémoire incohérent avec le ledger.
  v = reader({ journal: terminal(), entries: [entry("RECONCILED", 0.1, 0.1)] })
    .observe({ binding, record, context: ctx({ devResult: { metrics: { providerCalls: [{}, {}] } } }) });
  assert.deepEqual([v.decision, v.reason], ["UNKNOWN", "USAGE_INCOMPLETE"]);
  v = reader({ journal: terminal(), entries: [entry("RECONCILED", 0.1, 0.1)] })
    .observe({ binding, record, context: ctx({ devResult: { metrics: { providerCalls: [{}] } } }) });
  assert.equal(v.decision, "RECONCILE");
  // Appel encore réservé : aucune transition.
  v = reader({ journal: terminal(), entries: [entry("RESERVED", 0.1)] }).observe({ binding, record, context: ctx() });
  assert.deepEqual([v.decision, v.reason], ["NONE", "LEDGER_IN_PROGRESS"]);
  // Journal illisible ou en erreur, ledger illisible.
  for (const options of [{ journal: { status: "UNREADABLE" } }, { journalThrows: true }]) {
    assert.deepEqual(Object.values(reader(options).observe({ binding, record, context: ctx() })).slice(0, 2), ["NONE", "JOURNAL_UNREADABLE"]);
  }
  assert.equal(reader({ ledgerThrows: true }).observe({ binding, record, context: ctx() }).reason, "LEDGER_UNREADABLE");
  // Journal ABSENT mais appels au ledger : incohérence.
  v = reader({ entries: [entry("RECONCILED", 0.1, 0.1)] }).observe({ binding, record, context: ctx() });
  assert.deepEqual([v.decision, v.reason], ["UNKNOWN", "PERSISTENCE_UNCERTAIN"]);
});

test("4C-2 lecteur : journal non terminal selon le contexte", () => {
  const r = reader({ journal: running, entries: [entry("RECONCILED", 0.1, 0.1)] });
  assert.equal(r.observe({ binding, record, context: ctx({ trigger: "EXPLICIT", inProgress: true, lockHeld: true }) }).reason, "IN_PROGRESS");
  assert.equal(r.observe({ binding, record, context: ctx({ trigger: "EXPLICIT", lockHeld: false }) }).reason, "LOCK_NOT_HELD");
  let v = r.observe({ binding, record, context: ctx({ trigger: "STARTUP" }) });
  assert.deepEqual([v.decision, v.reason, v.observation.providerCalls], ["UNKNOWN", "OUTCOME_UNCERTAIN", 1]);
  v = r.observe({ binding, record, context: ctx({ trigger: "EXPLICIT", lockHeld: true, cancelRequested: true }) });
  assert.deepEqual([v.decision, v.reason], ["UNKNOWN", "CANCELLED"]);
  v = r.observe({ binding, record, context: ctx({ trigger: "RESUME_END" }) });
  assert.equal(v.decision, "UNKNOWN");
});

test("4C-2 lecteur : « jamais lancée » sous garde-fous (fin de resume, démarrage, explicite + verrou + 2 min)", () => {
  const r = reader();
  for (const trigger of ["RESUME_END", "STARTUP"]) {
    const v = r.observe({ binding, record, context: ctx({ trigger }) });
    assert.deepEqual([v.decision, v.reason, v.basis], ["RECONCILE", "NEVER_LAUNCHED", "NEVER_LAUNCHED"]);
    assert.deepEqual(v.observation, { stepEngaged: false, providerCalls: 0, retries: 0, actualCost: 0, accountedCost: 0, accountingUnit: "USD" });
  }
  assert.equal(NEVER_LAUNCHED_GRACE_MS, 120_000);
  const explicit = (overrides) => r.observe({ binding, record, context: ctx({ trigger: "EXPLICIT", ...overrides }) });
  assert.equal(explicit({ inProgress: true, lockHeld: true, now: T0 + 600_000 }).reason, "IN_PROGRESS");
  assert.equal(explicit({ lockHeld: false, now: T0 + 600_000 }).reason, "LOCK_NOT_HELD");
  assert.equal(explicit({ lockHeld: true, now: T0 + 119_999 }).reason, "GRACE_PERIOD");
  assert.equal(explicit({ lockHeld: true, now: T0 + 120_000 }).decision, "RECONCILE");
  assert.equal(r.observe({ binding, record: {}, context: ctx({ trigger: "EXPLICIT", lockHeld: true, now: T0 + 600_000 }) }).reason, "GRACE_PERIOD");
  assert.equal(r.observe({ binding, record, context: ctx({ trigger: "OTHER" }) }).reason, "TRIGGER_INVALID");
});

test("4C-2 résumé et relais : sans contenu, observation déposée seulement pendant la transition", () => {
  const summary = reader({ journal: terminal(), entries: [entry("RECONCILED", 0.1, 0.1), entry("UNKNOWN_PENDING_RECONCILIATION", 0.2)] }).summarize(binding);
  assert.deepEqual({ ...summary, ledger: { ...summary.ledger } }, {
    journal: "TERMINAL", ledger: { RECONCILED: 1, UNKNOWN_PENDING_RECONCILIATION: 1 }, durationMs: 30_000,
  });
  assert.equal(JSON.stringify(summary).includes("SYNTHETIC_PRIVATE_OBJECTIVE"), false);
  const broker = createGoalModeDevObservationBroker();
  assert.equal(broker.read(binding), null);
  const seen = broker.withObservation(binding, { stepEngaged: true, providerCalls: 1 }, () => broker.read(binding));
  assert.equal(seen.reservationId, "res-1");
  assert.equal(seen.terminal, true);
  assert.equal(broker.read(binding), null);
  assert.throws(() => broker.withObservation(binding, {}, () => { throw new Error("boom"); }), /boom/);
  assert.equal(broker.read(binding), null);
  assert.throws(() => createGoalModeDevObservationReader({}), TypeError);
});

test("4C-2 état : RECONCILED à engagement nul seulement avec 0 essai, 0 appel et coût nul", () => {
  const { createGoalModeRunContract } = require("../services/goals/goal-mode-run-contract");
  const { deterministicGoalModeDevTaskId } = require("../services/goals/goal-mode-dev-projection-service");
  const contract = createGoalModeRunContract({
    goal: {
      goalId: "goal-zero", title: "Goal", status: "ACTIVE", outcomeDefinition: "Zéro.",
      successCriteria: [{ criterionId: "c-1", type: "BOOLEAN", targetValue: true }],
      linkedProjectIds: [], linkedWorkspaceIds: [], constraints: [],
      profileScope: "arnaud", sensitivity: "NORMAL", userConfirmed: true, version: 1,
    },
    request: {
      userConfirmed: true,
      limits: { maxSteps: 2, maxRetries: 0, maxProviderCalls: 2, maxDuration: 600_000, maxEstimatedCost: 1 },
      capabilityCeilings: { network: true, gitWrite: false, destructiveActions: false },
    },
    now: () => new Date("2026-10-13T12:00:00.000Z"), idFactory: () => "goal-run-zero",
  });
  let state = runState.createGoalModeRunState({ contract, createdAt: "2026-10-13T12:00:00.000Z" });
  state = runState.transitionGoalModeRun(state, "RUNNING", { transitionedAt: "2026-10-13T12:00:01.000Z" });
  const proposalFingerprint = `sha256:${"a".repeat(64)}`;
  state = runState.reserveGoalModeExecution(state, {
    binding: {
      runId: "goal-run-zero", runRevision: 2, goalId: "goal-zero", goalVersion: 1, stepId: "step-zero",
      proposalFingerprint, taskId: deterministicGoalModeDevTaskId("goal-run-zero", "step-zero", proposalFingerprint),
      targetKind: "MILESTONE", targetId: "m-1", targetFingerprint: `sha256:${"b".repeat(64)}`,
    },
    reservedProviderCalls: 1, reservedCost: 0.2, reservedAt: "2026-10-13T12:00:02.000Z",
  });
  const reservationId = state.executionReservations.at(-1).reservationId;
  state = runState.markGoalModeExecutionMayHaveStarted(state, { reservationId, markedAt: "2026-10-13T12:00:03.000Z" });
  const base = { reservationId, accountingUnit: "USD", observationComplete: true, reconciledAt: "2026-10-13T12:00:04.000Z" };
  for (const observation of [
    { observedSteps: 0, observedRetries: 0, observedProviderCalls: 1, accountedCost: 0, observedActualCost: null },
    { observedSteps: 0, observedRetries: 0, observedProviderCalls: 0, accountedCost: 0.1, observedActualCost: null },
    { observedSteps: 0, observedRetries: 1, observedProviderCalls: 0, accountedCost: 0, observedActualCost: null },
    { observedSteps: 0, observedRetries: 0, observedProviderCalls: 0, accountedCost: 0, observedActualCost: 0.2 },
    { observedSteps: 2, observedRetries: 0, observedProviderCalls: 0, accountedCost: 0, observedActualCost: null },
  ]) {
    assert.throws(() => runState.reconcileGoalModeExecution(state, { ...base, ...observation }),
      { code: "GOAL_MODE_EXECUTION_USAGE_INCOMPLETE" }, JSON.stringify(observation));
  }
  for (const actual of [null, 0]) {
    const next = runState.reconcileGoalModeExecution(state, {
      ...base, observedSteps: 0, observedRetries: 0, observedProviderCalls: 0, accountedCost: 0, observedActualCost: actual,
    });
    assert.equal(next.executionReservations.at(-1).status, "RECONCILED");
    assert.deepEqual(next.usage, state.usage);
    assert.doesNotThrow(() => runState.assertGoalModeRunState(next));
    // Forme forgée a posteriori : refusée par la validation d'état.
    const forged = structuredClone(next);
    forged.executionReservations.at(-1).observedProviderCalls = 1;
    forged.usage = { ...forged.usage, providerCalls: forged.usage.providerCalls + 1 };
    assert.throws(() => runState.assertGoalModeRunState(forged));
  }
});
