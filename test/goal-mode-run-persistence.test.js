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
  createGoalModeRunContract,
} = require(
  "../services/goals/goal-mode-run-contract"
);

const {
  createGoalModeRunStore,
} = require(
  "../services/goals/goal-mode-run-store"
);

const {
  createPersonalDatabase,
} = require(
  "../services/persistence/database"
);

const {
  createGoalModeRunRepository,
  describeGoalModeRunRepository,
} = require(
  "../services/persistence/repositories/goal-mode-run-repository"
);

function makeContract(
  runId
) {
  return createGoalModeRunContract({
    goal: {
      goalId:
        "goal-50b-persistence",

      title:
        "Goal persistence",

      status:
        "ACTIVE",

      outcomeDefinition:
        "Persister un Goal Run atomiquement.",

      successCriteria: [
        {
          criterionId:
            "criterion-persist",

          type:
            "BOOLEAN",

          targetValue:
            true,
        },
      ],

      linkedProjectIds: [],
      linkedWorkspaceIds: [],
      constraints: [],
      profileScope:
        "arnaud",
      sensitivity:
        "NORMAL",
      userConfirmed:
        true,
      version: 2,
    },

    request: {
      userConfirmed:
        true,

      limits: {
        maxSteps: 4,
        maxRetries: 1,
        maxProviderCalls: 3,
        maxDuration:
          60_000,
        maxEstimatedCost: 1,
      },

      capabilityCeilings: {
        network: false,
        gitWrite: false,
        destructiveActions:
          false,
      },
    },

    now:
      () =>
        new Date(
          "2026-10-12T12:00:00.000Z"
        ),

    idFactory:
      () =>
        runId,
  });
}

test(
  "5.0B SQLite append-only persiste chaque révision Goal Run",
  () => {
    const directory =
      fs.mkdtempSync(
        path.join(
          os.tmpdir(),
          "noon-50b-"
        )
      );

    const file =
      path.join(
        directory,
        "goal-run.sqlite"
      );

    const database =
      createPersonalDatabase(
        file
      );

    try {
      assert.equal(
        database.kind,
        "sqlite"
      );

      const repository =
        createGoalModeRunRepository(
          database
        );

      assert.deepEqual(
        describeGoalModeRunRepository(
          repository
        ),
        {
          backend:
            "SQLITE",

          atomicRevisionCas:
            true,
        }
      );

      const store =
        createGoalModeRunStore({
          repository,

          now:
            () =>
              "2026-10-12T12:00:05.000Z",
        });

      const created =
        store.create(
          makeContract(
            "goal-run-50b-sqlite"
          )
        );

      assert.equal(
        created.revision,
        1
      );

      assert.equal(
        created.state.status,
        "READY"
      );

      const running =
        store.transition(
          created.state.runId,
          "RUNNING",
          {
            expectedRevision:
              created.revision,

            transitionedAt:
              "2026-10-12T12:00:01.000Z",
          }
        );

      assert.equal(
        running.revision,
        2
      );

      const consumed =
        store.consume(
          created.state.runId,
          {
            expectedRevision:
              running.revision,

            currentGoalVersion:
              2,

            usageDelta: {
              steps: 1,
              providerCalls: 1,
              estimatedCost: 0.2,
            },

            updatedAt:
              "2026-10-12T12:00:02.000Z",
          }
        );

      assert.equal(
        consumed.revision,
        3
      );

      assert.deepEqual(
        consumed.state.usage,
        {
          steps: 1,
          retries: 0,
          providerCalls: 1,
          estimatedCost: 0.2,
        }
      );

      const history =
        store.history(
          created.state.runId
        );

      assert.deepEqual(
        history.map(
          (item) =>
            item.revision
        ),
        [
          1,
          2,
          3,
        ]
      );

      const row =
        database.database
          .prepare(`
            SELECT
              record_type,
              record_id,
              sequence
            FROM goal_strategy_records
            WHERE record_type=?
              AND record_id=?
            ORDER BY sequence DESC
            LIMIT 1
          `)
          .get(
            "GOAL_MODE_RUN_STATE",
            created.state.runId
          );

      assert.equal(
        row.sequence,
        3
      );
    } finally {
      database.close();

      fs.rmSync(
        directory,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);

test(
  "5.0B CAS SQLite refuse un writer stale sans retry implicite",
  () => {
    const directory =
      fs.mkdtempSync(
        path.join(
          os.tmpdir(),
          "noon-50b-cas-"
        )
      );

    const file =
      path.join(
        directory,
        "goal-run.sqlite"
      );

    const dbA =
      createPersonalDatabase(
        file
      );

    const dbB =
      createPersonalDatabase(
        file
      );

    try {
      assert.equal(
        dbA.kind,
        "sqlite"
      );

      assert.equal(
        dbB.kind,
        "sqlite"
      );

      const storeA =
        createGoalModeRunStore({
          repository:
            createGoalModeRunRepository(
              dbA
            ),
        });

      const storeB =
        createGoalModeRunStore({
          repository:
            createGoalModeRunRepository(
              dbB
            ),
        });

      const created =
        storeA.create(
          makeContract(
            "goal-run-50b-cas"
          )
        );

      const staleRevision =
        created.revision;

      const winner =
        storeA.transition(
          created.state.runId,
          "RUNNING",
          {
            expectedRevision:
              staleRevision,

            transitionedAt:
              "2026-10-12T12:00:01.000Z",
          }
        );

      assert.equal(
        winner.revision,
        2
      );

      assert.throws(
        () =>
          storeB.transition(
            created.state.runId,
            "CANCELLED",
            {
              expectedRevision:
                staleRevision,

              transitionedAt:
                "2026-10-12T12:00:02.000Z",
            }
          ),
        {
          code:
            "GOAL_MODE_RUN_PERSISTENCE_CONFLICT",
        }
      );

      const current =
        storeB.get(
          created.state.runId
        );

      assert.equal(
        current.revision,
        2
      );

      assert.equal(
        current.state.status,
        "RUNNING"
      );
    } finally {
      dbA.close();
      dbB.close();

      fs.rmSync(
        directory,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);

test(
  "5.0B fallback expose explicitement l'absence de CAS atomique",
  () => {
    let state = {
      goal_strategy_records: [],
    };

    const wrapper = {
      kind:
        "json-fallback",

      load() {
        return structuredClone(
          state
        );
      },

      save(next) {
        state =
          structuredClone(
            next
          );
      },
    };

    const repository =
      createGoalModeRunRepository(
        wrapper
      );

    assert.deepEqual(
      describeGoalModeRunRepository(
        repository
      ),
      {
        backend:
          "JSON_FALLBACK",

        atomicRevisionCas:
          false,
      }
    );
  }
);
