"use strict";

const fs = require("node:fs");
const path = require("node:path");

const PROFILE_ARGUMENT = "--noon-ui-validation-profile";
const PROFILE_MARKER = ".noon-ui-validation-profile.json";
const UI_VALIDATION_PROFILE_PATH = "/private/tmp/noon-ui-validation-profile-fb250a2";
const SENSITIVE_ENVIRONMENT_NAMES = Object.freeze([
  "OPENAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_OAUTH_REDIRECT_URI",
  "NOON_LOCAL_AUTH_SECRET", "PICOVOICE_ACCESS_KEY",
]);
// Cette liste est volontairement fermée : le renderer ne fournit jamais de
// chemin de workspace au mode de validation.
const UI_VALIDATION_FIXTURES = Object.freeze([
  { key: "a", id: "ui-validation-project-a", workspaceId: "ui-validation-workspace-a", name: "Projet synthétique A", rootPath: "/private/tmp/noon-ui-validation-projects-fb250a2/projet-synthetique-a" },
  { key: "b", id: "ui-validation-project-b", workspaceId: "ui-validation-workspace-b", name: "Projet synthétique B", rootPath: "/private/tmp/noon-ui-validation-projects-fb250a2/projet-synthetique-b" },
]);

function argumentValues(argv, name) {
  return argv.filter((value) => value.startsWith(`${name}=`)).map((value) => value.slice(name.length + 1));
}

function isSameOrNested(candidate, parent, pathImpl = path) {
  const relative = pathImpl.relative(parent, candidate);
  return relative === "" || (!relative.startsWith(`..${pathImpl.sep}`) && relative !== "..");
}

function realDirectory(value, fsImpl, pathImpl) {
  const resolved = pathImpl.resolve(value);
  const realpath = fsImpl.realpathSync?.native || fsImpl.realpathSync;
  return realpath ? realpath.call(fsImpl, resolved) : resolved;
}

function unsafePath(message, code = "UI_VALIDATION_PATH_UNSAFE") {
  return Object.assign(new Error(message), { code });
}

function assertDirectoryPath(target, { fsImpl = fs, pathImpl = path, allowMissing = false } = {}) {
  const resolved = pathImpl.resolve(target);
  const parsed = pathImpl.parse(resolved);
  let current = parsed.root;
  for (const part of resolved.slice(parsed.root.length).split(pathImpl.sep).filter(Boolean)) {
    current = pathImpl.join(current, part);
    let stat;
    try { stat = fsImpl.lstatSync(current); }
    catch {
      if (allowMissing && current === resolved) return null;
      throw unsafePath(`Chemin UI Validation introuvable : ${current}.`, "UI_VALIDATION_PATH_MISSING");
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw unsafePath(`Chemin UI Validation non admissible : ${current}.`);
    }
    if (realDirectory(current, fsImpl, pathImpl) !== current) {
      throw unsafePath(`Chemin UI Validation redirigé refusé : ${current}.`);
    }
  }
  return resolved;
}

