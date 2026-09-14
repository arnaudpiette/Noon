"use strict";

const crypto = require("node:crypto");
const { ModelProviderError } = require("../model-provider-adapter");
const { getModelDefinition } = require("../model-registry");
const { normalizeRoutingMetadata } = require("../routing-metadata");

function finite(value) { const number = Number(value); return Number.isFinite(number) ? Math.max(0, number) : 0; }
function normalizeUsage(usage = {}) {
  const inputTokens = finite(usage.promptTokenCount);
  const cachedInputTokens = Math.min(inputTokens, finite(usage.cachedContentTokenCount));
  const outputTokens = finite(usage.candidatesTokenCount) + finite(usage.thoughtsTokenCount);
  return Object.freeze({ inputTokens, cachedInputTokens, outputTokens, totalTokens: finite(usage.totalTokenCount) || inputTokens + outputTokens });
}
function normalizeError(error) {
  // DOMException AbortError exposes the legacy numeric code 20. It is not an
  // HTTP status and must never be reported as one.
  const status = Number(error?.status || error?.statusCode) || null;
  const source = String(error?.code || error?.status || error?.message || "").toUpperCase();
  let code = "PROVIDER_ERROR";
  if (error?.name === "AbortError" || source.includes("ABORT")) code = "TIMEOUT";
  else if ([401, 403].includes(status) || /UNAUTHENTICATED|PERMISSION_DENIED|API_KEY/.test(source)) code = "AUTH_ERROR";
  else if (status === 429 || /RESOURCE_EXHAUSTED|RATE_LIMIT|QUOTA/.test(source)) code = "RATE_LIMIT";
  else if (status === 404 || /MODEL_NOT_FOUND|NOT_FOUND/.test(source)) code = "MODEL_UNAVAILABLE";
  else if ([408, 500, 502, 503, 504].includes(status) || /\bUNAVAILABLE\b/.test(source)) code = "PROVIDER_UNAVAILABLE";
  else if (/ENOTFOUND|ECONNRESET|ETIMEDOUT|NETWORK/.test(source)) code = "NETWORK_ERROR";
  return new ModelProviderError(code, "Le fournisseur de modèle n’a pas pu traiter la demande.", { provider: "google_ai", status, cause: error });
}
function textPart(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((item) => item?.text || item?.content || JSON.stringify(item)).join("\n");
  return JSON.stringify(content ?? "");
}
function toGeminiRequest(request = {}, signal = null) {
  const system = [];
  const contents = [];
  for (const message of request.input || []) {
    if (["system", "developer"].includes(message.role)) system.push(textPart(message.content));
    else if (message.type === "function_call_output") contents.push({ role: "user", parts: [{ functionResponse: { name: "noon_tool", response: { output: message.output } } }] });
    else contents.push({ role: message.role === "assistant" ? "model" : "user", parts: [{ text: textPart(message.content) }] });
  }
  const config = { abortSignal: signal || undefined };
  if (system.length) config.systemInstruction = system.join("\n");
  if (request.reasoning?.effort) config.thinkingConfig = { thinkingLevel: request.reasoning.effort === "low" ? "LOW" : request.reasoning.effort === "high" ? "HIGH" : "MEDIUM" };
  if (request.text?.format?.schema) {
    config.responseMimeType = "application/json";
    config.responseJsonSchema = request.text.format.schema;
  }
  const declarations = (request.tools || []).filter((tool) => tool?.type === "function").map((tool) => ({
    name: tool.name, description: tool.description, parametersJsonSchema: tool.parameters || tool.parametersJsonSchema || { type: "object", properties: {} },
  }));
  if (declarations.length) config.tools = [{ functionDeclarations: declarations }];
  if (request.toolChoice === "none") config.toolConfig = { functionCallingConfig: { mode: "NONE" } };
  return { model: request.model, contents, config };
}
function normalizeResponse(response, { model, latencyMs = 0, routingMetadata = {} } = {}) {
  if (!response || typeof response !== "object") throw new ModelProviderError("INVALID_RESPONSE", "Réponse fournisseur invalide.", { provider: "google_ai" });
  const toolCalls = (response.functionCalls || []).map((call) => Object.freeze({
    type: "function_call", id: call.id || null, call_id: call.id || `gemini_${crypto.randomUUID()}`,
    name: call.name, arguments: JSON.stringify(call.args || {}),
  }));
  return Object.freeze({
    text: String(response.text || ""), output: Object.freeze([...toolCalls]), toolCalls: Object.freeze(toolCalls),
    usage: normalizeUsage(response.usageMetadata), finishReason: response.candidates?.[0]?.finishReason || null,
    provider: "google_ai", model: response.modelVersion || model, latencyMs: Math.max(0, Number(latencyMs) || 0),
    routingMetadata: normalizeRoutingMetadata(routingMetadata, { provider: "google_ai", model: response.modelVersion || model, usage: normalizeUsage(response.usageMetadata), latencyMs, success: true }),
  });
}
function createGeminiProviderAdapter({ clientProvider, privacyPolicy, now = () => Date.now() } = {}) {
  if (typeof clientProvider !== "function") throw new TypeError("Client Gemini requis.");
  if (!privacyPolicy?.assertAccess) throw new TypeError("ProviderPrivacyPolicy requise.");
  async function execute(request, { signal, privacyDecisionToken } = {}) {
    privacyPolicy.assertAccess(privacyDecisionToken, "google_ai");
    const startedAt = now();
    try { return normalizeResponse(await clientProvider().models.generateContent(toGeminiRequest(request, signal)), { model: request.model, latencyMs: now() - startedAt, routingMetadata: request.routingMetadata }); }
    catch (error) { if (error instanceof ModelProviderError) throw error; throw normalizeError(error); }
  }
  async function stream(request, { signal, onTextDelta, privacyDecisionToken } = {}) {
    privacyPolicy.assertAccess(privacyDecisionToken, "google_ai");
    const startedAt = now(); let text = ""; let last = null; const calls = [];
    try {
      const result = await clientProvider().models.generateContentStream(toGeminiRequest(request, signal));
      for await (const chunk of result) { last = chunk; const delta = String(chunk.text || ""); text += delta; if (delta) onTextDelta?.(delta); calls.push(...(chunk.functionCalls || [])); }
      return normalizeResponse({ ...last, text, functionCalls: calls, usageMetadata: last?.usageMetadata }, { model: request.model, latencyMs: now() - startedAt, routingMetadata: request.routingMetadata });
    } catch (error) { if (error instanceof ModelProviderError) throw error; throw normalizeError(error); }
  }
  return Object.freeze({
    provider: "google_ai", execute, stream,
    createToolResult(toolCall, result) { return { type: "function_call_output", call_id: toolCall.call_id, output: JSON.stringify(result) }; },
    capabilities(model) { return Object.freeze([...(getModelDefinition(model)?.capabilities || [])]); },
  });
}
module.exports = { createGeminiProviderAdapter, normalizeError, normalizeResponse, normalizeUsage, toGeminiRequest };
