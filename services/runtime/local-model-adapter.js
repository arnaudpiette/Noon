"use strict";

const LOCAL_MODEL_STATES = Object.freeze(["NOT_CONFIGURED", "STARTING", "READY", "DEGRADED", "UNAVAILABLE"]);

function createLocalModelAdapter({ provider = "NONE", model = null, generate = null, healthCheck = null, capabilities = [], observability = null, now = () => Date.now() } = {}) {
  let state = provider === "NONE" || !model ? "NOT_CONFIGURED" : "UNAVAILABLE";
  let lastLatencyMs = null;
  async function health() {
    if (state === "NOT_CONFIGURED") return { state, provider, model: null, capabilities: [], qualityClass: "UNAVAILABLE" };
    const started = now();
    try { const result = await healthCheck?.(); state = result?.ready === true ? "READY" : "UNAVAILABLE"; }
    catch { state = "UNAVAILABLE"; }
    lastLatencyMs = now() - started;
    return { state, provider, model, capabilities: [...capabilities], qualityClass: state === "READY" ? "LIMITED" : "UNAVAILABLE", healthLatencyMs: lastLatencyMs };
  }
  async function run(request = {}) {
    if (state !== "READY" || typeof generate !== "function") throw Object.assign(new Error("Aucun modèle local prêt."), { code: "LOCAL_MODEL_UNAVAILABLE" });
    if (request.toolAccess === true) throw Object.assign(new Error("Un modèle local ne reçoit jamais d’autorité outil."), { code: "LOCAL_MODEL_TOOL_AUTHORITY_DENIED" });
    const started = now(); const result = await generate({ input: request.input, schema: request.schema || null, signal: request.signal });
    lastLatencyMs = now() - started; observability?.("local_model_completed", { provider, latencyMs: lastLatencyMs, capability: request.capability || "LOCAL_MODEL_TEXT" });
    return { output: result, backend: "LOCAL_MODEL", provider, model, qualityClass: "LIMITED", limitations: ["NOT_EQUIVALENT_TO_REMOTE_HIGH_QUALITY_MODEL"], latencyMs: lastLatencyMs, toolAuthority: false };
  }
  return { generate: run, health, listCapabilities: () => [...capabilities], status: () => ({ state, provider, model, lastLatencyMs, toolAuthority: false, persistentPromptLogging: false }) };
}

module.exports = { LOCAL_MODEL_STATES, createLocalModelAdapter };
