"use strict";

// Source unique des estimations de coût. Les prix sont exprimés en USD par
// million de tokens et ne sont jamais déduits lorsqu'un modèle est inconnu.
const MODEL_PRICING = Object.freeze({
  "gpt-5.6-luna": Object.freeze({ input: 0.20, cachedInput: 0.02, output: 1.20 }),
  "gpt-5.6-terra": Object.freeze({ input: 2.00, cachedInput: 0.20, output: 12.00 }),
  "gpt-5.6-sol": Object.freeze({ input: 4.00, cachedInput: 0.40, output: 20.00 }),
  // OpenAI pricing verified 2026-09-08: https://developers.openai.com/api/docs/models/gpt-6-astra
  "gpt-6-astra": Object.freeze({ input: 10.00, cachedInput: 1.00, output: 50.00 }),
  // Google pricing verified 2026-09-14: https://ai.google.dev/gemini-api/docs/pricing
  "gemini-3.8-flash": Object.freeze({ input: 0.75, cachedInput: 0.075, output: 3.75 }),
});

const TRANSCRIPTION_PRICE_PER_MINUTE = 0.003;
const WEB_SEARCH_PRICE_PER_CALL = 0.01;
const IMAGE_GENERATION_ESTIMATED_COST_USD = Object.freeze({
  low: 0.01,
  medium: 0.05,
  high: 0.20,
});

function estimateModelCost(providerOrModel, modelOrUsage = {}, maybeUsage = {}) {
  const objectInput = providerOrModel && typeof providerOrModel === "object";
  const provider = objectInput ? providerOrModel.provider : arguments.length >= 3 ? providerOrModel : "openai";
  const model = objectInput ? providerOrModel.model : arguments.length >= 3 ? modelOrUsage : providerOrModel;
  const usage = objectInput ? providerOrModel.usage || {} : arguments.length >= 3 ? maybeUsage : modelOrUsage;
  const pricing = MODEL_PRICING[model];
  if (!["openai", "google_ai"].includes(provider) || !pricing || (!Number.isFinite(Number(usage?.input_tokens ?? usage?.inputTokens)) &&
    !Number.isFinite(Number(usage?.output_tokens ?? usage?.outputTokens)))) {
    return { status: "unavailable", currency: "USD", total: null };
  }

  const inputTokens = Math.max(0, Number(usage.input_tokens ?? usage.inputTokens) || 0);
  const cachedTokens = Math.min(
    inputTokens,
    Math.max(0, Number(usage.input_tokens_details?.cached_tokens ?? usage.cachedInputTokens) || 0)
  );
  const outputTokens = Math.max(0, Number(usage.output_tokens ?? usage.outputTokens) || 0);
  const input = ((inputTokens - cachedTokens) / 1_000_000) * pricing.input;
  const cachedInput = (cachedTokens / 1_000_000) * pricing.cachedInput;
  const output = (outputTokens / 1_000_000) * pricing.output;

  return {
    status: "available",
    currency: "USD",
    input,
    cachedInput,
    output,
    total: input + cachedInput + output,
  };
}

module.exports = {
  IMAGE_GENERATION_ESTIMATED_COST_USD,
  MODEL_PRICING,
  TRANSCRIPTION_PRICE_PER_MINUTE,
  WEB_SEARCH_PRICE_PER_CALL,
  estimateModelCost,
};
