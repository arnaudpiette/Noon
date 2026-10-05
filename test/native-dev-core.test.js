"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const { createTransactionalExecutionEngine } = require("../services/execution/transactional-execution-engine");
const { createSkillRegistry } = require("../skills/registry");
const { createDevTaskJournal } = require("../services/dev/dev-task-journal");
const { createNativeDevCoordinator } = require("../services/dev/native-dev-coordinator");
const { isBlockingValidationFailure, normalizeReasoning } = require("../services/dev/native-dev-coordinator");
const { createNativeDevReasoner, createNativeDevStructuredExecutor } = require("../services/dev/native-dev-reasoner");
const { createDevCostBudgetService } = require("../services/dev/dev-cost-budget-service");
const { applyOperation, digest, readText, runSafeCommand } = require("../services/dev/native-repository-tools");
const { createDevTaskContract } = require("../services/delegation/dev-task-contract");
const { createOperationalSecurityPolicy } = require("../services/security/operational-security-policy");

function memoryRepository() {
  const executions = new Map(); const steps = new Map();
  return {
    saveExecution(value) { executions.set(value.execution_id, structuredClone(value)); }, saveStep(value) { steps.set(`${value.execution_id}:${value.step_id}`, structuredClone(value)); },
    getExecution(id) { return structuredClone(executions.get(id) || null); }, getSteps(id) { return [...steps.values()].filter((item) => item.execution_id === id).map((item) => structuredClone(item)); },
    findStepByIdempotencyKey(key) { return [...steps.values()].find((item) => item.idempotency_key === key) || null; }, listRecoverable() { return []; }, transaction(callback) { return callback(); },
  };
}
function repository(files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noon-native-dev-"));
  execFileSync("git", ["init", "-q"], { cwd: root }); execFileSync("git", ["config", "user.email", "fixture@example.test"], { cwd: root }); execFileSync("git", ["config", "user.name", "Fixture"], { cwd: root });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
  for (const [name, content] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); fs.writeFileSync(path.join(root, name), content); }
  execFileSync("git", ["add", "."], { cwd: root }); execFileSync("git", ["commit", "-qm", "fixture"], { cwd: root }); return root;
}
function fixture({ root, reason, validations = () => "PASS", mode = "LIMITED", maxIterations = 3, allowedPaths, securityPolicy = null } = {}) {
  const skillRegistry = createSkillRegistry();
  const transactionalExecutionEngine = createTransactionalExecutionEngine({ repository: memoryRepository(), skillRegistry });
  const journalDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "noon-dev-journal-"));
  const journal = createDevTaskJournal({ directory: journalDirectory });
  const calls = [];
  const coordinator = createNativeDevCoordinator({
    workspaceEngine: { context: () => ({ roots: [{ path: root, mode: "read-write" }] }) }, transactionalExecutionEngine,
    operationalSecurityPolicy: securityPolicy || { evaluate: () => ({ outcome: "ALLOW", policyVersion: "test" }) }, skillRegistry,
    reasoner: { async reason(input) { calls.push(input); return reason(input); } }, journal, featureMode: (input) => typeof mode === "function" ? mode(input) : mode,
    validationRunner: async (command) => { const status = validations(command, calls); return { command, status, exitCode: status === "PASS" ? 0 : 1, durationMs: 1, outputTail: status === "PASS" ? "" : "assertion failed", failureCategory: status === "PASS" ? null : "TEST_FAILURE" }; },
  });
  const run = (extra = {}) => coordinator.runTask({ workspaceId: "workspace-fixture", repositoryRoot: root, objective: "Corriger normalizeEmail", validationCommands: ["npm test"], maxIterations, allowedPaths, ...extra });
  return { coordinator, journal, journalDirectory, calls, run };
}

test("B17 le workspace benchmark réel est transmis comme borne de politique sans élargir les racines globales", async () => {
  const root = repository({ "src/email.js": "module.exports = value => value;\n", "test/email.test.js": "module.exports = {};\n" });
  const policy = createOperationalSecurityPolicy({ allowedRootsProvider: () => [], allowedWriteRootsProvider: () => [] });
  let reasonerReached = 0;
  const f = fixture({ root, allowedPaths: ["src", "test"], securityPolicy: policy, reason: () => { reasonerReached += 1; throw Object.assign(new Error("fake provider seam"), { code: "FAKE_PROVIDER_REACHED" }); } });
  const result = await f.run({ benchmark: { id: "session-b17", limitUsd: 0.5 } });
  assert.equal(reasonerReached, 1);
  assert.equal(result.failureCategory, "FAKE_PROVIDER_REACHED");
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "noon-b17-outside-"));
  const denied = policy.evaluate({ actionRequest: { origin: "explicit_user_chat", skillId: "noon_dev_run_validation", operation: "validate repository", args: { path: outside }, target: { scope: "LOCAL", scopeName: "workspace", targetType: "repository", targetCount: 1 }, actionClass: "READ" }, skillPolicy: { level: "read" }, currentPermissions: { allowed: true }, authorizedRoots: [root], authorizedWriteRoots: [root] });
  assert.equal(denied.outcome, "DENY");
  assert.ok(denied.reasons.includes("TARGET_OUT_OF_SCOPE"));
});

test("B17 atteint la frontière fournisseur factice après routage et réservation benchmark", async () => {
  const root = repository({
    "src/email.js": "function normalizeEmail(value) { return value; }\nmodule.exports = { normalizeEmail };\n",
    "test/email.test.js": "const test=require('node:test');const assert=require('node:assert/strict');const {normalizeEmail}=require('../src/email');test('normalize',()=>assert.equal(normalizeEmail(' User@Example.TEST '),'user@example.test'));\n",
  });
  const ledger = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "noon-b17-ledger-")), "ledger.json");
  const budgetService = createDevCostBudgetService({ filePath: ledger, config: () => ({ taskLimit: 1, dailyLimit: 1, monthlyLimit: 1 }), enforcement: () => true });
  const policy = createOperationalSecurityPolicy({ allowedRootsProvider: () => [], allowedWriteRootsProvider: () => [] });
  const events = []; let routeInput = null;
  const executor = createNativeDevStructuredExecutor({
    featureFlags: { evaluate: () => ({ enabled: true }) }, budgetService,
    selectModelRoute: (input) => { routeInput = input; return { provider: "fake-openai", model: "b17-local", effort: "low", verbosity: "low", estimatedCost: { status: "available", total: 0.05 }, reasonCodes: ["B17_FAKE_ROUTE"] }; },
    estimateCost: () => ({ status: "available", total: 0.05 }), authorizePrivacy: () => "b17-local-privacy",
    providerAdapter: { execute: async (request) => {
      const entries = budgetService.entries();
      events.push({ stage: "fake-provider", entries });
      assert.equal(entries.at(-1).status, "RESERVED");
      assert.equal(entries.at(-1).benchmarkId, "session-b17");
      const payload = JSON.parse(request.input[1].content);
      const edit = payload.phase === "PLAN" ? [] : [{ type: "MODIFY", path: "src/email.js", expectedHash: payload.files[0].hash, search: "return value;", replacement: "return String(value).trim().toLowerCase();", content: null }];
      return { text: JSON.stringify({ summary: "B17 fixture", files: payload.phase === "PLAN" ? ["src/email.js"] : [], searchTerms: [], operations: edit, validationCommands: ["node --test test/email.test.js"] }), provider: "fake-openai", model: "b17-local", usage: { inputTokens: 10, outputTokens: 10 }, latencyMs: 1 };
    } },
  });
  const skillRegistry = createSkillRegistry();
  const coordinator = createNativeDevCoordinator({
    workspaceEngine: { context: () => ({ roots: [{ path: root, mode: "read-write" }] }) },
    transactionalExecutionEngine: createTransactionalExecutionEngine({ repository: memoryRepository(), skillRegistry }), operationalSecurityPolicy: policy, skillRegistry,
    reasoner: createNativeDevReasoner({ executeStructured: executor }), journal: createDevTaskJournal({ directory: fs.mkdtempSync(path.join(os.tmpdir(), "noon-b17-journal-")) }),
    featureMode: (input) => input.sessionId === "session-b17" ? "LIMITED" : "OFF",
  });
  const result = await coordinator.runTask({ taskId: "run-b17", sessionId: "session-b17", workspaceId: "run-b17", workspaceAuthorized: true, workspaceRoots: [root], repositoryRoot: root, objective: "Corriger normalizeEmail", allowedPaths: ["src", "test"], forbiddenPaths: [".git", "node_modules"], validationCommands: ["node --test test/email.test.js"], benchmark: { id: "session-b17", limitUsd: 0.5 }, maxIterations: 1 });
  assert.equal(result.finalVerdict, "PASS", JSON.stringify(result));
  assert.equal(routeInput.taskDomain, "DEV");
  assert.equal(events.length, 2);
  assert.equal(budgetService.entries().every((entry) => entry.status === "RECONCILED"), true);
  assert.equal(budgetService.entries().every((entry) => entry.benchmarkId === "session-b17"), true);
});

