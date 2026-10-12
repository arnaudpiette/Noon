"use strict";

const assert =
  require("node:assert/strict");

const test =
  require("node:test");

const {
  assessGoalModeBudget,
  assessGoalModeCapabilityCeiling,
  createGoalModeRunContract,
} = require(
  "../services/goals/goal-mode-run-contract"
);

const ADMITTED_AT =
  "2026-10-12T12:00:00.000Z";

function goal(
  overrides = {}
) {
  return {
    goalId:
      "goal-mode-1",

    title:
      "Stabiliser Noon",

    description: "",

    status:
      "ACTIVE",

    horizon:
      "SHORT_TERM",

    category:
      "PROJECT",

    outcomeDefinition:
      "Livrer une version stable de Noon.",

    successCriteria: [
      {
        criterionId:
          "criterion-tests",

        description:
          "Tests critiques PASS.",

        type:
          "BOOLEAN",

        targetValue:
          true,

        currentValue:
          false,

        unit: null,

        status:
          "NOT_MET",

        evidenceRefs: [],
      },
    ],

    milestones: [],

    linkedProjectIds: [
      "project-noon",
    ],

    linkedWorkspaceIds: [
      "workspace-noon",
    ],

    strategyRef: null,

    constraints: [
      {
        constraintId:
          "constraint-no-push",

        description:
          "Ne jamais pousser automatiquement.",

        strength:
          "HARD",

        source:
          "explicit_user",

        evidenceRefs: [],
      },
    ],

    progress: {
      status:
        "IN_PROGRESS",

      value: null,

      method:
        "UNKNOWN",

      confidence: 0,

      measuredAt: null,

      evidenceRefs: [],
    },

    confidence: 1,
    targetDate: null,
    reviewCadence: null,
    importance: null,
    profileScope:
      "arnaud",
    sensitivity:
      "NORMAL",

    createdAt:
      "2026-10-12T11:00:00.000Z",

    updatedAt:
      "2026-10-12T11:00:00.000Z",

    source:
      "explicit_user",

    userConfirmed: true,
    version: 7,
    qualityWarnings: [],

    ...overrides,
  };
}

function request(
  overrides = {}
) {
  return {
    userConfirmed:
      true,

    workspaceId:
      "workspace-noon",

    projectId:
      "project-noon",

    limits: {
      maxSteps: 12,
      maxRetries: 2,
      maxProviderCalls: 6,
      maxDuration:
        30 * 60_000,
      maxEstimatedCost: 3,
    },

    capabilityCeilings: {
      network: true,
      gitWrite: false,
      destructiveActions:
        false,
    },

    localOnly: false,

    ...overrides,
  };
}

function contract(
  overrides = {}
) {
  return createGoalModeRunContract({
    goal:
      goal(
        overrides.goal
      ),

    request:
      request(
        overrides.request
      ),

    now:
      () =>
        new Date(
          ADMITTED_AT
        ),

    idFactory:
      () =>
        "goal-run-test-1",
  });
}

test(
  "5.0A exige Goal ACTIVE, confirmé, avec critères de succès",
  () => {
    assert.throws(
      () =>
        createGoalModeRunContract({
          goal:
            goal({
              status:
                "PAUSED",
            }),

          request:
            request(),
        }),
      {
        code:
          "GOAL_MODE_GOAL_NOT_ACTIVE",
      }
    );

    assert.throws(
      () =>
        createGoalModeRunContract({
          goal:
            goal({
              successCriteria: [],
            }),

          request:
            request(),
        }),
      {
        code:
          "GOAL_MODE_SUCCESS_CRITERIA_REQUIRED",
      }
    );
  }
);

test(
  "5.0A le lancement autonome exige une confirmation explicite",
  () => {
    assert.throws(
      () =>
        contract({
          request: {
            userConfirmed:
              false,
          },
        }),
      {
        code:
          "GOAL_MODE_RUN_CONFIRMATION_REQUIRED",
      }
    );
  }
);

