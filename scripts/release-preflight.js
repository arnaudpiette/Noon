"use strict";

// Préflight déterministe : bloque une release si l'identité, les assets ou l'ABI cible sont incohérents.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
const targetArch = process.env.NOON_RELEASE_ARCH || process.arch;
const blockers = [];
const warnings = [];

for (const relativePath of ["forge.config.js", "electron/main.js", "electron/preload.js", "assets/branding/noon-app-icon-source.png", "assets/icons/noon.icns", "assets/icons/noonTemplate.png", "build/entitlements.mac.plist", "package-lock.json"]) {
  if (!fs.existsSync(path.join(root, relativePath))) blockers.push(`missing:${relativePath}`);
}
if (packageJson.name !== "noon") blockers.push("identity:package-name");
if (!/^\d+\.\d+\.\d+$/.test(packageJson.version)) blockers.push("identity:semver");
if (lock.packages?.[""]?.version !== packageJson.version) blockers.push("lock:root-version-mismatch");
if (!new Set(["x64", "arm64"]).has(targetArch)) blockers.push(`arch:unsupported:${targetArch}`);

if (!fs.existsSync(path.join(root, "node_modules", "@img", `sharp-darwin-${targetArch}`))) blockers.push(`native:sharp-darwin-${targetArch}`);
for (const packageName of ["@picovoice/porcupine-node", "@picovoice/pvrecorder-node"]) {
  const nativePath = path.join(root, "node_modules", ...packageName.split("/"), "lib", "mac", targetArch === "x64" ? "x86_64" : "arm64");
  if (!fs.existsSync(nativePath)) blockers.push(`native:${packageName}:${targetArch}`);
}

let tracked = [];
try { tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root }).toString().split("\0").filter(Boolean); }
catch { warnings.push("git:tracked-files-unavailable"); }
const forbiddenTracked = tracked.filter((name) => /(^|\/)(\.env$|\.env\.backup$|conversation-memory\.json$|integration-tokens\.json$|personal-intelligence\.sqlite(?:-|$)|.*\.private\.json$)/i.test(name));
if (forbiddenTracked.length) blockers.push(`secrets:tracked-runtime-files:${forbiddenTracked.length}`);

const credentials = {
  signingIdentity: Boolean(process.env.APPLE_SIGN_IDENTITY),
  notarization: Boolean(process.env.APPLE_ID && process.env.APPLE_PASSWORD && process.env.APPLE_TEAM_ID),
};
if (!credentials.signingIdentity) warnings.push("signing:not-configured");
if (!credentials.notarization) warnings.push("notarization:not-configured");

const report = {
  status: blockers.length ? "BLOCKED" : "PASS",
  app: { name: "Noon", version: packageJson.version, bundleId: "com.arnaudpiette.noon" },
  runtime: { node: process.version, platform: process.platform, hostArch: process.arch, targetArch },
  lockfileVersion: lock.lockfileVersion,
  credentials,
  blockers,
  warnings,
};
console.log(JSON.stringify(report, null, 2));
if (blockers.length) process.exitCode = 1;
