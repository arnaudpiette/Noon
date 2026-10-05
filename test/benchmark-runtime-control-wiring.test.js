"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createConfigRegistry } = require("../services/config/config-registry");
const { createRuntimeConfigService } = require("../services/config/runtime-config-service");
const { createBenchmarkControlPlane } = require("../services/dev/benchmark/benchmark-control-plane");
const { createBenchmarkRuntime } = require("../services/dev/benchmark/benchmark-runtime");
const { createPersonalDatabase, SCHEMA_VERSION } = require("../services/persistence/database");
const { CONTEXT_MANIFEST_EXPERIMENT } = require("../services/dev/benchmark/context-manifest-experiment");

function setup(existing = {}) {
  const root = existing.root || fs.mkdtempSync(path.join(os.tmpdir(), "noon-b4-"));
  const databaseFile = existing.databaseFile || path.join(root, "noon.sqlite");
  const configFile = existing.configFile || path.join(root, "runtime.json");
  const database = createPersonalDatabase(databaseFile);
  const runtimeConfig = createRuntimeConfigService({ registry: createConfigRegistry(), filePath: configFile });
  if (!existing.root) {
    const state = runtimeConfig.state();
    state.flags["dev.benchmark"] = { mode: "OFF", marker: "benchmark-before" };
    state.flags["dev.native-core"] = { mode: "LIMITED", allowSessions: ["existing"], marker: "native-before" };
    runtimeConfig.replaceState(state);
  }
  const calls = existing.calls || { native: 0, codex: 0, provider: 0, spend: 0 };
  const runtime = createBenchmarkRuntime({
    database, runtimeConfig, benchmarkWorkspaceRoot: path.join(root, "benchmark-workspaces"), featureMode: ({ sessionId } = {}) => runtimeConfig.state().flags["dev.benchmark"]?.allowSessions?.includes(sessionId) ? "LIMITED" : runtimeConfig.state().flags["dev.benchmark"]?.mode || "OFF",
    nativeDevCoordinator: { runTask: async () => { calls.native += 1; throw new Error("real native forbidden"); }, cancelTask: async () => {} },
    devDelegationRunner: existing.devDelegationRunner || { runDevTask: async () => { calls.codex += 1; throw new Error("real codex forbidden"); }, cancelTask: async () => {} },
  });
  const control = createBenchmarkControlPlane({ runtime, featureMode: (context) => runtime.status().featureMode === "LIMITED" || runtimeConfig.state().flags["dev.benchmark"]?.allowSessions?.includes(context?.sessionId) ? "LIMITED" : "OFF" });
  return { root, databaseFile, configFile, database, runtimeConfig, runtime, control, calls };
}

test("le contrôle arm persiste la politique fixe sans exposer l'état runtime interne", async () => {
  const f = setup(); const arm = await f.control.execute("arm", {});
  assert.equal(arm.state, "ARMED_PENDING_SESSION"); assert.equal(arm.suiteVersion, "benchmark-suite-v1"); assert.equal(arm.approvedCapUsd, 0.5); assert.deepEqual(arm.authorizedParticipants, ["NATIVE_NOON", "CODEX"]); assert.equal("previousRuntimeState" in arm, false);
  assert.equal(Date.parse(arm.expiresAt) - Date.parse(arm.createdAt), 20 * 60_000); assert.equal(f.runtime.armingRepository.getActiveArm().armId, arm.armId); assert.deepEqual(f.calls, { native: 0, codex: 0, provider: 0, spend: 0 }); f.database.close();
});

test("la politique d'armement est non modifiable et un second arm actif est refusé", async () => {
  const f = setup(); await f.control.execute("arm", {});
  for (const body of [{ approvedCapUsd: 999 }, { suiteVersion: "evil" }, { participants: ["OTHER"] }, { state: "COMPLETED" }, { expiresAt: "never" }]) await assert.rejects(f.control.execute("arm", body), (error) => error.code === "BENCHMARK_REQUEST_INVALID");
  await assert.rejects(f.control.execute("arm", {}), (error) => error.code === "BENCHMARK_ARM_ACTIVE_EXISTS"); assert.equal(f.runtime.armingRepository.listRecoverableArms().length, 1); f.database.close();
});

