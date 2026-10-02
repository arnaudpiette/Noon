"use strict";

const crypto = require("node:crypto");
const { TERMINAL_JOB_STATES } = require("./job-registry");

const JSON_FIELDS = ["input_ref", "output_ref", "progress", "retry_policy", "budget", "metadata", "dependencies", "checkpoint"];
const PRIORITY_SCORE = Object.freeze({ LOW: 0, NORMAL: 100, HIGH: 200, URGENT: 300 });

function parseJson(value, fallback) { try { return value ? JSON.parse(value) : fallback; } catch { return fallback; } }
function toPublic(row) {
  if (!row) return null;
  const result = { ...row };
  for (const field of JSON_FIELDS) { result[field.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = parseJson(result[`${field}_json`], field === "dependencies" ? [] : {}); delete result[`${field}_json`]; }
  return result;
}
function serialize(value, fallback) { return JSON.stringify(value ?? fallback); }

function createJobStore(wrapper, { now = () => Date.now() } = {}) {
  if (wrapper?.kind !== "sqlite" || !wrapper.database) throw new TypeError("Le moteur de jobs requiert le stockage SQLite local.");
  const db = wrapper.database;
  const getStatement = db.prepare("SELECT * FROM background_jobs WHERE id=?");

  function transaction(callback) {
    const ownsTransaction = db.isTransaction !== true;
    const savepoint = ownsTransaction ? null : `job_store_${crypto.randomUUID().replaceAll("-", "")}`;
    if (ownsTransaction) db.exec("BEGIN IMMEDIATE"); else db.exec(`SAVEPOINT ${savepoint}`);
    try {
      const value = callback();
      if (ownsTransaction) db.exec("COMMIT"); else db.exec(`RELEASE SAVEPOINT ${savepoint}`);
      return value;
    } catch (error) {
      if (ownsTransaction) {
        try { db.exec("ROLLBACK"); } catch {}
      } else {
        try { db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`); } catch {}
        try { db.exec(`RELEASE SAVEPOINT ${savepoint}`); } catch {}
      }
      throw error;
    }
  }
  function get(id) { return toPublic(getStatement.get(id)); }
  function create(record) {
    const timestamp = new Date(now()).toISOString();
    const id = record.id || `job_${crypto.randomUUID()}`;
    return transaction(() => {
      db.prepare(`INSERT INTO background_jobs(
        id,type,handler_version,state,priority,resource_class,profile_scope,workspace_id,project_id,session_id,conversation_id,
        input_mode,input_ref_json,output_ref_json,progress_json,retry_policy_json,budget_json,metadata_json,dependencies_json,checkpoint_json,
        idempotency_key,dedupe_key,attempt_count,max_attempts,scheduled_at,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        id, record.type, record.handlerVersion, "CREATED", record.priority, record.resourceClass,
        record.profileScope || "arnaud", record.workspaceId || null, record.projectId || null, record.sessionId || null, record.conversationId || null,
        record.inputMode, serialize(record.inputRef, {}), "{}", serialize(record.progress, { percent: 0 }), serialize(record.retryPolicy, {}), serialize(record.budget, {}), serialize(record.metadata, {}), serialize(record.dependencies, []), "{}",
        record.idempotencyKey || null, record.dedupeKey || null, 0, record.maxAttempts, record.scheduledAt || timestamp, timestamp, timestamp
      );
      transition(id, "QUEUED", { reasonCode: "ENQUEUED" });
      return get(id);
    });
  }
  function transition(id, state, patch = {}) {
    const existing = get(id); if (!existing) return null;
    const timestamp = new Date(now()).toISOString();
    const pairs = ["state=?", "updated_at=?"]; const values = [state, timestamp];
    const mapping = { reasonCode: "reason_code", scheduledAt: "scheduled_at", startedAt: "started_at", completedAt: "completed_at", leaseOwner: "lease_owner", leaseExpiresAt: "lease_expires_at", outputRef: "output_ref_json", progress: "progress_json", checkpoint: "checkpoint_json", notificationState: "notification_state" };
    for (const [key, column] of Object.entries(mapping)) if (Object.hasOwn(patch, key)) { pairs.push(`${column}=?`); values.push(["outputRef", "progress", "checkpoint"].includes(key) ? serialize(patch[key], {}) : patch[key]); }
    if (Object.hasOwn(patch, "attemptCount")) { pairs.push("attempt_count=?"); values.push(patch.attemptCount); }
    values.push(id); db.prepare(`UPDATE background_jobs SET ${pairs.join(",")} WHERE id=?`).run(...values);
    return get(id);
  }
  function list(filters = {}) {
    const where = []; const values = [];
    for (const [key, column] of [["state", "state"], ["type", "type"], ["workspaceId", "workspace_id"], ["profileScope", "profile_scope"]]) if (filters[key]) { where.push(`${column}=?`); values.push(filters[key]); }
    const limit = Math.max(1, Math.min(500, Number(filters.limit) || 100));
    return db.prepare(`SELECT * FROM background_jobs ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT ?`).all(...values, limit).map(toPublic);
  }
  function findActiveByKey(column, value) {
    if (!value) return null;
    const placeholders = TERMINAL_JOB_STATES.map(() => "?").join(",");
    return toPublic(db.prepare(`SELECT * FROM background_jobs WHERE ${column}=? AND state NOT IN (${placeholders}) ORDER BY created_at DESC LIMIT 1`).get(value, ...TERMINAL_JOB_STATES));
  }
  function dependenciesSatisfied(job) {
    for (const dependencyId of job.dependencies || []) {
      const dependency = get(dependencyId);
      if (!dependency || dependency.state !== "SUCCEEDED") return false;
    }
    return true;
  }
  function claimNext({ workerId, leaseMs = 30_000, resourceClasses = null } = {}) {
    return transaction(() => {
      const timestamp = new Date(now()).toISOString();
      const classSql = resourceClasses?.length ? ` AND resource_class IN (${resourceClasses.map(() => "?").join(",")})` : "";
      const candidates = db.prepare(`SELECT * FROM background_jobs WHERE state IN ('QUEUED','RETRY_SCHEDULED','INTERRUPTED') AND scheduled_at<=?${classSql} ORDER BY CASE priority WHEN 'URGENT' THEN 300 WHEN 'HIGH' THEN 200 WHEN 'NORMAL' THEN 100 ELSE 0 END + MIN(80, CAST((julianday(?) - julianday(created_at))*24 AS INTEGER)) DESC, created_at LIMIT 50`).all(timestamp, ...(resourceClasses || []), timestamp).map(toPublic);
      const candidate = candidates.find(dependenciesSatisfied); if (!candidate) return null;
      const leaseExpiresAt = new Date(now() + leaseMs).toISOString();
      const changed = db.prepare("UPDATE background_jobs SET state='RUNNING',lease_owner=?,lease_expires_at=?,attempt_count=attempt_count+1,started_at=COALESCE(started_at,?),updated_at=? WHERE id=? AND state IN ('QUEUED','RETRY_SCHEDULED','INTERRUPTED')").run(workerId, leaseExpiresAt, timestamp, timestamp, candidate.id);
      return changed.changes === 1 ? get(candidate.id) : null;
    });
  }
  function recoverExpiredLeases() {
    const timestamp = new Date(now()).toISOString();
    const rows = db.prepare("SELECT id FROM background_jobs WHERE state IN ('RUNNING','CANCEL_REQUESTED') AND lease_expires_at IS NOT NULL AND lease_expires_at<=?").all(timestamp);
    for (const row of rows) db.prepare("UPDATE background_jobs SET state='INTERRUPTED',reason_code='LEASE_EXPIRED',lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=?").run(timestamp, row.id);
    return rows.map(({ id }) => get(id));
  }
  function renewLease(id, workerId, leaseMs) {
    const timestamp = new Date(now()).toISOString();
    const expiresAt = new Date(now() + leaseMs).toISOString();
    const result = db.prepare("UPDATE background_jobs SET lease_expires_at=?,updated_at=? WHERE id=? AND state IN ('RUNNING','CANCEL_REQUESTED') AND lease_owner=?").run(expiresAt, timestamp, id, workerId);
    return result.changes === 1;
  }
  function blockBrokenDependencies() {
    const candidates = db.prepare("SELECT id,dependencies_json FROM background_jobs WHERE state IN ('QUEUED','RETRY_SCHEDULED','INTERRUPTED') AND dependencies_json!='[]'").all();
    const blocked = [];
    for (const candidate of candidates) {
      const dependencies = parseJson(candidate.dependencies_json, []).map(get);
      if (dependencies.some((dependency) => !dependency || ["FAILED", "BLOCKED", "CANCELLED"].includes(dependency.state))) {
        transition(candidate.id, "BLOCKED", { reasonCode: "DEPENDENCY_NOT_SUCCEEDED", completedAt: new Date(now()).toISOString() }); blocked.push(candidate.id);
      }
    }
    return blocked;
  }
  function hasDependencyPath(fromId, targetId, seen = new Set()) {
    if (fromId === targetId) return true; if (seen.has(fromId)) return false; seen.add(fromId);
    return (get(fromId)?.dependencies || []).some((id) => hasDependencyPath(id, targetId, seen));
  }
  function stats() {
    const rows = db.prepare("SELECT state,COUNT(*) count FROM background_jobs GROUP BY state").all();
    return Object.fromEntries(rows.map((row) => [row.state, Number(row.count)]));
  }
  return { blockBrokenDependencies, claimNext, create, findActiveByDedupeKey: (key) => findActiveByKey("dedupe_key", key), findActiveByIdempotencyKey: (key) => findActiveByKey("idempotency_key", key), get, hasDependencyPath, list, recoverExpiredLeases, renewLease, stats, transaction, transition };
}

module.exports = { PRIORITY_SCORE, createJobStore };
