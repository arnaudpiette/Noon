"use strict";

function createLoopbackSyncTransport({ duplicateDelivery = false, reorder = false, online = true, maxRetained = 10_000 } = {}) {
  const queues = new Map(); let available = online; let sequence = 0;
  function send(targetDeviceId, envelopes) {
    if (!available) throw Object.assign(new Error("Transport indisponible."), { code: "SYNC_TRANSPORT_OFFLINE", transient: true });
    const queue = queues.get(targetDeviceId) || [];
    for (const envelope of envelopes) { const item = { sequence: ++sequence, envelope: structuredClone(envelope) }; queue.push(item); if (duplicateDelivery) queue.push({ ...item, sequence: ++sequence }); }
    if (reorder) queue.reverse(); if (queue.length > maxRetained) queue.splice(0, queue.length - maxRetained); queues.set(targetDeviceId, queue);
    return { accepted: envelopes.map((envelope) => envelope.envelopeId), bytesSent: Buffer.byteLength(JSON.stringify(envelopes)) };
  }
  function pull(deviceId, { after = 0, limit = 100 } = {}) {
    if (!available) throw Object.assign(new Error("Transport indisponible."), { code: "SYNC_TRANSPORT_OFFLINE", transient: true });
    const queue = queues.get(deviceId) || []; const first = queue[0]?.sequence || 0;
    if (after > 0 && first > after + 1) return { status: "RESYNC_REQUIRED", envelopes: [], cursor: after, bytesReceived: 0 };
    const items = queue.filter((item) => item.sequence > after).slice(0, Math.max(1, Math.min(500, limit)));
    return { status: "OK", envelopes: items.map((item) => structuredClone(item.envelope)), cursor: items.reduce((max, item) => Math.max(max, item.sequence), after), bytesReceived: Buffer.byteLength(JSON.stringify(items)) };
  }
  return { kind: "loopback", pull, send, setOnline(value) { available = value === true; }, status: () => available ? "AVAILABLE" : "OFFLINE" };
}

module.exports = { createLoopbackSyncTransport };
