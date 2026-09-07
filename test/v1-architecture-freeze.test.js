"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");

function source(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("le chemin chat principal délègue au NoonOrchestrator canonique", () => {
  const server = source("server.js");
  assert.match(server, /const noonOrchestrator = createNoonOrchestrator\(/);
  assert.match(server, /const execution = await noonOrchestrator\.run\(\{/);
  assert.match(server, /await noonOrchestrator\.resume\(\{/);
});

test("les propriétaires V1 canoniques restent présents et exportés", () => {
  const owners = [
    ["services/orchestration/noon-orchestrator.js", "createNoonOrchestrator"],
    ["services/intents/intent-command-engine.js", "createIntentCommandEngine"],
    ["services/context/context-builder.js", "createContextBuilder"],
    ["services/memory/memory-engine.js", "createMemoryEngine"],
    ["services/rules/hard-rules-registry.js", "createHardRulesRegistry"],
    ["services/security/operational-security-policy.js", "createOperationalSecurityPolicy"],
    ["services/approvals/approval-engine.js", "createApprovalEngine"],
    ["services/execution/transactional-execution-engine.js", "createTransactionalExecutionEngine"],
  ];
  for (const [file, exportedFactory] of owners) {
    assert.equal(typeof require(path.join(root, file))[exportedFactory], "function", `${file} doit exporter ${exportedFactory}`);
  }
});

test("le renderer packagé reste isolé de Node et du système", () => {
  const main = source("electron/main.js");
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /sandbox:\s*true/);
  assert.match(main, /webSecurity:\s*true/);
  assert.doesNotMatch(main, /nodeIntegration:\s*true/);
  assert.doesNotMatch(main, /webSecurity:\s*false/);
});

test("l'API Noon refuse toute écoute autre que la boucle locale", () => {
  const server = source("server.js");
  assert.match(server, /const DEFAULT_HOST = "127\.0\.0\.1"/);
  assert.match(server, /Noon doit écouter uniquement sur 127\.0\.0\.1/);
  assert.doesNotMatch(server, /const DEFAULT_HOST = "0\.0\.0\.0"/);
});

test("les fonctions sensibles futures conservent des valeurs par défaut sûres", () => {
  const { FEATURE_FLAGS } = require("../services/config/feature-flag-registry");
  const defaults = new Map(FEATURE_FLAGS.map((flag) => [flag.flagId, flag.defaultMode]));
  for (const flagId of [
    "sync.remoteRequests",
    "remote.media",
    "remote.approvals",
    "remote.voice",
    "context.screenCapture",
    "runtime.local-model",
    "extensions.external",
  ]) {
    assert.equal(defaults.get(flagId), "OFF", `${flagId} doit rester OFF par défaut en V1`);
  }
});

test("aucun shell permissif n'est activé dans le runtime produit", () => {
  const runtimeFiles = [
    "server.js",
    "electron/main.js",
    ...fs.readdirSync(path.join(root, "services"), { recursive: true })
      .filter((entry) => typeof entry === "string" && entry.endsWith(".js"))
      .map((entry) => path.join("services", entry)),
  ];
  for (const file of runtimeFiles) {
    assert.doesNotMatch(source(file), /shell\s*:\s*true/, `${file} ne doit pas activer shell:true`);
  }
});
