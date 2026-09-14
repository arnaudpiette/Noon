"use strict";

const { estimateModelCost } = require("../observability/model-pricing");
const { classifyFailureCategory, normalizeRoutingMetadata } = require("./routing-metadata");

function createProviderShadowRunner({ adapter, privacyPolicy, model = null, enabled = false, rollout = "OFF", tier = "UNKNOWN", configured = false, observability = null } = {}) {
  if (!adapter?.execute || !privacyPolicy?.evaluateProviderAccess) throw new TypeError("Provider shadow incomplet.");
  async function runPublic(request, { signal, onTextDelta = null } = {}) {
    if (!enabled || rollout !== "SHADOW") return { status: "SKIPPED", reasonCode: "SHADOW_DISABLED" };
    const fragment = privacyPolicy.inspectContextFragment({ source: "provider_shadow", classification: "PUBLIC", content: request.input });
    const privacy = privacyPolicy.evaluateProviderAccess({
      provider: adapter.provider, contextMetadata: { fragments: [fragment] },
      requestPolicy: { providerTier: tier, providerConfigured: configured, secretDetected: fragment.secretDetected },
    });
    if (privacy.decision !== "ALLOW") return { status: "DENIED", privacy, networkCalls: 0 };
    const startedAt = performance.now();
    try {
      const providerRequest = { ...request, model: model || request.model, routingMetadata: normalizeRoutingMetadata(request.routingMetadata) };
      const response = onTextDelta
        ? await adapter.stream(providerRequest, { signal, onTextDelta, privacyDecisionToken: privacy.permissionToken })
        : await adapter.execute(providerRequest, { signal, privacyDecisionToken: privacy.permissionToken });
      const cost = tier === "FREE"
        ? { status: "available", currency: "USD", input: 0, cachedInput: 0, output: 0, total: 0 }
        : estimateModelCost(adapter.provider, response.model, response.usage);
      const latencyMs = performance.now() - startedAt;
      const result = { status: "PASS", provider: adapter.provider, model: response.model, latencyMs, usage: response.usage, cost, privacy: privacy.decision, response };
      observability?.("provider_shadow.completed", {
        primaryProvider: request.primaryMetrics?.provider || "openai", primaryModel: request.primaryMetrics?.model || null,
        shadowProvider: result.provider, shadowModel: result.model,
        primaryLatency: request.primaryMetrics?.latency ?? null, shadowLatency: latencyMs,
        primaryCost: request.primaryMetrics?.cost ?? null, shadowCost: cost,
        primarySuccess: request.primaryMetrics?.success !== false, shadowSuccess: true,
        constraintAdherence: request.constraintAdherence ?? null,
        routingMetadata: response.routingMetadata,
      });
      return result;
    } catch (error) {
      const failureCategory = classifyFailureCategory(error);
      observability?.("provider_shadow.failed", { shadowProvider: adapter.provider, shadowModel: model || request.model, shadowSuccess: false, failureCategory });
      return { status: "FAILED", provider: adapter.provider, code: error.code || "PROVIDER_ERROR", failureCategory };
    }
  }
  return Object.freeze({ provider: adapter.provider, model, rollout, tier, runPublic });
}
module.exports = { createProviderShadowRunner };
