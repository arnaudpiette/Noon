"use strict";

const CHANNELS = new Set(["chat", "voice", "shortcut", "ui", "system", "proactive", "brief"]);
const INTENT_TYPES = new Set(["ASK", "SEARCH", "CREATE", "UPDATE", "DELETE", "OPEN", "NAVIGATE", "PLAN", "REMIND", "SCHEDULE", "SUMMARIZE", "COMPARE", "GENERATE", "SWITCH_CONTEXT", "CONTROL", "CONFIRM", "REJECT", "CONTINUE", "CANCEL", "COMPOUND"]);
const CONFIDENCE_LEVELS = new Set(["high", "medium", "low"]);
const AMBIGUITY_LEVELS = new Set(["LOW", "MEDIUM", "HIGH"]);
const ORIGIN_TRUST = new Set(["explicit_user", "trusted_ui", "shortcut", "system", "external_content"]);
const INTENT_POLICY_VERSION = "intent-policy-v1";

class IntentError extends Error {
  constructor(code, message, details = null) { super(message); this.name = "IntentError"; this.code = code; this.details = details; }
}

function validateInputEnvelope(value) {
  if (!value || typeof value !== "object") throw new IntentError("INTENT_INVALID_INPUT", "Entrée d’intention invalide.");
  if (!CHANNELS.has(value.channel)) throw new IntentError("INTENT_UNSUPPORTED", "Canal d’entrée non pris en charge.");
  if (!ORIGIN_TRUST.has(value.originTrust)) throw new IntentError("INTENT_INVALID_INPUT", "Niveau de confiance d’origine invalide.");
  if (value.originTrust === "external_content") throw new IntentError("INTENT_UNTRUSTED_ORIGIN", "Un contenu externe ne peut pas devenir une commande utilisateur.");
  return value;
}

function validateAmbiguity(value) {
  return Boolean(value && typeof value === "object" && typeof value.type === "string" &&
    typeof value.field === "string" && Array.isArray(value.candidates) &&
    AMBIGUITY_LEVELS.has(value.confidence) && typeof value.resolutionRequired === "boolean");
}

function validateNormalizedIntent(value) {
  if (!value || typeof value !== "object" || !INTENT_TYPES.has(value.type)) throw new IntentError("INTENT_INVALID_SCHEMA", "Type d’intention invalide.");
  if (typeof value.action !== "string" || !value.action) throw new IntentError("INTENT_INVALID_SCHEMA", "Action d’intention invalide.");
  if (!CHANNELS.has(value.sourceChannel) || !CONFIDENCE_LEVELS.has(value.confidence)) throw new IntentError("INTENT_INVALID_SCHEMA", "Métadonnées d’intention invalides.");
  if (!Array.isArray(value.ambiguity) || !value.ambiguity.every(validateAmbiguity)) throw new IntentError("INTENT_INVALID_SCHEMA", "Ambiguïté d’intention invalide.");
  if (value.type === "COMPOUND" && (!Array.isArray(value.steps) || value.steps.length < 2 || !value.steps.every((step) => INTENT_TYPES.has(step.type)))) throw new IntentError("INTENT_INVALID_SCHEMA", "Étapes composées invalides.");
  return value;
}

module.exports = { AMBIGUITY_LEVELS, CHANNELS, CONFIDENCE_LEVELS, INTENT_POLICY_VERSION, INTENT_TYPES, ORIGIN_TRUST, IntentError, validateInputEnvelope, validateNormalizedIntent };
