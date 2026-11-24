"use strict";

const assert =
  require("node:assert/strict");
const fs =
  require("node:fs");
const test =
  require("node:test");

const {
  createChain,
  createGoalDevRetryChainRepository,
  createGoalDevRetryChainStore,
  open,
  readyCandidate,
  tempDatabase,
} = require("./helpers/goal-dev-retry-chain-persistence-fixtures");

test(
  "4.6H durable execution uncertainty : PREPARED devient MAY_HAVE_STARTED sans inventer un coût",
  (t) => {
    const fixture =
      tempDatabase();

    let current =
      open(
        fixture.filePath
      );

    t.after(() => {
      try {
        current.database.close();
      } catch {}

      fs.rmSync(
        fixture.directory,
        {
          recursive: true,
          force: true,
        }
      );
    });

    const {
      candidate,
      expectedRevision,
    } =
      readyCandidate(
        current.store
      );

    const appended =
      current.store
        .appendCandidate(
          "chain-persist-1",
          candidate,
          {
            expectedRevision,

            updatedAt:
              "2026-10-11T08:00:20.000Z",
          }
        );

    const accountingBefore =
      structuredClone(
        appended.chain
          .accounting
      );

    const uncertain =
      current.store
        .markExecutionUncertain(
          "chain-persist-1",
          {
            expectedRevision:
              appended.revision,

            taskId:
              candidate.taskId,

            attemptIndex:
              candidate.attemptIndex,

            uncertainAt:
              "2026-10-11T08:00:21.000Z",
          }
        );

    assert.equal(
      uncertain.revision,
      appended.revision + 1
    );

    const latest =
      uncertain.chain
        .attempts[
          uncertain.chain
            .attempts.length - 1
        ];

    assert.equal(
      latest.state,
      "PLANNED"
    );

    assert.equal(
      latest.executionBoundary,
      "MAY_HAVE_STARTED"
    );

    assert.equal(
      latest.executionUncertainAt,
      "2026-10-11T08:00:21.000Z"
    );

    assert.equal(
      latest.executionUncertaintyReasonCode,
      "EXECUTION_MAY_HAVE_STARTED"
    );

    assert.equal(
      latest.actualCost,
      null
    );

    assert.equal(
      latest.accountedCost,
      null
    );

    assert.deepEqual(
      uncertain.chain
        .accounting,
      accountingBefore
    );

    assert.equal(
      current.store
        .assess(
          "chain-persist-1",
          {
            now:
              "2026-10-11T08:00:22.000Z",
          }
        )
        .eligible,
      false
    );

    assert.throws(
      () =>
        current.store
          .projectCandidate(
            "chain-persist-1",
            {
              now:
                "2026-10-11T08:00:22.000Z",

              taskId:
                "task-never-replayed",
            }
          ),
      {
        code:
          "GOAL_DEV_RETRY_NOT_ELIGIBLE",
      }
    );

    assert.equal(
      current.store
        .history(
          "chain-persist-1"
        )
        .length,
      4
    );

    current.database.close();

    current =
      open(
        fixture.filePath
      );

    const restored =
      current.store
        .get(
          "chain-persist-1"
        );

    const restoredLatest =
      restored.chain
        .attempts[
          restored.chain
            .attempts.length - 1
        ];

    assert.equal(
      restoredLatest
        .executionBoundary,
      "MAY_HAVE_STARTED"
    );

    assert.equal(
      restoredLatest
        .executionUncertainAt,
      "2026-10-11T08:00:21.000Z"
    );

    assert.equal(
      restoredLatest
        .actualCost,
      null
    );

    /*
     * Un vrai résultat terminal peut ensuite
     * être enregistré normalement.
     *
     * Zéro observé reste zéro.
     */
    const recorded =
      current.store
        .recordAttempt(
          "chain-persist-1",
          {
            expectedRevision:
              restored.revision,
            taskId:
              candidate.taskId,

            finalVerdict:
              "FAIL",

            continuationState:
              "STOP",

            estimatedCost: 0,
            actualCost: 0,

            recordedAt:
              "2026-10-11T08:00:23.000Z",
          }
        );

    const recordedLatest =
      recorded.chain
        .attempts[
          recorded.chain
            .attempts.length - 1
        ];

    assert.equal(
      recordedLatest.state,
      "RECORDED"
    );

    assert.equal(
      recordedLatest.actualCost,
      0
    );

    assert.equal(
      recordedLatest.accountedCost,
      0
    );
  }
);

