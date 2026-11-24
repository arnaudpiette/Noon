"use strict";

// V3-L7 — découpe de dev-process-runner.js : mêmes exports (mêmes identités) et primitives du
// bac à sable inchangées (environnement minimal sans secret, limites bornées, erreur typée).
const assert = require("node:assert/strict");
const test = require("node:test");
const runner = require("../services/security/dev-process-runner");
const primitives = require("../services/security/dev-process-sandbox-primitives");

test("dev-process-runner réexporte les mêmes valeurs que le module des primitives", () => {
  for (const name of ["DEFAULT_LIMITS", "MAX_LIMITS", "OS_CAPABILITIES", "RESULT_STATUSES", "SANDBOX_LEVELS", "DevProcessRunnerError", "minimalEnvironment", "resolveExecutableFromPath"]) {
    assert.equal(runner[name], primitives[name], name);
  }
});

test("environnement minimal : aucune variable secrète transmise", () => {
  const env = primitives.minimalEnvironment({ PATH: "/usr/bin", HOME: "/tmp/home", OPENAI_API_KEY: "sk-test-fausse-cle", GITHUB_TOKEN: "ghp_test" });
  assert.equal("OPENAI_API_KEY" in env, false);
  assert.equal("GITHUB_TOKEN" in env, false);
});

test("limites figées et erreur typée", () => {
  assert.equal(Object.isFrozen(primitives.DEFAULT_LIMITS), true);
  assert.equal(Object.isFrozen(primitives.MAX_LIMITS), true);
  const error = new primitives.DevProcessRunnerError("CODE", "message");
  assert.equal(error instanceof Error, true);
  assert.equal(error.code, "CODE");
});
