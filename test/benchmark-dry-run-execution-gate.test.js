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
const { createBenchmarkFixtureRegistry } = require("../services/dev/benchmark/fixture-registry");
const { createGlobalBenchmarkValidator } = require("../services/dev/benchmark/global-benchmark-validator");
const { createDevBenchmarkService } = require("../services/dev/dev-benchmark-service");
const { createPersonalDatabase, SCHEMA_VERSION } = require("../services/persistence/database");
const { createBenchmarkArmingRepository } = require("../services/persistence/repositories/benchmark-arming-repository");
const { createBenchmarkRepository } = require("../services/persistence/repositories/benchmark-repository");

const START = Date.parse("2026-09-17T12:00:00.000Z");

function resetSnapshot(source, target) {
  for (const entry of fs.readdirSync(target)) fs.rmSync(path.join(target, entry), { recursive: true, force: true });
  fs.cpSync(source, target, { recursive: true });
}

function setup({ validator, nativeAllowed = true, codexAllowed = true, templateOverride } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noon-b3-"));
  const database = createPersonalDatabase(path.join(root, "noon.sqlite"));
  const repository = createBenchmarkRepository(database);
  const armingRepository = createBenchmarkArmingRepository(database);
  const fixtures = createBenchmarkFixtureRegistry();
  const templates = { ...fixtures, ...(templateOverride || {}) };
  const workspace = fs.mkdtempSync(path.join(root, "workspace-"));
  let clock = START;
  const runtimeConfig = createRuntimeConfigService({ registry: createConfigRegistry(), filePath: path.join(root, "runtime.json"), now: () => clock });
  const initialState = runtimeConfig.state();
  initialState.flags["dev.benchmark"] = { mode: "OFF" };
  initialState.flags["dev.native-core"] = { mode: "OFF" };
  runtimeConfig.replaceState(initialState);
  const beforeFlags = structuredClone(runtimeConfig.state().flags);
  const calls = { native: 0, codex: 0, provider: 0, realNative: 0, realCodex: 0, remoteRouter: 0, spend: 0, validator: 0 };
  const events = [];
  const armingService = createBenchmarkArmingService({ repository: armingRepository, runtimeStateReader: { read: () => "OFF" }, now: () => clock, createArmId: () => "arm-b3" });
  const prepareService = createDevBenchmarkService({ repository, armingRepository, validator: async () => ({}), featureMode: () => "LIMITED", now: () => clock, createSessionId: () => "session-b3" });
  const prepared = prepareService.prepare({ armId: armingService.armPilot().armId });
  const authorization = createBenchmarkRuntimeAuthorizationService({ runtimeConfig, benchmarkRepository: repository, armingRepository, fixtureRegistry: fixtures, now: () => clock, createAuthorizationId: () => "auth-b3" });
  authorization.activate({ sessionId: prepared.session.id, workspacePath: workspace, nativeAllowed, codexAllowed });
  const participants = {
    NATIVE_NOON: { identity: "NATIVE_NOON_TEST_DOUBLE", run: async () => { calls.native += 1; return { status: "SUCCESS", repairCycles: 0, costType: "DRY_RUN", calculatedActualCost: 0 }; } },
    CODEX: { identity: "CODEX_TEST_DOUBLE", run: async () => { calls.codex += 1; return { status: "SUCCESS", repairCycles: 0, costType: "DRY_RUN", calculatedActualCost: 0 }; } },
  };
  const effectiveValidator = validator || (async () => { calls.validator += 1; return { finalValid: true, visibleTests: "PASS", hiddenTests: "PASS" }; });
  const workspaceFactory = (template) => { resetSnapshot(template, workspace); const peer = fs.mkdtempSync(path.join(root, "peer-")); fs.cpSync(template, peer, { recursive: true }); return { workspace, peer }; };
  const makeService = (overrides = {}) => createDevBenchmarkService({ repository, armingRepository, runtimeAuthorization: authorization, templates, participants, validator: effectiveValidator, featureMode: () => "LIMITED", now: () => clock, workspaceFactory, observability: (event, payload) => events.push({ event, payload }), ...overrides });
  return { root, database, repository, armingRepository, fixtures, templates, workspace, runtimeConfig, beforeFlags, prepared, authorization, participants, calls, events, makeService, setClock(value) { clock = value; } };
}

async function deniedWithoutMutation(f, expectedReason) {
  const before = structuredClone(f.repository.getRun(f.prepared.runs[0].id));
  await assert.rejects(f.makeService().runNext(f.prepared.session.id), (error) => error.code === "BENCHMARK_EXECUTION_DENIED" && (!expectedReason || error.reason === expectedReason));
  assert.deepEqual(f.repository.getRun(before.id), before);
  assert.equal(f.calls.native + f.calls.codex, 0);
}

test("run-next refuse sans autorisation et ne mute pas le run", async () => {
  const f = setup(); f.authorization.revoke(); await deniedWithoutMutation(f, "AUTHORIZATION_REVOKED"); f.database.close();
});