test(
  "4.6H markExecutionUncertain impose identité et expectedRevision sans fallback",
  (t) => {
    const fixture =
      tempDatabase();

    const current =
      open(
        fixture.filePath
      );

    t.after(() => {
      current.database.close();

      fs.rmSync(
        fixture.directory,
        {
          recursive: true,
          force: true,
        }
      );
    });

    const {
      candidate,
      expectedRevision,
    } =
      readyCandidate(
        current.store
      );

    const appended =
      current.store
        .appendCandidate(
          "chain-persist-1",
          candidate,
          {
            expectedRevision,

            updatedAt:
              "2026-10-11T08:00:20.000Z",
          }
        );

    const before =
      current.store
        .get(
          "chain-persist-1"
        );

    for (
      const invalid of [
        undefined,
        null,
        0,
        -1,
        "3",
        3.5,
        NaN,
        Infinity,
        Number.MAX_SAFE_INTEGER,
        Number.MAX_SAFE_INTEGER + 1,
      ]
    ) {
      assert.throws(
        () =>
          current.store
            .markExecutionUncertain(
              "chain-persist-1",
              {
                expectedRevision:
                  invalid,

                taskId:
                  candidate.taskId,

                attemptIndex:
                  candidate.attemptIndex,

                uncertainAt:
                  "2026-10-11T08:00:21.000Z",
              }
            ),
        {
          code:
            "GOAL_DEV_RETRY_PERSISTENCE_REVISION_REQUIRED",
        }
      );
    }

    assert.deepEqual(
      current.store
        .get(
          "chain-persist-1"
        ),
      before
    );

    assert.throws(
      () =>
        current.store
          .markExecutionUncertain(
            "chain-persist-1",
            {
              expectedRevision:
                appended.revision,

              taskId:
                "wrong-task",

              attemptIndex:
                candidate.attemptIndex,

              uncertainAt:
                "2026-10-11T08:00:21.000Z",
            }
          ),
      {
        code:
          "GOAL_DEV_RETRY_ATTEMPT_IDENTITY_MISMATCH",
      }
    );

    assert.throws(
      () =>
        current.store
          .markExecutionUncertain(
            "chain-persist-1",
            {
              expectedRevision:
                appended.revision,

              taskId:
                candidate.taskId,

              attemptIndex:
                candidate.attemptIndex + 1,

              uncertainAt:
                "2026-10-11T08:00:21.000Z",
            }
          ),
      {
        code:
          "GOAL_DEV_RETRY_ATTEMPT_IDENTITY_MISMATCH",
      }
    );

    const uncertain =
      current.store
        .markExecutionUncertain(
          "chain-persist-1",
          {
            expectedRevision:
              appended.revision,

            taskId:
              candidate.taskId,

            attemptIndex:
              candidate.attemptIndex,

            uncertainAt:
              "2026-10-11T08:00:21.000Z",
          }
        );

    /*
     * La même révision ne peut plus muter.
     */
    assert.throws(
      () =>
        current.store
          .markExecutionUncertain(
            "chain-persist-1",
            {
              expectedRevision:
                appended.revision,

              taskId:
                candidate.taskId,

              attemptIndex:
                candidate.attemptIndex,

              uncertainAt:
                "2026-10-11T08:00:22.000Z",
            }
          ),
      {
        code:
          "GOAL_DEV_RETRY_PERSISTENCE_CONFLICT",
      }
    );

    /*
     * Même avec la nouvelle révision,
     * le double marquage est refusé fermé.
     */
    assert.throws(
      () =>
        current.store
          .markExecutionUncertain(
            "chain-persist-1",
            {
              expectedRevision:
                uncertain.revision,

              taskId:
                candidate.taskId,

              attemptIndex:
                candidate.attemptIndex,

              uncertainAt:
                "2026-10-11T08:00:22.000Z",
            }
          ),
      {
        code:
          "GOAL_DEV_RETRY_EXECUTION_ALREADY_UNCERTAIN",
      }
    );
  }
);