test(
  "5.0A le caller ne peut pas injecter runId ni une nouvelle taxonomie d'autorité",
  () => {
    assert.throws(
      () =>
        contract({
          request: {
            runId:
              "caller-controlled",
          },
        }),
      {
        code:
          "GOAL_MODE_CONTRACT_INVALID",
      }
    );

    assert.throws(
      () =>
        contract({
          request: {
            capabilityCeilings: {
              systemWrite:
                true,
            },
          },
        }),
      {
        code:
          "GOAL_MODE_CONTRACT_INVALID",
      }
    );
  }
);

test(
  "5.0A exige toutes les limites GLOBAL Goal Run explicites",
  () => {
    const limits = {
      ...request()
        .limits,
    };

    delete limits
      .maxProviderCalls;

    assert.throws(
      () =>
        contract({
          request: {
            limits,
          },
        }),
      {
        code:
          "GOAL_MODE_LIMIT_REQUIRED",
      }
    );

    assert.throws(
      () =>
        contract({
          request: {
            limits: {
              ...request()
                .limits,

              maxSteps: 0,
            },
          },
        }),
      {
        code:
          "GOAL_MODE_LIMIT_INVALID",
      }
    );
  }
);

test(
  "5.0A fige Goal/version/critères/contraintes sans porter l'état mutable",
  () => {
    const value =
      contract();

    assert.equal(
      value.version,
      "goal-mode-run-contract-v1"
    );

    assert.equal(
      value.runId,
      "goal-run-test-1"
    );

    assert.equal(
      Object.hasOwn(
        value,
        "status"
      ),
      false
    );

    assert.equal(
      value.goalRef
        .goalVersion,
      7
    );

    assert.deepEqual(
      value.successCriteria
        .criterionIds,
      [
        "criterion-tests",
      ]
    );

    assert.match(
      value.successCriteria
        .fingerprint,
      /^sha256:[a-f0-9]{64}$/
    );

    assert.match(
      value.constraints
        .fingerprint,
      /^sha256:[a-f0-9]{64}$/
    );

    const serialized =
      JSON.stringify(
        value
      );

    assert.equal(
      serialized.includes(
        "Tests critiques PASS."
      ),
      false
    );

    assert.equal(
      serialized.includes(
        "Ne jamais pousser automatiquement."
      ),
      false
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
  "5.0A refuse un scope workspace ou projet hors Goal",
  () => {
    assert.throws(
      () =>
        contract({
          request: {
            workspaceId:
              "workspace-other",
          },
        }),
      {
        code:
          "GOAL_MODE_WORKSPACE_MISMATCH",
      }
    );

    assert.throws(
      () =>
        contract({
          request: {
            projectId:
              "project-other",
          },
        }),
      {
        code:
          "GOAL_MODE_PROJECT_MISMATCH",
      }
    );
  }
);

test(
  "5.0A capabilityCeilings ne crée aucune autorité",
  () => {
    const value =
      contract({
        request: {
          capabilityCeilings: {
            network: true,
            gitWrite: true,
            destructiveActions:
              true,
          },
        },
      });

    assert.deepEqual(
      value.capabilityCeilings,
      {
        network: true,
        gitWrite: true,
        destructiveActions:
          true,
      }
    );

    assert.deepEqual(
      value.authority,
      {
        executionAuthorized:
          false,

        capabilitiesGranted:
          false,

        securityPipelineBypassed:
          false,
      }
    );
  }
);

test(
  "5.0A local_only interdit même le plafond réseau",
  () => {
    assert.throws(
      () =>
        contract({
          request: {
            localOnly: true,

            capabilityCeilings: {
              network: true,
            },
          },
        }),
      {
        code:
          "GOAL_MODE_LOCAL_ONLY_NETWORK_CONFLICT",
      }
    );

    assert.throws(
      () =>
        createGoalModeRunContract({
          goal:
            goal({
              sensitivity:
                "LOCAL_ONLY",
            }),

          request:
            request(),
        }),
      {
        code:
          "GOAL_MODE_LOCAL_ONLY_NETWORK_CONFLICT",
      }
    );
  }
);

test(
  "5.0A budget GLOBAL autorise seulement une projection dans ses limites",
  () => {
    const value =
      contract();

    const assessment =
      assessGoalModeBudget({
        contract:
          value,

        currentGoalVersion:
          7,

        currentUsage: {
          steps: 4,
          retries: 1,
          providerCalls: 2,
          estimatedCost: 1,
        },

        proposedUsage: {
          steps: 1,
          retries: 0,
          providerCalls: 1,
          estimatedCost: 0.5,
        },

        now:
          () =>
            new Date(
              "2026-10-12T12:05:00.000Z"
            ),
      });

    assert.equal(
      assessment.decision,
      "PROCEED"
    );

    assert.equal(
      assessment.allowed,
      true
    );

    assert.deepEqual(
      assessment.projected,
      {
        steps: 5,
        retries: 1,
        providerCalls: 3,
        estimatedCost: 1.5,
      }
    );

    assert.equal(
      assessment.remaining
        .steps,
      7
    );
  }
);

test(
  "5.0A budget GLOBAL stoppe avant dépassement steps/retries/providers/coût",
  () => {
    const value =
      contract();

    const cases = [
      [
        {
          currentUsage: {
            steps: 12,
          },

          proposedUsage: {
            steps: 1,
          },
        },
        "STEP_LIMIT",
      ],
      [
        {
          currentUsage: {
            retries: 2,
          },

          proposedUsage: {
            retries: 1,
          },
        },
        "RETRY_LIMIT",
      ],
      [
        {
          currentUsage: {
            providerCalls: 6,
          },

          proposedUsage: {
            providerCalls: 1,
          },
        },
        "PROVIDER_CALL_LIMIT",
      ],
      [
        {
          currentUsage: {
            estimatedCost: 2.9,
          },

          proposedUsage: {
            estimatedCost: 0.2,
          },
        },
        "COST_LIMIT",
      ],
    ];

    for (
      const [
        usage,
        reasonCode,
      ] of cases
    ) {
      const assessment =
        assessGoalModeBudget({
          contract:
            value,

          currentGoalVersion:
            7,

          ...usage,

          now:
            () =>
              new Date(
                "2026-10-12T12:05:00.000Z"
              ),
        });

      assert.equal(
        assessment.allowed,
        false,
        reasonCode
      );

      assert.equal(
        assessment.reasonCode,
        reasonCode
      );
    }
  }
);

test(
  "5.0A budget GLOBAL stoppe sur temps épuisé ou Goal stale",
  () => {
    const value =
      contract();

    const expired =
      assessGoalModeBudget({
        contract:
          value,

        currentGoalVersion:
          7,

        currentUsage: {},

        proposedUsage: {
          steps: 1,
        },

        now:
          () =>
            new Date(
              "2026-10-12T12:30:00.000Z"
            ),
      });

    assert.equal(
      expired.reasonCode,
      "TIME_LIMIT"
    );

    const stale =
      assessGoalModeBudget({
        contract:
          value,

        currentGoalVersion:
          8,

        currentUsage: {},

        proposedUsage: {
          steps: 1,
        },

        now:
          () =>
            new Date(
              "2026-10-12T12:01:00.000Z"
            ),
      });

    assert.equal(
      stale.reasonCode,
      "GOAL_STALE"
    );
  }
);

test(
  "5.0A capability ceiling ne remplace jamais Security/Permission/Approval",
  () => {
    const value =
      contract();

    const network =
      assessGoalModeCapabilityCeiling({
        contract:
          value,

        requestedCapabilities: {
          network: true,
        },
      });

    assert.equal(
      network.decision,
      "REQUEST_AUTHORIZATION"
    );

    assert.equal(
      network.allowedToRequest,
      true
    );

    assert.equal(
      network
        .requiresExternalAuthorization,
      true
    );

    assert.equal(
      network
        .executionAuthorized,
      false
    );

    const git =
      assessGoalModeCapabilityCeiling({
        contract:
          value,

        requestedCapabilities: {
          gitWrite: true,
        },
      });

    assert.equal(
      git.decision,
      "DENY"
    );

    assert.equal(
      git.reasonCode,
      "GOAL_MODE_CAPABILITY_CEILING"
    );

    assert.equal(
      git.executionAuthorized,
      false
    );
  }
);
