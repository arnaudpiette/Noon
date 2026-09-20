"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createDevTaskContract } = require("../services/delegation/dev-task-contract");
const { classifyDevCommand } = require("../services/delegation/dev-command-policy");
const { createDevDelegationRunner } = require("../services/delegation/dev-delegation-runner");
const { reviewDiff } = require("../services/delegation/dev-delegation-runner");
const { discoverSpecialistAgents } = require("../services/delegation/agent-discovery");
const { assertSpecialistAgentAdapter } = require("../services/delegation/specialist-agent-adapter");
const { sanitizedAgentEnvironment } = require("../services/delegation/codex-specialist-agent");
const { createDelegationEngine } = require("../services/delegation/delegation-engine");

function command(root, executable, args) { return execFileSync(executable, args, { cwd: root, encoding: "utf8" }); }
function repository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noon-dev-delegation-"));
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "value.js"), "module.exports = 1;\n");
  fs.writeFileSync(path.join(root, "user.txt"), "base\n");
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0", scripts: { test: "node --test" } }));
  fs.writeFileSync(path.join(root, "AGENTS.md"), "# Fixture rules\n\nPreserve user.txt.\n");
  command(root, "git", ["init", "-q"]); command(root, "git", ["config", "user.email", "fixture@example.test"]); command(root, "git", ["config", "user.name", "Fixture"]);
  command(root, "git", ["add", "."]); command(root, "git", ["commit", "-qm", "fixture"]);
  return root;
}
function task(root, overrides = {}) {
  return { objective: "Ajoute une validation synthétique.", workspaceAuthorized: true, workspaceId: "fixture", workspaceRoots: [root], repositoryRoot: root, allowedPaths: [path.join(root, "src")], validationCommands: ["npm test"], ...overrides };
}
function adapter(execute) {
  return assertSpecialistAgentAdapter({ id: "mock", name: "Mock", async isAvailable() { return true; }, getCapabilities() { return {}; }, executeTask: execute, async cancelTask() { return true; }, async getTaskStatus() { return "UNKNOWN"; } });
}
const passValidation = async (commandName) => ({ command: commandName, status: "PASS", durationMs: 1 });

test("le DelegationEngine bloque le DEV tant que le flag effectif n'est pas LIMITED", async () => {
  let calls = 0;
  const engine = createDelegationEngine({
    registry: { get() {}, has() { return false; } },
    capsuleBuilder: { build() {} },
    modelRouter() {},
    async runSpecialist() {},
    devDelegationRunner: { async runDevTask() { calls += 1; return { status: "SUCCESS" }; } },
  });
  const blocked = await engine.runDevTask({ featureMode: "OFF" });
  assert.equal(blocked.failureCategory, "FEATURE_DISABLED");
  assert.equal(calls, 0);
  const enabled = await engine.runDevTask({ featureMode: "LIMITED" });
  assert.equal(enabled.status, "SUCCESS");
  assert.equal(calls, 1);
});

test("le contrat DEV exige un workspace explicite et bloque les chemins hors périmètre", () => {
  const root = repository();
  assert.throws(() => createDevTaskContract(task(root, { workspaceAuthorized: false })), (error) => error.code === "PERMISSION_DENIED");
  assert.throws(() => createDevTaskContract(task(root, { allowedPaths: [path.dirname(root)] })), (error) => error.code === "OUT_OF_SCOPE_CHANGE");
});

test("le runner réutilise les racines read-write du WorkspaceEngine", async () => {
  const root = repository();
  const workspaceEngine = { context: () => ({ relevantRoots: [{ path: root, mode: "read-write" }] }) };
  const runner = createDevDelegationRunner({ workspaceEngine, specialistAgent: adapter(async (contract) => ({ taskId: contract.taskId, agent: "mock", status: "SUCCESS", summary: "done" })), validationExecutor: passValidation });
  const result = await runner.runDevTask(task(root, { workspaceAuthorized: false, workspaceRoots: [] }));
  assert.equal(result.finalVerdict, "PASS");
});

test("la découverte distingue Codex d'un Cursor sans interface disponible", () => {
  const result = discoverSpecialistAgents({ probeExecutable: (name) => name === "codex" ? "codex-cli 1.0" : null });
  assert.equal(result.codex.available, true); assert.equal(result.codex.method, "codex exec");
  assert.equal(result.cursor.available, false); assert.equal(result.cursor.status, "FUTURE_NOT_AVAILABLE");
});

test("la politique terminal refuse sudo, Git destructif, push et installation", () => {
  for (const value of ["sudo whoami", "rm -r outside", "git reset --hard", "git clean -fd", "git push origin main", "git checkout -- file", "npm install left-pad"]) assert.equal(classifyDevCommand(value).allowed, false);
  assert.equal(classifyDevCommand("git diff --check").allowed, true);
});

test("l'environnement Codex n'hérite d'aucun secret fournisseur", () => {
  const env = sanitizedAgentEnvironment({ PATH: "/bin", HOME: "/tmp/home", GEMINI_API_KEY: "fixture-secret", OPENAI_API_KEY: "fixture-secret", GOOGLE_OAUTH_CLIENT_SECRET: "fixture-secret" });
  assert.deepEqual(env, { PATH: "/bin", HOME: "/tmp/home" });
});

test("un coût agent indisponible reste inconnu et ne devient pas zéro", () => {
  const normalized = require("../services/delegation/specialist-agent-adapter").normalizeSpecialistAgentResult({ taskId: "task", agent: "mock", status: "SUCCESS" });
  assert.equal(normalized.estimatedCost, null); assert.equal(normalized.actualCost, null);
});

