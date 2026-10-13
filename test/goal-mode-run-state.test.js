"use strict";

const assert =
  require("node:assert/strict");

const test =
  require("node:test");

const {
  applyGoalModeUsage,
  assertGoalModeRunForward,
  assertGoalModeRunState,
  createGoalModeRunState,
  markGoalModePlanningMayHaveStarted,
  markGoalModePlanningUnknown,
  reconcileGoalModePlanning,
  reserveGoalModePlanning,
  transitionGoalModeRun,
} = require(
  "../services/goals/goal-mode-run-state"
);

function planningBinding() {
  return {
    runId: "goal-run-50b",
    runRevision: 2,
    goalId: "goal-50b",
    goalVersion: 3,
    targetKind: "MILESTONE",
    targetId: "milestone-1",
    targetFingerprint: `sha256:${"a".repeat(64)}`,
  };
}

function runningForPlanning() {
  return transitionGoalModeRun(createGoalModeRunState({ contract: contract() }), "RUNNING", {
    transitionedAt: "2026-10-12T12:00:01.000Z",
  });
}

test("5.0D-0 réserve sans dépense puis compte une observation terminale zéro explicite", () => {
  const running = runningForPlanning();
  const prepared = reserveGoalModePlanning(running, {
    reservationId: "planning-1",
    binding: planningBinding(),
    reservedProviderCalls: 1,
    reservedCost: 0.4,
    reservedAt: "2026-10-12T12:00:02.000Z",
  });
  assert.deepEqual(prepared.usage, running.usage);
  assert.equal(prepared.planningReservations[0].status, "PREPARED");
  assert.equal(Object.isFrozen(prepared.planningReservations[0]), true);
  assertGoalModeRunForward(running, prepared, { currentRevision: 2 });
  assert.throws(() => reserveGoalModePlanning(prepared, {
    reservationId: "planning-2", binding: planningBinding(),
    reservedProviderCalls: 1, reservedCost: 0.1,
    reservedAt: "2026-10-12T12:00:02.000Z",
  }), { code: "GOAL_MODE_PLANNING_IN_FLIGHT" });
  const started = markGoalModePlanningMayHaveStarted(prepared, {
    reservationId: "planning-1", markedAt: "2026-10-12T12:00:03.000Z",
  });
  assertGoalModeRunForward(prepared, started);
  const terminal = reconcileGoalModePlanning(started, {
    reservationId: "planning-1", observedProviderCalls: 1,
    observedCost: 0, observationComplete: true,
    reconciledAt: "2026-10-12T12:00:04.000Z",
  });
  assert.deepEqual(terminal.usage, {
    steps: 0, retries: 0, providerCalls: 1, estimatedCost: 0,
  });
  assertGoalModeRunForward(started, terminal);
  assert.throws(() => reconcileGoalModePlanning(terminal, {
    reservationId: "planning-1", observedProviderCalls: 1,
    observedCost: 0, observationComplete: true,
    reconciledAt: "2026-10-12T12:00:05.000Z",
  }), { code: "GOAL_MODE_PLANNING_TRANSITION_INVALID" });
});

test("5.0D-0 refuse usage absent et conserve une observation partielle UNKNOWN", () => {
  const prepared = reserveGoalModePlanning(runningForPlanning(), {
    reservationId: "planning-1", binding: planningBinding(),
    reservedProviderCalls: 1, reservedCost: 0.4,
    reservedAt: "2026-10-12T12:00:02.000Z",
  });
  const started = markGoalModePlanningMayHaveStarted(prepared, {
    reservationId: "planning-1", markedAt: "2026-10-12T12:00:03.000Z",
  });
  for (const input of [
    { observedProviderCalls: 1 },
    { observedCost: 0 },
    { observedProviderCalls: null, observedCost: 0 },
    { observedProviderCalls: 0, observedCost: 0 },
  ]) {
    assert.throws(() => reconcileGoalModePlanning(started, {
      reservationId: "planning-1", observationComplete: true,
      reconciledAt: "2026-10-12T12:00:04.000Z", ...input,
    }), { code: "GOAL_MODE_PLANNING_USAGE_INCOMPLETE" });
  }
  const unknown = markGoalModePlanningUnknown(started, {
    reservationId: "planning-1", observedProviderCalls: 1,
    reasonCode: "USAGE_INCOMPLETE", markedAt: "2026-10-12T12:00:04.000Z",
  });
  assert.equal(unknown.planningReservations[0].observedProviderCalls, 1);
  assert.equal(unknown.planningReservations[0].observedCost, null);
  assert.deepEqual(unknown.usage, started.usage);
  assertGoalModeRunForward(started, unknown);
  assert.throws(() => applyGoalModeUsage(unknown, {
    currentGoalVersion: 3, usageDelta: { steps: 1 },
    updatedAt: "2026-10-12T12:00:05.000Z",
  }), { code: "GOAL_MODE_PLANNING_UNKNOWN_BLOCKED" });
  assert.throws(() => markGoalModePlanningMayHaveStarted(unknown, {
    reservationId: "planning-1", markedAt: "2026-10-12T12:00:05.000Z",
  }), { code: "GOAL_MODE_PLANNING_TRANSITION_INVALID" });
});

