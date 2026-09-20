"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createConfigRegistry } = require("../services/config/config-registry");
const { createRuntimeConfigService } = require("../services/config/runtime-config-service");
const { createBenchmarkArmingService } = require("../services/dev/benchmark/benchmark-arming-service");
const { createBenchmarkControlPlane } = require("../services/dev/benchmark/benchmark-control-plane");
const { createBenchmarkRuntimeAuthorizationService } = require("../services/dev/benchmark/benchmark-runtime-authorization-service");
const { createBenchmarkFixtureRegistry } = require("../services/dev/benchmark/fixture-registry");
const { createDevBenchmarkService } = require("../services/dev/dev-benchmark-service");
const { createPersonalDatabase } = require("../services/persistence/database");
const { createBenchmarkArmingRepository } = require("../services/persistence/repositories/benchmark-arming-repository");
const { createBenchmarkRepository } = require("../services/persistence/repositories/benchmark-repository");

const NOW = Date.parse("2026-09-18T08:00:00.000Z");

function setup({ nativeAllowed = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noon-b8-"));
  const database = createPersonalDatabase(path.join(root, "noon.sqlite"));
  const repository = createBenchmarkRepository(database);
  const armingRepository = createBenchmarkArmingRepository(database);
  const runtimeConfig = createRuntimeConfigService({ registry: createConfigRegistry(), filePath: path.join(root, "runtime.json"), now: () => NOW });
  const calls = { service: 0, native: 0, codex: 0, provider: 0, spend: 0 };
  const fixtures = createBenchmarkFixtureRegistry();
  const workspace = fs.mkdtempSync(path.join(root, "workspace-"));
  const arming = createBenchmarkArmingService({ repository: armingRepository, runtimeStateReader: { read: () => "OFF" }, now: () => NOW, createArmId: () => "arm-b8" });
  const preparer = createDevBenchmarkService({ repository, armingRepository, validator: async () => ({}), featureMode: () => "LIMITED", now: () => NOW, createSessionId: () => "session-A" });
  const prepared = preparer.prepare({ armId: arming.armPilot().armId });
  const authorization = createBenchmarkRuntimeAuthorizationService({ runtimeConfig, benchmarkRepository: repository, armingRepository, fixtureRegistry: fixtures, now: () => NOW, createAuthorizationId: () => "auth-b8" });
  authorization.activate({ sessionId: prepared.session.id, workspacePath: workspace, nativeAllowed });
  const participants = {
    NATIVE_NOON: { run: async () => { calls.native += 1; return { status: "SUCCESS", repairCycles: 0, calculatedActualCost: 0 }; } },
    CODEX: { run: async () => { calls.codex += 1; return { status: "SUCCESS", repairCycles: 0, calculatedActualCost: 0 }; } },
  };
  const makeService = (overrides = {}) => createDevBenchmarkService({
    repository, armingRepository, runtimeAuthorization: authorization, templates: fixtures, participants,
    validator: async () => ({ finalValid: true }), featureMode: () => "LIMITED", now: () => NOW,
    workspaceFactory: (template) => { for (const entry of fs.readdirSync(workspace)) fs.rmSync(path.join(workspace, entry), { recursive: true, force: true }); fs.cpSync(template, workspace, { recursive: true }); const peer = fs.mkdtempSync(path.join(root, "peer-")); fs.cpSync(template, peer, { recursive: true }); return { workspace, peer }; },
    ...overrides,
  });
  const service = makeService();
  const runtime = { repository, service: { ...service, runNext: async (id) => { calls.service += 1; return service.runNext(id); } } };
  const contexts = [];
  const control = createBenchmarkControlPlane({ runtime, featureMode: (context) => { contexts.push(context); const flag = runtimeConfig.state().flags["dev.benchmark"]; return flag?.mode === "LIMITED" && flag.allowSessions?.includes(context?.sessionId) ? "LIMITED" : "OFF"; } });
  return { root, database, repository, runtimeConfig, calls, fixtures, workspace, prepared, authorization, makeService, runtime, control, contexts };
}

function close(f) { f.database.close(); fs.rmSync(f.root, { recursive: true, force: true }); }
function snapshot(f) { return structuredClone(f.repository.getRun(f.prepared.runs[0].id)); }
function assertNoParticipant(f) { assert.deepEqual({ native: f.calls.native, codex: f.calls.codex, provider: f.calls.provider, spend: f.calls.spend }, { native: 0, codex: 0, provider: 0, spend: 0 }); }

test("B8 LIMITED transmet la session autorisée au gate et atteint le service", async () => {
  const f = setup(); await f.control.execute("runNext", { sessionId: "session-A" });
  assert.deepEqual(f.contexts, [{ sessionId: "session-A" }]); assert.equal(f.calls.service, 1); assert.equal(f.calls.native, 1); close(f);
});

test("B8 LIMITED refuse une autre session avant DevBenchmarkService", async () => {
  const f = setup(); await assert.rejects(f.control.execute("runNext", { sessionId: "session-B" }), (error) => error.code === "FEATURE_DISABLED");
  assert.deepEqual(f.contexts, [{ sessionId: "session-B" }]); assert.equal(f.calls.service, 0); assertNoParticipant(f); close(f);
});

test("B8 OFF refuse une session syntaxiquement valide", async () => {
  const f = setup(); const state = f.runtimeConfig.state(); state.flags["dev.benchmark"] = { mode: "OFF" }; f.runtimeConfig.replaceState(state);
  await assert.rejects(f.control.execute("runNext", { sessionId: "session-A" }), (error) => error.code === "FEATURE_DISABLED"); assert.equal(f.calls.service, 0); assertNoParticipant(f); close(f);
});

test("B8 conserve le refus B3 d'un workspace non autorisé", async () => {
  const f = setup(); const other = fs.mkdtempSync(path.join(f.root, "other-")); const guarded = f.makeService({ workspaceFactory: (template) => { fs.cpSync(template, other, { recursive: true }); const peer = fs.mkdtempSync(path.join(f.root, "peer-other-")); fs.cpSync(template, peer, { recursive: true }); return { workspace: other, peer }; } }); f.runtime.service.runNext = guarded.runNext;
  await assert.rejects(f.control.execute("runNext", { sessionId: "session-A" }), (error) => error.code === "BENCHMARK_EXECUTION_DENIED" && error.reason === "WORKSPACE_NOT_ALLOWED"); assertNoParticipant(f); close(f);
});

test("B8 conserve le refus B3 d'un participant non autorisé", async () => {
  const f = setup({ nativeAllowed: false });
  await assert.rejects(f.control.execute("runNext", { sessionId: "session-A" }), (error) => error.code === "BENCHMARK_EXECUTION_DENIED" && error.reason === "NATIVE_NOT_ALLOWED"); assertNoParticipant(f); close(f);
});

test("B8 refuse une autorisation révoquée sans participant", async () => {
  const f = setup(); f.authorization.revoke();
  await assert.rejects(f.control.execute("runNext", { sessionId: "session-A" }), (error) => error.code === "FEATURE_DISABLED"); assertNoParticipant(f); close(f);
});

test("B8 un refus control-plane ne mute ni run ni budget", async () => {
  const f = setup(); const before = snapshot(f);
  await assert.rejects(f.control.execute("runNext", { sessionId: "session-B" }), (error) => error.code === "FEATURE_DISABLED");
  assert.deepEqual(f.repository.getRun(before.id), before); assert.deepEqual({ provider: f.calls.provider, spend: f.calls.spend }, { provider: 0, spend: 0 }); close(f);
});
