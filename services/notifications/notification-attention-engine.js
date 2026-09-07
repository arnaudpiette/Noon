"use strict";

const { createDeliveryRouter } = require("./delivery-router");
const { createNotificationPolicy } = require("./notification-policy");
const { createNotificationStore } = require("./notification-store");
const { normalizeAttentionRequest, uid } = require("./notification-schema");

function createNotificationAttentionEngine({ store = createNotificationStore(), policy = createNotificationPolicy(), router = createDeliveryRouter(),
  now = () => new Date(), observability = null, metrics = null, featureMode = "SHADOW", sourceRevalidator = null } = {}) {
  function emit(event, data = {}) { observability?.(event, data); metrics?.record?.(event, 1); }
  function buildRecord(request, channel, payload, state = "QUEUED", targetDeviceId = null) { return {
    deliveryId: uid("delivery", [request.attentionId, channel, targetDeviceId]), attentionId: request.attentionId, channel, targetDeviceId,
    state, createdAt: now().toISOString(), deliveredAt: null, interactedAt: null, failureReason: null, replaceKey: request.replaceKey, payload,
  }; }
  async function submit(raw, context = {}, { deliver = true } = {}) {
    const request = normalizeAttentionRequest(raw, now); emit("attention_request_created", { source: request.source, type: request.type, sensitivity: request.sensitivity });
    const since = request.dedupeMode === "PERMANENT" ? null : new Date(now().getTime() - request.dedupeWindowMs).toISOString();
    const duplicate = store.findDedupe(request.dedupeKey, since);
    if (duplicate && duplicate.attentionId !== request.attentionId) { emit("notification_deduplicated", { source: request.source, type: request.type }); return { request: duplicate, plan: { disposition: "SUPPRESS", channels: [], reason: "duplicate" }, deliveries: [], deduplicated: true }; }
    const replacedCount = store.replace(request.replaceKey, request.attentionId); if (replacedCount) emit("notification_replaced", { count: replacedCount });
    store.saveRequest(request); const plan = policy.evaluate(request, { ...context, currentTime: context.currentTime || now(), recentDeliveries: context.recentDeliveries || store.listDeliveries({ states: ["DELIVERED"] }) });
    emit("attention_evaluated", { source: request.source, type: request.type, disposition: plan.disposition, channelCount: plan.channels.length });
    if (plan.disposition === "EXPIRE") { const saved = store.updateRequest(request.attentionId, "EXPIRED"); emit("notification_expired", { source: request.source, type: request.type }); return { request: saved, plan, deliveries: [] }; }
    if (["DEFER", "SUPPRESS"].includes(plan.disposition)) { const saved = store.updateRequest(request.attentionId, plan.disposition === "DEFER" ? "DEFERRED" : "SUPPRESSED"); emit(plan.disposition === "DEFER" ? "notification_deferred" : "notification_suppressed", { reason: plan.reason }); return { request: saved, plan, deliveries: [] }; }
    const records = [];
    for (const channel of plan.channels) {
      const level = policy.privacyLevel(request, context, channel); const payload = policy.visiblePayload(request, level);
      if (!payload) continue; if (level !== "FULL") emit("notification_privacy_redacted", { channel, level, sensitivity: request.sensitivity });
      const record = store.saveDelivery(buildRecord(request, channel, payload)); records.push(record);
      if (!deliver || featureMode === "SHADOW") continue;
      store.updateDelivery(record.deliveryId, { state: "DELIVERING" }); emit("notification_delivery_started", { channel });
      const result = await router.deliver(record, context);
      if (result.ok) { const delivered = store.updateDelivery(record.deliveryId, { state: "DELIVERED", deliveredAt: now().toISOString() }); records[records.indexOf(record)] = delivered; emit("notification_delivered", { channel }); }
      else { const failed = store.updateDelivery(record.deliveryId, { state: "FAILED", failureReason: result.code }); records[records.indexOf(record)] = failed; emit("notification_delivery_failed", { channel, code: result.code, retryable: result.retryable === true }); }
    }
    store.updateRequest(request.attentionId, records.some((item) => item.state === "DELIVERED") ? "DELIVERED" : "QUEUED");
    return { request: store.getRequest(request.attentionId), plan, deliveries: records, deduplicated: false };
  }
  async function resumePending(context = {}) { const results = []; for (const request of store.listRequests().filter((item) => ["CREATED", "QUEUED", "DEFERRED"].includes(item.state))) {
    const relevant = sourceRevalidator ? await sourceRevalidator(request) : { valid: true }; if (!relevant?.valid) { store.updateRequest(request.attentionId, relevant?.expired ? "EXPIRED" : "CANCELLED"); continue; }
    results.push(await submit({ ...request, attentionId: request.attentionId, dedupeKey: `${request.dedupeKey}:resume:${request.attentionId}` }, context));
  } return results; }
  async function interact({ deliveryId, action, sourceFingerprint = null } = {}) {
    const delivery = store.getDelivery(deliveryId); if (!delivery) return { accepted: false, reason: "unknown_delivery" };
    const request = store.getRequest(delivery.attentionId); if (!request || ["EXPIRED", "REPLACED", "CANCELLED"].includes(request.state)) return { accepted: false, reason: "stale" };
    if (request.expiresAt && Date.parse(request.expiresAt) <= now().getTime()) { store.updateRequest(request.attentionId, "EXPIRED"); return { accepted: false, reason: "expired" }; }
    const current = sourceRevalidator ? await sourceRevalidator(request) : { valid: true, fingerprint: request.metadata.sourceFingerprint };
    if (!current?.valid || (sourceFingerprint && current.fingerprint && sourceFingerprint !== current.fingerprint)) return { accepted: false, reason: "source_changed" };
    if (action === "OPEN") { store.updateDelivery(deliveryId, { state: "SEEN", interactedAt: now().toISOString() }); return { accepted: true, intent: { type: `OPEN_${request.source}`, origin: "trusted_ui", subjectRef: request.subjectRef, payloadRef: request.payloadRef } }; }
    return { accepted: true, intent: { type: String(action), origin: "trusted_ui", subjectRef: request.subjectRef, payloadRef: request.payloadRef,
      exactActionRef: request.metadata.exactActionRef, securityBypass: false, approvalBypass: false }, requiresSecurityEvaluation: true };
  }
  function coalesce(rawRequests = []) {
    const normalized = rawRequests.map((request) => normalizeAttentionRequest(request, now));
    const standalone = normalized.filter((request) => request.interruptionLevel === "URGENT" || request.importance === "CRITICAL" || request.userActionRequired);
    const candidates = normalized.filter((request) => !standalone.includes(request));
    if (candidates.length < 2) return { requests: normalized, coalescedCount: 0 };
    const groups = new Map();
    for (const request of candidates) {
      const key = [request.profileScope, request.workspaceId || "global", request.sensitivity].join(":");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(request);
    }
    const requests = [...standalone]; let coalescedCount = 0;
    for (const [key, group] of groups) {
      if (group.length === 1) { requests.push(group[0]); continue; }
      const first = group[0]; coalescedCount += group.length - 1;
      requests.push(normalizeAttentionRequest({
        source: "SYSTEM", type: "INFORMATION", subjectRef: `digest:${key}`, profileScope: first.profileScope,
        workspaceId: first.workspaceId, importance: "LOW", interruptionLevel: "PASSIVE", sensitivity: first.sensitivity,
        preferredChannels: ["IN_APP", "BADGE"], allowedChannels: ["IN_APP", "BADGE"],
        dedupeKey: `digest:${key}:${group.map((item) => item.dedupeKey).sort().join("|")}`,
        title: "Résumé Noon", summary: `${group.length} informations sont disponibles dans Noon.`,
        genericSummary: `${group.length} informations sont disponibles dans Noon.`, metadata: { category: "COALESCED" },
      }, now));
      emit("notification_coalesced", { count: group.length, sensitivity: first.sensitivity });
    }
    return { requests, coalescedCount };
  }
  function badgeCount() { return store.listRequests().filter((item) => item.userActionRequired && !["EXPIRED", "REPLACED", "CANCELLED", "SEEN", "ACTED"].includes(item.state)).length; }
  function health() { return { status: "ok", featureMode, requests: store.listRequests().length, deliveries: store.listDeliveries().length, executionAuthority: false, engagementOptimization: false }; }
  return { badgeCount, coalesce, health, interact, resumePending, store, submit };
}
module.exports = { createNotificationAttentionEngine };
