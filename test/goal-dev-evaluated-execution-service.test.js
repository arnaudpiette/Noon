"use strict";

const assert =
  require("node:assert/strict");

const test =
  require("node:test");

const {
  createAgentEvaluationEngine,
} = require(
  "../services/evaluation/agent-evaluation-engine"
);

const {
  createGoalDevEvaluatedExecutionService,
} = require(
  "../services/goals/goal-dev-evaluated-execution-service"
);

const {
  deriveGoalDevContinuation,
} = require(
  "../services/goals/goal-dev-continuation-policy"
);

function baseResult(
  devResult
) {
  return {
    version:
      "goal-dev-execution-result-v1",

    goalRef: {
      goalId: "goal-1",
      version: 1,
      workspaceId:
        "workspace-1",
      projectId:
        "project-1",
    },

    contractVersion:
      "goal-dev-execution-v1",

    taskId:
      devResult.taskId,

    devResult,

    continuation: {
      automatic: false,
      retryScheduled: false,
      evaluationApplied:
        false,
      goalStateMutated:
        false,
    },

    authority: {
      goalGrantsExecution:
        false,
      securityPipelineBypassed:
        false,
    },
  };
}

function passDevResult() {
  return {
    taskId: "task-1",
    status: "PASS",
    finalVerdict: "PASS",
    failureCategory: null,

    validations: [
      {
        id: "tests",
        status: "PASS",
      },
    ],

    diffReview: {
      valid: true,
      issues: [],
    },

    preExistingChangesPreserved:
      true,
  };
}

function fixture(
  devResult
) {
  let runs = 0;

  const service =
    createGoalDevEvaluatedExecutionService({
      goalExecutionService: {
        async run() {
          runs += 1;

          return baseResult(
            structuredClone(
              devResult
            )
          );
        },
      },

      evaluationEngineProvider:
        () =>
          createAgentEvaluationEngine(),
    });

  return {
    service,

    runs:
      () => runs,
  };
}

test(
  "4.5D PASS Evaluation produit STOP sans relance",
  async () => {
    const {
      service,
      runs,
    } =
      fixture(
        passDevResult()
      );

    const result =
      await service.run({
        goalId: "goal-1",
      });

    assert.equal(
      runs(),
      1
    );

    assert.equal(
      result.version,
      "goal-dev-execution-result-v2"
    );

    assert.equal(
      result.devResult
        .metadata
        .agentEvaluation
        .verdict,
      "PASS"
    );

    assert.equal(
      result.continuation
        .state,
      "STOP"
    );

    assert.equal(
      result.continuation
        .retryScheduled,
      false
    );

    assert.equal(
      result.continuation
        .retryAuthorized,
      false
    );

    assert.equal(
      result.continuation
        .executionAuthorized,
      false
    );

    assert.equal(
      result.continuation
        .evaluationApplied,
      true
    );

    assert.equal(
      result.continuation
        .goalStateMutated,
      false
    );

    assert.equal(
      runs(),
      1
    );

    assert.equal(
      Object.isFrozen(result),
      true
    );
  }
);

test(
  "4.5D validation échouée devient RETRY_CANDIDATE mais jamais retry",
  async () => {
    const {
      service,
      runs,
    } =
      fixture({
        taskId: "task-2",
        status: "FAIL",
        finalVerdict: "FAIL",

        failureCategory:
          "VALIDATION_FAILED",

        validations: [
          {
            id: "tests",
            status: "FAIL",
          },
        ],

        diffReview: {
          valid: false,
          issues: [
            "tests failed",
          ],
        },

        preExistingChangesPreserved:
          true,
      });

    const result =
      await service.run({
        goalId: "goal-1",
      });

    assert.equal(
      result.devResult
        .metadata
        .agentEvaluation
        .verdict,
      "FAIL"
    );

    assert.equal(
      result.continuation
        .state,
      "RETRY_CANDIDATE"
    );

    assert.equal(
      result.continuation
        .retryScheduled,
      false
    );

    assert.equal(
      result.continuation
        .retryAuthorized,
      false
    );

    assert.equal(
      result.continuation
        .automatic,
      false
    );

    assert.equal(
      runs(),
      1
    );
  }
);

