"use strict";

const path = require("node:path");

const PROFILE_ARGUMENT = "--noon-ui-validation-profile";
const PROFILE_MARKER = ".noon-ui-validation-profile.json";
const SENSITIVE_ENVIRONMENT_NAMES = Object.freeze([
  "OPENAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_OAUTH_REDIRECT_URI",
  "NOON_LOCAL_AUTH_SECRET", "PICOVOICE_ACCESS_KEY",
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
  if (!fsImpl?.statSync) throw new TypeError("fsImpl requis pour valider le profil UI.");
  let stat;
  try { stat = fsImpl.statSync(requestedProfile); }
  catch { throw Object.assign(new Error("Le profil de validation UI doit déjà exister."), { code: "UI_VALIDATION_PROFILE_MISSING" }); }
  if (!stat.isDirectory()) throw Object.assign(new Error("Le profil de validation UI doit être un répertoire."), { code: "UI_VALIDATION_PROFILE_INVALID" });
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

module.exports = { PROFILE_ARGUMENT, PROFILE_MARKER, SENSITIVE_ENVIRONMENT_NAMES, applyUiValidationProfile, assertUiValidationDataDirectory, isUiValidationExternalRequest, isUiValidationMode };
