"use strict";

const assert =
  require("node:assert/strict");

const fs =
  require("node:fs");

const os =
  require("node:os");

const path =
  require("node:path");

const test =
  require("node:test");

const {
  createPersonalDatabase,
} = require(
  "../services/persistence/database"
);

const {
  createGoalDevRetryChainRepository,
} = require(
  "../services/persistence/repositories/goal-dev-retry-chain-repository"
);

const {
  createGoalDevRetryExecutionTemplate,
} = require(
  "../services/goals/goal-dev-retry-execution-template"
);

const {
  createGoalDevRetryChainStore,
} = require(
  "../services/goals/goal-dev-retry-chain-store"
);

function tempDatabase() {
  const directory =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "noon-goal-retry-chain-"
      )
    );

  const filePath =
    path.join(
      directory,
      "personal-intelligence.sqlite"
    );

  return {
    directory,
    filePath,
  };
}

function open(
  filePath,
  now =
    () =>
      "2026-10-11T08:00:00.000Z"
) {
  const database =
    createPersonalDatabase(
      filePath
    );

  const repository =
    createGoalDevRetryChainRepository(
      database
    );

  const store =
    createGoalDevRetryChainStore({
      repository,
      now,
    });

  return {
    database,
    repository,
    store,
  };
}

function createChain(
  store
) {
  return store.create({
    chainId:
      "chain-persist-1",

    goalRef: {
      goalId: "goal-1",
      goalVersion: 4,
      workspaceId:
        "workspace-1",
      projectId:
        "project-1",
    },

    rootTaskId:
      "task-root",

    executionTemplate:
      createGoalDevRetryExecutionTemplate({
        objective:
          "Corriger les validations du projet.",

        requiredQuality:
          "HIGH",

        allowedPaths: [
          "/repo/src",
          "/repo/test",
        ],

        forbiddenPaths: [
          "/repo/.env",
        ],

        constraints: [
          "Préserver les changements existants",
        ],

        validationCommands: [
          "npm test",
        ],

        maxIterations: 3,
        maxDuration: 60_000,
        maxEstimatedCost: 3,
        localOnly: true,
      }),

    limits: {
      maxRetries: 2,
      maxDuration:
        60_000,
      maxEstimatedCost: 3,
    },

    createdAt:
      "2026-10-11T08:00:00.000Z",
  });
}

function readyCandidate(
  store,
  taskId = "task-retry-1"
) {
  const created = createChain(store);

  const recorded =
    store.recordAttempt(
      "chain-persist-1",
      {
        expectedRevision: created.revision,
        taskId: "task-root",
        finalVerdict: "FAIL",
        continuationState:
          "RETRY_CANDIDATE",
        estimatedCost: 0.5,
        recordedAt:
          "2026-10-11T08:00:10.000Z",
      }
    );

  const candidate =
    store.projectCandidate(
      "chain-persist-1",
      {
        now:
          "2026-10-11T08:00:20.000Z",
        taskId,
      }
    );

  return {
    candidate,
    expectedRevision:
      recorded.revision,
  };
}

