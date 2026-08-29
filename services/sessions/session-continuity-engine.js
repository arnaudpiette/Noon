"use strict";

const crypto = require("crypto");

const SESSION_STATES = new Set(["active", "idle", "suspended", "closed"]);
const MODES = new Set(["DEV", "DA", "SOUTENANCE", "FOCUS", "NORMAL"]);
const ENTITY_TTLS = Object.freeze({ search_result: 10 * 60_000, search: 15 * 60_000, file: 30 * 60_000, event: 30 * 60_000, artifact: 7 * 24 * 60 * 60_000, task: 7 * 24 * 60 * 60_000, workspace: 7 * 24 * 60 * 60_000, conversation: 7 * 24 * 60 * 60_000 });

class SessionContinuityError extends Error {
  constructor(code, message) { super(message); this.name = "SessionContinuityError"; this.code = code; }
}

function clean(value, max = 200) { return value == null ? null : String(value).replace(/[\0\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) || null; }
function safeRef(value, type = null) {
  if (!value || typeof value !== "object") return null;
  const ref = { id: clean(value.id || value.artifactId || value.taskId || value.searchId || value.executionId, 160), type: clean(value.type || type, 40), label: clean(value.label || value.title, 160), version: Number.isFinite(Number(value.version)) ? Number(value.version) : null, workspaceId: clean(value.workspaceId, 160), projectId: clean(value.projectId, 160), status: clean(value.status, 40), source: clean(value.source, 60) };
  if (ref.id && ref.type === "search" && Array.isArray(value.results)) {
    ref.results = value.results.map((item) => safeRef({ ...item, type: "search_result" }, "search_result")).filter(Boolean).slice(0, 20);
  }
  return ref.id ? ref : null;
}
function hash(value) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24); }
function clone(value) { return value == null ? value : structuredClone(value); }
function estimateTokens(value) { return Math.ceil(String(value || "").length / 4); }

