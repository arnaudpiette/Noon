"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { isPathInsideRoots } = require("../../lib/path-utils");

function run(executable, args, cwd, timeout = 15_000) {
  return execFileSync(executable, args, { cwd, encoding: "utf8", timeout, stdio: ["ignore", "pipe", "pipe"] }).replace(/\s+$/, "");
}
function git(root, args) { return run("git", args, root); }
function statusPaths(status) {
  return String(status || "").split("\n").filter(Boolean).map((line) => line.slice(3).split(" -> ").pop()).filter(Boolean);
}
function fingerprintFile(root, relative) {
  try { return crypto.createHash("sha256").update(fs.readFileSync(path.join(root, relative))).digest("hex"); } catch { return null; }
}
function snapshotRepository(root) {
  const status = git(root, ["status", "--porcelain=v1", "--untracked-files=all"]);
  const files = statusPaths(status);
  let head = null; try { head = git(root, ["rev-parse", "HEAD"]).trim(); } catch {}
  return Object.freeze({ status, head, files: Object.freeze(files), fingerprints: Object.freeze(Object.fromEntries(files.map((file) => [file, fingerprintFile(root, file)]))) });
}
function relevantAgentsFiles(root, allowedPaths) {
  const found = new Set();
  for (const allowed of allowedPaths) {
    let cursor = fs.existsSync(allowed) && fs.statSync(allowed).isDirectory() ? allowed : path.dirname(allowed);
    while (isPathInsideRoots(cursor, [root])) {
      const candidate = path.join(cursor, "AGENTS.md");
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) found.add(candidate);
      if (cursor === root) break;
      cursor = path.dirname(cursor);
    }
  }
  return [...found].sort();
}
function packageMetadata(root) {
  const file = path.join(root, "package.json");
  if (!fs.existsSync(file)) return { language: "UNKNOWN", framework: null, packageManager: null, commands: {} };
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  const scripts = value.scripts || {};
  const dependencies = { ...(value.dependencies || {}), ...(value.devDependencies || {}) };
  const framework = dependencies.electron ? "Electron" : dependencies.next ? "Next.js" : dependencies.react ? "React" : "Node.js";
  return {
    language: fs.existsSync(path.join(root, "tsconfig.json")) ? "TypeScript" : "JavaScript",
    framework,
    packageManager: fs.existsSync(path.join(root, "package-lock.json")) ? "npm" : fs.existsSync(path.join(root, "pnpm-lock.yaml")) ? "pnpm" : fs.existsSync(path.join(root, "yarn.lock")) ? "yarn" : "npm",
    commands: Object.freeze({ test: scripts.test ? "npm test" : null, lint: scripts.lint ? "npm run lint" : null, typecheck: scripts.typecheck ? "npm run typecheck" : null, build: scripts.build ? "npm run build" : null }),
  };
}
function repositoryPreflight(contract, { now = () => Date.now() } = {}) {
  const started = now();
  const gitRoot = git(contract.repositoryRoot, ["rev-parse", "--show-toplevel"]).trim();
  if (fs.realpathSync(gitRoot) !== contract.repositoryRoot) throw Object.assign(new Error("La racine Git ne correspond pas au workspace autorisé."), { code: "WORKSPACE_SCOPE_MISMATCH" });
  const branch = git(gitRoot, ["branch", "--show-current"]).trim();
  if (contract.branch && contract.branch !== branch) throw Object.assign(new Error("La branche active a changé."), { code: "STALE_PRECONDITION" });
  const snapshot = snapshotRepository(gitRoot);
  const packageInfo = packageMetadata(gitRoot);
  const agentsFiles = relevantAgentsFiles(gitRoot, contract.allowedPaths);
  return Object.freeze({
    repositoryRoot: gitRoot, branch, gitStatus: snapshot.status, dirtyFiles: snapshot.files.filter((file) => !snapshot.status.includes(`?? ${file}`)),
    untrackedFiles: snapshot.files.filter((file) => snapshot.status.includes(`?? ${file}`)), snapshot,
    ...packageInfo, agentsFiles: Object.freeze(agentsFiles), readmePresent: fs.existsSync(path.join(gitRoot, "README.md")), durationMs: Math.max(0, now() - started),
  });
}

module.exports = { packageMetadata, relevantAgentsFiles, repositoryPreflight, snapshotRepository, statusPaths };
