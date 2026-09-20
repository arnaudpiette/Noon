"use strict";

const crypto = require("node:crypto");

const PILOT_SUITE_VERSION = "benchmark-suite-v1";
const CODEX_PROBE_SUITE_VERSION = "codex-authenticity-probe-v1";
const PILOT_PARTICIPANTS = Object.freeze(["NATIVE_NOON", "CODEX"]);
const PILOT_CAP_USD = 0.5;
const PENDING_ARM_TTL_MS = 20 * 60_000;
const PENDING_STATE = "ARMED_PENDING_SESSION";
const TERMINAL_STATES = new Set(["COMPLETED", "CANCELLED", "EXPIRED", "FAILED"]);
const RUNTIME_FLAG_IDS = Object.freeze(["dev.benchmark", "dev.native-core"]);

function serviceError(message, code, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function createBenchmarkArmingService({
  repository,
  runtimeStateReader,
  now = () => Date.now(),
  createArmId = () => crypto.randomUUID(),
} = {}) {
  if (!repository?.createArm || !repository?.getArm || !repository?.transitionArm || !repository?.listRecoverableArms) {
    throw new TypeError("BenchmarkArmingRepository requis.");
  }
  if (!runtimeStateReader?.read) throw new TypeError("Lecteur d'état runtime requis.");
  if (typeof now !== "function" || typeof createArmId !== "function") throw new TypeError("Horloge et générateur d'identifiant requis.");

  function timestamp() {
    const value = Number(now());
    if (!Number.isFinite(value)) throw serviceError("Horloge benchmark invalide.", "BENCHMARK_ARM_INVALID_CLOCK");
    return value;
  }

  function captureRuntimeState() {
    return Object.fromEntries(RUNTIME_FLAG_IDS.map((flagId) => [flagId, runtimeStateReader.read(flagId)]));
  }

  function armPilot() {
    const createdAtMs = timestamp();
    const createdAt = new Date(createdAtMs).toISOString();
    const armId = String(createArmId());
    if (!armId) throw serviceError("Identifiant d'armement benchmark invalide.", "BENCHMARK_ARM_INVALID_ID");
    return repository.createArm({
      armId,
      suiteVersion: PILOT_SUITE_VERSION,
      state: PENDING_STATE,
      benchmarkSessionId: null,
      approvedCapUsd: PILOT_CAP_USD,
      createdAt,
      expiresAt: new Date(createdAtMs + PENDING_ARM_TTL_MS).toISOString(),
      boundAt: null,
      completedAt: null,
      cancelledAt: null,
      failedAt: null,
      failureReason: null,
      previousRuntimeState: captureRuntimeState(),
      authorizedParticipants: [...PILOT_PARTICIPANTS],
      updatedAt: createdAt,
    });
  }
  function armCodexAuthenticityProbe() {
    const createdAtMs = timestamp(); const createdAt = new Date(createdAtMs).toISOString(); const armId = String(createArmId());
    if (!armId) throw serviceError("Identifiant d'armement benchmark invalide.", "BENCHMARK_ARM_INVALID_ID");
    return repository.createArm({ armId, suiteVersion: CODEX_PROBE_SUITE_VERSION, state: PENDING_STATE, benchmarkSessionId: null, approvedCapUsd: PILOT_CAP_USD, createdAt, expiresAt: new Date(createdAtMs + PENDING_ARM_TTL_MS).toISOString(), boundAt: null, completedAt: null, cancelledAt: null, failedAt: null, failureReason: null, previousRuntimeState: captureRuntimeState(), authorizedParticipants: ["CODEX"], updatedAt: createdAt });
  }

  function expiryTimestamp(arm) {
    const value = Date.parse(arm.expiresAt);
    if (!Number.isFinite(value)) {
      throw serviceError("Expiration d'armement benchmark invalide.", "BENCHMARK_ARM_INVALID_EXPIRY", { armId: arm.armId });
    }
    return value;
  }

  function expireStaleArms() {
    const currentTime = timestamp();
    const expiredArms = [];
    for (const arm of repository.listRecoverableArms()) {
      if (arm.state !== PENDING_STATE) continue;
      if (expiryTimestamp(arm) <= currentTime) {
        expiredArms.push(repository.transitionArm(arm.armId, "EXPIRED", { at: new Date(currentTime).toISOString() }));
      }
    }
    return expiredArms;
  }

  function disarm(armId) {
    const current = repository.getArm(armId);
    if (!current) throw serviceError("Armement benchmark inconnu.", "BENCHMARK_ARM_NOT_FOUND");
    if (TERMINAL_STATES.has(current.state)) return current;
    return repository.transitionArm(current.armId, "CANCELLED", { at: new Date(timestamp()).toISOString() });
  }

  function recoverPersistedArms() {
    expireStaleArms();
    return repository.listRecoverableArms();
  }

  return { armPilot, armCodexAuthenticityProbe, disarm, expireStaleArms, recoverPersistedArms };
}

module.exports = {
  PENDING_ARM_TTL_MS,
  PILOT_CAP_USD,
  PILOT_PARTICIPANTS,
  PILOT_SUITE_VERSION,
  RUNTIME_FLAG_IDS,
  createBenchmarkArmingService,
};
