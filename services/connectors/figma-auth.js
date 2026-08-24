"use strict";

const crypto = require("crypto");
const pendingStates = new Map();
function createFigmaAuthorization({ clientId, redirectUri, scopes }) {
  if (!clientId || !redirectUri) throw new Error("Identifiants OAuth Figma non configurés.");
  const state = crypto.randomBytes(24).toString("base64url");
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  pendingStates.set(state, { verifier, redirectUri, createdAt: Date.now() });
  const url = new URL("https://www.figma.com/oauth");
  url.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri,
    scope: scopes.join(","), state, response_type: "code", code_challenge: challenge,
    code_challenge_method: "S256" });
  return { url: url.href, state };
}
async function exchangeFigmaCode({ code, state, clientId, clientSecret }) {
  const pending = pendingStates.get(String(state)); pendingStates.delete(String(state));
  if (!pending || Date.now() - pending.createdAt > 10 * 60 * 1000) throw new Error("Callback OAuth Figma inattendu ou expiré.");
  if (!clientId || !clientSecret) throw new Error("Secret OAuth Figma non configuré localement.");
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const response = await fetch("https://api.figma.com/v1/oauth/token", {
    method: "POST", headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ redirect_uri: pending.redirectUri, code, grant_type: "authorization_code", code_verifier: pending.verifier }),
    signal: AbortSignal.timeout(10_000),
  });
  const token = await response.json();
  if (!response.ok || !token.access_token) throw new Error("Échange OAuth Figma refusé.");
  return token;
}
module.exports = { createFigmaAuthorization, exchangeFigmaCode };