test("B17 refuse les identités et racines benchmark avant reasoner, réservation ou validation", async () => {
  const root = repository({ "src/email.js": "module.exports = value => value;\n", "other/keep.js": "keep\n" });
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "noon-b17-outside-"));
  const policy = createOperationalSecurityPolicy({ allowedRootsProvider: () => [], allowedWriteRootsProvider: () => [] });
  let reasonerCalls = 0; let validationCalls = 0;
  const f = fixture({ root, allowedPaths: ["src"], securityPolicy: policy, mode: (input) => input.sessionId === "session-b17" ? "LIMITED" : "OFF", reason: () => { reasonerCalls += 1; return {}; }, validations: () => { validationCalls += 1; return "PASS"; } });
  for (const sessionId of ["", "session-wrong"]) {
    const result = await f.run({ taskId: "run-b17-negative", sessionId, benchmark: { id: "session-b17", limitUsd: 0.5 } });
    assert.equal(result.failureCategory, "FEATURE_DISABLED");
  }
  assert.equal(reasonerCalls, 0); assert.equal(validationCalls, 0);
  const escape = path.join(root, "src", "escape"); fs.symlinkSync(outside, escape);
  const denied = policy.evaluate({ actionRequest: { origin: "explicit_user_chat", skillId: "noon_dev_apply_edit", operation: "update local file", args: { path: escape }, target: { scope: "LOCAL", scopeName: "workspace", targetType: "file", targetCount: 1 }, actionClass: "WRITE" }, skillPolicy: { level: "write" }, currentPermissions: { allowed: true }, authorizedRoots: [root], authorizedWriteRoots: [root] });
  assert.equal(denied.outcome, "DENY"); assert.ok(denied.reasons.includes("TARGET_OUT_OF_SCOPE"));
});

test("B17 réconcilie une exposition fournisseur inconnue sans inventer de coût", async () => {
  const budgetService = createDevCostBudgetService({ config: () => ({ taskLimit: 1, dailyLimit: 1, monthlyLimit: 1 }), enforcement: () => true });
  const executor = createNativeDevStructuredExecutor({
    featureFlags: { evaluate: () => ({ enabled: true }) }, budgetService,
    selectModelRoute: () => ({ provider: "fake-openai", model: "b17-local", effort: "low", verbosity: "low", estimatedCost: { status: "available", total: 0.05 } }),
    estimateCost: () => ({ status: "available", total: 0.05 }), authorizePrivacy: () => "b17-local-privacy",
    providerAdapter: { execute: async () => { throw Object.assign(new Error("fake transport failure"), { code: "FAKE_PROVIDER_FAILURE" }); } },
  });
  await assert.rejects(executor({ taskDomain: "DEV", requiredQuality: "NORMAL", maxEstimatedCost: 0.5, schema: {}, schemaName: "b17", system: "system", payload: { taskId: "run-b17-failure", phase: "PLAN", objective: "fixture", benchmark: { id: "session-b17", limitUsd: 0.5 } } }), { code: "FAKE_PROVIDER_FAILURE" });
  const [entry] = budgetService.entries();
  assert.equal(entry.status, "UNKNOWN_PENDING_RECONCILIATION"); assert.equal(entry.actualCost, null); assert.equal(entry.benchmarkId, "session-b17");
});

test("Noon Dev natif modifie un fichier lu, valide et n'utilise jamais Codex", async () => {
  const root = repository({ "lib/email.js": "function normalizeEmail(v) { return v; }\n" });
  const f = fixture({ root, reason: ({ phase, files }) => phase === "PLAN" ? { files: ["lib/email.js"], operations: [], providerMetrics: { provider: "openai", model: "fixture-model", latencyMs: 3, usage: { inputTokens: 1 }, estimatedCost: 0.001 } } : { operations: [{ type: "MODIFY", path: "lib/email.js", expectedHash: files[0].hash, search: "return v;", replacement: "return v.trim().toLowerCase();" }], providerMetrics: { provider: "openai", model: "fixture-model", latencyMs: 4, usage: { outputTokens: 1 }, estimatedCost: 0.002 } } });
  const result = await f.run();
  assert.equal(result.finalVerdict, "PASS", JSON.stringify(result)); assert.equal(result.executionMode, "NATIVE_NOON"); assert.equal(result.codexUsed, false);
  assert.match(fs.readFileSync(path.join(root, "lib/email.js"), "utf8"), /trim\(\)\.toLowerCase/);
  assert.equal(result.metrics.modelCallCount, 2); assert.equal(result.metrics.estimatedCost, 0.003); assert.equal(result.metrics.providerCalls[0].provider, "openai"); assert.equal(result.metrics.inputTokens, 1); assert.equal(result.metrics.outputTokens, 1);
});

test("TASK_FAILURE conserve la telemetry des appels fournisseur déjà effectués", async () => {
  const root = repository({ "lib/email.js": "module.exports = value => value;\n" });
  const f = fixture({ root, reason: ({ phase }) => ({ files: phase === "PLAN" ? ["lib/email.js"] : [], operations: [], providerMetrics: { provider: "fake-openai", model: "telemetry-fixture", usage: { inputTokens: phase === "PLAN" ? 3 : 0, outputTokens: phase === "PLAN" ? 0 : 5 }, estimatedCost: phase === "PLAN" ? 0.01 : 0.02 } }) });
  const result = await f.run();
  assert.equal(result.failureCategory, "TASK_FAILURE");
  assert.equal(result.finalVerdict, "FAIL");
  assert.equal(result.metrics.providerCalls.length, 2);
  assert.equal(result.metrics.inputTokens, 3);
  assert.equal(result.metrics.outputTokens, 5);
  assert.equal(result.metrics.estimatedCost, 0.03);
  assert.equal(result.metrics.contextEvaluation.manifest.mode, "ON");
  assert.deepEqual(result.metrics.contextEvaluation.plan.requestedFiles, ["lib/email.js"]);
});

