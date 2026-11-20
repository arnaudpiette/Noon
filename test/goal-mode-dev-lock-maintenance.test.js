"use strict";

// B3b : maintenance du verrou (démarrage, reprise explicite, scan explicite)
// et contrat HTTP associé. Verrou et runtime factices.

const assert = require("node:assert/strict");
const test = require("node:test");

const { createGoalModeDevLockMaintenance } = require("../services/goals/goal-mode-dev-lock-maintenance");
const contract = require("../services/goals/goal-mode-dev-http-contract");

function fakeLock({ acquire = { acquired: true, reason: "ACQUIRED" }, takeover = null, held = true } = {}) {
  const calls = [];
  return {
    calls,
    held,
    acquire(options) { calls.push(["acquire", options]); return acquire; },
    takeover(options) { calls.push(["takeover", options]); return takeover; },
    inspect() { calls.push(["inspect"]); return { state: "HELD_BY_THIS" }; },
    isHeld() { return this.held; },
  };
}

function fakeRuntime({ runs = {}, startup = { scanned: 0, reconciled: 0, unknown: 0, unchanged: 0, failed: 0 }, outcomes = {} } = {}) {
  const calls = [];
  const revisions = Object.fromEntries(Object.keys(runs).map((runId) => [runId, 1]));
  return {
    calls,
    runStore: {
      listRunIds: () => Object.keys(runs),
      get: (runId) => {
        if (runs[runId] === "BROKEN") throw new Error("broken");
        return { revision: revisions[runId], state: { executionReservations: runs[runId] } };
      },
    },
    dispatchService: {
      reconcileAtStartup: () => {
        calls.push(["reconcileAtStartup"]);
        if (startup instanceof Error) throw startup;
        return startup;
      },
      reconcileExecution: (input) => {
        calls.push(["reconcileExecution", input]);
        revisions[input.runId] += 1;
        const outcome = outcomes[input.reservationId];
        if (outcome === "THROW") throw Object.assign(new Error("x"), { code: "GOAL_MODE_RUN_PERSISTENCE_CONFLICT" });
        return { outcome };
      },
    },
  };
}

function recorder() {
  const events = [];
  return { events, audit: (event, metadata) => events.push([event, metadata]) };
}

test("maintenance : démarrage avec reprise automatique puis scan STARTUP", () => {
  const lock = fakeLock({ acquire: { acquired: true, reason: "TAKEN_OVER", previous: { pid: 4242 } } });
  const runtime = fakeRuntime({ startup: { scanned: 1, reconciled: 1, unknown: 0, unchanged: 0, failed: 0 } });
  const { events, audit } = recorder();
  const result = createGoalModeDevLockMaintenance({ lock, runtime, audit }).startup();
  assert.deepEqual(lock.calls, [["acquire", { autoTakeover: true }]]);
  assert.deepEqual(runtime.calls, [["reconcileAtStartup"]]);
  assert.deepEqual(events, [
    ["goals.mode-dev.lock_takeover", { mode: "AUTOMATIC", previousPid: 4242, reason: "SAME_HOST_ESRCH" }],
    ["goals.mode-dev.reconcile_scan", { scanned: 1, reconciled: 1, unknown: 0, unchanged: 0, failed: 0, trigger: "STARTUP" }],
  ]);
  assert.equal(result.lock, "TAKEN_OVER");
});

test("maintenance : démarrage sans verrou → aucun scan ; échec du scan audité sans exception", () => {
  for (const reason of ["HELD", "STALE", "UNREADABLE", "TAKEOVER_BUSY", "TAKEOVER_CHANGED"]) {
    const runtime = fakeRuntime();
    const { events, audit } = recorder();
    createGoalModeDevLockMaintenance({ lock: fakeLock({ acquire: { acquired: false, reason } }), runtime, audit }).startup();
    assert.deepEqual(runtime.calls, []);
    assert.deepEqual(events, [["goals.mode-dev.RECONCILE_SCAN_SKIPPED_LOCK", { reason }]]);
  }
  const failing = fakeRuntime({ startup: Object.assign(new Error("x"), { code: "GOAL_MODE_DEV_RECONCILE_LOCK_REQUIRED" }) });
  const { events, audit } = recorder();
  const result = createGoalModeDevLockMaintenance({ lock: fakeLock(), runtime: failing, audit }).startup();
  assert.equal(result.scan, null);
  assert.deepEqual(events, [["goals.mode-dev.reconcile_scan_failed", { code: "GOAL_MODE_DEV_RECONCILE_LOCK_REQUIRED" }]]);
});

test("maintenance : reprise explicite sans scan automatique ; refus traduit en 409 audité", () => {
  const runtime = fakeRuntime();
  const { events, audit } = recorder();
  const lock = fakeLock({ takeover: { acquired: true, reason: "TAKEN_OVER", previous: { pid: 77 } } });
  const result = createGoalModeDevLockMaintenance({ lock, runtime, audit }).takeover({ expectedHolderPid: 77 });
  assert.deepEqual({ ...result }, { acquired: true, reason: "TAKEN_OVER", previousPid: 77, reconcileRecommended: true });
  assert.deepEqual(lock.calls, [["takeover", { expectedHolderPid: 77 }]]);
  assert.deepEqual(runtime.calls, []); // jamais de scan après une reprise explicite
  assert.deepEqual(events, [["goals.mode-dev.lock_takeover", { mode: "EXPLICIT", previousPid: 77, reason: "USER_CONFIRMED" }]]);
  for (const [reason, status] of [["HOLDER_ALIVE", 409], ["EXPECTED_HOLDER_MISMATCH", 409], ["UNAVAILABLE", 503]]) {
    const refused = recorder();
    const maintenance = createGoalModeDevLockMaintenance({
      lock: fakeLock({ takeover: { acquired: false, reason } }), runtime, audit: refused.audit,
    });
    assert.throws(() => maintenance.takeover({ expectedHolderPid: 1 }), (error) => {
      assert.equal(error.code, `GOAL_MODE_DEV_LOCK_${reason}`);
      assert.equal(error.statusCode, status);
      assert.equal(contract.goalModeDevHttpStatus(error), status);
      return true;
    });
    assert.deepEqual(refused.events, [["goals.mode-dev.lock_takeover_refused", { reason }]]);
  }
});

