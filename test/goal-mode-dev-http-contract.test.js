"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const c = require("../services/goals/goal-mode-dev-http-contract");

const BODY = { code: "GOAL_MODE_DEV_HTTP_BODY_INVALID" };
const TOKEN = "A".repeat(43);
const APPROVAL = "approval_12345678-1234-1234-1234-123456789abc";
const limits = { maxSteps: 4, maxRetries: 1, maxProviderCalls: 4, maxDuration: 600_000, maxEstimatedCost: 3 };

test("contrat B2 : création de run à clés exactes, aucune autorité client", () => {
  const valid = { goalId: "goal-1", workspaceId: "w-1", projectId: "p-1", limits, userConfirmed: true };
  const normalized = c.normalizeCreateRun(valid);
  assert.equal(Object.isFrozen(normalized), true);
  assert.deepEqual({ ...normalized, limits: { ...normalized.limits } }, valid);
  for (const injected of ["taskId", "repositoryRoot", "allowedPaths", "permissions", "capabilityCeilings",
    "projectInstructions", "localOnly", "branch", "objective"]) {
    assert.throws(() => c.normalizeCreateRun({ ...valid, [injected]: "x" }), BODY, injected);
  }
  for (const broken of [
    { ...valid, userConfirmed: false }, { ...valid, userConfirmed: "true" },
    { ...valid, goalId: "../etc" }, { ...valid, goalId: "a b" }, { ...valid, goalId: "x".repeat(201) },
    { ...valid, limits: { ...limits, extra: 1 } }, { ...valid, limits: { ...limits, maxSteps: -1 } },
    { ...valid, limits: { ...limits, maxSteps: "4" } }, { ...valid, limits: { maxSteps: 1 } },
    Object.fromEntries(Object.entries(valid).filter(([key]) => key !== "projectId")),
    null, [], "x",
  ]) {
    assert.throws(() => c.normalizeCreateRun(broken), BODY, JSON.stringify(broken));
  }
});

test("contrat B2 : resume exige decision approve|reject, sans valeur par défaut", () => {
  const valid = { approvalId: APPROVAL, resumeToken: TOKEN, decision: "approve" };
  assert.equal(c.normalizeResume(valid).decision, "approve");
  assert.equal(c.normalizeResume({ ...valid, decision: "reject" }).decision, "reject");
  for (const decision of [undefined, null, "", "Approve", "APPROVE", "yes", true, 1]) {
    const body = { ...valid };
    if (decision === undefined) delete body.decision; else body.decision = decision;
    assert.throws(() => c.normalizeResume(body), BODY, String(decision));
  }
  for (const broken of [{ ...valid, resumeToken: "short" }, { ...valid, resumeToken: `${"A".repeat(42)}=` },
    { ...valid, approvalId: "approval_x" }, { ...valid, taskId: "goal-mode-dev-x" }]) {
    assert.throws(() => c.normalizeResume(broken), BODY);
  }
});

test("contrat B2 : planning exige confirmProviderCall: true ; révisions et statuts stricts", () => {
  assert.deepEqual({ ...c.normalizePlanning({ runId: "r-1", confirmProviderCall: true }) },
    { runId: "r-1", confirmProviderCall: true });
  for (const value of [undefined, false, "true", 1]) {
    const body = { runId: "r-1" };
    if (value !== undefined) body.confirmProviderCall = value;
    assert.throws(() => c.normalizePlanning(body), BODY);
  }
  for (const revision of [0, -1, 1.5, "1", null]) {
    assert.throws(() => c.normalizeRunRevision({ runId: "r-1", expectedRevision: revision }), BODY);
  }
  assert.throws(() => c.normalizeStop({ runId: "r-1", expectedRevision: 2, status: "PAUSED" }), BODY);
  assert.equal(c.normalizeStop({ runId: "r-1", expectedRevision: 2, status: "BLOCKED" }).status, "BLOCKED");
  assert.throws(() => c.normalizePause({ runId: "r-1", expectedRevision: 2, releasePrepared: "yes" }), BODY);
  assert.equal(c.normalizePause({ runId: "r-1", expectedRevision: 2 }).releasePrepared, false);
  assert.throws(() => c.normalizePause({ runId: "r-1", expectedRevision: 2, reasonCode: "user pause" }), BODY);
  assert.equal(c.normalizeResumeRun({ runId: "r-1", expectedRevision: 2, reasonCode: "USER_RESUME" }).reasonCode, "USER_RESUME");
  for (const normalize of [c.normalizePrepare, c.normalizeRenew, c.normalizeCancel, c.normalizeRelease]) {
    assert.throws(() => normalize({ taskId: "goal-mode-dev-x" }), BODY);
  }
});

