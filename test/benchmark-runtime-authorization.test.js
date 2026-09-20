"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createConfigRegistry } = require("../services/config/config-registry");
const { createRuntimeConfigService } = require("../services/config/runtime-config-service");
const { createBenchmarkArmingService } = require("../services/dev/benchmark/benchmark-arming-service");
const { AUTHORIZATION_TTL_MS, createBenchmarkRuntimeAuthorizationService } = require("../services/dev/benchmark/benchmark-runtime-authorization-service");
const { createDevBenchmarkService } = require("../services/dev/dev-benchmark-service");
const { createBenchmarkFixtureRegistry } = require("../services/dev/benchmark/fixture-registry");
const { createPersonalDatabase } = require("../services/persistence/database");
const { createBenchmarkArmingRepository } = require("../services/persistence/repositories/benchmark-arming-repository");
const { createBenchmarkRepository } = require("../services/persistence/repositories/benchmark-repository");

const START = Date.parse("2026-09-17T10:00:00.000Z");
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noon-auth-b2-")); const configFile = path.join(root, "runtime.json"); const database = createPersonalDatabase(path.join(root, "noon.sqlite"));
  const benchmarkRepository = createBenchmarkRepository(database); const armingRepository = createBenchmarkArmingRepository(database); let clock = START;
  const runtimeConfig = createRuntimeConfigService({ registry: createConfigRegistry(), filePath: configFile, now: () => clock });
  const armingService = createBenchmarkArmingService({ repository: armingRepository, runtimeStateReader: { read: () => "OFF" }, now: () => clock, createArmId: () => "arm-b2" });
  const prepareService = createDevBenchmarkService({ repository: benchmarkRepository, armingRepository, validator: async () => ({}), featureMode: () => "LIMITED", now: () => clock, createSessionId: () => "session-A" });
  const prepared = prepareService.prepare({ armId: armingService.armPilot().armId }); const workspace = fs.mkdtempSync(path.join(root, "workspace-")); const fixtures = createBenchmarkFixtureRegistry();
  const makeAuthorization = (config = runtimeConfig) => createBenchmarkRuntimeAuthorizationService({ runtimeConfig: config, benchmarkRepository, armingRepository, fixtureRegistry: fixtures, now: () => clock, createAuthorizationId: () => "auth-b2" });
  return { root, configFile, database, benchmarkRepository, armingRepository, runtimeConfig, prepared, workspace, fixtures, makeAuthorization, setClock(value) { clock = value; } };
}
function input(f, runIndex = 0, overrides = {}) { const run = f.prepared.runs[runIndex]; return { sessionId: f.prepared.session.id, runId: run.id, executor: run.participant, workspacePath: f.workspace, fixturePath: f.fixtures[run.task_id], ...overrides }; }

