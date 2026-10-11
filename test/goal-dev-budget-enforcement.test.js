"use strict";

const assert =
  require("node:assert/strict");

const test =
  require("node:test");

const {
  createNativeDevStructuredExecutor,
} = require(
  "../services/dev/native-dev-reasoner"
);

function fixture() {
  const seen = {
    snapshots: [],
    reserves: [],
  };

  const budgetService = {
    snapshot(
      taskId,
      taskLimit,
      enforce
    ) {
      seen.snapshots.push({
        taskId,
        taskLimit,
        enforce,
      });

      return {
        enabled: true,
        enforcement:
          enforce === true,

        task: {
          remaining: 1,
        },

        daily: {
          remaining: 1,
        },

        monthly: {
          remaining: 1,
        },
      };
    },

    effectiveRemaining() {
      return 1;
    },

    reserve(input) {
      seen.reserves.push(
        structuredClone(
          input
        )
      );

      return {
        reservationId:
          "reservation-1",
      };
    },

    reconcile() {},

    markUnknown() {},
  };

  const executor =
    createNativeDevStructuredExecutor({
      featureFlags: {
        evaluate() {
          return {
            enabled: false,
          };
        },
      },

      budgetService,

      selectModelRoute() {
        return {
          provider: "openai",
          model: "test-model",
          effort: "low",
          verbosity: "low",

          estimatedCost: {
            status:
              "available",
            total: 0.1,
          },

          reasonCodes: [],
        };
      },

      estimateCost() {
        return {
          status:
            "available",
          total: 0.1,
        };
      },

      authorizePrivacy() {
        return "privacy-token";
      },

      providerAdapter: {
        async execute() {
          return {
            provider: "openai",
            model: "test-model",

            text:
              JSON.stringify({
                summary: "ok",
                files: [],
                searchTerms: [],
                operations: [],
                validationCommands:
                  [],
              }),

            usage: {
              inputTokens: 1,
              outputTokens: 1,
            },

            latencyMs: 1,
          };
        },
      },

      trackUsage() {},
    });

  return {
    executor,
    seen,
  };
}

async function execute(
  executor,
  enforceTaskBudget
) {
  return executor({
    taskDomain: "DEV",
    requiredQuality: "NORMAL",
    maxEstimatedCost: 0.5,
    enforceTaskBudget,

    schema: {
      type: "object",
    },

    schemaName:
      "goal_dev_test",

    system: "test",

    payload: {
      taskId: "task-1",
      workspaceId:
        "workspace-1",
      objective: "test",
      phase: "PLAN",
      localOnly: false,
      benchmark: null,
    },
  });
}

test(
  "4.5B une limite Goal impose le budget tâche même si le rollout global est OFF",
  async () => {
    const {
      executor,
      seen,
    } = fixture();

    await execute(
      executor,
      true
    );

    assert.equal(
      seen.reserves.length,
      1
    );

    assert.equal(
      seen.reserves[0]
        .enforce,
      true
    );

    assert.ok(
      seen.snapshots.every(
        (item) =>
          item.enforce ===
          true
      )
    );
  }
);

test(
  "4.5B le comportement historique reste inchangé sans enforcement interne",
  async () => {
    const {
      executor,
      seen,
    } = fixture();

    await execute(
      executor,
      false
    );

    assert.equal(
      seen.reserves.length,
      1
    );

    assert.equal(
      seen.reserves[0]
        .enforce,
      false
    );

    assert.ok(
      seen.snapshots.every(
        (item) =>
          item.enforce ===
          false
      )
    );
  }
);
