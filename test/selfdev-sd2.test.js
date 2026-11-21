"use strict";

// SelfDev V1 — SD-2 : preuves base contre patch. Dépôts Git temporaires ; l'exécuteur de
// test lance réellement node --test (commande allowlistée) avec un environnement minimal.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { execFileSync, spawnSync } = require("node:child_process");
const { classifyDevCommand } = require("../services/delegation/dev-command-policy");
const { minimalEnvironment } = require("../services/security/dev-process-runner");
const { createSelfDevWorktreeService, createSelfDevEvidenceService, failedTestNames } = require("../services/selfdev");

const tmp = (prefix) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
const gitIn = (cwd, ...args) => execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const CONTEXT = Object.freeze({ workspaceId: "ws-selfdev", taskId: "selfdev-task", permissions: ["TERMINAL_SAFE"] });

// Dépôt : add() bogué (soustrait) ; un test existant qui ne couvre pas le bug.
function makeRepo() {
  const root = tmp("noon-sd2-repo-");
  gitIn(root, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "noon", version: "0.0.0" }));
  fs.mkdirSync(path.join(root, "lib"));
  fs.writeFileSync(path.join(root, "lib", "math.js"), "exports.add = (a, b) => a - b;\nexports.zero = () => 0;\n");
  fs.mkdirSync(path.join(root, "test"));
  fs.writeFileSync(path.join(root, "test", "zero.test.js"), "const test = require('node:test');\nconst assert = require('node:assert');\nconst m = require('../lib/math');\ntest('zero', () => assert.equal(m.zero(), 0));\n");
  gitIn(root, "add", "-A");
  gitIn(root, "commit", "-q", "-m", "base");
  return root;
}

// Exécuteur factice fidèle au contrat : commande allowlistée uniquement, environnement minimal.
function makeExecutor(calls) {
  return async (command, cwd, timeout, signal, context) => {
    calls.push({ command, cwd, context });
    const decision = classifyDevCommand(command);
    if (!decision.allowed) return { status: "FAIL", reasonCode: decision.reasonCode };
    const [executable, args] = decision.execution;
    const result = spawnSync(executable === "node" ? process.execPath : executable, args, { cwd, env: minimalEnvironment(process.env), encoding: "utf8", timeout });
    const output = `${result.stdout || ""}${result.stderr || ""}`;
    return { status: result.status === 0 ? "PASS" : "FAIL", exitCode: result.status, durationMs: 1, outputTail: output.slice(-4000) };
  };
}

function setup() {
  const root = makeRepo();
  const state = tmp("noon-sd2-state-");
  const worktrees = createSelfDevWorktreeService({ container: tmp("noon-sd2-wt-"), stateDirectory: state, cloneNodeModules: (s, d) => fs.cpSync(s, d, { recursive: true }) });
  const calls = [];
  const evidence = createSelfDevEvidenceService({ worktreeService: worktrees, executeValidation: makeExecutor(calls), stateDirectory: state });
  const created = worktrees.create({ repositoryRoot: root });
  return { root, worktrees, evidence, created, calls };
}

const writeRepro = (dir) => fs.writeFileSync(path.join(dir, "test", "add-repro.test.js"), "const test = require('node:test');\nconst assert = require('node:assert');\nconst m = require('../lib/math');\ntest('add additionne', () => assert.equal(m.add(2, 3), 5));\n");
const fixBug = (dir) => fs.writeFileSync(path.join(dir, "lib", "math.js"), "exports.add = (a, b) => a + b;\nexports.zero = () => 0;\n");

