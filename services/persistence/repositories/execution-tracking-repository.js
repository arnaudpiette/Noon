"use strict";

const crypto = require("crypto");

function parse(value, fallback) { try { return JSON.parse(value); } catch { return fallback; } }
function json(value, fallback) { try { return JSON.stringify(value ?? fallback); } catch { return JSON.stringify(fallback); } }
function rowItem(row) {
  if (!row) return null;
  return {
    executionItemId: row.id, actionId: row.action_id, planId: row.plan_id,
    planBlockId: row.plan_block_id, subjectScope: row.subject_scope,
    source: row.source, sourceRef: row.source_ref,
    plannedStart: row.planned_start, plannedEnd: row.planned_end,
    actualStart: row.actual_start, actualEnd: row.actual_end,
    status: row.status, progress: row.progress == null ? null : Number(row.progress),
    confidence: Number(row.confidence), completionSource: row.completion_source,
    blocker: parse(row.blocker_json, null),
    remainingDurationMinutes: row.remaining_duration_minutes,
    priorityScore: Number(row.priority_score) || 0, dueAt: row.due_at,
    dependencies: parse(row.dependencies_json, []), manualMove: Boolean(row.manual_move),
    deferredUntil: row.deferred_until, lastEventAt: row.last_event_at,
    version: Number(row.version), createdAt: row.created_at, lastUpdatedAt: row.updated_at,
  };
}

