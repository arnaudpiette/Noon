"use strict";

// Contrôle le bundle final : identité, architecture, contenu, signature et manifeste.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");
const arch = process.env.NOON_RELEASE_ARCH || process.arch;
const appPath = path.join(root, "out", `Noon-darwin-${arch}`, "Noon.app");
const requireSignature = process.argv.includes("--require-signature");
const blockers = [];
const warnings = [];
if (!fs.existsSync(appPath)) {
  console.error(`Package absent : ${appPath}`);
  process.exit(1);
}

const forbiddenNames = new Set([".env", "Archive.zip", "integration-tokens.json", "conversation-memory.json", "personal-intelligence.sqlite"]);
const forbidden = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (forbiddenNames.has(entry.name)) forbidden.push(target);
    if (entry.isDirectory()) walk(target);
  }
}
walk(path.join(appPath, "Contents", "Resources"));
if (forbidden.length) blockers.push(`runtime-files-in-bundle:${forbidden.length}`);

let executableArch = "unknown";
try {
  executableArch = execFileSync("lipo", ["-archs", path.join(appPath, "Contents", "MacOS", "Noon")]).toString().trim();
  const expectedMachine = arch === "x64" ? "x86_64" : arch;
  if (!executableArch.split(/\s+/).includes(expectedMachine)) blockers.push(`binary-arch:${executableArch}`);
} catch { blockers.push("binary-arch:unreadable"); }

let bundleId = "unknown";
let bundleVersion = "unknown";
try {
  const infoPlist = path.join(appPath, "Contents", "Info.plist");
  bundleId = execFileSync("plutil", ["-extract", "CFBundleIdentifier", "raw", "-o", "-", infoPlist]).toString().trim();
  bundleVersion = execFileSync("plutil", ["-extract", "CFBundleShortVersionString", "raw", "-o", "-", infoPlist]).toString().trim();
  if (bundleId !== "com.arnaudpiette.noon") blockers.push(`bundle-id:${bundleId}`);
} catch { blockers.push("info-plist:unreadable"); }

let signed = false;
try { execFileSync("codesign", ["--verify", "--deep", "--strict", appPath], { stdio: "pipe" }); signed = true; }
catch { warnings.push("codesign:unsigned-or-invalid"); }
if (requireSignature && !signed) blockers.push("codesign:required");

const files = [];
for (const relative of ["Contents/Info.plist", "Contents/Resources/app.asar", "Contents/MacOS/Noon"]) {
  const filePath = path.join(appPath, relative);
  if (!fs.existsSync(filePath)) { blockers.push(`missing:${relative}`); continue; }
  files.push({ path: relative, bytes: fs.statSync(filePath).size, sha256: crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex") });
}
const manifest = {
  formatVersion: 1,
  generatedAt: new Date().toISOString(),
  app: { bundleId, version: bundleVersion, arch: executableArch, signed, notarized: false },
  files,
  blockers,
  warnings,
};
const manifestPath = path.join(root, "out", `release-manifest-${arch}.json`);
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(JSON.stringify({ status: blockers.length ? "BLOCKED" : "PASS", manifestPath, ...manifest.app, blockers, warnings }, null, 2));
if (blockers.length) process.exitCode = 1;
