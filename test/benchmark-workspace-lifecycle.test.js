"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createConfigRegistry } = require("../services/config/config-registry");
const { createRuntimeConfigService } = require("../services/config/runtime-config-service");
const { createDevDelegationRunner } = require("../services/delegation/dev-delegation-runner");
const { createBenchmarkArmingService } = require("../services/dev/benchmark/benchmark-arming-service");
const { createCodexBenchmarkParticipant } = require("../services/dev/benchmark/codex-benchmark-participant");
const { createBenchmarkFixtureRegistry } = require("../services/dev/benchmark/fixture-registry");
const { createBenchmarkRuntimeAuthorizationService } = require("../services/dev/benchmark/benchmark-runtime-authorization-service");
const { materializeBenchmarkWorkspace } = require("../services/dev/benchmark/benchmark-runtime");
const { createDevBenchmarkService } = require("../services/dev/dev-benchmark-service");
const { createPersonalDatabase } = require("../services/persistence/database");
const { createBenchmarkArmingRepository } = require("../services/persistence/repositories/benchmark-arming-repository");
const { createBenchmarkRepository } = require("../services/persistence/repositories/benchmark-repository");

function copy(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(target)) fs.rmSync(path.join(target, entry), { recursive: true, force: true });
  fs.cpSync(source, target, { recursive: true });
}

function specialist(executeTask) {
  return { id: "codex-offline-double", name: "Codex offline double", isAvailable: async () => true, getCapabilities: () => ({}), executeTask, cancelTask: async () => false, getTaskStatus: async () => null };
}

function setup({ validator, workspaceFactory, agentExecute } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noon-b12-"));
  const database = createPersonalDatabase(path.join(root, "noon.sqlite"));
  const repository = createBenchmarkRepository(database);
  const armingRepository = createBenchmarkArmingRepository(database);
  const fixtures = createBenchmarkFixtureRegistry();
  const workspace = path.join(root, "workspaces", "session-b12");
  const counters = { native: 0, adapter: 0, provider: 0, budget: 0 };
  const seen = [];
  const runtimeConfig = createRuntimeConfigService({ registry: createConfigRegistry(), filePath: path.join(root, "runtime.json") });
  const arming = createBenchmarkArmingService({ repository: armingRepository, runtimeStateReader: { read: () => ({ mode: "OFF" }) }, createArmId: () => "arm-b12" });
  const preparer = createDevBenchmarkService({ repository, armingRepository, validator: async () => ({}), featureMode: () => "LIMITED", createSessionId: () => "session-b12" });
  const prepared = preparer.prepare({ armId: arming.armPilot().armId });
  fs.mkdirSync(workspace, { recursive: true });
  const authorization = createBenchmarkRuntimeAuthorizationService({ runtimeConfig, benchmarkRepository: repository, armingRepository, fixtureRegistry: fixtures, createAuthorizationId: () => "auth-b12" });
  authorization.activate({ sessionId: prepared.session.id, workspacePath: workspace });
  const agent = specialist(async (contract) => {
    counters.adapter += 1;
    seen.push(contract);
    if (agentExecute) return agentExecute(contract, counters);
    return { taskId: contract.taskId, agent: "codex-offline-double", status: "SUCCESS", summary: "offline", iterations: 1, backend: { invoked: true, startedAt: 1, endedAt: 2, exitCode: 0 } };
  });
  const runner = createDevDelegationRunner({ specialistAgent: agent, validationExecutor: async (command) => ({ command, status: "PASS", durationMs: 0 }) });
  const participants = {
    NATIVE_NOON: { async run(context) { counters.native += 1; fs.writeFileSync(path.join(context.workspace, "native-marker.txt"), "must-not-cross-runs"); return { status: "SUCCESS", repairCycles: 0 }; } },
    CODEX: createCodexBenchmarkParticipant({ runner }),
  };
  const canonicalFactory = (template) => { materializeBenchmarkWorkspace(template, workspace); const peer = fs.mkdtempSync(path.join(root, "peer-")); fs.cpSync(template, peer, { recursive: true }); return { workspace, peer }; };
  let validations = 0;
  const service = createDevBenchmarkService({ repository, armingRepository, runtimeAuthorization: authorization, templates: fixtures, participants, featureMode: () => "LIMITED", workspaceFactory: workspaceFactory || canonicalFactory, validator: validator || (async () => ({ finalValid: ++validations !== 1, securityViolations: validations === 1 ? 1 : 0, failureCategory: validations === 1 ? "SECURITY_VIOLATION" : null })) });
  return { root, database, repository, armingRepository, fixtures, workspace, counters, seen, prepared, authorization, service, canonicalFactory };
}