test("une première validation rouge déclenche une seule réparation bornée", async () => {
  const root = repository({ "lib/email.js": "function normalizeEmail(v) { return v; }\n" }); let validationCount = 0;
  const f = fixture({ root, validations: () => { validationCount += 1; return validationCount === 2 ? "FAIL" : "PASS"; }, reason: ({ phase, files }) => {
    if (phase === "PLAN") return { files: ["lib/email.js"] };
    const file = files.find((item) => item.path === "lib/email.js");
    if (phase === "EDIT") return { operations: [{ type: "MODIFY", path: "lib/email.js", expectedHash: file.hash, search: "return v;", replacement: "return v.trim();" }] };
    return { operations: [{ type: "MODIFY", path: "lib/email.js", expectedHash: file.hash, search: "return v.trim();", replacement: "return v.trim().toLowerCase();" }] };
  } });
  const result = await f.run(); assert.equal(result.finalVerdict, "PASS", JSON.stringify(result)); assert.equal(result.metrics.iterations, 2);
});

test("le maximum d'itérations rend un verdict PARTIAL sans faux succès", async () => {
  const root = repository({ "lib/email.js": "module.exports = (v) => v;\n" });
  const f = fixture({ root, maxIterations: 1, validations: (_command, calls) => calls.some((item) => item.phase === "EDIT") ? "FAIL" : "PASS", reason: ({ phase, files }) => phase === "PLAN" ? { files: ["lib/email.js"] } : { operations: [{ type: "MODIFY", path: "lib/email.js", expectedHash: files[0].hash, search: "=> v", replacement: "=> v.trim()" }] } });
  const result = await f.run(); assert.equal(result.finalVerdict, "PARTIAL"); assert.equal(result.failureCategory, "MAX_ITERATIONS");
});

test("un chemin hors périmètre et une traversée sont refusés avant écriture", async () => {
  const root = repository({ "lib/email.js": "x\n", "other/keep.js": "y\n" });
  for (const target of ["other/keep.js", "../escape.js"]) {
    const f = fixture({ root, allowedPaths: ["lib"], reason: ({ phase, files }) => phase === "PLAN" ? { files: ["lib/email.js"] } : { operations: [{ type: "MODIFY", path: target, expectedHash: files[0].hash, search: "x", replacement: "z" }] } });
    const result = await f.run(); assert.equal(result.finalVerdict, "FAIL"); assert.equal(result.failureCategory, "OUT_OF_SCOPE_CHANGE");
  }
  assert.equal(fs.readFileSync(path.join(root, "other/keep.js"), "utf8"), "y\n");
});

test("un hash stale bloque le patch et préserve le fichier", () => {
  const root = repository({ "lib/a.js": "const a = 1;\n" });
  const contract = createDevTaskContract({ workspaceAuthorized: true, workspaceId: "w", workspaceRoots: [root], repositoryRoot: root, objective: "test" });
  const snapshot = readText(contract, "lib/a.js"); const snapshots = new Map([[snapshot.relative, snapshot]]);
  fs.writeFileSync(path.join(root, "lib/a.js"), "const a = 2;\n");
  assert.throws(() => applyOperation(contract, { type: "MODIFY", path: "lib/a.js", expectedHash: snapshot.hash, search: "1", replacement: "3" }, snapshots), (error) => error.code === "STALE_FILE_STATE");
  assert.equal(fs.readFileSync(path.join(root, "lib/a.js"), "utf8"), "const a = 2;\n");
});

test("une modification locale préexistante dans un autre fichier est conservée", async () => {
  const root = repository({ "lib/email.js": "returnValue = value;\n", "lib/user.js": "const userLine = true;\n" });
  fs.appendFileSync(path.join(root, "lib/user.js"), "const localWork = true;\n");
  const f = fixture({ root, reason: ({ phase, files }) => phase === "PLAN" ? { files: ["lib/email.js"] } : { operations: [{ type: "MODIFY", path: "lib/email.js", expectedHash: files[0].hash, search: "value", replacement: "value.trim()" }] } });
  const result = await f.run(); assert.equal(result.preExistingChangesPreserved, true); assert.match(fs.readFileSync(path.join(root, "lib/user.js"), "utf8"), /localWork/);
});

test("le flag OFF bloque toute analyse et le journal ne conserve aucun contenu source", async () => {
  const root = repository({ "lib/a.js": "PRIVATE_SENTENCE_SHOULD_NOT_BE_JOURNALED\n" });
  const off = fixture({ root, mode: "OFF", reason: () => { throw new Error("not called"); } });
  assert.equal((await off.run()).failureCategory, "FEATURE_DISABLED");
  const on = fixture({ root, reason: ({ phase, files }) => phase === "PLAN" ? { files: ["lib/a.js"] } : { operations: [{ type: "MODIFY", path: "lib/a.js", expectedHash: files[0].hash, search: "PRIVATE_SENTENCE_SHOULD_NOT_BE_JOURNALED", replacement: "safe" }] } });
  await on.run(); const serialized = fs.readFileSync(path.join(on.journalDirectory, fs.readdirSync(on.journalDirectory)[0]), "utf8");
  assert.doesNotMatch(serialized, /PRIVATE_SENTENCE/); assert.match(serialized, /NATIVE_NOON/);
});

test("les commandes dangereuses, installations et arguments de traversal sont refusés", async () => {
  for (const command of ["rm -rf .", "npm install left-pad", "git push", "node --test ../secret.test.js"]) {
    const result = await runSafeCommand(command, process.cwd(), 1000); assert.equal(result.status, "DENIED", command);
  }
});

test("une validation optionnelle refusée par l'allowlist ne devient pas un échec intellectuel", () => {
  assert.equal(isBlockingValidationFailure({ status: "DENIED", failureCategory: "COMMAND_NOT_ALLOWLISTED" }), false);
  assert.equal(isBlockingValidationFailure({ status: "FAIL", failureCategory: "TEST_FAILURE" }), true);
});

test("la récupération d'un journal non terminal exige une décision utilisateur", () => {
  const root = repository({ "lib/a.js": "x\n" }); const f = fixture({ root, reason: () => ({}) });
  f.journal.start({ taskId: "crashed", workspaceId: "w" }, { branch: "main" }); f.journal.transition("crashed", "EDIT", { iteration: 1 });
  assert.deepEqual(f.coordinator.recoverInterrupted(), [{ taskId: "crashed", status: "INTERRUPTED", finalVerdict: "PARTIAL", failureCategory: "PROCESS_RESTARTED", requiresUserDecision: true }]);
});

test("les empreintes sont stables et ne révèlent pas le contenu", () => { assert.equal(digest("a"), digest("a")); assert.notEqual(digest("a"), "a"); });

