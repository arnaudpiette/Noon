"use strict";

// Lance le vrai binaire packagé avec un userData isolé puis attend son verdict /health.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { runPackagedSmoke } = require("./packaged-smoke-runner");

const arch = process.env.NOON_RELEASE_ARCH || process.arch;
const appPath = path.join(__dirname, "..", "out", `Noon-darwin-${arch}`, "Noon.app");
const executable = path.join(appPath, "Contents", "MacOS", "Noon");
const entitlementsPath = path.join(__dirname, "..", "build", "entitlements.mac.plist");
if (!fs.existsSync(executable)) {
  console.error(`Binaire absent : ${executable}`);
  process.exit(1);
}
let adHocSignedForTest = false;
try { execFileSync("codesign", ["--verify", "--deep", "--strict", appPath], { stdio: "ignore" }); }
catch {
  // Une signature ad hoc permet le smoke local, sans simuler une signature
  // Developer ID. Conserver les entitlements du bundle évite que le smoke ne
  // dégrade l'artefact qu'il vient de valider.
  execFileSync("codesign", [
    "--force",
    "--deep",
    "--sign", "-",
    "--entitlements", entitlementsPath,
    appPath,
  ], { stdio: "pipe" });
  adHocSignedForTest = true;
}
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "noon-packaged-smoke-"));
const smokePort = 43000 + (process.pid % 1000);
// Les runners Node/Electron peuvent définir ELECTRON_RUN_AS_NODE=1. Cette
// variable ferait démarrer le bundle comme Node au lieu de lancer l'application.
const childEnvironment = {
  ...process.env,
  NOON_BUILD_PROFILE: "release",
  NOON_SAFE_MODE: "1",
  NOON_SMOKE_TEST: "1",
  NOON_SMOKE_USER_DATA: userData,
  NOON_SMOKE_PORT: String(smokePort),
};
delete childEnvironment.ELECTRON_RUN_AS_NODE;

const resultPath = path.join(userData, "smoke-result.json");
const retainedResultPath = path.join(__dirname, "..", "out", "smoke-result.json");

runPackagedSmoke({ executable, env: childEnvironment, resultPath })
  .then(({ result, output }) => {
    if (output) console.log(output);
    const passed = result.status === "PASS";
    fs.writeFileSync(retainedResultPath, JSON.stringify({
      ...result,
      arch,
      isolatedUserData: true,
      adHocSignedForTest,
    }, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({
      ...result,
      arch,
      isolatedUserData: true,
      adHocSignedForTest,
      failedProfile: passed ? null : userData,
    }));
    if (passed) fs.rmSync(userData, { recursive: true, force: true });
    else process.exitCode = 1;
  })
  .catch((error) => {
    console.error(JSON.stringify({ status: "FAIL", reason: error.code || error.name || "RUNNER_FAILED", failedProfile: userData }));
    process.exitCode = 1;
  });