test("parcours complet : base mesurée, reproduction échoue sur la base et passe après patch → DEMONSTRATED", async () => {
  const h = setup();
  await h.evidence.runBaseline(h.created.id, { commands: ["node --test test/zero.test.js"], context: CONTEXT });
  writeRepro(h.created.worktreePath);
  fixBug(h.created.worktreePath);
  await h.evidence.runPatched(h.created.id, { context: CONTEXT });
  const repro = await h.evidence.runReproduction(h.created.id, { testFiles: ["test/add-repro.test.js"], context: CONTEXT });
  assert.equal(repro.reproduction.onBase.status, "FAIL", "le test de reproduction échoue sur la base");
  assert.equal(repro.reproduction.afterPatch.status, "PASS");
  assert.deepEqual(repro.reproduction.onBase.failedTests, ["add additionne"]);
  const result = h.evidence.verdict(h.created.id);
  assert.equal(result.verdict, "DEMONSTRATED", JSON.stringify(result));
  assert.ok(h.calls.every((call) => call.context.workspaceId === "ws-selfdev"), "contexte autoritaire transmis");
  assert.ok(h.calls.some((call) => path.basename(call.cwd).includes("-probe-")), "reproduction mesurée dans une sonde de base");
  assert.equal(h.worktrees.list().length, 1, "sonde supprimée après usage");
  assert.equal(gitIn(h.root, "worktree", "list").trim().split("\n").length, 2, "seul le worktree SelfDev subsiste");
});

test("sans reproduction, ou reproduction qui passe déjà sur la base → UNPROVEN", async () => {
  const h = setup();
  await h.evidence.runBaseline(h.created.id, { commands: ["node --test test/zero.test.js"], context: CONTEXT });
  fixBug(h.created.worktreePath);
  fs.writeFileSync(path.join(h.created.worktreePath, "test", "trivial.test.js"), "require('node:test')('ok', () => {});\n");
  await h.evidence.runPatched(h.created.id, { context: CONTEXT });
  assert.deepEqual(h.evidence.verdict(h.created.id).reasons, ["REPRODUCTION_MISSING"]);
  await h.evidence.runReproduction(h.created.id, { testFiles: ["test/trivial.test.js"], context: CONTEXT });
  const result = h.evidence.verdict(h.created.id);
  assert.equal(result.verdict, "UNPROVEN");
  assert.deepEqual(result.reasons, ["REPRO_NOT_FAILING_ON_BASE"]);
});

test("régression d'un test existant → BLOCKED", async () => {
  const h = setup();
  await h.evidence.runBaseline(h.created.id, { commands: ["node --test test/zero.test.js"], context: CONTEXT });
  fs.writeFileSync(path.join(h.created.worktreePath, "lib", "math.js"), "exports.add = (a, b) => a + b;\nexports.zero = () => 1;\n");
  await h.evidence.runPatched(h.created.id, { context: CONTEXT });
  const result = h.evidence.verdict(h.created.id);
  assert.equal(result.verdict, "BLOCKED");
  assert.deepEqual(result.comparison.map((item) => item.change), ["REGRESSION"]);
});

test("chemin protégé ou test existant modifié : aucune validation lancée, verdict BLOCKED", async () => {
  const h = setup();
  await h.evidence.runBaseline(h.created.id, { commands: ["node --test test/zero.test.js"], context: CONTEXT });
  const before = h.calls.length;
  fs.writeFileSync(path.join(h.created.worktreePath, "test", "zero.test.js"), "// affaibli\n");
  await assert.rejects(h.evidence.runPatched(h.created.id, { context: CONTEXT }), { code: "SELFDEV_PROTECTED_PATH_CHANGED" });
  assert.equal(h.calls.length, before, "le code du patch n'a pas été exécuté");
  assert.equal(h.evidence.verdict(h.created.id).verdict, "BLOCKED");
});

