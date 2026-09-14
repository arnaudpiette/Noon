"use strict";

// OpenAI ne fournit pas d'endpoint de découverte des voix intégrées.
// Cette liste centralise les capacités documentées afin d'éviter les noms dispersés.
const OPENAI_BUILTIN_VOICES = Object.freeze([
  "alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse", "marin", "cedar",
]);
const DEFAULT_FALLBACK_VOICE = "cedar";
const REALTIME_MODELS = Object.freeze({ mini: "gpt-realtime-2.1-mini", max: "gpt-realtime-2.1" });

function normalizeFallbackVoice(value) {
  const voice = String(value || "").trim().toLowerCase();
  return OPENAI_BUILTIN_VOICES.includes(voice) ? voice : DEFAULT_FALLBACK_VOICE;
}

function resolveOpenAIVoice({ preferredVoice = "cedar", fallbackVoice = null, allowFallback = false, availableVoices = OPENAI_BUILTIN_VOICES } = {}) {
  const supported = new Set(availableVoices.map((voice) => String(voice).toLowerCase()));
  const preferred = String(preferredVoice || "cedar").toLowerCase();
  if (supported.has(preferred)) return { preferredVoice: preferred, activeVoice: preferred, preferredAvailable: true, fallback: false, status: "LIVE_READY" };
  const normalizedFallback = allowFallback ? normalizeFallbackVoice(fallbackVoice) : null;
  if (normalizedFallback && supported.has(normalizedFallback)) return { preferredVoice: preferred, activeVoice: normalizedFallback, preferredAvailable: false, fallback: true, status: "LIVE_READY_WITH_VOICE_FALLBACK" };
  return { preferredVoice: preferred, activeVoice: null, preferredAvailable: false, fallback: false, status: "LIVE_UNAVAILABLE" };
}

module.exports = { DEFAULT_FALLBACK_VOICE, OPENAI_BUILTIN_VOICES, REALTIME_MODELS, normalizeFallbackVoice, resolveOpenAIVoice };
