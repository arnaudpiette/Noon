"use strict";

function parse(value, fallback = null) { try { return value ? JSON.parse(value) : fallback; } catch { return fallback; } }
function session(row) { return row && { ...row, cancelRequested: Boolean(row.cancel_requested), nextRunIndex: Number(row.next_run_index), versionMetadata: parse(row.version_metadata_json, {}) }; }
function run(row) { return row && { ...row, runIndex: Number(row.run_index), firstPassSuccess: row.first_pass_success == null ? null : Boolean(row.first_pass_success), resultFinalized: Boolean(row.result_finalized), validationSummary: parse(row.validation_summary_json, null) }; }

function createBenchmarkRepository(wrapper) {
  if (!wrapper || wrapper.kind !== "sqlite") throw new TypeError("BenchmarkRepository requiert SQLite.");
  const db = wrapper.database;

  // V2.8 — deux prepare() issus de connexions SQLite distinctes
  // peuvent se présenter simultanément. BEGIN IMMEDIATE doit attendre
  // brièvement le writer actif au lieu d'échouer immédiatement.
  db.exec("PRAGMA busy_timeout = 1500");

  const now = () => new Date().toISOString();
  const transaction = (work) => { db.exec("BEGIN IMMEDIATE"); try { const value = work(); db.exec("COMMIT"); return value; } catch (error) { try { db.exec("ROLLBACK"); } catch {} throw error; } };
  const getSession = (id) => session(db.prepare("SELECT * FROM benchmark_sessions WHERE id=?").get(id));
  const getByKey = (key) => session(db.prepare("SELECT * FROM benchmark_sessions WHERE idempotency_key=?").get(key));
  const getRun = (id) => run(db.prepare("SELECT * FROM benchmark_runs WHERE id=?").get(id));
  const listSessionRuns = (id) => db.prepare("SELECT * FROM benchmark_runs WHERE session_id=? ORDER BY run_index").all(id).map(run);
  function createSessionWithinTransaction(record, plan) {
      const existing = getByKey(record.idempotencyKey);
      if (existing) return { session: existing, runs: listSessionRuns(existing.id), idempotent: true };
      const timestamp = record.timestamp || now();
      db.prepare(`INSERT INTO benchmark_sessions(id,benchmark_id,suite_version,idempotency_key,state,next_run_index,cancel_requested,version_metadata_json,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?)`).run(record.id, record.benchmarkId, record.suiteVersion, record.idempotencyKey, record.state, 0, 0, JSON.stringify(record.versionMetadata || {}), timestamp, timestamp);
      const insert = db.prepare(`INSERT INTO benchmark_runs(id,session_id,run_index,task_id,participant,state,updated_at)
        VALUES(?,?,?,?,?,?,?)`);
      for (const item of plan) insert.run(item.id, record.id, item.runIndex, item.taskId, item.participant, "PENDING", timestamp);
      return { session: getSession(record.id), runs: listSessionRuns(record.id), idempotent: false };
  }
  function createSession(record, plan) { return transaction(() => createSessionWithinTransaction(record, plan)); }
  function updateSessionState(id, state, changes = {}) {
    db.prepare(`UPDATE benchmark_sessions SET state=?,next_run_index=COALESCE(?,next_run_index),cancel_requested=COALESCE(?,cancel_requested),updated_at=? WHERE id=?`)
      .run(state, changes.nextRunIndex ?? null, changes.cancelRequested == null ? null : Number(Boolean(changes.cancelRequested)), now(), id);
    return getSession(id);
  }
  function updateRunState(id, state, changes = {}) {
    db.prepare(`UPDATE benchmark_runs SET state=?,start_fingerprint=COALESCE(?,start_fingerprint),started_at=COALESCE(?,started_at),ended_at=COALESCE(?,ended_at),failure_category=COALESCE(?,failure_category),participant_reported_status=COALESCE(?,participant_reported_status),updated_at=? WHERE id=?`)
      .run(state, changes.startFingerprint ?? null, changes.startedAt ?? null, changes.endedAt ?? null, changes.failureCategory ?? null, changes.participantReportedStatus ?? null, now(), id);
    return getRun(id);
  }
  function saveNormalizedResult(id, result) {
    return transaction(() => {
      const current = getRun(id); if (!current) throw Object.assign(new Error("Run benchmark inconnu."), { code: "BENCHMARK_RUN_NOT_FOUND" });
      if (current.resultFinalized) return { run: current, idempotent: true };
      const endedAt = now();
      db.prepare(`UPDATE benchmark_runs SET state=?,ended_at=?,failure_category=?,participant_reported_status=?,final_verdict=?,first_pass_success=?,repair_cycles=?,iterations=?,duration_ms=?,regression_count=?,scope_violations=?,security_violations=?,user_intervention_count=?,provider=?,initial_model=?,final_model=?,retry_count=?,fallback_count=?,escalation_count=?,input_tokens=?,output_tokens=?,estimated_cost=?,calculated_actual_cost=?,cost_type=?,validation_summary_json=?,result_finalized=1,updated_at=? WHERE id=?`)
        .run(result.state, endedAt, result.failureCategory ?? null, result.participantReportedStatus ?? null, result.finalVerdict, result.firstPassSuccess == null ? null : Number(Boolean(result.firstPassSuccess)), result.repairCycles ?? null, result.iterations ?? null, result.durationMs ?? null, result.regressionCount ?? 0, result.scopeViolations ?? 0, result.securityViolations ?? 0, result.userInterventionCount ?? 0, result.provider ?? null, result.initialModel ?? null, result.finalModel ?? null, result.retryCount ?? 0, result.fallbackCount ?? 0, result.escalationCount ?? 0, result.inputTokens ?? null, result.outputTokens ?? null, result.estimatedCost ?? null, result.calculatedActualCost ?? null, result.costType ?? null, JSON.stringify(result.validationSummary || {}), endedAt, id);
      return { run: getRun(id), idempotent: false };
    });
  }
  function recoverInterrupted() {
    return transaction(() => {
      const sessions = db.prepare("SELECT id FROM benchmark_sessions WHERE state IN ('RUNNING','CANCELLING')").all();
      for (const item of sessions) {
        const cancelling = getSession(item.id).cancelRequested;
        db.prepare("UPDATE benchmark_runs SET state=?,ended_at=?,updated_at=? WHERE session_id=? AND state IN ('RUNNING','VALIDATING','PREPARING')")
          .run(cancelling ? "CANCELLED" : "INTERRUPTED", now(), now(), item.id);
        updateSessionState(item.id, cancelling ? "CANCELLED" : "INTERRUPTED", { cancelRequested: cancelling });
      }
      return sessions.length;
    });
  }
  function results(sessionId) { return listSessionRuns(sessionId).filter((item) => item.resultFinalized); }
  function aggregate(sessionId) { const all = results(sessionId); const infrastructure = all.filter((item) => ["PROVIDER_UNAVAILABLE","AGENT_UNAVAILABLE","NETWORK_FAILURE","RATE_LIMIT","AUTH_ERROR","TIMEOUT","BENCHMARK_BUDGET_EXCEEDED"].includes(item.failure_category)); return { rawRunCount: all.length, qualityEligibleRunCount: all.length - infrastructure.length, infrastructureExcludedCount: infrastructure.length }; }
  return { kind: "sqlite", database: db, transaction, createSession, createSessionWithinTransaction, getSession, getRun, listSessionRuns, updateSessionState, updateRunState, saveNormalizedResult, recoverInterrupted, getResults: results, aggregate };
}

module.exports = { createBenchmarkRepository };
