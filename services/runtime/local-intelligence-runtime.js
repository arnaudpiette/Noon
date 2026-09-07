"use strict";

const { createOfflinePolicy, EXECUTION_PREFERENCES } = require("./offline-policy");

function createLocalIntelligenceRuntime({ registry, policy = createOfflinePolicy(), localModel, reliability = null, config = null, observability = null, now = () => Date.now() } = {}) {
  if (!registry?.list) throw new TypeError("CapabilityRegistry requis.");
  const emit = (event, data = {}) => observability?.(event, data);
  function preference(context = {}) { const value = config?.get?.("runtime.executionPreference", context)?.value || "BALANCED"; return EXECUTION_PREFERENCES.includes(value) ? value : "BALANCED"; }
  function networkState(context = {}) {
    if (preference(context) === "LOCAL_ONLY") return "LOCAL_ONLY";
    if (context.internetAvailable === false) return "OFFLINE";
    if (context.providerAvailable === false) return "PROVIDER_UNAVAILABLE";
    if (context.degradedNetwork === true) return "DEGRADED";
    return "ONLINE";
  }
  function effective(item, state, modelState) {
    let availability = item.availability;
    if (item.executionLocation === "LOCAL_MODEL") availability = modelState === "READY" ? "AVAILABLE" : "UNAVAILABLE";
    if (item.requiresNetwork && ["OFFLINE", "LOCAL_ONLY"].includes(state)) availability = "UNAVAILABLE";
    if (
      state === "PROVIDER_UNAVAILABLE" &&
      (
        item.executionLocation === "REMOTE_MODEL" ||
        item.capabilityId === "REMOTE_WEB_SEARCH" ||
        item.provider.startsWith("OpenAI") ||
        item.provider === "PublicResearchEngine"
      )
    ) availability = "UNAVAILABLE";
    return { ...item, availability };
  }
  function snapshot(context = {}) {
    const generatedAt = new Date(now()).toISOString(); const state = networkState(context); const model = localModel?.status?.() || { state: "NOT_CONFIGURED", provider: "NONE", model: null };
    const capabilities = registry.list().map((item) => effective(item, state, model.state));
    const grouped = { available: [], degraded: [], unavailable: [] };
    for (const item of capabilities) grouped[item.availability === "AVAILABLE" ? "available" : item.availability === "DEGRADED" ? "degraded" : "unavailable"].push(item.capabilityId);
    return Object.freeze({ state, userExplicitLocalOnly: preference(context) === "LOCAL_ONLY", preference: preference(context), network: {
      internet: state === "OFFLINE" ? "UNAVAILABLE" : state === "DEGRADED" ? "DEGRADED" : "AVAILABLE",
      provider: state === "PROVIDER_UNAVAILABLE" || state === "OFFLINE" || state === "LOCAL_ONLY" ? "UNAVAILABLE" : "AVAILABLE",
      lan: context.lanAvailable === false ? "UNAVAILABLE" : "UNKNOWN",
    }, localModel: model, capabilities, ...grouped, generatedAt });
  }
  function preflight({ requiredCapabilities = [], context = {}, privacy = "STANDARD", qualityRequirement = "BASIC", explicitQueueIntent = false, highRisk = false } = {}) {
    const snap = snapshot(context); const decisions = requiredCapabilities.map((id) => {
      const primary = snap.capabilities.find((item) => item.capabilityId === id) || null;
      const alternatives = snap.capabilities.filter((item) => item.metadata?.alternativeFor === id);
      return { requiredCapability: id, ...policy.resolve({ requiredCapability: primary, alternatives, privacy, qualityRequirement,
        userPreference: snap.preference, networkState: snap.state, queueAllowed: config?.get?.("offline.queueNetworkJobs", context)?.value !== false,
        explicitQueueIntent, highRisk }) };
    });
    const status = decisions.some((item) => item.status === "UNAVAILABLE") ? "UNAVAILABLE" : decisions.some((item) => item.status === "DEGRADED") ? "DEGRADED" : "AVAILABLE";
    emit("runtime_preflight_completed", { status, requiredCount: decisions.length, localOnly: snap.userExplicitLocalOnly, remoteCallsAvoided: decisions.filter((item) => item.mode?.startsWith("LOCAL")).length });
    return { status, decisions, snapshotId: `runtime:${snap.generatedAt}`, limitations: decisions.filter((item) => item.userDisclosureRequired).map((item) => item.reasonCode) };
  }
  function setPreference(value, context = {}) { if (!EXECUTION_PREFERENCES.includes(value)) throw new TypeError("Préférence d’exécution invalide."); config?.set?.("runtime.executionPreference", value, { scope: "USER", origin: context.origin || "user" }); emit("runtime_preference_changed", { value }); return snapshot(context); }
  function health() { const snap = snapshot(); return { status: "ok", state: snap.state, localModel: snap.localModel.state, executionAuthority: false, modelDownloadAuthority: false, securityBypass: false }; }
  return { health, networkState, preflight, setPreference, snapshot };
}

module.exports = { createLocalIntelligenceRuntime };
