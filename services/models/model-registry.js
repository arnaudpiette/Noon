"use strict";

const PROVIDERS = Object.freeze({
  openai: Object.freeze({ id: "openai", status: "ENABLED" }),
  anthropic: Object.freeze({ id: "anthropic", status: "NOT_CONFIGURED" }),
  google_ai: Object.freeze({ id: "google_ai", status: "ENABLED", rollout: "LIMITED" }),
  local: Object.freeze({ id: "local", status: "NOT_CONFIGURED" }),
});

const MODEL_DEFINITIONS = Object.freeze([
  Object.freeze({ id: "gpt-5.6-luna", provider: "openai", qualityLevel: "LOW", capabilities: Object.freeze(["TEXT", "VISION", "LONG_DOCUMENT", "STRUCTURED_OUTPUT", "FUNCTION_CALLING", "STREAMING"]) }),
  Object.freeze({ id: "gpt-5.6-terra", provider: "openai", qualityLevel: "NORMAL", capabilities: Object.freeze(["TEXT", "VISION", "LONG_DOCUMENT", "STRUCTURED_OUTPUT", "FUNCTION_CALLING", "STREAMING"]) }),
  Object.freeze({ id: "gpt-5.6-sol", provider: "openai", qualityLevel: "HIGH", capabilities: Object.freeze(["TEXT", "VISION", "LONG_DOCUMENT", "STRUCTURED_OUTPUT", "FUNCTION_CALLING", "STREAMING"]) }),
  Object.freeze({ id: "gpt-6-astra", provider: "openai", rollout: "SHADOW", qualityLevel: "CRITICAL", capabilities: Object.freeze(["TEXT", "VISION", "LONG_DOCUMENT", "STRUCTURED_OUTPUT", "FUNCTION_CALLING", "STREAMING"]) }),
  Object.freeze({ id: "gemini-3.8-flash", provider: "google_ai", rollout: "LIMITED", qualityLevel: "NORMAL", capabilities: Object.freeze(["TEXT", "VISION", "LONG_DOCUMENT", "STRUCTURED_OUTPUT", "FUNCTION_CALLING", "STREAMING"]) }),
]);

const MODEL_REGISTRY = Object.freeze(Object.fromEntries(MODEL_DEFINITIONS.map((definition) => [definition.id, definition])));

function getModelDefinition(modelId) {
  return MODEL_REGISTRY[String(modelId)] || null;
}

function listProviderModels(providerId) {
  return MODEL_DEFINITIONS.filter((definition) => definition.provider === providerId);
}

module.exports = { MODEL_DEFINITIONS, MODEL_REGISTRY, PROVIDERS, getModelDefinition, listProviderModels };
