"use strict";

const { CONNECTION_STATES, PRESENCE_STATES } = require("./remote-schema");

function createRemotePresenceService({ now = () => Date.now(), presenceTtlMs = 60_000, observability = null } = {}) {
  const sessions = new Map(); const emit = (event, metadata) => observability?.(event, metadata);
  function open({ deviceSessionId, deviceId, channelCapabilities = [], activeConversationId = null, connectionState = "CONNECTED" }) {
    if (!CONNECTION_STATES.includes(connectionState)) throw new TypeError("État de connexion invalide.");
    const at = new Date(now()).toISOString(); const session = { deviceSessionId, deviceId, connectedAt: at, lastActivityAt: at, channelCapabilities: [...new Set(channelCapabilities)], activeConversationId, connectionState, presenceState: "ACTIVE" };
    sessions.set(deviceSessionId, session); emit("remote_connection_opened", { deviceId, deviceSessionId, connectionState }); return structuredClone(session);
  }
  function update(deviceSessionId, patch = {}) { const current = sessions.get(deviceSessionId); if (!current) return null; if (patch.connectionState && !CONNECTION_STATES.includes(patch.connectionState)) throw new TypeError("État de connexion invalide."); if (patch.presenceState && !PRESENCE_STATES.includes(patch.presenceState)) throw new TypeError("État de présence invalide."); Object.assign(current, patch, { lastActivityAt: new Date(now()).toISOString() }); return structuredClone(current); }
  function get(deviceSessionId) { const current = sessions.get(deviceSessionId); if (!current) return null; const stale = now() - Date.parse(current.lastActivityAt) > presenceTtlMs; return structuredClone(stale ? { ...current, presenceState: "STALE" } : current); }
  function close(deviceSessionId) { const current = sessions.get(deviceSessionId); if (!current) return null; current.connectionState = "DISCONNECTED"; current.presenceState = "OFFLINE"; emit("remote_connection_closed", { deviceId: current.deviceId, deviceSessionId }); return structuredClone(current); }
  function list() { return [...sessions.keys()].map(get); }
  return { close, get, list, open, update };
}

module.exports = { createRemotePresenceService };
