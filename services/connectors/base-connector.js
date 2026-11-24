// @ts-check
"use strict";

// Fabrique commune des connecteurs : état de santé, capacités et gestion normalisée des erreurs.

/**
 * Description statique d'un connecteur.
 * @typedef {{
 *   id: string,
 *   displayName: string,
 *   credentialId?: string,
 *   local?: boolean,
 *   remoteCapability?: string,
 *   capabilities?: string[],
 *   readCapabilities?: string[],
 *   writeCapabilities?: string[],
 *   scopes?: string[],
 * }} ConnectorDefinition
 */
/**
 * Dépendances injectées par server.js. Les écritures externes passent par `approvals`.
 * @typedef {{
 *   tokenStore?: { get: (id: string) => any, remove: (id: string) => void },
 *   reliability?: {
 *     recordSuccess: (id: string) => void,
 *     recordFailure: (id: string, error: unknown, details?: object) => void,
 *     snapshot: (id: string) => { state: string },
 *     execute: (id: string, operation: () => Promise<any>, options?: object) => Promise<{ data: any }>,
 *   } | null,
 *   disabledReason?: string | null,
 *   runtime?: { preflight: (input: { requiredCapabilities: string[] }) => { status: string } } | null,
 *   configured?: () => boolean,
 *   approvals?: {
 *     requestApproval: (input: object) => any,
 *     consumeApproval: (approvalId: string, scope: object) => any,
 *   },
 *   getGoogleAccessToken?: () => Promise<string | null | undefined> | string | null | undefined,
 *   dryRun?: boolean,
 * }} ConnectorDependencies
 */
/**
 * Exécuteur de processus au format execFile (injectable dans les tests). L'erreur reçue est celle
 * de child_process (code, killed), lue telle quelle.
 * @typedef {(
 *   file: string,
 *   args: string[],
 *   options: { timeout?: number, maxBuffer?: number },
 *   callback: (error: any, stdout: string | Buffer, stderr?: string | Buffer) => void,
 * ) => any} ProcessRunner
 */
/**
 * @param {ConnectorDefinition} definition
 * @param {ConnectorDependencies} [dependencies]
 */
function createConnector(definition, dependencies = {}) {
  const { classifyFailure } = require("../reliability/reliability-engine");
  /** @type {{ lastSuccessfulRequestAt: string | null, lastError: any }} */
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
  /**
   * @param {unknown} error
   * @param {boolean} [record]
   */
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
    /**
     * @template T
     * @param {() => Promise<T>} operation
     * @param {object} [options]
     * @returns {Promise<T>}
     */
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

/**
 * Appel HTTP authentifié vers un fournisseur ; renvoie le JSON décodé.
 * @param {string} url
 * @param {{
 *   token?: string | null,
 *   method?: string,
 *   headers?: Record<string, string>,
 *   body?: string,
 *   signal?: AbortSignal,
 *   timeoutMs?: number,
 * }} [options]
 * @returns {Promise<any>}
 */
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
