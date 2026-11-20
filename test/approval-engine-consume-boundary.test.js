"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { createApprovalEngine } = require("../services/approvals/approval-engine");
const {
  OPERATION: GOAL_MODE_OPERATION,
  SKILL_NAME: GOAL_MODE_SKILL,
} = require("../services/goals/goal-mode-dev-approval-action");
const {
  OPERATION: RETRY_OPERATION,
  SKILL_NAME: RETRY_SKILL,
} = require("../services/goals/goal-dev-retry-permit-service");

function harness({ failConsumedSave = false } = {}) {
  let clock = Date.parse("2026-10-13T12:00:00.000Z");
  const rows = new Map();
  const audit = [];
  const repository = {
    save(row) {
      if (failConsumedSave && row.status === "consumed") throw new Error("SYNTHETIC_STORAGE_FAILURE");
      rows.set(row.id, { ...row });
      return row;
    },
    get: (id) => rows.get(id) || null,
    list: () => [...rows.values()],
    cleanup: () => 0,
  };
  const engine = createApprovalEngine({
    repository, now: () => clock,
    auditLog: { append(event, metadata) { audit.push({ event, metadata }); } },
  });
  const prepare = (skillName = GOAL_MODE_SKILL, operation = GOAL_MODE_OPERATION) =>
    engine.prepareAction({
      skillName, operation, normalizedArgs: { reservationId: "r-1", n: 1 }, target: "task-1",
    });
  const exactOf = (approval) => ({
    skillName: approval.skillName, operation: approval.operation, target: approval.target,
    normalizedArgs: { reservationId: "r-1", n: 1 },
  });
  return {
    engine, rows, audit, prepare, exactOf,
    advance(ms) { clock += ms; },
    resume(approval, options = {}) {
      return engine.resumeApprovedAction({
        approvalId: approval.id, resumeToken: approval.resumeToken, decision: "approve",
        exactAction: exactOf(approval), ...options,
      });
    },
  };
}

test("consumeAtBoundary désactivé : exécuteur appelé comme avant, sans contexte de consommation", async () => {
  const h = harness();
  const approval = h.prepare();
  let argumentsLength = null;
  const outcome = await h.resume(approval, {
    execute: function execute(...args) { argumentsLength = args.length; return "done"; },
  });
  assert.equal(argumentsLength, 2);
  assert.equal(outcome.status, "consumed");
  assert.equal(h.rows.get(approval.id).status, "consumed");
});

test("consumeAtBoundary : consommation unique, durable, avant l'effet", async () => {
  const h = harness();
  const approval = h.prepare();
  const seen = [];
  const outcome = await h.resume(approval, {
    consumeAtBoundary: true,
    execute: (_args, _record, boundary) => {
      assert.equal(Object.isFrozen(boundary), true);
      seen.push(h.rows.get(approval.id).status);
      boundary.consume();
      seen.push(h.rows.get(approval.id).status);
      assert.throws(() => boundary.consume(), { code: "APPROVAL_CONSUMED" });
      return "effect";
    },
  });
  assert.deepEqual(seen, ["approved", "consumed"]);
  assert.equal(outcome.status, "consumed");
  assert.equal(outcome.result, "effect");
  assert.ok(h.audit.some((item) => item.event === "approval.consumed" && item.metadata.boundary === true));
  await assert.rejects(() => h.resume(approval, {
    consumeAtBoundary: true, execute: (_a, _r, b) => b.consume(),
  }), { code: "APPROVAL_CONSUMED" });
});

test("consumeAtBoundary : exécuteur sans consommation refusé (failed)", async () => {
  const h = harness();
  const approval = h.prepare();
  await assert.rejects(() => h.resume(approval, {
    consumeAtBoundary: true, execute: () => "no boundary",
  }), { code: "APPROVAL_BOUNDARY_NOT_REACHED" });
  assert.equal(h.rows.get(approval.id).status, "failed");
  assert.equal(h.rows.get(approval.id).failure_code, "APPROVAL_BOUNDARY_NOT_REACHED");
});

