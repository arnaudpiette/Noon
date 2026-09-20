"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createBenchmarkArmingService, PENDING_ARM_TTL_MS } = require("../services/dev/benchmark/benchmark-arming-service");
const { createPersonalDatabase } = require("../services/persistence/database");
const { createBenchmarkArmingRepository } = require("../services/persistence/repositories/benchmark-arming-repository");

const START = Date.parse("2026-09-17T10:00:00.000Z");

function fixture({ file = null, clock = START, armId = "arm-deterministic", runtimeState = null } = {}) {
  const databaseFile = file || path.join(fs.mkdtempSync(path.join(os.tmpdir(), "noon-arm-service-")), "noon.sqlite");
  const database = createPersonalDatabase(databaseFile);
  const repository = createBenchmarkArmingRepository(database);
  let currentTime = clock;
  const reads = [];
  const writes = [];
  const state = runtimeState || { "dev.benchmark": "LIMITED", "dev.native-core": "OFF" };
  const runtimeStateReader = {
    read(flagId) { reads.push(flagId); return state[flagId]; },
    write(...args) { writes.push(args); },
  };
  let generatedIds = 0;
  const service = createBenchmarkArmingService({
    repository,
    runtimeStateReader,
    now: () => currentTime,
    createArmId: () => (++generatedIds === 1 ? armId : `${armId}-${generatedIds}`),
  });
  return { databaseFile, database, repository, service, reads, writes, setClock(value) { currentTime = value; } };
}

test("armPilot persiste la politique fixe, le TTL et l'état runtime lu", () => {
  const f = fixture();
  const arm = f.service.armPilot({ suiteVersion: "evil", approvedCapUsd: 99, authorizedParticipants: [] });
  assert.equal(arm.armId, "arm-deterministic");
  assert.equal(arm.suiteVersion, "benchmark-suite-v1");
  assert.equal(arm.state, "ARMED_PENDING_SESSION");
  assert.equal(arm.approvedCapUsd, 0.5);
  assert.deepEqual(arm.authorizedParticipants, ["NATIVE_NOON", "CODEX"]);
  assert.equal(arm.createdAt, "2026-09-17T10:00:00.000Z");
  assert.equal(arm.expiresAt, "2026-09-17T10:20:00.000Z");
  assert.deepEqual(arm.previousRuntimeState, { "dev.benchmark": "LIMITED", "dev.native-core": "OFF" });
  assert.deepEqual(f.reads, ["dev.benchmark", "dev.native-core"]);
  assert.deepEqual(f.repository.getArm(arm.armId), arm);
  f.database.close();
});

test("armPilot rejette un second arm actif et préserve le premier", () => {
  const f = fixture(); const first = f.service.armPilot();
  assert.throws(() => f.service.armPilot(), (error) => error.code === "BENCHMARK_ARM_ACTIVE_EXISTS");
  assert.deepEqual(f.repository.getActiveArm(), first); f.database.close();
});

test("expireStaleArms conserve un arm frais", () => {
  const f = fixture(); f.service.armPilot(); f.setClock(START + PENDING_ARM_TTL_MS - 1);
  assert.deepEqual(f.service.expireStaleArms(), []);
  assert.equal(f.repository.getActiveArm().state, "ARMED_PENDING_SESSION"); f.database.close();
});

test("expireStaleArms expire un arm après le TTL sans modifier expiresAt", () => {
  const f = fixture(); const arm = f.service.armPilot(); f.setClock(START + PENDING_ARM_TTL_MS + 1);
  const [expired] = f.service.expireStaleArms();
  assert.equal(expired.state, "EXPIRED"); assert.equal(expired.expiresAt, arm.expiresAt); f.database.close();
});

test("expireStaleArms expire exactement à la frontière du TTL", () => {
  const f = fixture(); f.service.armPilot(); f.setClock(START + PENDING_ARM_TTL_MS);
  assert.equal(f.service.expireStaleArms()[0].state, "EXPIRED"); f.database.close();
});

