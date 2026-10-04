"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const { createBenchmarkFixtureRegistry } = require("../services/dev/benchmark/fixture-registry");
const { getHiddenValidator } = require("../services/dev/benchmark/hidden-validator-registry");
const { createGlobalBenchmarkValidator } = require("../services/dev/benchmark/global-benchmark-validator");

test("normalize-email: normalizing whitespace without rejecting blank input fails hidden validation", async (t) => {
  const baseline = createBenchmarkFixtureRegistry()["normalize-email"];
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "noon-email-diagnostic-"));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  fs.cpSync(baseline, workspace, { recursive: true });
  fs.writeFileSync(path.join(workspace, "src/email.js"), "function normalizeEmail(input) { return String(input).trim().toLowerCase(); }\nmodule.exports = { normalizeEmail };\n");
  const { normalizeEmail } = require(path.join(workspace, "src/email.js"));
  assert.equal(normalizeEmail("  USER@EXAMPLE.TEST  "), "user@example.test");
  assert.equal(normalizeEmail(" "), "");
  const validate = createGlobalBenchmarkValidator({
    resolveHiddenValidator: getHiddenValidator,
    runCommand(command, root) {
      assert.deepEqual(command, ["npm", "test"]);
      execFileSync(process.execPath, ["--test", "test/email.test.js"], { cwd: root, stdio: "pipe" });
      return "PASS";
    },
  });
  const result = await validate({ task: { validationCommands: ["npm test"] }, fixtureBaseline: baseline, workspace, hiddenValidatorId: "normalize-email", allowedPaths: ["src", "test"], forbiddenPaths: [".git", "node_modules"] });
  assert.equal(result.visibleTests, "PASS");
  assert.equal(result.hiddenTests, "FAIL");
  assert.equal(result.hiddenValidationReasonCode, "HIDDEN_VALIDATION_FAILED");
  assert.equal(result.finalValid, false);
  assert.equal(result.scopeValid && result.securityValid && result.testIntegrityValid, true);
});
