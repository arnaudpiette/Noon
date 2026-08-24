"use strict";

function createConnector(definition, dependencies = {}) {
  const state = { lastSuccessfulRequestAt: null, lastError: null };
  const tokenStore = dependencies.tokenStore;
  const credentialId = definition.credentialId || definition.id;
  return {
    ...definition,
    get connected() { return Boolean(tokenStore?.get(credentialId)); },
    get status() {
      return {
        id: definition.id, displayName: definition.displayName,
        connected: Boolean(tokenStore?.get(credentialId)), capabilities: definition.capabilities,
        readCapabilities: definition.readCapabilities, writeCapabilities: definition.writeCapabilities,
        scopes: definition.scopes, lastSuccessfulRequestAt: state.lastSuccessfulRequestAt,
        lastError: state.lastError, health: tokenStore?.get(credentialId) ? "configured" : "disconnected",
      };
    },
    markSuccess() { state.lastSuccessfulRequestAt = new Date().toISOString(); state.lastError = null; },
    markError(error) { state.lastError = String(error?.message || error).slice(0, 300); },
    disconnect() { tokenStore?.remove(credentialId); state.lastError = null; },
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
    let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { text }; }
    if (!response.ok) throw new Error(`API distante indisponible (${response.status}).`);
    return data;
  } finally { clearTimeout(timeout); }
}

module.exports = { createConnector, providerFetch };