test("expireStaleArms ne tente pas d'expirer un arm lié", () => {
  const f = fixture(); f.service.armPilot();
  f.repository.bindSessionMetadata("arm-deterministic", "session-1", "2026-09-17T10:01:00.000Z");
  f.setClock(START + PENDING_ARM_TTL_MS + 1);
  assert.deepEqual(f.service.expireStaleArms(), []);
  assert.equal(f.repository.getArm("arm-deterministic").state, "BOUND_TO_SESSION"); f.database.close();
});

test("expireStaleArms échoue fermé sur une expiration inutilisable", () => {
  const f = fixture(); f.service.armPilot();
  f.database.database.prepare("UPDATE benchmark_arms SET expires_at='invalid' WHERE arm_id=?").run("arm-deterministic");
  assert.throws(() => f.service.expireStaleArms(), (error) => error.code === "BENCHMARK_ARM_INVALID_EXPIRY");
  assert.equal(f.repository.getArm("arm-deterministic").state, "ARMED_PENDING_SESSION"); f.database.close();
});

test("disarm annule les arms pending et bound", async (t) => {
  for (const bound of [false, true]) await t.test(bound ? "bound" : "pending", () => {
    const f = fixture(); f.service.armPilot();
    if (bound) f.repository.bindSessionMetadata("arm-deterministic", "session-1", "2026-09-17T10:01:00.000Z");
    const result = f.service.disarm("arm-deterministic");
    assert.equal(result.state, "CANCELLED"); assert.equal(result.cancelledAt, "2026-09-17T10:00:00.000Z"); f.database.close();
  });
});

test("disarm est idempotent pour un arm terminal et refuse un ID inconnu", () => {
  const f = fixture(); f.service.armPilot(); const cancelled = f.service.disarm("arm-deterministic");
  f.setClock(START + 60_000); assert.deepEqual(f.service.disarm("arm-deterministic"), cancelled);
  assert.throws(() => f.service.disarm("missing"), (error) => error.code === "BENCHMARK_ARM_NOT_FOUND"); f.database.close();
});

test("recoverPersistedArms retrouve un pending frais après réouverture sans exécution", () => {
  const f = fixture(); f.service.armPilot(); const file = f.databaseFile; f.database.close();
  const reopened = fixture({ file, clock: START + 1_000 });
  const recovered = reopened.service.recoverPersistedArms();
  assert.deepEqual(recovered.map((arm) => [arm.armId, arm.state]), [["arm-deterministic", "ARMED_PENDING_SESSION"]]);
  reopened.database.close();
});

test("recoverPersistedArms expire un pending stale après réouverture", () => {
  const f = fixture(); f.service.armPilot(); const file = f.databaseFile; f.database.close();
  const reopened = fixture({ file, clock: START + PENDING_ARM_TTL_MS });
  assert.deepEqual(reopened.service.recoverPersistedArms(), []);
  assert.equal(reopened.repository.getArm("arm-deterministic").state, "EXPIRED"); reopened.database.close();
});

test("recoverPersistedArms rapporte un bound sans auto-reprise", () => {
  const f = fixture(); f.service.armPilot();
  f.repository.bindSessionMetadata("arm-deterministic", "session-1", "2026-09-17T10:01:00.000Z");
  const file = f.databaseFile; f.database.close();
  const reopened = fixture({ file, clock: START + PENDING_ARM_TTL_MS });
  const recovered = reopened.service.recoverPersistedArms();
  assert.deepEqual(recovered.map((arm) => [arm.armId, arm.state]), [["arm-deterministic", "BOUND_TO_SESSION"]]);
  reopened.database.close();
});

test("toutes les opérations A2 restent read-only envers la configuration runtime", () => {
  const f = fixture(); f.service.armPilot(); f.service.expireStaleArms();
  f.service.recoverPersistedArms(); f.service.disarm("arm-deterministic");
  assert.equal(f.writes.length, 0); f.database.close();
});
