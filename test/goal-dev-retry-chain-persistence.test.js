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

    createChain(
      current.store
    );

    current.store
      .recordAttempt(
        "chain-persist-1",
        {
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

    createChain(
      current.store
    );

    const recorded =
      current.store
        .recordAttempt(
          "chain-persist-1",
          {
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

    createChain(
      current.store
    );

    const recorded =
      current.store
        .recordAttempt(
          "chain-persist-1",
          {
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

    createChain(
      current.store
    );

    const recorded =
      current.store
        .recordAttempt(
          "chain-persist-1",
          {
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

    createChain(
      current.store
    );

    const stopped =
      current.store
        .recordAttempt(
          "chain-persist-1",
          {
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