test("une réponse provider mal formée ou une panne réseau reste un échec explicite", async () => {
  assert.throws(() => normalizeReasoning(null), (error) => error.code === "MALFORMED_PROVIDER_RESPONSE");
  const root = repository({ "lib/a.js": "x\n" });
  const f = fixture({ root, reason: () => { throw Object.assign(new Error("offline"), { code: "NETWORK_FAILURE" }); } });
  const result = await f.run(); assert.equal(result.finalVerdict, "FAIL"); assert.equal(result.failureCategory, "NETWORK_FAILURE");
});

test("le reasoner structuré conserve le domaine DEV et les skills internes restent invisibles au modèle", async () => {
  let request; const reasoner = createNativeDevReasoner({ executeStructured: async (input) => { request = input; return { summary: "ok", files: [], searchTerms: [], operations: [], validationCommands: [] }; } });
  await reasoner.reason({ phase: "PLAN", contract: { objective: "fixture", workspaceId: "w", repositoryRoot: "/repo", allowedPaths: ["/repo"], constraints: [], requiredQuality: "HIGH", maxEstimatedCost: 1 } });
  assert.equal(request.taskDomain, "DEV"); assert.equal(request.requiredQuality, "HIGH"); assert.equal(request.maxEstimatedCost, 1);
  const tools = createSkillRegistry().getToolDefinitions(); assert.equal(tools.some((item) => item.name.startsWith("noon_dev_")), false);
});

test("la façade structurée DEV conserve routing, réservation, appel provider et réconciliation hors de server", async () => {
  const calls = []; const budgetService = {
    snapshot: (...args) => ({ args }), effectiveRemaining: () => 0.5,
    reserve: (input) => { calls.push(["reserve", input]); return { reservationId: "reservation-1" }; },
    reconcile: (...args) => calls.push(["reconcile", ...args]), markUnknown: (...args) => calls.push(["unknown", ...args]),
  };
  const executeStructured = createNativeDevStructuredExecutor({
    featureFlags: { evaluate: () => ({ enabled: true }) }, budgetService,
    selectModelRoute: (input) => { calls.push(["route", input]); return { provider: "openai", model: "fixture-model", effort: "low", verbosity: "low", reasonCodes: ["fixture"] }; },
    estimateCost: () => ({ status: "available", total: 0.1 }), authorizePrivacy: () => "privacy-token",
    providerAdapter: { execute: async (_request, context) => { calls.push(["provider", context]); return { text: '{"summary":"ok"}', provider: "openai", model: "fixture-model", usage: { input_tokens: 1 } }; } },
  });
  const result = await executeStructured({ taskDomain: "DEV", requiredQuality: "NORMAL", maxEstimatedCost: 1, schema: {}, schemaName: "fixture", system: "system", payload: { taskId: "task-1", phase: "PLAN", objective: "fixture" } });
  assert.equal(result.result.summary, "ok"); assert.equal(calls[0][0], "route"); assert.equal(calls[1][0], "reserve"); assert.equal(calls[2][0], "provider"); assert.equal(calls[3][0], "reconcile");
});

test("fixture normalizeEmail : un vrai test rouge est corrigé puis passe", async () => {
  const root = repository({
    "lib/email.js": "exports.normalizeEmail = (value) => value;\n",
    "test/email.test.js": "const test=require('node:test');const assert=require('node:assert/strict');const {normalizeEmail}=require('../lib/email');test('normalize',()=>assert.equal(normalizeEmail(' User@Example.TEST '),'user@example.test'));\n",
  });
  const skillRegistry = createSkillRegistry(); const journal = createDevTaskJournal({ directory: fs.mkdtempSync(path.join(os.tmpdir(), "noon-real-dev-journal-")) });
  const coordinator = createNativeDevCoordinator({
    workspaceEngine: { context: () => ({ roots: [{ path: root, mode: "read-write" }] }) },
    transactionalExecutionEngine: createTransactionalExecutionEngine({ repository: memoryRepository(), skillRegistry }),
    operationalSecurityPolicy: { evaluate: () => ({ outcome: "ALLOW", policyVersion: "test" }) }, skillRegistry, journal, featureMode: () => "LIMITED",
    reasoner: { reason: async ({ phase, files }) => phase === "PLAN" ? { files: ["lib/email.js"] } : { operations: [{ type: "MODIFY", path: "lib/email.js", expectedHash: files[0].hash, search: "value;", replacement: "value.trim().toLowerCase();" }] } },
  });
  const result = await coordinator.runTask({ workspaceId: "w", repositoryRoot: root, objective: "Corriger normalizeEmail", validationCommands: ["node --test test/email.test.js"] });
  assert.equal(result.baseline[0].status, "FAIL"); assert.equal(result.validations[0].status, "PASS"); assert.equal(result.finalVerdict, "PASS");
});

test(
  "PLAN reçoit le manifeste avant sélection et EDIT reçoit les lectures indisponibles sans manifeste",
  async () => {
    const root =
      repository({
        "lib/a.js":
          "module.exports = 1;\n",
      });

    let planManifest =
      null;

    let editUnavailable =
      null;

    const f =
      fixture({
        root,

        reason: ({
          phase,
          preflight,
          files,
          unavailableFiles,
        }) => {
          if (
            phase === "PLAN"
          ) {
            planManifest =
              preflight
                .contextManifest;

            assert.ok(
              planManifest
            );

            assert.ok(
              planManifest.files.some(
                (item) =>
                  item.path ===
                  "lib/a.js"
              )
            );

            return {
              files: [
                "lib/missing.js",
                "lib/a.js",
              ],
            };
          }

          assert.equal(
            Object.hasOwn(
              preflight,
              "contextManifest"
            ),
            false
          );

          editUnavailable =
            unavailableFiles;

          assert.deepEqual(
            unavailableFiles,
            [
              {
                path:
                  "lib/missing.js",

                code:
                  "FILE_UNAVAILABLE",
              },
            ]
          );

          const file =
            files.find(
              (item) =>
                item.path ===
                "lib/a.js"
            );

          return {
            operations: [
              {
                type:
                  "MODIFY",

                path:
                  "lib/a.js",

                expectedHash:
                  file.hash,

                search:
                  "module.exports = 1;",

                replacement:
                  "module.exports = 2;",
              },
            ],
          };
        },
      });

    const result =
      await f.run();

    assert.equal(
      result.finalVerdict,
      "PASS",
      JSON.stringify(result)
    );

    assert.ok(
      planManifest
    );

    assert.deepEqual(
      editUnavailable,
      [
        {
          path:
            "lib/missing.js",

          code:
            "FILE_UNAVAILABLE",
        },
      ]
    );
  }
);