test("session allowlist, workspace exact et participant attendu sont revérifiés", async (t) => {
  await t.test("session", async () => { const f = setup(); const state = f.runtimeConfig.state(); state.benchmarkRuntimeAuthorization.sessionId = "other"; f.runtimeConfig.replaceState(state); await deniedWithoutMutation(f, "SESSION_NOT_ALLOWED"); f.database.close(); });
  await t.test("workspace", async () => { const f = setup(); const other = fs.mkdtempSync(path.join(f.root, "other-")); await deniedWithoutMutation({ ...f, makeService: () => f.makeService({ workspaceFactory: (template) => { fs.cpSync(template, other, { recursive: true }); const peer = fs.mkdtempSync(path.join(f.root, "peer-other-")); fs.cpSync(template, peer, { recursive: true }); return { workspace: other, peer }; } }) }, "WORKSPACE_NOT_ALLOWED"); f.database.close(); });
  await t.test("participant", async () => { const f = setup({ nativeAllowed: false }); await deniedWithoutMutation(f, "NATIVE_NOT_ALLOWED"); f.database.close(); });
});

test("fixture non canonique et liaison arm/session incohérente échouent fermées", async (t) => {
  await t.test("fixture", async () => { const wrong = fs.mkdtempSync(path.join(os.tmpdir(), "noon-b3-wrong-fixture-")); fs.writeFileSync(path.join(wrong, "package.json"), "{}"); const f = setup({ templateOverride: { "normalize-email": wrong } }); await deniedWithoutMutation(f, "FIXTURE_NOT_ALLOWED"); f.database.close(); });
  await t.test("binding", async () => { const f = setup(); f.database.database.prepare("UPDATE benchmark_arms SET benchmark_session_id=NULL WHERE arm_id=?").run("arm-b3"); await deniedWithoutMutation(f, "SESSION_INTEGRITY_INVALID"); f.database.close(); });
});

test("expiration puis révocation sont appliquées avant le participant", async (t) => {
  await t.test("expiry", async () => { const f = setup(); f.setClock(START + AUTHORIZATION_TTL_MS); await deniedWithoutMutation(f, "AUTHORIZATION_EXPIRED"); assert.deepEqual(f.runtimeConfig.state().flags, f.beforeFlags); f.database.close(); });
  await t.test("revoke", async () => { const f = setup(); f.authorization.revoke(); await deniedWithoutMutation(f, "AUTHORIZATION_REVOKED"); assert.deepEqual(f.runtimeConfig.state().flags, f.beforeFlags); f.database.close(); });
});

test("un run Native puis le run Codex suivant utilisent seulement le double attendu", async () => {
  const f = setup(); const service = f.makeService();
  assert.equal((await service.runNext(f.prepared.session.id)).state, "PASS"); assert.deepEqual({ native: f.calls.native, codex: f.calls.codex }, { native: 1, codex: 0 });
  assert.equal((await service.runNext(f.prepared.session.id)).state, "PASS"); assert.deepEqual({ native: f.calls.native, codex: f.calls.codex }, { native: 1, codex: 1 });
  assert.equal(f.repository.getRun(f.prepared.runs[0].id).resultFinalized, true); f.database.close();
});

test("le validateur global reste autoritaire face au succès déclaré par le double", async () => {
  let validatorCalls = 0;
  const globalValidator = createGlobalBenchmarkValidator({ resolveHiddenValidator: () => async () => ({ status: "FAIL", failureCategory: "HIDDEN_VALIDATION_FAILURE" }), runCommand: () => "PASS" });
  const f = setup({ validator: async (input) => { validatorCalls += 1; return globalValidator(input); } });
  const result = await f.makeService().runNext(f.prepared.session.id);
  assert.equal(result.state, "FAIL"); assert.equal(result.final_verdict, "FAIL"); assert.equal(validatorCalls, 1); assert.equal(f.calls.native, 1); f.database.close();
});

test("une exception participant ne déclenche aucun fallback et nettoie l'autorisation", async () => {
  const f = setup(); f.participants.NATIVE_NOON.run = async () => { f.calls.native += 1; throw Object.assign(new Error("double failure"), { code: "DOUBLE_FAILURE" }); };
  const result = await f.makeService().runNext(f.prepared.session.id);
  assert.equal(result.state, "INFRASTRUCTURE_BLOCKED"); assert.deepEqual({ native: f.calls.native, codex: f.calls.codex }, { native: 1, codex: 0 });
  assert.equal(f.repository.getSession(f.prepared.session.id).state, "FAILED"); assert.equal(f.armingRepository.getArm("arm-b3").state, "FAILED"); assert.deepEqual(f.runtimeConfig.state().flags, f.beforeFlags); f.database.close();
});

test("chaque run-next exécute un seul run et ne duplique jamais un run terminal", async () => {
  const f = setup(); const service = f.makeService(); const first = await service.runNext(f.prepared.session.id); const callsAfterFirst = f.calls.native + f.calls.codex;
  const second = await service.runNext(f.prepared.session.id);
  assert.notEqual(second.id, first.id); assert.equal(f.calls.native + f.calls.codex, callsAfterFirst + 1); assert.equal(f.repository.getRun(first.id).resultFinalized, true); f.database.close();
});