test("5.0D-0 conserve le dépassement observé et interdit mutation d'une tentative historique", () => {
  const prepared = reserveGoalModePlanning(runningForPlanning(), {
    reservationId: "planning-1", binding: planningBinding(),
    reservedProviderCalls: 1, reservedCost: 0.2,
    reservedAt: "2026-10-12T12:00:02.000Z",
  });
  const started = markGoalModePlanningMayHaveStarted(prepared, {
    reservationId: "planning-1", markedAt: "2026-10-12T12:00:03.000Z",
  });
  const terminal = reconcileGoalModePlanning(started, {
    reservationId: "planning-1", observedProviderCalls: 5,
    observedCost: 3, observationComplete: true,
    reconciledAt: "2026-10-12T12:00:04.000Z",
  });
  assert.equal(terminal.usage.providerCalls, 5);
  assert.equal(terminal.usage.estimatedCost, 3);
  assertGoalModeRunState(terminal);
  assertGoalModeRunForward(started, terminal);
  assert.throws(() => reserveGoalModePlanning(terminal, {
    reservationId: "planning-2", binding: planningBinding(),
    reservedProviderCalls: 1, reservedCost: 0,
    reservedAt: "2026-10-12T12:00:05.000Z",
  }), { code: "GOAL_MODE_PLANNING_RESERVATION_EXCEEDED" });
  const tampered = structuredClone(terminal);
  tampered.planningReservations[0].reservedCost = 0.1;
  tampered.updatedAt = "2026-10-12T12:00:05.000Z";
  assert.throws(() => assertGoalModeRunForward(terminal, tampered), {
    code: "GOAL_MODE_PLANNING_TRANSITION_INVALID",
  });
});

test("5.0D-0 un dépassement de réservation bloque la suite même sous le plafond global", () => {
  const prepared = reserveGoalModePlanning(runningForPlanning(), {
    reservationId: "planning-1", binding: planningBinding(),
    reservedProviderCalls: 1, reservedCost: 0.2,
    reservedAt: "2026-10-12T12:00:02.000Z",
  });
  const started = markGoalModePlanningMayHaveStarted(prepared, {
    reservationId: "planning-1", markedAt: "2026-10-12T12:00:03.000Z",
  });
  const terminal = reconcileGoalModePlanning(started, {
    reservationId: "planning-1", observedProviderCalls: 1,
    observedCost: 0.3, observationComplete: true,
    reconciledAt: "2026-10-12T12:00:04.000Z",
  });
  assert.equal(terminal.usage.estimatedCost, 0.3);
  assert.throws(() => reserveGoalModePlanning(terminal, {
    reservationId: "planning-2", binding: planningBinding(),
    reservedProviderCalls: 1, reservedCost: 0.1,
    reservedAt: "2026-10-12T12:00:05.000Z",
  }), { code: "GOAL_MODE_PLANNING_RESERVATION_EXCEEDED" });
  assert.throws(() => applyGoalModeUsage(terminal, {
    currentGoalVersion: 3, usageDelta: { steps: 1 },
    updatedAt: "2026-10-12T12:00:05.000Z",
  }), { code: "GOAL_MODE_PLANNING_RESERVATION_EXCEEDED" });
});

const {
  createGoalModeRunContract,
} = require(
  "../services/goals/goal-mode-run-contract"
);

