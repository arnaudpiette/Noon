"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  GOOGLE_AUTH_LIBRARY_VERSION,
  GOOGLE_OAUTH_TRANSACTION_TTL_MS,
  createGoogleAuthorization,
  consumeGoogleState,
  exchangeGoogleCode,
  normalizeGoogleTokenForPersistence,
  rejectGoogleAuthorization,
  assertGooglePkceAuthorizationUrl,
  assertGoogleRedirectAuthorizationUrl,
  inspectGoogleApiFailure,
  assertGoogleProfileResponse,
} = require("../services/connectors/google-auth");

const redirectUri = "http://127.0.0.1:3000/integrations/google/callback";
const credentials = { clientId: "client-id", clientSecret: "synthetic-secret", redirectUri, scopes: ["scope"] };

function createMockFactory({ getToken = async () => ({ tokens: { access_token: "synthetic-access", refresh_token: "synthetic-refresh", expiry_date: Date.now() + 3600_000 }, res: { status: 200 } }) } = {}) {
  let sequence = 0;
  return () => ({
    generateCodeVerifierAsync: async () => {
      sequence += 1;
      return { codeVerifier: `verifier-${String(sequence).padStart(55, "x")}`, codeChallenge: `challenge-${String(sequence).padStart(33, "y")}` };
    },
    generateAuthUrl: (options) => {
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.search = new URLSearchParams({
        client_id: "client-id",
        redirect_uri: redirectUri,
        response_type: "code",
        access_type: options.access_type,
        prompt: options.prompt,
        scope: options.scope.join(" "),
        state: options.state,
        code_challenge: options.code_challenge,
        code_challenge_method: options.code_challenge_method,
      });
      return url.href;
    },
    getToken,
  });
}

test("la dépendance runtime utilise google-auth-library 11.0.2", () => {
  assert.equal(GOOGLE_AUTH_LIBRARY_VERSION, "11.0.2");
});

test("createGoogleAuthorization utilise le PKCE officiel et produit S256", async () => {
  const authorization = await createGoogleAuthorization(credentials);
  const params = new URL(authorization.url).searchParams;
  assert.ok(params.get("code_challenge"));
  assert.equal(params.get("code_challenge_method"), "S256");
  assert.deepEqual(assertGooglePkceAuthorizationUrl(authorization.url), {
    codeChallengePresent: "YES",
    codeChallengeMethodPresent: "YES",
    codeChallengeMethodValue: "S256",
    codeChallengeMethodExactName: "PASS",
  });
  assert.equal(assertGoogleRedirectAuthorizationUrl(authorization.url, redirectUri), "PASS");
  assert.equal(authorization.pkce.redirectUriMatch, "PASS");
});

test("une URI de callback tronquée bloque OAuth avant ouverture du navigateur", () => {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("redirect_uri", "http://127.0.0.1:55370/integrations/google%");
  assert.throws(
    () => assertGoogleRedirectAuthorizationUrl(url.href, "http://127.0.0.1:55370/integrations/google/callback"),
    { code: "GOOGLE_OAUTH_REDIRECT_URI_INVALID" }
  );
});

test("un challenge sans méthode S256 bloque OAuth avant ouverture du navigateur", () => {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({ code_challenge: "synthetic-challenge" });
  assert.throws(() => assertGooglePkceAuthorizationUrl(url.href), { code: "GOOGLE_PKCE_METHOD_INVALID" });
});

test("le callback utilise OAuth2Client.getToken avec le verifier officiel", async () => {
  let received = null;
  const oauthClientFactory = createMockFactory({ getToken: async (options) => {
    received = options;
    return { tokens: { access_token: "synthetic-access", refresh_token: "synthetic-refresh", expiry_date: 12345 }, res: { status: 200 } };
  } });
  const authorization = await createGoogleAuthorization({ ...credentials, oauthClientFactory });
  const token = await exchangeGoogleCode({ code: "synthetic-code", state: authorization.state, clientId: credentials.clientId, clientSecret: credentials.clientSecret, oauthClientFactory });
  assert.equal(received.code, "synthetic-code");
  assert.match(received.codeVerifier, /^verifier-/);
  assert.equal(received.redirect_uri, redirectUri);
  assert.equal(received.client_id, credentials.clientId);
  assert.equal(token.refresh_token, "synthetic-refresh");
  assert.equal(token.expiry_date, 12345);
});