test(
  "NativeDevReasoner sérialise le manifeste et les lectures indisponibles dans son payload borné",
  async () => {
    let request =
      null;

    const reasoner =
      createNativeDevReasoner({
        executeStructured:
          async (input) => {
            request =
              input;

            return {
              summary:
                "ok",

              files: [],

              searchTerms: [],

              operations: [],

              validationCommands:
                [],
            };
          },
      });

    await reasoner.reason({
      phase:
        "PLAN",

      contract: {
        taskId:
          "task-context",

        objective:
          "Analyser",

        workspaceId:
          "workspace-context",

        repositoryRoot:
          "/repo",

        allowedPaths: [
          "/repo",
        ],

        constraints: [],

        projectInstructions:
          [],

        requiredQuality:
          "NORMAL",

        maxEstimatedCost:
          1,
      },

      preflight: {
        branch:
          "main",

        contextManifest: {
          version: 1,

          files: [
            {
              path:
                "lib/a.js",

              extension:
                ".js",

              sizeBytes:
                10,
            },
          ],
        },
      },

      unavailableFiles: [
        {
          path:
            "lib/missing.js",

          code:
            "FILE_UNAVAILABLE",
        },
      ],
    });

    assert.equal(
      request.payload
        .preflight
        .contextManifest
        .version,
      1
    );

    assert.deepEqual(
      request.payload
        .unavailableFiles,
      [
        {
          path:
            "lib/missing.js",

          code:
            "FILE_UNAVAILABLE",
        },
      ]
    );
  }
);

test(
  "Code Context telemetry expose uniquement les métadonnées de sélection initiale",
  async () => {
    const root =
      repository({
        "lib/a.js":
          "module.exports = 1;\n",
      });

    const f =
      fixture({
        root,

        reason: ({
          phase,
          files,
        }) => {
          if (
            phase === "PLAN"
          ) {
            return {
              files: [
                "lib/missing.js",
                "lib/a.js",
              ],

              searchTerms: [
                "module.exports",
              ],
            };
          }

          const file =
            files.find(
              (item) =>
                item.path ===
                "lib/a.js"
            );

          return {
            operations: [
              {
                type:
                  "MODIFY",

                path:
                  "lib/a.js",

                expectedHash:
                  file.hash,

                search:
                  "module.exports = 1;",

                replacement:
                  "module.exports = 2;",
              },
            ],
          };
        },
      });

    const result =
      await f.run();

    assert.equal(
      result.finalVerdict,
      "PASS",
      JSON.stringify(result)
    );

    const telemetry =
      result.metrics
        .contextEvaluation;

    assert.equal(
      result.metrics.inputTokens,
      null
    );

    assert.equal(
      result.metrics.outputTokens,
      null
    );


    assert.equal(
      telemetry.version,
      1
    );

    assert.ok(
      telemetry.manifest
        .fileCount >= 1
    );

    assert.deepEqual(
      telemetry.plan
        .requestedFiles,
      [
        "lib/missing.js",
        "lib/a.js",
      ]
    );

    assert.deepEqual(
      telemetry.plan
        .searchTerms,
      [
        "module.exports",
      ]
    );

    assert.ok(
      telemetry.inspection
        .readFiles
        .includes(
          "lib/a.js"
        )
    );

    assert.deepEqual(
      telemetry.inspection
        .unavailableFiles,
      [
        {
          path:
            "lib/missing.js",

          code:
            "FILE_UNAVAILABLE",
        },
      ]
    );

    assert.ok(
      telemetry.inspection
        .searchResults
        .includes(
          "lib/a.js"
        )
    );

    assert.deepEqual(
      telemetry.execution,
      {
        iterations: 1,
        repairCycles: 0,
      }
    );

    const serialized =
      JSON.stringify(
        telemetry
      );

    assert.doesNotMatch(
      serialized,
      /module\.exports = 1/
    );

    assert.doesNotMatch(
      serialized,
      /"hash"/
    );
  }
);

test(
  "Code Context telemetry compte réellement les cycles de réparation",
  async () => {
    const root =
      repository({
        "lib/email.js":
          "function normalizeEmail(v) { return v; }\n",
      });

    let validationCount =
      0;

    const f =
      fixture({
        root,

        validations:
          () => {
            validationCount += 1;

            return validationCount === 2
              ? "FAIL"
              : "PASS";
          },

        reason: ({
          phase,
          files,
        }) => {
          if (
            phase === "PLAN"
          ) {
            return {
              files: [
                "lib/email.js",
              ],
            };
          }

          const file =
            files.find(
              (item) =>
                item.path ===
                "lib/email.js"
            );

          if (
            phase === "EDIT"
          ) {
            return {
              operations: [
                {
                  type:
                    "MODIFY",

                  path:
                    "lib/email.js",

                  expectedHash:
                    file.hash,

                  search:
                    "return v;",

                  replacement:
                    "return v.trim();",
                },
              ],
            };
          }

          return {
            operations: [
              {
                type:
                  "MODIFY",

                path:
                  "lib/email.js",

                expectedHash:
                  file.hash,

                search:
                  "return v.trim();",

                replacement:
                  "return v.trim().toLowerCase();",
              },
            ],
          };
        },
      });

    const result =
      await f.run();

    assert.equal(
      result.finalVerdict,
      "PASS",
      JSON.stringify(result)
    );

    assert.equal(
      result.metrics.iterations,
      2
    );

    assert.equal(
      result.metrics.repairCycles,
      1
    );

    assert.equal(
      result.metrics
        .contextEvaluation
        .execution
        .repairCycles,
      1
    );
  }
);

test(
  "un champ DEV ordinaire contextManifestMode OFF ne peut pas désactiver le manifeste",
  async () => {
    const root =
      repository({
        "lib/public.js":
          "module.exports = 1;\n",
      });

    const f =
      fixture({
        root,

        reason: ({
          phase,
          files,
        }) => {
          if (
            phase === "PLAN"
          ) {
            return {
              files: [
                "lib/public.js",
              ],
            };
          }

          const file =
            files.find(
              (item) =>
                item.path ===
                "lib/public.js"
            );

          return {
            operations: [
              {
                type:
                  "MODIFY",

                path:
                  "lib/public.js",

                expectedHash:
                  file.hash,

                search:
                  "module.exports = 1;",

                replacement:
                  "module.exports = 2;",
              },
            ],
          };
        },
      });

    const result =
      await f.run({
        contextManifestMode:
          "OFF",
      });

    assert.equal(
      result.finalVerdict,
      "PASS",
      JSON.stringify(result)
    );

    assert.ok(
      f.calls[0]
        .preflight
        .contextManifest
    );

    assert.equal(
      result.metrics
        .contextEvaluation
        .manifest
        .mode,
      "ON"
    );
  }
);

