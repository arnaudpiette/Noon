"use strict";

function parse(value, fallback) { try { return JSON.parse(value); } catch { return fallback; } }
function rowSession(row) {
  if (!row) return null;
  return {
    id: row.id, conversationId: row.conversation_id, profileScope: row.profile_scope,
    workspaceId: row.workspace_id, projectId: row.project_id, mode: row.mode,
    status: row.status, currentTaskRef: parse(row.current_task_json, null),
    currentArtifactRef: parse(row.current_artifact_json, null),
    currentSearchRef: parse(row.current_search_json, null),
    currentPlanRef: parse(row.current_plan_json, null),
    activeExecutionId: row.active_execution_id,
    pendingApprovalIds: parse(row.pending_approval_ids_json, []),
    recentEntityRefs: parse(row.recent_entity_refs_json, []),
    conversationSummary: parse(row.summary_json, null),
    resumeCheckpoint: parse(row.resume_checkpoint_json, null),
    lastChannel: row.last_channel, recoveredFromCrash: Boolean(row.recovered_from_crash),
    version: Number(row.version) || 1, startedAt: row.started_at,
    lastActivityAt: row.last_activity_at, updatedAt: row.updated_at, closedAt: row.closed_at,
  };
}

function dbRecord(session) {
  return [session.id, session.conversationId, session.profileScope, session.workspaceId,
    session.projectId, session.mode, session.status, JSON.stringify(session.currentTaskRef),
    JSON.stringify(session.currentArtifactRef), JSON.stringify(session.currentSearchRef),
    JSON.stringify(session.currentPlanRef), session.activeExecutionId,
    JSON.stringify(session.pendingApprovalIds || []), JSON.stringify(session.recentEntityRefs || []),
    JSON.stringify(session.conversationSummary), JSON.stringify(session.resumeCheckpoint),
    session.lastChannel, session.recoveredFromCrash ? 1 : 0, session.version,
    session.startedAt, session.lastActivityAt, session.updatedAt, session.closedAt];
}

