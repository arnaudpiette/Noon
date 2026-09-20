"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createPersonalDatabase } = require("../services/persistence/database");
const { createBenchmarkArmingRepository } = require("../services/persistence/repositories/benchmark-arming-repository");
function fixture() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "noon-arm-repository-")), "noon.sqlite");
  const database = createPersonalDatabase(file);
  return { file, database, repository: createBenchmarkArmingRepository(database) };
}
function arm(overrides = {}) {
  return {
    armId: "arm-1", suiteVersion: "benchmark-suite-v1", state: "ARMED_PENDING_SESSION",
    benchmarkSessionId: null, approvedCapUsd: 0.5,
    createdAt: "2026-09-17T10:00:00.000Z", expiresAt: "2026-09-17T10:20:00.000Z",
    boundAt: null, completedAt: null, cancelledAt: null, failedAt: null, failureReason: null,
    previousRuntimeState: { "dev.benchmark": "OFF", "dev.native-core": "OFF", specialistDelegation: "OFF" },
    authorizedParticipants: ["NATIVE_NOON", "CODEX"], updatedAt: "2026-09-17T10:00:00.000Z",
    ...overrides,
  };
}
test("createArm persiste puis getArm normalise la ligne SQLite", () => {
  const f = fixture(); const created = f.repository.createArm(arm());
  assert.deepEqual(created, arm());
  assert.deepEqual(f.repository.getArm("arm-1"), created); f.database.close();
});
test("getArm retourne null pour un identifiant inconnu", () => {
  const f = fixture(); assert.equal(f.repository.getArm("missing"), null); f.database.close();
});
test("createArm rejette un arm_id dupliqué", () => {
  const f = fixture(); f.repository.createArm(arm());
  assert.throws(() => f.repository.createArm(arm()), /UNIQUE constraint failed/); f.database.close();
});
test("les JSON conservent leur valeur sémantique complète", () => {
  const f = fixture(); const expected = arm(); const actual = f.repository.createArm(expected);
  assert.deepEqual(actual.previousRuntimeState, expected.previousRuntimeState);
  assert.deepEqual(actual.authorizedParticipants, expected.authorizedParticipants); f.database.close();
});
test("les NULL et approved_cap_usd conservent leurs types", () => {
  const f = fixture(); const actual = f.repository.createArm(arm());
  for (const key of ["benchmarkSessionId", "boundAt", "completedAt", "cancelledAt", "failedAt", "failureReason"]) assert.equal(actual[key], null);
  assert.equal(actual.approvedCapUsd, 0.5); assert.equal(typeof actual.approvedCapUsd, "number"); f.database.close();
});
test("un arm persiste après fermeture et réouverture de la même base", () => {
  const f = fixture(); const expected = f.repository.createArm(arm()); f.database.close();
  const reopened = createPersonalDatabase(f.file); const repository = createBenchmarkArmingRepository(reopened);
  assert.deepEqual(repository.getArm("arm-1"), expected); reopened.close();
});
test("un JSON SQLite corrompu échoue fermé avec un code contrôlé", () => {
  const f = fixture(); f.repository.createArm(arm());
  f.database.database.prepare("UPDATE benchmark_arms SET authorized_participants_json=? WHERE arm_id=?").run("{bad", "arm-1");
  assert.throws(() => f.repository.getArm("arm-1"), (error) => error.code === "BENCHMARK_ARM_CORRUPT_JSON" && error.column === "authorized_participants_json");
  f.database.close();
});
test("getActiveArm retourne null puis l'unique arm actif normalisé", () => {
  const f = fixture(); assert.equal(f.repository.getActiveArm(), null);
  f.repository.createArm(arm()); assert.equal(f.repository.getActiveArm().armId, "arm-1");
  f.repository.bindSessionMetadata("arm-1", "session-1", "2026-09-17T10:01:00.000Z");
  assert.equal(f.repository.getActiveArm().state, "BOUND_TO_SESSION"); f.database.close();
});
test("createArm garantit un seul arm actif transactionnellement", () => {
  const f = fixture(); f.repository.createArm(arm());
  assert.throws(() => f.repository.createArm(arm({ armId: "arm-2" })), (error) => error.code === "BENCHMARK_ARM_ACTIVE_EXISTS");
  assert.equal(f.repository.getActiveArm().armId, "arm-1"); f.database.close();
});
test("un historique terminal n'empêche pas un nouvel arm actif", () => {
  const f = fixture(); f.repository.createArm(arm({ state: "COMPLETED", completedAt: "2026-09-17T10:02:00.000Z" }));
  f.repository.createArm(arm({ armId: "arm-2" })); assert.equal(f.repository.getActiveArm().armId, "arm-2"); f.database.close();
});
test("getActiveArm échoue fermé si SQLite contient plusieurs actifs", () => {
  const f = fixture(); f.repository.createArm(arm({ state: "COMPLETED", completedAt: "2026-09-17T10:02:00.000Z" }));
  f.repository.createArm(arm({ armId: "arm-2" }));
  f.database.database.prepare("UPDATE benchmark_arms SET state='ARMED_PENDING_SESSION' WHERE arm_id='arm-1'").run();
  assert.throws(() => f.repository.getActiveArm(), (error) => error.code === "BENCHMARK_ARM_MULTIPLE_ACTIVE"); f.database.close();
});
test("transitionArm accepte exactement les transitions déclarées", async (t) => {
  const cases = [
    ["ARMED_PENDING_SESSION", "BOUND_TO_SESSION"], ["ARMED_PENDING_SESSION", "CANCELLED"],
    ["ARMED_PENDING_SESSION", "EXPIRED"], ["ARMED_PENDING_SESSION", "FAILED"],
    ["BOUND_TO_SESSION", "COMPLETED"], ["BOUND_TO_SESSION", "CANCELLED"], ["BOUND_TO_SESSION", "FAILED"],
  ];
  for (const [from, to] of cases) await t.test(`${from} vers ${to}`, () => {
    const f = fixture(); f.repository.createArm(arm({ state: from }));
    const updated = f.repository.transitionArm("arm-1", to, { at: "2026-09-17T10:03:00.000Z", failureReason: "SAFE_FAILURE" });
    assert.equal(updated.state, to);
    if (to === "COMPLETED") assert.equal(updated.completedAt, "2026-09-17T10:03:00.000Z");
    if (to === "CANCELLED") assert.equal(updated.cancelledAt, "2026-09-17T10:03:00.000Z");
    if (to === "FAILED") { assert.equal(updated.failedAt, "2026-09-17T10:03:00.000Z"); assert.equal(updated.failureReason, "SAFE_FAILURE"); }
    if (to === "EXPIRED") assert.equal(updated.expiresAt, arm().expiresAt);
    f.database.close();
  });
});
test("les états terminaux ne peuvent pas s'échapper", () => {
  for (const state of ["COMPLETED", "CANCELLED", "EXPIRED", "FAILED"]) {
    const f = fixture(); f.repository.createArm(arm({ state }));
    assert.throws(() => f.repository.transitionArm("arm-1", "ARMED_PENDING_SESSION"), (error) => error.code === "BENCHMARK_ARM_INVALID_TRANSITION");
    assert.equal(f.repository.getArm("arm-1").state, state); f.database.close();
  }
});
test("une transition inconnue échoue et une transition terminale identique est idempotente", () => {
  const f = fixture();
  assert.throws(() => f.repository.transitionArm("missing", "FAILED"), (error) => error.code === "BENCHMARK_ARM_NOT_FOUND");
  f.repository.createArm(arm()); const first = f.repository.transitionArm("arm-1", "CANCELLED", { at: "2026-09-17T10:04:00.000Z" });
  const second = f.repository.transitionArm("arm-1", "CANCELLED", { at: "2026-09-17T11:00:00.000Z" });
  assert.equal(second.cancelledAt, first.cancelledAt); assert.equal(second.updatedAt, first.updatedAt); f.database.close();
});
test("bindSessionMetadata lie atomiquement et refuse le remplacement", () => {
  const f = fixture(); f.repository.createArm(arm());
  const bound = f.repository.bindSessionMetadata("arm-1", "session-A", "2026-09-17T10:05:00.000Z");
  assert.equal(bound.state, "BOUND_TO_SESSION"); assert.equal(bound.benchmarkSessionId, "session-A"); assert.equal(bound.boundAt, "2026-09-17T10:05:00.000Z");
  assert.deepEqual(f.repository.bindSessionMetadata("arm-1", "session-A", bound.boundAt), bound);
  assert.throws(() => f.repository.bindSessionMetadata("arm-1", "session-B", bound.boundAt), (error) => error.code === "BENCHMARK_ARM_BINDING_CONFLICT");
  assert.equal(f.repository.getArm("arm-1").benchmarkSessionId, "session-A"); f.database.close();
});
test("listRecoverableArms exclut les états terminaux", () => {
  const f = fixture(); f.repository.createArm(arm({ state: "COMPLETED" }));
  f.repository.createArm(arm({ armId: "arm-2" }));
  assert.deepEqual(f.repository.listRecoverableArms().map((item) => item.armId), ["arm-2"]); f.database.close();
});
test("liaison et transition persistent après réouverture", () => {
  const f = fixture(); f.repository.createArm(arm());
  f.repository.bindSessionMetadata("arm-1", "session-reopen", "2026-09-17T10:06:00.000Z"); f.database.close();
  const reopened = createPersonalDatabase(f.file); const repository = createBenchmarkArmingRepository(reopened);
  const actual = repository.getArm("arm-1"); assert.equal(actual.state, "BOUND_TO_SESSION");
  assert.equal(actual.benchmarkSessionId, "session-reopen"); assert.equal(actual.boundAt, "2026-09-17T10:06:00.000Z"); reopened.close();
});