test("une session préparée crée une autorisation LIMITED persistante et idempotente", () => { const f = fixture(); const service = f.makeAuthorization(); const first = service.activate({ sessionId: "session-A", workspacePath: f.workspace }); const version = f.runtimeConfig.state().configVersion; const second = service.activate({ sessionId: "session-A", workspacePath: f.workspace }); assert.deepEqual(second, first); assert.equal(f.runtimeConfig.state().configVersion, version); assert.equal(f.runtimeConfig.state().flags["dev.benchmark"].mode, "LIMITED"); assert.deepEqual(f.runtimeConfig.state().flags["dev.benchmark"].allowSessions, ["session-A"]); f.database.close(); });
test("l'activation refuse une session inconnue ou un workspace inexistant", () => { const f = fixture(); const service = f.makeAuthorization(); assert.throws(() => service.activate({ sessionId: "missing", workspacePath: f.workspace }), (error) => error.code === "BENCHMARK_ARM_BOUND_INTEGRITY_ERROR"); assert.throws(() => service.activate({ sessionId: "session-A", workspacePath: path.join(f.workspace, "missing") }), (error) => error.code === "BENCHMARK_WORKSPACE_INVALID"); f.database.close(); });
test("l'allowlist session refuse une autre session et un run étranger", () => { const f = fixture(); const service = f.makeAuthorization(); service.activate({ sessionId: "session-A", workspacePath: f.workspace }); assert.equal(service.canExecuteBenchmarkRun(input(f, 0, { sessionId: "session-B" })).eligible, false); f.benchmarkRepository.createSession({ id: "session-B", benchmarkId: "other", suiteVersion: "benchmark-suite-v1", idempotencyKey: "other", state: "READY" }, [{ id: "run-B", runIndex: 1, taskId: "normalize-email", participant: "NATIVE_NOON" }]); assert.equal(service.canExecuteBenchmarkRun(input(f, 0, { runId: "run-B" })).reason, "RUN_SESSION_MISMATCH"); f.database.close(); });
test("workspace et fixture doivent correspondre exactement aux chemins canoniques", () => { const f = fixture(); const service = f.makeAuthorization(); service.activate({ sessionId: "session-A", workspacePath: f.workspace }); assert.equal(service.canExecuteBenchmarkRun(input(f)).eligible, true); const other = fs.mkdtempSync(path.join(f.root, "other-")); assert.equal(service.canExecuteBenchmarkRun(input(f, 0, { workspacePath: other })).reason, "WORKSPACE_NOT_ALLOWED"); assert.equal(service.canExecuteBenchmarkRun(input(f, 0, { workspacePath: path.dirname(f.workspace) })).reason, "WORKSPACE_NOT_ALLOWED"); assert.equal(service.canExecuteBenchmarkRun(input(f, 0, { fixturePath: other })).reason, "FIXTURE_NOT_ALLOWED"); f.database.close(); });
test("Native et Codex sont autorisés séparément", async (t) => { for (const permissions of [{ nativeAllowed: true, codexAllowed: false }, { nativeAllowed: false, codexAllowed: true }]) await t.test(JSON.stringify(permissions), () => { const f = fixture(); const service = f.makeAuthorization(); service.activate({ sessionId: "session-A", workspacePath: f.workspace, ...permissions }); const native = service.canExecuteBenchmarkRun(input(f, 0)); const codex = service.canExecuteBenchmarkRun(input(f, 1)); assert.equal(native.eligible, permissions.nativeAllowed); assert.equal(codex.eligible, permissions.codexAllowed); f.database.close(); }); });
test("un exécuteur différent de celui du run est refusé", () => { const f = fixture(); const service = f.makeAuthorization(); service.activate({ sessionId: "session-A", workspacePath: f.workspace }); assert.equal(service.canExecuteBenchmarkRun(input(f, 0, { executor: "CODEX" })).reason, "EXECUTOR_MISMATCH"); f.database.close(); });
test("une corruption du plan après activation et les kill switches échouent fermés", async (t) => {
  await t.test("plan", () => { const f = fixture(); const service = f.makeAuthorization(); service.activate({ sessionId: "session-A", workspacePath: f.workspace }); f.database.database.prepare("UPDATE benchmark_runs SET task_id='other' WHERE id=?").run(f.prepared.runs[0].id); assert.equal(service.canExecuteBenchmarkRun(input(f)).reason, "SESSION_INTEGRITY_INVALID"); f.database.close(); });
  for (const flagId of ["dev.benchmark", "dev.native-core"]) await t.test(flagId, () => { const f = fixture(); const service = f.makeAuthorization(); service.activate({ sessionId: "session-A", workspacePath: f.workspace }); const state = f.runtimeConfig.state(); state.killSwitches[flagId] = true; f.runtimeConfig.replaceState(state); assert.equal(service.canExecuteBenchmarkRun(input(f)).eligible, false); f.database.close(); });
});
test("expiration et révocation restaurent exactement les deux flags", async (t) => {
  for (const mode of ["expiry", "revoke"]) await t.test(mode, () => { const f = fixture(); const state = f.runtimeConfig.state(); state.flags["dev.benchmark"] = { mode: "OFF", marker: "benchmark-before" }; state.flags["dev.native-core"] = { mode: "LIMITED", allowSessions: ["pre-existing"], marker: "native-before" }; state.configVersion += 1; f.runtimeConfig.replaceState(state); const before = structuredClone(f.runtimeConfig.state().flags); const service = f.makeAuthorization(); service.activate({ sessionId: "session-A", workspacePath: f.workspace }); if (mode === "expiry") { f.setClock(START + AUTHORIZATION_TTL_MS); assert.equal(service.canExecuteBenchmarkRun(input(f)).eligible, false); } else { service.revoke(); service.revoke(); } assert.deepEqual(f.runtimeConfig.state().flags["dev.benchmark"], before["dev.benchmark"]); assert.deepEqual(f.runtimeConfig.state().flags["dev.native-core"], before["dev.native-core"]); f.database.close(); });
});
test("un redémarrage récupère une autorisation valide sans exécuter", () => { const f = fixture(); const service = f.makeAuthorization(); service.activate({ sessionId: "session-A", workspacePath: f.workspace }); const restartedConfig = createRuntimeConfigService({ registry: createConfigRegistry(), filePath: f.configFile, now: () => START }); const recovered = f.makeAuthorization(restartedConfig).recover(); assert.equal(recovered.state, "ACTIVE"); assert.equal(restartedConfig.state().flags["dev.benchmark"].mode, "LIMITED"); f.database.close(); });
test("un redémarrage expire une autorisation stale et restaure les flags", () => { const f = fixture(); const service = f.makeAuthorization(); service.activate({ sessionId: "session-A", workspacePath: f.workspace }); f.setClock(START + AUTHORIZATION_TTL_MS); const restartedConfig = createRuntimeConfigService({ registry: createConfigRegistry(), filePath: f.configFile, now: () => START + AUTHORIZATION_TTL_MS }); const recovered = f.makeAuthorization(restartedConfig).recover(); assert.equal(recovered.state, "EXPIRED"); assert.equal(restartedConfig.state().flags["dev.benchmark"]?.mode, undefined); f.database.close(); });
test("un redémarrage avec autorisation corrompue échoue fermé", () => { const f = fixture(); const service = f.makeAuthorization(); service.activate({ sessionId: "session-A", workspacePath: f.workspace }); const state = f.runtimeConfig.state(); state.benchmarkRuntimeAuthorization.fixturePaths = { bad: f.workspace }; f.runtimeConfig.replaceState(state); const restartedConfig = createRuntimeConfigService({ registry: createConfigRegistry(), filePath: f.configFile }); assert.throws(() => f.makeAuthorization(restartedConfig).recover(), (error) => error.code === "BENCHMARK_AUTH_CORRUPT"); assert.notEqual(restartedConfig.state().flags["dev.benchmark"]?.mode, "LIMITED"); f.database.close(); });
test("B2 ne déclenche aucune exécution ni dépense", () => { const f = fixture(); const calls = { provider: 0, native: 0, codex: 0, runs: 0, spend: 0 }; const service = f.makeAuthorization(); service.activate({ sessionId: "session-A", workspacePath: f.workspace }); service.canExecuteBenchmarkRun(input(f)); assert.deepEqual(calls, { provider: 0, native: 0, codex: 0, runs: 0, spend: 0 }); f.database.close(); });