test("contrat B2 : identifiants de chemin décodés et bornés", () => {
  assert.equal(c.normalizePathId("goal-run-1"), "goal-run-1");
  assert.equal(c.normalizePathId(encodeURIComponent("goal-dev-execution-abc")), "goal-dev-execution-abc");
  for (const value of ["a%2Fb", "%E0%A4%A", "..", "a b", "", "x".repeat(201)]) {
    assert.throws(() => c.normalizePathId(value), BODY, value);
  }
});

test("contrat B2 : jeton et display seulement dans prepare/renew, jamais de taskId", () => {
  const prepared = {
    ticket: { runId: "r-1", reservationId: "res-1", reservedRevision: 3, taskId: "goal-mode-dev-secret" },
    approval: { id: APPROVAL, expiresAt: "2026-10-13T12:05:00.000Z", title: "t", summary: "s" },
    resumeToken: TOKEN,
    display: { instruction: "i", repositoryRoot: "/r", permissions: ["P"], projectRules: ["R"] },
  };
  const approval = c.projectApproval(prepared);
  assert.equal(approval.resumeToken, TOKEN);
  assert.deepEqual(approval.display.projectRules, ["R"]);
  assert.equal(JSON.stringify(approval).includes("goal-mode-dev-secret"), false);
  const leaks = [
    c.projectDispatch({ reservationId: "res-1", mayHaveStartedRevision: 4, devResult: { taskId: "goal-mode-dev-secret", status: "COMPLETED", finalVerdict: "PASS", objective: "o" } }),
    c.projectReservation({ runId: "r-1", runStatus: "RUNNING", runRevision: 4, reservationId: "res-1", reservationStatus: "PREPARED", native: { status: "RUNNING", finalVerdict: null, failureCategory: null } }),
    c.projectRun({ revision: 2, state: { runId: "r-1", status: "RUNNING", usage: { steps: 0 }, contract: { admittedAt: "2026-10-13T12:00:00.000Z", limits: { maxDuration: 600_000 } }, executionReservations: [{ reservationId: "res-1", status: "PREPARED", binding: { taskId: "goal-mode-dev-secret" } }] } }),
    c.projectHalt({ status: "PAUSED", revision: 5, approvalsCancelled: [APPROVAL], approvalCancelFailures: [], release: null }),
    c.projectCancel({ cancelRequested: true, alreadyRequested: false, nativeCancelled: true, reservationStatus: "MAY_HAVE_STARTED" }),
  ];
  for (const value of leaks) {
    const serialized = JSON.stringify(value);
    for (const secret of ["goal-mode-dev-secret", TOKEN, "resumeToken", "display", "\"o\""]) {
      assert.equal(serialized.includes(secret), false, `${secret} in ${serialized}`);
    }
  }
  assert.equal(leaks[2].deadline, "2026-10-13T12:10:00.000Z");
  assert.deepEqual(leaks[2].reservations, [{ reservationId: "res-1", status: "PREPARED" }]);
});

