"use strict";

const crypto = require("crypto");
const { OAuth2Client, CodeChallengeMethod } = require("google-auth-library");
const { version: GOOGLE_AUTH_LIBRARY_VERSION } = require("google-auth-library/package.json");

const GOOGLE_OAUTH_TRANSACTION_TTL_MS = 10 * 60 * 1000;
const pendingStates = new Map();

function safeFingerprint(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex").slice(0, 16);
}

function createOfficialClient({ clientId, clientSecret, redirectUri, oauthClientFactory = null }) {
  if (oauthClientFactory) return oauthClientFactory({ clientId, clientSecret, redirectUri });
  return new OAuth2Client(clientId, clientSecret, redirectUri);
}

function inspectGooglePkceAuthorizationUrl(authorizationUrl) {
  const params = new URL(authorizationUrl).searchParams;
  const challengePresent = params.has("code_challenge") && Boolean(params.get("code_challenge"));
  const methodPresent = params.has("code_challenge_method");
  const method = params.get("code_challenge_method");
  return {
    codeChallengePresent: challengePresent ? "YES" : "NO",
    codeChallengeMethodPresent: methodPresent ? "YES" : "NO",
    codeChallengeMethodValue: methodPresent ? (method || "empty") : "plain",
    codeChallengeMethodExactName: methodPresent ? "PASS" : "FAIL",
  };
}

function assertGoogleRedirectAuthorizationUrl(authorizationUrl, expectedRedirectUri) {
  const actualRedirectUri = new URL(authorizationUrl).searchParams.get("redirect_uri");
  if (actualRedirectUri !== expectedRedirectUri) {
    const error = new Error("URI de callback Google invalide.");
    error.code = "GOOGLE_OAUTH_REDIRECT_URI_INVALID";
    error.oauthDiagnostic = { redirectUriMatch: "FAIL" };
    throw error;
  }
  return "PASS";
}

function assertGooglePkceAuthorizationUrl(authorizationUrl) {
  const pkceUrl = inspectGooglePkceAuthorizationUrl(authorizationUrl);
  if (pkceUrl.codeChallengePresent !== "YES" || pkceUrl.codeChallengeMethodValue !== "S256") {
    const error = new Error("Méthode PKCE Google invalide.");
    error.code = "GOOGLE_PKCE_METHOD_INVALID";
    error.oauthDiagnostic = pkceUrl;
    throw error;
  }
  return pkceUrl;
}

function providerFailure(error) {
  const payload = error?.response?.data;
  const status = Number(error?.response?.status || error?.status);
  return {
    status: Number.isInteger(status) ? status : null,
    error: typeof payload?.error === "string" ? payload.error.slice(0, 120) : null,
    description: typeof payload?.error_description === "string" ? payload.error_description.slice(0, 500) : null,
  };
}

function normalizeGoogleTokenForPersistence({ previousToken = null, token, email, now = Date.now() }) {
  return {
    ...token,
    refresh_token: token.refresh_token || previousToken?.refresh_token || null,
    expires_at: Number(token.expiry_date) || now + Number(token.expires_in || 3600) * 1000,
    email,
  };
}

function safeGoogleApiCode(value) {
  return typeof value === "string" && /^[A-Za-z0-9_.-]{1,120}$/.test(value) ? value : null;
}

function inspectGoogleApiFailure(payload) {
  const providerError = payload && typeof payload === "object" ? payload.error : null;
  const providerReason = Array.isArray(providerError?.errors)
    ? providerError.errors.map((entry) => safeGoogleApiCode(entry?.reason)).find(Boolean) || null
    : null;
  return {
    providerStatus: safeGoogleApiCode(providerError?.status),
    providerReason,
  };
}