test(
  "4.6C la chaîne et ses compteurs survivent à une réouverture SQLite",
  () => {
    const fixture =
      tempDatabase();

    let first =
      open(
        fixture.filePath
      );

    const created =
      createChain(
        first.store
      );

    assert.equal(
      created.revision,
      1
    );

    const recorded =
      first.store
        .recordAttempt(
          "chain-persist-1",
          {
            expectedRevision: created.revision,
            taskId:
              "task-root",

            finalVerdict:
              "FAIL",

            failureCategory:
              "VALIDATION_FAILED",

            continuationState:
              "RETRY_CANDIDATE",

            estimatedCost:
              0.8,

            actualCost:
              0.5,

            recordedAt:
              "2026-10-11T08:00:10.000Z",
          }
        );

    assert.equal(
      recorded.revision,
      2
    );

    const candidate =
      first.store
        .projectCandidate(
          "chain-persist-1",
          {
            now:
              "2026-10-11T08:00:20.000Z",

            taskId:
              "task-retry-1",
          }
        );

    const appended =
      first.store
        .appendCandidate(
          "chain-persist-1",
          candidate,
          {
            expectedRevision:
              recorded.revision,

            updatedAt:
              "2026-10-11T08:00:20.000Z",
          }
        );

    assert.equal(
      appended.revision,
      3
    );

    first.database.close();

    const second =
      open(
        fixture.filePath
      );

    const restored =
      second.store.get(
        "chain-persist-1"
      );

    assert.equal(
      restored.revision,
      3
    );

    assert.equal(
      restored.chain
        .attempts.length,
      2
    );

    assert.equal(
      restored.chain
        .attempts[1]
        .taskId,
      "task-retry-1"
    );

    assert.equal(
      restored.chain
        .accounting
        .accountedCost,
      0.5
    );

    assert.equal(
      restored.chain
        .accounting
        .attemptsRecorded,
      1
    );

    assert.equal(
      restored.chain
        .accounting
        .retriesUsed,
      0
    );

    second.store
      .recordAttempt(
        "chain-persist-1",
        {
          expectedRevision: restored.revision,
          taskId:
            "task-retry-1",

          finalVerdict:
            "FAIL",

          failureCategory:
            "VALIDATION_FAILED",

          continuationState:
            "RETRY_CANDIDATE",

          estimatedCost:
            0.9,

          actualCost:
            0.7,

          recordedAt:
            "2026-10-11T08:00:30.000Z",
        }
      );

    second.database.close();

    const third =
      open(
        fixture.filePath
      );

    const final =
      third.store.get(
        "chain-persist-1"
      );

    assert.equal(
      final.revision,
      4
    );

    assert.equal(
      final.chain
        .accounting
        .attemptsRecorded,
      2
    );

    assert.equal(
      final.chain
        .accounting
        .retriesUsed,
      1
    );

    assert.equal(
      final.chain
        .accounting
        .accountedCost,
      1.2
    );

    assert.equal(
      final.chain
        .attempts.length,
      2
    );

    third.database.close();

    fs.rmSync(
      fixture.directory,
      {
        recursive: true,
        force: true,
      }
    );
  }
);

test(
  "4.6C les revisions sont append-only et auditables",
  () => {
    const fixture =
      tempDatabase();

    const current =
      open(
        fixture.filePath
      );

    const created = createChain(
      current.store
    );

    current.store
      .recordAttempt(
        "chain-persist-1",
        {
          expectedRevision: created.revision,
          taskId:
            "task-root",

          finalVerdict:
            "FAIL",

          continuationState:
            "RETRY_CANDIDATE",

          estimatedCost:
            0.5,

          recordedAt:
            "2026-10-11T08:00:10.000Z",
        }
      );

    const history =
      current.store.history(
        "chain-persist-1"
      );

    assert.deepEqual(
      history.map(
        (item) =>
          item.revision
      ),
      [1, 2]
    );

    assert.equal(
      history[0]
        .chain
        .accounting
        .attemptsRecorded,
      0
    );

    assert.equal(
      history[1]
        .chain
        .accounting
        .attemptsRecorded,
      1
    );

    current.database.close();

    fs.rmSync(
      fixture.directory,
      {
        recursive: true,
        force: true,
      }
    );
  }
);

test(
  "4.6C une écriture stale échoue fermé",
  () => {
    const fixture =
      tempDatabase();

    const current =
      open(
        fixture.filePath
      );

    const revisionOne =
      createChain(
        current.store
      );

    current.store
      .recordAttempt(
        "chain-persist-1",
        {
          expectedRevision: revisionOne.revision,
          taskId:
            "task-root",

          finalVerdict:
            "FAIL",

          continuationState:
            "RETRY_CANDIDATE",

          estimatedCost:
            0.5,

          recordedAt:
            "2026-10-11T08:00:10.000Z",
        }
      );

    assert.throws(
      () =>
        current.repository.save(
          revisionOne.chain,
          {
            expectedRevision: 1,
          }
        ),
      {
        code:
          "GOAL_DEV_RETRY_PERSISTENCE_CONFLICT",
      }
    );

    current.database.close();

    fs.rmSync(
      fixture.directory,
      {
        recursive: true,
        force: true,
      }
    );
  }
);

