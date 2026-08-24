"use strict";

(function exposeLiveVoiceCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.NoonLiveVoiceCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  function reconnectDelay(attempt, baseDelay = 800, maximumAttempts = 2) {
    const safeAttempt = Math.max(0, Number(attempt) || 0);
    return safeAttempt >= maximumAttempts
      ? null
      : baseDelay * (safeAttempt + 1);
  }

  function cleanupRealtimeResources(resources = {}) {
    const { channel, peer, stream, audio } = resources;
    if (channel) {
      channel.onclose = null;
      try { channel.close(); } catch { /* Déjà fermé. */ }
    }
    if (peer) {
      peer.onconnectionstatechange = null;
      peer.ontrack = null;
      try { peer.close(); } catch { /* Déjà fermé. */ }
    }
    stream?.getTracks?.().forEach((track) => track.stop());
    if (audio) {
      audio.pause?.();
      audio.srcObject = null;
    }
  }

  return { cleanupRealtimeResources, reconnectDelay };
});