function createSqliteRepository(wrapper) {
  const db = wrapper.database;
  function get(id) { return rowItem(db.prepare("SELECT * FROM execution_items WHERE id=?").get(id)); }
  function findByAction(actionId, scope = "arnaud") {
    return db.prepare("SELECT * FROM execution_items WHERE action_id=? AND subject_scope=? ORDER BY updated_at DESC").all(actionId, scope).map(rowItem);
  }
  function list(filters = {}) {
    const clauses = [], values = [];
    if (filters.status) { clauses.push("status=?"); values.push(filters.status); }
    if (filters.subjectScope) { clauses.push("subject_scope=?"); values.push(filters.subjectScope); }
    if (filters.planId) { clauses.push("plan_id=?"); values.push(filters.planId); }
    return db.prepare(`SELECT * FROM execution_items ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY planned_start, updated_at LIMIT ?`)
      .all(...values, Math.min(1000, Number(filters.limit) || 500)).map(rowItem);
  }
  function insert(item) {
    const timestamp = item.lastUpdatedAt || new Date().toISOString();
    db.prepare(`INSERT INTO execution_items(id,action_id,plan_id,plan_block_id,subject_scope,source,source_ref,planned_start,planned_end,actual_start,actual_end,status,progress,confidence,completion_source,blocker_json,notes_encrypted,remaining_duration_minutes,priority_score,due_at,dependencies_json,manual_move,deferred_until,last_event_at,version,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(item.executionItemId, item.actionId, item.planId || null, item.planBlockId || null,
        item.subjectScope || "arnaud", item.source || "local", item.sourceRef || null,
        item.plannedStart || null, item.plannedEnd || null, item.actualStart || null,
        item.actualEnd || null, item.status, item.progress ?? null, item.confidence,
        item.completionSource || null, item.blocker ? json(item.blocker, null) : null,
        null, item.remainingDurationMinutes ?? null, Number(item.priorityScore) || 0,
        item.dueAt || null, json(item.dependencies, []), item.manualMove ? 1 : 0,
        item.deferredUntil || null, item.lastEventAt || timestamp, 1, timestamp, timestamp);
    return get(item.executionItemId);
  }
  function update(id, expectedVersion, changes) {
    const current = get(id); if (!current) return null;
    const next = { ...current, ...changes, version: current.version + 1, lastUpdatedAt: changes.lastUpdatedAt || new Date().toISOString() };
    const result = db.prepare(`UPDATE execution_items SET planned_start=?,planned_end=?,actual_start=?,actual_end=?,status=?,progress=?,confidence=?,completion_source=?,blocker_json=?,remaining_duration_minutes=?,priority_score=?,due_at=?,dependencies_json=?,manual_move=?,deferred_until=?,last_event_at=?,version=?,updated_at=? WHERE id=? AND version=?`)
      .run(next.plannedStart || null, next.plannedEnd || null, next.actualStart || null,
        next.actualEnd || null, next.status, next.progress ?? null, next.confidence,
        next.completionSource || null, next.blocker ? json(next.blocker, null) : null,
        next.remainingDurationMinutes ?? null, Number(next.priorityScore) || 0,
        next.dueAt || null, json(next.dependencies, []), next.manualMove ? 1 : 0,
        next.deferredUntil || null, next.lastEventAt, next.version, next.lastUpdatedAt,
        id, expectedVersion);
    if (result.changes !== 1) throw Object.assign(new Error("État d’exécution modifié simultanément."), { code: "EXECUTION_VERSION_CONFLICT" });
    return get(id);
  }
  function appendEvent(event) {
    try {
      db.prepare("INSERT INTO execution_events(id,execution_item_id,event_key,event_type,from_status,to_status,source,confidence,occurred_at,reason_code,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
        .run(event.id || crypto.randomUUID(), event.executionItemId, event.eventKey, event.eventType,
          event.fromStatus || null, event.toStatus, event.source, event.confidence,
          event.occurredAt, event.reasonCode || null, new Date().toISOString());
      return true;
    } catch (error) {
      if (/UNIQUE/.test(String(error.message))) return false;
      throw error;
    }
  }
  function getEvent(eventKey) { return db.prepare("SELECT * FROM execution_events WHERE event_key=?").get(eventKey) || null; }
  function recordDuration(scopeKey, estimated, actual) {
    const current = db.prepare("SELECT * FROM duration_statistics WHERE scope_key=?").get(scopeKey);
    const samples = [...parse(current?.samples_json, []), actual].slice(-50);
    db.prepare(`INSERT INTO duration_statistics(scope_key,sample_count,total_estimated_minutes,total_actual_minutes,samples_json,updated_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(scope_key) DO UPDATE SET sample_count=excluded.sample_count,total_estimated_minutes=excluded.total_estimated_minutes,total_actual_minutes=excluded.total_actual_minutes,samples_json=excluded.samples_json,updated_at=excluded.updated_at`)
      .run(scopeKey, (current?.sample_count || 0) + 1, (current?.total_estimated_minutes || 0) + estimated,
        (current?.total_actual_minutes || 0) + actual, json(samples, []), new Date().toISOString());
  }
  function getDurationStats(scopeKey) {
    const row = db.prepare("SELECT * FROM duration_statistics WHERE scope_key=?").get(scopeKey);
    if (!row) return null;
    const samples = parse(row.samples_json, []).sort((a, b) => a - b);
    return { scopeKey, sampleCount: row.sample_count,
      meanActualMinutes: row.total_actual_minutes / row.sample_count,
      meanEstimateErrorMinutes: (row.total_actual_minutes - row.total_estimated_minutes) / row.sample_count,
      medianActualMinutes: samples[Math.floor(samples.length / 2)] || null,
      confidence: row.sample_count >= 5 ? "high" : row.sample_count >= 3 ? "medium" : "low" };
  }
  function cleanup(before) {
    return db.prepare("DELETE FROM execution_events WHERE created_at<? AND execution_item_id IN (SELECT id FROM execution_items WHERE status IN ('completed','cancelled'))").run(before).changes;
  }
  return { kind: "sqlite", appendEvent, cleanup, findByAction, get, getDurationStats, getEvent, insert, list, recordDuration, update };
}

function createFallbackRepository(wrapper) {
  const load = () => wrapper.load(); const save = (state) => wrapper.save(state);
  const get = (id) => load().execution_items.find((item) => item.executionItemId === id) || null;
  const list = (filters = {}) => load().execution_items.filter((item) => (!filters.status || item.status === filters.status) && (!filters.subjectScope || item.subjectScope === filters.subjectScope));
  function insert(item) { const state=load();const value={...item,version:1,createdAt:item.lastUpdatedAt,lastUpdatedAt:item.lastUpdatedAt};state.execution_items.push(value);save(state);return value; }
  function update(id,expectedVersion,changes){const state=load();const index=state.execution_items.findIndex(x=>x.executionItemId===id);if(index<0)return null;if(state.execution_items[index].version!==expectedVersion)throw Object.assign(new Error("État d’exécution modifié simultanément."),{code:"EXECUTION_VERSION_CONFLICT"});state.execution_items[index]={...state.execution_items[index],...changes,version:expectedVersion+1};save(state);return state.execution_items[index];}
  function appendEvent(event){const state=load();if(state.execution_events.some(x=>x.eventKey===event.eventKey))return false;state.execution_events.push(event);save(state);return true;}
  function recordDuration(scopeKey,estimated,actual){const state=load();let row=state.duration_statistics.find(x=>x.scopeKey===scopeKey);if(!row){row={scopeKey,sampleCount:0,totalEstimatedMinutes:0,totalActualMinutes:0,samples:[]};state.duration_statistics.push(row);}row.sampleCount+=1;row.totalEstimatedMinutes+=estimated;row.totalActualMinutes+=actual;row.samples=[...row.samples,actual].slice(-50);save(state);}
  function getDurationStats(scopeKey){const row=load().duration_statistics.find(x=>x.scopeKey===scopeKey);if(!row)return null;const samples=[...row.samples].sort((a,b)=>a-b);return{...row,meanActualMinutes:row.totalActualMinutes/row.sampleCount,meanEstimateErrorMinutes:(row.totalActualMinutes-row.totalEstimatedMinutes)/row.sampleCount,medianActualMinutes:samples[Math.floor(samples.length/2)],confidence:row.sampleCount>=5?"high":row.sampleCount>=3?"medium":"low"};}
  return {kind:"json-fallback",get,list,findByAction:(id,scope="arnaud")=>list({subjectScope:scope}).filter(x=>x.actionId===id),insert,update,appendEvent,getEvent:(key)=>load().execution_events.find(x=>x.eventKey===key)||null,recordDuration,getDurationStats,cleanup:()=>0};
}

function createExecutionTrackingRepository(wrapper) {
  return wrapper.kind === "sqlite" ? createSqliteRepository(wrapper) : createFallbackRepository(wrapper);
}

module.exports = { createExecutionTrackingRepository };
