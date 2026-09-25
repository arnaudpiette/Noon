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
