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

  // Démarrage de Conversation Live à l'ouverture de Noon (demande d'Arnaud, 24/11/2026).
  // Réglage activé par défaut ; la phrase d'accueil est celle qu'il a écrite, mot pour mot.
  const LAUNCH_GREETING = "Salut Noon, par quoi on commence aujourd’hui ?";

  function liveAutoStartEnabled(storedValue) {
    return storedValue !== "off";
  }

  // Jamais dans un navigateur ou un test (pas de micro ouvert d'office), une seule fois par
  // lancement, jamais si le budget vocal est bloqué, jamais en Qualité Max (elle exige une
  // confirmation explicite de son coût).
  function shouldAutoStartLive({ desktopApp = false, enabled = true, alreadyStarted = false, budgetState = null, quality = "mini" } = {}) {
    if (!desktopApp) return { start: false, reason: "NOT_DESKTOP_APP" };
    if (!enabled) return { start: false, reason: "DISABLED" };
    if (alreadyStarted) return { start: false, reason: "ALREADY_STARTED" };
    if (String(budgetState || "").toUpperCase() === "BLOCKED") return { start: false, reason: "BUDGET_BLOCKED" };
    if (quality === "max") return { start: false, reason: "MAX_QUALITY" };
    return { start: true, reason: "AUTO_START" };
  }

  function launchGreetingEvent() {
    return {
      type: "response.create",
      response: { instructions: `Dis exactement cette phrase, en français, sans rien ajouter ni retirer : « ${LAUNCH_GREETING} »` },
    };
  }

  return { LAUNCH_GREETING, cleanupRealtimeResources, launchGreetingEvent, liveAutoStartEnabled, reconnectDelay, shouldAutoStartLive };
});