test(
  "4.6H SQLite CAS empêche deux writers de franchir la même frontière",
  (t) => {
    const fixture =
      tempDatabase();

    const first =
      open(
        fixture.filePath
      );

    const second =
      open(
        fixture.filePath
      );

    t.after(() => {
      second.database.close();
      first.database.close();

      fs.rmSync(
        fixture.directory,
        {
          recursive: true,
          force: true,
        }
      );
    });

    if (
      first.database.kind !==
        "sqlite" ||
      second.database.kind !==
        "sqlite"
    ) {
      t.skip(
        "CAS atomique vérifié uniquement sur SQLite"
      );

      return;
    }

    const {
      candidate,
      expectedRevision,
    } =
      readyCandidate(
        first.store
      );

    const appended =
      first.store
        .appendCandidate(
          "chain-persist-1",
          candidate,
          {
            expectedRevision,

            updatedAt:
              "2026-10-11T08:00:20.000Z",
          }
        );

    const firstWinner =
      first.store
        .markExecutionUncertain(
          "chain-persist-1",
          {
            expectedRevision:
              appended.revision,

            taskId:
              candidate.taskId,

            attemptIndex:
              candidate.attemptIndex,

            uncertainAt:
              "2026-10-11T08:00:21.000Z",
          }
        );

    assert.equal(
      firstWinner.revision,
      appended.revision + 1
    );

    assert.throws(
      () =>
        second.store
          .markExecutionUncertain(
            "chain-persist-1",
            {
              expectedRevision:
                appended.revision,

              taskId:
                candidate.taskId,

              attemptIndex:
                candidate.attemptIndex,

              uncertainAt:
                "2026-10-11T08:00:21.000Z",
            }
          ),
      {
        code:
          "GOAL_DEV_RETRY_PERSISTENCE_CONFLICT",
      }
    );

    assert.deepEqual(
      first.store
        .get(
          "chain-persist-1"
        ),
      second.store
        .get(
          "chain-persist-1"
        )
    );
  }
);

test("la capacité du store est liée au repository canonique et refuse l'inconnu", (t) => {
  const fixture = tempDatabase();
  const sqlite = open(fixture.filePath);
  t.after(() => {
    sqlite.database.close();
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  });
  const capabilities = sqlite.store.persistenceCapabilities();
  assert.deepEqual(capabilities, { backend: "SQLITE", atomicRevisionCas: true });
  assert.equal(Object.isFrozen(capabilities), true);
  assert.equal(JSON.stringify(capabilities).includes(fixture.filePath), false);
  assert.throws(() => { capabilities.atomicRevisionCas = false; }, TypeError);

  const fallback = createGoalDevRetryChainRepository({
    kind: "json-fallback", load: () => ({ goal_strategy_records: [] }), save() {},
  });
  assert.deepEqual(createGoalDevRetryChainStore({ repository: fallback }).persistenceCapabilities(), {
    backend: "JSON_FALLBACK", atomicRevisionCas: false,
  });
  assert.throws(() => createGoalDevRetryChainRepository({
    kind: "sqlite",
    database: {
      prepare() { return { get() {}, all() { return []; }, run() {} }; },
      exec() {},
    },
  }), TypeError);
  const unknown = createGoalDevRetryChainStore({ repository: {
    kind: "sqlite", atomicRevisionCas: true,
    latest() { return null; }, save() { return null; },
  } });
  assert.deepEqual(unknown.persistenceCapabilities(), {
    backend: "UNKNOWN", atomicRevisionCas: false,
  });
  assert.equal(Object.isFrozen(unknown.persistenceCapabilities()), true);
});

test("recordAttempt impose une révision sûre et exacte sans fallback", (t) => {
  const fixture = tempDatabase();
  const current = open(fixture.filePath);
  t.after(() => {
    current.database.close();
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  });
  const created = createChain(current.store);
  const terminal = {
    taskId: "task-root", finalVerdict: "FAIL", continuationState: "STOP",
    actualCost: 0, recordedAt: "2026-10-11T08:00:10.000Z",
  };
  for (const invalid of [undefined, null, 0, -1, "1", 1.5, NaN, Infinity,
    Number.MAX_SAFE_INTEGER, { valueOf: () => 1 }]) {
    assert.throws(() => current.store.recordAttempt("chain-persist-1", {
      ...terminal, expectedRevision: invalid,
    }), { code: "GOAL_DEV_RETRY_PERSISTENCE_REVISION_REQUIRED" });
  }
  assert.equal(current.store.get("chain-persist-1").revision, created.revision);
  const recorded = current.store.recordAttempt("chain-persist-1", {
    ...terminal, expectedRevision: created.revision,
  });
  assert.equal(recorded.revision, created.revision + 1);
  assert.equal(recorded.chain.attempts[0].actualCost, 0);
  assert.throws(() => current.store.recordAttempt("chain-persist-1", {
    ...terminal, expectedRevision: created.revision,
  }), { code: "GOAL_DEV_RETRY_PERSISTENCE_CONFLICT" });
  assert.equal(current.store.history("chain-persist-1").length, 2);
});