test("échec instable : relancé une fois, marqué FLAKY, jamais compté comme réussi", async () => {
  const root = makeRepo();
  const state = tmp("noon-sd2-state-");
  const worktrees = createSelfDevWorktreeService({ container: tmp("noon-sd2-wt-"), stateDirectory: state, cloneNodeModules: () => {} });
  let attempt = 0;
  const executeValidation = async () => ({ status: (attempt += 1) % 2 === 1 ? "FAIL" : "PASS", exitCode: 0, outputTail: "not ok 1 - instable\n" });
  const evidence = createSelfDevEvidenceService({ worktreeService: worktrees, executeValidation, stateDirectory: state });
  const created = worktrees.create({ repositoryRoot: root });
  const baseline = await evidence.runBaseline(created.id, { commands: ["npm test"], context: CONTEXT });
  assert.equal(baseline.baseline.results[0].outcome, "FLAKY");
  assert.equal(baseline.baseline.results[0].attempts.length, 2);
  fixBug(created.worktreePath);
  writeRepro(created.worktreePath);
  await evidence.runPatched(created.id, { context: CONTEXT });
  assert.ok(evidence.verdict(created.id).reasons.includes("FLAKY_VALIDATION"));
  assert.notEqual(evidence.verdict(created.id).verdict, "DEMONSTRATED");
});

test("garde-fous : commandes hors liste, base non propre, reproduction sur test existant, contexte absent", async () => {
  const h = setup();
  for (const commands of [["npm install"], ["git status"], ["node -e 1"], ["npm test -- ../outside.js"], [], Array(7).fill("npm test")]) {
    await assert.rejects(h.evidence.runBaseline(h.created.id, { commands, context: CONTEXT }), (error) => ["SELFDEV_COMMAND_REFUSED", "SELFDEV_COMMANDS_INVALID"].includes(error.code), JSON.stringify(commands));
  }
  await assert.rejects(h.evidence.runBaseline(h.created.id, { commands: ["npm test"], context: {} }), { code: "SELFDEV_CONTEXT_INVALID" });
  await assert.rejects(h.evidence.runPatched(h.created.id, { context: CONTEXT }), { code: "SELFDEV_BASELINE_MISSING" });
  fixBug(h.created.worktreePath);
  await assert.rejects(h.evidence.runBaseline(h.created.id, { commands: ["npm test"], context: CONTEXT }), { code: "SELFDEV_BASELINE_NOT_CLEAN" });
  fs.writeFileSync(path.join(h.created.worktreePath, "lib", "math.js"), "exports.add = (a, b) => a - b;\nexports.zero = () => 0;\n");
  await h.evidence.runBaseline(h.created.id, { commands: ["node --test test/zero.test.js"], context: CONTEXT });
  await assert.rejects(h.evidence.runReproduction(h.created.id, { testFiles: ["test/zero.test.js"], context: CONTEXT }), { code: "SELFDEV_REPRO_NOT_NEW_TEST" });
  await assert.rejects(h.evidence.runReproduction(h.created.id, { testFiles: ["lib/math.js"], context: CONTEXT }), { code: "SELFDEV_REPRO_NOT_NEW_TEST" });
});

test("données : l'environnement des validations n'hérite ni de NOON_DATA_DIR, ni de HOME, ni des clés", () => {
  const environment = minimalEnvironment({ PATH: "/usr/bin", NOON_DATA_DIR: "/Users/x/Library/Application Support/Noon", HOME: "/Users/x", OPENAI_API_KEY: "sk-test", TMPDIR: "/tmp" });
  assert.equal(environment.NOON_DATA_DIR, undefined);
  assert.equal(environment.HOME, undefined);
  assert.equal(environment.OPENAI_API_KEY, undefined);
  assert.equal(environment.PATH, "/usr/bin");
});

test("aucune sortie brute conservée ; noms d'échecs extraits et bornés", async () => {
  assert.deepEqual(failedTestNames("ok 1 - a\nnot ok 2 - b échoue\n  not ok 3 - c\n"), ["b échoue", "c"]);
  const h = setup();
  const saved = await h.evidence.runBaseline(h.created.id, { commands: ["node --test test/zero.test.js"], context: CONTEXT });
  assert.equal(JSON.stringify(saved).includes("outputTail"), false);
});