test(
  "4.6C une revision courante ne peut réinitialiser les compteurs",
  () => {
    const fixture =
      tempDatabase();

    const current =
      open(
        fixture.filePath
      );

    const created = createChain(
      current.store
    );

    const recorded =
      current.store
        .recordAttempt(
          "chain-persist-1",
          {
            expectedRevision: created.revision,
            taskId:
              "task-root",

            finalVerdict:
              "FAIL",

            continuationState:
              "RETRY_CANDIDATE",

            estimatedCost:
              0.5,

            recordedAt:
              "2026-10-11T08:00:10.000Z",
          }
        );

    assert.equal(
      recorded.revision,
      2
    );

    const reset =
      structuredClone(
        recorded.chain
      );

    /*
     * On garde un updatedAt monotone afin
     * de tester spécifiquement la tentative
     * de remise à zéro des compteurs,
     * et non le garde-fou temporel.
     */
    reset.accounting
      .attemptsRecorded = 0;

    reset.accounting
      .retriesUsed = 0;

    reset.accounting
      .accountedCost = 0;

    reset.updatedAt =
      "2026-10-11T08:00:11.000Z";

    assert.throws(
      () =>
        current.repository.save(
          reset,
          {
            expectedRevision:
              recorded.revision,
          }
        ),
      {
        code:
          "GOAL_DEV_RETRY_PERSISTENCE_ACCOUNTING_INVALID",
      }
    );

    const after =
      current.store.get(
        "chain-persist-1"
      );

    assert.equal(
      after.revision,
      2
    );

    assert.equal(
      after.chain
        .accounting
        .attemptsRecorded,
      1
    );

    assert.equal(
      after.chain
        .accounting
        .accountedCost,
      0.5
    );

    current.database.close();

    fs.rmSync(
      fixture.directory,
      {
        recursive: true,
        force: true,
      }
    );
  }
);

test(
  "4.6C updatedAt ne peut jamais reculer",
  () => {
    const fixture =
      tempDatabase();

    const current =
      open(
        fixture.filePath
      );

    const created = createChain(
      current.store
    );

    const recorded =
      current.store
        .recordAttempt(
          "chain-persist-1",
          {
            expectedRevision: created.revision,
            taskId:
              "task-root",

            finalVerdict:
              "FAIL",

            continuationState:
              "RETRY_CANDIDATE",

            estimatedCost:
              0.5,

            recordedAt:
              "2026-10-11T08:00:10.000Z",
          }
        );

    const rewind =
      structuredClone(
        recorded.chain
      );

    rewind.updatedAt =
      "2026-10-11T08:00:09.000Z";

    assert.throws(
      () =>
        current.repository.save(
          rewind,
          {
            expectedRevision:
              recorded.revision,
          }
        ),
      {
        code:
          "GOAL_DEV_RETRY_PERSISTENCE_TIME_REWIND",
      }
    );

    const after =
      current.store.get(
        "chain-persist-1"
      );

    assert.equal(
      after.revision,
      2
    );

    assert.equal(
      after.chain.updatedAt,
      "2026-10-11T08:00:10.000Z"
    );

    current.database.close();

    fs.rmSync(
      fixture.directory,
      {
        recursive: true,
        force: true,
      }
    );
  }
);

test(
  "4.6C une tentative RECORDED historique est immuable",
  () => {
    const fixture =
      tempDatabase();

    const current =
      open(
        fixture.filePath
      );

    const created = createChain(
      current.store
    );

    const recorded =
      current.store
        .recordAttempt(
          "chain-persist-1",
          {
            expectedRevision: created.revision,
            taskId:
              "task-root",

            finalVerdict:
              "FAIL",

            continuationState:
              "RETRY_CANDIDATE",

            estimatedCost:
              0.5,

            recordedAt:
              "2026-10-11T08:00:10.000Z",
          }
        );

    const tampered =
      structuredClone(
        recorded.chain
      );

    tampered.attempts[0]
      .accountedCost = 0.1;

    tampered.accounting
      .accountedCost = 0.1;

    tampered.updatedAt =
      "2026-10-11T08:00:11.000Z";

    assert.throws(
      () =>
        current.repository.save(
          tampered,
          {
            expectedRevision:
              recorded.revision,
          }
        ),
      {
        code:
          "GOAL_DEV_RETRY_PERSISTENCE_HISTORY_MUTATED",
      }
    );

    current.database.close();

    fs.rmSync(
      fixture.directory,
      {
        recursive: true,
        force: true,
      }
    );
  }
);

