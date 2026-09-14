"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { EventEmitter } = require("node:events");
const { PROVIDERS } = require("../services/models/model-registry");
const { createProviderPrivacyPolicy } = require("../services/security/provider-privacy-policy");
const { createGeminiProviderAdapter, normalizeError, toGeminiRequest } = require("../services/models/providers/gemini-provider");
const { createProviderShadowRunner } = require("../services/models/provider-shadow-runner");

function fixture() {
  let calls = 0;
  const response = { text: "OK", functionCalls: [{ id: "c1", name: "read_file", args: { path: "/tmp/x" } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4, totalTokenCount: 14 }, candidates: [{ finishReason: "STOP" }], modelVersion: "gemini-3.8-flash" };
  const client = { models: {
    async generateContent() { calls += 1; return response; },
    async generateContentStream() { calls += 1; return (async function* () { yield { ...response, text: "O" }; yield { ...response, text: "K", functionCalls: [] }; })(); },
  } };
  const policy = createProviderPrivacyPolicy({ providerRegistry: PROVIDERS, providerTiers: { google_ai: "FREE" } });
  return { adapter: createGeminiProviderAdapter({ clientProvider: () => client, privacyPolicy: policy }), policy, calls: () => calls };
}
test("Gemini traduit le contrat canonique et normalise réponse usage et tools", async () => {
  const { adapter, policy } = fixture();
  const decision = policy.evaluateProviderAccess({ provider: "google_ai", contextMetadata: { fragments: [{ source: "test", classification: "PUBLIC" }] }, requestPolicy: { providerTier: "FREE", providerConfigured: true } });
  const result = await adapter.execute({ model: "gemini-3.8-flash", input: [{ role: "system", content: "Règle" }, { role: "user", content: "Test" }] }, { privacyDecisionToken: decision.permissionToken });
  assert.equal(result.provider, "google_ai"); assert.equal(result.text, "OK"); assert.equal(result.toolCalls[0].name, "read_file"); assert.equal(result.usage.totalTokens, 14);
  assert.equal(toGeminiRequest({ model: "gemini-3.8-flash", input: [{ role: "user", content: "x" }] }).contents[0].role, "user");
});
test("Gemini stream expose les deltas sans changer le contrat renderer", async () => {
  const { adapter, policy } = fixture(); const deltas = [];
  const decision = policy.evaluateProviderAccess({ provider: "google_ai", contextMetadata: { fragments: [{ source: "test", classification: "PUBLIC" }] }, requestPolicy: { providerTier: "FREE", providerConfigured: true } });
  const result = await adapter.stream({ model: "gemini-3.8-flash", input: [{ role: "user", content: "Test" }] }, { privacyDecisionToken: decision.permissionToken, onTextDelta: (d) => deltas.push(d) });
  assert.equal(result.text, "OK"); assert.deepEqual(deltas, ["O", "K"]);
});
test("Gemini FREE refuse PRIVATE avec zéro appel réseau", async () => {
  const { adapter, policy, calls } = fixture();
  const runner = createProviderShadowRunner({ adapter, privacyPolicy: policy, enabled: true, rollout: "SHADOW", tier: "FREE", configured: true });
  const denied = policy.evaluateProviderAccess({ provider: "google_ai", contextMetadata: { fragments: [{ source: "memory", classification: "PRIVATE" }] }, requestPolicy: { providerTier: "FREE", providerConfigured: true } });
  assert.equal(denied.decision, "DENY"); assert.equal(calls(), 0);
  const shadow = await runner.runPublic({ model: "gemini-3.8-flash", input: [{ role: "user", content: "Public test" }] });
  assert.equal(shadow.status, "PASS"); assert.equal(calls(), 1);
});
test("Gemini adapter refuse un jeton absent avant le client", async () => {
  const { adapter, calls } = fixture();
  await assert.rejects(adapter.execute({ model: "gemini-3.8-flash", input: [] }), /confidentialité/);
  assert.equal(calls(), 0);
});

test("AbortError reste un timeout sans faux statut HTTP 20", () => {
  const aborted = Object.assign(new Error("This operation was aborted"), { name: "AbortError", code: 20 });
  const normalized = normalizeError(aborted);
  assert.equal(normalized.code, "TIMEOUT");
  assert.equal(normalized.status, null);
});

test("503 Gemini devient une indisponibilité provider transitoire", () => {
  const normalized = normalizeError(Object.assign(new Error("UNAVAILABLE"), { status: 503 }));
  assert.equal(normalized.code, "PROVIDER_UNAVAILABLE");
  assert.equal(normalized.status, 503);
});

test("un shadow 503 reste borné à une seule tentative", async () => {
  let calls = 0;
  const policy = createProviderPrivacyPolicy({ providerRegistry: PROVIDERS, providerTiers: { google_ai: "FREE" } });
  const adapter = createGeminiProviderAdapter({ clientProvider: () => ({ models: { async generateContent() { calls += 1; throw Object.assign(new Error("UNAVAILABLE"), { status: 503 }); } } }), privacyPolicy: policy });
  const runner = createProviderShadowRunner({ adapter, privacyPolicy: policy, model: "gemini-3.8-flash", enabled: true, rollout: "SHADOW", tier: "FREE", configured: true });
  const result = await runner.runPublic({ input: [{ role: "user", content: "fixture publique" }] });
  assert.equal(result.status, "FAILED"); assert.equal(result.failureCategory, "PROVIDER_FAILURE"); assert.equal(calls, 1);
});

test("le shadow produit une comparaison coût-latence sans contenu utilisateur", async () => {
  const { adapter, policy } = fixture();
  const events = [];
  const runner = createProviderShadowRunner({
    adapter, privacyPolicy: policy, enabled: true, rollout: "SHADOW", tier: "FREE", configured: true,
    observability: (event, metadata) => events.push({ event, metadata }),
  });
  const result = await runner.runPublic({
    model: "gemini-3.8-flash",
    input: [{ role: "user", content: "CONTENU_UTILISATEUR_INTERDIT_DANS_METRIQUES" }],
    routingMetadata: { taskDomain: "RESEARCH", requiredQuality: "NORMAL", maxEstimatedCost: 0.25 },
    primaryMetrics: { provider: "openai", model: "gpt-5.6-luna", latency: 12, cost: { currency: "USD", total: 0.001 }, success: true },
  });
  assert.equal(result.status, "PASS");
  assert.equal(events[0].metadata.primaryProvider, "openai");
  assert.equal(events[0].metadata.shadowProvider, "google_ai");
  assert.equal(events[0].metadata.routingMetadata.taskDomain, "RESEARCH");
  assert.equal(events[0].metadata.shadowCost.total, 0);
  assert.doesNotMatch(JSON.stringify(events), /CONTENU_UTILISATEUR_INTERDIT/);
});
