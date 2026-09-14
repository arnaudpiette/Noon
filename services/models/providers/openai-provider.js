"use strict";

const { ModelProviderError } = require("../model-provider-adapter");
const { getModelDefinition } = require("../model-registry");
const { normalizeRoutingMetadata } = require("../routing-metadata");

function finiteTokens(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function normalizeUsage(usage = {}) {
  const inputTokens = finiteTokens(usage.input_tokens ?? usage.inputTokens);
  const cachedInputTokens = Math.min(inputTokens, finiteTokens(usage.input_tokens_details?.cached_tokens ?? usage.cachedInputTokens));
  const outputTokens = finiteTokens(usage.output_tokens ?? usage.outputTokens);
  return Object.freeze({ inputTokens, cachedInputTokens, outputTokens, totalTokens: finiteTokens(usage.total_tokens ?? usage.totalTokens) || inputTokens + outputTokens });
}

function normalizeError(error) {
  const status = Number(error?.status || error?.statusCode) || null;
  const sourceCode = String(error?.code || error?.type || "").toLowerCase();
  let code = "PROVIDER_ERROR";
  if (error?.name === "AbortError") code = "TIMEOUT";
  else if ([401, 403].includes(status)) code = "AUTH_ERROR";
  else if (status === 429) code = "RATE_LIMIT";
  else if ([404, 410].includes(status) || sourceCode.includes("model_not_found")) code = "MODEL_UNAVAILABLE";
  else if (["ETIMEDOUT", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN"].includes(error?.code)) code = "NETWORK_ERROR";
  return new ModelProviderError(code, "Le fournisseur de modèle n’a pas pu traiter la demande.", { provider: "openai", status, cause: error });
}

function toOpenAIRequest(request = {}) {
  const options = {
    model: request.model,
    input: request.input,
    store: request.store === true,
  };
  if (request.reasoning) options.reasoning = request.reasoning;
  if (request.text) options.text = request.text;
  if (request.tools) options.tools = request.tools;
  if (request.toolChoice) options.tool_choice = request.toolChoice;
  if (request.maxToolCalls) options.max_tool_calls = request.maxToolCalls;
  if (request.contextManagement) options.context_management = request.contextManagement;
  return options;
}

function normalizeToolCall(item) {
  return Object.freeze({
    type: "function_call",
    id: item.id || null,
    call_id: item.call_id,
    name: item.name,
    arguments: item.arguments || "{}",
  });
}

function normalizeResponse(response, { model, latencyMs = 0, routingMetadata = {} } = {}) {
  if (!response || typeof response !== "object") throw new ModelProviderError("INVALID_RESPONSE", "Réponse fournisseur invalide.", { provider: "openai" });
  const output = Array.isArray(response.output) ? response.output.map((item) => item?.type === "function_call" ? normalizeToolCall(item) : item) : [];
  return Object.freeze({
    text: String(response.output_text || ""),
    output: Object.freeze(output),
    toolCalls: Object.freeze(output.filter((item) => item?.type === "function_call")),
    usage: normalizeUsage(response.usage),
    finishReason: response.status || null,
    provider: "openai",
    model: response.model || model,
    latencyMs: Math.max(0, Number(latencyMs) || 0),
    routingMetadata: normalizeRoutingMetadata(routingMetadata, { provider: "openai", model: response.model || model, usage: normalizeUsage(response.usage), latencyMs, success: true }),
  });
}

function createOpenAIProviderAdapter({ clientProvider, privacyPolicy, now = () => Date.now() } = {}) {
  if (typeof clientProvider !== "function") throw new TypeError("Client OpenAI requis.");
  if (!privacyPolicy?.assertAccess) throw new TypeError("ProviderPrivacyPolicy requise.");
  async function execute(request, { signal, privacyDecisionToken } = {}) {
    privacyPolicy.assertAccess(privacyDecisionToken, "openai");
    const startedAt = now();
    try {
      const response = await clientProvider().responses.create(toOpenAIRequest(request), signal ? { signal } : undefined);
      return normalizeResponse(response, { model: request.model, latencyMs: now() - startedAt, routingMetadata: request.routingMetadata });
    } catch (error) {
      if (error instanceof ModelProviderError) throw error;
      throw normalizeError(error);
    }
  }
  async function stream(request, { signal, onTextDelta, privacyDecisionToken } = {}) {
    privacyPolicy.assertAccess(privacyDecisionToken, "openai");
    const startedAt = now();
    try {
      const streamResult = clientProvider().responses.stream(toOpenAIRequest(request), signal ? { signal } : undefined);
      streamResult.on("response.output_text.delta", (event) => onTextDelta?.(String(event?.delta || "")));
      const response = await streamResult.finalResponse();
      return normalizeResponse(response, { model: request.model, latencyMs: now() - startedAt, routingMetadata: request.routingMetadata });
    } catch (error) {
      if (error instanceof ModelProviderError) throw error;
      throw normalizeError(error);
    }
  }
  return Object.freeze({
    provider: "openai",
    execute,
    stream,
    createToolResult(toolCall, result) {
      return { type: "function_call_output", call_id: toolCall.call_id, output: JSON.stringify(result) };
    },
    capabilities(model) {
      const definition = getModelDefinition(model);
      return Object.freeze([...(definition?.capabilities || [])]);
    },
  });
}

module.exports = { createOpenAIProviderAdapter, normalizeError, normalizeResponse, normalizeUsage, toOpenAIRequest };
