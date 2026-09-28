"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createBenchmarkArmingService, PENDING_ARM_TTL_MS } = require("../services/dev/benchmark/benchmark-arming-service");
const { createDevBenchmarkService } = require("../services/dev/dev-benchmark-service");
const { createPersonalDatabase } = require("../services/persistence/database");
const { createBenchmarkArmingRepository } = require("../services/persistence/repositories/benchmark-arming-repository");
const { createBenchmarkRepository } = require("../services/persistence/repositories/benchmark-repository");

const START = Date.parse("2026-09-17T10:00:00.000Z");
const ORDER = ["normalize-email:NATIVE_NOON", "normalize-email:CODEX", "slugify-title:CODEX", "slugify-title:NATIVE_NOON", "backend-user-update:NATIVE_NOON", "backend-user-update:CODEX", "multifile-state-flow:CODEX", "multifile-state-flow:NATIVE_NOON"];

function setup() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "noon-armed-prepare-")), "noon.sqlite");
  const database = createPersonalDatabase(file); const repository = createBenchmarkRepository(database); const armingRepository = createBenchmarkArmingRepository(database);
  let clock = START; let sessionSequence = 0;
  const armingService = createBenchmarkArmingService({ repository: armingRepository, runtimeStateReader: { read: () => "OFF" }, now: () => clock, createArmId: () => "arm-valid" });
  const service = createDevBenchmarkService({ repository, armingRepository, validator: async () => ({ finalValid: true }), featureMode: () => "LIMITED", now: () => clock, createSessionId: () => `session-${++sessionSequence}` });
  return { database, repository, armingRepository, armingService, service, setClock(value) { clock = value; }, counts() { return { sessions: database.database.prepare("SELECT COUNT(*) n FROM benchmark_sessions").get().n, runs: database.database.prepare("SELECT COUNT(*) n FROM benchmark_runs").get().n }; } };
}