test("prepare exige armId, lie huit runs et active B2 sans exécuter", async () => {
  const f = setup(); await assert.rejects(f.control.execute("prepare", {}), (error) => error.code === "BENCHMARK_ARM_REQUIRED"); await assert.rejects(f.control.execute("prepare", { armId: "unknown" }), (error) => error.code === "BENCHMARK_ARM_NOT_FOUND");
  const arm = await f.control.execute("arm", {}); const prepared = await f.control.execute("prepare", { armId: arm.armId }); const persisted = f.runtime.armingRepository.getArm(arm.armId); const authorization = f.runtime.runtimeAuthorization.current();
  assert.equal(prepared.runs.length, 8); assert.equal(persisted.state, "BOUND_TO_SESSION"); assert.equal(persisted.benchmarkSessionId, prepared.session.id); assert.equal(authorization.state, "ACTIVE"); assert.deepEqual(f.runtimeConfig.state().flags["dev.benchmark"].allowSessions, [prepared.session.id]); assert.equal(Object.keys(authorization.fixturePaths).length, 4); assert.deepEqual(prepared.runs.map((run) => `${run.task_id}:${run.participant}`), ["normalize-email:NATIVE_NOON","normalize-email:CODEX","slugify-title:CODEX","slugify-title:NATIVE_NOON","backend-user-update:NATIVE_NOON","backend-user-update:CODEX","multifile-state-flow:CODEX","multifile-state-flow:NATIVE_NOON"]);
  assert.ok(f.runtime.runtimeAuthorization.canExecuteBenchmarkRun({ sessionId: prepared.session.id, runId: prepared.runs[0].id, executor: "NATIVE_NOON", workspacePath: authorization.workspacePath, fixturePath: authorization.fixturePaths["normalize-email"] }).eligible); assert.equal(f.runtime.runtimeAuthorization.canExecuteBenchmarkRun({ sessionId: "unrelated", runId: prepared.runs[0].id, executor: "NATIVE_NOON", workspacePath: authorization.workspacePath, fixturePath: authorization.fixturePaths["normalize-email"] }).eligible, false);
  assert.ok(prepared.runs.every((run) => run.state === "PENDING")); assert.deepEqual(f.calls, { native: 0, codex: 0, provider: 0, spend: 0 }); f.database.close();
});

test("prepare refuse les champs de politique, workspace et plan", async () => {
  const f = setup(); const arm = await f.control.execute("arm", {});
  for (const key of ["participant", "provider", "model", "workspace", "fixture", "budget", "task", "runPlan", "sessionId"]) await assert.rejects(f.control.execute("prepare", { armId: arm.armId, [key]: "forbidden" }), (error) => error.code === "BENCHMARK_REQUEST_INVALID");
  assert.equal(f.runtime.repository.listSessionRuns("none").length, 0); assert.deepEqual(f.calls, { native: 0, codex: 0, provider: 0, spend: 0 }); f.database.close();
});

test("disarm nettoie un arm pending et impose cancel comme propriétaire d'un arm lié", async () => {
  const pending = setup(); const pendingArm = await pending.control.execute("arm", {}); assert.equal((await pending.control.execute("disarm", { armId: pendingArm.armId })).state, "CANCELLED"); assert.equal(pending.runtime.runtimeAuthorization.current(), null); pending.database.close();
  const bound = setup(); const before = structuredClone(bound.runtimeConfig.state().flags); const arm = await bound.control.execute("arm", {}); const prepared = await bound.control.execute("prepare", { armId: arm.armId }); await assert.rejects(bound.control.execute("disarm", { armId: arm.armId }), (error) => error.code === "BENCHMARK_ARM_BOUND_USE_CANCEL"); const cancelled = await bound.control.execute("cancel", { sessionId: prepared.session.id });
  assert.equal(cancelled.state, "CANCELLED"); assert.equal(bound.runtime.armingRepository.getArm(arm.armId).state, "CANCELLED"); assert.equal(bound.runtime.runtimeAuthorization.current().state, "REVOKED"); assert.deepEqual(bound.runtimeConfig.state().flags, before); assert.deepEqual(bound.calls, { native: 0, codex: 0, provider: 0, spend: 0 }); bound.database.close();
});

