"use strict";

function createSyncHealth({ engine, cryptoLayer, transport } = {}) {
  function check() {
    const status = engine?.status?.() || {};
    const identity = cryptoLayer?.identity?.();
    return {
      state: status.mode === "OFF" ? "DISABLED" : "HEALTHY",
      mode: status.mode || "OFF",
      transport: transport?.status?.() || "UNAVAILABLE",
      crypto: identity?.deviceId && identity?.publicSigningKey && identity?.publicEncryptionKey ? "HEALTHY" : "UNAVAILABLE",
      journal: Number.isFinite(status.revision) ? "HEALTHY" : "UNAVAILABLE",
      pendingOutbox: Number(status.pendingOutbox || 0),
      conflicts: Number(status.conflicts || 0),
    };
  }
  return { check };
}

module.exports = { createSyncHealth };