test(
  "4.5D PARTIAL et preuves insuffisantes restent REVIEW",
  async () => {
    const partial =
      fixture({
        taskId: "task-3",
        status: "PARTIAL",
        finalVerdict:
          "PARTIAL",
        failureCategory:
          "MAX_ITERATIONS",

        validations: [
          {
            id: "tests",
            status: "PASS",
          },
        ],

        diffReview: {
          valid: true,
        },
      });

    const partialResult =
      await partial
        .service
        .run({});

    assert.equal(
      partialResult
        .devResult
        .metadata
        .agentEvaluation
        .verdict,
      "PARTIAL"
    );

    assert.equal(
      partialResult
        .continuation
        .state,
      "REVIEW"
    );

    const insufficient =
      fixture({
        taskId: "task-4",
        status: "PASS",
        finalVerdict: "PASS",
        failureCategory: null,
      });

    const insufficientResult =
      await insufficient
        .service
        .run({});

    assert.equal(
      insufficientResult
        .devResult
        .metadata
        .agentEvaluation
        .verdict,
      "INSUFFICIENT_EVIDENCE"
    );

    assert.equal(
      insufficientResult
        .continuation
        .state,
      "REVIEW"
    );
  }
);

test(
  "4.5D un échec sécurité ou permission n'est jamais RETRY_CANDIDATE",
  () => {
    for (
      const failureCategory of [
        "PERMISSION_FAILURE",
        "PERMISSION_DENIED",
        "OUT_OF_SCOPE_CHANGE",
        "COMMAND_NOT_ALLOWLISTED",
        "TASK_BUDGET_EXCEEDED",
        "LEDGER_INTEGRITY_FAILURE",
        "TIMEOUT",
        "CANCELLED",
      ]
    ) {
      const continuation =
        deriveGoalDevContinuation({
          devResult: {
            finalVerdict:
              "FAIL",
            failureCategory,
          },

          evaluation: {
            verdict: "FAIL",
            confidence: "HIGH",
          },
        });

      assert.equal(
        continuation.state,
        "REVIEW",
        failureCategory
      );

      assert.equal(
        continuation
          .retryAuthorized,
        false
      );
    }
  }
);

test(
  "4.5D échoue fermé si AgentEvaluation n'est pas produite",
  async () => {
    let runs = 0;

    const service =
      createGoalDevEvaluatedExecutionService({
        goalExecutionService: {
          async run() {
            runs += 1;

            return baseResult(
              passDevResult()
            );
          },
        },

        evaluationEngineProvider:
          () => ({
            evaluate() {
              return {};
            },
          }),

        evaluationAttacher(
          result
        ) {
          return result;
        },
      });

    await assert.rejects(
      () =>
        service.run({}),
      {
        code:
          "GOAL_DEV_EVALUATION_UNAVAILABLE",
      }
    );

    assert.equal(
      runs,
      1
    );
  }
);

test(
  "4.5D la policy ne confond jamais candidat retry et autorisation",
  () => {
    const continuation =
      deriveGoalDevContinuation({
        devResult: {
          finalVerdict: "FAIL",
          failureCategory:
            "TASK_FAILURE",
        },

        evaluation: {
          verdict: "FAIL",
          confidence: "HIGH",
        },
      });

    assert.equal(
      continuation.state,
      "RETRY_CANDIDATE"
    );

    assert.equal(
      continuation
        .retryScheduled,
      false
    );

    assert.equal(
      continuation
        .retryAuthorized,
      false
    );

    assert.equal(
      continuation
        .executionAuthorized,
      false
    );
  }
);
