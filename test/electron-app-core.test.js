"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isSafeExternalUrl,
  isSafeGoogleAuthorizationUrl,
  isValidAccelerator,
  parseNoonDeepLink,
} = require("../electron/app-core");

test("accepte uniquement les deep links Noon explicitement autorisés", () => {
  assert.deepEqual(parseNoonDeepLink("noon://open"), { action: "open" });
  assert.deepEqual(parseNoonDeepLink("noon://mode?value=dev"), { action: "mode", value: "DEV" });
  assert.deepEqual(parseNoonDeepLink("noon://focus?id=kasa"), { action: "focus", id: "kasa" });
  assert.equal(parseNoonDeepLink("noon://focus?id=../../secret"), null);
  assert.equal(parseNoonDeepLink("noon://shell?command=rm"), null);
  assert.equal(parseNoonDeepLink("https://example.com"), null);
});

test("autorise uniquement l’URL OAuth Google canonique avec callback Noon intact", () => {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: "synthetic-client",
    redirect_uri: "http://127.0.0.1:55370/integrations/google/callback",
    response_type: "code",
    code_challenge: "synthetic-challenge",
    code_challenge_method: "S256",
  });
  assert.equal(isSafeGoogleAuthorizationUrl(url.href), true);
  url.searchParams.set("redirect_uri", "http://127.0.0.1:55370/integrations/google%");
  assert.equal(isSafeGoogleAuthorizationUrl(url.href), false);
  url.searchParams.set("redirect_uri", "https://example.com/integrations/google/callback");
  assert.equal(isSafeGoogleAuthorizationUrl(url.href), false);
});

test("autorise HTTP(S) sans credentials et refuse les protocoles dangereux", () => {
  assert.equal(isSafeExternalUrl("https://openai.com/docs"), true);
  assert.equal(isSafeExternalUrl("https://accounts.google.com/o/oauth2/v2/auth"), true);
  assert.equal(isSafeExternalUrl("http://example.com/test"), true);
  assert.equal(isSafeExternalUrl("https://user:password@example.com/test"), false);
  assert.equal(isSafeExternalUrl("javascript:alert(1)"), false);
  assert.equal(isSafeExternalUrl("data:text/html,<script>alert(1)</script>"), false);
  assert.equal(isSafeExternalUrl("file:///tmp/test"), false);
});

test("valide les raccourcis configurables", () => {
  assert.equal(isValidAccelerator("Control+Option+N"), true);
  assert.equal(isValidAccelerator("N"), false);
  assert.equal(isValidAccelerator(""), false);
});

test("échec de chargement d'une fenêtre : type et code seulement, jamais l'URL ni le message", () => {
  const { describeWindowLoadFailure } = require("../electron/app-core");
  const error = Object.assign(new Error("ERR_CONNECTION_REFUSED (-102) loading 'http://127.0.0.1:3000/app?token=secret'"), { code: "ERR_CONNECTION_REFUSED" });
  assert.equal(describeWindowLoadFailure("main", error), JSON.stringify({ window: "main", code: "ERR_CONNECTION_REFUSED" }));
  assert.equal(describeWindowLoadFailure("capture", { name: "AbortError" }), JSON.stringify({ window: "capture", code: "AbortError" }));
  assert.equal(describeWindowLoadFailure("autre", null), JSON.stringify({ window: "main", code: "ERROR" }));
  assert.doesNotMatch(describeWindowLoadFailure("main", error), /127\.0\.0\.1|token|secret/);
});

test("electron/main.js journalise l'échec de chaque loadURL au lieu de l'ignorer", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const source = fs.readFileSync(path.join(__dirname, "..", "electron", "main.js"), "utf8");
  const calls = source.match(/\.loadURL\([^\n]*/g) || [];
  assert.equal(calls.length, 2);
  for (const call of calls) assert.match(call, /\.catch\(logWindowLoadFailure\("(?:main|capture)"\)\);$/);
  assert.match(source, /logNoonEvent\("error", "window-load-failed", describeWindowLoadFailure\(windowKind, error\)\)/);
});