test(
  "la capability benchmark interne peut désactiver le manifeste uniquement au PLAN",
  async () => {
    const {
      CONTEXT_MANIFEST_EXPERIMENT,
    } =
      require(
        "../services/dev/benchmark/context-manifest-experiment"
      );

    const root =
      repository({
        "lib/benchmark.js":
          "module.exports = 1;\n",
      });

    const f =
      fixture({
        root,

        reason: ({
          phase,
          files,
        }) => {
          if (
            phase === "PLAN"
          ) {
            return {
              files: [
                "lib/benchmark.js",
              ],
            };
          }

          const file =
            files.find(
              (item) =>
                item.path ===
                "lib/benchmark.js"
            );

          return {
            operations: [
              {
                type:
                  "MODIFY",

                path:
                  "lib/benchmark.js",

                expectedHash:
                  file.hash,

                search:
                  "module.exports = 1;",

                replacement:
                  "module.exports = 2;",
              },
            ],
          };
        },
      });

    const result =
      await f.run({
        [CONTEXT_MANIFEST_EXPERIMENT]:
          "OFF",

        sessionId:
          "session-context-ab",

        benchmark: {
          id:
            "session-context-ab",

          limitUsd:
            0.5,
        },

        workspaceAuthorized:
          true,

        workspaceRoots: [
          root,
        ],
      });

    assert.equal(
      result.finalVerdict,
      "PASS",
      JSON.stringify(result)
    );

    assert.equal(
      f.calls[0]
        .preflight
        .contextManifest,
      null
    );

    assert.equal(
      f.calls[1]
        .preflight
        .contextManifest,
      undefined
    );

    assert.deepEqual(
      result.metrics
        .contextEvaluation
        .manifest,
      {
        mode:
          "OFF",

        fileCount:
          null,

        scanned:
          null,

        truncated:
          null,

        excluded:
          null,
      }
    );
  }
);

test(
  "la capability interne seule ne peut pas couper le manifeste hors benchmark",
  async () => {
    const {
      CONTEXT_MANIFEST_EXPERIMENT,
    } =
      require(
        "../services/dev/benchmark/context-manifest-experiment"
      );

    const root =
      repository({
        "lib/non-benchmark.js":
          "module.exports = 1;\n",
      });

    const f =
      fixture({
        root,

        reason: ({
          phase,
          files,
        }) => {
          if (
            phase === "PLAN"
          ) {
            return {
              files: [
                "lib/non-benchmark.js",
              ],
            };
          }

          const file =
            files.find(
              (item) =>
                item.path ===
                "lib/non-benchmark.js"
            );

          return {
            operations: [
              {
                type:
                  "MODIFY",

                path:
                  "lib/non-benchmark.js",

                expectedHash:
                  file.hash,

                search:
                  "module.exports = 1;",

                replacement:
                  "module.exports = 2;",
              },
            ],
          };
        },
      });

    const result =
      await f.run({
        [CONTEXT_MANIFEST_EXPERIMENT]:
          "OFF",
      });

    assert.equal(
      result.finalVerdict,
      "PASS",
      JSON.stringify(result)
    );

    assert.ok(
      f.calls[0]
        .preflight
        .contextManifest
    );

    assert.equal(
      result.metrics
        .contextEvaluation
        .manifest
        .mode,
      "ON"
    );
  }
);


test(
  "Context Closure V1 utilise le petit manifeste quand PLAN ne sélectionne aucun fichier",
  async () => {
    const root =
      repository({
        "src/controller.js":
          "module.exports = {};\n",

        "src/service.js":
          "const store=require('./store');module.exports=()=>store.value;\n",

        "src/store.js":
          "module.exports={value:1};\n",

        "test/state.test.js":
          "module.exports={};\n",
      });

    let editFiles =
      [];

    const f =
      fixture({
        root,

        allowedPaths: [
          "src",
          "test",
        ],

        reason: ({
          phase,
          files,
        }) => {
          if (
            phase === "PLAN"
          ) {
            return {
              files: [],
              searchTerms: [],
              operations: [],
            };
          }

          editFiles =
            files.map(
              (item) =>
                item.path
            );

          const service =
            files.find(
              (item) =>
                item.path ===
                "src/service.js"
            );

          assert.ok(service);

          return {
            operations: [
              {
                type:
                  "MODIFY",

                path:
                  "src/service.js",

                expectedHash:
                  service.hash,

                search:
                  "store.value;",

                replacement:
                  "store.value + 1;",
              },
            ],
          };
        },
      });

    const result =
      await f.run();

    assert.equal(
      result.finalVerdict,
      "PASS",
      JSON.stringify(result)
    );

    assert.ok(
      editFiles.includes(
        "src/controller.js"
      )
    );

    assert.ok(
      editFiles.includes(
        "src/service.js"
      )
    );

    assert.ok(
      editFiles.includes(
        "src/store.js"
      )
    );

    assert.ok(
      editFiles.includes(
        "test/state.test.js"
      )
    );

    assert.ok(
      result.metrics
        .contextEvaluation
        .inspection
        .fallbackReadFiles
        .includes(
          "src/service.js"
        )
    );

    assert.ok(
      result.metrics
        .contextEvaluation
        .inspection
        .fallbackReadFiles
        .includes(
          "src/store.js"
        )
    );
  }
);

test(
  "Context Closure V1 lit une dépendance locale directe avant EDIT sans traverser node_modules ou le scope",
  async () => {
    const root =
      repository({
        "src/service.js":
          "const store=require('./store');require('./node_modules/pkg');require('../outside');module.exports=()=>store.value;\n",

        "src/store.js":
          "module.exports={value:1};\n",

        "src/node_modules/pkg.js":
          "module.exports='never-context';\n",

        "outside.js":
          "module.exports='outside';\n",
      });

    let editFiles =
      [];

    const f =
      fixture({
        root,

        allowedPaths: [
          "src",
        ],

        reason: ({
          phase,
          files,
        }) => {
          if (
            phase === "PLAN"
          ) {
            return {
              files: [
                "src/service.js",
              ],

              searchTerms: [],
              operations: [],
            };
          }

          editFiles =
            files.map(
              (item) =>
                item.path
            );

          const service =
            files.find(
              (item) =>
                item.path ===
                "src/service.js"
            );

          return {
            operations: [
              {
                type:
                  "MODIFY",

                path:
                  "src/service.js",

                expectedHash:
                  service.hash,

                search:
                  "store.value;",

                replacement:
                  "store.value + 1;",
              },
            ],
          };
        },
      });

    const result =
      await f.run({
        forbiddenPaths: [
          ".git",
          "node_modules",
        ],
      });

    assert.equal(
      result.finalVerdict,
      "PASS",
      JSON.stringify(result)
    );

    assert.ok(
      editFiles.includes(
        "src/service.js"
      )
    );

    assert.ok(
      editFiles.includes(
        "src/store.js"
      )
    );

    assert.equal(
      editFiles.includes(
        "src/node_modules/pkg.js"
      ),
      false
    );

    assert.equal(
      editFiles.includes(
        "outside.js"
      ),
      false
    );

    assert.deepEqual(
      result.metrics
        .contextEvaluation
        .inspection
        .dependencyReadFiles,
      [
        "src/store.js",
      ]
    );
  }
);

test(
  "Context Closure V1 refuse un EDIT aveugle si aucun code source n'a été lu",
  async () => {
    const {
      CONTEXT_MANIFEST_EXPERIMENT,
    } =
      require(
        "../services/dev/benchmark/context-manifest-experiment"
      );

    const root =
      repository({
        "src/a.js":
          "module.exports=1;\n",
      });

    let reasonerCalls =
      0;

    const f =
      fixture({
        root,

        allowedPaths: [
          "src",
        ],

        reason:
          () => {
            reasonerCalls += 1;

            return {
              files: [],
              searchTerms: [],
              operations: [],
            };
          },
      });

    const result =
      await f.run({
        [CONTEXT_MANIFEST_EXPERIMENT]:
          "OFF",

        sessionId:
          "session-zero-context",

        benchmark: {
          id:
            "session-zero-context",

          limitUsd:
            0.5,
        },

        workspaceAuthorized:
          true,

        workspaceRoots: [
          root,
        ],
      });

    assert.equal(
      result.finalVerdict,
      "FAIL"
    );

    assert.equal(
      result.failureCategory,
      "SOURCE_CONTEXT_REQUIRED"
    );

    assert.equal(
      reasonerCalls,
      1
    );

    assert.equal(
      fs.readFileSync(
        path.join(
          root,
          "src/a.js"
        ),
        "utf8"
      ),
      "module.exports=1;\n"
    );
  }
);