test("agent SUCCESS, changement autorisé et validations Noon vertes donnent PASS", async () => {
  const root = repository();
  const runner = createDevDelegationRunner({ specialistAgent: adapter(async (contract) => { fs.writeFileSync(path.join(contract.repositoryRoot, "src", "value.js"), "module.exports = 2;\n"); return { taskId: contract.taskId, agent: "mock", status: "SUCCESS", summary: "done", iterations: 1 }; }), validationExecutor: passValidation });
  const result = await runner.runDevTask(task(root));
  assert.equal(result.finalVerdict, "PASS"); assert.deepEqual(result.changedFiles, ["src/value.js"]); assert.equal(result.diffReview.valid, true);
});

test("la parole de l'agent ne prévaut jamais sur un test Noon rouge", async () => {
  const root = repository(); let count = 0;
  const runner = createDevDelegationRunner({ specialistAgent: adapter(async (contract) => { fs.writeFileSync(path.join(contract.repositoryRoot, "src", "value.js"), "module.exports = 2;\n"); return { taskId: contract.taskId, agent: "mock", status: "SUCCESS", summary: "done" }; }), validationExecutor: async (name) => ({ command: name, status: ++count === 2 ? "FAIL" : "PASS" }) });
  const result = await runner.runDevTask(task(root));
  assert.equal(result.status, "SUCCESS"); assert.equal(result.finalVerdict, "FAIL"); assert.equal(result.failureCategory, "VALIDATION_FAILURE");
});

test("une écriture hors allowedPaths produit OUT_OF_SCOPE_CHANGE et FAIL", async () => {
  const root = repository();
  const runner = createDevDelegationRunner({ specialistAgent: adapter(async (contract) => { fs.writeFileSync(path.join(contract.repositoryRoot, "outside.js"), "unsafe\n"); return { taskId: contract.taskId, agent: "mock", status: "SUCCESS", summary: "done" }; }), validationExecutor: passValidation });
  const result = await runner.runDevTask(task(root));
  assert.equal(result.finalVerdict, "FAIL"); assert.equal(result.failureCategory, "OUT_OF_SCOPE_CHANGE");
});

test("timeout et annulation préservent le workspace", async () => {
  const timeoutRoot = repository();
  const timed = createDevDelegationRunner({ specialistAgent: adapter(async (contract) => ({ taskId: contract.taskId, agent: "mock", status: "TIMEOUT", summary: "timeout", failureCategory: "TIMEOUT" })), validationExecutor: passValidation });
  const timeoutResult = await timed.runDevTask(task(timeoutRoot));
  assert.equal(timeoutResult.status, "TIMEOUT"); assert.equal(timeoutResult.preExistingChangesPreserved, true);

  const cancelRoot = repository(); const controller = new AbortController();
  const cancelled = createDevDelegationRunner({ specialistAgent: adapter(async (contract, context) => new Promise((resolve) => context.signal.addEventListener("abort", () => resolve({ taskId: contract.taskId, agent: "mock", status: "CANCELLED", summary: "cancelled", failureCategory: "CANCELLED" }), { once: true }))), validationExecutor: passValidation });
  const pending = cancelled.runDevTask(task(cancelRoot, { signal: controller.signal })); controller.abort();
  const cancelResult = await pending; assert.equal(cancelResult.status, "CANCELLED"); assert.equal(cancelResult.preExistingChangesPreserved, true);
});

test("un changement utilisateur préexistant reste intact et séparé", async () => {
  const root = repository(); fs.writeFileSync(path.join(root, "user.txt"), "user change\n");
  const runner = createDevDelegationRunner({ specialistAgent: adapter(async (contract) => { fs.writeFileSync(path.join(contract.repositoryRoot, "src", "value.js"), "module.exports = 3;\n"); return { taskId: contract.taskId, agent: "mock", status: "SUCCESS", summary: "done" }; }), validationExecutor: passValidation });
  const result = await runner.runDevTask(task(root));
  assert.equal(result.preExistingChangesPreserved, true); assert.deepEqual(result.preExistingChanges, ["user.txt"]); assert.deepEqual(result.changedFiles, ["src/value.js"]); assert.equal(fs.readFileSync(path.join(root, "user.txt"), "utf8"), "user change\n");
});

test("la récupération après crash inspecte sans reprendre les écritures", async () => {
  const root = repository(); fs.writeFileSync(path.join(root, "src", "value.js"), "interrupted\n");
  const runner = createDevDelegationRunner({ specialistAgent: adapter(async () => ({})), validationExecutor: passValidation });
  const result = await runner.recoverInterruptedTask(task(root));
  assert.equal(result.status, "INTERRUPTED"); assert.equal(result.requiresUserDecision, true); assert.deepEqual(result.changedFiles, ["src/value.js"]);
});

test("remplacer une assertion par plusieurs assertions ne produit pas de faux affaiblissement", () => {
  const root = repository(); fs.mkdirSync(path.join(root, "test"));
  fs.writeFileSync(path.join(root, "test", "value.test.js"), "const assert = require('node:assert/strict');\nassert.equal(1, 1);\n");
  command(root, "git", ["add", "."]); command(root, "git", ["commit", "-qm", "add-test"]);
  fs.writeFileSync(path.join(root, "test", "value.test.js"), "const assert = require('node:assert/strict');\nassert.equal(1, 1);\nassert.ok(true);\n");
  const contract = createDevTaskContract(task(root, { allowedPaths: [path.join(root, "test")] }));
  assert.equal(reviewDiff(contract, ["test/value.test.js"]).valid, true);
});
