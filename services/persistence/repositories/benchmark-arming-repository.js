"use strict";

function parseJson(value, column, expectedType) {
  try {
    const parsed = JSON.parse(value);
    const valid = expectedType === "array"
      ? Array.isArray(parsed)
      : parsed !== null && typeof parsed === "object" && !Array.isArray(parsed);
    if (!valid) throw new TypeError("Type JSON invalide.");
    return parsed;
  } catch (cause) {
    throw Object.assign(new Error(`JSON benchmark arm corrompu: ${column}`), {
      code: "BENCHMARK_ARM_CORRUPT_JSON",
      column,
      cause,
    });
  }
}
function rowArm(row) {
  if (!row) return null;
  return {
    armId: row.arm_id, suiteVersion: row.suite_version, state: row.state,
    benchmarkSessionId: row.benchmark_session_id, approvedCapUsd: Number(row.approved_cap_usd),
    createdAt: row.created_at, expiresAt: row.expires_at, boundAt: row.bound_at,
    completedAt: row.completed_at, cancelledAt: row.cancelled_at, failedAt: row.failed_at,
    failureReason: row.failure_reason,
    previousRuntimeState: parseJson(row.previous_runtime_state_json, "previous_runtime_state_json", "object"),
    authorizedParticipants: parseJson(row.authorized_participants_json, "authorized_participants_json", "array"),
    updatedAt: row.updated_at,
  };
}
function createBenchmarkArmingRepository(wrapper) {
  if (!wrapper || wrapper.kind !== "sqlite") throw new TypeError("BenchmarkArmingRepository requiert SQLite.");
  const db = wrapper.database;
  const insertArm = db.prepare("INSERT INTO benchmark_arms(arm_id,suite_version,state,benchmark_session_id,approved_cap_usd,created_at,expires_at,bound_at,completed_at,cancelled_at,failed_at,failure_reason,previous_runtime_state_json,authorized_participants_json,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
  const selectArm = db.prepare("SELECT * FROM benchmark_arms WHERE arm_id=?");
  const selectArmBySession = db.prepare("SELECT * FROM benchmark_arms WHERE benchmark_session_id=?");
  const selectActiveArms = db.prepare("SELECT * FROM benchmark_arms WHERE state IN ('ARMED_PENDING_SESSION','BOUND_TO_SESSION') ORDER BY created_at,arm_id");
  const updateTransition = db.prepare("UPDATE benchmark_arms SET state=?,completed_at=?,cancelled_at=?,failed_at=?,failure_reason=?,updated_at=? WHERE arm_id=?");
  const updateBinding = db.prepare("UPDATE benchmark_arms SET state='BOUND_TO_SESSION',benchmark_session_id=?,bound_at=?,updated_at=? WHERE arm_id=?");
  const ACTIVE_STATES = new Set(["ARMED_PENDING_SESSION", "BOUND_TO_SESSION"]);
  const TRANSITIONS = Object.freeze({
    ARMED_PENDING_SESSION: new Set(["BOUND_TO_SESSION", "CANCELLED", "EXPIRED", "FAILED"]),
    BOUND_TO_SESSION: new Set(["COMPLETED", "CANCELLED", "FAILED"]),
    COMPLETED: new Set(), CANCELLED: new Set(), EXPIRED: new Set(), FAILED: new Set(),
  });
  function transaction(operation) {
    db.exec("BEGIN IMMEDIATE");
    try { const result = operation(); db.exec("COMMIT"); return result; }
    catch (error) { try { db.exec("ROLLBACK"); } catch {} throw error; }
  }
  function getArm(armId) { return rowArm(selectArm.get(String(armId))) || null; }
  function getArmBySessionId(sessionId) { return rowArm(selectArmBySession.get(String(sessionId))) || null; }
  function getActiveArm() {
    const rows = selectActiveArms.all();
    if (rows.length > 1) throw Object.assign(new Error("Plusieurs armements benchmark actifs."), { code: "BENCHMARK_ARM_MULTIPLE_ACTIVE" });
    return rows.length ? rowArm(rows[0]) : null;
  }
  function createArm(arm) {
    return transaction(() => {
      if (ACTIVE_STATES.has(arm.state) && !selectArm.get(String(arm.armId)) && selectActiveArms.all().length) throw Object.assign(new Error("Un armement benchmark est déjà actif."), { code: "BENCHMARK_ARM_ACTIVE_EXISTS" });
      insertArm.run(
        arm.armId, arm.suiteVersion, arm.state, arm.benchmarkSessionId ?? null,
        arm.approvedCapUsd, arm.createdAt, arm.expiresAt, arm.boundAt ?? null,
        arm.completedAt ?? null, arm.cancelledAt ?? null, arm.failedAt ?? null,
        arm.failureReason ?? null, JSON.stringify(arm.previousRuntimeState ?? {}),
        JSON.stringify(arm.authorizedParticipants ?? []), arm.updatedAt
      );
      return getArm(arm.armId);
    });
  }
  function requireArm(armId) {
    const current = getArm(armId);
    if (!current) throw Object.assign(new Error("Armement benchmark inconnu."), { code: "BENCHMARK_ARM_NOT_FOUND" });
    return current;
  }
  function transitionArmWithinTransaction(armId, nextState, metadata = {}) {
      const current = requireArm(armId);
      if (current.state === nextState) return current;
      if (!TRANSITIONS[current.state]?.has(nextState)) throw Object.assign(new Error("Transition d'armement benchmark invalide."), { code: "BENCHMARK_ARM_INVALID_TRANSITION", from: current.state, to: nextState });
      const at = metadata.at || new Date().toISOString();
      updateTransition.run(nextState, nextState === "COMPLETED" ? at : current.completedAt, nextState === "CANCELLED" ? at : current.cancelledAt, nextState === "FAILED" ? at : current.failedAt, nextState === "FAILED" ? (metadata.failureReason ?? null) : current.failureReason, at, current.armId);
      return getArm(current.armId);
  }
  function transitionArm(armId, nextState, metadata = {}) { return transaction(() => transitionArmWithinTransaction(armId, nextState, metadata)); }
  function bindSessionMetadataWithinTransaction(armId, benchmarkSessionId, boundAt = new Date().toISOString()) {
      const current = requireArm(armId);
      if (current.state === "BOUND_TO_SESSION" && current.benchmarkSessionId === benchmarkSessionId && current.boundAt === boundAt) return current;
      if (current.state === "BOUND_TO_SESSION") throw Object.assign(new Error("Armement déjà lié à une autre session ou date."), { code: "BENCHMARK_ARM_BINDING_CONFLICT" });
      if (current.state !== "ARMED_PENDING_SESSION") throw Object.assign(new Error("Armement non liant."), { code: "BENCHMARK_ARM_INVALID_TRANSITION" });
      updateBinding.run(String(benchmarkSessionId), boundAt, boundAt, current.armId);
      return getArm(current.armId);
  }
  function bindSessionMetadata(armId, benchmarkSessionId, boundAt = new Date().toISOString()) { return transaction(() => bindSessionMetadataWithinTransaction(armId, benchmarkSessionId, boundAt)); }
  function listRecoverableArms() { return selectActiveArms.all().map(rowArm); }
  return { kind: "sqlite", createArm, getArm, getArmBySessionId, getActiveArm, transitionArm, transitionArmWithinTransaction, bindSessionMetadata, bindSessionMetadataWithinTransaction, listRecoverableArms };
}
module.exports = { createBenchmarkArmingRepository };
