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
  createGoalModeNextStepPlanner,
} = require(
  "../services/goals/goal-mode-next-step-planner"
);

const {
  createGoalModePlanningCallService,
} = require(
  "../services/goals/goal-mode-planning-call-service"
);

const {
  createGoalModeStepProposalStore,
} = require(
  "../services/goals/goal-mode-step-proposal-store"
);

const {
  createGoalModeDurablePlanningService,
} = require(
  "../services/goals/goal-mode-durable-planning-service"
);

const {
  DECISIONS,
  createGoalModeStepAdmissionService,
} = require(
  "../services/goals/goal-mode-step-admission-service"
);

const {
  createPersonalDatabase,
} = require(
  "../services/persistence/database"
);

const {
  createGoalModeRunRepository,
} = require(
  "../services/persistence/repositories/goal-mode-run-repository"
);

const {
  createGoalModeStepProposalRepository,
} = require(
  "../services/persistence/repositories/goal-mode-step-proposal-repository"
);

function goal() {
  return {
    goalId:
      "goal-50d3",
    title:
      "Goal Mode step admission",
    status:
      "ACTIVE",
    outcomeDefinition:
      "Admettre une proposition durable sans créer d'autorité d'exécution.",
    successCriteria: [
      {
        criterionId:
          "criterion-global",
        description:
          "Admission déterministe.",
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
          "goal-50d3",
        title:
          "Admettre l'étape",
        description:
          "Préparer la future projection exacte.",
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
              "Admission validée.",
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
  };
}

function fixture({
  proposalOverrides =
    {},
  capabilityCeilings = {
    network: true,
    gitWrite: false,
    destructiveActions:
      false,
  },
  limits = {
    maxSteps: 4,
    maxRetries: 1,
    maxProviderCalls: 4,
    maxDuration:
      600_000,
    maxEstimatedCost: 3,
  },
} = {}) {
  const directory =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "noon-50d3-"
      )
    );

  const database =
    createPersonalDatabase(
      path.join(
        directory,
        "goal.sqlite"
      )
    );

  let timestamp =
    Date.parse(
      "2026-10-12T12:00:02.000Z"
    );

  function now() {
    const value =
      new Date(
        timestamp
      ).toISOString();

    timestamp +=
      1000;

    return value;
  }

  const runStore =
    createGoalModeRunStore({
      repository:
        createGoalModeRunRepository(
          database
        ),
      now,
      planningIdFactory:
        () =>
          "planning-50d3",
    });

  const currentGoal =
    goal();

  const engine = {
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
          "goal-run-50d3",
    });

  const created =
    runStore.create(
      contract
    );

  runStore.transition(
    contract.runId,
    "RUNNING",
    {
      expectedRevision:
        created.revision,
      transitionedAt:
        "2026-10-12T12:00:01.000Z",
    }
  );

  const planner =
    createGoalModeNextStepPlanner({
      goalStrategyEngine:
        engine,
      runStore,
      now,
      idFactory:
        () =>
          "proposal-50d3",
    });

  const planningCall =
    createGoalModePlanningCallService({
      runStore,
      nextStepPlanner:
        planner,
      goalStrategyEngine:
        engine,
      selectModelRoute() {
        return {
          provider:
            "openai",
          model:
            "gpt-5.6-terra",
          effort:
            "medium",
          verbosity:
            "low",
          estimatedCost: {
            status:
              "available",
            total:
              0.2,
          },
        };
      },
      estimateCost() {
        return {
          status:
            "available",
          total:
            0.15,
        };
      },
      authorizePrivacy() {
        return {};
      },
      providerAdapter: {
        provider:
          "openai",

        async execute() {
          return {
            text:
              JSON.stringify({
                objective:
                  "Projeter ensuite une action exacte.",
                expectedOutcome:
                  "Une projection concrète peut être construite.",
                evidenceTargetIds: [
                  "milestone-1",
                  "criterion-m1",
                ],
                usage: {
                  steps: 1,
                  retries: 0,
                  providerCalls: 0,
                  estimatedCost: 0,
                },
                requestedCapabilities: {
                  network: false,
                  gitWrite: false,
                  destructiveActions:
                    false,
                },
                requiresUserInput:
                  false,
                ...proposalOverrides,
              }),
            toolCalls: [],
            usage: {
              inputTokens: 100,
              cachedInputTokens: 0,
              outputTokens: 50,
              totalTokens: 150,
            },
            provider:
              "openai",
            model:
              "gpt-5.6-terra",
          };
        },
      },
      now,
    });

  const stepStore =
    createGoalModeStepProposalStore({
      repository:
        createGoalModeStepProposalRepository(
          database
        ),
      now,
    });

  const durable =
    createGoalModeDurablePlanningService({
      runStore,
      planningCallService:
        planningCall,
      stepProposalStore:
        stepStore,
    });

  const admission =
    createGoalModeStepAdmissionService({
      runStore,
      stepProposalStore:
        stepStore,
      nextStepPlanner:
        planner,
      goalStrategyEngine:
        engine,
      now,
    });

  return {
    admission,
    currentGoal,
    database,
    directory,
    durable,
    now,
    runStore,
    stepStore,
    close() {
      database.close();

      fs.rmSync(
        directory,
        {
          recursive:
            true,
          force:
            true,
        }
      );
    },
  };
}

