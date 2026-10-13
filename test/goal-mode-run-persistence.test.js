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
  createGoalModeRunState,
  reserveGoalModePlanning,
  transitionGoalModeRun,
} = require("../services/goals/goal-mode-run-state");

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

      assert.deepEqual(
        created.state.usage,
        {
          steps: 0,
          retries: 0,
          providerCalls: 0,
          estimatedCost: 0,
        }
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
              retries: 1,
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
          retries: 1,
          providerCalls: 1,
          estimatedCost: 0.2,
        }
      );

      for (
        const key of [
          "steps",
          "retries",
          "providerCalls",
          "estimatedCost",
        ]
      ) {
        const incomplete =
          structuredClone(
            consumed.state
          );

        delete incomplete.usage[key];

        incomplete.updatedAt =
          "2026-10-12T12:00:03.000Z";

        assert.throws(
          () =>
            repository.save(
              incomplete,
              {
                expectedRevision:
                  consumed.revision,
              }
            ),
          {
            code:
              "GOAL_MODE_RUN_USAGE_INVALID",
          }
        );

        const reduced =
          structuredClone(
            consumed.state
          );

        reduced.usage[key] =
          key ===
            "estimatedCost"
            ? 0.1
            : 0;

        reduced.updatedAt =
          "2026-10-12T12:00:03.000Z";

        assert.throws(
          () =>
            repository.save(
              reduced,
              {
                expectedRevision:
                  consumed.revision,
              }
            ),
          {
            code:
              "GOAL_MODE_RUN_USAGE_REWIND",
          }
        );
      }

      assert.throws(
        () =>
          repository.save(
            consumed.state,
            {
              expectedRevision:
                running.revision,
            }
          ),
        {
          code:
            "GOAL_MODE_RUN_PERSISTENCE_CONFLICT",
        }
      );

      const unchanged =
        store.get(
          created.state.runId
        );

      assert.equal(
        unchanged.revision,
        consumed.revision
      );

      assert.equal(
        unchanged.state.usage
          .estimatedCost,
        0.2
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

function planningFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noon-50d0-"));
  const file = path.join(directory, "goal-run.sqlite");
  const dbA = createPersonalDatabase(file);
  const dbB = createPersonalDatabase(file);
  let clock = "2026-10-12T12:00:02.000Z";
  const repositoryA = createGoalModeRunRepository(dbA);
  const repositoryB = createGoalModeRunRepository(dbB);
  const storeA = createGoalModeRunStore({
    repository: repositoryA, now: () => clock,
    planningIdFactory: () => "goal-planning-test-1",
  });
  const storeB = createGoalModeRunStore({
    repository: repositoryB, now: () => clock,
    planningIdFactory: () => "goal-planning-test-2",
  });
  const created = storeA.create(makeContract("goal-run-50d0"));
  const running = storeA.transition(created.state.runId, "RUNNING", {
    expectedRevision: created.revision,
    transitionedAt: "2026-10-12T12:00:01.000Z",
  });
  function binding(revision = running.revision) {
    return {
      runId: running.state.runId, runRevision: revision,
      goalId: running.state.contract.goalRef.goalId,
      goalVersion: running.state.contract.goalRef.goalVersion,
      targetKind: "MILESTONE", targetId: "milestone-1",
      targetFingerprint: `sha256:${"a".repeat(64)}`,
    };
  }
  return {
    file, dbA, dbB, repositoryA, repositoryB, storeA, storeB, running, binding,
    setTime(value) { clock = value; },
    close() {
      dbA.close(); dbB.close();
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

test("5.0D-0 réservation SQLite atomique et révisions strictes sur deux connexions", () => {
  const fixture = planningFixture();
  try {
    const { storeA, storeB, running, binding } = fixture;
    for (const invalid of [undefined, null, "2", 2.5, Number.MAX_SAFE_INTEGER]) {
      assert.throws(() => storeA.reservePlanning(running.state.runId, {
        expectedRevision: invalid, binding: binding(),
        reservedProviderCalls: 1, reservedCost: 0.4,
      }), { code: "GOAL_MODE_RUN_REVISION_REQUIRED" });
    }
    for (const invalidBinding of [
      { ...binding(), runId: "different" },
      { ...binding(), goalVersion: 99 },
      { ...binding(), targetKind: "UNKNOWN" },
      { ...binding(), targetFingerprint: "forged" },
      { ...binding(), runRevision: 3 },
    ]) {
      assert.throws(() => storeA.reservePlanning(running.state.runId, {
        expectedRevision: running.revision, binding: invalidBinding,
        reservedProviderCalls: 1, reservedCost: 0.4,
      }), { code: "GOAL_MODE_PLANNING_BINDING_INVALID" });
    }
    const reserved = storeA.reservePlanning(running.state.runId, {
      expectedRevision: running.revision, binding: binding(),
      reservedProviderCalls: 3, reservedCost: 1,
    });
    assert.equal(reserved.revision, 3);
    assert.deepEqual(reserved.state.usage, running.state.usage);
    assert.deepEqual(Object.keys(reserved.state.planningReservations[0]).sort(), [
      "reservationId", "binding", "status", "reservedProviderCalls",
      "reservedCost", "reservedAt", "mayHaveStartedAt", "closedAt",
      "observedProviderCalls", "observedCost", "unknownReasonCode",
    ].sort());
    assert.throws(() => storeB.reservePlanning(running.state.runId, {
      expectedRevision: running.revision, binding: binding(),
      reservedProviderCalls: 1, reservedCost: 0.1,
    }), { code: "GOAL_MODE_RUN_PERSISTENCE_CONFLICT" });
    assert.throws(() => storeA.reservePlanning(running.state.runId, {
      expectedRevision: reserved.revision, binding: binding(reserved.revision),
      reservedProviderCalls: 1, reservedCost: 0.1,
    }), { code: "GOAL_MODE_PLANNING_IN_FLIGHT" });
    assert.throws(() => storeA.consume(running.state.runId, {
      expectedRevision: reserved.revision, currentGoalVersion: 2,
      usageDelta: { steps: 1 },
    }), { code: "GOAL_MODE_PLANNING_IN_FLIGHT" });
    assert.equal(storeB.history(running.state.runId).length, 3);
  } finally {
    fixture.close();
  }
});

test("5.0D-0 frontière durable, résultat stale et coût observé persisté sans double compte", () => {
  const fixture = planningFixture();
  try {
    const { storeA, storeB, running, binding } = fixture;
    const reserved = storeA.reservePlanning(running.state.runId, {
      expectedRevision: running.revision, binding: binding(),
      reservedProviderCalls: 1, reservedCost: 0.4,
    });
    fixture.setTime("2026-10-12T12:00:03.000Z");
    const started = storeA.markPlanningMayHaveStarted(running.state.runId, {
      expectedRevision: reserved.revision, reservationId: "goal-planning-test-1",
    });
    assert.equal(storeB.get(running.state.runId).state.planningReservations[0].status, "MAY_HAVE_STARTED");
    const paused = storeB.transition(running.state.runId, "PAUSED", {
      expectedRevision: started.revision,
      transitionedAt: "2026-10-12T12:00:04.000Z",
    });
    fixture.setTime("2026-10-12T12:00:05.000Z");
    assert.throws(() => storeA.reconcilePlanning(running.state.runId, {
      expectedRevision: started.revision, reservationId: "goal-planning-test-1",
      observedProviderCalls: 1, observedCost: 0.25, observationComplete: true,
    }), { code: "GOAL_MODE_RUN_PERSISTENCE_CONFLICT" });
    const reconciled = storeA.reconcilePlanning(running.state.runId, {
      expectedRevision: paused.revision, reservationId: "goal-planning-test-1",
      observedProviderCalls: 1, observedCost: 0.25, observationComplete: true,
    });
    assert.equal(reconciled.state.status, "PAUSED");
    assert.equal(reconciled.state.usage.providerCalls, 1);
    assert.equal(reconciled.state.usage.estimatedCost, 0.25);
    assert.equal(storeB.get(running.state.runId).state.usage.estimatedCost, 0.25);
    assert.throws(() => storeA.reconcilePlanning(running.state.runId, {
      expectedRevision: reconciled.revision, reservationId: "goal-planning-test-1",
      observedProviderCalls: 1, observedCost: 0.25, observationComplete: true,
    }), { code: "GOAL_MODE_PLANNING_TRANSITION_INVALID" });
    assert.deepEqual(storeB.history(running.state.runId).map((item) => item.revision), [1, 2, 3, 4, 5, 6]);
  } finally {
    fixture.close();
  }
});

test("5.0D-0 UNKNOWN survit à la réouverture et bloque toute nouvelle dépense", () => {
  const fixture = planningFixture();
  try {
    const { storeA, running, binding } = fixture;
    const reserved = storeA.reservePlanning(running.state.runId, {
      expectedRevision: running.revision, binding: binding(),
      reservedProviderCalls: 1, reservedCost: 0.4,
    });
    fixture.setTime("2026-10-12T12:00:03.000Z");
    const started = storeA.markPlanningMayHaveStarted(running.state.runId, {
      expectedRevision: reserved.revision, reservationId: "goal-planning-test-1",
    });
    fixture.setTime("2026-10-12T12:00:04.000Z");
    const unknown = storeA.markPlanningUnknown(running.state.runId, {
      expectedRevision: started.revision, reservationId: "goal-planning-test-1",
      observedProviderCalls: 1, reasonCode: "USAGE_INCOMPLETE",
    });
    const reopenedDatabase = createPersonalDatabase(fixture.file);
    try {
      const reopened = createGoalModeRunStore({
        repository: createGoalModeRunRepository(reopenedDatabase),
        now: () => "2026-10-12T12:00:05.000Z",
      });
      const current = reopened.get(running.state.runId);
      assert.equal(current.revision, unknown.revision);
      assert.equal(current.state.planningReservations[0].status, "UNKNOWN");
      assert.equal(current.state.planningReservations[0].observedProviderCalls, 1);
      assert.equal(current.state.planningReservations[0].observedCost, null);
      assert.throws(() => reopened.reservePlanning(running.state.runId, {
        expectedRevision: current.revision, binding: binding(current.revision),
        reservedProviderCalls: 1, reservedCost: 0.1,
      }), { code: "GOAL_MODE_PLANNING_UNKNOWN_BLOCKED" });
      assert.throws(() => reopened.consume(running.state.runId, {
        expectedRevision: current.revision, currentGoalVersion: 2,
        usageDelta: { steps: 1 },
      }), { code: "GOAL_MODE_PLANNING_UNKNOWN_BLOCKED" });
    } finally {
      reopenedDatabase.close();
    }
  } finally {
    fixture.close();
  }
});

test("5.0D-0 MAY_HAVE_STARTED reste bloquant après réouverture sans timeout ni replay", () => {
  const fixture = planningFixture();
  try {
    const { storeA, running, binding } = fixture;
    const reserved = storeA.reservePlanning(running.state.runId, {
      expectedRevision: running.revision, binding: binding(),
      reservedProviderCalls: 1, reservedCost: 0.4,
    });
    fixture.setTime("2026-10-12T12:00:03.000Z");
    const started = storeA.markPlanningMayHaveStarted(running.state.runId, {
      expectedRevision: reserved.revision, reservationId: "goal-planning-test-1",
    });
    const reopenedDatabase = createPersonalDatabase(fixture.file);
    try {
      const reopened = createGoalModeRunStore({
        repository: createGoalModeRunRepository(reopenedDatabase),
        now: () => "2026-10-13T12:00:00.000Z",
      });
      const record = reopened.get(running.state.runId);
      assert.equal(record.revision, started.revision);
      assert.equal(record.state.planningReservations[0].status, "MAY_HAVE_STARTED");
      assert.throws(() => reopened.reservePlanning(running.state.runId, {
        expectedRevision: record.revision, binding: binding(record.revision),
        reservedProviderCalls: 1, reservedCost: 0.1,
      }), { code: "GOAL_MODE_PLANNING_IN_FLIGHT" });
      assert.deepEqual(reopened.get(running.state.runId), record);
    } finally {
      reopenedDatabase.close();
    }
  } finally {
    fixture.close();
  }
});

test("5.0D-0 après réconciliation les plafonds coût et appels restent épuisés", () => {
  const fixture = planningFixture();
  try {
    const { storeA, storeB, running, binding } = fixture;
    const reserved = storeA.reservePlanning(running.state.runId, {
      expectedRevision: running.revision, binding: binding(),
      reservedProviderCalls: 3, reservedCost: 1,
    });
    fixture.setTime("2026-10-12T12:00:03.000Z");
    const started = storeA.markPlanningMayHaveStarted(running.state.runId, {
      expectedRevision: reserved.revision, reservationId: "goal-planning-test-1",
    });
    fixture.setTime("2026-10-12T12:00:04.000Z");
    const reconciled = storeA.reconcilePlanning(running.state.runId, {
      expectedRevision: started.revision, reservationId: "goal-planning-test-1",
      observedProviderCalls: 3, observedCost: 1, observationComplete: true,
    });
    assert.deepEqual(reconciled.state.usage, {
      steps: 0, retries: 0, providerCalls: 3, estimatedCost: 1,
    });
    assert.throws(() => storeB.reservePlanning(running.state.runId, {
      expectedRevision: reconciled.revision, binding: binding(reconciled.revision),
      reservedProviderCalls: 1, reservedCost: 0,
    }), { code: "GOAL_MODE_PLANNING_BUDGET_BLOCKED" });
  } finally {
    fixture.close();
  }
});

test("5.0D-0 CAS refuse une mutation interposée entre lecture et save", () => {
  const fixture = planningFixture();
  try {
    const { storeB, repositoryA, running, binding } = fixture;
    const next = reserveGoalModePlanning(running.state, {
      reservationId: "server-generated-test", binding: binding(),
      reservedProviderCalls: 1, reservedCost: 0.2,
      reservedAt: "2026-10-12T12:00:02.000Z",
    });
    const winner = storeB.consume(running.state.runId, {
      expectedRevision: running.revision, currentGoalVersion: 2,
      usageDelta: { providerCalls: 1, estimatedCost: 0.1 },
      updatedAt: "2026-10-12T12:00:02.000Z",
    });
    assert.throws(() => repositoryA.save(next, {
      expectedRevision: running.revision,
    }), { code: "GOAL_MODE_RUN_PERSISTENCE_CONFLICT" });
    const reread = storeB.get(running.state.runId);
    assert.equal(reread.revision, winner.revision);
    assert.equal(reread.state.planningReservations.length, 0);
    assert.equal(reread.state.usage.providerCalls, 1);
  } finally {
    fixture.close();
  }
});

test("5.0D-0 le CAS repository refuse une réservation forgée hors budget et un accounting pendant réservation", () => {
  const fixture = planningFixture();
  try {
    const { repositoryA, storeA, running, binding } = fixture;
    const valid = reserveGoalModePlanning(running.state, {
      reservationId: "server-generated-test", binding: binding(),
      reservedProviderCalls: 1, reservedCost: 0.2,
      reservedAt: "2026-10-12T12:00:02.000Z",
    });
    const oversized = structuredClone(valid);
    oversized.planningReservations[0].reservedProviderCalls = 4;
    oversized.planningReservations[0].reservedCost = 2;
    assert.throws(() => repositoryA.save(oversized, {
      expectedRevision: running.revision,
    }), { code: "GOAL_MODE_PLANNING_BUDGET_BLOCKED" });
    const reserved = repositoryA.save(valid, { expectedRevision: running.revision });
    const bypass = structuredClone(reserved.state);
    bypass.usage.providerCalls = 1;
    assert.throws(() => repositoryA.save(bypass, {
      expectedRevision: reserved.revision,
    }), { code: "GOAL_MODE_PLANNING_IN_FLIGHT" });
    assert.deepEqual(storeA.get(running.state.runId).state.usage, running.state.usage);
  } finally {
    fixture.close();
  }
});

test("5.0D-0 départ refusé après une autre révision du run", () => {
  const fixture = planningFixture();
  try {
    const { storeA, storeB, running, binding } = fixture;
    const reserved = storeA.reservePlanning(running.state.runId, {
      expectedRevision: running.revision, binding: binding(),
      reservedProviderCalls: 1, reservedCost: 0.2,
    });
    const paused = storeB.transition(running.state.runId, "PAUSED", {
      expectedRevision: reserved.revision,
      transitionedAt: "2026-10-12T12:00:03.000Z",
    });
    const resumed = storeB.transition(running.state.runId, "RUNNING", {
      expectedRevision: paused.revision,
      transitionedAt: "2026-10-12T12:00:04.000Z",
    });
    fixture.setTime("2026-10-12T12:00:05.000Z");
    assert.throws(() => storeA.markPlanningMayHaveStarted(running.state.runId, {
      expectedRevision: resumed.revision,
      reservationId: "goal-planning-test-1",
    }), { code: "GOAL_MODE_PLANNING_TRANSITION_INVALID" });
    assert.equal(storeA.get(running.state.runId).state.planningReservations[0].status, "PREPARED");
    const unknown = storeA.markPlanningUnknown(running.state.runId, {
      expectedRevision: resumed.revision,
      reservationId: "goal-planning-test-1",
      reasonCode: "OUTCOME_UNCERTAIN",
    });
    assert.equal(unknown.state.planningReservations[0].status, "UNKNOWN");
  } finally {
    fixture.close();
  }
});

test("5.0D-0 fallback et repository non reconnu refusent la réservation", () => {
  let fallback = { goal_strategy_records: [] };
  const repository = createGoalModeRunRepository({
    kind: "json-fallback",
    load: () => structuredClone(fallback),
    save: (next) => { fallback = structuredClone(next); },
  });
  const store = createGoalModeRunStore({
    repository, now: () => "2026-10-12T12:00:02.000Z",
  });
  const created = store.create(makeContract("goal-run-50d0"));
  const running = store.transition(created.state.runId, "RUNNING", {
    expectedRevision: created.revision,
    transitionedAt: "2026-10-12T12:00:01.000Z",
  });
  const binding = {
    runId: running.state.runId, runRevision: running.revision,
    goalId: running.state.contract.goalRef.goalId,
    goalVersion: running.state.contract.goalRef.goalVersion,
    targetKind: "MILESTONE", targetId: "milestone-1",
    targetFingerprint: `sha256:${"a".repeat(64)}`,
  };
  assert.throws(() => store.reservePlanning(running.state.runId, {
    expectedRevision: running.revision, binding,
    reservedProviderCalls: 1, reservedCost: 0.1,
  }), { code: "GOAL_MODE_PLANNING_ATOMIC_BACKEND_REQUIRED" });
  const unknown = createGoalModeRunStore({
    repository: { ...repository, kind: "sqlite", atomicRevisionCas: true },
  });
  assert.throws(() => unknown.reservePlanning(running.state.runId, {
    expectedRevision: running.revision, binding,
    reservedProviderCalls: 1, reservedCost: 0.1,
  }), { code: "GOAL_MODE_PLANNING_ATOMIC_BACKEND_REQUIRED" });
  assert.equal(store.get(running.state.runId).revision, running.revision);
});

test("5.0D-0 lit un snapshot historique 5.0B sans champ de planning", () => {
  const fixture = planningFixture();
  try {
    const legacy = structuredClone(createGoalModeRunState({
      contract: makeContract("legacy-50b"),
    }));
    delete legacy.planningReservations;
    const created = fixture.repositoryA.save(legacy, { expectedRevision: 0 });
    const running = fixture.repositoryA.save(transitionGoalModeRun(legacy, "RUNNING", {
      transitionedAt: "2026-10-12T12:00:01.000Z",
    }), { expectedRevision: created.revision });
    assert.equal(running.state.planningReservations, undefined);
    const reserved = fixture.storeA.reservePlanning("legacy-50b", {
      expectedRevision: running.revision,
      binding: {
        runId: "legacy-50b", runRevision: running.revision,
        goalId: running.state.contract.goalRef.goalId,
        goalVersion: running.state.contract.goalRef.goalVersion,
        targetKind: "SUCCESS_CRITERION", targetId: "criterion-persist",
        targetFingerprint: `sha256:${"b".repeat(64)}`,
      },
      reservedProviderCalls: 1, reservedCost: 0.1,
    });
    assert.equal(reserved.state.planningReservations.length, 1);
  } finally {
    fixture.close();
  }
});
