"use strict";

function createMockRemoteTransport(name, { available = true, latencyMs = 0 } = {}) {
  const frames = []; let online = available;
  return { name, send(frame) { if (!online) throw Object.assign(new Error(`${name} indisponible.`), { code: "REMOTE_TRANSPORT_UNAVAILABLE" }); frames.push(structuredClone(frame)); return { accepted: true, latencyMs, bytes: Buffer.byteLength(JSON.stringify(frame)) }; }, frames: () => structuredClone(frames), setAvailable(value) { online = value === true; }, available: () => online, latencyMs: () => latencyMs };
}
function createRemoteTransportRouter({ transports = {}, observability = null } = {}) {
  let activeBySession = new Map();
  function select({ deviceSessionId, channel = "TEXT", realtime = true } = {}) {
    const candidates = realtime ? ["LOCAL_NETWORK", "SECURE_RELAY", "SYNC_MAILBOX"] : ["SYNC_MAILBOX", "SECURE_RELAY", "LOCAL_NETWORK"];
    const selected = candidates.find((name) => transports[name]?.available?.());
    if (!selected) return { status: "OFFLINE", transport: null };
    const previous = activeBySession.get(deviceSessionId); activeBySession.set(deviceSessionId, selected);
    if (previous && previous !== selected) observability?.("transport_switched", { deviceSessionId, from: previous, to: selected, channel });
    return { status: selected === "SYNC_MAILBOX" ? "DEGRADED" : "CONNECTED", transport: transports[selected], name: selected, switched: Boolean(previous && previous !== selected) };
  }
  return { select, active: (id) => activeBySession.get(id) || null };
}

module.exports = { createMockRemoteTransport, createRemoteTransportRouter };