test(
  "5.0D-3 admet une proposition durable sans autoriser ni exécuter",
  async () => {
    const f =
      fixture();

    try {
      const planned =
        await f.durable
          .planOnce({
            runId:
              "goal-run-50d3",
          });

      const before =
        f.runStore.get(
          "goal-run-50d3"
        );

      const result =
        f.admission.admit({
          runId:
            "goal-run-50d3",
          stepId:
            planned.stepRecord
              .stepId,
        });

      const after =
        f.runStore.get(
          "goal-run-50d3"
        );

      assert.equal(
        result.decision,
        DECISIONS.ADMIT
      );

      assert.equal(
        result.authority
          .executionAuthorized,
        false
      );

      assert.equal(
        result.authority
          .capabilitiesGranted,
        false
      );

      assert.equal(
        result.authority
          .approvalGranted,
        false
      );

      assert.equal(
        result.nextBoundary
          .exactActionProjectionRequired,
        true
      );

      assert.equal(
        result.nextBoundary
          .operationalSecurityEvaluationRequired,
        true
      );

      assert.equal(
        result.budget
          .consumed,
        false
      );

      assert.equal(
        after.revision,
        before.revision
      );

      assert.deepEqual(
        after.state.usage,
        before.state.usage
      );
    } finally {
      f.close();
    }
  }
);

test(
  "5.0D-3 distingue une capacité demandable d'une capacité accordée",
  async () => {
    const f =
      fixture({
        proposalOverrides: {
          requestedCapabilities: {
            network: true,
            gitWrite: false,
            destructiveActions:
              false,
          },
        },
      });

    try {
      const planned =
        await f.durable
          .planOnce({
            runId:
              "goal-run-50d3",
          });

      const result =
        f.admission.admit({
          runId:
            "goal-run-50d3",
          stepId:
            planned.stepRecord
              .stepId,
        });

      assert.deepEqual(
        result.capabilityAdmission
          .requested,
        [
          "network",
        ]
      );

      assert.equal(
        result.capabilityAdmission
          .allowedToRequest,
        true
      );

      assert.equal(
        result.capabilityAdmission
          .externalAuthorizationRequired,
        true
      );

      assert.equal(
        result.capabilityAdmission
          .capabilitiesGranted,
        false
      );

      assert.equal(
        result.authority
          .executionAuthorized,
        false
      );
    } finally {
      f.close();
    }
  }
);

test(
  "5.0D-3 requiresUserInput n'est pas confondu avec une approval",
  async () => {
    const f =
      fixture({
        proposalOverrides: {
          requiresUserInput:
            true,
        },
      });

    try {
      const planned =
        await f.durable
          .planOnce({
            runId:
              "goal-run-50d3",
          });

      const result =
        f.admission.admit({
          runId:
            "goal-run-50d3",
          stepId:
            planned.stepRecord
              .stepId,
        });

      assert.equal(
        result.decision,
        DECISIONS
          .REQUIRE_USER_INPUT
      );

      assert.equal(
        result.userInput.required,
        true
      );

      assert.equal(
        result.userInput
          .approvalPrepared,
        false
      );

      assert.equal(
        result.authority
          .approvalGranted,
        false
      );
    } finally {
      f.close();
    }
  }
);