function assertGoogleProfileResponse({ status, ok, emailAddress, expectedEmail, providerFailure = {} }) {
  const diagnostic = {
    httpStatus: Number.isInteger(Number(status)) ? Number(status) : null,
    responseOk: ok === true ? "YES" : "NO",
    emailPresent: typeof emailAddress === "string" && Boolean(emailAddress.trim()) ? "YES" : "NO",
    accountMatched: typeof emailAddress === "string" &&
      emailAddress.toLowerCase() === String(expectedEmail || "").toLowerCase() ? "YES" : "NO",
    providerStatus: safeGoogleApiCode(providerFailure.providerStatus),
    providerReason: safeGoogleApiCode(providerFailure.providerReason),
  };
  if (!ok) {
    const error = new Error("Vérification du profil Gmail refusée.");
    error.code = "GOOGLE_GMAIL_PROFILE_FAILED";
    error.profileDiagnostic = diagnostic;
    throw error;
  }
  if (diagnostic.accountMatched !== "YES") {
    const error = new Error("Le compte Google autorisé ne correspond pas au compte Noon attendu.");
    error.code = "GOOGLE_ACCOUNT_MISMATCH";
    error.profileDiagnostic = diagnostic;
    throw error;
  }
  return diagnostic;
}

function oauthDiagnostic({ pending = null, clientId, clientSecret, failure = {}, stateMatched, exchangeCount = 0 } = {}) {
  return {
    tokenEndpointStatus: Number.isInteger(failure.status) ? failure.status : null,
    googleOAuthError: failure.error || null,
    errorDescription: failure.description || null,
    redirectUri: pending?.redirectUri || null,
    redirectUriMatch: pending?.redirectUri ? "PASS" : "NOT_VERIFIED",
    codeVerifierAvailable: pending?.codeVerifier ? "YES" : "NO",
    stateMatched: stateMatched ? "YES" : "NO",
    callbackExchangedOnce: exchangeCount === 1 ? "YES" : exchangeCount > 1 ? "NO" : "NOT_VERIFIED",
    clientConfigLoaded: clientId && clientSecret ? "YES" : "NO",
    clientIdMatch: pending?.clientIdFingerprint
      ? (pending.clientIdFingerprint === safeFingerprint(clientId) ? "PASS" : "FAIL")
      : "NOT_VERIFIED",
    clientSecretConfig: pending?.clientSecretFingerprint
      ? (pending.clientSecretFingerprint === safeFingerprint(clientSecret) ? "CONSISTENT" : "FAIL")
      : "UNKNOWN",
    officialLibrary: "google-auth-library",
    officialLibraryVersion: GOOGLE_AUTH_LIBRARY_VERSION,
    ...(pending?.pkce || {}),
  };
}

async function createGoogleAuthorization({ clientId, clientSecret, redirectUri, scopes, oauthClientFactory = null }) {
  if (!clientId || !clientSecret || !redirectUri) throw new Error("Identifiants OAuth Google non configurés.");
  const oauth2Client = createOfficialClient({ clientId, clientSecret, redirectUri, oauthClientFactory });
  let officialPkce;
  try {
    officialPkce = await oauth2Client.generateCodeVerifierAsync();
  } catch {
    const error = new Error("Transaction PKCE Google indisponible.");
    error.code = "GOOGLE_PKCE_GENERATION_FAILED";
    throw error;
  }
  const { codeVerifier, codeChallenge } = officialPkce || {};
  if (!codeVerifier || !codeChallenge) {
    const error = new Error("Transaction PKCE Google indisponible.");
    error.code = "GOOGLE_PKCE_GENERATION_FAILED";
    throw error;
  }
  const state = crypto.randomBytes(24).toString("base64url");
  let url;
  try {
    url = oauth2Client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: scopes,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256,
    });
  } catch {
    const error = new Error("Autorisation Google indisponible.");
    error.code = "GOOGLE_OAUTH_AUTHORIZATION_UNAVAILABLE";
    throw error;
  }
  const pkce = assertGooglePkceAuthorizationUrl(url);
  const redirectUriMatch = assertGoogleRedirectAuthorizationUrl(url, redirectUri);
  pendingStates.set(state, {
    codeVerifier,
    createdAt: Date.now(),
    redirectUri,
    clientIdFingerprint: safeFingerprint(clientId),
    clientSecretFingerprint: safeFingerprint(clientSecret),
    pkce,
  });
  return { url, state, pkce: { ...pkce, redirectUriMatch } };
}

function consumeGoogleState(state, now = Date.now()) {
  const key = String(state);
  const pending = pendingStates.get(key);
  pendingStates.delete(key);
  if (!pending || now - pending.createdAt > GOOGLE_OAUTH_TRANSACTION_TTL_MS) {
    throw new Error("Callback OAuth Google inattendu ou expiré.");
  }
  return pending;
}