function createSessionContinuityEngine({
  repository, workspaceEngine = null, approvalProvider = () => [],
  executionProvider = () => [], artifactProvider = null, historyTailProvider = () => [],
  historySearchProvider = null, summaryUpdater = null, contextInvalidator = () => {},
  observability = null, now = () => Date.now(), recentEntityTtlMs = 30 * 60_000,
  maxRecentEntities = 20, summaryMessageThreshold = 6, summaryCharacterThreshold = 6000,
  summaryMaxCharacters = 6000, historyTailLimit = 12,
} = {}) {
  if (!repository) throw new TypeError("Session repository obligatoire.");
  const activeCache = new Map();
  const emit = (event, metadata = {}) => { try { observability?.(event, metadata); } catch {} };
  const timestamp = () => new Date(now()).toISOString();
  const cache = (session) => { activeCache.set(session.id, clone(session)); return clone(session); };
  const requireSession = (id) => { const session = activeCache.get(id) || repository.get(id); if (!session) throw new SessionContinuityError("SESSION_NOT_FOUND", "Session introuvable."); return clone(session); };
  const persist = (session, event, metadata = {}) => {
    session.version = (Number(session.version) || 0) + 1;
    session.updatedAt = timestamp();
    repository.save(session);
    cache(session);
    if (event) emit(event, { sessionId: session.id, conversationId: session.conversationId, status: session.status, ...metadata });
    return clone(session);
  };

  function createSession({ conversationId, workspaceId = null, projectId = null, mode = "NORMAL", channel = "chat", profileScope = "arnaud" } = {}) {
    const safeConversationId = clean(conversationId, 160);
    if (!safeConversationId) throw new SessionContinuityError("CONVERSATION_REQUIRED", "Conversation requise.");
    const at = timestamp();
    const session = {
      id: `session-${crypto.randomUUID()}`, conversationId: safeConversationId,
      profileScope: clean(profileScope, 80) || "arnaud", workspaceId: clean(workspaceId, 160),
      projectId: clean(projectId, 160), mode: MODES.has(String(mode).toUpperCase()) ? String(mode).toUpperCase() : "NORMAL",
      status: "active", currentTaskRef: null, currentArtifactRef: null,
      currentSearchRef: null, currentPlanRef: null, activeExecutionId: null,
      pendingApprovalIds: [], recentEntityRefs: [], conversationSummary: null,
      resumeCheckpoint: null, lastChannel: clean(channel, 30) || "chat",
      recoveredFromCrash: false, version: 0, startedAt: at,
      lastActivityAt: at, updatedAt: at, closedAt: null,
    };
    return persist(session, "session_created", { channel: session.lastChannel });
  }

  function resolveSession({ conversationId, workspaceId = null, projectId = null, mode = null, channel = "chat", profileScope = "arnaud" } = {}) {
    const started = now();
    let session = repository.findByConversation(clean(conversationId, 160), clean(profileScope, 80) || "arnaud");
    if (!session || session.status === "closed") session = createSession({ conversationId, workspaceId, projectId, mode: mode || "NORMAL", channel, profileScope });
    else {
      const previousChannel = session.lastChannel;
      session.status = "active";
      session.lastActivityAt = timestamp();
      session.lastChannel = clean(channel, 30) || session.lastChannel;
      if (workspaceId) session.workspaceId = clean(workspaceId, 160);
      if (projectId) session.projectId = clean(projectId, 160);
      if (mode && MODES.has(String(mode).toUpperCase())) session.mode = String(mode).toUpperCase();
      session = persist(session, "session_resumed", { channel: session.lastChannel });
      if (previousChannel && previousChannel !== session.lastChannel) emit("session_channel_switched", { sessionId: session.id, from: previousChannel, to: session.lastChannel });
    }
    emit("session_resume_ms", { sessionId: session.id, value: Math.max(0, now() - started) });
    return session;
  }

  function getActiveSession({ conversationId = null, profileScope = "arnaud" } = {}) {
    if (conversationId) return repository.findByConversation(conversationId, profileScope);
    return repository.list({ profileScope, statuses: ["active", "idle"], limit: 1 })[0] || null;
  }

  function updateSession(sessionId, changes = {}, event = null) {
    const session = requireSession(sessionId);
    const oldWorkspace = session.workspaceId; const oldMode = session.mode;
    for (const field of ["workspaceId", "projectId", "activeExecutionId"]) if (field in changes) session[field] = clean(changes[field], 160);
    if (changes.mode && MODES.has(String(changes.mode).toUpperCase())) session.mode = String(changes.mode).toUpperCase();
    if (changes.status) { if (!SESSION_STATES.has(changes.status)) throw new SessionContinuityError("SESSION_STATUS_INVALID", "État de session invalide."); session.status = changes.status; }
    if (changes.lastChannel) session.lastChannel = clean(changes.lastChannel, 30);
    for (const [field, type] of [["currentTaskRef", "task"], ["currentArtifactRef", "artifact"], ["currentSearchRef", "search"], ["currentPlanRef", "plan"]]) if (field in changes) session[field] = safeRef(changes[field], type);
    if (Array.isArray(changes.pendingApprovalIds)) session.pendingApprovalIds = [...new Set(changes.pendingApprovalIds.map((item) => clean(item, 160)).filter(Boolean))].slice(0, 20);
    session.lastActivityAt = timestamp();
    const saved = persist(session, event);
    if (oldWorkspace !== saved.workspaceId) { contextInvalidator(saved.conversationId, oldWorkspace, saved.workspaceId); emit("session_workspace_changed", { sessionId: saved.id, hasWorkspace: Boolean(saved.workspaceId) }); }
    if (oldMode !== saved.mode) contextInvalidator(saved.conversationId, saved.workspaceId, saved.workspaceId);
    return saved;
  }

  function rememberEntity(sessionId, entity, { sourceTurnId = null, confidence = "high", ttlMs = null } = {}) {
    const session = requireSession(sessionId); const ref = safeRef(entity, entity?.entityType);
    if (!ref) return null;
    const at = now(); const lifetime = Math.max(1000, Number(ttlMs) || ENTITY_TTLS[ref.type] || recentEntityTtlMs);
    const value = { entityType: ref.type, entityId: ref.id, label: ref.label, version: ref.version, workspaceId: ref.workspaceId || session.workspaceId, projectId: ref.projectId || session.projectId, mentionedAt: new Date(at).toISOString(), expiresAt: new Date(at + lifetime).toISOString(), sourceTurnId: clean(sourceTurnId, 160), confidence: ["high", "medium", "low"].includes(confidence) ? confidence : "medium" };
    session.recentEntityRefs = [value, ...session.recentEntityRefs.filter((item) => !(item.entityType === value.entityType && item.entityId === value.entityId) && Date.parse(item.expiresAt) > at)].slice(0, maxRecentEntities);
    persist(session, null);
    return clone(value);
  }

  function recentEntities(sessionId, type = null) {
    const session = requireSession(sessionId); const at = now();
    const valid = session.recentEntityRefs.filter((item) => Date.parse(item.expiresAt) > at && (!type || item.entityType === type));
    if (valid.length !== session.recentEntityRefs.length) { session.recentEntityRefs = session.recentEntityRefs.filter((item) => Date.parse(item.expiresAt) > at); persist(session, null); }
    return clone(valid);
  }

  function resolveEntity(sessionId, { type = null, ordinal = null } = {}) {
    const session = requireSession(sessionId);
    const matches = type === "search_result" && Array.isArray(session.currentSearchRef?.results)
      ? session.currentSearchRef.results.map((item) => ({ entityType: "search_result", entityId: item.id, label: item.label, version: item.version, workspaceId: item.workspaceId, projectId: item.projectId, confidence: "high" }))
      : recentEntities(sessionId, type);
    if (Number.isInteger(ordinal) && ordinal > 0) return matches[ordinal - 1] ? { status: "resolved", entity: matches[ordinal - 1] } : { status: "not_found", candidates: [] };
    return matches.length === 1 ? { status: "resolved", entity: matches[0] } : matches.length > 1 ? { status: "ambiguous", candidates: matches } : { status: "not_found", candidates: [] };
  }

  function checkpoint(sessionId, reason = "state_change") {
    const session = requireSession(sessionId); const createdAt = timestamp();
    const payload = { checkpointId: null, sessionId: session.id, conversationId: session.conversationId, createdAt, workspaceId: session.workspaceId, projectId: session.projectId, mode: session.mode, currentTaskRef: session.currentTaskRef, currentArtifactRef: session.currentArtifactRef, currentSearchRef: session.currentSearchRef, currentPlanRef: session.currentPlanRef, summaryVersion: session.conversationSummary?.version || 0, openQuestions: (session.conversationSummary?.openQuestions || []).slice(0, 10), pendingRefs: session.recentEntityRefs.slice(0, 10).map(({ entityType, entityId, label, version, expiresAt }) => ({ entityType, entityId, label, version, expiresAt })), reason };
    payload.fingerprint = hash({ ...payload, checkpointId: undefined, createdAt: undefined });
    payload.checkpointId = `checkpoint-${payload.fingerprint}`;
    repository.saveCheckpoint(payload); session.resumeCheckpoint = payload;
    persist(session, "session_checkpoint_created", { reason, summaryVersion: payload.summaryVersion });
    return clone(payload);
  }

  function updateSummary(sessionId, { messages = [], lastMessageId = null, force = false, topicShift = false } = {}) {
    const session = requireSession(sessionId); const started = now();
    const complete = messages.filter((item) => ["user", "assistant"].includes(item?.role) && item.state !== "failed" && item.state !== "cancelled" && clean(item.content, 12_000));
    const previous = session.conversationSummary || { text: "", version: 0, lastMessageIdCovered: null, messageCountCovered: 0, messagesSinceUpdate: 0, charactersSinceUpdate: 0, decisions: [], openQuestions: [] };
    const messageCount = previous.messagesSinceUpdate + complete.length;
    const characters = previous.charactersSinceUpdate + complete.reduce((sum, item) => sum + String(item.content).length, 0);
    if (!force && !topicShift && messageCount < summaryMessageThreshold && characters < summaryCharacterThreshold) {
      session.conversationSummary = { ...previous, messagesSinceUpdate: messageCount, charactersSinceUpdate: characters };
      persist(session, null); return { updated: false, summary: clone(session.conversationSummary) };
    }
    let text = summaryUpdater ? summaryUpdater(previous.text || "", complete) : [previous.text, ...complete.map((item) => `${item.role}: ${clean(item.content, 1000)}`)].filter(Boolean).join("\n");
    let compacted = false;
    if (text.length > summaryMaxCharacters) { text = text.slice(-summaryMaxCharacters); compacted = true; }
    session.conversationSummary = { text, version: previous.version + 1, lastMessageIdCovered: clean(lastMessageId, 160), messageCountCovered: previous.messageCountCovered + complete.length, messagesSinceUpdate: 0, charactersSinceUpdate: 0, decisions: previous.decisions || [], openQuestions: previous.openQuestions || [], updatedAt: timestamp() };
    persist(session, null); checkpoint(session.id, topicShift ? "topic_shift" : "summary_update");
    emit("session_summary_updates", { sessionId: session.id, value: 1 });
    emit("session_summary_tokens", { sessionId: session.id, value: estimateTokens(text) });
    if (compacted) emit("session_summary_compactions", { sessionId: session.id, value: 1 });
    emit("session_summary_update_ms", { sessionId: session.id, value: Math.max(0, now() - started) });
    return { updated: true, compacted, summary: clone(session.conversationSummary) };
  }

  function applyIntent(sessionId, intent) {
    if (!intent) return requireSession(sessionId);
    const changes = { lastChannel: intent.sourceChannel };
    if (intent.type === "SWITCH_CONTEXT" && intent.workspaceId) changes.workspaceId = intent.workspaceId;
    if (intent.type === "CONTROL" && intent.action === "mode" && intent.mode) changes.mode = intent.mode;
    if (intent.type === "PLAN") changes.currentTaskRef = { id: intent.intentId, type: "task", label: intent.action, source: "intent", workspaceId: intent.workspaceId };
    const saved = updateSession(sessionId, changes);
    if (intent.type === "SWITCH_CONTEXT" && intent.workspaceId) {
      const segments = repository.segments(saved.conversationId); const previous = segments.at(-1);
      if (previous && !previous.endedAt && previous.workspaceId !== intent.workspaceId) repository.saveSegment({ ...previous, endedAt: timestamp() });
      if (!previous || previous.workspaceId !== intent.workspaceId) repository.saveSegment({ segmentId: `segment-${crypto.randomUUID()}`, conversationId: saved.conversationId, sessionId: saved.id, title: clean(intent.target?.name || "Contexte de travail", 160), workspaceId: intent.workspaceId, summaryRef: saved.conversationSummary?.version ? `summary:${saved.conversationSummary.version}` : null, startedAt: timestamp(), endedAt: null, reason: "explicit_workspace_switch" });
      checkpoint(saved.id, "workspace_switch");
    }
    return saved;
  }

  function recordCompletedTurn(sessionId, { channel = null, messages = [], normalizedIntent = null, executionId = null, approvalIds = [], artifacts = [], search = null, task = null, plan = null, lastMessageId = null } = {}) {
    let session = updateSession(sessionId, { lastChannel: channel, activeExecutionId: null, pendingApprovalIds: approvalIds });
    if (normalizedIntent) session = applyIntent(sessionId, normalizedIntent);
    if (executionId) rememberEntity(sessionId, { type: "execution", id: executionId, status: "completed" });
    if (task) {
      const taskStatus = String(task.status || "").toLowerCase();
      const terminalTask = ["completed", "closed", "cancelled"].includes(taskStatus);
      session = updateSession(sessionId, { currentTaskRef: terminalTask ? null : task });
      rememberEntity(sessionId, { ...task, type: "task" });
    }
    if (plan) { session = updateSession(sessionId, { currentPlanRef: plan }); rememberEntity(sessionId, { ...plan, type: "plan" }); }
    if (search) { session = updateSession(sessionId, { currentSearchRef: search }); rememberEntity(sessionId, { ...search, type: "search" }); for (const result of search.results || []) rememberEntity(sessionId, { ...result, type: "search_result" }, { ttlMs: ENTITY_TTLS.search_result }); }
    for (const artifact of artifacts) { const ref = { type: "artifact", id: artifact.artifactId || artifact.id, label: artifact.name || artifact.title, version: artifact.version, workspaceId: session.workspaceId }; if (ref.id) { session = updateSession(sessionId, { currentArtifactRef: ref }); rememberEntity(sessionId, ref); } }
    updateSummary(sessionId, { messages, lastMessageId });
    return requireSession(sessionId);
  }

  function suspendSession(sessionId, reason = "conversation_left") { const session = updateSession(sessionId, { status: "suspended", activeExecutionId: null }, "session_suspended"); checkpoint(session.id, reason); return requireSession(session.id); }
  function closeSession(sessionId) { const session = updateSession(sessionId, { status: "closed", activeExecutionId: null }, "session_closed"); session.closedAt = timestamp(); return persist(session, null); }

  function resumeSession(sessionId) {
    const started = now(); let session = requireSession(sessionId);
    const authoritativeApprovals = approvalProvider({
      sessionId: session.id,
      conversationId: session.conversationId,
      executionId: session.activeExecutionId,
    }).map((item) => item.id || item.approvalId).filter(Boolean);
    const pendingApprovals = session.activeExecutionId
      ? authoritativeApprovals
      : session.pendingApprovalIds.length
        ? session.pendingApprovalIds.filter((id) => authoritativeApprovals.includes(id))
        : authoritativeApprovals.length === 1 ? authoritativeApprovals : [];
    session.pendingApprovalIds = pendingApprovals; session.status = "active"; session.lastActivityAt = timestamp();
    session = persist(session, "session_context_restored", { refsCount: recentEntities(session.id).length });
    const result = { sessionId: session.id, conversationId: session.conversationId, workspaceId: session.workspaceId, projectId: session.projectId, mode: session.mode, currentTaskRef: session.currentTaskRef, currentArtifactRef: session.currentArtifactRef, currentSearchRef: session.currentSearchRef, currentPlanRef: session.currentPlanRef, summary: session.conversationSummary, recentEntityRefs: recentEntities(session.id), interruptedExecutions: executionProvider({ sessionId: session.id, status: "interrupted" }) || [], pendingApprovals, checkpoint: session.resumeCheckpoint, recoveredFromCrash: session.recoveredFromCrash };
    emit("session_restore_context_ms", { sessionId: session.id, value: Math.max(0, now() - started) });
    return result;
  }

  function restoreContext(sessionId, { query = "", includeOldHistory = false } = {}) {
    const started = now(); const restored = resumeSession(sessionId);
    const recentMessages = (historyTailProvider(restored.conversationId, historyTailLimit) || []).slice(-historyTailLimit);
    emit("history_messages_loaded", { sessionId, value: recentMessages.length });
    let oldHistoryResults = [];
    if (includeOldHistory && historySearchProvider) { oldHistoryResults = historySearchProvider({ conversationId: restored.conversationId, query, limit: 10 }) || []; emit("history_search_fallback", { sessionId, value: oldHistoryResults.length }); }
    emit("session_restore_context_ms", { sessionId, value: Math.max(0, now() - started) });
    return { ...restored, recentMessages, oldHistoryResults };
  }

  function startupRecover() {
    const recovered = [];
    for (const current of repository.list({ statuses: ["active", "idle"], limit: 500 })) {
      const session = clone(current); const interrupted = session.activeExecutionId;
      session.status = "suspended"; session.recoveredFromCrash = true; session.activeExecutionId = null;
      if (interrupted) session.recentEntityRefs.unshift({ entityType: "execution", entityId: interrupted, label: null, mentionedAt: timestamp(), expiresAt: new Date(now() + recentEntityTtlMs).toISOString(), sourceTurnId: null, confidence: "high", status: "interrupted" });
      persist(session, "session_suspended", { recoveredFromCrash: true }); recovered.push(session.id);
    }
    return recovered;
  }

  function contextForRequest(sessionId) {
    const session = requireSession(sessionId);
    return { sessionId: session.id, conversationId: session.conversationId, workspaceId: session.workspaceId, projectId: session.projectId, mode: session.mode, currentTask: session.currentTaskRef, currentArtifact: session.currentArtifactRef, currentSearch: session.currentSearchRef, currentPlan: session.currentPlanRef, pendingApprovalIds: [...session.pendingApprovalIds], recentEntities: recentEntities(session.id).slice(0, 10), summary: session.conversationSummary?.text || null, summaryVersion: session.conversationSummary?.version || 0, checkpointId: session.resumeCheckpoint?.checkpointId || null, lastChannel: session.lastChannel };
  }

  function diagnostics(sessionId = null) {
    const sessions = sessionId ? [requireSession(sessionId)] : repository.list({ limit: 100 });
    return sessions.map((session) => ({ sessionId: session.id, conversationId: session.conversationId, workspaceId: session.workspaceId, mode: session.mode, state: session.status, refsCount: recentEntities(session.id).length, summaryVersion: session.conversationSummary?.version || 0, hasCurrentTask: Boolean(session.currentTaskRef), hasCurrentArtifact: Boolean(session.currentArtifactRef), pendingApprovalCount: session.pendingApprovalIds.length, recoveredFromCrash: session.recoveredFromCrash, lastChannel: session.lastChannel, version: session.version }));
  }

  return { createSession, resolveSession, getActiveSession, getSession: requireSession, updateSession, applyIntent, rememberEntity, recentEntities, resolveEntity, updateSummary, checkpoint, recordCompletedTurn, suspendSession, closeSession, resumeSession, restoreContext, startupRecover, contextForRequest, diagnostics, list: (options) => repository.list(options), segments: (conversationId) => repository.segments(conversationId), states: SESSION_STATES };
}

module.exports = { ENTITY_TTLS, SESSION_STATES, SessionContinuityError, createSessionContinuityEngine };
