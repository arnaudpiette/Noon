"use strict";

// Shared setup for test/goal-mode-next-step-planner*.test.js (moved verbatim from test/goal-mode-next-step-planner.test.js, V3-L7).

const assert =
  require("node:assert/strict");

const crypto =
  require("node:crypto");

const {
  createGoalModeRunContract,
} = require(
  "../../services/goals/goal-mode-run-contract"
);

const {
  createGoalModeRunState,
  transitionGoalModeRun,
} = require(
  "../../services/goals/goal-mode-run-state"
);

const {
  ACTIONABLE_MILESTONE_STATUSES,
  createGoalModeNextStepPlanner,
  TERMINAL_MILESTONE_STATUSES,
} = require(
  "../../services/goals/goal-mode-next-step-planner"
);

const selectionEngines =
  new WeakMap();

function selectGoalModeNextTarget({
  goalStrategyEngine,
  runSnapshot,
} = {}) {
  const planner =
    createGoalModeNextStepPlanner({
      goalStrategyEngine,
      runStore: {
        get() {
          return runSnapshot;
        },
      },
    });

  const selection =
    planner.select({
      runId:
        runSnapshot.state.runId,
    });

  selectionEngines.set(
    selection,
    goalStrategyEngine
  );

  return selection;
}

function validateGoalModeStepProposal({
  runSnapshot,
  selection,
  proposal,
  now,
  idFactory,
} = {}) {
  const planner =
    createGoalModeNextStepPlanner({
      goalStrategyEngine:
        selectionEngines.get(
          selection
        ),
      runStore: {
        get() {
          return runSnapshot;
        },
      },
      ...(now ? { now } : {}),
      ...(idFactory
        ? { idFactory }
        : {}),
    });

  return planner.validate({
    runId:
      runSnapshot.state.runId,
    selection,
    proposal,
  });
}

function goal(
  overrides = {}
) {
  return {
    goalId:
      "goal-50c",

    title:
      "Goal Mode 5.0C",

    status:
      "ACTIVE",

    outcomeDefinition:
      "Atteindre le résultat Goal Mode avec preuves.",

    successCriteria: [
      {
        criterionId:
          "criterion-global",

        description:
          "Le résultat global est vérifié.",

        type:
          "BOOLEAN",

        targetValue:
          true,

        currentValue:
          false,

        status:
          "NOT_MET",

        evidenceRefs: [],
      },
    ],

    milestones: [
      {
        milestoneId:
          "milestone-1",

        goalId:
          "goal-50c",

        title:
          "Première étape",

        description:
          "Réaliser la première étape utile.",

        status:
          "IN_PROGRESS",

        dependencies: [],

        linkedProjectIds: [
          "project-noon",
        ],

        completionCriteria: [
          {
            criterionId:
              "criterion-m1",

            description:
              "La première étape est vérifiée.",

            type:
              "BOOLEAN",

            targetValue:
              true,

            currentValue:
              false,

            status:
              "NOT_MET",

            evidenceRefs: [],
          },
        ],

        evidenceRefs: [],
      },

      {
        milestoneId:
          "milestone-2",

        goalId:
          "goal-50c",

        title:
          "Deuxième étape",

        description:
          "Étape suivante.",

        status:
          "NOT_STARTED",

        dependencies: [
          "milestone-1",
        ],

        linkedProjectIds: [
          "project-noon",
        ],

        completionCriteria: [],

        evidenceRefs: [],
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

    version: 5,

    ...overrides,
  };
}

function engine(
  currentGoal
) {
  return {
    registry: {
      get(goalId) {
        assert.equal(
          goalId,
          currentGoal.goalId
        );

        return currentGoal;
      },
    },
  };
}

function runningSnapshot(
  currentGoal = goal(),
  {
    capabilityCeilings = {
      network: true,
      gitWrite: false,
      destructiveActions:
        false,
    },

    limits = {
      maxSteps: 4,
      maxRetries: 1,
      maxProviderCalls: 3,
      maxDuration:
        60_000,
      maxEstimatedCost: 2,
    },
  } = {}
) {
  const contract =
    createGoalModeRunContract({
      goal:
        currentGoal,

      request: {
        userConfirmed:
          true,

        workspaceId:
          "workspace-noon",

        projectId:
          "project-noon",

        limits,

        capabilityCeilings,
      },

      now:
        () =>
          new Date(
            "2026-10-12T12:00:00.000Z"
          ),

      idFactory:
        () =>
          "goal-run-50c",
    });

  const ready =
    createGoalModeRunState({
      contract,
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

  return {
    revision: 2,
    state:
      running,
  };
}

function directFixture({
  currentGoal = goal(),
  snapshot = null,
  now = () =>
    new Date(
      "2026-10-12T12:00:02.000Z"
    ),
} = {}) {
  const canonicalSnapshot =
    snapshot ||
    runningSnapshot(
      currentGoal
    );
  const reads = [];
  const planner =
    createGoalModeNextStepPlanner({
      goalStrategyEngine:
        engine(currentGoal),
      runStore: {
        get(runId) {
          reads.push(runId);
          return canonicalSnapshot;
        },
      },
      now,
      idFactory:
        () =>
          "proposal-deterministic",
    });

  return {
    planner,
    reads,
    snapshot:
      canonicalSnapshot,
  };
}

function validProposal(
  overrides = {}
) {
  return {
    objective:
      "Produire une preuve ciblée.",
    expectedOutcome:
      "Preuve vérifiable disponible.",
    evidenceTargetIds: [
      "milestone-1",
    ],
    usage: {
      steps: 1,
      retries: 0,
      providerCalls: 1,
      estimatedCost: 0.25,
    },
    requestedCapabilities: {
      network: false,
      gitWrite: false,
      destructiveActions:
        false,
    },
    requiresUserInput:
      false,
    ...overrides,
  };
}

function testFingerprint(
  value
) {
  function canonical(input) {
    if (
      Array.isArray(input)
    ) {
      return input.map(
        canonical
      );
    }

    if (
      input &&
      typeof input ===
        "object"
    ) {
      return Object.fromEntries(
        Object.keys(input)
          .sort()
          .map(
            (key) => [
              key,
              canonical(
                input[key]
              ),
            ]
          )
      );
    }

    return input;
  }

  return (
    "sha256:" +
    crypto
      .createHash("sha256")
      .update(
        JSON.stringify(
          canonical(value)
        )
      )
      .digest("hex")
  );
}

module.exports = {
  ACTIONABLE_MILESTONE_STATUSES,
  TERMINAL_MILESTONE_STATUSES,
  createGoalModeRunState,
  directFixture,
  engine,
  goal,
  runningSnapshot,
  selectGoalModeNextTarget,
  testFingerprint,
  validProposal,
  validateGoalModeStepProposal,
};
