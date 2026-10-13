"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createDevCostBudgetService, periodParts } = require("../services/dev/dev-cost-budget-service");

function fixture(overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noon-dev-budget-"));
  const filePath = path.join(directory, "ledger.json");
  let clock = Date.parse("2026-03-29T00:30:00Z");
  const service = createDevCostBudgetService({
    filePath, now: () => clock,
    config: () => ({ enabled: true, taskLimit: 3, dailyLimit: 5, monthlyLimit: 20 }),
    ...overrides,
  });
  return { directory, filePath, service, setClock: (value) => { clock = Date.parse(value); } };
}

test("les périodes budgétaires suivent Europe/Paris y compris au changement d'heure", () => {
  assert.deepEqual(periodParts(Date.parse("2026-03-29T00:30:00Z")), { day: "2026-03-29", month: "2026-03" });
  assert.deepEqual(periodParts(Date.parse("2026-03-29T23:30:00Z")), { day: "2026-03-30", month: "2026-03" });
});

test("réserve puis réconcilie le coût réel sans contenu utilisateur", () => {
  const { service } = fixture();
  const reserved = service.reserve({ reservationId: "r1", taskId: "task-1", provider: "openai", model: "fixture", estimatedCost: 1.2, enforce: true });
  assert.equal(service.snapshot("task-1").task.reserved, 1.2);
  service.reconcile(reserved.reservationId, { actualCost: 0.8, success: true });
  assert.equal(service.snapshot("task-1").task.spent, 0.8);
  assert.equal(JSON.stringify(service.entries()).includes("prompt"), false);
});

test("un coût réel inconnu reste null et la dépense demeure conservatrice", () => {
  const { service } = fixture();
  service.reserve({ reservationId: "r1", taskId: "task-1", estimatedCost: 1.5 });
  const entry = service.reconcile("r1", { actualCost: null, success: false });
  assert.equal(entry.actualCost, null);
  assert.equal(service.snapshot("task-1").task.spent, 1.5);
});

test("les plafonds tâche, jour et mois bloquent avant l'appel", () => {
  const { service } = fixture();
  assert.throws(() => service.reserve({ taskId: "a", estimatedCost: 3.1, enforce: true }), (error) => error.code === "TASK_BUDGET_EXCEEDED");
  service.reserve({ taskId: "a", estimatedCost: 3, enforce: true });
  assert.throws(() => service.reserve({ taskId: "b", estimatedCost: 2.1, enforce: true }), (error) => error.code === "DAILY_BUDGET_EXCEEDED");
});

test("la limite mensuelle configurable 20 autorise 19.5 et bloque 20.1", () => {
  const { service } = fixture({ config: () => ({ enabled: true, taskLimit: null, dailyLimit: null, monthlyLimit: 20 }) });
  service.reserve({ reservationId: "spent", taskId: "a", estimatedCost: 19, enforce: true });
  service.reconcile("spent", { actualCost: 19, success: true });
  assert.doesNotThrow(() => service.reserve({ reservationId: "allowed", taskId: "b", estimatedCost: 0.5, enforce: true }));
  service.release("allowed");
  assert.throws(() => service.reserve({ reservationId: "blocked", taskId: "b", estimatedCost: 1.1, enforce: true }), (error) => error.code === "MONTHLY_BUDGET_EXCEEDED");
});

test("les réservations sont idempotentes et empêchent le dépassement concurrent", () => {
  const { service } = fixture({ config: () => ({ enabled: true, taskLimit: null, dailyLimit: 1, monthlyLimit: 20 }) });
  const first = service.reserve({ reservationId: "same", taskId: "a", estimatedCost: 0.7, enforce: true });
  assert.equal(service.reserve({ reservationId: "same", taskId: "a", estimatedCost: 0.7, enforce: true }).reservationId, first.reservationId);
  assert.throws(() => service.reserve({ reservationId: "other", taskId: "b", estimatedCost: 0.4, enforce: true }), (error) => error.code === "DAILY_BUDGET_EXCEEDED");
});