test("B12 Native puis Codex atteignent deux snapshots successifs", async () => { const f = setup(); assert.equal((await f.service.runNext(f.prepared.session.id)).state, "FAIL"); assert.equal((await f.service.runNext(f.prepared.session.id)).participant, "CODEX"); assert.deepEqual({ native: f.counters.native, adapter: f.counters.adapter }, { native: 1, adapter: 1 }); f.database.close(); });
test("B12 le workspace Codex existe comme répertoire à la frontière adapter", async () => { const f = setup({ agentExecute(contract) { assert.ok(fs.existsSync(contract.repositoryRoot)); assert.ok(fs.statSync(contract.repositoryRoot).isDirectory()); return { taskId: contract.taskId, agent: "codex-offline-double", status: "SUCCESS", backend: { invoked: true, startedAt: 1, endedAt: 2, exitCode: 0 } }; } }); await f.service.runNext(f.prepared.session.id); await f.service.runNext(f.prepared.session.id); f.database.close(); });
test("B12 le snapshot Codex est vierge des mutations Native", async () => { const f = setup({ agentExecute(contract) { assert.equal(fs.existsSync(path.join(contract.repositoryRoot, "native-marker.txt")), false); return { taskId: contract.taskId, agent: "codex-offline-double", status: "SUCCESS", backend: { invoked: true, startedAt: 1, endedAt: 2, exitCode: 0 } }; } }); await f.service.runNext(f.prepared.session.id); await f.service.runNext(f.prepared.session.id); f.database.close(); });
test("B12 la finalisation du run 1 ne supprime pas l'infrastructure du run 2", async () => { const f = setup(); await f.service.runNext(f.prepared.session.id); assert.ok(fs.existsSync(f.workspace)); await f.service.runNext(f.prepared.session.id); assert.ok(fs.existsSync(f.workspace)); f.database.close(); });
test("B12 un FAIL validateur au run 1 laisse le run 2 exécutable", async () => { const f = setup(); const first = await f.service.runNext(f.prepared.session.id); const second = await f.service.runNext(f.prepared.session.id); assert.equal(first.final_verdict, "FAIL"); assert.equal(second.state, "PASS"); f.database.close(); });
test("B12 une violation sécurité finalisée ne détruit pas le prochain snapshot", async () => { const f = setup(); const first = await f.service.runNext(f.prepared.session.id); assert.equal(first.security_violations, 1); await f.service.runNext(f.prepared.session.id); assert.equal(f.counters.adapter, 1); f.database.close(); });
test("B12 un workspace absent échoue avant tout participant", async () => { const f = setup({ workspaceFactory(template) { const missing = path.join(os.tmpdir(), "noon-b12-missing", "absent"); const peer = fs.mkdtempSync(path.join(os.tmpdir(), "noon-b12-peer-")); fs.cpSync(template, peer, { recursive: true }); return { workspace: missing, peer }; } }); await assert.rejects(f.service.runNext(f.prepared.session.id), (error) => error.code === "BENCHMARK_WORKSPACE_INVALID"); assert.deepEqual(f.counters, { native: 0, adapter: 0, provider: 0, budget: 0 }); f.database.close(); });
test("B12 un realpath différent est refusé par B2", async () => { const f = setup(); const other = fs.mkdtempSync(path.join(f.root, "other-")); const service = createDevBenchmarkService({ repository: f.repository, armingRepository: f.armingRepository, runtimeAuthorization: f.authorization, templates: f.fixtures, participants: { NATIVE_NOON: { run: async () => { f.counters.native += 1; } } }, validator: async () => ({ finalValid: true }), featureMode: () => "LIMITED", workspaceFactory(template) { copy(template, other); const peer = fs.mkdtempSync(path.join(f.root, "peer-wrong-")); fs.cpSync(template, peer, { recursive: true }); return { workspace: other, peer }; } }); await assert.rejects(service.runNext(f.prepared.session.id), (error) => error.code === "BENCHMARK_EXECUTION_DENIED" && error.reason === "WORKSPACE_NOT_ALLOWED"); assert.equal(f.counters.native, 0); f.database.close(); });
test("B12 une fixture copiée incomplète est refusée avant participant", async () => { const f = setup({ workspaceFactory(template) { const corrupt = path.join(f.root, "corrupt"); copy(template, corrupt); fs.rmSync(path.join(corrupt, fs.readdirSync(corrupt)[0]), { recursive: true, force: true }); const peer = fs.mkdtempSync(path.join(f.root, "peer-corrupt-")); fs.cpSync(template, peer, { recursive: true }); return { workspace: corrupt, peer }; } }); await assert.rejects(f.service.runNext(f.prepared.session.id), (error) => error.code === "BENCHMARK_INVALID_START_STATE"); assert.equal(f.counters.native, 0); f.database.close(); });
test("B12 l'adapter reçoit le realpath canonique autorisé et aucun coût", async () => { const f = setup(); await f.service.runNext(f.prepared.session.id); await f.service.runNext(f.prepared.session.id); assert.equal(f.seen.length, 1); assert.equal(f.seen[0].repositoryRoot, fs.realpathSync(f.authorization.current().workspacePath)); assert.equal(f.seen[0].workspaceId, f.prepared.runs[1].id); assert.deepEqual({ provider: f.counters.provider, budget: f.counters.budget }, { provider: 0, budget: 0 }); f.database.close(); });