test("prepare lie atomiquement un arm valide à une session et huit runs figés", () => {
  const f = setup(); const arm = f.armingService.armPilot(); const result = f.service.prepare({ armId: arm.armId, sessionId: "caller-choice", participants: [] });
  assert.deepEqual(f.counts(), { sessions: 1, runs: 8 }); assert.equal(result.session.id, "session-1"); assert.equal(result.session.suite_version, "benchmark-suite-v1");
  assert.deepEqual(result.runs.map((run) => `${run.task_id}:${run.participant}`), ORDER); assert.equal(result.arm.state, "BOUND_TO_SESSION"); assert.equal(result.arm.benchmarkSessionId, result.session.id); assert.equal(result.arm.boundAt, "2026-09-17T10:00:00.000Z"); f.database.close();
});
test("prepare exige un arm connu et ne crée aucune ligne sinon", () => { const f = setup(); assert.throws(() => f.service.prepare({}), (error) => error.code === "BENCHMARK_ARM_REQUIRED"); assert.throws(() => f.service.prepare({ armId: "missing" }), (error) => error.code === "BENCHMARK_ARM_NOT_FOUND"); assert.deepEqual(f.counts(), { sessions: 0, runs: 0 }); f.database.close(); });
test("prepare expire à la frontière TTL et refuse les états terminaux", async (t) => {
  await t.test("expired", () => { const f = setup(); const arm = f.armingService.armPilot(); f.setClock(START + PENDING_ARM_TTL_MS); assert.throws(() => f.service.prepare({ armId: arm.armId }), (error) => error.code === "BENCHMARK_ARM_NOT_ELIGIBLE"); assert.equal(f.armingRepository.getArm(arm.armId).state, "EXPIRED"); assert.deepEqual(f.counts(), { sessions: 0, runs: 0 }); f.database.close(); });
  for (const state of ["CANCELLED", "FAILED", "COMPLETED"]) await t.test(state.toLowerCase(), () => { const f = setup(); const arm = f.armingService.armPilot(); if (state === "COMPLETED") f.database.database.prepare("UPDATE benchmark_arms SET state='COMPLETED',completed_at=? WHERE arm_id=?").run(new Date(START).toISOString(), arm.armId); else f.armingRepository.transitionArm(arm.armId, state, { at: new Date(START).toISOString() }); assert.throws(() => f.service.prepare({ armId: arm.armId }), (error) => error.code === "BENCHMARK_ARM_NOT_ELIGIBLE"); assert.deepEqual(f.counts(), { sessions: 0, runs: 0 }); f.database.close(); });
});
test("prepare refuse chaque altération de la politique persistée", async (t) => { const cases = [["suite_version", "other"], ["approved_cap_usd", 0.51], ["authorized_participants_json", JSON.stringify(["NATIVE_NOON"])], ["authorized_participants_json", JSON.stringify(["NATIVE_NOON", "CODEX", "OTHER"])]]; for (const [column, value] of cases) await t.test(`${column}:${value}`, () => { const f = setup(); const arm = f.armingService.armPilot(); f.database.database.prepare(`UPDATE benchmark_arms SET ${column}=? WHERE arm_id=?`).run(value, arm.armId); assert.throws(() => f.service.prepare({ armId: arm.armId }), (error) => error.code === "BENCHMARK_ARM_POLICY_MISMATCH"); assert.deepEqual(f.counts(), { sessions: 0, runs: 0 }); f.database.close(); }); });
test("un échec réel d'insertion de run rollback session, runs et liaison", () => { const f = setup(); const arm = f.armingService.armPilot(); f.database.database.exec("CREATE TRIGGER fail_fourth_run BEFORE INSERT ON benchmark_runs WHEN NEW.run_index=4 BEGIN SELECT RAISE(ABORT, 'forced run failure'); END"); assert.throws(() => f.service.prepare({ armId: arm.armId }), /forced run failure/); assert.deepEqual(f.counts(), { sessions: 0, runs: 0 }); assert.equal(f.armingRepository.getArm(arm.armId).state, "ARMED_PENDING_SESSION"); assert.equal(f.armingRepository.getArm(arm.armId).benchmarkSessionId, null); f.database.close(); });
test("un échec réel de binding rollback session et huit runs", () => { const f = setup(); const arm = f.armingService.armPilot(); f.database.database.exec("CREATE TRIGGER fail_arm_binding BEFORE UPDATE ON benchmark_arms WHEN NEW.state='BOUND_TO_SESSION' BEGIN SELECT RAISE(ABORT, 'forced bind failure'); END"); assert.throws(() => f.service.prepare({ armId: arm.armId }), /forced bind failure/); assert.deepEqual(f.counts(), { sessions: 0, runs: 0 }); const persisted = f.armingRepository.getArm(arm.armId); assert.equal(persisted.state, "ARMED_PENDING_SESSION"); assert.equal(persisted.benchmarkSessionId, null); f.database.close(); });
test("un second prepare retourne la même session sans doublon", () => { const f = setup(); const arm = f.armingService.armPilot(); const first = f.service.prepare({ armId: arm.armId }); const second = f.service.prepare({ armId: arm.armId }); assert.equal(second.idempotent, true); assert.equal(second.session.id, first.session.id); assert.deepEqual(f.counts(), { sessions: 1, runs: 8 }); f.database.close(); });
test("un arm bound corrompu échoue fermé sans remplacement", async (t) => { for (const corruption of ["missing-session", "wrong-count", "wrong-order", "suite-mismatch"]) await t.test(corruption, () => { const f = setup(); const arm = f.armingService.armPilot(); const first = f.service.prepare({ armId: arm.armId }); if (corruption === "missing-session") f.database.database.exec("PRAGMA foreign_keys=OFF"); if (corruption === "missing-session") f.database.database.prepare("DELETE FROM benchmark_sessions WHERE id=?").run(first.session.id); if (corruption === "wrong-count") f.database.database.prepare("DELETE FROM benchmark_runs WHERE id=?").run(first.runs[0].id); if (corruption === "wrong-order") f.database.database.prepare("UPDATE benchmark_runs SET task_id='other' WHERE id=?").run(first.runs[0].id); if (corruption === "suite-mismatch") f.database.database.prepare("UPDATE benchmark_sessions SET suite_version='other' WHERE id=?").run(first.session.id); const before = f.counts(); assert.throws(() => f.service.prepare({ armId: arm.armId }), (error) => error.code === "BENCHMARK_ARM_BOUND_INTEGRITY_ERROR"); assert.deepEqual(f.counts(), before); f.database.close(); }); });
test("prepare ne déclenche aucune exécution ni écriture runtime", () => { const f = setup(); const calls = { native: 0, codex: 0, provider: 0, runtimeWrites: 0 }; const arm = f.armingService.armPilot(); f.service.prepare({ armId: arm.armId }); assert.deepEqual(calls, { native: 0, codex: 0, provider: 0, runtimeWrites: 0 }); f.database.close(); });