test(
  "DEV Core Reliability : PLAN est discovery-only et ne peut jamais fournir le patch appliqué",
  async () => {
    const root =
      repository({
        "lib/a.js":
          "module.exports = 1;\n",
      });

    const phases = [];

    const f =
      fixture({
        root,

        reason: ({
          phase,
          files,
        }) => {
          phases.push(
            phase
          );

          if (
            phase === "PLAN"
          ) {
            return {
              files: [
                "lib/a.js",
              ],

              searchTerms: [],

              operations: [
                {
                  type:
                    "MODIFY",

                  path:
                    "lib/a.js",

                  expectedHash:
                    null,

                  search:
                    "module.exports = 1;",

                  replacement:
                    "module.exports = 999;",
                },
              ],

              validationCommands:
                [],
            };
          }

          assert.equal(
            phase,
            "EDIT"
          );

          const file =
            files.find(
              (item) =>
                item.path ===
                "lib/a.js"
            );

          assert.ok(
            file
          );

          return {
            operations: [
              {
                type:
                  "MODIFY",

                path:
                  "lib/a.js",

                expectedHash:
                  file.hash,

                search:
                  "module.exports = 1;",

                replacement:
                  "module.exports = 2;",
              },
            ],
          };
        },
      });

    const result =
      await f.run();

    assert.equal(
      result.finalVerdict,
      "PASS",
      JSON.stringify(result)
    );

    assert.deepEqual(
      phases,
      [
        "PLAN",
        "EDIT",
      ]
    );

    assert.equal(
      fs.readFileSync(
        path.join(
          root,
          "lib/a.js"
        ),
        "utf8"
      ),
      "module.exports = 2;\n"
    );

    assert.equal(
      result.metrics
        .contextEvaluation
        .plan
        .ignoredOperationsCount,
      1
    );
  }
);


test(
  "DEV Core Reliability : un scope vide autorise CREATE via EDIT mais jamais un MODIFY aveugle",
  async () => {
    const root =
      repository({});

    const phases = [];

    const f =
      fixture({
        root,

        allowedPaths: [
          "src",
        ],

        reason: ({
          phase,
        }) => {
          phases.push(
            phase
          );

          if (
            phase === "PLAN"
          ) {
            return {
              files: [],
              searchTerms: [],

              // Même si PLAN tente une mutation,
              // elle ne doit jamais être exécutée.
              operations: [
                {
                  type:
                    "MODIFY",

                  path:
                    "src/ghost.js",

                  expectedHash:
                    null,

                  search:
                    "ghost",

                  replacement:
                    "invalid",
                },
              ],

              validationCommands:
                [],
            };
          }

          assert.equal(
            phase,
            "EDIT"
          );

          return {
            operations: [
              {
                type:
                  "CREATE",

                path:
                  "src/App.js",

                expectedHash:
                  null,

                search:
                  null,

                replacement:
                  null,

                content:
                  "module.exports = 'created';\n",
              },
            ],
          };
        },
      });

    const result =
      await f.run({
        objective:
          "Créer src/App.js",
      });

    assert.equal(
      result.finalVerdict,
      "PASS",
      JSON.stringify(result)
    );

    assert.deepEqual(
      phases,
      [
        "PLAN",
        "EDIT",
      ]
    );

    assert.equal(
      fs.readFileSync(
        path.join(
          root,
          "src/App.js"
        ),
        "utf8"
      ),
      "module.exports = 'created';\n"
    );

    assert.equal(
      fs.existsSync(
        path.join(
          root,
          "src/ghost.js"
        )
      ),
      false
    );
  }
);

test(
  "DEV Core Reliability : un scope vide refuse encore MODIFY produit par EDIT",
  async () => {
    const root =
      repository({});

    const f =
      fixture({
        root,

        allowedPaths: [
          "src",
        ],

        reason: ({
          phase,
        }) => {
          if (
            phase === "PLAN"
          ) {
            return {
              files: [],
              searchTerms: [],
              operations: [],
              validationCommands:
                [],
            };
          }

          return {
            operations: [
              {
                type:
                  "MODIFY",

                path:
                  "src/missing.js",

                expectedHash:
                  null,

                search:
                  "x",

                replacement:
                  "y",
              },
            ],
          };
        },
      });

    const result =
      await f.run({
        objective:
          "Modifier src/missing.js",
      });

    assert.equal(
      result.finalVerdict,
      "FAIL"
    );

    assert.equal(
      result.failureCategory,
      "SOURCE_CONTEXT_REQUIRED"
    );

    assert.equal(
      fs.existsSync(
        path.join(
          root,
          "src/missing.js"
        )
      ),
      false
    );
  }
);


test(
  "DEV Core Reliability : Patch Preflight refuse tout le batch avant écriture si une opération ultérieure est invalide",
  async () => {
    const root =
      repository({
        "lib/a.js":
          "module.exports = 1;\n",

        "lib/b.js":
          "module.exports = 10;\n",
      });

    const f =
      fixture({
        root,

        reason: ({
          phase,
          files,
        }) => {
          if (
            phase === "PLAN"
          ) {
            return {
              files: [
                "lib/a.js",
                "lib/b.js",
              ],

              searchTerms: [],
              operations: [],
              validationCommands:
                [],
            };
          }

          const a =
            files.find(
              (item) =>
                item.path ===
                "lib/a.js"
            );

          const b =
            files.find(
              (item) =>
                item.path ===
                "lib/b.js"
            );

          assert.ok(a);
          assert.ok(b);

          return {
            operations: [
              {
                type:
                  "MODIFY",

                path:
                  "lib/a.js",

                expectedHash:
                  a.hash,

                search:
                  "module.exports = 1;",

                replacement:
                  "module.exports = 2;",
              },

              {
                type:
                  "MODIFY",

                path:
                  "lib/b.js",

                expectedHash:
                  b.hash,

                search:
                  "texte inexistant",

                replacement:
                  "module.exports = 20;",
              },
            ],
          };
        },
      });

    const result =
      await f.run();

    assert.equal(
      result.finalVerdict,
      "FAIL"
    );

    assert.equal(
      result.failureCategory,
      "PATCH_PRECONDITION_FAILED"
    );

    assert.equal(
      fs.readFileSync(
        path.join(
          root,
          "lib/a.js"
        ),
        "utf8"
      ),
      "module.exports = 1;\n"
    );

    assert.equal(
      fs.readFileSync(
        path.join(
          root,
          "lib/b.js"
        ),
        "utf8"
      ),
      "module.exports = 10;\n"
    );
  }
);

