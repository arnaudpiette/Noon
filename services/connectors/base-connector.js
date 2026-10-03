"use strict";

// Fabrique commune des connecteurs : état de santé, capacités et gestion normalisée des erreurs.

function createConnector(definition, dependencies = {}) {
  const { classifyFailure } = require("../reliability/reliability-engine");
  const state = { lastSuccessfulRequestAt: null, lastError: null };
  const tokenStore = dependencies.tokenStore;
  const reliability = dependencies.reliability;
  const credentialId = definition.credentialId || definition.id;
  const connected = () => definition.local === true ? Boolean(state.lastSuccessfulRequestAt) : Boolean(tokenStore?.get(credentialId));
  function assertRemoteAvailable() {
    if (dependencies.disabledReason) {
      throw Object.assign(new Error(dependencies.disabledReason), { code: "UI_VALIDATION_EXTERNAL_DISABLED" });
    }
    if (!definition.remoteCapability || !dependencies.runtime) return;
    const result = dependencies.runtime.preflight({ requiredCapabilities: [definition.remoteCapability] });
    if (result.status !== "AVAILABLE") throw Object.assign(new Error("Source distante bloquée par la politique locale ou le réseau."), { code: "REMOTE_CONNECTOR_BLOCKED" });
  }
  function markSuccess() {
    state.lastSuccessfulRequestAt = new Date().toISOString(); state.lastError = null;
    try { reliability?.recordSuccess(definition.id); } catch {}
  }
  function markError(error, record = true) {
    state.lastError = classifyFailure(error);
    if (record) try { reliability?.recordFailure(definition.id, error); } catch {}
  }
  return {
    ...definition,
    get connected() { return connected(); },
    get status() {
      let health = state.lastError ? "UNAVAILABLE" : state.lastSuccessfulRequestAt ? "HEALTHY" : "UNKNOWN";
      try { if (reliability) health = reliability.snapshot(definition.id).state; } catch {}
      const authState = dependencies.disabledReason ? "DISABLED"
        : state.lastError?.category === "AUTH_REQUIRED" ? "AUTH_REQUIRED"
        : state.lastError?.category === "PERMISSION_DENIED" ? "PERMISSION_DENIED"
          : definition.local ? (state.lastSuccessfulRequestAt ? "GRANTED" : "UNKNOWN")
            : connected() ? "CONNECTED" : dependencies.configured?.() === false ? "NOT_CONFIGURED" : "AUTH_REQUIRED";
      return {
        id: definition.id, displayName: definition.displayName, connected: connected(), authState,
        capabilities: definition.capabilities, readCapabilities: definition.readCapabilities,
        writeCapabilities: definition.writeCapabilities, scopes: definition.scopes,
        lastSuccessfulRequestAt: state.lastSuccessfulRequestAt,
        lastError: dependencies.disabledReason || state.lastError?.safeMessage || null, reasonCode: dependencies.disabledReason ? "UI_VALIDATION_EXTERNAL_DISABLED" : state.lastError?.category || null, health,
      };
    },
    assertRemoteAvailable, markSuccess, markError,
    async run(operation, options = {}) {
      try {
        assertRemoteAvailable();
        const data = reliability ? (await reliability.execute(definition.id, operation, options)).data : await operation();
        state.lastSuccessfulRequestAt = new Date().toISOString(); state.lastError = null;
        return data;
      } catch (error) { markError(error, !reliability); throw error; }
    },
    disconnect() {
      tokenStore?.remove(credentialId); state.lastError = null; state.lastSuccessfulRequestAt = null;
      try { reliability?.recordFailure(definition.id, Object.assign(new Error("Connexion locale supprimée"), { status: 401 }), { authState: "missing" }); } catch {}
      return { status: "disconnected", providerRevoked: false };
    },
  };
}

async function providerFetch(url, { token, method = "GET", headers = {}, body, signal, timeoutMs = 10_000 } = {}) {
  if (!token) throw new Error("Intégration non connectée.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) signal.addEventListener("abort", () => controller.abort(), { once: true });
  try {
    const response = await fetch(url, {
      method, headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...headers },
      body, signal: controller.signal,
    });
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; }
    catch { throw Object.assign(new Error("Réponse du fournisseur invalide."), { code: "INVALID_RESPONSE", status: response.ok ? undefined : response.status }); }
    if (!response.ok) {
      const error = new Error(`API distante indisponible (${response.status}).`);
      error.status = response.status;
      error.code = "REMOTE_HTTP_ERROR";
      throw error;
    }
    return data;
  } finally { clearTimeout(timeout); }
}

module.exports = { createConnector, providerFetch };
