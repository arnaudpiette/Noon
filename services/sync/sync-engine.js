"use strict";

const crypto = require("node:crypto");
const { createConflictResolver } = require("./conflict-resolver");
const { SYNC_PROTOCOL_VERSION } = require("./sync-schema");

function hash(value) { return crypto.createHash("sha256").update(String(value)).digest("hex"); }
function createSyncEngine({ repository, policy, deviceRegistry, cryptoLayer, transport, localDeviceId, conflictResolver = createConflictResolver(), mode = "SHADOW", now = () => Date.now(), observability = null, batchSize = 100, tombstoneRetentionMs = 90 * 24 * 60 * 60_000 } = {}) {
  if (!repository?.appendChange || !policy?.evaluate || !deviceRegistry?.assertAuthorized || !cryptoLayer?.seal || !transport?.send) throw new TypeError("Dépendances SyncEngine incomplètes.");
  let currentMode = mode; const emit = (event, metadata = {}) => observability?.(event, metadata);
  function captureMutation({ entityType, entityId, payload = {}, operation = "UPSERT", profileScope = "arnaud", sensitivity = "normal", localOnly = false, changedFields = null, onRequest = false } = {}) {
    const decision = policy.evaluate({ entityType, entityId, profileScope, sensitivity, localOnly, onRequest });
    if (!decision.allowed) { emit("sync_change_rejected", { entityType, classification: decision.classification, reasonCodes: decision.reasonCodes }); return { captured: false, reasonCodes: decision.reasonCodes, classification: decision.classification }; }
    const safePayload = policy.sanitize(entityType, payload, decision); const fields = changedFields || Object.keys(safePayload);
    if (currentMode === "OFF") return { captured: false, shadow: false, classification: decision.classification };
    if (currentMode === "SHADOW") {
      const current = repository.getEntity(entityType, entityId, profileScope);
      const change = repository.appendChange({ entityType, entityId, operation, version: (current?.revision || 0) + 1, originDeviceId: localDeviceId, profileScope, syncClassification: decision.classification, changedFields: fields, baseFieldVersions: current?.fieldVersions || {}, tombstoneUntil: operation !== "UPSERT" ? new Date(now() + tombstoneRetentionMs).toISOString() : null });
      emit("sync_change_shadow", { changeId: change.changeId, entityType, classification: decision.classification });
      return { captured: true, shadow: true, change, classification: decision.classification };
    }
    return repository.transaction(() => {
      const current = repository.getEntity(entityType, entityId, profileScope); const baseFieldVersions = structuredClone(current?.fieldVersions || {});
      const change = repository.appendChange({ entityType, entityId, operation, version: (current?.revision || 0) + 1, originDeviceId: localDeviceId, profileScope, syncClassification: decision.classification, changedFields: fields, baseFieldVersions, tombstoneUntil: operation !== "UPSERT" ? new Date(now() + tombstoneRetentionMs).toISOString() : null });
      const fieldVersions = { ...baseFieldVersions }; for (const field of fields) fieldVersions[field] = { counter: change.sequence, deviceId: localDeviceId };
      const entity = repository.saveEntity({ entityType, entityId, profileScope, revision: change.sequence, payload: operation === "UPSERT" ? { ...(current?.payload || {}), ...safePayload } : {}, fieldVersions, originDeviceId: localDeviceId, deletedAt: operation === "UPSERT" ? null : new Date(now()).toISOString(), updatedAt: change.changedAt });
      for (const device of deviceRegistry.list("ACTIVE")) {
        if (device.deviceId === localDeviceId) continue;
        const destination = policy.evaluate({ entityType, entityId, profileScope, sensitivity, destinationDevice: device, onRequest });
        if (destination.allowed) repository.enqueue(change.changeId, device.deviceId);
      }
      emit("sync_change_captured", { changeId: change.changeId, entityType, sequence: change.sequence });
      return { captured: true, change, entity, baseFieldVersions };
    });
  }
  function envelopeFor(item, target) {
    const change = repository.getChange(item.change_id); const entity = repository.getEntity(change.entityType, change.entityId, change.profileScope);
    const decision = policy.evaluate({ entityType: change.entityType, profileScope: change.profileScope, destinationDevice: target, onRequest: change.syncClassification === "SYNC_ON_REQUEST" });
    if (!decision.allowed) return null;
    return cryptoLayer.seal({ targetDevice: target, header: { entityType: change.entityType, entityId: change.entityId, operation: change.operation, entityVersion: change.version, createdAt: change.changedAt }, payload: { entity: { ...entity, payload: policy.sanitize(change.entityType, entity.payload, decision) }, change, baseFieldVersions: change.baseFieldVersions || {} } });
  }
  function flush(targetDeviceId) {
    if (!["LIMITED", "ON"].includes(currentMode)) return { sent: 0, shadow: currentMode === "SHADOW" };
    const target = deviceRegistry.assertAuthorized(targetDeviceId, null); const pending = repository.pendingOutbox(targetDeviceId, batchSize); const prepared = [];
    for (const item of pending) { const envelope = envelopeFor(item, target); if (!envelope) continue; repository.updateOutbox(item.outbox_id, "SENDING", envelope); prepared.push({ item, envelope }); }
    if (!prepared.length) return { sent: 0, bytesSent: 0 };
    try { const result = transport.send(targetDeviceId, prepared.map(({ envelope }) => envelope)); for (const { item } of prepared) repository.updateOutbox(item.outbox_id, "ACKNOWLEDGED"); emit("sync_batch_sent", { count: prepared.length, bytesSent: result.bytesSent }); return { sent: prepared.length, bytesSent: result.bytesSent }; }
    catch (error) { for (const { item } of prepared) repository.updateOutbox(item.outbox_id, "FAILED"); emit("sync_failed", { code: String(error.code || error.name).slice(0, 80), count: prepared.length }); return { sent: 0, pending: prepared.length, errorCode: error.code || "SYNC_FAILED" }; }
  }
  function applyEnvelope(envelope) {
    if (repository.isApplied(envelope.envelopeId)) { emit("sync_change_deduplicated", { envelopeId: envelope.envelopeId }); return { applied: false, duplicate: true }; }
    const source = deviceRegistry.get(envelope.sourceDeviceId); if (!source || source.status !== "ACTIVE") throw Object.assign(new Error("Source révoquée ou inconnue."), { code: "SYNC_SOURCE_UNAUTHORIZED" });
    const rule = policy.entityRules()[envelope.entityType]; if (!rule?.scope || !source.syncScopes.includes(rule.scope)) throw Object.assign(new Error("Scope source manquant."), { code: "DEVICE_SCOPE_MISSING" });
    const content = cryptoLayer.open(envelope, source); const incoming = content.entity;
    const decision = policy.evaluate({ entityType: incoming.entityType, profileScope: incoming.profileScope, destinationDevice: { status: "ACTIVE", syncScopes: [rule.scope] }, onRequest: rule.classification === "SYNC_ON_REQUEST" });
    if (!decision.allowed) throw Object.assign(new Error("Entité interdite par SyncPolicy."), { code: "SYNC_POLICY_DENY" });
    if (incoming.entityType === "remote_request") return receiveRemoteRequest(content.entity.payload, envelope, source);
    const current = repository.getEntity(incoming.entityType, incoming.entityId, incoming.profileScope); const resolution = conflictResolver.resolve({ current, incoming, changedFields: content.change.changedFields, baseFieldVersions: content.baseFieldVersions });
    for (const conflict of resolution.conflicts) repository.saveConflict(conflict);
    if (resolution.state !== "NEEDS_USER") repository.saveEntity(resolution.entity);
    repository.markApplied(envelope); emit(resolution.conflicts.length ? "sync_conflict_detected" : "sync_change_applied", { entityType: incoming.entityType, conflictCount: resolution.conflicts.length });
    return { applied: resolution.state !== "NEEDS_USER", state: resolution.state, conflicts: resolution.conflicts };
  }
  function receiveRemoteRequest(request, envelope, source) {
    const at = now(); if (!request?.requestId || !request.nonce || !request.expiresAt) throw Object.assign(new Error("Requête distante invalide."), { code: "REMOTE_REQUEST_INVALID" });
    if (Date.parse(request.expiresAt) <= at) throw Object.assign(new Error("Requête distante expirée."), { code: "REMOTE_REQUEST_EXPIRED" });
    const nonceHash = hash(request.nonce); if (repository.remoteRequestSeen(request.requestId, source.deviceId, nonceHash)) throw Object.assign(new Error("Rejeu de requête distante refusé."), { code: "REMOTE_REQUEST_REPLAY" });
    repository.saveRemoteRequest({ requestId: request.requestId, sourceDeviceId: source.deviceId, nonceHash, status: "PENDING_SECURITY_POLICY", intentRef: { intentId: request.intentEnvelope?.intentId || null, origin: "trusted_paired_device", executionNode: request.executionNode || "MAC_PRIMARY" }, createdAt: request.createdAt, expiresAt: request.expiresAt }); repository.markApplied(envelope);
    emit("remote_request_authenticated", { requestId: request.requestId, sourceDeviceIdHash: hash(source.deviceId).slice(0, 16) });
    return { applied: true, remoteRequest: true, status: "PENDING_SECURITY_POLICY", origin: "trusted_paired_device" };
  }
  function pull() {
    const cursor = repository.cursor(localDeviceId); const batch = transport.pull(localDeviceId, { after: cursor.inboundSequence, limit: batchSize });
    if (batch.status === "RESYNC_REQUIRED") { emit("sync_resync_required", { deviceIdHash: hash(localDeviceId).slice(0, 16) }); return batch; }
    const results = []; let highest = cursor.inboundSequence;
    for (const envelope of batch.envelopes) { try { results.push(applyEnvelope(envelope)); highest = Math.max(highest, batch.cursor); } catch (error) { results.push({ applied: false, errorCode: error.code || "SYNC_APPLY_FAILED" }); emit("sync_crypto_failed", { code: error.code || "SYNC_APPLY_FAILED" }); } }
    repository.saveCursor({ ...cursor, inboundSequence: highest }); emit("sync_batch_received", { count: batch.envelopes.length, bytesReceived: batch.bytesReceived }); return { status: "OK", received: batch.envelopes.length, results, cursor: highest, bytesReceived: batch.bytesReceived };
  }
  function initialSnapshot({ targetDeviceId, profileScope = "arnaud", limit = 500 } = {}) { const target = deviceRegistry.get(targetDeviceId); if (!target || target.status !== "ACTIVE") throw Object.assign(new Error("Appareil non autorisé."), { code: "DEVICE_NOT_ACTIVE" }); const snapshotRevision = repository.revision(); const entities = repository.listEntities({ profileScope, limit }).filter((entity) => policy.evaluate({ entityType: entity.entityType, profileScope, destinationDevice: target }).allowed).map((entity) => ({ entityType: entity.entityType, entityId: entity.entityId, revision: entity.revision })); return { protocolVersion: SYNC_PROTOCOL_VERSION, snapshotRevision, entities, cursor: snapshotRevision, changesAfterSnapshot: repository.changesAfter(snapshotRevision, { profileScope, limit: batchSize }) }; }
  function status() { return { mode: currentMode, transport: transport.status(), ...repository.stats() }; }
  function setMode(next) { currentMode = next; }
  return { applyEnvelope, captureMutation, flush, initialSnapshot, mode: () => currentMode, pull, setMode, status };
}

module.exports = { createSyncEngine };
