"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const {
  SENSITIVE_ENVIRONMENT_NAMES,
  UI_VALIDATION_FIXTURES,
  UI_VALIDATION_PROFILE_PATH,
  applyUiValidationProfile,
  assertUiValidationDataDirectory,
  isUiValidationExternalRequest,
  isUiValidationWorkspaceId,
  prepareUiValidationBootstrap,
  resolveUiValidationFixtures,
} = require("../electron/ui-validation-mode");

function directoryFs(directories) {
  const files = new Map();
  return {
    statSync(target) {
      if (!directories.has(path.resolve(target))) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return { isDirectory: () => true, isSymbolicLink: () => false };
    },
    lstatSync(target) { return this.statSync(target); },
    realpathSync(target) { return path.resolve(target); },
    existsSync(target) { return files.has(path.resolve(target)); },
    readFileSync(target) { return files.get(path.resolve(target)); },
    readdirSync() { return []; },
    writeFileSync(target, value) { files.set(path.resolve(target), value); },
  };
}

function bootstrapFs(existing = []) {
  const directories = new Set(["/", "/private", "/private/tmp", ...existing].map((value) => path.resolve(value)));
  const files = new Map();
  const symlinks = new Set();
  const api = {
    lstatSync(target) {
      const resolved = path.resolve(target);
      if (symlinks.has(resolved)) return { isDirectory: () => false, isSymbolicLink: () => true };
      if (directories.has(resolved)) return { isDirectory: () => true, isSymbolicLink: () => false };
      if (files.has(resolved)) return { isDirectory: () => false, isSymbolicLink: () => false };
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    },
    statSync(target) { return this.lstatSync(target); },
    realpathSync(target) { return path.resolve(target); },
    existsSync(target) { return files.has(path.resolve(target)); },
    readFileSync(target) { return files.get(path.resolve(target)); },
    readdirSync(target) {
      const resolved = path.resolve(target);
      return [...directories, ...files.keys()].filter((entry) => path.dirname(entry) === resolved).map((entry) => path.basename(entry));
    },
    writeFileSync(target, value) { files.set(path.resolve(target), value); },
    mkdirSync(target) { directories.add(path.resolve(target)); },
  };
  return { api, directories, files, symlinks };
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

test("les deux fixtures explicitement configurées sont les seules acceptées et un symlink est refusé", () => {
  const directories = new Set(UI_VALIDATION_FIXTURES.map((fixture) => path.resolve(fixture.rootPath)));
  const fixtureFs = {
    lstatSync(target) {
      if (!directories.has(path.resolve(target))) throw new Error("missing");
      return { isDirectory: () => true, isSymbolicLink: () => false };
    },
    realpathSync(target) { return path.resolve(target); },
  };
  const resolved = resolveUiValidationFixtures({ fsImpl: fixtureFs });
  assert.deepEqual(resolved.map((fixture) => fixture.workspaceId), ["ui-validation-workspace-a", "ui-validation-workspace-b"]);
  assert.equal(isUiValidationWorkspaceId("ui-validation-workspace-a", resolved), true);
  assert.equal(isUiValidationWorkspaceId("workspace-personnel", resolved), false);
  fixtureFs.lstatSync = () => ({ isDirectory: () => true, isSymbolicLink: () => true });
  assert.throws(() => resolveUiValidationFixtures({ fsImpl: fixtureFs }), { code: "UI_VALIDATION_FIXTURE_UNSAFE" });
});

test("le bootstrap prépare un parent fixtures absent, A/B et le profil, puis reste idempotent", () => {
  const root = fs.mkdtempSync("/private/tmp/noon-ui-validation-bootstrap-");
  const profile = path.join(root, "profile");
  const fixtures = [
    { key: "a", rootPath: path.join(root, "fixtures", "a") },
    { key: "b", rootPath: path.join(root, "fixtures", "b") },
  ];
  try {
    assert.equal(fs.existsSync(path.dirname(fixtures[0].rootPath)), false, "le parent fixture doit réellement être absent");
    const first = prepareUiValidationBootstrap({ profilePath: profile, fixtures });
    assert.equal(first.profile, profile);
    assert.deepEqual(first.fixtures.map((fixture) => fixture.rootPath), fixtures.map((fixture) => fixture.rootPath));
    assert.equal(fs.lstatSync(path.dirname(fixtures[0].rootPath)).isDirectory(), true);
    fs.writeFileSync(path.join(fixtures[0].rootPath, "conserve.txt"), "garder");
    prepareUiValidationBootstrap({ profilePath: profile, fixtures });
    assert.equal(fs.readFileSync(path.join(fixtures[0].rootPath, "conserve.txt"), "utf8"), "garder");
    assert.equal(fs.existsSync(path.join(profile, ".noon-ui-validation-profile.json")), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("un parent fixture existant comme fichier ou symlink est refusé", () => {
  for (const kind of ["file", "symlink"]) {
    const root = fs.mkdtempSync("/private/tmp/noon-ui-validation-parent-");
    const profile = path.join(root, "profile");
    const parent = path.join(root, "fixtures");
    const fixtures = [{ key: "a", rootPath: path.join(parent, "a") }, { key: "b", rootPath: path.join(parent, "b") }];
    try {
      if (kind === "file") fs.writeFileSync(parent, "not a directory");
      else fs.symlinkSync(root, parent);
      assert.throws(() => prepareUiValidationBootstrap({ profilePath: profile, fixtures }), { code: "UI_VALIDATION_PATH_UNSAFE" });
      assert.equal(fs.existsSync(profile), false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test("le bootstrap refuse un composant détourné ou un profil existant non admissible avant toute écriture", () => {
  const profile = "/private/tmp/ui-validation-test-profile";
  const fixtures = [{ key: "a", rootPath: "/private/tmp/ui-validation-test-projects/a" }, { key: "b", rootPath: "/private/tmp/ui-validation-test-projects/b" }];
  const redirected = bootstrapFs(["/private/tmp/ui-validation-test-projects"]);
  redirected.symlinks.add("/private/tmp/ui-validation-test-projects");
  assert.throws(() => prepareUiValidationBootstrap({ fsImpl: redirected.api, profilePath: profile, fixtures }), { code: "UI_VALIDATION_PATH_UNSAFE" });
  assert.equal(redirected.directories.has(profile), false);

  const unsafeProfile = bootstrapFs([profile, "/private/tmp/ui-validation-test-projects"]);
  unsafeProfile.files.set(path.join(profile, "personal-data"), "never overwrite");
  assert.throws(() => prepareUiValidationBootstrap({ fsImpl: unsafeProfile.api, profilePath: profile, fixtures }), { code: "UI_VALIDATION_PROFILE_UNSAFE" });
  assert.equal(unsafeProfile.files.get(path.join(profile, "personal-data")), "never overwrite");
  assert.equal(unsafeProfile.directories.has(fixtures[0].rootPath), false, "un profil refusé ne prépare aucune fixture");
});

test("le lanceur ne démarre Electron qu'après préparation et transmet la syntaxe Forge exacte", () => {
  const { startUiValidation } = require("../scripts/start-ui-validation");
  const calls = [];
  const child = startUiValidation({
    prepare: () => ({ profile: UI_VALIDATION_PROFILE_PATH }),
    spawnImpl: (...args) => { calls.push(args); return { on() {} }; },
    npmCommand: "npm",
  });
  assert.ok(child);
  assert.deepEqual(calls[0].slice(0, 2), ["npm", ["start", "--", "--", `--noon-ui-validation-profile=${UI_VALIDATION_PROFILE_PATH}`]]);
  let launches = 0;
  assert.throws(() => startUiValidation({ prepare: () => { throw Object.assign(new Error("unsafe"), { code: "UI_VALIDATION_PATH_UNSAFE" }); }, spawnImpl: () => { launches += 1; } }), { code: "UI_VALIDATION_PATH_UNSAFE" });
  assert.equal(launches, 0);
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
  assert.match(main, /uiValidationMode: uiValidationRequested/);
  assert.match(main, /uiValidationProjects: uiValidationRequested/);
  assert.match(main, /listUiValidationProjectContextsFromTrustedMain/);
  assert.doesNotMatch(main, /smokeTestRequested \|\| uiValidationRequested \|\| app\.requestSingleInstanceLock/);
  assert.match(main, /smokeTestRequested \|\| app\.requestSingleInstanceLock\(\)/);
});

test("les workspaces UI Validation sont initialisés seulement après conversationIndex", () => {
  const server = fs.readFileSync(
    path.join(__dirname, "..", "server.js"),
    "utf8"
  );

  const conversationIndex =
    server.indexOf(
      "let conversationIndex = loadConversationIndex();"
    );

  const validationInit =
    server.indexOf(
      "uiValidationProjectContexts =\n  initializeUiValidationWorkspaces();"
    );

  assert.ok(
    conversationIndex >= 0,
    "conversationIndex doit être initialisé"
  );

  assert.ok(
    validationInit > conversationIndex,
    "les workspaces synthétiques ne doivent être initialisés qu'après conversationIndex"
  );

  assert.match(
    server,
    /let uiValidationProjectContexts = \[\];/
  );
  assert.match(
    server,
    /assertUiValidationWorkspace\(workspaceId\)/
  );
  assert.match(
    server,
    /UI_VALIDATION_WORKSPACE_DENIED/
  );
});