test("contrat B2 : statuts HTTP et corps d'erreur minimal", () => {
  const status = (code) => c.goalModeDevHttpStatus({ code });
  const expected = {
    GOAL_MODE_DEV_HTTP_BODY_INVALID: 400, TRUSTED_UI_REQUIRED: 403, APPROVAL_TOKEN_INVALID: 403,
    GOAL_MODE_DEV_DISABLED: 404, GOAL_MODE_RUN_NOT_FOUND: 404, APPROVAL_NOT_FOUND: 404,
    GOAL_MODE_RUN_PERSISTENCE_CONFLICT: 409, GOAL_MODE_EXECUTION_IN_FLIGHT: 409, APPROVAL_INVALID: 409,
    approval_expired: 410, APPROVAL_CONSUMED: 410,
    GOAL_MODE_DEV_LOCAL_ONLY_REQUIRED: 422, GOAL_MODE_DEV_DISPATCH_RULES_CHANGED: 422, approval_stale: 422,
    GOAL_MODE_STEP_PLANNING_RESULT_UNBOUND: 422, GOAL_MODE_CONTRACT_INVALID: 422,
    GOAL_MODE_DEV_DISPATCH_OUTCOME_UNCERTAIN: 502,
    GOAL_MODE_EXECUTION_ATOMIC_BACKEND_REQUIRED: 503, APPROVAL_STORAGE_ERROR: 503,
    SOMETHING_ELSE: 500,
  };
  for (const [code, value] of Object.entries(expected)) assert.equal(status(code), value, code);
  const body = c.goalModeDevErrorBody({
    code: "GOAL_MODE_DEV_DISPATCH_OUTCOME_UNCERTAIN",
    message: "SYNTHETIC_PRIVATE_OBJECTIVE leaked",
    details: { reservationId: "res-1", reconciliationRequired: true, causeCode: "X", objective: "SYNTHETIC_PRIVATE_OBJECTIVE" },
  });
  assert.deepEqual(body, {
    status: "error", code: "GOAL_MODE_DEV_DISPATCH_OUTCOME_UNCERTAIN", message: "Opération Goal Mode DEV refusée.",
    details: { reservationId: "res-1", reconciliationRequired: true },
  });
  const internal = c.goalModeDevErrorBody(new Error("stack SYNTHETIC_PRIVATE_OBJECTIVE"));
  assert.deepEqual(internal, { status: "error", code: "GOAL_MODE_DEV_INTERNAL_ERROR", message: "Opération Goal Mode DEV refusée." });
});

test("contrat 4C-2 : réconciliation à clés exactes, résumé sans contenu, basis visible", () => {
  assert.deepEqual({ ...c.normalizeReconcile({ runId: "r-1", expectedRevision: 3, reservationId: "res-1" }) },
    { runId: "r-1", expectedRevision: 3, reservationId: "res-1" });
  for (const broken of [{ runId: "r-1", expectedRevision: 3 }, { runId: "r-1", expectedRevision: 0, reservationId: "res-1" },
    { runId: "r-1", expectedRevision: 3, reservationId: "res-1", taskId: "goal-mode-dev-x" }]) {
    assert.throws(() => c.normalizeReconcile(broken), BODY);
  }
  const summary = c.projectReconciliation({
    runId: "r-1", reservationId: "res-1", trigger: "EXPLICIT", outcome: "RECONCILED", reason: "ESTIMATED",
    basis: "ESTIMATED_UPPER_BOUND", reservationStatus: "RECONCILED",
    accounting: { providerCalls: 2, accountedCost: 0.12, actualCostKnown: false }, durationMs: 1000,
    taskId: "goal-mode-dev-secret",
  });
  assert.deepEqual({ ...summary, accounting: { ...summary.accounting } }, {
    outcome: "RECONCILED", reason: "ESTIMATED", basis: "ESTIMATED_UPPER_BOUND", reservationStatus: "RECONCILED",
    accounting: { providerCalls: 2, accountedCost: 0.12, actualCostKnown: false }, durationMs: 1000,
  });
  assert.equal(c.projectReconciliation(null), null);
  const dispatched = c.projectDispatch({
    reservationId: "res-1", mayHaveStartedRevision: 4, devResult: { status: "COMPLETED", finalVerdict: "PASS" },
    reconciliation: { outcome: "UNCHANGED", reason: "LEDGER_IN_PROGRESS" }, reconciliationRequired: true,
  });
  assert.equal(dispatched.reconciliation.outcome, "UNCHANGED");
  assert.equal(dispatched.reconciliationRequired, true);
  const reservation = c.projectReservation({
    runId: "r-1", runStatus: "RUNNING", runRevision: 5, reservationId: "res-1", reservationStatus: "RECONCILED",
    observation: { journal: "TERMINAL", ledger: { RECONCILED: 1 }, durationMs: 2000, objective: "SYNTHETIC_PRIVATE_OBJECTIVE" },
  });
  assert.deepEqual(reservation.observation, { journal: "TERMINAL", ledger: { RECONCILED: 1 }, durationMs: 2000 });
  assert.equal(c.goalModeDevHttpStatus({ code: "GOAL_MODE_DEV_RECONCILE_LOCK_REQUIRED" }), 409);
  assert.equal(c.goalModeDevHttpStatus({ code: "GOAL_MODE_DEV_RECONCILIATION_UNAVAILABLE" }), 503);
});
