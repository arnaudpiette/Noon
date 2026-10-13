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
      "goal-50d2",
    title:
      "Goal Mode durable step",
    status:
      "ACTIVE",
    outcomeDefinition:
      "Persister la proposition validée avant toute autorisation ou exécution.",
    successCriteria: [
      {
        criterionId:
          "criterion-global",
        description:
          "Proposition durable.",
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
          "goal-50d2",
        title:
          "Persister l'étape",
        description:
          "Conserver la proposition validée.",
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
              "Étape durable.",
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

function fixture() {
  const directory =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "noon-50d2-"
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

  let timestamp =
    Date.parse(
      "2026-10-12T12:00:02.000Z"
    );

  function now() {
    const value =
      new Date(
        timestamp
      ).toISOString();

    timestamp += 1000;

    return value;
  }

  const runRepository =
    createGoalModeRunRepository(
      database
    );

  const runStore =
    createGoalModeRunStore({
      repository:
        runRepository,
      now,
      planningIdFactory:
        () =>
          "planning-50d2",
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
        limits: {
          maxSteps: 4,
          maxRetries: 1,
          maxProviderCalls: 4,
          maxDuration:
            600_000,
          maxEstimatedCost: 3,
        },
        capabilityCeilings: {
          network: true,
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
          "goal-run-50d2",
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
          "proposal-50d2",
    });

  let providerCalls = 0;

  const planningCallService =
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
          providerCalls +=
            1;

          return {
            text:
              JSON.stringify({
                objective:
                  "Persister une proposition vérifiable.",
                expectedOutcome:
                  "Une proposition durable existe.",
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

  const stepRepository =
    createGoalModeStepProposalRepository(
      database
    );

  const stepStore =
    createGoalModeStepProposalStore({
      repository:
        stepRepository,
      now,
    });

  const durable =
    createGoalModeDurablePlanningService({
      runStore,
      planningCallService,
      stepProposalStore:
        stepStore,
    });

  return {
    database,
    directory,
    durable,
    file,
    getProviderCalls() {
      return providerCalls;
    },
    runStore,
    stepRepository,
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
  "5.0D-2 persiste la proposition puis la rejoue sans second appel provider",
  async () => {
    const f =
      fixture();

    try {
      const first =
        await f.durable
          .planOnce({
            runId:
              "goal-run-50d2",
          });

      assert.equal(
        first.status,
        "PROPOSED"
      );

      assert.equal(
        first.recovered,
        false
      );

      assert.equal(
        f.getProviderCalls(),
        1
      );

      assert.equal(
        first.stepRecord
          .authority
          .executionAuthorized,
        false
      );

      const second =
        await f.durable
          .planOnce({
            runId:
              "goal-run-50d2",
          });

      assert.equal(
        second.status,
        "PROPOSED"
      );

      assert.equal(
        second.recovered,
        true
      );

      assert.equal(
        second.proposal
          .fingerprint,
        first.proposal
          .fingerprint
      );

      assert.equal(
        f.getProviderCalls(),
        1
      );
    } finally {
      f.close();
    }
  }
);

test(
  "5.0D-2 survit à une réouverture SQLite et conserve l'identité de réservation",
  async () => {
    const f =
      fixture();

    try {
      const first =
        await f.durable
          .planOnce({
            runId:
              "goal-run-50d2",
          });

      const stepId =
        first.stepRecord
          .stepId;

      const file =
        f.file;

      f.database.close();

      const reopenedDb =
        createPersonalDatabase(
          file
        );

      try {
        const reopenedRepo =
          createGoalModeStepProposalRepository(
            reopenedDb
          );

        const restored =
          reopenedRepo.get(
            stepId
          );

        assert.ok(
          restored
        );

        assert.equal(
          restored.planningRef
            .reservationId,
          "planning-50d2"
        );

        assert.equal(
          restored.proposal
            .fingerprint,
          first.proposal
            .fingerprint
        );

        assert.equal(
          restored.authority
            .executionAuthorized,
          false
        );
      } finally {
        reopenedDb.close();
      }

      fs.rmSync(
        f.directory,
        {
          recursive:
            true,
          force:
            true,
        }
      );
    } finally {
      try {
        f.database.close();
      } catch {}
    }
  }
);

test(
  "5.0D-2 interdit une proposition conflictuelle pour la même réservation",
  async () => {
    const f =
      fixture();

    try {
      const first =
        await f.durable
          .planOnce({
            runId:
              "goal-run-50d2",
          });

      const conflict =
        structuredClone(
          first.stepRecord
        );

      conflict.proposal.objective =
        "Objectif forgé";

      assert.throws(
        () =>
          f.stepRepository
            .save(
              conflict
            ),
        {
          code:
            "GOAL_MODE_STEP_PROPOSAL_INVALID",
        }
      );

      const reread =
        f.stepRepository.get(
          first.stepRecord
            .stepId
        );

      assert.equal(
        reread.proposal
          .fingerprint,
        first.proposal
          .fingerprint
      );
    } finally {
      f.close();
    }
  }
);

test(
  "5.0D-2 bloque toute replanification si une réservation réconciliée n'a pas de proposition durable",
  async () => {
    const f =
      fixture();

    try {
      /*
       * Exécuter directement 5.0D-1 simule
       * le crash window entre réconciliation
       * et persistance 5.0D-2.
       */
      const directPlanner =
        f.durable;

      const rawService =
        directPlanner;

      // On reproduit le résultat en supprimant
      // volontairement toute proposition durable
      // après l'appel via un StepStore séparé.
      const first =
        await f.durable
          .planOnce({
            runId:
              "goal-run-50d2",
          });

      /*
       * Supprimer le record via une nouvelle DB
       * serait une mutation artificielle. On
       * vérifie plutôt le gate avec une façade
       * StepStore qui ne voit aucun record.
       */
      let rawPlanningCalls =
        0;

      const gate =
        createGoalModeDurablePlanningService({
          runStore:
            f.runStore,
          planningCallService: {
            async planOnce() {
              rawPlanningCalls +=
                1;
              return first;
            },
          },
          stepProposalStore: {
            capabilities() {
              return {
                backend:
                  "SQLITE",
                atomicCreate:
                  true,
              };
            },
            getForReservation() {
              return null;
            },
            saveFromPlanning() {
              throw new Error(
                "must not run"
              );
            },
          },
        });

      await assert.rejects(
        () =>
          gate.planOnce({
            runId:
              "goal-run-50d2",
          }),
        {
          code:
            "GOAL_MODE_STEP_RECOVERY_REQUIRED",
        }
      );

      assert.equal(
        rawPlanningCalls,
        0
      );

      assert.equal(
        f.getProviderCalls(),
        1
      );
    } finally {
      f.close();
    }
  }
);

test(
  "5.0D-2 refuse un backend Step Proposal non atomique",
  () => {
    assert.throws(
      () =>
        createGoalModeDurablePlanningService({
          runStore: {
            get() {},
          },
          planningCallService: {
            async planOnce() {},
          },
          stepProposalStore: {
            capabilities() {
              return {
                backend:
                  "JSON_FALLBACK",
                atomicCreate:
                  false,
              };
            },
            getForReservation() {},
            saveFromPlanning() {},
          },
        }),
      TypeError
    );
  }
);
