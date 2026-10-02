"use strict";

const crypto = require("crypto");

const MEMORY_STATUSES = new Set(["confirmed", "inferred", "temporary", "rejected", "expired", "blocked"]);
const MEMORY_TYPES = new Set(["identity_role", "work_preference", "permanent_constraint", "objective", "active_project", "commitment", "deadline", "decision", "professional_relationship", "observed_habit", "tooling", "temporary_information", "outcome", "feedback"]);
const PROJECT_STATUSES = new Set(["todo", "in_progress", "blocked", "waiting", "completed", "archived"]);
const INBOX_STATUSES = new Set(["detected", "clarification_needed", "ready", "proposed", "accepted", "snoozed", "dismissed", "completed", "expired"]);
const SECRET_PATTERN = /(?:sk-[A-Za-z0-9_-]{12,}|api[_ -]?key|password|mot de passe|BEGIN (?:RSA |EC )?PRIVATE KEY|bearer\s+[A-Za-z0-9._-]+)/i;

function nowIso() { return new Date().toISOString(); }
function json(value, fallback) { try { return JSON.stringify(value ?? fallback); } catch { return JSON.stringify(fallback); } }
function parse(value, fallback) { try { return JSON.parse(value); } catch { return fallback; } }
function bounded(value, max = 1000) { return String(value || "").replace(/[\0\r]/g, " ").trim().slice(0, max); }
function assertSafeMemory(item) {
  const serialized = json(item.value, {});
  if (SECRET_PATTERN.test(serialized)) throw Object.assign(new Error("Cette information sensible ne peut pas devenir un souvenir."), { code: "SENSITIVE_MEMORY" });
}
function rowMemory(row) {
  if (!row) return null;
  return { id: row.id, type: row.type, subject: row.subject, value: parse(row.value_json, {}), sourceType: row.source_type, sourceReference: row.source_reference, status: row.status, confidence: row.confidence, createdAt: row.created_at, updatedAt: row.updated_at, lastConfirmedAt: row.last_confirmed_at, expiresAt: row.expires_at, sensitivity: row.sensitivity, useAllowed: Boolean(row.use_allowed), rejectedAt: row.rejected_at, metadata: parse(row.metadata_json, {}) };
}
function rowProject(row) {
  if (!row) return null;
  return { id: row.id, name: row.name, objective: row.objective, currentState: row.current_state, status: row.status, nextAction: row.next_action, deadline: row.deadline, priority: row.priority, estimatedMinutesRemaining: row.estimated_minutes_remaining, actualMinutesSpent: row.actual_minutes_spent, decisions: parse(row.decisions_json, []), blockers: parse(row.blockers_json, []), importantFiles: parse(row.important_files_json, []), conversations: parse(row.conversations_json, []), emails: parse(row.emails_json, []), events: parse(row.events_json, []), githubUrl: row.github_url, figmaUrl: row.figma_url, lastActivityAt: row.last_activity_at, lastOutcome: row.last_outcome, lastCheckedAt: row.last_checked_at, sourceReference: row.source_reference, updatedAt: row.updated_at };
}
function rowInbox(row) {
  if (!row) return null;
  return { id: row.id, sourceType: row.source_type, sourceReference: row.source_reference, title: row.title, action: row.action, projectId: row.project_id, deadline: row.deadline, estimatedDuration: row.estimated_duration, importance: row.importance, energyRequired: row.energy_required, requiredContext: row.required_context, status: row.status, detectedAt: row.detected_at, updatedAt: row.updated_at, expiresAt: row.expires_at, sensitivity: row.sensitivity, sourceUpdatedAt: row.source_updated_at, sourceStale: Boolean(row.source_stale) };
}
function rowRecommendation(row) {
  if (!row) return null;
  return {
    id: row.id, hash: row.hash, inboxItemId: row.inbox_item_id,
    score: Number(row.score) || 0, priorityLevel: row.priority_level,
    payload: parse(row.payload_json, {}), firstDetectedAt: row.first_detected_at,
    lastPresentedAt: row.last_presented_at, presentationCount: Number(row.presentation_count) || 0,
    userResponse: row.user_response, cooldownUntil: row.cooldown_until,
    reactivationKey: row.reactivation_key, expiresAt: row.expires_at, status: row.status,
    subjectScope: row.subject_scope || null,
  };
}