test("B7 capture séparément présence et valeur brute", () => {
  const f = fixture(); const state = f.runtimeConfig.state(); state.flags["dev.native-core"] = { mode: "OFF", marker: "original" }; f.runtimeConfig.replaceState(state);
  const record = f.makeAuthorization().activate({ sessionId: "session-A", workspacePath: f.workspace });
  assert.deepEqual(record.previousFlags.benchmark, { exists: false });
  assert.deepEqual(record.previousFlags.native, { exists: true, value: { mode: "OFF", marker: "original" } }); f.database.close();
});
test("B7 restaure une clé absente en clé absente", () => {
  const f = fixture(); const state = f.runtimeConfig.state(); state.flags["dev.native-core"] = { mode: "OFF" }; f.runtimeConfig.replaceState(state);
  const service = f.makeAuthorization(); service.activate({ sessionId: "session-A", workspacePath: f.workspace }); service.revoke();
  assert.equal(Object.hasOwn(f.runtimeConfig.state().flags, "dev.benchmark"), false); assert.deepEqual(f.runtimeConfig.state().flags["dev.native-core"], { mode: "OFF" }); f.database.close();
});
test("B7 distingue une clé présente vide d'une clé absente", () => {
  const f = fixture(); const state = f.runtimeConfig.state(); state.flags["dev.benchmark"] = {}; f.runtimeConfig.replaceState(state);
  const service = f.makeAuthorization(); service.activate({ sessionId: "session-A", workspacePath: f.workspace }); service.revoke();
  assert.equal(Object.hasOwn(f.runtimeConfig.state().flags, "dev.benchmark"), true); assert.deepEqual(f.runtimeConfig.state().flags["dev.benchmark"], {}); f.database.close();
});
test("B7 restaure exactement une configuration explicite", () => {
  const f = fixture(); const state = f.runtimeConfig.state(); const original = { mode: "OFF", allowSessions: ["kept"], nested: { exact: true } }; state.flags["dev.benchmark"] = original; f.runtimeConfig.replaceState(state);
  const service = f.makeAuthorization(); service.activate({ sessionId: "session-A", workspacePath: f.workspace }); service.revoke(); assert.deepEqual(f.runtimeConfig.state().flags["dev.benchmark"], original); f.database.close();
});
test("B7 restaure atomiquement les deux clés absentes", () => {
  const f = fixture(); const service = f.makeAuthorization(); service.activate({ sessionId: "session-A", workspacePath: f.workspace }); service.revoke(); const flags = f.runtimeConfig.state().flags;
  assert.equal(Object.hasOwn(flags, "dev.benchmark"), false); assert.equal(Object.hasOwn(flags, "dev.native-core"), false); f.database.close();
});
test("B7 ne publie aucun état partiellement restauré si la persistance échoue", () => {
  const f = fixture(); const service = f.makeAuthorization(); service.activate({ sessionId: "session-A", workspacePath: f.workspace }); const active = f.runtimeConfig.state(); let fail = true;
  const failingConfig = { state: () => f.runtimeConfig.state(), replaceState: (...args) => { if (fail) { fail = false; throw Object.assign(new Error("injected"), { code: "INJECTED" }); } return f.runtimeConfig.replaceState(...args); } };
  assert.throws(() => f.makeAuthorization(failingConfig).revoke(), (error) => error.code === "INJECTED"); assert.deepEqual(f.runtimeConfig.state(), active); f.database.close();
});
test("B7 conserve le comportement étroit des snapshots legacy v1", () => {
  const f = fixture(); const service = f.makeAuthorization(); service.activate({ sessionId: "session-A", workspacePath: f.workspace }); const state = f.runtimeConfig.state(); state.benchmarkRuntimeAuthorization.version = 1; state.benchmarkRuntimeAuthorization.previousFlags = { benchmark: {}, native: { mode: "OFF", legacy: true } }; f.runtimeConfig.replaceState(state);
  f.makeAuthorization().revoke(); assert.equal(Object.hasOwn(f.runtimeConfig.state().flags, "dev.benchmark"), true); assert.deepEqual(f.runtimeConfig.state().flags["dev.benchmark"], {}); assert.deepEqual(f.runtimeConfig.state().flags["dev.native-core"], { mode: "OFF", legacy: true }); f.database.close();
});
test("B7 préserve l'absence au redémarrage sans ressusciter l'autorisation", () => {
  const f = fixture(); const service = f.makeAuthorization(); service.activate({ sessionId: "session-A", workspacePath: f.workspace }); service.revoke(); const restarted = createRuntimeConfigService({ registry: createConfigRegistry(), filePath: f.configFile, now: () => START }); const recovered = f.makeAuthorization(restarted).recover();
  assert.equal(Object.hasOwn(restarted.state().flags, "dev.benchmark"), false); assert.equal(recovered.state, "REVOKED"); assert.notEqual(recovered.state, "ACTIVE"); f.database.close();
});
