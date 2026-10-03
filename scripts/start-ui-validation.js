"use strict";

const { spawn } = require("node:child_process");
const { prepareUiValidationBootstrap, PROFILE_ARGUMENT, UI_VALIDATION_PROFILE_PATH } = require("../electron/ui-validation-mode");

function startUiValidation({ prepare = prepareUiValidationBootstrap, spawnImpl = spawn, npmCommand = process.platform === "win32" ? "npm.cmd" : "npm" } = {}) {
  const { profile } = prepare();
  return spawnImpl(npmCommand, ["start", "--", "--", `${PROFILE_ARGUMENT}=${profile}`], { stdio: "inherit" });
}

if (require.main === module) {
  const child = startUiValidation();
  child.on("error", (error) => { console.error(`Impossible de lancer Noon : ${error.message}`); process.exitCode = 1; });
  child.on("exit", (code, signal) => { process.exitCode = code === null ? 1 : code; if (signal) console.error(`Noon arrêté par ${signal}.`); });
}

module.exports = { startUiValidation, UI_VALIDATION_PROFILE_PATH };