test(
  "DEV Core Reliability : Patch Preflight refuse deux opérations sur la même cible avant toute écriture",
  async () => {
    const root =
      repository({
        "lib/a.js":
          "module.exports = 1;\n",
      });

    const f =
      fixture({
        root,

        reason: ({
          phase,
          files,
        }) => {
          if (
            phase === "PLAN"
          ) {
            return {
              files: [
                "lib/a.js",
              ],

              searchTerms: [],
              operations: [],
              validationCommands:
                [],
            };
          }

          const file =
            files.find(
              (item) =>
                item.path ===
                "lib/a.js"
            );

          assert.ok(file);

          return {
            operations: [
              {
                type:
                  "MODIFY",

                path:
                  "lib/a.js",

                expectedHash:
                  file.hash,

                search:
                  "module.exports = 1;",

                replacement:
                  "module.exports = 2;",
              },

              {
                type:
                  "MODIFY",

                path:
                  "./lib/a.js",

                expectedHash:
                  file.hash,

                search:
                  "module.exports = 1;",

                replacement:
                  "module.exports = 3;",
              },
            ],
          };
        },
      });

    const result =
      await f.run();

    assert.equal(
      result.finalVerdict,
      "FAIL"
    );

    assert.equal(
      result.failureCategory,
      "DUPLICATE_EDIT_TARGET"
    );

    assert.equal(
      fs.readFileSync(
        path.join(
          root,
          "lib/a.js"
        ),
        "utf8"
      ),
      "module.exports = 1;\n"
    );
  }
);


test(
  "DEV Core Reliability : Patch Compensation restaure les écritures Noon si un futur fichier change pendant le batch",
  async () => {
    const root =
      repository({
        "lib/a.js":
          "module.exports = 1;\n",

        "lib/b.js":
          "module.exports = 10;\n",
      });

    let writeChecks =
      0;

    let injected =
      false;

    const securityPolicy = {
      evaluate({
        actionRequest,
      }) {
        if (
          actionRequest
            ?.actionClass ===
          "WRITE"
        ) {
          writeChecks +=
            1;

          // Deux checks preflight,
          // deux checks pour l'écriture de A,
          // puis l'autorisation initiale de B.
          if (
            writeChecks ===
              5 &&
            !injected
          ) {
            injected =
              true;

            fs.writeFileSync(
              path.join(
                root,
                "lib/b.js"
              ),
              "module.exports = 999;\n"
            );
          }
        }

        return {
          outcome:
            "ALLOW",

          policyVersion:
            "test",
        };
      },
    };

    const f =
      fixture({
        root,
        securityPolicy,

        reason: ({
          phase,
          files,
        }) => {
          if (
            phase === "PLAN"
          ) {
            return {
              files: [
                "lib/a.js",
                "lib/b.js",
              ],

              searchTerms: [],
              operations: [],
              validationCommands:
                [],
            };
          }

          const a =
            files.find(
              (item) =>
                item.path ===
                "lib/a.js"
            );

          const b =
            files.find(
              (item) =>
                item.path ===
                "lib/b.js"
            );

          return {
            operations: [
              {
                type:
                  "MODIFY",

                path:
                  "lib/a.js",

                expectedHash:
                  a.hash,

                search:
                  "module.exports = 1;",

                replacement:
                  "module.exports = 2;",
              },

              {
                type:
                  "MODIFY",

                path:
                  "lib/b.js",

                expectedHash:
                  b.hash,

                search:
                  "module.exports = 10;",

                replacement:
                  "module.exports = 20;",
              },
            ],
          };
        },
      });

    const result =
      await f.run();

    assert.equal(
      result.finalVerdict,
      "FAIL"
    );

    assert.equal(
      result.failureCategory,
      "TRANSACTION_FAILED"
    );

    // A avait été modifié par Noon :
    // il doit revenir à son état initial.
    assert.equal(
      fs.readFileSync(
        path.join(
          root,
          "lib/a.js"
        ),
        "utf8"
      ),
      "module.exports = 1;\n"
    );

    // B a été modifié extérieurement :
    // Noon ne doit jamais l'écraser.
    assert.equal(
      fs.readFileSync(
        path.join(
          root,
          "lib/b.js"
        ),
        "utf8"
      ),
      "module.exports = 999;\n"
    );

    const journal =
      f.journal.load(
        result.taskId
      );

    assert.ok(
      journal.fileOperations.some(
        (item) =>
          item.path ===
            "lib/a.js" &&
          item.status ===
            "ROLLED_BACK"
      )
    );
  }
);

test(
  "DEV Core Reliability : Patch Compensation refuse de rollback un fichier Noon modifié ensuite par une source externe",
  async () => {
    const root =
      repository({
        "lib/a.js":
          "module.exports = 1;\n",

        "lib/b.js":
          "module.exports = 10;\n",
      });

    let writeChecks =
      0;

    let injected =
      false;

    const securityPolicy = {
      evaluate({
        actionRequest,
      }) {
        if (
          actionRequest
            ?.actionClass ===
          "WRITE"
        ) {
          writeChecks +=
            1;

          if (
            writeChecks ===
              5 &&
            !injected
          ) {
            injected =
              true;

            // A a déjà été écrit par Noon.
            // Une source externe le change ensuite.
            fs.writeFileSync(
              path.join(
                root,
                "lib/a.js"
              ),
              "module.exports = 777;\n"
            );

            // B change aussi afin de faire
            // échouer le reste du batch.
            fs.writeFileSync(
              path.join(
                root,
                "lib/b.js"
              ),
              "module.exports = 999;\n"
            );
          }
        }

        return {
          outcome:
            "ALLOW",

          policyVersion:
            "test",
        };
      },
    };

    const f =
      fixture({
        root,
        securityPolicy,

        reason: ({
          phase,
          files,
        }) => {
          if (
            phase === "PLAN"
          ) {
            return {
              files: [
                "lib/a.js",
                "lib/b.js",
              ],

              searchTerms: [],
              operations: [],
              validationCommands:
                [],
            };
          }

          const a =
            files.find(
              (item) =>
                item.path ===
                "lib/a.js"
            );

          const b =
            files.find(
              (item) =>
                item.path ===
                "lib/b.js"
            );

          return {
            operations: [
              {
                type:
                  "MODIFY",

                path:
                  "lib/a.js",

                expectedHash:
                  a.hash,

                search:
                  "module.exports = 1;",

                replacement:
                  "module.exports = 2;",
              },

              {
                type:
                  "MODIFY",

                path:
                  "lib/b.js",

                expectedHash:
                  b.hash,

                search:
                  "module.exports = 10;",

                replacement:
                  "module.exports = 20;",
              },
            ],
          };
        },
      });

    const result =
      await f.run();

    assert.equal(
      result.finalVerdict,
      "FAIL"
    );

    assert.equal(
      result.failureCategory,
      "PATCH_ROLLBACK_INCOMPLETE"
    );

    // Noon refuse de remplacer le travail
    // externe par son ancienne préimage.
    assert.equal(
      fs.readFileSync(
        path.join(
          root,
          "lib/a.js"
        ),
        "utf8"
      ),
      "module.exports = 777;\n"
    );

    assert.equal(
      fs.readFileSync(
        path.join(
          root,
          "lib/b.js"
        ),
        "utf8"
      ),
      "module.exports = 999;\n"
    );
  }
);
