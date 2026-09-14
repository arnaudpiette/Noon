"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const { OPENAI_BUILTIN_VOICES, resolveOpenAIVoice } = require("./openai-voice-provider");
const SHARED_VOICES = OPENAI_BUILTIN_VOICES;

const NOON_VOICE_IDENTITY = Object.freeze({
  id: "noon-default",
  identity: "noon-default",
  targetVoice: "cedar",
  requestedVoice: "cedar",
  requestedVoiceProvider: "openai-api",
  futurePreferredVoice: "arbor",
  exactMatchRequired: true,
  providerStatus: "ready",
  availability: "AVAILABLE",
  state: "LIVE_READY",
  fallbackSpeakerAllowed: false,
  displayName: "Cedar",
  statusMessage: "Cedar est la voix canonique actuelle. Arbor reste la voix future préférée lorsqu’elle sera réellement disponible.",
  primaryVoice: "cedar",
  realtimeVoice: "cedar",
  ttsVoice: "cedar",
  fallbackVoice: null,
  fallbackPolicy: "none",
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

function saveVoiceChoice(file, voice) {
  if (voice !== "cedar") throw new Error("Cedar est la seule voix actuellement autorisée pour Noon.");
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ ...NOON_VOICE_IDENTITY, voice }) + "\n", { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function createVoiceIdentity({ identity = NOON_VOICE_IDENTITY, selectionPath = null, debug = null, now = () => Date.now(), availableVoices = OPENAI_BUILTIN_VOICES } = {}) {
  // Ignore legacy speaker selections and injected alternatives; persist the canonical policy.
  identity = NOON_VOICE_IDENTITY;
  if (selectionPath) saveVoiceChoice(selectionPath, identity.targetVoice);
  function assertAvailable(resolution = resolve()) {
    if (resolution.activeVoice) return resolution;
    const error = new Error("Aucune voix compatible n’est disponible via le fournisseur Live.");
    error.code = "VOICE_UNAVAILABLE";
    error.statusCode = 503;
    error.state = identity.state;
    throw error;
  }
  function resolve({ pipeline = "tts", language = "auto", accent = "none", model = null } = {}) {
    const startedAt = now();
    const providerResolution = resolveOpenAIVoice({ preferredVoice: identity.primaryVoice, allowFallback: false, availableVoices });
    const voice = providerResolution.activeVoice;
    const resolved = {
      ...identity,
      ...providerResolution,
      identityId: identity.id,
      pipeline,
      voice,
      primaryVoice: identity.primaryVoice,
      fallbackVoice: providerResolution.fallback ? voice : null,
      language,
      accent,
      model,
      styleInstructions: styleInstructions({ language, accent, provider: pipeline }),
      voiceIdentityResolveMs: Math.max(0, now() - startedAt),
    };
    debug?.("voice-identity.resolved", {
      identityId: resolved.identityId, pipeline, voice, language, model,
      preferredVoice: resolved.preferredVoice,
      preferredAvailable: resolved.preferredAvailable,
      providerStatus: resolved.providerStatus,
      fallback: resolved.fallback, status: resolved.status, voiceIdentityResolveMs: resolved.voiceIdentityResolveMs,
    });
    return resolved;
  }

  function attempts(resolution) {
    return resolution?.voice ? [{ voice: resolution.voice, fallback: resolution.fallback === true }] : [];
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
      ...identity,
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

  return { assertAvailable, attempts, createSessionId, identity, publicConfig, resolve, traceFallback };
}

module.exports = { NOON_VOICE_IDENTITY, SHARED_VOICES, saveVoiceChoice, createVoiceIdentity, styleInstructions };
