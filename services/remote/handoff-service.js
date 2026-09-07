"use strict";

const crypto = require("node:crypto");

function createHandoffService({ repository, sessionContinuityEngine, now = () => Date.now(), ttlMs = 30 * 60_000, observability = null } = {}) {
  function createHandoff({ conversationId, sessionId, sourceDeviceId, targetDeviceId, workspaceId = null, recentMessageRef = null, currentTaskRef = null, currentArtifactRef = null, currentJobRefs = [], summaryRef = null } = {}) {
    const record = { handoffId: `handoff_${crypto.randomUUID()}`, conversationId, sessionId, sourceDeviceId, targetDeviceId, workspaceId, recentMessageRef, currentTaskRef, currentArtifactRef, currentJobRefs: currentJobRefs.slice(0, 20), summaryRef, state: "ACTIVE", createdAt: new Date(now()).toISOString(), expiresAt: new Date(now() + ttlMs).toISOString() };
    repository.saveHandoff(record); observability?.("handoff_created", { handoffId: record.handoffId, sourceDeviceId, targetDeviceId }); return record;
  }
  function resolve({ targetDeviceId, conversationId = null } = {}) { const matches = repository.activeHandoffs(targetDeviceId, now()).filter((item) => !conversationId || item.conversationId === conversationId); if (matches.length === 1) return { status: "RESOLVED", handoff: matches[0] }; if (matches.length > 1) return { status: "AMBIGUOUS", candidates: matches.map(({ handoffId, conversationId: id }) => ({ handoffId, conversationId: id })) }; return { status: "MISSING", candidates: [] }; }
  function complete(handoffId) { const handoff = repository.updateHandoffState(handoffId, "COMPLETED"); if (handoff) { sessionContinuityEngine?.resolveSession?.({ conversationId: handoff.conversationId, workspaceId: handoff.workspaceId, channel: "remote" }); observability?.("handoff_completed", { handoffId }); } return handoff; }
  return { complete, createHandoff, resolve };
}

module.exports = { createHandoffService };
