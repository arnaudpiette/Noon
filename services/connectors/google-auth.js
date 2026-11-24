// @ts-check
"use strict";

const crypto = require("crypto");
const { OAuth2Client, CodeChallengeMethod } = require("google-auth-library");
const { version: GOOGLE_AUTH_LIBRARY_VERSION } = require("google-auth-library/package.json");

const GOOGLE_OAUTH_TRANSACTION_TTL_MS = 10 * 60 * 1000;
/**
 * Erreur OAuth Google : code stable et diagnostic sans secret.
 * @typedef {Error & { reasonCode?: string, oauthDiagnostic?: object, profileDiagnostic?: object }} GoogleAuthError
 */
/**
 * Transaction PKCE en attente, identifiée par son `state` (mémoire seulement, TTL 10 min).
 * @typedef {{
 *   codeVerifier: string,
 *   createdAt: number,
 *   redirectUri: string,
 *   clientIdFingerprint: string,
 *   clientSecretFingerprint: string,
 *   pkce: ReturnType<typeof inspectGooglePkceAuthorizationUrl>,
 * }} PendingGoogleState
 */
/**
 * @typedef {{
 *   clientId?: string,
 *   clientSecret?: string,
 *   redirectUri?: string,
 *   oauthClientFactory?: ((config: { clientId?: string, clientSecret?: string, redirectUri?: string })
 *     => Pick<OAuth2Client, "generateCodeVerifierAsync" | "generateAuthUrl" | "getToken">) | null,
 * }} GoogleClientConfig
 */
/** @typedef {{ status?: number | null, error?: string | null, description?: string | null }} OAuthFailure */
/** @type {Map<string, PendingGoogleState>} */
const pendingStates = new Map();

/** @param {unknown} value */
function safeFingerprint(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex").slice(0, 16);
}

/** @param {GoogleClientConfig} config */
function createOfficialClient({ clientId, clientSecret, redirectUri, oauthClientFactory = null }) {
  if (oauthClientFactory) return oauthClientFactory({ clientId, clientSecret, redirectUri });
  return new OAuth2Client(clientId, clientSecret, redirectUri);
}

/** @param {string} authorizationUrl */
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

/**
 * @param {string} authorizationUrl
 * @param {string} expectedRedirectUri
 */
function assertGoogleRedirectAuthorizationUrl(authorizationUrl, expectedRedirectUri) {
  const actualRedirectUri = new URL(authorizationUrl).searchParams.get("redirect_uri");
  if (actualRedirectUri !== expectedRedirectUri) {
    /** @type {GoogleAuthError} */
    const error = new Error("URI de callback Google invalide.");
    error.code = "GOOGLE_OAUTH_REDIRECT_URI_INVALID";
    error.oauthDiagnostic = { redirectUriMatch: "FAIL" };
    throw error;
  }
  return "PASS";
}

/** @param {string} authorizationUrl */
function assertGooglePkceAuthorizationUrl(authorizationUrl) {
  const pkceUrl = inspectGooglePkceAuthorizationUrl(authorizationUrl);
  if (pkceUrl.codeChallengePresent !== "YES" || pkceUrl.codeChallengeMethodValue !== "S256") {
    /** @type {GoogleAuthError} */
    const error = new Error("Méthode PKCE Google invalide.");
    error.code = "GOOGLE_PKCE_METHOD_INVALID";
    error.oauthDiagnostic = pkceUrl;
    throw error;
  }
  return pkceUrl;
}

/**
 * @param {any} error
 * @returns {OAuthFailure}
 */
function providerFailure(error) {
  const payload = error?.response?.data;
  const status = Number(error?.response?.status || error?.status);
  return {
    status: Number.isInteger(status) ? status : null,
    error: typeof payload?.error === "string" ? payload.error.slice(0, 120) : null,
    description: typeof payload?.error_description === "string" ? payload.error_description.slice(0, 500) : null,
  };
}

/**
 * @param {{
 *   previousToken?: { refresh_token?: string | null } | null,
 *   token: Record<string, any>,
 *   email?: string | null,
 *   now?: number,
 * }} input
 */
function normalizeGoogleTokenForPersistence({ previousToken = null, token, email, now = Date.now() }) {
  return {
    ...token,
    refresh_token: token.refresh_token || previousToken?.refresh_token || null,
    expires_at: Number(token.expiry_date) || now + Number(token.expires_in || 3600) * 1000,
    email,
  };
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function safeGoogleApiCode(value) {
  return typeof value === "string" && /^[A-Za-z0-9_.-]{1,120}$/.test(value) ? value : null;
}

/** @param {any} payload */
function inspectGoogleApiFailure(payload) {
  const providerError = payload && typeof payload === "object" ? payload.error : null;
  const providerReason = Array.isArray(providerError?.errors)
    ? providerError.errors.map((/** @type {{ reason?: unknown }} */ entry) => safeGoogleApiCode(entry?.reason)).find(Boolean) || null
    : null;
  return {
    providerStatus: safeGoogleApiCode(providerError?.status),
    providerReason,
  };
}

/**
 * @param {{
 *   status?: unknown,
 *   ok?: boolean,
 *   emailAddress?: unknown,
 *   expectedEmail?: string | null,
 *   providerFailure?: { providerStatus?: unknown, providerReason?: unknown },
 * }} input
 */
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
    /** @type {GoogleAuthError} */
    const error = new Error("Vérification du profil Gmail refusée.");
    error.code = "GOOGLE_GMAIL_PROFILE_FAILED";
    error.profileDiagnostic = diagnostic;
    throw error;
  }
  if (diagnostic.accountMatched !== "YES") {
    /** @type {GoogleAuthError} */
    const error = new Error("Le compte Google autorisé ne correspond pas au compte Noon attendu.");
    error.code = "GOOGLE_ACCOUNT_MISMATCH";
    error.profileDiagnostic = diagnostic;
    throw error;
  }
  return diagnostic;
}

