"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { EventEmitter } = require("node:events");
const { assertModelProviderAdapter, PROVIDER_ERROR_CODES } = require("../services/models/model-provider-adapter");
const { MODEL_DEFINITIONS, PROVIDERS, getModelDefinition } = require("../services/models/model-registry");
const { createOpenAIProviderAdapter, normalizeError, normalizeUsage, toOpenAIRequest } = require("../services/models/providers/openai-provider");
const { createProviderPrivacyPolicy } = require("../services/security/provider-privacy-policy");
const { selectModelRoute } = require("../lib/noon-intelligence");
const { FAILURE_CATEGORIES, classifyFailureCategory, normalizeRoutingMetadata } = require("../services/models/routing-metadata");

function response(overrides = {}) {
  return {
    output_text: "Réponse de test",
    output: [],
    usage: { input_tokens: 12, output_tokens: 5, total_tokens: 17, input_tokens_details: { cached_tokens: 3 } },
    model: "gpt-5.6-terra",
    status: "completed",
    ...overrides,
  };
}

function fixture(rawResponse = response()) {
  const calls = [];
  const client = {
    responses: {
      async create(options, requestOptions) {
        calls.push({ kind: "execute", options, requestOptions });
        if (rawResponse instanceof Error) throw rawResponse;
        return rawResponse;
      },
      stream(options, requestOptions) {
        calls.push({ kind: "stream", options, requestOptions });
        const stream = new EventEmitter();
        stream.finalResponse = async () => rawResponse;
        queueMicrotask(() => stream.emit("response.output_text.delta", { delta: "Réponse" }));
        return stream;
      },
    },
  };
  const privacyPolicy = createProviderPrivacyPolicy({ providerRegistry: PROVIDERS });
  const privacyDecisionToken = privacyPolicy.evaluateProviderAccess({
    provider: "openai",
    contextMetadata: { fragments: [{ source: "test", classification: "PUBLIC" }] },
  }).permissionToken;
  return {
    adapter: createOpenAIProviderAdapter({ clientProvider: () => client, privacyPolicy }),
    calls,
    privacyDecisionToken,
  };
}

test("le contrat provider expose exécution, streaming, tools, annulation et capacités", async () => {
  const { adapter, calls, privacyDecisionToken } = fixture();
  assert.equal(assertModelProviderAdapter(adapter), adapter);
  const signal = new AbortController().signal;
  const request = { model: "gpt-5.6-terra", input: [{ role: "user", content: "Test fictif" }], store: false };
  const executed = await adapter.execute(request, { signal, privacyDecisionToken });
  const deltas = [];
  const streamed = await adapter.stream(request, { signal, privacyDecisionToken, onTextDelta: (delta) => deltas.push(delta) });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(executed.provider, "openai");
  assert.equal(streamed.text, "Réponse de test");
  assert.deepEqual(deltas, ["Réponse"]);
  assert.equal(calls[0].requestOptions.signal, signal);
  assert.equal(calls[1].requestOptions.signal, signal);
  assert.ok(adapter.capabilities("gpt-5.6-terra").includes("TEXT"));
  assert.deepEqual(adapter.createToolResult({ call_id: "call-1" }, { ok: true }), {
    type: "function_call_output", call_id: "call-1", output: "{\"ok\":true}",
  });
});

test("la requête canonique est traduite vers Responses sans champ étranger", () => {
  const translated = toOpenAIRequest({
    model: "gpt-5.6-sol", input: [], store: false,
    reasoning: { effort: "high" }, text: { verbosity: "medium" },
    tools: [{ type: "function", name: "outil_test" }], toolChoice: "auto",
    maxToolCalls: 2, contextManagement: [{ type: "compaction", compact_threshold: 1000 }],
    metadata: { privateContent: "jamais transmis" },
  });
  assert.equal(translated.tool_choice, "auto");
  assert.equal(translated.max_tool_calls, 2);
  assert.equal(translated.context_management[0].type, "compaction");
  assert.equal(Object.hasOwn(translated, "metadata"), false);
});

test("réponse, usage et tool calls sont normalisés", async () => {
  const tool = { type: "function_call", id: "fc-1", call_id: "call-1", name: "read_file", arguments: "{\"path\":\"/tmp/test\"}" };
  const { adapter, privacyDecisionToken } = fixture(response({ output: [tool] }));
  const normalized = await adapter.execute({ model: "gpt-5.6-terra", input: [] }, { privacyDecisionToken });
  assert.equal(normalized.text, "Réponse de test");
  assert.deepEqual(normalized.usage, { inputTokens: 12, cachedInputTokens: 3, outputTokens: 5, totalTokens: 17 });
  assert.equal(normalized.toolCalls[0].name, "read_file");
  assert.equal(normalized.finishReason, "completed");
  assert.equal(normalized.latencyMs >= 0, true);
  assert.deepEqual(normalizeUsage({ input_tokens: 2, output_tokens: 1 }), { inputTokens: 2, cachedInputTokens: 0, outputTokens: 1, totalTokens: 3 });
});

