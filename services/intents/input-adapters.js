"use strict";

const crypto = require("crypto");
const { CHANNELS, validateInputEnvelope } = require("./intent-schema");

function boundedText(value, max = 12_000) { return String(value || "").replace(/\0/g, "").trim().slice(0, max); }
function baseEnvelope(channel, input = {}, defaults = {}) {
  if (!CHANNELS.has(channel)) throw new TypeError("Canal d’intention invalide.");
  const structured = input.structured && typeof input.structured === "object" ? structuredClone(input.structured) : {};
  return validateInputEnvelope({
    inputId: String(input.inputId || `input-${crypto.randomUUID()}`), channel,
    rawText: boundedText(input.rawText || input.text), transcript: boundedText(input.transcript),
    uiAction: input.uiAction && typeof input.uiAction === "object" ? structuredClone(input.uiAction) : null,
    shortcutPayload: input.shortcutPayload && typeof input.shortcutPayload === "object" ? structuredClone(input.shortcutPayload) : null,
    structured, timestamp: input.timestamp || new Date().toISOString(),
    conversationId: input.conversationId || null, workspaceId: input.workspaceId || null,
    sessionId: input.sessionId || input.conversationId || null, locale: input.locale || "fr-FR",
    originTrust: input.originTrust || defaults.originTrust,
    metadata: input.metadata && typeof input.metadata === "object" ? structuredClone(input.metadata) : {},
  });
}
function adaptTextInput(input) { return baseEnvelope("chat", input, { originTrust: "explicit_user" }); }
function adaptVoiceInput(input) { return baseEnvelope("voice", { ...input, rawText: input.transcript || input.rawText }, { originTrust: "explicit_user" }); }
function adaptShortcutInput(input) { return baseEnvelope("shortcut", input, { originTrust: "shortcut" }); }
function adaptUiInput(input) { return baseEnvelope("ui", input, { originTrust: "trusted_ui" }); }
function adaptSystemInput(input) { return baseEnvelope(input.channel === "brief" || input.channel === "proactive" ? input.channel : "system", input, { originTrust: "system" }); }
function adaptInput(channel, input) {
  if (channel === "chat") return adaptTextInput(input);
  if (channel === "voice") return adaptVoiceInput(input);
  if (channel === "shortcut") return adaptShortcutInput(input);
  if (channel === "ui") return adaptUiInput(input);
  return adaptSystemInput({ ...input, channel });
}

module.exports = { adaptInput, adaptShortcutInput, adaptSystemInput, adaptTextInput, adaptUiInput, adaptVoiceInput, baseEnvelope };
