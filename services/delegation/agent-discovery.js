"use strict";

const { spawnSync } = require("node:child_process");

function probe(executable, args = ["--version"]) {
  const result = spawnSync(executable, args, { encoding: "utf8", timeout: 5_000 });
  return result.status === 0 ? String(result.stdout || result.stderr || "").trim().split("\n")[0].slice(0, 160) : null;
}
function discoverSpecialistAgents({ probeExecutable = probe } = {}) {
  const codexVersion = probeExecutable("codex");
  const cursorVersion = probeExecutable("cursor");
  return Object.freeze({
    codex: Object.freeze({ available: Boolean(codexVersion), method: codexVersion ? "codex exec" : null, version: codexVersion, capabilities: codexVersion ? Object.freeze(["NON_INTERACTIVE", "WORKING_DIRECTORY", "STRUCTURED_OUTPUT", "WORKSPACE_SANDBOX", "CANCELLATION"]) : Object.freeze([]) }),
    cursor: Object.freeze({ available: Boolean(cursorVersion), method: cursorVersion ? "cursor CLI" : null, version: cursorVersion, status: cursorVersion ? "AVAILABLE_UNINTEGRATED" : "FUTURE_NOT_AVAILABLE" }),
  });
}

module.exports = { discoverSpecialistAgents, probe };
