"use strict";

// Fournisseur OAuth 2.1 (PKCE) pour le SDK MCP, adossé au coffre de jetons Noon
// (chiffré par safeStorage). Les jetons et l'enregistrement client vivent sous
// la clé `mcp:<serveur>` ; le code verifier et le state restent en mémoire.

const crypto = require("node:crypto");

function credentialKey(serverId) { return `mcp:${serverId}`; }

function createMcpOAuthProvider({ serverId, tokenStore, redirectUrl, clientName = "Noon", onAuthorizationUrl = () => {} }) {
  if (!serverId || !tokenStore || !redirectUrl) throw Object.assign(new Error("Fournisseur OAuth MCP incomplet."), { code: "MCP_OAUTH_CONFIG_INVALID" });
  const key = credentialKey(serverId);
  let codeVerifierValue = null;
  let stateValue = null;
  const read = () => tokenStore.get(key) || {};
  const write = (patch) => tokenStore.set(key, { ...read(), ...patch });
  return {
    get redirectUrl() { return redirectUrl; },
    get clientMetadata() {
      return { client_name: clientName, redirect_uris: [redirectUrl], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" };
    },
    state() { stateValue = crypto.randomBytes(24).toString("base64url"); return stateValue; },
    expectedState: () => stateValue,
    clientInformation() {
      const info = read().clientInformation;
      // Port loopback éphémère : un client enregistré pour une autre redirection est réenregistré.
      if (!info || (Array.isArray(info.redirect_uris) && !info.redirect_uris.includes(redirectUrl))) return undefined;
      return info;
    },
    saveClientInformation(clientInformation) { write({ clientInformation: { ...clientInformation, redirect_uris: clientInformation.redirect_uris || [redirectUrl] } }); },
    tokens() { return read().tokens; },
    saveTokens(tokens) { write({ tokens, savedAt: new Date().toISOString() }); },
    redirectToAuthorization(authorizationUrl) { onAuthorizationUrl(String(authorizationUrl)); },
    saveCodeVerifier(value) { codeVerifierValue = value; },
    codeVerifier() {
      if (!codeVerifierValue) throw Object.assign(new Error("Aucune autorisation MCP en cours."), { code: "MCP_OAUTH_NO_PENDING_AUTHORIZATION" });
      return codeVerifierValue;
    },
    invalidateCredentials(scope) {
      if (scope === "all") { tokenStore.remove(key); return; }
      const current = read();
      if (scope === "tokens") delete current.tokens;
      if (scope === "client") delete current.clientInformation;
      if (scope === "verifier") codeVerifierValue = null;
      if (scope !== "verifier") tokenStore.set(key, current);
    },
  };
}

module.exports = { createMcpOAuthProvider, credentialKey };
