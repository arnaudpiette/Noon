"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const {
  SENSITIVE_ENVIRONMENT_NAMES,
  applyUiValidationProfile,
  assertUiValidationDataDirectory,
  isUiValidationExternalRequest,
} = require("../electron/ui-validation-mode");

function directoryFs(directories) {
  const files = new Map();
  return {
    statSync(target) {
      if (!directories.has(path.resolve(target))) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return { isDirectory: () => true };
    },
    realpathSync(target) { return path.resolve(target); },
    existsSync(target) { return files.has(path.resolve(target)); },
    readFileSync(target) { return files.get(path.resolve(target)); },
    readdirSync() { return []; },
    writeFileSync(target, value) { files.set(path.resolve(target), value); },
  };
}

test("le profil UI est sélectionné avant configuration et neutralise les secrets hérités", () => {
  const profile = path.resolve("/private/tmp/noon-ui-validation-profile");
  const env = Object.fromEntries(SENSITIVE_ENVIRONMENT_NAMES.map((name) => [name, "personal-secret"]));
  const result = applyUiValidationProfile({
    argv: ["node", "main", `--noon-ui-validation-profile=${profile}`], env,
    normalUserData: "/Users/example/Library/Application Support/Noon", homeDirectory: "/Users/example",
    fsImpl: directoryFs(new Set([profile])),
  });
  assert.deepEqual(result, { profile, mode: "UI_VALIDATION" });
  assert.equal(env.NOON_DATA_DIR, profile);
  assert.equal(env.NOON_UI_VALIDATION, "1");
  assert.equal(env.NOON_SAFE_MODE, "1");
  for (const name of SENSITIVE_ENVIRONMENT_NAMES) assert.equal(env[name], undefined);
});

test("un profil UI absent, relatif ou personnel est refusé sans fallback", () => {
  const normal = "/Users/example/Library/Application Support/Noon";
  const invoke = (value, fsImpl = directoryFs(new Set([normal]))) => applyUiValidationProfile({
    argv: ["node", "main", `--noon-ui-validation-profile=${value}`], env: {}, normalUserData: normal,
    homeDirectory: "/Users/example", fsImpl,
  });
  assert.throws(() => invoke("relative"), { code: "UI_VALIDATION_PROFILE_INVALID" });
  assert.throws(() => invoke("/private/tmp/missing", directoryFs(new Set())), { code: "UI_VALIDATION_PROFILE_MISSING" });
  assert.throws(() => invoke(normal), { code: "UI_VALIDATION_PROFILE_UNSAFE" });
});

test("le profil ne devient synthétique qu'à sa première utilisation vide et se rouvre avec son marqueur", () => {
  const profile = "/private/tmp/noon-ui-validation-profile";
  const fsImpl = directoryFs(new Set([profile, "/Users/example", "/Users/example/Library/Application Support/Noon"]));
  const options = { argv: ["node", "main", `--noon-ui-validation-profile=${profile}`], normalUserData: "/Users/example/Library/Application Support/Noon", homeDirectory: "/Users/example", fsImpl };
  assert.equal(applyUiValidationProfile({ ...options, env: {} }).profile, profile);
  assert.equal(applyUiValidationProfile({ ...options, env: {} }).profile, profile);
});

test("un symlink vers le profil personnel et les flags UI répétés sont refusés", () => {
  const normal = "/Users/example/Library/Application Support/Noon";
  const profileAlias = "/private/tmp/noon-ui-validation-alias";
  const fsImpl = directoryFs(new Set([normal, profileAlias, "/Users/example"]));
  fsImpl.realpathSync = (target) => path.resolve(target) === path.resolve(profileAlias) ? normal : path.resolve(target);
  const base = { env: {}, normalUserData: normal, homeDirectory: "/Users/example", fsImpl };
  assert.throws(() => applyUiValidationProfile({ ...base, argv: ["node", "main", `--noon-ui-validation-profile=${profileAlias}`] }), { code: "UI_VALIDATION_PROFILE_UNSAFE" });
  assert.throws(() => applyUiValidationProfile({ ...base, argv: ["node", "main", "--noon-ui-validation-profile=/private/tmp/a", "--noon-ui-validation-profile=/private/tmp/b"] }), { code: "UI_VALIDATION_PROFILE_INVALID" });
});

test("sans paramètre UI, le mode et le smoke existants ne sont pas modifiés", () => {
  const env = { NOON_SMOKE_TEST: "1", OPENAI_API_KEY: "smoke-fixture" };
  assert.equal(applyUiValidationProfile({ argv: ["node", "main"], env, normalUserData: "/normal", fsImpl: directoryFs(new Set()) }), null);
  assert.deepEqual(env, { NOON_SMOKE_TEST: "1", OPENAI_API_KEY: "smoke-fixture" });
});

test("les données serveur restent dans le profil isolé et HTTP local reste autorisé", () => {
  const profile = "/private/tmp/noon-ui-validation-profile";
  assert.doesNotThrow(() => assertUiValidationDataDirectory({ env: { NOON_UI_VALIDATION: "1", NOON_UI_VALIDATION_PROFILE: profile }, dataDirectory: profile }));
  assert.throws(() => assertUiValidationDataDirectory({ env: { NOON_UI_VALIDATION: "1", NOON_UI_VALIDATION_PROFILE: profile }, dataDirectory: "/normal" }), { code: "UI_VALIDATION_DATA_DIRECTORY_INVALID" });
  assert.equal(isUiValidationExternalRequest("/health"), false);
  assert.equal(isUiValidationExternalRequest("/integrations/gmail/connect"), true);
  assert.equal(isUiValidationExternalRequest("/realtime/session"), true);
  assert.equal(isUiValidationExternalRequest("/api/dev/workspace-terminal/sessions"), true);
});

test("le main applique le profil avant de composer le serveur et réserve l'auto-quit au smoke", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "electron", "main.js"), "utf8");
  assert.ok(main.indexOf("const uiValidationProfile = applyUiValidationProfile") < main.indexOf('require("sharp")'));
  assert.ok(main.indexOf('app.setPath("userData", uiValidationProfile.profile)') < main.indexOf('require(path.join(__dirname, "..", "server.js"))'));
  const smokeQuit = main.indexOf("if (smokeTestRequested) {");
  assert.ok(smokeQuit > 0);
  assert.ok(main.indexOf("app.quit();", smokeQuit) > smokeQuit);
  assert.match(main, /if \(uiValidationRequested\) return false;/);
  assert.match(main, /uiValidationRequested\) throw Object\.assign\(new Error\("L'ouverture d'URL externe est désactivée/);
});
