"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createCodexSpecialistAgent } = require("../services/delegation/codex-specialist-agent");
const { createDevDelegationRunner } = require("../services/delegation/dev-delegation-runner");

function git(root, args) { return execFileSync("git", args, { cwd: root, stdio: "ignore" }); }

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noon-v25-real-fixture-"));
  try {
    fs.mkdirSync(path.join(root, "src")); fs.mkdirSync(path.join(root, "test"));
    fs.writeFileSync(path.join(root, "src", "double.js"), "function double(value) { return value * 2; }\nmodule.exports = { double };\n");
    fs.writeFileSync(path.join(root, "test", "double.test.js"), "const test = require('node:test');\nconst assert = require('node:assert/strict');\nconst { double } = require('../src/double');\ntest('double', () => assert.equal(double(2), 4));\n");
    fs.writeFileSync(path.join(root, "notes.txt"), "baseline\n");
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "noon-v25-fixture", private: true, version: "1.0.0", scripts: { test: "node --test" } }, null, 2) + "\n");
    fs.writeFileSync(path.join(root, "AGENTS.md"), "# Fixture rules\n\nModify only src/ and test/. Preserve pre-existing changes. Do not install, commit, push, or access the network.\n");
    git(root, ["init", "-q"]); git(root, ["config", "user.name", "Noon Fixture"]); git(root, ["config", "user.email", "fixture@example.test"]); git(root, ["add", "."]); git(root, ["commit", "-qm", "baseline"]);
    fs.writeFileSync(path.join(root, "notes.txt"), "pre-existing user change\n");
    const specialistAgent = createCodexSpecialistAgent();
    if (!await specialistAgent.isAvailable()) throw Object.assign(new Error("Codex CLI unavailable"), { code: "AGENT_UNAVAILABLE" });
    const runner = createDevDelegationRunner({ specialistAgent });
    const result = await runner.runDevTask({
      objective: "Add input validation to double(value): throw TypeError when value is not a finite number, and add focused tests for valid and invalid inputs.",
      workspaceAuthorized: true, workspaceId: "synthetic-fixture", workspaceRoots: [root], repositoryRoot: root,
      allowedPaths: [path.join(root, "src"), path.join(root, "test")], forbiddenPaths: [path.join(root, "notes.txt")],
      constraints: ["Minimal change", "Preserve notes.txt", "No dependencies", "No commit"], validationCommands: ["npm test"],
      permissions: ["READ_WRITE_WORKSPACE", "TERMINAL_SAFE"], requiredQuality: "NORMAL", maxIterations: 3, maxDuration: 5 * 60_000,
    });
    const report = {
      agent: specialistAgent.id, agentVersion: specialistAgent.getCapabilities().version, delegation: result.finalVerdict,
      status: result.status, failureCategory: result.failureCategory, duration: result.metrics.duration,
      agentDuration: result.metrics.agentDuration, orchestrationOverhead: result.metrics.orchestrationOverhead,
      preflightDuration: result.metrics.preflightDuration, postValidationDuration: result.metrics.postValidationDuration,
      iterations: result.metrics.iterations, estimatedCost: result.metrics.estimatedCost, actualCost: result.metrics.actualCost,
      changedFiles: result.changedFiles, commandCount: result.metrics.commandCount,
      tests: result.validations.find((item) => item.command === "npm test")?.status || "N/A",
      diffCheck: result.validations.find((item) => item.command === "git diff --check")?.status || "N/A",
      diffReview: result.diffReview.issues.map((item) => item.code),
      preExistingChangesPreserved: result.preExistingChangesPreserved, finalVerdict: result.finalVerdict,
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (result.finalVerdict !== "PASS") process.exitCode = 1;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => { process.stderr.write(`${String(error.code || "FIXTURE_FAILED")}\n`); process.exitCode = 1; });