test("le ledger persiste, récupère les réservations orphelines et échoue fermé s'il est corrompu", () => {
  const fixtureState = fixture({ staleReservationMs: 1000 });
  fixtureState.service.reserve({ reservationId: "stale", taskId: "a", estimatedCost: 1 });
  fixtureState.setClock("2026-03-29T00:31:01Z");
  const restarted = createDevCostBudgetService({ filePath: fixtureState.filePath, now: () => Date.parse("2026-03-29T00:31:01Z"), staleReservationMs: 1000 });
  assert.deepEqual(restarted.recoverStale(), ["stale"]);
  assert.equal(restarted.entries()[0].status, "UNKNOWN_PENDING_RECONCILIATION");
  fs.writeFileSync(fixtureState.filePath, "{broken");
  const corrupt = createDevCostBudgetService({ filePath: fixtureState.filePath });
  assert.throws(() => corrupt.reserve({ taskId: "a", estimatedCost: 1, enforce: true }), (error) => error.code === "LEDGER_INTEGRITY_FAILURE");
});

test("le suivi peut rester actif sans enforcement", () => {
  const { service } = fixture({ config: () => ({ enabled: true, taskLimit: 0.1, dailyLimit: 0.1, monthlyLimit: 0.1 }) });
  assert.doesNotThrow(() => service.reserve({ taskId: "a", estimatedCost: 1, enforce: false }));
});

test("le plafond benchmark dédié bloque avant appel sans appliquer le budget mensuel général", () => {
  const { service } = fixture({ config: () => ({ enabled: true, taskLimit: 0.01, dailyLimit: 0.01, monthlyLimit: 0.01 }) });
  service.reserve({ reservationId: "pilot-1", taskId: "a", benchmarkId: "pilot-v1", benchmarkLimit: 0.5, estimatedCost: 0.3, enforce: false });
  assert.equal(service.benchmarkSpent("pilot-v1"), 0.3);
  assert.throws(() => service.reserve({ reservationId: "pilot-2", taskId: "b", benchmarkId: "pilot-v1", benchmarkLimit: 0.5, estimatedCost: 0.21, enforce: false }), (error) => error.code === "BENCHMARK_BUDGET_EXCEEDED");
});

test("le snapshot expose honnêtement l'enforcement effectif de l'appelant", () => {
  const { service } = fixture();
  assert.equal(service.snapshot("a", null, true).enforcement, true);
  assert.equal(service.snapshot("a", null, false).enforcement, false);
});

test("5.0D-4A maxProviderCalls bloque le N+1e appel et compte UNKNOWN conservativement", () => {
  const { service } = fixture();

  const first = service.reserve({
    reservationId: "call-1",
    taskId: "task-quota",
    estimatedCost: 0.1,
    maxProviderCalls: 1,
    enforce: true,
  });

  assert.equal(service.taskProviderCalls("task-quota"), 1);

  assert.equal(
    service.reserve({
      reservationId: "call-1",
      taskId: "task-quota",
      estimatedCost: 0.1,
      maxProviderCalls: 1,
      enforce: true,
    }).reservationId,
    first.reservationId
  );

  service.markUnknown("call-1", "OUTCOME_UNCERTAIN");
  assert.equal(service.taskProviderCalls("task-quota"), 1);

  assert.throws(
    () =>
      service.reserve({
        reservationId: "call-2",
        taskId: "task-quota",
        estimatedCost: 0.1,
        maxProviderCalls: 1,
        enforce: true,
      }),
    {
      code: "TASK_PROVIDER_CALL_LIMIT_EXCEEDED",
    }
  );
});

test("5.0D-4A une réservation RELEASED ne consomme pas la quota provider", () => {
  const { service } = fixture();

  service.reserve({
    reservationId: "released-1",
    taskId: "task-release",
    estimatedCost: 0.1,
    maxProviderCalls: 1,
    enforce: true,
  });

  service.release("released-1");
  assert.equal(service.taskProviderCalls("task-release"), 0);

  assert.doesNotThrow(
    () =>
      service.reserve({
        reservationId: "released-2",
        taskId: "task-release",
        estimatedCost: 0.1,
        maxProviderCalls: 1,
        enforce: true,
      })
  );
});

test("5.0D-4A refuse une quota provider invalide avant toute nouvelle réservation", () => {
  const { service } = fixture();

  for (
    const invalid of [
      -1,
      1.5,
      "2",
      Number.MAX_SAFE_INTEGER + 1,
    ]
  ) {
    assert.throws(
      () =>
        service.reserve({
          taskId: "task-invalid-quota",
          estimatedCost: 0.1,
          maxProviderCalls: invalid,
          enforce: true,
        }),
      {
        code: "TASK_PROVIDER_CALL_LIMIT_INVALID",
      }
    );
  }

  assert.equal(
    service.taskProviderCalls("task-invalid-quota"),
    0
  );
});