test(
  "5.0D-3 refuse un snapshot avancé sans consommer de budget",
  async () => {
    const f =
      fixture();

    try {
      const planned =
        await f.durable
          .planOnce({
            runId:
              "goal-run-50d3",
          });

      const before =
        f.runStore.get(
          "goal-run-50d3"
        );

      f.runStore.consume(
        "goal-run-50d3",
        {
          expectedRevision:
            before.revision,
          currentGoalVersion:
            5,
          usageDelta: {
            steps: 1,
            retries: 0,
            providerCalls: 0,
            estimatedCost: 0,
          },
        }
      );

      assert.throws(
        () =>
          f.admission.admit({
            runId:
              "goal-run-50d3",
            stepId:
              planned.stepRecord
                .stepId,
          }),
        {
          code:
            "GOAL_MODE_STEP_ADMISSION_SNAPSHOT_STALE",
        }
      );
    } finally {
      f.close();
    }
  }
);

test(
  "5.0D-3 recheck la cible canonique et refuse un Goal modifié sans nouvelle version",
  async () => {
    const f =
      fixture();

    try {
      const planned =
        await f.durable
          .planOnce({
            runId:
              "goal-run-50d3",
          });

      f.currentGoal
        .milestones[0]
        .title =
        "Cible modifiée";

      assert.throws(
        () =>
          f.admission.admit({
            runId:
              "goal-run-50d3",
            stepId:
              planned.stepRecord
                .stepId,
          }),
        (error) => {
          assert.ok(
            [
              "GOAL_MODE_NEXT_STEP_GOAL_STALE",
              "GOAL_MODE_STEP_ADMISSION_TARGET_STALE",
            ].includes(
              error?.code
            )
          );

          return true;
        }
      );
    } finally {
      f.close();
    }
  }
);

test(
  "5.0D-3 refuse si le budget temporel expire après la proposition durable",
  async () => {
    const f =
      fixture({
        limits: {
          maxSteps: 4,
          maxRetries: 1,
          maxProviderCalls: 4,
          maxDuration:
            10_000,
          maxEstimatedCost: 3,
        },
      });

    try {
      const planned =
        await f.durable
          .planOnce({
            runId:
              "goal-run-50d3",
          });

      const admission =
        createGoalModeStepAdmissionService({
          runStore:
            f.runStore,
          stepProposalStore:
            f.stepStore,
          nextStepPlanner: {
            select:
              f.admission
                ? (() => {
                    const planner =
                      createGoalModeNextStepPlanner({
                        goalStrategyEngine: {
                          registry: {
                            get() {
                              return f.currentGoal;
                            },
                          },
                        },
                        runStore:
                          f.runStore,
                      });

                    return (
                      input
                    ) =>
                      planner.select(
                        input
                      );
                  })()
                : null,
          },
          goalStrategyEngine: {
            registry: {
              get() {
                return f.currentGoal;
              },
            },
          },
          now:
            () =>
              new Date(
                "2026-10-12T12:01:00.000Z"
              ),
        });

      assert.throws(
        () =>
          admission.admit({
            runId:
              "goal-run-50d3",
            stepId:
              planned.stepRecord
                .stepId,
          }),
        (error) => {
          assert.equal(
            error.code,
            "GOAL_MODE_STEP_ADMISSION_BUDGET_BLOCKED"
          );

          assert.equal(
            error.details
              ?.assessment
              ?.reasonCode,
            "TIME_LIMIT"
          );

          return true;
        }
      );
    } finally {
      f.close();
    }
  }
);

test(
  "5.0D-3 refuse une proposition durable rattachée à un autre run",
  async () => {
    const f =
      fixture();

    try {
      const planned =
        await f.durable
          .planOnce({
            runId:
              "goal-run-50d3",
          });

      assert.throws(
        () =>
          f.admission.admit({
            runId:
              "goal-run-other",
            stepId:
              planned.stepRecord
                .stepId,
          }),
        {
          code:
            "GOAL_MODE_STEP_ADMISSION_RUN_MISSING",
        }
      );
    } finally {
      f.close();
    }
  }
);
