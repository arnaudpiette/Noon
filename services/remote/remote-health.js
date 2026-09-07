"use strict";

function createRemoteHealth({ engine, presenceService, transportRouter } = {}) {
  function check(deviceSessionId = null) {
    const status = engine?.status?.() || { mode: "OFF" }; const presence = deviceSessionId ? presenceService?.get(deviceSessionId) : null; const route = deviceSessionId ? transportRouter?.select({ deviceSessionId, channel: "TEXT" }) : null;
    return { component: "RemoteInteraction", state: status.mode === "OFF" ? "DISABLED" : route?.status === "OFFLINE" ? "DEGRADED" : "HEALTHY", mode: status.mode, transport: route?.name || "UNAVAILABLE", connectionState: presence?.connectionState || "DISCONNECTED", presenceState: presence?.presenceState || "UNKNOWN", activeRemoteSessions: status.connectedDevices || 0, activeRemoteRequests: status.activeRemoteRequests || 0 };
  }
  return { check };
}

module.exports = { createRemoteHealth };