function createSessionContinuityRepository(wrapper) {
  if (wrapper?.kind === "sqlite") {
    const db = wrapper.database;
    const save = db.prepare(`INSERT INTO continuity_sessions(
      id,conversation_id,profile_scope,workspace_id,project_id,mode,status,
      current_task_json,current_artifact_json,current_search_json,current_plan_json,
      active_execution_id,pending_approval_ids_json,recent_entity_refs_json,
      summary_json,resume_checkpoint_json,last_channel,recovered_from_crash,version,
      started_at,last_activity_at,updated_at,closed_at)
      VALUES(${new Array(23).fill("?").join(",")})
      ON CONFLICT(id) DO UPDATE SET conversation_id=excluded.conversation_id,
      profile_scope=excluded.profile_scope,workspace_id=excluded.workspace_id,
      project_id=excluded.project_id,mode=excluded.mode,status=excluded.status,
      current_task_json=excluded.current_task_json,current_artifact_json=excluded.current_artifact_json,
      current_search_json=excluded.current_search_json,current_plan_json=excluded.current_plan_json,
      active_execution_id=excluded.active_execution_id,
      pending_approval_ids_json=excluded.pending_approval_ids_json,
      recent_entity_refs_json=excluded.recent_entity_refs_json,summary_json=excluded.summary_json,
      resume_checkpoint_json=excluded.resume_checkpoint_json,last_channel=excluded.last_channel,
      recovered_from_crash=excluded.recovered_from_crash,version=excluded.version,
      last_activity_at=excluded.last_activity_at,updated_at=excluded.updated_at,closed_at=excluded.closed_at`);
    return {
      save(session) { save.run(...dbRecord(session)); return session; },
      get(id) { return rowSession(db.prepare("SELECT * FROM continuity_sessions WHERE id=?").get(id)); },
      findByConversation(conversationId, profileScope = "arnaud") { return rowSession(db.prepare("SELECT * FROM continuity_sessions WHERE conversation_id=? AND profile_scope=? ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'idle' THEN 1 WHEN 'suspended' THEN 2 ELSE 3 END,last_activity_at DESC LIMIT 1").get(conversationId, profileScope)); },
      list({ profileScope = null, statuses = null, limit = 100 } = {}) { const rows = db.prepare(`SELECT * FROM continuity_sessions ${profileScope ? "WHERE profile_scope=?" : ""} ORDER BY last_activity_at DESC LIMIT ?`).all(...(profileScope ? [profileScope] : []), Math.max(1, Math.min(500, Number(limit) || 100))); return rows.map(rowSession).filter((item) => !statuses || statuses.includes(item.status)); },
      saveCheckpoint(checkpoint) { db.prepare("INSERT OR IGNORE INTO continuity_checkpoints(id,session_id,fingerprint,payload_json,created_at) VALUES(?,?,?,?,?)").run(checkpoint.checkpointId, checkpoint.sessionId, checkpoint.fingerprint, JSON.stringify(checkpoint), checkpoint.createdAt); return checkpoint; },
      checkpoints(sessionId, limit = 20) { return db.prepare("SELECT payload_json FROM continuity_checkpoints WHERE session_id=? ORDER BY created_at DESC LIMIT ?").all(sessionId, Math.max(1, Math.min(100, Number(limit) || 20))).map((row) => parse(row.payload_json, null)).filter(Boolean); },
      saveSegment(segment) { db.prepare("INSERT OR REPLACE INTO conversation_segments(id,conversation_id,session_id,title,workspace_id,summary_ref,started_at,ended_at,reason) VALUES(?,?,?,?,?,?,?,?,?)").run(segment.segmentId, segment.conversationId, segment.sessionId, segment.title, segment.workspaceId, segment.summaryRef, segment.startedAt, segment.endedAt, segment.reason); return segment; },
      segments(conversationId) { return db.prepare("SELECT * FROM conversation_segments WHERE conversation_id=? ORDER BY started_at").all(conversationId).map((row) => ({ segmentId: row.id, conversationId: row.conversation_id, sessionId: row.session_id, title: row.title, workspaceId: row.workspace_id, summaryRef: row.summary_ref, startedAt: row.started_at, endedAt: row.ended_at, reason: row.reason })); },
    };
  }
  function mutate(operation) { const state = wrapper.load(); state.continuity_sessions ||= []; state.continuity_checkpoints ||= []; state.conversation_segments ||= []; const result = operation(state); wrapper.save(state); return result; }
  return {
    save(session) { return mutate((state) => { state.continuity_sessions = state.continuity_sessions.filter((item) => item.id !== session.id); state.continuity_sessions.push(structuredClone(session)); return session; }); },
    get(id) { return structuredClone((wrapper.load().continuity_sessions || []).find((item) => item.id === id) || null); },
    findByConversation(conversationId, profileScope = "arnaud") { return structuredClone((wrapper.load().continuity_sessions || []).filter((item) => item.conversationId === conversationId && item.profileScope === profileScope).sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))[0] || null); },
    list({ profileScope = null, statuses = null, limit = 100 } = {}) { return (wrapper.load().continuity_sessions || []).filter((item) => (!profileScope || item.profileScope === profileScope) && (!statuses || statuses.includes(item.status))).sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt)).slice(0, limit).map(structuredClone); },
    saveCheckpoint(checkpoint) { return mutate((state) => { if (!state.continuity_checkpoints.some((item) => item.sessionId === checkpoint.sessionId && item.fingerprint === checkpoint.fingerprint)) state.continuity_checkpoints.push(structuredClone(checkpoint)); return checkpoint; }); },
    checkpoints(sessionId, limit = 20) { return (wrapper.load().continuity_checkpoints || []).filter((item) => item.sessionId === sessionId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit).map(structuredClone); },
    saveSegment(segment) { return mutate((state) => { state.conversation_segments = state.conversation_segments.filter((item) => item.segmentId !== segment.segmentId); state.conversation_segments.push(structuredClone(segment)); return segment; }); },
    segments(conversationId) { return (wrapper.load().conversation_segments || []).filter((item) => item.conversationId === conversationId).map(structuredClone); },
  };
}

module.exports = { createSessionContinuityRepository, rowSession };
