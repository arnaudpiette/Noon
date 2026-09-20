"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { isPathInsideRoots } = require("./path-utils");

function executableFile(candidate, { fsImpl = fs, approvedRoots = null } = {}) {
  if (!candidate || !path.isAbsolute(candidate)) return null;
  try {
    const real = fsImpl.realpathSync(candidate);
    const stat = fsImpl.statSync(real);
    if (!stat.isFile() || (stat.mode & 0o111) === 0) return null;
    if (approvedRoots?.length && !isPathInsideRoots(real, approvedRoots)) return null;
    return real;
  } catch { return null; }
}

function pathCandidate(env, { fsImpl = fs } = {}) {
  for (const directory of String(env.PATH || "").split(path.delimiter)) {
    if (!path.isAbsolute(directory)) continue;
    const executable = executableFile(path.join(directory, "codex"), { fsImpl });
    if (executable) return { executable, source: "PATH" };
  }
  return null;
}

function supportedCandidates(homeDirectory) {
  return [
    { candidate: "/opt/homebrew/bin/codex", source: "HOMEBREW" },
    { candidate: "/usr/local/bin/codex", source: "USR_LOCAL" },
    { candidate: path.join(homeDirectory, ".local", "bin", "codex"), source: "LOCAL_BIN" },
  ];
}

function vscodeCandidate({ homeDirectory, platform = process.platform, arch = process.arch, fsImpl = fs } = {}) {
  if (platform !== "darwin") return null;
  const extensionsDirectory = path.join(homeDirectory, ".vscode", "extensions");
  let extensionsRoot;
  try { extensionsRoot = fsImpl.realpathSync(extensionsDirectory); } catch { return null; }
  let extensionNames;
  try { extensionNames = fsImpl.readdirSync(extensionsRoot).filter((name) => /^openai\.chatgpt-[\w.-]+$/.test(name)).sort().reverse(); } catch { return null; }
  const platformDirectory = arch === "arm64" ? "macos-aarch64" : "macos-x86_64";
  for (const name of extensionNames) {
    const extensionPath = path.join(extensionsRoot, name);
    let extensionRoot;
    try { extensionRoot = fsImpl.realpathSync(extensionPath); } catch { continue; }
    if (!isPathInsideRoots(extensionRoot, [extensionsRoot])) continue;
    const executable = executableFile(path.join(extensionRoot, "bin", platformDirectory, "codex"), { fsImpl, approvedRoots: [extensionRoot] });
    if (executable) return { executable, source: "VSCODE_EXTENSION" };
  }
  return null;
}

function resolveCodexExecutable({ env = process.env, homeDirectory = os.homedir(), platform = process.platform, arch = process.arch, fsImpl = fs } = {}) {
  const fromPath = pathCandidate(env, { fsImpl });
  if (fromPath) return fromPath;
  for (const item of supportedCandidates(homeDirectory)) {
    const executable = executableFile(item.candidate, { fsImpl, approvedRoots: [path.dirname(item.candidate)] });
    if (executable) return { executable, source: item.source };
  }
  return vscodeCandidate({ homeDirectory, platform, arch, fsImpl }) || { executable: null, source: "NOT_FOUND" };
}

module.exports = { executableFile, pathCandidate, resolveCodexExecutable, supportedCandidates, vscodeCandidate };