function discardGoogleState(state) {
  pendingStates.delete(String(state));
}

function rejectGoogleAuthorization({ state, clientId, clientSecret, providerError = "access_denied" }) {
  let pending;
  try {
    pending = consumeGoogleState(state);
  } catch {
    const error = new Error("Callback OAuth Google inattendu ou expiré.");
    error.code = "GOOGLE_OAUTH_STATE_INVALID";
    error.reasonCode = "AUTH_FAILED";
    error.oauthDiagnostic = oauthDiagnostic({ clientId, clientSecret, stateMatched: false });
    throw error;
  }
  const error = new Error("Autorisation Google refusée.");
  error.code = "GOOGLE_OAUTH_AUTH_DENIED";
  error.reasonCode = "AUTH_DENIED";
  error.oauthDiagnostic = oauthDiagnostic({
    pending,
    clientId,
    clientSecret,
    failure: { error: String(providerError).slice(0, 120) },
    stateMatched: true,
  });
  throw error;
}

async function exchangeGoogleCode({ code, state, clientId, clientSecret, oauthClientFactory = null }) {
  let pending;
  try {
    pending = consumeGoogleState(state);
  } catch {
    const error = new Error("Callback OAuth Google inattendu ou expiré.");
    error.code = "GOOGLE_OAUTH_STATE_INVALID";
    error.oauthDiagnostic = oauthDiagnostic({ clientId, clientSecret, stateMatched: false });
    throw error;
  }
  const diagnostic = (failure = {}) => oauthDiagnostic({
    pending,
    clientId,
    clientSecret,
    failure,
    stateMatched: true,
    exchangeCount: 1,
  });
  if (!code) {
    const error = new Error("Code OAuth Google absent.");
    error.code = "GOOGLE_OAUTH_CODE_MISSING";
    error.oauthDiagnostic = diagnostic();
    throw error;
  }
  if (!clientId || !clientSecret) {
    const error = new Error("Secret OAuth Google non configuré localement.");
    error.code = "GOOGLE_OAUTH_CLIENT_CONFIG_MISSING";
    error.oauthDiagnostic = diagnostic();
    throw error;
  }
  const oauth2Client = createOfficialClient({ clientId, clientSecret, redirectUri: pending.redirectUri, oauthClientFactory });
  try {
    const result = await oauth2Client.getToken({
      code,
      codeVerifier: pending.codeVerifier,
      client_id: clientId,
      redirect_uri: pending.redirectUri,
    });
    if (!result?.tokens?.access_token) {
      const error = new Error("Réponse OAuth Google incomplète.");
      error.code = "GOOGLE_OAUTH_TOKEN_MISSING";
      error.oauthDiagnostic = diagnostic({ status: result?.res?.status || 200 });
      throw error;
    }
    return result.tokens;
  } catch (cause) {
    if (cause?.oauthDiagnostic) throw cause;
    const failure = providerFailure(cause);
    const error = new Error(failure.status ? "Échange OAuth Google refusé." : "Échange OAuth Google indisponible.");
    error.code = failure.status ? "GOOGLE_OAUTH_TOKEN_EXCHANGE_FAILED" : "GOOGLE_OAUTH_TOKEN_ENDPOINT_UNREACHABLE";
    error.reasonCode = failure.error === "invalid_grant" ? "AUTH_FAILED" : failure.status ? "AUTH_FAILED" : "UNAVAILABLE";
    error.oauthDiagnostic = diagnostic(failure);
    throw error;
  }
}

module.exports = {
  GOOGLE_AUTH_LIBRARY_VERSION,
  GOOGLE_OAUTH_TRANSACTION_TTL_MS,
  createGoogleAuthorization,
  consumeGoogleState,
  discardGoogleState,
  exchangeGoogleCode,
  normalizeGoogleTokenForPersistence,
  inspectGoogleApiFailure,
  assertGoogleProfileResponse,
  rejectGoogleAuthorization,
  inspectGooglePkceAuthorizationUrl,
  assertGooglePkceAuthorizationUrl,
  assertGoogleRedirectAuthorizationUrl,
};