test("recordAttempt transmet la révision originale au CAS après mutation interposée", (t) => {
  const fixture = tempDatabase();
  const current = open(fixture.filePath);
  t.after(() => {
    current.database.close();
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  });
  if (current.database.kind !== "sqlite") {
    t.skip("CAS SQLite uniquement");
    return;
  }
  const created = createChain(current.store);
  let saveCalls = 0;
  const interposed = createGoalDevRetryChainStore({ repository: {
    latest: (id) => current.repository.latest(id),
    save(next, options) {
      saveCalls += 1;
      assert.equal(options.expectedRevision, created.revision);
      const changed = structuredClone(current.repository.latest("chain-persist-1").chain);
      changed.updatedAt = "2026-10-11T08:00:05.000Z";
      current.repository.save(changed, { expectedRevision: created.revision });
      return current.repository.save(next, options);
    },
  }, now: () => "2026-10-11T08:00:10.000Z" });
  assert.throws(() => interposed.recordAttempt("chain-persist-1", {
    expectedRevision: created.revision, taskId: "task-root",
    finalVerdict: "FAIL", continuationState: "STOP", actualCost: 0,
  }), { code: "GOAL_DEV_RETRY_PERSISTENCE_CONFLICT" });
  assert.equal(saveCalls, 1);
  const latest = current.store.get("chain-persist-1");
  assert.equal(latest.revision, created.revision + 1);
  assert.equal(latest.chain.updatedAt, "2026-10-11T08:00:05.000Z");
  assert.equal(latest.chain.attempts[0].state, "PLANNED");
  assert.equal(current.store.history("chain-persist-1").length, 2);
});

test("deux connexions SQLite : une seule écriture terminale gagne", (t) => {
  const fixture = tempDatabase();
  const first = open(fixture.filePath);
  const second = open(fixture.filePath);
  t.after(() => {
    second.database.close();
    first.database.close();
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  });
  if (first.database.kind !== "sqlite" || second.database.kind !== "sqlite") {
    t.skip("Deux connexions SQLite uniquement");
    return;
  }
  const created = createChain(first.store);
  let winner;
  let readBarrierReached = false;
  let secondSaveCalls = 0;
  const interposed = createGoalDevRetryChainStore({ repository: {
    latest(id) {
      const snapshot = second.repository.latest(id);
      assert.equal(snapshot.revision, created.revision);
      readBarrierReached = true;
      winner = first.store.recordAttempt("chain-persist-1", {
        expectedRevision: created.revision, taskId: "task-root",
        finalVerdict: "FAIL", continuationState: "STOP", actualCost: 0,
        recordedAt: "2026-10-11T08:00:10.000Z",
      });
      return snapshot;
    },
    save(next, options) {
      secondSaveCalls += 1;
      assert.equal(options.expectedRevision, created.revision);
      return second.repository.save(next, options);
    },
  }, now: () => "2026-10-11T08:00:10.000Z" });
  assert.throws(() => interposed.recordAttempt("chain-persist-1", {
    expectedRevision: created.revision, taskId: "task-root",
    finalVerdict: "FAIL", continuationState: "STOP", actualCost: 0,
  }), { code: "GOAL_DEV_RETRY_PERSISTENCE_CONFLICT" });
  assert.equal(readBarrierReached, true);
  assert.equal(secondSaveCalls, 1);
  assert.equal(winner.revision, created.revision + 1);
  assert.deepEqual(first.store.get("chain-persist-1"), second.store.get("chain-persist-1"));
  assert.equal(first.store.history("chain-persist-1").length, 2);
});

test("un conflit terminal conserve MAY_HAVE_STARTED et l'historique", (t) => {
  const fixture = tempDatabase();
  const current = open(fixture.filePath);
  t.after(() => {
    current.database.close();
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  });
  const { candidate, expectedRevision } = readyCandidate(current.store);
  const appended = current.store.appendCandidate("chain-persist-1", candidate, {
    expectedRevision, updatedAt: "2026-10-11T08:00:20.000Z",
  });
  const marked = current.store.markExecutionUncertain("chain-persist-1", {
    expectedRevision: appended.revision,
    taskId: candidate.taskId, attemptIndex: candidate.attemptIndex,
    uncertainAt: "2026-10-11T08:00:21.000Z",
  });
  const before = current.store.get("chain-persist-1");
  assert.throws(() => current.store.recordAttempt("chain-persist-1", {
    expectedRevision: appended.revision, taskId: candidate.taskId,
    finalVerdict: "FAIL", continuationState: "STOP", actualCost: 0,
    recordedAt: "2026-10-11T08:00:22.000Z",
  }), { code: "GOAL_DEV_RETRY_PERSISTENCE_CONFLICT" });
  assert.deepEqual(current.store.get("chain-persist-1"), before);
  assert.equal(current.store.history("chain-persist-1").length, marked.revision);
  assert.equal(before.chain.attempts[1].executionBoundary, "MAY_HAVE_STARTED");
  assert.equal(before.chain.attempts[1].actualCost, null);
});
