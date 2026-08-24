"use strict";

const crypto = require("crypto");

const pendingStates = new Map();
function base64url(buffer) { return buffer.toString("base64url"); }
function createGoogleAuthorization({ clientId, redirectUri, scopes }) {
  if (!clientId || !redirectUri) throw new Error("Identifiants OAuth Google non configurés.");
  const state = base64url(crypto.randomBytes(24));
  const verifier = base64url(crypto.randomBytes(48));
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
  pendingStates.set(state, { verifier, createdAt: Date.now(), redirectUri });
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri,
    response_type: "code", access_type: "offline", prompt: "consent",
    scope: scopes.join(" "), state, code_challenge: challenge, code_challenge_method: "S256" });
  return { url: url.href, state };
}
function consumeGoogleState(state) {
  const pending = pendingStates.get(String(state));
  pendingStates.delete(String(state));
  if (!pending || Date.now() - pending.createdAt > 10 * 60 * 1000) throw new Error("Callback OAuth Google inattendu ou expiré.");
  return pending;
}
async function exchangeGoogleCode({ code, state, clientId, clientSecret }) {
  const pending = consumeGoogleState(state);
  if (!clientId || !clientSecret) throw new Error("Secret OAuth Google non configuré localement.");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret,
      redirect_uri: pending.redirectUri, grant_type: "authorization_code", code_verifier: pending.verifier }),
    signal: AbortSignal.timeout(10_000),
  });
  const token = await response.json();
  if (!response.ok || !token.access_token) throw new Error("Échange OAuth Google refusé.");
  return token;
}
module.exports = { createGoogleAuthorization, consumeGoogleState, exchangeGoogleCode };
