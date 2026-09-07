"use strict";

// Lance le vrai binaire packagé avec un userData isolé puis attend son verdict /health.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawn } = require("child_process");

const arch = process.env.NOON_RELEASE_ARCH || process.arch;
const appPath = path.join(__dirname, "..", "out", `Noon-darwin-${arch}`, "Noon.app");
const executable = path.join(appPath, "Contents", "MacOS", "Noon");
if (!fs.existsSync(executable)) {
  console.error(`Binaire absent : ${executable}`);
  process.exit(1);
}
let adHocSignedForTest = false;
try { execFileSync("codesign", ["--verify", "--deep", "--strict", appPath], { stdio: "ignore" }); }
catch {
  // Une signature ad hoc permet le smoke local, sans simuler une signature Developer ID.
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], { stdio: "pipe" });
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

const child = spawn(executable, [], {
  env: childEnvironment,
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
child.stdout.on("data", (chunk) => { output += chunk; });
child.stderr.on("data", (chunk) => { output += chunk; });
const timer = setTimeout(() => child.kill("SIGTERM"), 30_000);
child.on("exit", (code, signal) => {
  clearTimeout(timer);
  const resultPath = path.join(userData, "smoke-result.json");
  let result = null;
  try { result = JSON.parse(fs.readFileSync(resultPath, "utf8")); } catch {}
  const passed = code === 0 && result?.smoke === "packaged-startup" && result?.status === "ok";
  console.log(output.trim());
  console.log(JSON.stringify({ status: passed ? "PASS" : "FAIL", code, signal: signal || null, arch, isolatedUserData: true, adHocSignedForTest, elapsedMs: result?.elapsedMs ?? null, failedProfile: passed ? null : userData }));
  if (passed) fs.rmSync(userData, { recursive: true, force: true });
  if (!passed) process.exitCode = 1;
});