test("deux transactions simultanées conservent leurs verifiers officiels séparés", async () => {
  const received = [];
  const oauthClientFactory = createMockFactory({ getToken: async (options) => {
    received.push(options);
    return { tokens: { access_token: "synthetic-access" }, res: { status: 200 } };
  } });
  const first = await createGoogleAuthorization({ ...credentials, oauthClientFactory });
  const second = await createGoogleAuthorization({ ...credentials, oauthClientFactory });
  assert.notEqual(first.state, second.state);
  await exchangeGoogleCode({ code: "code-second", state: second.state, clientId: credentials.clientId, clientSecret: credentials.clientSecret, oauthClientFactory });
  await exchangeGoogleCode({ code: "code-first", state: first.state, clientId: credentials.clientId, clientSecret: credentials.clientSecret, oauthClientFactory });
  assert.notEqual(received[0].codeVerifier, received[1].codeVerifier);
});

test("une transaction expirée et un state inconnu sont rejetés", async () => {
  const oauthClientFactory = createMockFactory();
  const authorization = await createGoogleAuthorization({ ...credentials, oauthClientFactory });
  assert.throws(() => consumeGoogleState(authorization.state, Date.now() + GOOGLE_OAUTH_TRANSACTION_TTL_MS + 1));
  await assert.rejects(exchangeGoogleCode({ code: "synthetic-code", state: "unknown-state", clientId: credentials.clientId, clientSecret: credentials.clientSecret, oauthClientFactory }), { code: "GOOGLE_OAUTH_STATE_INVALID" });
});

test("un callback rejoué est bloqué avant OAuth2Client.getToken", async () => {
  let calls = 0;
  const oauthClientFactory = createMockFactory({ getToken: async () => {
    calls += 1;
    return { tokens: { access_token: "synthetic-access" }, res: { status: 200 } };
  } });
  const authorization = await createGoogleAuthorization({ ...credentials, oauthClientFactory });
  const args = { code: "synthetic-code", state: authorization.state, clientId: credentials.clientId, clientSecret: credentials.clientSecret, oauthClientFactory };
  await exchangeGoogleCode(args);
  await assert.rejects(exchangeGoogleCode(args), { code: "GOOGLE_OAUTH_STATE_INVALID" });
  assert.equal(calls, 1);
});

test("un refus utilisateur est normalisé et consomme la transaction", async () => {
  const oauthClientFactory = createMockFactory();
  const authorization = await createGoogleAuthorization({ ...credentials, oauthClientFactory });
  assert.throws(
    () => rejectGoogleAuthorization({ state: authorization.state, clientId: credentials.clientId, clientSecret: credentials.clientSecret }),
    (error) => error.code === "GOOGLE_OAUTH_AUTH_DENIED" && error.reasonCode === "AUTH_DENIED"
  );
  await assert.rejects(
    exchangeGoogleCode({ code: "synthetic-code", state: authorization.state, clientId: credentials.clientId, clientSecret: credentials.clientSecret, oauthClientFactory }),
    { code: "GOOGLE_OAUTH_STATE_INVALID" }
  );
});