test("maintenance : scan explicite = réconciliation EXPLICIT par réservation, verrou exigé", () => {
  const runs = {
    "run-a": [{ reservationId: "r1", status: "MAY_HAVE_STARTED" }, { reservationId: "r2", status: "RECONCILED" },
      { reservationId: "r3", status: "MAY_HAVE_STARTED" }],
    "run-b": [{ reservationId: "r4", status: "MAY_HAVE_STARTED" }, { reservationId: "r5", status: "MAY_HAVE_STARTED" }],
    "run-c": "BROKEN",
  };
  const runtime = fakeRuntime({ runs, outcomes: { r1: "RECONCILED", r3: "UNKNOWN", r4: "UNCHANGED", r5: "THROW" } });
  const { events, audit } = recorder();
  const lock = fakeLock({ held: false });
  const maintenance = createGoalModeDevLockMaintenance({ lock, runtime, audit });
  assert.throws(() => maintenance.scanNow(), (error) => {
    assert.equal(error.code, "GOAL_MODE_DEV_RECONCILE_LOCK_REQUIRED");
    assert.equal(contract.goalModeDevHttpStatus(error), 409);
    return true;
  });
  assert.deepEqual(runtime.calls, []);
  lock.held = true;
  const summary = maintenance.scanNow();
  assert.deepEqual({ ...summary }, { scanned: 4, reconciled: 1, unknown: 1, unchanged: 1, failed: 2 });
  // Jamais reconcileAtStartup ; révision relue avant chaque réservation.
  assert.deepEqual(runtime.calls, [
    ["reconcileExecution", { runId: "run-a", expectedRevision: 1, reservationId: "r1" }],
    ["reconcileExecution", { runId: "run-a", expectedRevision: 2, reservationId: "r3" }],
    ["reconcileExecution", { runId: "run-b", expectedRevision: 1, reservationId: "r4" }],
    ["reconcileExecution", { runId: "run-b", expectedRevision: 2, reservationId: "r5" }],
  ]);
  assert.deepEqual(events, [["goals.mode-dev.reconcile_scan", { ...summary, trigger: "EXPLICIT" }]]);
});

test("maintenance : dépendances exigées", () => {
  assert.throws(() => createGoalModeDevLockMaintenance({ lock: {}, runtime: fakeRuntime() }), TypeError);
  assert.throws(() => createGoalModeDevLockMaintenance({ lock: fakeLock(), runtime: {} }), TypeError);
});

test("contrat B3b : corps exacts de reprise et de scan, projections à clés fixes", () => {
  assert.deepEqual({ ...contract.normalizeLockTakeover({ confirm: true, expectedHolderPid: 12 }) }, { expectedHolderPid: 12 });
  assert.deepEqual({ ...contract.normalizeLockTakeover({ confirm: true, expectedHolderPid: null }) }, { expectedHolderPid: null });
  for (const invalid of [{ confirm: true }, { confirm: "true", expectedHolderPid: 1 }, { confirm: true, expectedHolderPid: 0 },
    { confirm: true, expectedHolderPid: 1.5 }, { confirm: true, expectedHolderPid: 1, extra: 1 }, null, []]) {
    assert.throws(() => contract.normalizeLockTakeover(invalid), { code: "GOAL_MODE_DEV_HTTP_BODY_INVALID" });
  }
  assert.deepEqual({ ...contract.normalizeReconcileScan({ confirm: true }) }, {});
  for (const invalid of [{}, { confirm: false }, { confirm: true, all: true }]) {
    assert.throws(() => contract.normalizeReconcileScan(invalid), { code: "GOAL_MODE_DEV_HTTP_BODY_INVALID" });
  }
  const projected = contract.projectLockState({
    state: "STALE", holderPid: 5, holderHostname: "mac", holderCreatedAt: "2026-10-13T12:00:00.000Z",
    sameHost: true, machineRestarted: false, takeoverPending: false, canTakeOver: true, token: "secret", file: "/x/noon-data.lock",
  });
  assert.deepEqual(Object.keys(projected).sort(), ["canTakeOver", "holderCreatedAt", "holderHostname", "holderPid",
    "machineRestarted", "sameHost", "state", "takeoverPending"]);
  assert.equal(JSON.stringify(projected).includes("secret"), false);
  assert.equal(contract.projectLockState({ state: "WHATEVER" }).state, "UNVERIFIED");
  assert.deepEqual({ ...contract.projectReconcileScan({ scanned: 2, reconciled: 1, unknown: -1, unchanged: "x", failed: 1, extra: 9 }) },
    { scanned: 2, reconciled: 1, unknown: 0, unchanged: 0, failed: 1 });
  assert.deepEqual({ ...contract.projectLockTakeover({ acquired: true, reason: "TAKEN_OVER", previousPid: 3, reconcileRecommended: true, staleFile: "x" }) },
    { acquired: true, reason: "TAKEN_OVER", previousPid: 3, reconcileRecommended: true });
});