test("le redémarrage après cleanup ne ressuscite rien et n'auto-exécute aucun run", async () => {
  let f = setup(); const identity = { root: f.root, databaseFile: f.databaseFile, configFile: f.configFile, calls: f.calls }; const arm = await f.control.execute("arm", {}); const prepared = await f.control.execute("prepare", { armId: arm.armId }); await f.control.execute("cancel", { sessionId: prepared.session.id }); f.database.close();
  f = setup(identity); assert.equal(f.runtime.runtimeAuthorization.current().state, "REVOKED"); assert.equal(f.runtime.repository.getSession(prepared.session.id).state, "CANCELLED"); assert.equal(f.runtime.armingRepository.getArm(arm.armId).state, "CANCELLED"); assert.deepEqual(f.calls, { native: 0, codex: 0, provider: 0, spend: 0 }); f.database.close();
});

test("B4 initialise SQLite au schéma courant et enregistre sa migration", () => {
  const f = setup(); const migration = f.database.database.prepare("SELECT version,name FROM schema_migrations WHERE version=?").get(SCHEMA_VERSION);
  assert.equal(f.database.kind, "sqlite"); assert.equal(migration.version, SCHEMA_VERSION); assert.equal(migration.name, "personal-intelligence-base"); assert.equal(f.database.database.prepare("PRAGMA integrity_check").get().integrity_check, "ok"); for (const name of ["benchmark_arms", "benchmark_sessions", "benchmark_runs"]) assert.ok(f.database.database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name)); f.database.close();
});

test("B19A prépare un unique probe Codex figé sans modifier le pilote", async () => {
  const f = setup(); const canonical = f.control.read("suite"); const arm = await f.control.execute("armCodexProbe", {}); const prepared = await f.control.execute("prepareCodexProbe", { armId: arm.armId }); const authorization = f.runtime.runtimeAuthorization.current();
  assert.equal(arm.suiteVersion, "codex-authenticity-probe-v1"); assert.deepEqual(arm.authorizedParticipants, ["CODEX"]); assert.deepEqual(prepared.runs.map((run) => `${run.task_id}:${run.participant}`), ["normalize-email:CODEX"]); assert.equal(authorization.nativeAllowed, false); assert.equal(authorization.codexAllowed, true);
  assert.ok(f.runtime.runtimeAuthorization.canExecuteBenchmarkRun({ sessionId: prepared.session.id, runId: prepared.runs[0].id, executor: "CODEX", workspacePath: authorization.workspacePath, fixturePath: authorization.fixturePaths["normalize-email"] }).eligible);
  assert.equal(f.runtime.runtimeAuthorization.canExecuteBenchmarkRun({ sessionId: prepared.session.id, runId: prepared.runs[0].id, executor: "NATIVE_NOON", workspacePath: authorization.workspacePath, fixturePath: authorization.fixturePaths["normalize-email"] }).reason, "EXECUTOR_MISMATCH");
  await assert.rejects(f.control.execute("resume", { sessionId: prepared.session.id }), (error) => error.code === "CODEX_PROBE_RETRY_DENIED"); assert.deepEqual(f.control.read("suite"), canonical); assert.deepEqual(f.calls, { native: 0, codex: 0, provider: 0, spend: 0 }); f.database.close();
});

test("B19A refuse session, workspace, reprise et backend non atteint sans Native", async () => {
  const calls = { native: 0, codex: 0, provider: 0, spend: 0 }; const f = setup({ calls, devDelegationRunner: { runDevTask: async () => { calls.codex += 1; return { status: "SUCCESS", metrics: { backend: { invoked: false, exitCode: null }, iterations: 0, changedFilesCount: 0 } }; }, cancelTask: async () => false } });
  const arm = await f.control.execute("armCodexProbe", {}); const prepared = await f.control.execute("prepareCodexProbe", { armId: arm.armId }); const authorization = f.runtime.runtimeAuthorization.current(); const run = prepared.runs[0];
  await assert.rejects(f.control.execute("runCodexProbe", { sessionId: "other" }), (error) => error.code === "CODEX_PROBE_SESSION_INVALID");
  const userRepository = fs.mkdtempSync(path.join(f.root, "user-repository-")); fs.mkdirSync(path.join(userRepository, "src")); assert.equal(f.runtime.runtimeAuthorization.canExecuteBenchmarkRun({ sessionId: prepared.session.id, runId: run.id, executor: "CODEX", workspacePath: userRepository, fixturePath: authorization.fixturePaths["normalize-email"] }).reason, "WORKSPACE_NOT_ALLOWED");
  const symlink = path.join(f.root, "workspace-link"); fs.symlinkSync(userRepository, symlink); assert.equal(f.runtime.runtimeAuthorization.canExecuteBenchmarkRun({ sessionId: prepared.session.id, runId: run.id, executor: "CODEX", workspacePath: symlink, fixturePath: authorization.fixturePaths["normalize-email"] }).reason, "WORKSPACE_NOT_ALLOWED");
  const result = await f.control.execute("runCodexProbe", { sessionId: prepared.session.id }); assert.equal(result.state, "INFRASTRUCTURE_BLOCKED"); assert.equal(result.failure_category, "EXECUTION_NOT_REACHED"); assert.deepEqual(calls, { native: 0, codex: 1, provider: 0, spend: 0 }); f.database.close();
});

