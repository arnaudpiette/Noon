"use strict";

const crypto = require("node:crypto");

const NOON_VOICE_IDENTITY = Object.freeze({
  id: "noon-default",
  primaryVoice: "marin",
  realtimeVoice: "marin",
  ttsVoice: "marin",
  fallbackVoice: "cedar",
  fallbackPolicy: "explicit_after_primary_retry",
  languagePolicy: "automatic",
  accentPolicy: "preserve_identity",
  style: Object.freeze({
    warmth: "chaleureuse",
    pace: "fluide et vivant",
    tone: "calme, direct et naturel",
    expressiveness: "mesurée, jamais théâtrale",
  }),
});

function styleInstructions({ language = "auto", accent = "none", provider = "tts" } = {}) {
  const languageInstruction = language === "auto"
    ? "Détecte la langue du contenu et conserve la même identité vocale dans cette langue."
    : `Parle en ${language} sans modifier l’identité vocale de Noon.`;
  const accentInstruction = accent === "none"
    ? "Adopte une prononciation naturelle et neutre."
    : `Utilise un accent ${accent}, léger, intelligible et non caricatural, sans changer de voix.`;
  return [
    "Tu es la voix Noon : un homme adulte, chaleureux, calme, direct et naturel.",
    "Utilise des phrases fluides, un rythme vivant, de petites pauses et une expressivité mesurée, jamais théâtrale.",
    languageInstruction,
    accentInstruction,
    provider === "realtime" ? "Reste bref à l’oral et interromps-toi immédiatement lorsque l’utilisateur reprend la parole." : "Évite toute diction de standard téléphonique.",
  ].join(" ");
}

function createVoiceIdentity({ identity = NOON_VOICE_IDENTITY, debug = null, now = () => Date.now() } = {}) {
  function resolve({ pipeline = "tts", language = "auto", accent = "none", model = null } = {}) {
    const startedAt = now();
    const voice = pipeline === "realtime" ? identity.realtimeVoice : identity.ttsVoice;
    const resolved = {
      identityId: identity.id,
      pipeline,
      voice,
      primaryVoice: identity.primaryVoice,
      fallbackVoice: identity.fallbackVoice,
      fallback: false,
      language,
      accent,
      model,
      styleInstructions: styleInstructions({ language, accent, provider: pipeline }),
      voiceIdentityResolveMs: Math.max(0, now() - startedAt),
    };
    debug?.("voice-identity.resolved", {
      identityId: resolved.identityId, pipeline, voice, language, model,
      fallback: false, voiceIdentityResolveMs: resolved.voiceIdentityResolveMs,
    });
    return resolved;
  }

  function attempts(resolution) {
    return [
      { voice: resolution.primaryVoice, fallback: false, attempt: 1 },
      { voice: resolution.primaryVoice, fallback: false, attempt: 2 },
      { voice: resolution.fallbackVoice, fallback: true, attempt: 3 },
    ].filter((attempt) => Boolean(attempt.voice));
  }

  function traceFallback(resolution, reason) {
    debug?.("voice-identity.fallback", {
      identityId: resolution.identityId,
      pipeline: resolution.pipeline,
      primary: resolution.primaryVoice,
      fallback: resolution.fallbackVoice,
      reason: String(reason || "provider_error").slice(0, 100),
    });
  }

  function createSessionId() {
    return `voice_${crypto.randomUUID()}`;
  }

  function publicConfig() {
    return {
      id: identity.id,
      primaryVoice: identity.primaryVoice,
      realtimeVoice: identity.realtimeVoice,
      ttsVoice: identity.ttsVoice,
      fallbackPolicy: identity.fallbackPolicy,
      languagePolicy: identity.languagePolicy,
      accentPolicy: identity.accentPolicy,
      style: identity.style,
    };
  }

  return { attempts, createSessionId, identity, publicConfig, resolve, traceFallback };
}

module.exports = { NOON_VOICE_IDENTITY, createVoiceIdentity, styleInstructions };