test(
  "4.6C STOPPED ne peut jamais redevenir OPEN",
  () => {
    const fixture =
      tempDatabase();

    const current =
      open(
        fixture.filePath
      );

    const created = createChain(
      current.store
    );

    const stopped =
      current.store
        .recordAttempt(
          "chain-persist-1",
          {
            expectedRevision: created.revision,
            taskId:
              "task-root",

            finalVerdict:
              "PASS",

            continuationState:
              "STOP",

            estimatedCost:
              0.2,

            actualCost:
              0.1,

            recordedAt:
              "2026-10-11T08:00:10.000Z",
          }
        );

    const reopened =
      structuredClone(
        stopped.chain
      );

    reopened.state =
      "OPEN";

    reopened.updatedAt =
      "2026-10-11T08:00:11.000Z";

    assert.throws(
      () =>
        current.repository.save(
          reopened,
          {
            expectedRevision:
              stopped.revision,
          }
        ),
      {
        code:
          "GOAL_DEV_RETRY_PERSISTENCE_REOPEN_DENIED",
      }
    );

    current.database.close();

    fs.rmSync(
      fixture.directory,
      {
        recursive: true,
        force: true,
      }
    );
  }
);

test(
  "4.6C les enregistrements Retry Chain ne polluent pas l'état Goal historique",
  () => {
    const fixture =
      tempDatabase();

    const current =
      open(
        fixture.filePath
      );

    createChain(
      current.store
    );

    if (
      current.database.kind ===
        "sqlite"
    ) {
      const rows =
        current.database
          .database
          .prepare(`
            SELECT
              record_type,
              COUNT(*) AS count
            FROM goal_strategy_records
            GROUP BY record_type
          `)
          .all();

      const retry =
        rows.find(
          (row) =>
            row.record_type ===
              "GOAL_DEV_RETRY_CHAIN"
        );

      assert.equal(
        Number(
          retry?.count || 0
        ),
        1
      );
    }

    current.database.close();

    fs.rmSync(
      fixture.directory,
      {
        recursive: true,
        force: true,
      }
    );
  }
);

test(
  "4.6E le Retry Execution Template survit au restart et reste immuable",
  () => {
    const fixture =
      tempDatabase();

    let current =
      open(
        fixture.filePath
      );

    const created =
      createChain(
        current.store
      );

    const originalFingerprint =
      created.chain
        .executionTemplate
        .fingerprint;

    current.database.close();

    current =
      open(
        fixture.filePath
      );

    const restored =
      current.store.get(
        "chain-persist-1"
      );

    assert.equal(
      restored.chain
        .executionTemplate
        .fingerprint,
      originalFingerprint
    );

    const tampered =
      structuredClone(
        restored.chain
      );

    tampered.executionTemplate =
      createGoalDevRetryExecutionTemplate({
        ...tampered
          .executionTemplate
          .request,

        objective:
          "Objectif changé après restart",
      });

    tampered.updatedAt =
      "2026-10-11T08:00:01.000Z";

    assert.throws(
      () =>
        current.repository.save(
          tampered,
          {
            expectedRevision:
              restored.revision,
          }
        ),
      {
        code:
          "GOAL_DEV_RETRY_PERSISTENCE_IMMUTABLE_CHANGED",
      }
    );

    current.database.close();

    fs.rmSync(
      fixture.directory,
      {
        recursive: true,
        force: true,
      }
    );
  }
);

