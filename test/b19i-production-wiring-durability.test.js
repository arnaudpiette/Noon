"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createAuditLog } = require("../services/security/audit-log");
const { createConfigRegistry } = require("../services/config/config-registry");
const { createRuntimeConfigService } = require("../services/config/runtime-config-service");
const { createOperationalSecurityPolicy } = require("../services/security/operational-security-policy");
const { createCodexSpecialistAgent } = require("../services/delegation/codex-specialist-agent");
const { createDevDelegationRunner } = require("../services/delegation/dev-delegation-runner");
const { createBenchmarkRuntime } = require("../services/dev/benchmark/benchmark-runtime");
const { createBenchmarkControlPlane } = require("../services/dev/benchmark/benchmark-control-plane");
const { createPersonalDatabase } = require("../services/persistence/database");

function child(exitCode, signal) {
  const value = new EventEmitter(); value.stdout = new EventEmitter(); value.stderr = new EventEmitter(); value.kill = () => {};
  queueMicrotask(() => value.emit("close", exitCode, signal)); return value;
}

function setup({ probe, exitCode = 0, signal = null }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noon-b19i-"));
  const audit = createAuditLog(path.join(root, "tool-audit.json"));
  const database = createPersonalDatabase(path.join(root, "noon.sqlite"));
  const runtimeConfig = createRuntimeConfigService({ registry: createConfigRegistry(), filePath: path.join(root, "runtime.json") });
  const append = (event, metadata) => audit.append(event, metadata);
  const policy = createOperationalSecurityPolicy({ allowedRootsProvider: () => [], allowedWriteRootsProvider: () => [], observability: append });
  const agent = createCodexSpecialistAgent({ versionProvider: () => probe, spawnProcess: () => child(exitCode, signal), observability: (event, metadata) => append(`dev.${event}`, metadata) });
  const runner = createDevDelegationRunner({ specialistAgent: agent, operationalSecurityPolicy: policy, validationExecutor: async (command) => ({ command, status: "PASS", durationMs: 0 }), observability: (event, metadata) => append(`delegation.${event}`, metadata) });
  const runtime = createBenchmarkRuntime({ database, runtimeConfig, benchmarkWorkspaceRoot: path.join(root, "benchmark-workspaces"), nativeDevCoordinator: { runTask: async () => { throw new Error("Native forbidden"); }, cancelTask: async () => false }, devDelegationRunner: runner, featureMode: ({ sessionId } = {}) => runtimeConfig.state().flags["dev.benchmark"]?.allowSessions?.includes(sessionId) ? "LIMITED" : "OFF", observability: (event, metadata) => append(`dev.${event}`, metadata) });
  const control = createBenchmarkControlPlane({ runtime, featureMode: ({ sessionId } = {}) => runtimeConfig.state().flags["dev.benchmark"]?.allowSessions?.includes(sessionId) ? "LIMITED" : "OFF" });
  return { audit, database, runtime, control };
}

async function execute(options) {
  const fixture = setup(options); const arm = await fixture.control.execute("armCodexProbe", {}); const prepared = await fixture.control.execute("prepareCodexProbe", { armId: arm.armId });
  const result = await fixture.control.execute("runCodexProbe", { sessionId: prepared.session.id });
  const events = fixture.audit.read().filter((entry) => entry.details?.sessionId === prepared.session.id);
  return { ...fixture, sessionId: prepared.session.id, runId: prepared.runs[0].id, result, events };
}

for (const status of ["EXECUTABLE_NOT_FOUND", "VERSION_COMMAND_FAILED", "VERSION_EMPTY", "VERSION_PARSE_FAILED"]) test(`B19I ${status} reaches durable Codex pre-spawn telemetry`, async () => {
  const value = await execute({ probe: { status, version: null } });
  assert.equal(value.result.failure_category, "EXECUTION_NOT_REACHED");
  assert.deepEqual(value.events.filter((entry) => entry.event.startsWith("dev.codex_")).map((entry) => entry.event), ["dev.codex_cli_resolution", "dev.codex_version_probe"]);
  assert.equal(value.events.find((entry) => entry.event === "dev.codex_version_probe").details.result, status);
  assert.equal(value.events.some((entry) => entry.event === "dev.codex_spawn_attempt"), false); value.database.close();
});

for (const [label, exitCode, signal] of [["exit 0", 0, null], ["non-zero", 1, null], ["SIGTERM", null, "SIGTERM"]]) test(`B19I VERSION_OK ${label} preserves durable ordering, identity and terminal result`, async () => {
    const value = await execute({ probe: { status: "VERSION_OK", version: "codex-cli 1" }, exitCode, signal });
    const codex = value.events.filter((entry) => entry.event.startsWith("dev.codex_"));
    assert.deepEqual(codex.map((entry) => entry.event), ["dev.codex_cli_resolution", "dev.codex_version_probe", "dev.codex_spawn_attempt", "dev.codex_spawn_result"]);
    for (const entry of codex) assert.deepEqual([entry.details.sessionId, entry.details.runId, entry.details.taskId, entry.details.participant], [value.sessionId, value.runId, "normalize-email", "CODEX"]);
    const terminal = codex.at(-1).details; assert.equal(terminal.childCreated, true); assert.equal(terminal.exitCode, exitCode); assert.equal(terminal.signal, signal); value.database.close();
});