function contract() {
  return createGoalModeRunContract({
    goal: {
      goalId:
        "goal-50b",

      title:
        "Goal 5.0B",

      status:
        "ACTIVE",

      outcomeDefinition:
        "Valider la persistance du Goal Run.",

      successCriteria: [
        {
          criterionId:
            "criterion-pass",

          type:
            "BOOLEAN",

          targetValue:
            true,
        },
      ],

      linkedProjectIds: [
        "project-noon",
      ],

      linkedWorkspaceIds: [
        "workspace-noon",
      ],

      constraints: [],
      profileScope:
        "arnaud",
      sensitivity:
        "NORMAL",
      userConfirmed:
        true,
      version: 3,
    },

    request: {
      userConfirmed:
        true,

      workspaceId:
        "workspace-noon",

      projectId:
        "project-noon",

      limits: {
        maxSteps: 5,
        maxRetries: 2,
        maxProviderCalls: 4,
        maxDuration:
          60_000,
        maxEstimatedCost: 2,
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
        "goal-run-50b",
  });
}

test(
  "5.0B crée un état READY sans autorité ni step ref",
  () => {
    const value =
      createGoalModeRunState({
        contract:
          contract(),
      });

    assert.equal(
      value.status,
      "READY"
    );

    assert.deepEqual(
      value.usage,
      {
        steps: 0,
        retries: 0,
        providerCalls: 0,
        estimatedCost: 0,
      }
    );

    assert.equal(
      value.currentStepRef,
      null
    );

    assert.equal(
      Object.isFrozen(
        value
      ),
      true
    );
  }
);

test(
  "5.0B applique uniquement les transitions autorisées",
  () => {
    const ready =
      createGoalModeRunState({
        contract:
          contract(),
      });

    const running =
      transitionGoalModeRun(
        ready,
        "RUNNING",
        {
          transitionedAt:
            "2026-10-12T12:00:01.000Z",
        }
      );

    assert.equal(
      running.status,
      "RUNNING"
    );

    assert.equal(
      running.startedAt,
      "2026-10-12T12:00:01.000Z"
    );

    const waiting =
      transitionGoalModeRun(
        running,
        "WAITING_APPROVAL",
        {
          reasonCode:
            "APPROVAL_REQUIRED",

          transitionedAt:
            "2026-10-12T12:00:02.000Z",
        }
      );

    assert.equal(
      waiting.reasonCode,
      "APPROVAL_REQUIRED"
    );

    const resumed =
      transitionGoalModeRun(
        waiting,
        "RUNNING",
        {
          transitionedAt:
            "2026-10-12T12:00:03.000Z",
        }
      );

    assert.equal(
      resumed.startedAt,
      running.startedAt
    );

    const succeeded =
      transitionGoalModeRun(
        resumed,
        "SUCCEEDED",
        {
          reasonCode:
            "SUCCESS_CRITERIA_MET",

          transitionedAt:
            "2026-10-12T12:00:04.000Z",
        }
      );

    assert.equal(
      succeeded.completedAt,
      "2026-10-12T12:00:04.000Z"
    );

    assert.throws(
      () =>
        transitionGoalModeRun(
          succeeded,
          "RUNNING"
        ),
      {
        code:
          "GOAL_MODE_RUN_TRANSITION_INVALID",
      }
    );
  }
);

test(
  "5.0B autorise annulation avant démarrage sans inventer startedAt",
  () => {
    const ready =
      createGoalModeRunState({
        contract:
          contract(),
      });

    const cancelled =
      transitionGoalModeRun(
        ready,
        "CANCELLED",
        {
          reasonCode:
            "USER_CANCELLED",

          transitionedAt:
            "2026-10-12T12:00:01.000Z",
        }
      );

    assert.equal(
      cancelled.startedAt,
      null
    );

    assert.equal(
      cancelled.completedAt,
      "2026-10-12T12:00:01.000Z"
    );
  }
);

test(
  "5.0B accounting global est monotone et borné",
  () => {
    const ready =
      createGoalModeRunState({
        contract:
          contract(),
      });

    const running =
      transitionGoalModeRun(
        ready,
        "RUNNING",
        {
          transitionedAt:
            "2026-10-12T12:00:01.000Z",
        }
      );

    const used =
      applyGoalModeUsage(
        running,
        {
          currentGoalVersion:
            3,

          usageDelta: {
            steps: 1,
            retries: 1,
            providerCalls: 2,
            estimatedCost: 0.5,
          },

          updatedAt:
            "2026-10-12T12:00:02.000Z",
        }
      );

    assert.deepEqual(
      used.usage,
      {
        steps: 1,
        retries: 1,
        providerCalls: 2,
        estimatedCost: 0.5,
      }
    );

    assert.throws(
      () =>
        applyGoalModeUsage(
          used,
          {
            currentGoalVersion:
              3,

            usageDelta: {
              steps: 5,
            },

            updatedAt:
              "2026-10-12T12:00:03.000Z",
          }
        ),
      {
        code:
          "GOAL_MODE_RUN_BUDGET_BLOCKED",
      }
    );
  }
);

test(
  "5.0B refuse accounting si Goal version a changé",
  () => {
    const running =
      transitionGoalModeRun(
        createGoalModeRunState({
          contract:
            contract(),
        }),
        "RUNNING",
        {
          transitionedAt:
            "2026-10-12T12:00:01.000Z",
        }
      );

    assert.throws(
      () =>
        applyGoalModeUsage(
          running,
          {
            currentGoalVersion:
              4,

            usageDelta: {
              steps: 1,
            },

            updatedAt:
              "2026-10-12T12:00:02.000Z",
          }
        ),
      (error) => {
        assert.equal(
          error.code,
          "GOAL_MODE_RUN_BUDGET_BLOCKED"
        );

        assert.equal(
          error.details
            ?.assessment
            ?.reasonCode,
          "GOAL_STALE"
        );

        return true;
      }
    );
  }
);

test(
  "5.0B repository forward refuse rewind usage et mutation de contrat",
  () => {
    const ready =
      createGoalModeRunState({
        contract:
          contract(),
      });

    const running =
      transitionGoalModeRun(
        ready,
        "RUNNING",
        {
          transitionedAt:
            "2026-10-12T12:00:01.000Z",
        }
      );

    const used =
      applyGoalModeUsage(
        running,
        {
          currentGoalVersion:
            3,

          usageDelta: {
            steps: 1,
          },

          updatedAt:
            "2026-10-12T12:00:02.000Z",
        }
      );

    const rewound =
      structuredClone(
        used
      );

    rewound.usage.steps =
      0;

    assert.throws(
      () =>
        assertGoalModeRunForward(
          used,
          rewound
        ),
      {
        code:
          "GOAL_MODE_RUN_USAGE_REWIND",
      }
    );

    const mutated =
      structuredClone(
        used
      );

    mutated.contract.limits
      .maxSteps =
      999;

    assert.throws(
      () =>
        assertGoalModeRunForward(
          used,
          mutated
        ),
      {
        code:
          "GOAL_MODE_RUN_IMMUTABLE_CHANGED",
      }
    );
  }
);

test(
  "5.0B refuse un accounting persisté absent ou incomplet",
  () => {
    const ready =
      createGoalModeRunState({
        contract:
          contract(),
      });

    const running =
      transitionGoalModeRun(
        ready,
        "RUNNING",
        {
          transitionedAt:
            "2026-10-12T12:00:01.000Z",
        }
      );

    const used =
      applyGoalModeUsage(
        running,
        {
          currentGoalVersion:
            3,

          usageDelta: {
            steps: 1,
            estimatedCost: 0.5,
          },

          updatedAt:
            "2026-10-12T12:00:02.000Z",
        }
      );

    const absent =
      structuredClone(
        used
      );

    delete absent.usage;

    assert.throws(
      () =>
        assertGoalModeRunState(
          absent
        ),
      {
        code:
          "GOAL_MODE_RUN_USAGE_INVALID",
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
      for (
        const invalid of [
          undefined,
          null,
        ]
      ) {
        const incomplete =
          structuredClone(
            used
          );

        if (
          invalid ===
            undefined
        ) {
          delete incomplete
            .usage[key];
        } else {
          incomplete
            .usage[key] =
            invalid;
        }

        incomplete.updatedAt =
          "2026-10-12T12:00:03.000Z";

        assert.throws(
          () =>
            assertGoalModeRunState(
              incomplete
            ),
          {
            code:
              "GOAL_MODE_RUN_USAGE_INVALID",
          }
        );

        assert.throws(
          () =>
            assertGoalModeRunForward(
              used,
              incomplete
            ),
          {
            code:
              "GOAL_MODE_RUN_USAGE_INVALID",
          }
        );
      }
    }
  }
);