test("les huit runs secs respectent l'ordre, terminent l'arm et restaurent exactement RuntimeConfig", async () => {
  const f = setup(); const service = f.makeService(); const executed = [];
  for (let index = 0; index < 8; index += 1) { const run = await service.runNext(f.prepared.session.id); executed.push(`${run.task_id}:${run.participant}`); }
  assert.deepEqual(executed, ["normalize-email:NATIVE_NOON","normalize-email:CODEX","slugify-title:CODEX","slugify-title:NATIVE_NOON","backend-user-update:NATIVE_NOON","backend-user-update:CODEX","multifile-state-flow:CODEX","multifile-state-flow:NATIVE_NOON"]);
  assert.deepEqual({ native: f.calls.native, codex: f.calls.codex }, { native: 4, codex: 4 }); assert.equal(f.repository.getSession(f.prepared.session.id).state, "COMPLETED"); assert.equal(f.armingRepository.getArm("arm-b3").state, "COMPLETED");
  assert.deepEqual(f.runtimeConfig.state().flags, f.beforeFlags); assert.equal(f.authorization.current().state, "REVOKED"); assert.deepEqual({ provider: f.calls.provider, realNative: f.calls.realNative, realCodex: f.calls.realCodex, remoteRouter: f.calls.remoteRouter, spend: f.calls.spend }, { provider: 0, realNative: 0, realCodex: 0, remoteRouter: 0, spend: 0 });
  assert.ok(["benchmark_authorization_granted","benchmark_participant_selected","benchmark_validator_result","benchmark_run_finalized","benchmark_authorization_restored"].every((name) => f.events.some(({ event }) => event === name))); f.database.close();
});

test("annuler restaure l'état exact et interdit toute reprise automatique", async () => {
  const f = setup(); const service = f.makeService(); await service.cancelBenchmark(f.prepared.session.id);
  assert.equal(f.repository.getSession(f.prepared.session.id).state, "CANCELLED"); assert.equal(f.armingRepository.getArm("arm-b3").state, "CANCELLED"); assert.deepEqual(f.runtimeConfig.state().flags, f.beforeFlags); assert.equal(await service.runNext(f.prepared.session.id), null); assert.equal(f.calls.native + f.calls.codex, 0); f.database.close();
});

test("un redémarrage récupère sans auto-exécuter, puis expire ou refuse la corruption", async (t) => {
  await t.test("valid", () => { const f = setup(); const restarted = createRuntimeConfigService({ registry: createConfigRegistry(), filePath: path.join(f.root, "runtime.json"), now: () => START }); const auth = createBenchmarkRuntimeAuthorizationService({ runtimeConfig: restarted, benchmarkRepository: f.repository, armingRepository: f.armingRepository, fixtureRegistry: f.fixtures, now: () => START }); assert.equal(auth.recover().state, "ACTIVE"); f.makeService({ runtimeAuthorization: auth }); assert.equal(f.calls.native + f.calls.codex, 0); f.database.close(); });
  await t.test("expired", async () => { const f = setup(); f.setClock(START + AUTHORIZATION_TTL_MS); const restarted = createRuntimeConfigService({ registry: createConfigRegistry(), filePath: path.join(f.root, "runtime.json"), now: () => START + AUTHORIZATION_TTL_MS }); const auth = createBenchmarkRuntimeAuthorizationService({ runtimeConfig: restarted, benchmarkRepository: f.repository, armingRepository: f.armingRepository, fixtureRegistry: f.fixtures, now: () => START + AUTHORIZATION_TTL_MS }); assert.equal(auth.recover().state, "EXPIRED"); await assert.rejects(f.makeService({ runtimeAuthorization: auth }).runNext(f.prepared.session.id), (error) => error.code === "BENCHMARK_EXECUTION_DENIED"); assert.equal(f.calls.native + f.calls.codex, 0); f.database.close(); });
  await t.test("corrupt", () => { const f = setup(); const state = f.runtimeConfig.state(); state.benchmarkRuntimeAuthorization.fixturePaths = { bad: f.workspace }; f.runtimeConfig.replaceState(state); const restarted = createRuntimeConfigService({ registry: createConfigRegistry(), filePath: path.join(f.root, "runtime.json"), now: () => START }); const auth = createBenchmarkRuntimeAuthorizationService({ runtimeConfig: restarted, benchmarkRepository: f.repository, armingRepository: f.armingRepository, fixtureRegistry: f.fixtures, now: () => START }); assert.throws(() => auth.recover(), (error) => error.code === "BENCHMARK_AUTH_CORRUPT"); assert.equal(f.calls.native + f.calls.codex, 0); f.database.close(); });
});

test("B3 conserve SQLite v15 et une base intègre", () => { const f = setup(); assert.equal(SCHEMA_VERSION, 15); assert.equal(f.database.database.prepare("PRAGMA integrity_check").get().integrity_check, "ok"); f.authorization.revoke(); f.database.close(); });
