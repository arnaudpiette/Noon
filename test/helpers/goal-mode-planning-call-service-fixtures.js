"use strict";

// Shared setup for test/goal-mode-planning-call-service*.test.js (moved verbatim from test/goal-mode-planning-call-service.test.js, V3-L7).

const assert =
  require("node:assert/strict");

const fs =
  require("node:fs");

const os =
  require("node:os");

const path =
  require("node:path");

const {
  createGoalModeRunContract,
} = require(
  "../../services/goals/goal-mode-run-contract"
);

const {
  createGoalModeRunStore,
} = require(
  "../../services/goals/goal-mode-run-store"
);

const {
  createGoalModeNextStepPlanner,
} = require(
  "../../services/goals/goal-mode-next-step-planner"
);

const {
  PLANNER_MAX_CRITERION_TEXT,
  PLANNER_MAX_SUCCESS_CRITERIA,
  SYSTEM_PROMPT,
  createGoalModePlanningCallService,
  stepBudgetPayload,
  successCriteriaPayload,
} = require(
  "../../services/goals/goal-mode-planning-call-service"
);

const {
  createPersonalDatabase,
} = require(
  "../../services/persistence/database"
);

const {
  createGoalModeRunRepository,
} = require(
  "../../services/persistence/repositories/goal-mode-run-repository"
);

function goal(
  overrides = {}
) {
  return {
    goalId:
      "goal-50d1",
    title:
      "Goal Mode 5.0D-1",
    status:
      "ACTIVE",
    outcomeDefinition:
      "Atteindre le prochain milestone Goal Mode sans exécution implicite.",
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
          "goal-50d1",
        title:
          "Planifier l'étape minimale",
        description:
          "Produire une proposition bornée sans l'exécuter.",
        status:
          "IN_PROGRESS",
        targetDate:
          null,
        dependencies: [],
        linkedProjectIds: [
          "project-noon",
        ],
        completionCriteria: [
          {
            criterionId:
              "criterion-m1",
            description:
              "La proposition est validée.",
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
    constraints: [
      {
        constraintId:
          "constraint-safe",
        description:
          "Aucune exécution pendant le planning.",
        strength:
          "HARD",
        source:
          "explicit_user",
        evidenceRefs: [],
      },
    ],
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

function goalEngine(
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

function candidate(
  overrides = {}
) {
  return {
    objective:
      "Produire la preuve minimale pour milestone-1.",
    expectedOutcome:
      "Une preuve vérifiable est disponible.",
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
    ...overrides,
  };
}

function fixture({
  currentGoal =
    goal(),
  providerExecute =
    null,
  estimateCost =
    null,
  route =
    null,
  privacy =
    null,
  limits =
    null,
} = {}) {
  const directory =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "noon-50d1-"
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
    timestamp +=
      1000;
    return value;
  }

  const repository =
    createGoalModeRunRepository(
      database
    );

  const runStore =
    createGoalModeRunStore({
      repository,
      now,
      planningIdFactory:
        () =>
          "planning-50d1",
    });

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
        limits: limits || {
          maxSteps: 5,
          maxRetries: 1,
          maxProviderCalls: 5,
          maxDuration:
            600_000,
          maxEstimatedCost: 5,
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
          "goal-run-50d1",
    });

  const created =
    runStore.create(
      contract
    );

  const running =
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

  const engine =
    goalEngine(
      currentGoal
    );

  const planner =
    createGoalModeNextStepPlanner({
      goalStrategyEngine:
        engine,
      runStore,
      now,
      idFactory:
        () =>
          "proposal-50d1",
    });

  const calls = {
    provider: 0,
    privacy: 0,
    route: 0,
    track: 0,
    requests: [],
  };

  const providerAdapter = {
    provider:
      "openai",
    async execute(
      request,
      options
    ) {
      calls.provider +=
        1;
      calls.requests.push({
        request,
        options,
      });

      if (
        providerExecute
      ) {
        return providerExecute(
          request,
          options,
          calls
        );
      }

      return {
        text:
          JSON.stringify(
            candidate()
          ),
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
        latencyMs: 10,
      };
    },
  };

  const service =
    createGoalModePlanningCallService({
      runStore,
      nextStepPlanner:
        planner,
      goalStrategyEngine:
        engine,
      selectModelRoute(
        input
      ) {
        calls.route +=
          1;

        return route ||
          {
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
            input,
          };
      },
      estimateCost:
        estimateCost ||
        (
          () => ({
            status:
              "available",
            total:
              0.15,
          })
        ),
      authorizePrivacy(
        fragments,
        policy
      ) {
        calls.privacy +=
          1;

        if (
          privacy
        ) {
          return privacy(
            fragments,
            policy,
            calls
          );
        }

        return {
          token:
            "privacy",
        };
      },
      providerAdapter,
      trackUsage() {
        calls.track +=
          1;
      },
      now,
    });

  return {
    calls,
    currentGoal,
    database,
    directory,
    planner,
    runStore,
    running,
    service,
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

// B4a : entrée du planner — budget d'étapes et critères de succès bornés.
function plannerInput(f) {
  const messages = f.calls.requests[0].request.input;
  assert.equal(messages[0].role, "system");
  assert.equal(messages[0].content, SYSTEM_PROMPT);
  assert.equal(messages[1].role, "user");
  return JSON.parse(messages[1].content);
}

module.exports = {
  PLANNER_MAX_CRITERION_TEXT,
  PLANNER_MAX_SUCCESS_CRITERIA,
  SYSTEM_PROMPT,
  candidate,
  createGoalModeNextStepPlanner,
  createGoalModePlanningCallService,
  createGoalModeRunContract,
  createGoalModeRunRepository,
  createGoalModeRunStore,
  createPersonalDatabase,
  fixture,
  goal,
  goalEngine,
  plannerInput,
  stepBudgetPayload,
  successCriteriaPayload,
};