function createSqliteRepository(wrapper) {
  const db = wrapper.database;
  function transaction(operation) {
    const ownsTransaction = db.isTransaction !== true;
    const savepoint = ownsTransaction ? null : `personal_intelligence_${crypto.randomUUID().replaceAll("-", "")}`;
    if (ownsTransaction) db.exec("BEGIN IMMEDIATE"); else db.exec(`SAVEPOINT ${savepoint}`);
    try {
      const result = operation();
      if (ownsTransaction) db.exec("COMMIT"); else db.exec(`RELEASE SAVEPOINT ${savepoint}`);
      return result;
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
  function hasMigration(id) { return Boolean(db.prepare("SELECT 1 FROM schema_migrations WHERE name=?").get(id)); }
  function markMigration(id, details) { db.prepare("INSERT OR IGNORE INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)").run(1000 + Math.abs([...id].reduce((a,c)=>a+c.charCodeAt(0),0)), id, nowIso()); return details; }
  function upsertMemory(item) {
    assertSafeMemory(item); const timestamp = nowIso(); const status = MEMORY_STATUSES.has(item.status) ? item.status : "inferred"; const type = MEMORY_TYPES.has(item.type) ? item.type : "temporary_information"; const confidence = Math.max(0, Math.min(1, Number(item.confidence) || 0));
    const existing = item.id ? db.prepare("SELECT * FROM memory_items WHERE id=?").get(item.id) : null;
    if (existing?.status === "inferred" && status === "confirmed" && item.explicitConfirmation !== true) throw Object.assign(new Error("Une hypothèse exige une confirmation explicite."), { code: "EXPLICIT_CONFIRMATION_REQUIRED" });
    const id = item.id || crypto.randomUUID();
    db.prepare(`INSERT INTO memory_items(id,type,subject,value_json,source_type,source_reference,status,confidence,created_at,updated_at,last_confirmed_at,expires_at,sensitivity,use_allowed,rejected_at,metadata_json)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET type=excluded.type,subject=excluded.subject,value_json=excluded.value_json,source_type=excluded.source_type,source_reference=excluded.source_reference,status=excluded.status,confidence=excluded.confidence,updated_at=excluded.updated_at,last_confirmed_at=excluded.last_confirmed_at,expires_at=excluded.expires_at,sensitivity=excluded.sensitivity,use_allowed=excluded.use_allowed,rejected_at=excluded.rejected_at,metadata_json=excluded.metadata_json`)
      .run(id, type, bounded(item.subject, 240) || "Information", json(item.value, {}), bounded(item.sourceType, 80) || "user", bounded(item.sourceReference, 300) || null, status, confidence, existing?.created_at || timestamp, timestamp, item.lastConfirmedAt || (status === "confirmed" ? timestamp : existing?.last_confirmed_at || null), item.expiresAt || null, bounded(item.sensitivity, 30) || "normal", item.useAllowed === false ? 0 : 1, status === "rejected" ? timestamp : null, json(item.metadata, {}));
    if (wrapper.ftsAvailable) { db.prepare("DELETE FROM memory_items_fts WHERE id=?").run(id); db.prepare("INSERT INTO memory_items_fts(id,subject,value_text) VALUES(?,?,?)").run(id, bounded(item.subject, 240), bounded(`${item.sourceReference || ""} ${typeof item.value === "string" ? item.value : json(item.value, {})}`, 4000)); }
    return getMemory(id);
  }
  function getMemory(id) { return rowMemory(db.prepare("SELECT * FROM memory_items WHERE id=?").get(id)); }
  function listMemories(filters = {}) {
    expireMemories(); const clauses = [], values = [];
    if (filters.status) { clauses.push("status=?"); values.push(filters.status); }
    if (filters.type) { clauses.push("type=?"); values.push(filters.type); }
    if (filters.usableOnly) clauses.push("use_allowed=1 AND status NOT IN ('expired','rejected','blocked')");
    return db.prepare(`SELECT * FROM memory_items ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY updated_at DESC LIMIT ?`).all(...values, Math.min(500, Number(filters.limit) || 200)).map(rowMemory);
  }
  function searchMemories(query, filters = {}) {
    const term = bounded(query, 200); if (!term) return listMemories(filters);
    if (wrapper.ftsAvailable) {
      try {
        const tokens = term.replace(/[^\p{L}\p{N}\s-]/gu, " ").trim().split(/\s+/).filter((t) => t.length > 2);
        const matchPattern = tokens.length > 1 ? tokens.map((t) => `"${t}"*`).join(" OR ") : term.replace(/[^\p{L}\p{N}\s-]/gu, " ");
        const results = db.prepare("SELECT m.* FROM memory_items_fts f JOIN memory_items m ON m.id=f.id WHERE memory_items_fts MATCH ? ORDER BY rank LIMIT ?").all(matchPattern, Math.min(100, Number(filters.limit) || 50)).map(rowMemory);
        if (results.length) return results;
      } catch {}
    }
    return db.prepare("SELECT * FROM memory_items WHERE lower(subject) LIKE ? OR lower(value_json) LIKE ? OR lower(source_reference) LIKE ? OR lower(metadata_json) LIKE ? ORDER BY updated_at DESC LIMIT ?").all(`%${term.toLowerCase()}%`, `%${term.toLowerCase()}%`, `%${term.toLowerCase()}%`, `%${term.toLowerCase()}%`, Math.min(100, Number(filters.limit) || 50)).map(rowMemory);
  }
  function updateMemory(id, changes) { const current = getMemory(id); if (!current) throw new Error("Souvenir introuvable."); return upsertMemory({ ...current, ...changes, id, explicitConfirmation: changes.explicitConfirmation }); }
  function confirmMemory(id) { return updateMemory(id, { status: "confirmed", confidence: 1, explicitConfirmation: true, lastConfirmedAt: nowIso() }); }
  function forgetMemory(id) { return updateMemory(id, { status: "rejected", useAllowed: false }); }
  function blockMemory(id) { return updateMemory(id, { status: "blocked", useAllowed: false }); }
  function expireMemories(at = nowIso()) { return db.prepare("UPDATE memory_items SET status='expired',use_allowed=0,updated_at=? WHERE expires_at IS NOT NULL AND expires_at<=? AND status NOT IN ('expired','rejected','blocked')").run(at, at).changes; }
  function upsertProject(item) {
    const status = PROJECT_STATUSES.has(item.status) ? item.status : "todo"; if (["in_progress"].includes(status) && !bounded(item.nextAction, 500)) throw Object.assign(new Error("Un projet actif doit avoir une prochaine action."), { code: "NEXT_ACTION_REQUIRED" });
    const id = item.id || crypto.randomUUID(); const timestamp = nowIso();
    db.prepare(`INSERT INTO projects(id,name,objective,current_state,status,next_action,deadline,priority,estimated_minutes_remaining,actual_minutes_spent,decisions_json,blockers_json,important_files_json,conversations_json,emails_json,events_json,github_url,figma_url,last_activity_at,last_outcome,last_checked_at,source_reference,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,objective=excluded.objective,current_state=excluded.current_state,status=excluded.status,next_action=excluded.next_action,deadline=excluded.deadline,priority=excluded.priority,estimated_minutes_remaining=excluded.estimated_minutes_remaining,actual_minutes_spent=excluded.actual_minutes_spent,decisions_json=excluded.decisions_json,blockers_json=excluded.blockers_json,important_files_json=excluded.important_files_json,conversations_json=excluded.conversations_json,emails_json=excluded.emails_json,events_json=excluded.events_json,github_url=excluded.github_url,figma_url=excluded.figma_url,last_activity_at=excluded.last_activity_at,last_outcome=excluded.last_outcome,last_checked_at=excluded.last_checked_at,source_reference=excluded.source_reference,updated_at=excluded.updated_at`)
      .run(id, bounded(item.name, 180) || "Projet", bounded(item.objective, 2000), bounded(item.currentState, 2000), status, bounded(item.nextAction, 500) || null, item.deadline || null, Math.max(0, Math.min(100, Number(item.priority) || 50)), item.estimatedMinutesRemaining == null ? null : Math.max(0, Number(item.estimatedMinutesRemaining) || 0), Math.max(0, Number(item.actualMinutesSpent) || 0), json(item.decisions, []), json(item.blockers, []), json(item.importantFiles, []), json(item.conversations, []), json(item.emails, []), json(item.events, []), bounded(item.githubUrl, 500) || null, bounded(item.figmaUrl, 500) || null, item.lastActivityAt || null, bounded(item.lastOutcome, 1000) || null, item.lastCheckedAt || null, bounded(item.sourceReference, 300) || null, timestamp);
    return getProject(id);
  }
  function getProject(id) { return rowProject(db.prepare("SELECT * FROM projects WHERE id=?").get(id)); }
  function listProjects() { return db.prepare("SELECT * FROM projects ORDER BY priority DESC, updated_at DESC").all().map(rowProject); }
  function upsertInbox(item) {
    const sourceType = bounded(item.sourceType, 80); const sourceReference = bounded(item.sourceReference, 300); if (!sourceType || !sourceReference) throw new Error("Source de boîte d’entrée obligatoire.");
    const current = db.prepare("SELECT * FROM inbox_items WHERE source_type=? AND source_reference=?").get(sourceType, sourceReference); const id = current?.id || item.id || crypto.randomUUID(); const status = INBOX_STATUSES.has(item.status) ? item.status : current?.status || "detected"; const timestamp = nowIso();
    db.prepare(`INSERT INTO inbox_items(id,source_type,source_reference,title,action,project_id,deadline,estimated_duration,importance,energy_required,required_context,status,detected_at,updated_at,expires_at,sensitivity,source_updated_at,source_stale)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source_type,source_reference) DO UPDATE SET title=excluded.title,action=excluded.action,project_id=excluded.project_id,deadline=excluded.deadline,estimated_duration=excluded.estimated_duration,importance=excluded.importance,energy_required=excluded.energy_required,required_context=excluded.required_context,status=excluded.status,updated_at=excluded.updated_at,expires_at=excluded.expires_at,sensitivity=excluded.sensitivity,source_updated_at=excluded.source_updated_at,source_stale=excluded.source_stale`)
      .run(id, sourceType, sourceReference, bounded(item.title, 300), bounded(item.action, 800), item.projectId || null, item.deadline || null, item.estimatedDuration == null ? null : Math.max(5, Number(item.estimatedDuration) || 0), Math.max(0, Math.min(1, Number(item.importance) || 0.5)), bounded(item.energyRequired, 30), bounded(item.requiredContext, 500), status, current?.detected_at || timestamp, timestamp, item.expiresAt || null, bounded(item.sensitivity, 30) || "normal", item.sourceUpdatedAt || null, item.sourceStale ? 1 : 0);
    return rowInbox(db.prepare("SELECT * FROM inbox_items WHERE id=?").get(id));
  }
  function listInbox(filters = {}) { const clauses = [], values = []; if (filters.status) { clauses.push("status=?"); values.push(filters.status); } if (filters.projectId === null) clauses.push("project_id IS NULL"); else if (filters.projectId) { clauses.push("project_id=?"); values.push(filters.projectId); } return db.prepare(`SELECT * FROM inbox_items ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY importance DESC, deadline ASC LIMIT ?`).all(...values, Math.min(500, Number(filters.limit) || 200)).map(rowInbox); }
  function updateInbox(id, changes) { const current = rowInbox(db.prepare("SELECT * FROM inbox_items WHERE id=?").get(id)); if (!current) throw new Error("Élément introuvable."); return upsertInbox({ ...current, ...changes, id }); }
  function saveRecommendation(item) { const timestamp = nowIso(); db.prepare(`INSERT INTO recommendations(id,hash,inbox_item_id,score,priority_level,payload_json,first_detected_at,last_presented_at,presentation_count,user_response,cooldown_until,reactivation_key,expires_at,status,subject_scope) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(hash) DO UPDATE SET score=excluded.score,priority_level=excluded.priority_level,payload_json=excluded.payload_json,reactivation_key=excluded.reactivation_key,expires_at=excluded.expires_at,status=excluded.status,subject_scope=excluded.subject_scope`).run(item.id || crypto.randomUUID(), item.hash, item.inboxItemId || null, item.score, item.priorityLevel, json(item.payload, {}), item.firstDetectedAt || timestamp, item.lastPresentedAt || null, Number(item.presentationCount) || 0, item.userResponse || null, item.cooldownUntil || null, item.reactivationKey || null, item.expiresAt || null, item.status || "ready", bounded(item.subjectScope, 80) || null); return db.prepare("SELECT * FROM recommendations WHERE hash=?").get(item.hash); }
  function getRecommendationByHash(hash) { return rowRecommendation(db.prepare("SELECT * FROM recommendations WHERE hash=?").get(hash)); }
  function listRecommendations(filters = {}) {
    const clauses = [], values = [];
    if (filters.status) { clauses.push("status=?"); values.push(filters.status); }
    if (filters.subjectScope) { clauses.push("subject_scope=?"); values.push(filters.subjectScope); }
    if (filters.start) { clauses.push("COALESCE(last_presented_at, first_detected_at)>=?"); values.push(filters.start); }
    if (filters.end) { clauses.push("COALESCE(last_presented_at, first_detected_at)<?"); values.push(filters.end); }
    if (filters.activeOnly) clauses.push("status NOT IN ('dismissed','expired','ignored') AND (expires_at IS NULL OR expires_at>?)"), values.push(filters.at || nowIso());
    return db.prepare(`SELECT * FROM recommendations ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY score DESC, first_detected_at DESC LIMIT ?`)
      .all(...values, Math.min(1000, Number(filters.limit) || 200)).map(rowRecommendation);
  }
  function updateRecommendation(hash, changes = {}) {
    const current = getRecommendationByHash(hash);
    if (!current) return null;
    const next = { ...current, ...changes };
    db.prepare("UPDATE recommendations SET user_response=?,cooldown_until=?,status=?,expires_at=?,payload_json=? WHERE hash=?")
      .run(next.userResponse || null, next.cooldownUntil || null, next.status || "ready", next.expiresAt || null, json(next.payload, {}), hash);
    return getRecommendationByHash(hash);
  }
  function recordPresentation(hash, at = nowIso()) { db.prepare("UPDATE recommendations SET last_presented_at=?,presentation_count=presentation_count+1 WHERE hash=?").run(at, hash); }
  function saveFollowup(item) { const existing=item.recommendationId?db.prepare("SELECT * FROM followups WHERE recommendation_id=? AND status='pending' LIMIT 1").get(item.recommendationId):null;if(existing&&!item.id)return existing;const id = item.id || crypto.randomUUID(); db.prepare("INSERT OR REPLACE INTO followups(id,recommendation_id,project_id,status,estimated_minutes,actual_minutes,blocker,next_action,user_feedback,due_at,followed_up_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(id,item.recommendationId||null,item.projectId||null,item.status||"pending",item.estimatedMinutes||null,item.actualMinutes||null,bounded(item.blocker,500)||null,bounded(item.nextAction,500)||null,bounded(item.userFeedback,500)||null,item.dueAt||null,item.followedUpAt||null,item.createdAt||nowIso()); return db.prepare("SELECT * FROM followups WHERE id=?").get(id); }
  function listDueFollowups(at = nowIso()) { return db.prepare("SELECT * FROM followups WHERE status='pending' AND due_at<=? ORDER BY due_at LIMIT 50").all(at); }
  function recordFeedback(item) { const id=crypto.randomUUID(); db.prepare("INSERT INTO feedback_events(id,recommendation_hash,value,category,created_at,metadata_json,subject_scope) VALUES(?,?,?,?,?,?,?)").run(id,item.recommendationHash||null,bounded(item.value,60),bounded(item.category,80)||null,item.createdAt||nowIso(),json(item.metadata,{}),bounded(item.subjectScope,80)||null); return id; }
  function listFeedbackEvents(filters = {}) {
    const clauses = [], values = [];
    if (filters.start) { clauses.push("created_at>=?"); values.push(filters.start); }
    if (filters.end) { clauses.push("created_at<?"); values.push(filters.end); }
    if (filters.subjectScope) { clauses.push("subject_scope=?"); values.push(filters.subjectScope); }
    return db.prepare(`SELECT id,recommendation_hash,value,category,created_at,metadata_json,subject_scope FROM feedback_events ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY created_at LIMIT ?`)
      .all(...values, Math.min(1000, Number(filters.limit) || 500)).map((row) => ({
        id: row.id, recommendationHash: row.recommendation_hash, value: row.value,
        category: row.category, createdAt: row.created_at, metadata: parse(row.metadata_json, {}), subjectScope: row.subject_scope || null,
      }));
  }
  function recordMetric(item) { const id=crypto.randomUUID(); db.prepare("INSERT INTO metrics_events(id,metric,value,model,tool,category,created_at) VALUES(?,?,?,?,?,?,?)").run(id,bounded(item.metric,100),Number(item.value)||0,bounded(item.model,80)||null,bounded(item.tool,100)||null,bounded(item.category,80)||null,item.createdAt||nowIso()); return id; }
  function aggregateMetrics(since = new Date(0).toISOString()) { return db.prepare("SELECT metric,SUM(value) total,COUNT(*) count FROM metrics_events WHERE created_at>=? GROUP BY metric").all(since); }
  function metricBreakdown(since = new Date(0).toISOString()) { return { models: db.prepare("SELECT model,SUM(value) total FROM metrics_events WHERE created_at>=? AND model IS NOT NULL AND metric='api_requests' GROUP BY model ORDER BY total DESC").all(since), tools: db.prepare("SELECT tool,SUM(value) total FROM metrics_events WHERE created_at>=? AND tool IS NOT NULL AND metric='tools_used' GROUP BY tool ORDER BY total DESC").all(since), categories: db.prepare("SELECT category,SUM(value) total FROM metrics_events WHERE created_at>=? AND category IS NOT NULL GROUP BY category ORDER BY total DESC").all(since) }; }
  return { kind: "sqlite", transaction, hasMigration, markMigration, upsertMemory, getMemory, listMemories, searchMemories, updateMemory, confirmMemory, forgetMemory, blockMemory, expireMemories, upsertProject, getProject, listProjects, upsertInbox, listInbox, updateInbox, saveRecommendation, getRecommendationByHash, listRecommendations, updateRecommendation, recordPresentation, saveFollowup, listDueFollowups, recordFeedback, listFeedbackEvents, recordMetric, aggregateMetrics, metricBreakdown };
}

function createFallbackRepository(wrapper) {
  function data() { return wrapper.load(); } function save(value) { wrapper.save(value); }
  function transaction(fn) { return fn(); }
  function hasMigration(id) { return Boolean(data().migrations?.[id]); }
  function markMigration(id, details) { const state=data(); state.migrations={...(state.migrations||{}),[id]:{at:nowIso(),details}}; save(state); }
  function upsertMemory(item) { assertSafeMemory(item); const state=data(); const existing=state.memory_items.find(x=>x.id===item.id); if(existing?.status==="inferred"&&item.status==="confirmed"&&item.explicitConfirmation!==true) throw Object.assign(new Error("Une hypothèse exige une confirmation explicite."),{code:"EXPLICIT_CONFIRMATION_REQUIRED"}); const value={...existing,...item,id:item.id||crypto.randomUUID(),status:MEMORY_STATUSES.has(item.status)?item.status:"inferred",confidence:Math.max(0,Math.min(1,Number(item.confidence)||0)),createdAt:existing?.createdAt||nowIso(),updatedAt:nowIso(),useAllowed:item.useAllowed!==false}; state.memory_items=state.memory_items.filter(x=>x.id!==value.id); state.memory_items.push(value); save(state); return value; }
  function getMemory(id){return data().memory_items.find(x=>x.id===id)||null;} function listMemories(){return data().memory_items;} function searchMemories(q){const term=String(q).toLowerCase();return listMemories().filter(x=>json(x).toLowerCase().includes(term));} function updateMemory(id,c){const x=getMemory(id);if(!x)throw new Error("Souvenir introuvable.");return upsertMemory({...x,...c,id});}
  function upsertProject(item){const state=data();const value={...item,id:item.id||crypto.randomUUID(),updatedAt:nowIso()};state.projects=state.projects.filter(x=>x.id!==value.id);state.projects.push(value);save(state);return value;} function listProjects(){return data().projects;} function getProject(id){return listProjects().find(x=>x.id===id)||null;}
  function upsertInbox(item){const state=data();const current=state.inbox_items.find(x=>x.sourceType===item.sourceType&&x.sourceReference===item.sourceReference);const value={...current,...item,id:current?.id||item.id||crypto.randomUUID(),updatedAt:nowIso(),detectedAt:current?.detectedAt||nowIso()};state.inbox_items=state.inbox_items.filter(x=>x.id!==value.id);state.inbox_items.push(value);save(state);return value;} function listInbox(){return data().inbox_items;} function updateInbox(id,c){const x=listInbox().find(v=>v.id===id);if(!x)throw new Error("Élément introuvable.");return upsertInbox({...x,...c,id});}
  function saveRecommendation(item){const state=data();const current=state.recommendations.find(x=>x.hash===item.hash);const value={...current,...item,id:current?.id||item.id||crypto.randomUUID(),firstDetectedAt:current?.firstDetectedAt||item.firstDetectedAt||nowIso(),presentationCount:current?.presentationCount||0};state.recommendations=state.recommendations.filter(x=>x.hash!==value.hash);state.recommendations.push(value);save(state);return value;}
  function getRecommendationByHash(hash){return data().recommendations.find(x=>x.hash===hash)||null;}
  function listRecommendations(filters={}){return data().recommendations.filter((item)=>{const timestamp=item.lastPresentedAt||item.firstDetectedAt||item.last_presented_at||item.first_detected_at;return(!filters.status||item.status===filters.status)&&(!filters.subjectScope||item.subjectScope===filters.subjectScope)&&(!filters.start||timestamp>=filters.start)&&(!filters.end||timestamp<filters.end);}).slice(-(Number(filters.limit)||200)).reverse();}
  function updateRecommendation(hash,changes){const current=getRecommendationByHash(hash);return current?saveRecommendation({...current,...changes}):null;}
  function recordPresentation(hash,at=nowIso()){const current=getRecommendationByHash(hash);if(current)saveRecommendation({...current,lastPresentedAt:at,presentationCount:(current.presentationCount||0)+1});}
  function recordFeedback(item){const state=data();state.feedback_events.push({...item,id:crypto.randomUUID(),createdAt:item.createdAt||nowIso()});save(state);}
  function listFeedbackEvents(filters={}){return data().feedback_events.filter((item)=>(!filters.start||(item.createdAt||item.created_at)>=filters.start)&&(!filters.end||(item.createdAt||item.created_at)<filters.end)&&(!filters.subjectScope||item.subjectScope===filters.subjectScope)).slice(0,Number(filters.limit)||500);}
  function recordMetric(item){const state=data();state.metrics_events.push({...item,id:crypto.randomUUID(),createdAt:item.createdAt||nowIso()});save(state);}
  function aggregateMetrics(since=new Date(0).toISOString()){const totals=new Map();for(const item of data().metrics_events.filter(x=>(x.createdAt||"")>=since))totals.set(item.metric,(totals.get(item.metric)||0)+(Number(item.value)||0));return [...totals].map(([metric,total])=>({metric,total,count:1}));}
  return {kind:"json-fallback",transaction,hasMigration,markMigration,upsertMemory,getMemory,listMemories,searchMemories,updateMemory,confirmMemory:id=>updateMemory(id,{status:"confirmed",confidence:1,explicitConfirmation:true}),forgetMemory:id=>updateMemory(id,{status:"rejected",useAllowed:false}),blockMemory:id=>updateMemory(id,{status:"blocked",useAllowed:false}),expireMemories:()=>0,upsertProject,getProject,listProjects,upsertInbox,listInbox,updateInbox,saveRecommendation,getRecommendationByHash,listRecommendations,updateRecommendation,recordPresentation,saveFollowup:()=>null,listDueFollowups:()=>[],recordFeedback,listFeedbackEvents,recordMetric,aggregateMetrics,metricBreakdown:()=>({models:[],tools:[],categories:[]})};
}

function createPersonalIntelligenceRepository(wrapper) { return wrapper.kind === "sqlite" ? createSqliteRepository(wrapper) : createFallbackRepository(wrapper); }

module.exports = { INBOX_STATUSES, MEMORY_STATUSES, MEMORY_TYPES, PROJECT_STATUSES, SECRET_PATTERN, createPersonalIntelligenceRepository };
