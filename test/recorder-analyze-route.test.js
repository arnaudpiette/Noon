"use strict";

// Garde-fous de la route /recorder/analyze : aucun envoi distant en mode local uniquement.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const start = source.indexOf('req.url === "/recorder/analyze"');
const route = source.slice(start, source.indexOf("\n}\n", start));

test("la synthèse du Dictaphone vérifie la politique locale avant tout appel distant", () => {
  assert.ok(start > 0, "route /recorder/analyze introuvable");
  const preflight = route.indexOf('requiredCapabilities: ["REMOTE_REASONING"]');
  const remoteCall = route.indexOf("getOpenAIClient()");
  assert.ok(preflight > 0, "preflight REMOTE_REASONING absent");
  assert.ok(remoteCall > preflight, "l'appel distant doit suivre le preflight");
  assert.match(route, /status !== "AVAILABLE"/);
  assert.match(route, /REMOTE_ANALYSIS_BLOCKED/);
  assert.ok(route.indexOf('x-noon-request') < remoteCall);
});

test("la synthèse accepte une transcription aussi longue que celle stockée localement", () => {
  const storeLimit = fs.readFileSync(path.join(__dirname, "..", "lib", "recorder-store.js"), "utf8").match(/text\.length > ([\d_]+)/)[1];
  assert.match(route, new RegExp(`transcript\\.length > ${storeLimit}`));
});