test("les erreurs fournisseur sont réduites aux catégories canoniques", () => {
  assert.deepEqual(PROVIDER_ERROR_CODES, ["AUTH_ERROR", "RATE_LIMIT", "TIMEOUT", "NETWORK_ERROR", "MODEL_UNAVAILABLE", "PROVIDER_UNAVAILABLE", "PROVIDER_ERROR", "INVALID_RESPONSE"]);
  assert.equal(normalizeError(Object.assign(new Error("secret provider detail"), { status: 401 })).code, "AUTH_ERROR");
  assert.equal(normalizeError(Object.assign(new Error("limite"), { status: 429 })).code, "RATE_LIMIT");
  assert.equal(normalizeError(Object.assign(new Error("réseau"), { code: "ENOTFOUND" })).code, "NETWORK_ERROR");
  assert.equal(normalizeError(Object.assign(new Error("annulé"), { name: "AbortError" })).code, "TIMEOUT");
  assert.doesNotMatch(normalizeError(new Error("secret provider detail")).message, /secret provider detail/);
});

test("les métadonnées de routage restent descriptives et normalisent coûts et échecs", async () => {
  const metadata = normalizeRoutingMetadata({
    taskDomain: "DEV", requiredQuality: "HIGH", maxEstimatedCost: 0.5,
    estimatedUsage: { inputTokens: 1000, outputTokens: 100 },
  }, { provider: "openai", model: "gpt-5.6-terra", usage: { inputTokens: 800, outputTokens: 80 }, latencyMs: 42, success: true });
  assert.equal(metadata.taskDomain, "DEV");
  assert.equal(metadata.requiredQuality, "HIGH");
  assert.equal(metadata.maxEstimatedCost, 0.5);
  assert.ok(metadata.estimatedCost.total > 0);
  assert.ok(metadata.actualCost.total > 0);
  assert.equal(metadata.latency, 42);
  assert.equal(metadata.success, true);
  assert.equal(normalizeRoutingMetadata().taskDomain, "GENERAL");
  assert.equal(normalizeRoutingMetadata().requiredQuality, "NORMAL");
  assert.deepEqual(FAILURE_CATEGORIES, ["PROVIDER_FAILURE", "NETWORK_FAILURE", "RATE_LIMIT", "TIMEOUT", "AUTH_ERROR", "MODEL_UNAVAILABLE", "QUALITY_FAILURE", "VALIDATION_FAILURE", "TASK_FAILURE"]);
  assert.equal(classifyFailureCategory({ code: "ENOTFOUND" }), "NETWORK_FAILURE");
  assert.equal(classifyFailureCategory({ code: "NETWORK_ERROR" }), "NETWORK_FAILURE");
  assert.equal(classifyFailureCategory({ code: "INVALID_RESPONSE" }), "VALIDATION_FAILURE");
  assert.equal(classifyFailureCategory({ code: "AUTH_ERROR" }), "AUTH_ERROR");
  assert.equal(classifyFailureCategory({ code: "MODEL_UNAVAILABLE" }), "MODEL_UNAVAILABLE");

  const { adapter, privacyDecisionToken } = fixture();
  const result = await adapter.execute({
    model: "gpt-5.6-terra", input: [],
    routingMetadata: { taskDomain: "GENERAL", requiredQuality: "NORMAL", estimatedUsage: { inputTokens: 20, outputTokens: 5 } },
  }, { privacyDecisionToken });
  assert.ok(result.routingMetadata.estimatedCost.total > 0);
  assert.ok(result.routingMetadata.actualCost.total > 0);
});

test("le registre mappe tous les modèles actuels vers OpenAI sans activer de futur provider", () => {
  assert.equal(MODEL_DEFINITIONS.length, 5);
  for (const model of MODEL_DEFINITIONS.filter((item) => item.id.startsWith("gpt-"))) assert.equal(model.provider, "openai");
  assert.equal(getModelDefinition("gpt-6-astra").capabilities.includes("FUNCTION_CALLING"), true);
  assert.equal(PROVIDERS.openai.status, "ENABLED");
  assert.equal(PROVIDERS.anthropic.status, "NOT_CONFIGURED");
  assert.equal(PROVIDERS.google_ai.status, "ENABLED");
  assert.equal(PROVIDERS.google_ai.rollout, "LIMITED");
  assert.equal(PROVIDERS.local.status, "NOT_CONFIGURED");
});

test("les fixtures historiques conservent exactement le routage Luna Terra Sol et Astra shadow", () => {
  assert.equal(selectModelRoute({ question: "Bonjour" }).model, "gpt-5.6-luna");
  assert.equal(selectModelRoute({ question: "Explique la hiérarchie visuelle" }).model, "gpt-5.6-terra");
  assert.equal(selectModelRoute({ question: "Analyse en profondeur l'architecture logicielle" }).model, "gpt-5.6-sol");
  const shadow = selectModelRoute({
    question: "Utilise Astra pour une analyse transversale de plusieurs systèmes avec une migration complexe de bout en bout",
    profile: "maximum", astraMode: "SHADOW", astraAvailability: "AVAILABLE",
    context: { estimatedTokens: 15000, sourceCount: 8 }, tools: { expectedCount: 4 },
    output: { expectedLength: "long" }, artifact: { complexity: "high" }, risk: { level: "high" },
  });
  assert.notEqual(shadow.model, "gpt-6-astra");
  assert.equal(shadow.astra.wouldSelectAstra, true);
  assert.equal(shadow.astra.selected, false);
});
