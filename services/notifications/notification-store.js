"use strict";

function json(value, fallback = null) { try { return JSON.parse(value); } catch { return fallback; } }
function createNotificationStore({ database = null, now = () => new Date() } = {}) {
  const memory = { requests: new Map(), deliveries: new Map() };
  const db = database?.database || database;
  if (db?.exec) db.exec(`
    CREATE TABLE IF NOT EXISTS attention_requests (
      id TEXT PRIMARY KEY, dedupe_key TEXT NOT NULL, replace_key TEXT, source TEXT NOT NULL, type TEXT NOT NULL,
      profile_scope TEXT NOT NULL, workspace_id TEXT, sensitivity TEXT NOT NULL, state TEXT NOT NULL,
      request_json TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS attention_dedupe_idx ON attention_requests(dedupe_key, created_at);
    CREATE INDEX IF NOT EXISTS attention_state_idx ON attention_requests(state, expires_at);
    CREATE TABLE IF NOT EXISTS notification_deliveries (
      id TEXT PRIMARY KEY, attention_id TEXT NOT NULL, channel TEXT NOT NULL, target_device_id TEXT,
      state TEXT NOT NULL, replace_key TEXT, payload_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL,
      delivered_at TEXT, interacted_at TEXT, failure_reason TEXT, updated_at TEXT NOT NULL,
      UNIQUE(attention_id, channel, target_device_id), FOREIGN KEY(attention_id) REFERENCES attention_requests(id)
    );
    CREATE INDEX IF NOT EXISTS notification_delivery_state_idx ON notification_deliveries(state, channel, created_at);
  `);
  function requestRow(row) { if (!row) return null; return { ...json(row.request_json, {}), state: row.state, updatedAt: row.updated_at }; }
  function deliveryRow(row) { if (!row) return null; return { deliveryId: row.id, attentionId: row.attention_id, channel: row.channel, targetDeviceId: row.target_device_id,
    state: row.state, replaceKey: row.replace_key, payload: json(row.payload_json, {}), createdAt: row.created_at, deliveredAt: row.delivered_at,
    interactedAt: row.interacted_at, failureReason: row.failure_reason, updatedAt: row.updated_at }; }
  function saveRequest(request, state = "CREATED") {
    const updatedAt = now().toISOString(); const value = { ...request, state, updatedAt };
    if (!db?.prepare) { memory.requests.set(request.attentionId, value); return structuredClone(value); }
    db.prepare(`INSERT INTO attention_requests(id,dedupe_key,replace_key,source,type,profile_scope,workspace_id,sensitivity,state,request_json,created_at,expires_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,request_json=excluded.request_json,updated_at=excluded.updated_at`)
      .run(request.attentionId, request.dedupeKey, request.replaceKey, request.source, request.type, request.profileScope, request.workspaceId,
        request.sensitivity, state, JSON.stringify(request), request.createdAt, request.expiresAt, updatedAt);
    return getRequest(request.attentionId);
  }
  function getRequest(id) { return db?.prepare ? requestRow(db.prepare("SELECT * FROM attention_requests WHERE id=?").get(id)) : structuredClone(memory.requests.get(id) || null); }
  function updateRequest(id, state) { const current = getRequest(id); if (!current) return null; return saveRequest(current, state); }
  function findDedupe(key, since = null) {
    if (db?.prepare) return requestRow(db.prepare(`SELECT * FROM attention_requests WHERE dedupe_key=? ${since ? "AND created_at>=?" : ""} ORDER BY created_at DESC LIMIT 1`).get(...(since ? [key, since] : [key])));
    return [...memory.requests.values()].filter((item) => item.dedupeKey === key && (!since || item.createdAt >= since)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] || null;
  }
  function replace(replaceKey, replacementId) {
    if (!replaceKey) return 0; let count = 0;
    for (const request of listRequests().filter((item) => item.replaceKey === replaceKey && item.attentionId !== replacementId && !["EXPIRED", "REPLACED", "CANCELLED"].includes(item.state))) { updateRequest(request.attentionId, "REPLACED"); count += 1; }
    return count;
  }
  function saveDelivery(delivery) {
    const updatedAt = now().toISOString(); const value = { ...delivery, updatedAt };
    if (!db?.prepare) { memory.deliveries.set(delivery.deliveryId, value); return structuredClone(value); }
    db.prepare(`INSERT INTO notification_deliveries(id,attention_id,channel,target_device_id,state,replace_key,payload_json,created_at,delivered_at,interacted_at,failure_reason,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,payload_json=excluded.payload_json,delivered_at=excluded.delivered_at,interacted_at=excluded.interacted_at,failure_reason=excluded.failure_reason,updated_at=excluded.updated_at`)
      .run(delivery.deliveryId, delivery.attentionId, delivery.channel, delivery.targetDeviceId, delivery.state, delivery.replaceKey, JSON.stringify(delivery.payload || {}),
        delivery.createdAt, delivery.deliveredAt, delivery.interactedAt, delivery.failureReason, updatedAt);
    return getDelivery(delivery.deliveryId);
  }
  function getDelivery(id) { return db?.prepare ? deliveryRow(db.prepare("SELECT * FROM notification_deliveries WHERE id=?").get(id)) : structuredClone(memory.deliveries.get(id) || null); }
  function updateDelivery(id, changes) { const current = getDelivery(id); if (!current) return null; return saveDelivery({ ...current, ...changes }); }
  function listRequests() { return db?.prepare ? db.prepare("SELECT * FROM attention_requests ORDER BY created_at DESC").all().map(requestRow) : [...memory.requests.values()].map((item) => structuredClone(item)); }
  function listDeliveries({ states = [], channel = null } = {}) { const all = db?.prepare ? db.prepare("SELECT * FROM notification_deliveries ORDER BY created_at").all().map(deliveryRow) : [...memory.deliveries.values()].map((item) => structuredClone(item)); return all.filter((item) => (!states.length || states.includes(item.state)) && (!channel || item.channel === channel)); }
  return { findDedupe, getDelivery, getRequest, listDeliveries, listRequests, replace, saveDelivery, saveRequest, updateDelivery, updateRequest };
}

module.exports = { createNotificationStore };
