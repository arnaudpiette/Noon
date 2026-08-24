"use strict";

const LANGUAGE_ALIASES = new Map([
  ["auto", "auto"], ["automatique", "auto"], ["automatic", "auto"],
  ["fr", "fr-FR"], ["français", "fr-FR"], ["francais", "fr-FR"], ["french", "fr-FR"],
  ["en", "en-US"], ["anglais", "en-US"], ["english", "en-US"],
  ["es", "es-ES"], ["espagnol", "es-ES"], ["español", "es-ES"], ["spanish", "es-ES"],
  ["es-mx", "es-MX"], ["espagnol mexicain", "es-MX"], ["español de méxico", "es-MX"], ["mexican spanish", "es-MX"],
  ["pt-br", "pt-BR"], ["portugais brésilien", "pt-BR"], ["português brasileiro", "pt-BR"], ["brazilian portuguese", "pt-BR"],
  ["ru", "ru-RU"], ["russe", "ru-RU"], ["russian", "ru-RU"],
  ["ja", "ja-JP"], ["japonais", "ja-JP"], ["japanese", "ja-JP"],
  ["zh", "zh-CN"], ["chinois", "zh-CN"], ["mandarin", "zh-CN"], ["chinese", "zh-CN"],
  ["nl", "nl-NL"], ["néerlandais", "nl-NL"], ["neerlandais", "nl-NL"], ["dutch", "nl-NL"],
]);

const SUPPORTED_LANGUAGES = [
  "auto", "fr-FR", "en-US", "es-ES", "es-MX", "pt-BR",
  "ru-RU", "ja-JP", "zh-CN", "nl-NL",
];

const REALTIME_PRICES = {
  "gpt-realtime-2.1-mini": {
    audioInput: 10, audioCached: 0.30, audioOutput: 20,
    textInput: 0.60, textCached: 0.06, textOutput: 2.40,
  },
  "gpt-realtime-2.1": {
    audioInput: 32, audioCached: 0.40, audioOutput: 64,
    textInput: 4, textCached: 0.40, textOutput: 24,
  },
};

function normalizeLanguage(value, fallback = "auto") {
  const raw = String(value || "").trim();
  if (SUPPORTED_LANGUAGES.includes(raw)) return raw;
  return LANGUAGE_ALIASES.get(raw.toLowerCase()) || fallback;
}

function normalizeAccent(value) {
  const normalized = String(value || "none")
    .replace(/[\r\n]/g, " ")
    .trim()
    .toLowerCase();
  if (!normalized || ["none", "aucun", "sans accent", "neutral"].includes(normalized)) {
    return "none";
  }
  return normalized.slice(0, 60);
}

function normalizeVoiceQuality(value) {
  return String(value).toLowerCase() === "max" ? "max" : "mini";
}

function normalizeNoonMode(value) {
  const mode = String(value || "").trim().toUpperCase();
  return mode === "DEV" ? "DEV" : "DA";
}

function trimConversationHistory(history, maxExchanges = 5) {
  const safeHistory = Array.isArray(history) ? history : [];
  const maxMessages = Math.max(0, Number(maxExchanges) || 0) * 2;
  return safeHistory.slice(-maxMessages);
}

function appendUniqueRealtimeResponse(ledger, responseId, costUSD) {
  const id = String(responseId || "").slice(0, 120);
  const responseIds = Array.isArray(ledger.responseIds) ? ledger.responseIds : [];
  if (!id || responseIds.includes(id)) return false;
  responseIds.push(id);
  ledger.responseIds = responseIds.slice(-2000);
  ledger.costUSD = (Number(ledger.costUSD) || 0) + (Number(costUSD) || 0);
  return true;
}

function modelForQuality(quality) {
  return normalizeVoiceQuality(quality) === "max"
    ? "gpt-realtime-2.1"
    : "gpt-realtime-2.1-mini";
}

function calculateRealtimeCost(model, usage = {}) {
  const price = REALTIME_PRICES[model] || REALTIME_PRICES["gpt-realtime-2.1-mini"];
  const input = usage.input_token_details || {};
  const output = usage.output_token_details || {};
  const cached = input.cached_tokens_details || {};
  const uncachedText = Math.max(0, (input.text_tokens || 0) - (cached.text_tokens || 0));
  const uncachedAudio = Math.max(0, (input.audio_tokens || 0) - (cached.audio_tokens || 0));

  return (
    uncachedText * price.textInput +
    (cached.text_tokens || 0) * price.textCached +
    uncachedAudio * price.audioInput +
    (cached.audio_tokens || 0) * price.audioCached +
    (output.text_tokens || 0) * price.textOutput +
    (output.audio_tokens || 0) * price.audioOutput
  ) / 1_000_000;
}

function parseVoicePreferenceCommand(text) {
  const value = String(text || "").trim().toLowerCase();
  if (!value) return null;
  let language = null;
  let accent = null;

  const aliasesBySpecificity = [...LANGUAGE_ALIASES.entries()]
    .sort(([aliasA], [aliasB]) => aliasB.length - aliasA.length);
  for (const [alias, code] of aliasesBySpecificity) {
    if (alias !== "auto" && value.includes(alias)) {
      language = code;
      break;
    }
  }
  if (/automati|automatic/.test(value)) language = "auto";

  const accentMatch = value.match(/(?:accent|acento)\s+([\p{L}-]+)/u);
  if (accentMatch) accent = normalizeAccent(accentMatch[1]);
  if (/sans accent|without (?:a )?specific accent|sin acento/.test(value)) accent = "none";

  return language || accent ? { language, accent } : null;
}

module.exports = {
  REALTIME_PRICES,
  SUPPORTED_LANGUAGES,
  appendUniqueRealtimeResponse,
  calculateRealtimeCost,
  modelForQuality,
  normalizeAccent,
  normalizeLanguage,
  normalizeNoonMode,
  normalizeVoiceQuality,
  parseVoicePreferenceCommand,
  trimConversationHistory,
};