test("appendCandidate impose une révision sûre et refuse stale sans fallback ni rejeu idempotent", (t) => {
  const fixture = tempDatabase();
  const current = open(fixture.filePath);
  t.after(() => {
    current.database.close();
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  });

  const { candidate, expectedRevision } = readyCandidate(current.store);
  const before = current.store.get("chain-persist-1");
  assert.equal(expectedRevision, 2);
  assert.equal(current.store.assess("chain-persist-1", {
    now: "2026-10-11T08:00:20.000Z",
  }).eligible, true);

  for (const invalid of [undefined, null, 0, -1, "2", 2.5, NaN, Infinity,
    Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1, { valueOf: () => 2 }]) {
    assert.throws(() => current.store.appendCandidate("chain-persist-1", candidate, {
      expectedRevision: invalid, updatedAt: "2026-10-11T08:00:20.000Z",
    }), { code: "GOAL_DEV_RETRY_PERSISTENCE_REVISION_REQUIRED" });
  }
  assert.deepEqual(current.store.get("chain-persist-1"), before);
  assert.equal(current.store.history("chain-persist-1").length, 2);

  assert.throws(() => current.store.appendCandidate("chain-persist-1", candidate, {
    expectedRevision: 1, updatedAt: "2026-10-11T08:00:20.000Z",
  }), { code: "GOAL_DEV_RETRY_PERSISTENCE_CONFLICT" });
  assert.deepEqual(current.store.get("chain-persist-1"), before);

  const appended = current.store.appendCandidate("chain-persist-1", candidate, {
    expectedRevision, updatedAt: "2026-10-11T08:00:20.000Z",
  });
  assert.equal(appended.revision, 3);
  assert.equal(appended.created, true);
  assert.equal(appended.chain.attempts[1].taskId, candidate.taskId);
  assert.throws(() => current.store.appendCandidate("chain-persist-1", candidate, {
    expectedRevision, updatedAt: "2026-10-11T08:00:20.000Z",
  }), { code: "GOAL_DEV_RETRY_PERSISTENCE_CONFLICT" });
  assert.equal(current.store.history("chain-persist-1").length, 3);

  const recorded = current.store.recordAttempt("chain-persist-1", {
    expectedRevision: appended.revision,
    taskId: candidate.taskId, finalVerdict: "FAIL",
    continuationState: "RETRY_CANDIDATE", estimatedCost: 0.5,
    recordedAt: "2026-10-11T08:00:30.000Z",
  });
  assert.equal(recorded.revision, 4);
  assert.equal(current.store.assess("chain-persist-1", {
    now: "2026-10-11T08:00:40.000Z",
  }).eligible, true);
});

test("appendCandidate conserve les refus du candidat invalide et de la chaîne fermée", (t) => {
  const fixture = tempDatabase();
  const current = open(fixture.filePath);
  t.after(() => {
    current.database.close();
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  });

  const { candidate, expectedRevision } = readyCandidate(current.store);
  const invalid = structuredClone(candidate);
  invalid.executionTemplateFingerprint = "wrong";
  assert.throws(() => current.store.appendCandidate("chain-persist-1", invalid, {
    expectedRevision, updatedAt: "2026-10-11T08:00:20.000Z",
  }), { code: "GOAL_DEV_RETRY_CANDIDATE_INVALID" });
  assert.equal(current.store.get("chain-persist-1").revision, expectedRevision);

  const stoppedFixture = tempDatabase();
  const stoppedStore = open(stoppedFixture.filePath);
  t.after(() => {
    stoppedStore.database.close();
    fs.rmSync(stoppedFixture.directory, { recursive: true, force: true });
  });
  const createdStopped = createChain(stoppedStore.store);
  const stopped = stoppedStore.store.recordAttempt("chain-persist-1", {
    expectedRevision: createdStopped.revision,
    taskId: "task-root", finalVerdict: "FAIL", continuationState: "STOP",
    estimatedCost: 0.5, recordedAt: "2026-10-11T08:00:10.000Z",
  });
  assert.equal(stopped.revision, 2);
  assert.throws(() => stoppedStore.store.appendCandidate("chain-persist-1", candidate, {
    expectedRevision: stopped.revision, updatedAt: "2026-10-11T08:00:20.000Z",
  }), { code: "GOAL_DEV_RETRY_NOT_ELIGIBLE" });
  assert.deepEqual(stoppedStore.store.get("chain-persist-1"), {
    revision: stopped.revision,
    chain: stopped.chain,
  });
  assert.equal(stoppedStore.store.history("chain-persist-1").length, 2);
});