/**
 * @param {{
 *   pending?: PendingGoogleState | null,
 *   clientId?: string,
 *   clientSecret?: string,
 *   failure?: OAuthFailure,
 *   stateMatched?: boolean,
 *   exchangeCount?: number,
 * }} [input]
 */
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

/** @param {GoogleClientConfig & { scopes: string[] }} input */
async function createGoogleAuthorization({ clientId, clientSecret, redirectUri, scopes, oauthClientFactory = null }) {
  if (!clientId || !clientSecret || !redirectUri) throw new Error("Identifiants OAuth Google non configurés.");
  const oauth2Client = createOfficialClient({ clientId, clientSecret, redirectUri, oauthClientFactory });
  let officialPkce;
  try {
    officialPkce = await oauth2Client.generateCodeVerifierAsync();
  } catch {
    /** @type {GoogleAuthError} */
    const error = new Error("Transaction PKCE Google indisponible.");
    error.code = "GOOGLE_PKCE_GENERATION_FAILED";
    throw error;
  }
  const { codeVerifier, codeChallenge } = officialPkce || {};
  if (!codeVerifier || !codeChallenge) {
    /** @type {GoogleAuthError} */
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
    /** @type {GoogleAuthError} */
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

/**
 * @param {unknown} state
 * @param {number} [now]
 * @returns {PendingGoogleState}
 */
function consumeGoogleState(state, now = Date.now()) {
  const key = String(state);
  const pending = pendingStates.get(key);
  pendingStates.delete(key);
  if (!pending || now - pending.createdAt > GOOGLE_OAUTH_TRANSACTION_TTL_MS) {
    throw new Error("Callback OAuth Google inattendu ou expiré.");
  }
  return pending;
}

/** @param {unknown} state */
function discardGoogleState(state) {
  pendingStates.delete(String(state));
}

/**
 * Lève toujours une GoogleAuthError.
 * @param {{ state: unknown, clientId?: string, clientSecret?: string, providerError?: string }} input
 * @returns {never}
 */
function rejectGoogleAuthorization({ state, clientId, clientSecret, providerError = "access_denied" }) {
  let pending;
  try {
    pending = consumeGoogleState(state);
  } catch {
    /** @type {GoogleAuthError} */
    const error = new Error("Callback OAuth Google inattendu ou expiré.");
    error.code = "GOOGLE_OAUTH_STATE_INVALID";
    error.reasonCode = "AUTH_FAILED";
    error.oauthDiagnostic = oauthDiagnostic({ clientId, clientSecret, stateMatched: false });
    throw error;
  }
  /** @type {GoogleAuthError} */
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

/** @param {GoogleClientConfig & { code?: string, state: unknown }} input */
async function exchangeGoogleCode({ code, state, clientId, clientSecret, oauthClientFactory = null }) {
  let pending;
  try {
    pending = consumeGoogleState(state);
  } catch {
    /** @type {GoogleAuthError} */
    const error = new Error("Callback OAuth Google inattendu ou expiré.");
    error.code = "GOOGLE_OAUTH_STATE_INVALID";
    error.oauthDiagnostic = oauthDiagnostic({ clientId, clientSecret, stateMatched: false });
    throw error;
  }
  /** @param {OAuthFailure} [failure] */
  const diagnostic = (failure = {}) => oauthDiagnostic({
    pending,
    clientId,
    clientSecret,
    failure,
    stateMatched: true,
    exchangeCount: 1,
  });
  if (!code) {
    /** @type {GoogleAuthError} */
    const error = new Error("Code OAuth Google absent.");
    error.code = "GOOGLE_OAUTH_CODE_MISSING";
    error.oauthDiagnostic = diagnostic();
    throw error;
  }
  if (!clientId || !clientSecret) {
    /** @type {GoogleAuthError} */
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
      /** @type {GoogleAuthError} */
      const error = new Error("Réponse OAuth Google incomplète.");
      error.code = "GOOGLE_OAUTH_TOKEN_MISSING";
      error.oauthDiagnostic = diagnostic({ status: result?.res?.status || 200 });
      throw error;
    }
    return result.tokens;
  } catch (cause) {
    if (cause?.oauthDiagnostic) throw cause;
    const failure = providerFailure(cause);
    /** @type {GoogleAuthError} */
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