test("le runtime ne contient plus de PKCE ni de token POST custom", () => {
  const fs = require("node:fs");
  const source = fs.readFileSync(require.resolve("../services/connectors/google-auth"), "utf8");
  assert.match(source, /new OAuth2Client/);
  assert.match(source, /generateCodeVerifierAsync/);
  assert.match(source, /oauth2Client\.getToken/);
  assert.doesNotMatch(source, /oauth2\.googleapis\.com\/token/);
  assert.doesNotMatch(source, /randomBytes\(48\)/);
  assert.doesNotMatch(source, /createHash\("sha256"\)\.update\(verifier/);
});

test("une réponse officielle sans refresh token reste valide", async () => {
  const oauthClientFactory = createMockFactory({ getToken: async () => ({ tokens: { access_token: "synthetic-access", expiry_date: 12345 }, res: { status: 200 } }) });
  const authorization = await createGoogleAuthorization({ ...credentials, oauthClientFactory });
  const token = await exchangeGoogleCode({ code: "synthetic-code", state: authorization.state, clientId: credentials.clientId, clientSecret: credentials.clientSecret, oauthClientFactory });
  assert.equal(token.access_token, "synthetic-access");
  assert.equal(token.refresh_token, undefined);
});

test("une réponse sans refresh token conserve le refresh token SafeStorage existant", () => {
  const merged = normalizeGoogleTokenForPersistence({
    previousToken: { refresh_token: "existing-refresh" },
    token: { access_token: "new-access", expiry_date: 12345 },
    email: "fixture@example.test",
    now: 1,
  });
  assert.equal(merged.refresh_token, "existing-refresh");
  assert.equal(merged.expires_at, 12345);
});

test("le profil Gmail distingue un refus fournisseur d’un mauvais compte sans exposer l’adresse", () => {
  const providerFailure = inspectGoogleApiFailure({
    error: {
      status: "PERMISSION_DENIED",
      message: "private provider message",
      errors: [{ reason: "accessNotConfigured", message: "private detail" }],
    },
  });
  assert.throws(
    () => assertGoogleProfileResponse({ status: 403, ok: false, expectedEmail: "expected@example.test", providerFailure }),
    (error) => error.code === "GOOGLE_GMAIL_PROFILE_FAILED" &&
      error.profileDiagnostic.httpStatus === 403 &&
      error.profileDiagnostic.emailPresent === "NO" &&
      error.profileDiagnostic.providerStatus === "PERMISSION_DENIED" &&
      error.profileDiagnostic.providerReason === "accessNotConfigured" &&
      !JSON.stringify(error.profileDiagnostic).includes("private") &&
      !JSON.stringify(error.profileDiagnostic).includes("expected@example.test")
  );
  assert.throws(
    () => assertGoogleProfileResponse({ status: 200, ok: true, emailAddress: "other@example.test", expectedEmail: "expected@example.test" }),
    (error) => error.code === "GOOGLE_ACCOUNT_MISMATCH" && error.profileDiagnostic.accountMatched === "NO"
  );
  assert.deepEqual(
    assertGoogleProfileResponse({ status: 200, ok: true, emailAddress: "EXPECTED@example.test", expectedEmail: "expected@example.test" }),
    { httpStatus: 200, responseOk: "YES", emailPresent: "YES", accountMatched: "YES", providerStatus: null, providerReason: null }
  );
});

test("les codes Gmail non sûrs ne sont jamais repris dans le diagnostic", () => {
  assert.deepEqual(
    inspectGoogleApiFailure({ error: { status: "PERMISSION DENIED: private", errors: [{ reason: "bad reason private" }] } }),
    { providerStatus: null, providerReason: null }
  );
});

test("les refus fournisseur sont normalisés sans secret", async () => {
  const oauthClientFactory = createMockFactory({ getToken: async () => {
    throw { response: { status: 400, data: { error: "invalid_grant", error_description: "Authorization code rejected" } } };
  } });
  const authorization = await createGoogleAuthorization({ ...credentials, oauthClientFactory });
  await assert.rejects(
    exchangeGoogleCode({ code: "synthetic-code", state: authorization.state, clientId: credentials.clientId, clientSecret: credentials.clientSecret, oauthClientFactory }),
    (error) => {
      assert.equal(error.code, "GOOGLE_OAUTH_TOKEN_EXCHANGE_FAILED");
      assert.equal(error.oauthDiagnostic.tokenEndpointStatus, 400);
      assert.equal(error.oauthDiagnostic.googleOAuthError, "invalid_grant");
      assert.equal(error.oauthDiagnostic.clientIdMatch, "PASS");
      assert.equal(error.oauthDiagnostic.clientSecretConfig, "CONSISTENT");
      assert.equal(error.reasonCode, "AUTH_FAILED");
      assert.doesNotMatch(JSON.stringify(error.oauthDiagnostic), /synthetic-code|synthetic-secret|verifier-/);
      return true;
    }
  );
});

test("une panne réseau officielle devient indisponible sans exception brute", async () => {
  const oauthClientFactory = createMockFactory({ getToken: async () => { throw Object.assign(new Error("private transport detail"), { code: "ENOTFOUND" }); } });
  const authorization = await createGoogleAuthorization({ ...credentials, oauthClientFactory });
  await assert.rejects(
    exchangeGoogleCode({ code: "synthetic-code", state: authorization.state, clientId: credentials.clientId, clientSecret: credentials.clientSecret, oauthClientFactory }),
    (error) => error.code === "GOOGLE_OAUTH_TOKEN_ENDPOINT_UNREACHABLE" && !String(error.message).includes("private transport detail")
  );
});