test("un updatedAt antidaté ne contourne pas l'éligibilité à l'heure du store", (t) => {
  const fixture = tempDatabase();
  let observedAt = "2026-10-11T08:00:20.000Z";
  const current = open(fixture.filePath, () => observedAt);
  t.after(() => {
    current.database.close();
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  });
  const { candidate, expectedRevision } = readyCandidate(current.store);
  observedAt = "2026-10-11T08:02:00.000Z";

  assert.throws(() => current.store.appendCandidate("chain-persist-1", candidate, {
    expectedRevision, updatedAt: "2026-10-11T08:00:20.000Z",
  }), { code: "GOAL_DEV_RETRY_NOT_ELIGIBLE" });
  assert.equal(current.store.get("chain-persist-1").revision, expectedRevision);
  assert.equal(current.store.history("chain-persist-1").length, 2);
});

test("appendCandidate transmet la révision approuvée au CAS malgré une mutation entre lecture et save", (t) => {
  const fixture = tempDatabase();
  const current = open(fixture.filePath);
  t.after(() => {
    current.database.close();
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  });
  if (current.database.kind !== "sqlite") {
    t.skip("CAS atomique vérifié uniquement sur SQLite");
    return;
  }

  const { candidate, expectedRevision } = readyCandidate(current.store);
  let saveCalls = 0;
  const interposed = createGoalDevRetryChainStore({
    repository: {
      latest: (chainId) => current.repository.latest(chainId),
      save(next, options) {
        saveCalls += 1;
        assert.equal(options.expectedRevision, expectedRevision);
        const changed = structuredClone(current.repository.latest("chain-persist-1").chain);
        changed.updatedAt = "2026-10-11T08:00:15.000Z";
        current.repository.save(changed, { expectedRevision });
        return current.repository.save(next, options);
      },
    },
    now: () => "2026-10-11T08:00:20.000Z",
  });

  assert.throws(() => interposed.appendCandidate("chain-persist-1", candidate, {
    expectedRevision, updatedAt: "2026-10-11T08:00:20.000Z",
  }), { code: "GOAL_DEV_RETRY_PERSISTENCE_CONFLICT" });
  assert.equal(saveCalls, 1);
  assert.equal(current.store.get("chain-persist-1").revision, 3);
  assert.equal(current.store.get("chain-persist-1").chain.attempts.length, 1);
  assert.equal(current.store.get("chain-persist-1").chain.updatedAt, "2026-10-11T08:00:15.000Z");
});

test("deux stores SQLite sur la même chaîne ne peuvent gagner le même append", (t) => {
  const fixture = tempDatabase();
  const first = open(fixture.filePath);
  const second = open(fixture.filePath);
  t.after(() => {
    second.database.close();
    first.database.close();
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  });
  if (first.database.kind !== "sqlite" || second.database.kind !== "sqlite") {
    t.skip("Concurrence sur stockage SQLite uniquement");
    return;
  }

  const { candidate, expectedRevision } = readyCandidate(first.store);
  let secondSaveCalls = 0;
  let readBarrierReached = false;
  let winner;
  const staleSecondStore = createGoalDevRetryChainStore({
    repository: {
      latest(chainId) {
        const snapshot = second.repository.latest(chainId);
        assert.equal(snapshot.revision, expectedRevision);
        readBarrierReached = true;
        winner = first.store.appendCandidate("chain-persist-1", candidate, {
          expectedRevision, updatedAt: "2026-10-11T08:00:20.000Z",
        });
        return snapshot;
      },
      save(next, options) {
        secondSaveCalls += 1;
        assert.equal(options.expectedRevision, expectedRevision);
        return second.repository.save(next, options);
      },
    },
    now: () => "2026-10-11T08:00:20.000Z",
  });

  assert.throws(() => staleSecondStore.appendCandidate("chain-persist-1", candidate, {
    expectedRevision, updatedAt: "2026-10-11T08:00:20.000Z",
  }), { code: "GOAL_DEV_RETRY_PERSISTENCE_CONFLICT" });
  assert.equal(readBarrierReached, true);
  assert.equal(winner.revision, 3);
  assert.equal(secondSaveCalls, 1);
  assert.deepEqual(first.store.get("chain-persist-1"), second.store.get("chain-persist-1"));
  assert.equal(first.store.history("chain-persist-1").length, 3);
});


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
