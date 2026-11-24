"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("le packaging exclut les journaux et données runtime privées", () => {
  const forge = fs.readFileSync(require.resolve("../forge.config"), "utf8");
  for (const name of ["personal-intelligence", "integration-tokens", "tool-audit"]) {
    assert.match(forge, new RegExp(name));
  }
});

test("le packaging exclut les fichiers de dev locaux et l'état runtime du dépôt, pas le code", () => {
  const { ignore } = require("../forge.config").packagerConfig;
  const excluded = (file) => ignore.some((rule) => rule.test(file));
  for (const file of [
    "/.claude/launch.json", "/benchmark-workspaces/abc/package.json", "/dev-task-journal/abc-1.json",
    "/dev-cost-ledger.json", "/runtime-config.json", "/runtime-config.json.lkg", "/runtime-config.json.123.tmp",
    "/voice-identity.json", "/.noon-data/state.json", "/artifact-previews/preview.png",
    "/types/noon-error.d.ts", "/tsconfig.check.json",
  ]) assert.ok(excluded(file), `${file} doit être exclu`);
  for (const file of [
    "/server.js", "/package.json", "/electron/main.js", "/services/dev/dev-benchmark-service.js",
    "/services/voice/voice-identity.js", "/services/config/runtime-config-service.js", "/Workspace/Briefs",
    "/node_modules/typescript-like/index.js",
  ]) assert.ok(!excluded(file), `${file} doit rester embarqué`);
});

test("le bundle déclare pourquoi Noon envoie des Apple Events", () => {
  const forge = require("../forge.config");
  assert.equal(typeof forge.packagerConfig.extendInfo.NSAppleEventsUsageDescription, "string");
  assert.ok(forge.packagerConfig.extendInfo.NSAppleEventsUsageDescription.length > 20);

  const verifier = fs.readFileSync(require.resolve("../scripts/verify-macos-package"), "utf8");
  assert.match(verifier, /NSAppleEventsUsageDescription/);
  assert.match(verifier, /entitlements:apple-events-missing/);
  const entitlements = fs.readFileSync(require.resolve("../build/entitlements.mac.plist"), "utf8");
  assert.match(entitlements, /com\.apple\.security\.automation\.apple-events/);
});

test("la vérification inspecte aussi l’index interne de l’ASAR", () => {
  const verifier = fs.readFileSync(require.resolve("../scripts/verify-macos-package"), "utf8");
  assert.match(verifier, /asar\.listPackage\(appAsar\)/);
  assert.match(verifier, /"tool-audit\.json"/);
  assert.match(verifier, /runtime-files-in-bundle/);
});

test("le packaging embarque les fixtures benchmark et les helpers natifs requis", () => {
  const forge = require("../forge.config");
  const resources = forge.packagerConfig.extraResource;

  assert.equal(resources.length, 2);

  assert.ok(
    resources.some((resource) =>
      /resources[\\/]dev-benchmark-fixtures$/.test(resource)
    )
  );

  assert.ok(
    resources.some((resource) =>
      /resources[\\/]native$/.test(resource)
    )
  );

  const verifier = fs.readFileSync(
    require.resolve("../scripts/verify-macos-package"),
    "utf8"
  );

  assert.match(verifier, /benchmark-fixture:missing/);
  assert.match(verifier, /benchmark-fixture:content-mismatch/);
});

test("Gemini utilise un secret SafeStorage séparé et ne l'expose pas au renderer", () => {
  const main = fs.readFileSync(require.resolve("../electron/main"), "utf8");
  const preload = fs.readFileSync(require.resolve("../electron/preload"), "utf8");
  const forge = fs.readFileSync(require.resolve("../forge.config"), "utf8");
  assert.match(main, /loadEncryptedSecret\("gemini-api-key"\)/);
  assert.match(main, /saveEncryptedSecret\("gemini-api-key"/);
  assert.match(main, /process\.env\.GEMINI_API_KEY/);
  assert.doesNotMatch(preload, /GEMINI_API_KEY|gemini-api-key/);
  assert.match(forge, /\.env/);
});