function prepareUiValidationBootstrap({ fsImpl = fs, pathImpl = path, profilePath = UI_VALIDATION_PROFILE_PATH, fixtures = UI_VALIDATION_FIXTURES } = {}) {
  // L'injection est réservée aux tests de cette fonction : aucun argument du
  // lanceur ne peut modifier ces chemins fermés en production.
  const targets = [profilePath, ...fixtures.map((fixture) => fixture.rootPath)].map((target) => pathImpl.resolve(target));
  if (new Set(targets).size !== targets.length) throw unsafePath("Configuration UI Validation dupliquée.");
  const fixtureParent = pathImpl.dirname(targets[1]);
  if (!targets.slice(1).every((target) => pathImpl.dirname(target) === fixtureParent)) {
    throw unsafePath("Les fixtures UI Validation doivent avoir le même parent fixe.");
  }
  // Les ancêtres sont une frontière de confiance : ils doivent déjà exister.
  // Seul le parent fixe des fixtures, puis les deux enfants explicitement
  // configurés, peuvent être créés par ce bootstrap.
  assertDirectoryPath(pathImpl.dirname(targets[0]), { fsImpl, pathImpl });
  assertDirectoryPath(pathImpl.dirname(fixtureParent), { fsImpl, pathImpl });
  const componentExists = (target) => {
    try { fsImpl.lstatSync(target); }
    catch (error) {
      if (error?.code === "ENOENT") return false;
      throw error;
    }
    assertDirectoryPath(target, { fsImpl, pathImpl });
    return true;
  };
  // Prévol complet : un composant détourné dans A/B ne doit pas laisser le
  // bootstrap créer le profil avant de refuser la préparation.
  const profileExists = componentExists(targets[0]);
  const fixtureParentExists = componentExists(fixtureParent);
  const fixtureExists = targets.slice(1).map(componentExists);
  const ensureTarget = (target) => {
    if (componentExists(target)) return;
    const parent = pathImpl.dirname(target);
    assertDirectoryPath(parent, { fsImpl, pathImpl });
    fsImpl.mkdirSync(target, { mode: 0o700 });
    assertDirectoryPath(target, { fsImpl, pathImpl });
  };
  // Le profil conserve ses règles de marqueur existantes. Le parent des
  // fixtures est créé séparément, jamais de façon récursive ou arbitraire.
  if (!profileExists) ensureTarget(targets[0]);
  validateProfileMarker(targets[0], fsImpl, pathImpl);
  if (!fixtureParentExists) ensureTarget(fixtureParent);
  for (let index = 0; index < fixtureExists.length; index += 1) {
    if (!fixtureExists[index]) ensureTarget(targets[index + 1]);
  }
  return { profile: pathImpl.resolve(profilePath), fixtures: fixtures.map((fixture) => ({ ...fixture, rootPath: pathImpl.resolve(fixture.rootPath) })) };
}

function resolveUiValidationFixtures({ fsImpl = fs, pathImpl = path } = {}) {
  return UI_VALIDATION_FIXTURES.map((fixture) => {
    const configuredPath = pathImpl.resolve(fixture.rootPath);
    let stat;
    try { stat = fsImpl.lstatSync(configuredPath); }
    catch { throw Object.assign(new Error(`Fixture UI introuvable : ${fixture.name}.`), { code: "UI_VALIDATION_FIXTURE_MISSING" }); }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw Object.assign(new Error(`Fixture UI invalide : ${fixture.name}.`), { code: "UI_VALIDATION_FIXTURE_UNSAFE" });
    }
    const realPath = realDirectory(configuredPath, fsImpl, pathImpl);
    if (realPath !== configuredPath) {
      throw Object.assign(new Error(`Fixture UI redirigée refusée : ${fixture.name}.`), { code: "UI_VALIDATION_FIXTURE_UNSAFE" });
    }
    return { ...fixture, rootPath: realPath };
  });
}

function isUiValidationWorkspaceId(workspaceId, fixtures = UI_VALIDATION_FIXTURES) {
  return fixtures.some((fixture) => fixture.workspaceId === workspaceId);
}

function validateProfileMarker(profile, fsImpl, pathImpl) {
  const markerPath = pathImpl.join(profile, PROFILE_MARKER);
  if (fsImpl.existsSync(markerPath)) {
    let marker;
    try { marker = JSON.parse(fsImpl.readFileSync(markerPath, "utf8")); } catch {}
    if (marker?.kind !== "NOON_UI_VALIDATION_PROFILE" || marker.schemaVersion !== 1) {
      throw Object.assign(new Error("Le profil de validation UI existant n'est pas reconnu."), { code: "UI_VALIDATION_PROFILE_UNSAFE" });
    }
    return;
  }
  const contents = fsImpl.readdirSync(profile).filter((name) => name !== ".DS_Store");
  if (contents.length) throw Object.assign(new Error("Le profil de validation UI doit être vide lors de sa première utilisation."), { code: "UI_VALIDATION_PROFILE_UNSAFE" });
  fsImpl.writeFileSync(markerPath, `${JSON.stringify({ kind: "NOON_UI_VALIDATION_PROFILE", schemaVersion: 1 })}\n`, { encoding: "utf8", mode: 0o600 });
}