test("consumeAtBoundary : erreur avant consommation → failed ; après → reste consumed", async () => {
  const h = harness();
  const before = h.prepare();
  await assert.rejects(() => h.resume(before, {
    consumeAtBoundary: true,
    execute: () => { throw Object.assign(new Error("x"), { code: "PRE_BOUNDARY_REFUSAL" }); },
  }), { code: "PRE_BOUNDARY_REFUSAL" });
  assert.equal(h.rows.get(before.id).status, "failed");
  assert.equal(h.rows.get(before.id).failure_code, "PRE_BOUNDARY_REFUSAL");

  const after = h.prepare();
  await assert.rejects(() => h.resume(after, {
    consumeAtBoundary: true,
    execute: async (_args, _record, boundary) => {
      boundary.consume();
      throw Object.assign(new Error("x"), { code: "POST_BOUNDARY_FAILURE" });
    },
  }), { code: "POST_BOUNDARY_FAILURE" });
  assert.equal(h.rows.get(after.id).status, "consumed");
  assert.equal(h.rows.get(after.id).failure_code, "POST_BOUNDARY_FAILURE");
  assert.ok(h.audit.some((item) => item.event === "approval.failed_after_consume"));
});

test("consumeAtBoundary : approbation expirée au moment de consommer → refus, non consommée", async () => {
  const h = harness();
  const approval = h.prepare();
  await assert.rejects(() => h.resume(approval, {
    consumeAtBoundary: true,
    execute: (_args, _record, boundary) => { h.advance(10 * 60_000); boundary.consume(); },
  }), { code: "approval_expired" });
  assert.equal(h.rows.get(approval.id).status, "failed");
  assert.equal(h.rows.get(approval.id).consumed_at, null);
});

test("consumeAtBoundary : stockage indisponible à la consommation → refus, non consommée", async () => {
  const h = harness({ failConsumedSave: true });
  const approval = h.prepare();
  let effect = false;
  await assert.rejects(() => h.resume(approval, {
    consumeAtBoundary: true,
    execute: (_args, _record, boundary) => { boundary.consume(); effect = true; },
  }), { code: "APPROVAL_STORAGE_ERROR" });
  assert.equal(effect, false);
  assert.notEqual(h.rows.get(approval.id).status, "consumed");
});

test("lecture bornée Goal Mode : symétrique du retry, jamais croisée", () => {
  const h = harness();
  const goalMode = h.prepare();
  const retry = h.prepare(RETRY_SKILL, RETRY_OPERATION);
  const exact = h.engine.getPreparedGoalModeDevDispatchExactAction({
    approvalId: goalMode.id, resumeToken: goalMode.resumeToken,
  });
  assert.equal(Object.isFrozen(exact), true);
  assert.deepEqual(exact.normalizedArgs, { n: 1, reservationId: "r-1" });
  assert.equal(h.rows.get(goalMode.id).status, "pending"); // une lecture n'approuve rien
  assert.throws(() => h.engine.getPreparedGoalModeDevDispatchExactAction({
    approvalId: retry.id, resumeToken: retry.resumeToken,
  }), { code: "APPROVAL_ACTION_CHANGED" });
  assert.throws(() => h.engine.getPreparedGoalDevRetryExactAction({
    approvalId: goalMode.id, resumeToken: goalMode.resumeToken,
  }), { code: "APPROVAL_ACTION_CHANGED" });
  assert.throws(() => h.engine.getPreparedGoalModeDevDispatchExactAction({
    approvalId: goalMode.id, resumeToken: "B".repeat(43),
  }), { code: "APPROVAL_TOKEN_INVALID" });
  assert.throws(() => h.engine.getPreparedGoalModeDevDispatchExactAction({
    approvalId: "approval_not-a-uuid", resumeToken: goalMode.resumeToken,
  }), { code: "APPROVAL_NOT_FOUND" });
  h.advance(6 * 60_000);
  assert.throws(() => h.engine.getPreparedGoalModeDevDispatchExactAction({
    approvalId: goalMode.id, resumeToken: goalMode.resumeToken,
  }), { code: "approval_expired" });
});
