"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { validateBoundSession } = require("../dev-benchmark-service");

const AUTHORIZATION_TTL_MS = 20 * 60_000;
const AUTHORIZATION_VERSION = 2;
const LEGACY_AUTHORIZATION_VERSION = 1;
const EXECUTORS = new Set(["NATIVE_NOON", "CODEX"]);

function fault(message, code) { return Object.assign(new Error(message), { code }); }
function same(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function realDirectory(value, code) {
  let resolved;
  try { resolved = fs.realpathSync(String(value || "")); } catch { throw fault("Chemin benchmark introuvable.", code); }
  if (!fs.statSync(resolved).isDirectory()) throw fault("Chemin benchmark invalide.", code);
  return resolved;
}
function snapshotFlag(state, flagId) {
  if (!Object.hasOwn(state.flags || {}, flagId)) return { exists: false };
  return { exists: true, value: structuredClone(state.flags[flagId]) };
}
function isPresenceSnapshot(value) {
  return value && typeof value === "object" && typeof value.exists === "boolean" &&
    (!value.exists || Object.hasOwn(value, "value"));
}
function previousValue(record, name) {
  const snapshot = record.previousFlags[name];
  if (record.version === LEGACY_AUTHORIZATION_VERSION) return structuredClone(snapshot || {});
  return snapshot.exists ? structuredClone(snapshot.value) : {};
}
function restoreFlag(state, flagId, record, name) {
  const snapshot = record.previousFlags[name];
  if (record.version === LEGACY_AUTHORIZATION_VERSION || snapshot.exists) state.flags[flagId] = structuredClone(record.version === LEGACY_AUTHORIZATION_VERSION ? (snapshot || {}) : snapshot.value);
  else delete state.flags[flagId];
}

function createBenchmarkRuntimeAuthorizationService({
  runtimeConfig, benchmarkRepository, armingRepository, fixtureRegistry,
  now = () => Date.now(), createAuthorizationId = () => crypto.randomUUID(),
} = {}) {
  if (!runtimeConfig?.state || !runtimeConfig?.replaceState) throw new TypeError("RuntimeConfigService requis.");
  if (!benchmarkRepository?.getSession || !benchmarkRepository?.getRun) throw new TypeError("BenchmarkRepository requis.");
  if (!armingRepository?.getArmBySessionId) throw new TypeError("BenchmarkArmingRepository requis.");
  const fixtureEntries = Object.entries(fixtureRegistry || {});
  if (fixtureEntries.length !== 4) throw new TypeError("Registre canonique des fixtures benchmark requis.");
  const canonicalFixtures = Object.freeze(Object.fromEntries(fixtureEntries.map(([taskId, target]) => [taskId, realDirectory(target, "BENCHMARK_FIXTURE_INVALID")])));

  function timestamp() { const value = Number(now()); if (!Number.isFinite(value)) throw fault("Horloge benchmark invalide.", "BENCHMARK_AUTH_INVALID_CLOCK"); return value; }
  function authorization(state = runtimeConfig.state()) { return state.benchmarkRuntimeAuthorization || null; }
  function validateRecord(record) {
    const supportedVersion = record && [LEGACY_AUTHORIZATION_VERSION, AUTHORIZATION_VERSION].includes(record.version);
    const validSnapshots = record?.version === LEGACY_AUTHORIZATION_VERSION ||
      (isPresenceSnapshot(record?.previousFlags?.benchmark) && isPresenceSnapshot(record?.previousFlags?.native));
    const valid = supportedVersion && typeof record.authorizationId === "string" && typeof record.sessionId === "string" &&
      ["ACTIVE", "REVOKED", "EXPIRED"].includes(record.state) && record.mode === "LIMITED" && typeof record.nativeAllowed === "boolean" && typeof record.codexAllowed === "boolean" &&
      typeof record.workspacePath === "string" && record.fixturePaths && typeof record.fixturePaths === "object" && record.previousFlags && typeof record.previousFlags === "object" &&
      Number.isFinite(Date.parse(record.createdAt)) && Number.isFinite(Date.parse(record.expiresAt)) && validSnapshots;
    if (!valid) throw fault("Autorisation benchmark corrompue.", "BENCHMARK_AUTH_CORRUPT");
    return record;
  }
  function validateSession(sessionId, allowedStates = ["READY"]) {
    const arm = armingRepository.getArmBySessionId(sessionId);
    const validated = validateBoundSession(arm, benchmarkRepository);
    if (!allowedStates.includes(validated.session.state)) throw fault("Session benchmark non éligible.", "BENCHMARK_AUTH_SESSION_INVALID");
    return { arm, ...validated };
  }
  function projectedFlags(state, record) {
    const benchmark = { ...previousValue(record, "benchmark"), mode: "LIMITED", percentage: 0, allowSessions: [record.sessionId], allowWorkspaces: [], benchmarkAuthorizationId: record.authorizationId };
    const native = record.nativeAllowed ? { ...previousValue(record, "native"), mode: "LIMITED", percentage: 0, allowSessions: [record.sessionId], allowWorkspaces: [], benchmarkAuthorizationId: record.authorizationId } : previousValue(record, "native");
    return { benchmark, native };
  }
  function persistProjection(record, { event = "benchmark_authorization_changed" } = {}) {
    const state = runtimeConfig.state(); const projection = projectedFlags(state, record);
    state.benchmarkRuntimeAuthorization = structuredClone(record); state.flags["dev.benchmark"] = projection.benchmark; state.flags["dev.native-core"] = projection.native;
    state.configVersion += 1; state.updatedAt = new Date(timestamp()).toISOString(); runtimeConfig.replaceState(state, { event, flagId: "dev.benchmark", origin: "benchmark-arming" }); return record;
  }
  function restore(record, terminalState) {
    const state = runtimeConfig.state(); restoreFlag(state, "dev.benchmark", record, "benchmark"); restoreFlag(state, "dev.native-core", record, "native");
    state.benchmarkRuntimeAuthorization = { ...record, state: terminalState, updatedAt: new Date(timestamp()).toISOString() }; state.configVersion += 1; state.updatedAt = state.benchmarkRuntimeAuthorization.updatedAt;
    runtimeConfig.replaceState(state, { event: "benchmark_authorization_restored", flagId: "dev.benchmark", origin: "benchmark-arming" }); return state.benchmarkRuntimeAuthorization;
  }
  function activate({ sessionId, workspacePath, nativeAllowed = true, codexAllowed = true } = {}) {
    const id = String(sessionId || ""); if (!id) throw fault("Session benchmark requise.", "BENCHMARK_AUTH_SESSION_REQUIRED"); validateSession(id);
    const workspace = realDirectory(workspacePath, "BENCHMARK_WORKSPACE_INVALID"); const current = authorization();
    if (current) {
      const existing = validateRecord(current);
      if (existing.state === "ACTIVE" && Date.parse(existing.expiresAt) > timestamp()) {
        if (existing.sessionId === id && existing.workspacePath === workspace && existing.nativeAllowed === nativeAllowed && existing.codexAllowed === codexAllowed) return existing;
        throw fault("Une autorisation benchmark différente est déjà active.", "BENCHMARK_AUTH_ACTIVE_EXISTS");
      }
      if (existing.state === "ACTIVE") restore(existing, "EXPIRED");
    }
    const state = runtimeConfig.state(); const createdAtMs = timestamp();
    const record = { version: AUTHORIZATION_VERSION, authorizationId: String(createAuthorizationId()), sessionId: id, mode: "LIMITED", state: "ACTIVE", createdAt: new Date(createdAtMs).toISOString(), expiresAt: new Date(createdAtMs + AUTHORIZATION_TTL_MS).toISOString(), updatedAt: new Date(createdAtMs).toISOString(), nativeAllowed: nativeAllowed === true, codexAllowed: codexAllowed === true, workspacePath: workspace, fixturePaths: canonicalFixtures, previousFlags: { benchmark: snapshotFlag(state, "dev.benchmark"), native: snapshotFlag(state, "dev.native-core") } };
    return persistProjection(record, { event: "benchmark_authorization_activated" });
  }
  function revoke() { const current = authorization(); if (!current) return null; const record = validateRecord(current); if (record.state !== "ACTIVE") return record; return restore(record, "REVOKED"); }
  function expireIfNeeded(record) { if (record.state === "ACTIVE" && Date.parse(record.expiresAt) <= timestamp()) return restore(record, "EXPIRED"); return record; }
  function recover() {
    const current = authorization(); if (!current) return null;
    let record;
    try {
      record = validateRecord(current); record = expireIfNeeded(record); if (record.state !== "ACTIVE") return record;
      validateSession(record.sessionId); realDirectory(record.workspacePath, "BENCHMARK_WORKSPACE_INVALID");
      if (!same(record.fixturePaths, canonicalFixtures)) throw fault("Fixtures d'autorisation incohérentes.", "BENCHMARK_AUTH_CORRUPT");
      return persistProjection(record, { event: "benchmark_authorization_recovered" });
    } catch (error) {
      const state = runtimeConfig.state();
      if (record?.previousFlags) { restoreFlag(state, "dev.benchmark", record, "benchmark"); restoreFlag(state, "dev.native-core", record, "native"); }
      else state.flags["dev.benchmark"] = { mode: "OFF" };
      state.configVersion += 1; runtimeConfig.replaceState(state, { event: "benchmark_authorization_corrupt", flagId: "dev.benchmark", origin: "benchmark-arming" }); throw error;
    }
  }
  function deny(reason) { return { eligible: false, reason }; }
  function canExecuteBenchmarkRun({ sessionId, runId, executor, workspacePath, fixturePath } = {}) {
    let record; try { record = validateRecord(authorization()); } catch { return deny("AUTHORIZATION_MISSING_OR_CORRUPT"); }
    record = expireIfNeeded(record); if (record.state !== "ACTIVE") return deny(`AUTHORIZATION_${record.state}`);
    if (record.sessionId !== String(sessionId || "")) return deny("SESSION_NOT_ALLOWED");
    const state = runtimeConfig.state(); const benchmarkFlag = structuredClone(state.flags?.["dev.benchmark"] || {});
    if (state.killSwitches?.["dev.benchmark"] === true || benchmarkFlag.mode !== "LIMITED" || !benchmarkFlag.allowSessions?.includes(record.sessionId)) return deny("RUNTIME_NOT_LIMITED");
    try { validateSession(record.sessionId, ["READY", "RUNNING"]); } catch { return deny("SESSION_INTEGRITY_INVALID"); }
    const run = benchmarkRepository.getRun(String(runId || "")); if (!run || run.session_id !== record.sessionId) return deny("RUN_SESSION_MISMATCH");
    if (!EXECUTORS.has(executor) || run.participant !== executor) return deny("EXECUTOR_MISMATCH");
    if (executor === "NATIVE_NOON" && !record.nativeAllowed) return deny("NATIVE_NOT_ALLOWED");
    if (executor === "CODEX" && !record.codexAllowed) return deny("CODEX_NOT_ALLOWED");
    if (executor === "NATIVE_NOON") { const nativeFlag = structuredClone(state.flags?.["dev.native-core"] || {}); if (state.killSwitches?.["dev.native-core"] === true || nativeFlag.mode !== "LIMITED" || !nativeFlag.allowSessions?.includes(record.sessionId)) return deny("NATIVE_RUNTIME_NOT_LIMITED"); }
    let workspace; let fixture; try { workspace = realDirectory(workspacePath, "BENCHMARK_WORKSPACE_INVALID"); fixture = realDirectory(fixturePath, "BENCHMARK_FIXTURE_INVALID"); } catch (error) { return deny(error.code); }
    if (workspace !== record.workspacePath) return deny("WORKSPACE_NOT_ALLOWED");
    if (fixture !== record.fixturePaths[run.task_id]) return deny("FIXTURE_NOT_ALLOWED");
    return { eligible: true, reason: "BENCHMARK_LIMITED_AUTHORIZED", authorizationId: record.authorizationId };
  }
  return { activate, canExecuteBenchmarkRun, recover, revoke, current: () => authorization() };
}

module.exports = { AUTHORIZATION_TTL_MS, AUTHORIZATION_VERSION, createBenchmarkRuntimeAuthorizationService };