function applyUiValidationProfile({ argv = process.argv, env = process.env, normalUserData, homeDirectory = null, fsImpl, pathImpl = path } = {}) {
  const suppliedValues = argumentValues(argv, PROFILE_ARGUMENT);
  if (suppliedValues.length > 1) throw Object.assign(new Error("Le profil de validation UI ne peut être fourni qu'une seule fois."), { code: "UI_VALIDATION_PROFILE_INVALID" });
  const supplied = suppliedValues[0];
  if (!supplied) {
    if (env.NOON_UI_VALIDATION === "1" || env.NOON_UI_VALIDATION_PROFILE) throw Object.assign(new Error("Le mode UI isolé requiert le flag de profil."), { code: "UI_VALIDATION_PROFILE_INVALID" });
    return null;
  }
  if (!pathImpl.isAbsolute(supplied)) throw Object.assign(new Error("Le profil de validation UI doit être un répertoire absolu."), { code: "UI_VALIDATION_PROFILE_INVALID" });
  const requestedProfile = pathImpl.resolve(supplied);
  if (!fsImpl?.lstatSync) throw new TypeError("fsImpl requis pour valider le profil UI.");
  let stat;
  try { stat = fsImpl.lstatSync(requestedProfile); }
  catch { throw Object.assign(new Error("Le profil de validation UI doit déjà exister."), { code: "UI_VALIDATION_PROFILE_MISSING" }); }
  if (!stat.isDirectory() || stat.isSymbolicLink?.()) throw Object.assign(new Error("Le profil de validation UI doit être un répertoire non redirigé."), { code: "UI_VALIDATION_PROFILE_INVALID" });
  const profile = realDirectory(requestedProfile, fsImpl, pathImpl);
  for (const incompatible of [normalUserData, homeDirectory].filter(Boolean).map((value) => realDirectory(value, fsImpl, pathImpl))) {
    if (isSameOrNested(profile, incompatible, pathImpl) || isSameOrNested(incompatible, profile, pathImpl)) {
      throw Object.assign(new Error("Le profil de validation UI est incompatible avec un profil personnel."), { code: "UI_VALIDATION_PROFILE_UNSAFE" });
    }
  }
  validateProfileMarker(profile, fsImpl, pathImpl);
  for (const name of SENSITIVE_ENVIRONMENT_NAMES) delete env[name];
  env.NOON_UI_VALIDATION = "1";
  env.NOON_UI_VALIDATION_PROFILE = profile;
  env.NOON_DATA_DIR = profile;
  env.NOON_SAFE_MODE = "1";
  return { profile, mode: "UI_VALIDATION" };
}

function isUiValidationMode(env = process.env) { return env.NOON_UI_VALIDATION === "1"; }

function assertUiValidationDataDirectory({ env = process.env, dataDirectory, pathImpl = path } = {}) {
  if (!isUiValidationMode(env)) return;
  if (!env.NOON_UI_VALIDATION_PROFILE || pathImpl.resolve(dataDirectory) !== pathImpl.resolve(env.NOON_UI_VALIDATION_PROFILE)) {
    throw Object.assign(new Error("Le répertoire de données UI isolé est requis."), { code: "UI_VALIDATION_DATA_DIRECTORY_INVALID" });
  }
}

function isUiValidationExternalRequest(requestPath) {
  return requestPath !== "/integrations/status" &&
    (requestPath.startsWith("/integrations/") || requestPath.startsWith("/realtime/") || requestPath.startsWith("/api/dev/"));
}

module.exports = { PROFILE_ARGUMENT, PROFILE_MARKER, SENSITIVE_ENVIRONMENT_NAMES, UI_VALIDATION_PROFILE_PATH, UI_VALIDATION_FIXTURES, applyUiValidationProfile, assertDirectoryPath, assertUiValidationDataDirectory, isUiValidationExternalRequest, isUiValidationMode, isUiValidationWorkspaceId, prepareUiValidationBootstrap, resolveUiValidationFixtures };
