"use strict";

// V3-L7 — compte Google de Noon : OAuth en lecture seule (boucle locale éphémère, échange du code,
// vérification du profil, renouvellement du jeton) et recherche Gmail autorisée, sortis de server.js.
// Domaine déplacé tel quel depuis server.js. Dépendances déjà déclarées quand server.js le
// construit : lues une fois ; les autres (`deps.x`) : lues à chaque usage, par accesseur.

const DEPENDENCIES = Object.freeze(["GOOGLE_ACCOUNT_EMAIL","GOOGLE_AUTH_LIBRARY_VERSION","assertGoogleProfileResponse","calendarConnector","createGoogleAuthorization","discardGoogleState","exchangeGoogleCode","gmailConnector","http","inspectGoogleApiFailure","integrationTokenStore","localIntelligenceRuntime","normalizeGoogleTokenForPersistence","rejectGoogleAuthorization","toolAuditLog"]);

function createGoogleAccount(deps) {
  for (const name of DEPENDENCIES) if (!(name in deps)) throw new TypeError(`Dépendance manquante : ${name}`);
  const {
    GOOGLE_ACCOUNT_EMAIL,
    GOOGLE_AUTH_LIBRARY_VERSION,
    assertGoogleProfileResponse,
    createGoogleAuthorization,
    discardGoogleState,
    exchangeGoogleCode,
    http,
    inspectGoogleApiFailure,
    normalizeGoogleTokenForPersistence,
    rejectGoogleAuthorization,
    toolAuditLog,
  } = deps;

  const GOOGLE_OAUTH_CALLBACK_PATH = "/integrations/google/callback";

  const GOOGLE_OAUTH_LOOPBACK_TIMEOUT_MS = 10 * 60 * 1000;

  function assertGoogleRemoteAvailable(capability = "REMOTE_GMAIL") {
    const result = deps.localIntelligenceRuntime.preflight({ requiredCapabilities: [capability] });
    if (result.status !== "AVAILABLE") throw Object.assign(new Error("Source Google bloquée par la politique locale ou le réseau."), { code: "REMOTE_CONNECTOR_BLOCKED" });
  }

  let googleRefreshInFlight = null;

  async function refreshGoogleAccessToken(savedToken) {
    assertGoogleRemoteAvailable();
    if (!savedToken?.refresh_token) {
      throw new Error("Reconnectez Gmail pour renouveler l’autorisation.");
    }
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_OAUTH_CLIENT_ID || "",
        client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || "",
        refresh_token: savedToken.refresh_token,
        grant_type: "refresh_token",
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const refreshed = await response.json();
    if (!response.ok || !refreshed.access_token) {
      // Code d'erreur OAuth de Google seulement (ex. invalid_grant), jamais de jeton ni de secret.
      const providerError = typeof refreshed?.error === "string" ? refreshed.error.replace(/[^a-z_]/gi, "").slice(0, 40) : null;
      toolAuditLog.append("google-oauth.refresh-failed", { status: response.status, providerError });
      throw Object.assign(new Error("Reconnectez Google pour renouveler l’autorisation."), { status: response.status === 400 ? 401 : response.status, providerError });
    }
    const token = {
      ...savedToken,
      ...refreshed,
      expires_at: Date.now() + Number(refreshed.expires_in || 3600) * 1000,
    };
    deps.integrationTokenStore.set("google", token);
    return token.access_token;
  }

  async function getGoogleAccessToken() {
    assertGoogleRemoteAvailable();
    const token = deps.integrationTokenStore.get("google");
    if (!token?.access_token) {
      throw Object.assign(new Error("Google n’est pas connecté."), { status: 401, code: "AUTH_MISSING" });
    }
    if (!token.expires_at || token.expires_at > Date.now() + 60_000) {
      return token.access_token;
    }
    if (!googleRefreshInFlight) googleRefreshInFlight = refreshGoogleAccessToken(token).finally(() => { googleRefreshInFlight = null; });
    return googleRefreshInFlight;
  }

  function sendGoogleCallbackPage(res, { statusCode, title, message }) {
    res.writeHead(statusCode, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    return res.end(`<!doctype html><html lang="fr"><meta charset="utf-8"><title>${title}</title><body style="font-family:system-ui;padding:40px"><h1>${title}</h1><p>${message}</p><p>Vous pouvez fermer cette fenêtre.</p></body></html>`);
  }

  async function completeGoogleOAuthCallback(callbackUrl) {
    let completionStage = "CALLBACK";
    try {
      const oauthError = callbackUrl.searchParams.get("error");
      if (oauthError) rejectGoogleAuthorization({
        state: callbackUrl.searchParams.get("state"),
        clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
        clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
        providerError: oauthError,
      });
      assertGoogleRemoteAvailable();
      completionStage = "TOKEN_EXCHANGE";
      const token = await exchangeGoogleCode({
        code: callbackUrl.searchParams.get("code"),
        state: callbackUrl.searchParams.get("state"),
        clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
        clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      });
      toolAuditLog.append("google-oauth.token-exchange", {
        tokenEndpointStatus: 200,
        tokensReceived: token.access_token ? "YES" : "NO",
        refreshTokenReceived: token.refresh_token ? "YES" : "NO",
        stateMatched: "YES",
        callbackExchangedOnce: "YES",
        officialLibrary: "google-auth-library",
        officialLibraryVersion: GOOGLE_AUTH_LIBRARY_VERSION,
      });
      completionStage = "GMAIL_PROFILE";
      const profileResponse = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
        headers: { Authorization: `Bearer ${token.access_token}` },
        signal: AbortSignal.timeout(10_000),
      });
      const profile = await profileResponse.json();
      const profileDiagnostic = assertGoogleProfileResponse({
        status: profileResponse.status,
        ok: profileResponse.ok,
        emailAddress: profile.emailAddress,
        expectedEmail: GOOGLE_ACCOUNT_EMAIL,
        providerFailure: inspectGoogleApiFailure(profile),
      });
      toolAuditLog.append("google-oauth.profile-verification", profileDiagnostic);
      completionStage = "TOKEN_PERSISTENCE";
      const previousToken = deps.integrationTokenStore.get("google");
      const persistedToken = normalizeGoogleTokenForPersistence({ previousToken, token, email: GOOGLE_ACCOUNT_EMAIL });
      const persistence = deps.integrationTokenStore.set("google", persistedToken);
      toolAuditLog.append("google-oauth.persistence", {
        safeStorage: persistence.persistent ? "PASS" : "MEMORY_ONLY",
        refreshTokenPreserved: token.refresh_token || previousToken?.refresh_token ? "YES" : "NO",
      });
      deps.gmailConnector.markSuccess();
      return {
        statusCode: 200,
        title: "Google connecté à Noon",
        message: `Le compte ${GOOGLE_ACCOUNT_EMAIL} est autorisé pour Gmail et Calendar. Aucun e-mail ne sera envoyé automatiquement.`,
      };
    } catch (error) {
      if (error.oauthDiagnostic) toolAuditLog.append("google-oauth.token-exchange", error.oauthDiagnostic);
      if (error.profileDiagnostic) toolAuditLog.append("google-oauth.profile-verification", error.profileDiagnostic);
      toolAuditLog.append("google-oauth.completion-failed", {
        stage: completionStage,
        code: String(error.code || error.name || "GOOGLE_OAUTH_COMPLETION_FAILED").slice(0, 80),
        httpStatus: error.profileDiagnostic?.httpStatus || null,
        providerStatus: error.profileDiagnostic?.providerStatus || null,
        providerReason: error.profileDiagnostic?.providerReason || null,
      });
      return { statusCode: 400, title: "Connexion Gmail impossible", message: String(error.message || error) };
    }
  }

  async function createGoogleLoopbackReceiver() {
    let expectedState = null;
    let redirectUri = null;
    let timeout = null;
    const receiver = http.createServer(async (req, res) => {
      const callbackUrl = new URL(req.url, redirectUri || "http://127.0.0.1");
      if (req.method !== "GET" || callbackUrl.pathname !== GOOGLE_OAUTH_CALLBACK_PATH) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
        return res.end("Not found");
      }
      if (!expectedState || callbackUrl.searchParams.get("state") !== expectedState) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
        return res.end("Invalid OAuth state");
      }
      const result = await completeGoogleOAuthCallback(callbackUrl);
      sendGoogleCallbackPage(res, result);
      setImmediate(() => {
        if (timeout) clearTimeout(timeout);
        receiver.close();
      });
    });
    await new Promise((resolve, reject) => {
      receiver.once("error", reject);
      receiver.listen(0, "127.0.0.1", resolve);
    });
    const address = receiver.address();
    redirectUri = `http://127.0.0.1:${address.port}${GOOGLE_OAUTH_CALLBACK_PATH}`;
    timeout = setTimeout(() => {
      if (expectedState) discardGoogleState(expectedState);
      receiver.close();
    }, GOOGLE_OAUTH_LOOPBACK_TIMEOUT_MS);
    timeout.unref?.();
    return {
      redirectUri,
      setExpectedState(state) { expectedState = state; },
      close() { if (timeout) clearTimeout(timeout); receiver.close(); },
    };
  }

  async function createGoogleReadAuthorization() {
    assertGoogleRemoteAvailable();
    const loopback = await createGoogleLoopbackReceiver();
    let authorization;
    try {
      authorization = await createGoogleAuthorization({
        clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
        clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
        redirectUri: loopback.redirectUri,
        scopes: [...new Set([...deps.gmailConnector.scopes, ...deps.calendarConnector.scopes])],
      });
      loopback.setExpectedState(authorization.state);
    } catch (error) {
      loopback.close();
      throw error;
    }
    toolAuditLog.append("google-oauth.authorization-created", {
      redirectUri: loopback.redirectUri,
      loopbackPortMode: "EPHEMERAL",
      redirectUriMatch: authorization.pkce?.redirectUriMatch || "FAIL",
      codeVerifierAvailable: "YES",
      stateMatched: "NOT_APPLICABLE",
      callbackExchangedOnce: "NOT_ATTEMPTED",
      clientConfigLoaded: process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET ? "YES" : "NO",
      codeChallengePresent: authorization.pkce?.codeChallengePresent || "NO",
      codeChallengeMethodPresent: authorization.pkce?.codeChallengeMethodPresent || "NO",
      codeChallengeMethodValue: authorization.pkce?.codeChallengeMethodValue || "plain",
      codeChallengeMethodExactName: authorization.pkce?.codeChallengeMethodExactName || "FAIL",
      officialLibrary: "google-auth-library",
      officialLibraryVersion: GOOGLE_AUTH_LIBRARY_VERSION,
    });
    return authorization;
  }

  function decodeGmailBase64(value) {
    if (typeof value !== "string" || !value) return "";
    try {
      return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64")
        .toString("utf8");
    } catch {
      return "";
    }
  }

  function extractGmailText(part) {
    if (!part || typeof part !== "object") return "";
    const children = Array.isArray(part.parts)
      ? part.parts.map(extractGmailText).filter(Boolean)
      : [];
    if (children.length > 0) return children.join("\n");
    if (!["text/plain", "text/html"].includes(part.mimeType)) return "";
    const decoded = decodeGmailBase64(part.body?.data);
    return part.mimeType === "text/html"
      ? decoded.replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
      : decoded.trim();
  }

  function normalizeGmailMessage(message) {
    const headers = Object.fromEntries(
      (message?.payload?.headers || []).map((header) => [
        String(header.name || "").toLowerCase(),
        String(header.value || ""),
      ])
    );
    const content = extractGmailText(message?.payload).slice(0, 12_000);
    return {
      id: message?.id || null,
      threadId: message?.threadId || null,
      date: headers.date || null,
      from: headers.from || null,
      to: headers.to || null,
      subject: headers.subject || "(Sans objet)",
      snippet: String(message?.snippet || "").slice(0, 500),
      content,
      truncated: extractGmailText(message?.payload).length > content.length,
    };
  }

  async function searchAuthorizedGmail(query, maxResults = 8) {
    const boundedMax = Math.max(1, Math.min(10, Number(maxResults) || 8));
    const search = await deps.gmailConnector.searchGmailMessages(query, {
      maxResults: boundedMax,
    });
    const messages = await Promise.all(
      (search.messages || []).slice(0, boundedMax)
        .map(({ id }) => deps.gmailConnector.getGmailMessage(id))
    );
    deps.gmailConnector.markSuccess();
    return {
      account: GOOGLE_ACCOUNT_EMAIL,
      query: String(query).slice(0, 500),
      count: messages.length,
      messages: messages.map(normalizeGmailMessage),
    };
  }

  return { getGoogleAccessToken, sendGoogleCallbackPage, completeGoogleOAuthCallback, createGoogleReadAuthorization, normalizeGmailMessage, searchAuthorizedGmail };
}

module.exports = { DEPENDENCIES, createGoogleAccount };