test("context A/B compose le runtime et control-plane réels avec fixtures et Native simulés", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noon-context-ab-runtime-")); const fixture = path.join(root, "fixture"); fs.mkdirSync(path.join(fixture, "src"), { recursive: true }); fs.mkdirSync(path.join(fixture, "test"));
  fs.writeFileSync(path.join(fixture, "package.json"), '{"scripts":{"test":"node --test"}}'); fs.writeFileSync(path.join(fixture, "src", "base.js"), "module.exports=true;\n"); fs.writeFileSync(path.join(fixture, "test", "state.test.js"), "");
  const database = createPersonalDatabase(path.join(root, "temporary.sqlite")); const runtimeConfig = createRuntimeConfigService({ registry: createConfigRegistry(), filePath: path.join(root, "runtime.json") }); const calls = [];
  const runtime = createBenchmarkRuntime({ database, runtimeConfig, benchmarkWorkspaceRoot: path.join(root, "workspaces"), templates: Object.fromEntries(["normalize-email", "slugify-title", "backend-user-update", "multifile-state-flow"].map((id) => [id, fixture])), featureMode: ({ sessionId } = {}) => runtimeConfig.state().flags["dev.benchmark"]?.allowSessions?.includes(sessionId) ? "LIMITED" : "OFF", resolveHiddenValidator: () => () => ({ status: "PASS" }), nativeDevCoordinator: { runTask: async (input) => { calls.push(input); fs.writeFileSync(path.join(input.repositoryRoot, "src", `${input[CONTEXT_MANIFEST_EXPERIMENT]}.js`), "module.exports=true;\n"); return { status: "SUCCESS", metrics: { backendReached: true, fileCount: 1, iterations: 1, repairCycles: 0, contextEvaluation: { version: 1, manifest: { mode: input[CONTEXT_MANIFEST_EXPERIMENT], fileCount: 1, scanned: true, truncated: false } }, providerCalls: [] } }; }, cancelTask: async () => {} }, devDelegationRunner: { runDevTask: async () => { throw new Error("CODEX must not run"); }, cancelTask: async () => {} } });
  const control = createBenchmarkControlPlane({ runtime, featureMode: ({ sessionId } = {}) => runtimeConfig.state().flags["dev.benchmark"]?.allowSessions?.includes(sessionId) ? "LIMITED" : "OFF" }); const arm = await control.execute("arm", {}); const prepared = await control.execute("prepare", { armId: arm.armId }); const result = await control.execute("runContextAb", { sessionId: prepared.session.id });
  assert.deepEqual(calls.map((input) => input[CONTEXT_MANIFEST_EXPERIMENT]), ["ON", "OFF"]); assert.deepEqual(calls.map((input) => input.taskId), [`${prepared.session.id}-8-context-ab-on`, `${prepared.session.id}-8-context-ab-off`]); assert.deepEqual(calls.map((input) => input.workspaceId), [`${prepared.session.id}-8-context-ab-on`, `${prepared.session.id}-8-context-ab-off`]); assert.ok(result.variants.ON.finalValid); assert.ok(result.variants.OFF.finalValid); assert.ok(runtime.repository.listSessionRuns(prepared.session.id).every((run) => run.state === "PENDING")); database.close(); fs.rmSync(root, { recursive: true, force: true });
});