test(
  "deux prepare concurrents démarrés après initialisation convergent vers une seule session",
  async () => {
    const { Worker } =
      require("node:worker_threads");

    const dir =
      fs.mkdtempSync(
        path.join(
          os.tmpdir(),
          "noon-armed-concurrent-"
        )
      );

    const file =
      path.join(
        dir,
        "noon.sqlite"
      );

    const initialDatabase =
      createPersonalDatabase(file);

    const initialArmingRepository =
      createBenchmarkArmingRepository(
        initialDatabase
      );

    const initialArmingService =
      createBenchmarkArmingService({
        repository:
          initialArmingRepository,
        runtimeStateReader: {
          read: () => "OFF",
        },
        now: () => START,
        createArmId:
          () => "arm-concurrent",
      });

    const arm =
      initialArmingService.armPilot();

    initialDatabase.close();

    const gate =
      new SharedArrayBuffer(
        Int32Array.BYTES_PER_ELEMENT * 2
      );

    const workerSource = `
      "use strict";

      const {
        parentPort,
        workerData,
      } = require("node:worker_threads");

      const {
        createPersonalDatabase,
      } = require(workerData.databaseModule);

      const {
        createBenchmarkRepository,
      } = require(workerData.benchmarkRepositoryModule);

      const {
        createBenchmarkArmingRepository,
      } = require(workerData.armingRepositoryModule);

      const {
        createDevBenchmarkService,
      } = require(workerData.serviceModule);

      const signal =
        new Int32Array(workerData.gate);

      const database =
        createPersonalDatabase(
          workerData.file
        );

      const repository =
        createBenchmarkRepository(
          database
        );

      const armingRepository =
        createBenchmarkArmingRepository(
          database
        );

      const service =
        createDevBenchmarkService({
          repository,
          armingRepository,
          validator: async () => ({
            finalValid: true,
          }),
          featureMode: () =>
            "LIMITED",
          now: () =>
            workerData.now,
          createSessionId: () => {
            if (workerData.first) {
              Atomics.store(
                signal,
                0,
                1
              );

              Atomics.notify(
                signal,
                0
              );

              Atomics.wait(
                signal,
                1,
                0,
                1000
              );
            }

            return workerData.sessionId;
          },
        });

      parentPort.postMessage({
        type: "ready",
      });

      parentPort.once(
        "message",
        () => {
          try {
            if (!workerData.first) {
              while (
                Atomics.load(
                  signal,
                  0
                ) !== 1
              ) {
                Atomics.wait(
                  signal,
                  0,
                  0,
                  20
                );
              }

              Atomics.store(
                signal,
                1,
                1
              );

              Atomics.notify(
                signal,
                1
              );
            }

            const result =
              service.prepare({
                armId:
                  workerData.armId,
              });

            parentPort.postMessage({
              type: "result",
              ok: true,
              sessionId:
                result.session.id,
              idempotent:
                result.idempotent,
            });
          } catch (error) {
            parentPort.postMessage({
              type: "result",
              ok: false,
              code:
                error?.code ||
                null,
              message:
                error?.message ||
                String(error),
            });
          } finally {
            database.close();
          }
        }
      );
    `;

    const modules = {
      databaseModule:
        require.resolve(
          "../services/persistence/database"
        ),

      benchmarkRepositoryModule:
        require.resolve(
          "../services/persistence/repositories/benchmark-repository"
        ),

      armingRepositoryModule:
        require.resolve(
          "../services/persistence/repositories/benchmark-arming-repository"
        ),

      serviceModule:
        require.resolve(
          "../services/dev/dev-benchmark-service"
        ),
    };

    function startWorker(
      first,
      sessionId
    ) {
      const worker =
        new Worker(
          workerSource,
          {
            eval: true,
            workerData: {
              ...modules,
              file,
              gate,
              first,
              sessionId,
              armId:
                arm.armId,
              now: START,
            },
          }
        );

      const ready =
        new Promise(
          (resolve, reject) => {
            const onMessage =
              (message) => {
                if (
                  message?.type ===
                  "ready"
                ) {
                  worker.off(
                    "error",
                    reject
                  );

                  resolve();
                }
              };

            worker.on(
              "message",
              onMessage
            );

            worker.once(
              "error",
              reject
            );
          }
        );

      const result =
        new Promise(
          (resolve, reject) => {
            const onMessage =
              (message) => {
                if (
                  message?.type ===
                  "result"
                ) {
                  resolve(message);
                }
              };

            worker.on(
              "message",
              onMessage
            );

            worker.once(
              "error",
              reject
            );
          }
        );

      return {
        worker,
        ready,
        result,
      };
    }

    const firstWorker =
      startWorker(
        true,
        "session-concurrent-a"
      );

    const secondWorker =
      startWorker(
        false,
        "session-concurrent-b"
      );

    await Promise.all([
      firstWorker.ready,
      secondWorker.ready,
    ]);

    firstWorker.worker.postMessage(
      "go"
    );

    secondWorker.worker.postMessage(
      "go"
    );

    let timeoutId;

    const timeout =
      new Promise(
        (_, reject) => {
          timeoutId =
            setTimeout(
              () =>
                reject(
                  Object.assign(
                    new Error(
                      "prepare concurrent timeout"
                    ),
                    {
                      code:
                        "BENCHMARK_PREPARE_CONCURRENCY_TIMEOUT",
                    }
                  )
                ),
              4000
            );
        }
      );

    let first;
    let second;

    try {
      [first, second] =
        await Promise.race([
          Promise.all([
            firstWorker.result,
            secondWorker.result,
          ]),
          timeout,
        ]);
    } finally {
      clearTimeout(timeoutId);
      Atomics.store(
        new Int32Array(gate),
        1,
        1
      );

      Atomics.notify(
        new Int32Array(gate),
        1
      );

      await Promise.allSettled([
        firstWorker.worker.terminate(),
        secondWorker.worker.terminate(),
      ]);
    }

    const finalDatabase =
      createPersonalDatabase(file);

    const sessions =
      finalDatabase.database
        .prepare(
          "SELECT id,idempotency_key FROM benchmark_sessions ORDER BY id"
        )
        .all();

    const runs =
      finalDatabase.database
        .prepare(
          "SELECT session_id,run_index FROM benchmark_runs ORDER BY session_id,run_index"
        )
        .all();

    const persistedArm =
      createBenchmarkArmingRepository(
        finalDatabase
      ).getArm(
        arm.armId
      );

    finalDatabase.close();

    assert.equal(
      first.ok,
      true,
      JSON.stringify(first)
    );

    assert.equal(
      second.ok,
      true,
      JSON.stringify(second)
    );

    assert.equal(
      first.sessionId,
      second.sessionId
    );

    assert.equal(
      sessions.length,
      1
    );

    assert.equal(
      runs.length,
      8
    );

    assert.equal(
      persistedArm.state,
      "BOUND_TO_SESSION"
    );

    assert.equal(
      persistedArm.benchmarkSessionId,
      first.sessionId
    );

    fs.rmSync(
      dir,
      {
        recursive: true,
        force: true,
      }
    );
  }
);
