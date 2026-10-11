"use strict";

const assert =
  require("node:assert/strict");

const test =
  require("node:test");

const {
  appendGoalDevRetryCandidate,
  assessGoalDevRetry,
  createGoalDevRetryChain,
  projectGoalDevRetryCandidate,
  recordGoalDevRetryAttempt,
} = require(
  "../services/goals/goal-dev-retry-chain"
);

function chain(
  overrides = {}
) {
  return createGoalDevRetryChain({
    chainId: "chain-1",

    goalRef: {
      goalId: "goal-1",
      goalVersion: 4,
      workspaceId:
        "workspace-1",
      projectId:
        "project-1",
    },

    rootTaskId:
      "task-root",

    limits: {
      maxRetries: 2,
      maxDuration:
        60_000,
      maxEstimatedCost: 3,
    },

    createdAt:
      "2026-10-11T08:00:00.000Z",

    ...overrides,
  });
}

test(
  "4.6B crée une chaîne bornée sans aucune autorité d'exécution",
  () => {
    const value =
      chain();

    assert.equal(
      value.chainId,
      "chain-1"
    );

    assert.equal(
      value.limits
        .maxAttempts,
      3
    );

    assert.equal(
      value.attempts.length,
      1
    );

    assert.equal(
      value.attempts[0]
        .taskId,
      "task-root"
    );

    assert.equal(
      value.authority
        .retryAuthorized,
      false
    );

    assert.equal(
      value.authority
        .executionAuthorized,
      false
    );

    assert.equal(
      Object.isFrozen(value),
      true
    );
  }
);

test(
  "4.6B comptabilise le coût réel avant l'estimation",
  () => {
    const recorded =
      recordGoalDevRetryAttempt(
        chain(),
        {
          taskId:
            "task-root",

          finalVerdict:
            "FAIL",

          failureCategory:
            "VALIDATION_FAILED",

          continuationState:
            "RETRY_CANDIDATE",

          estimatedCost: 1,
          actualCost: 0.4,

          recordedAt:
            "2026-10-11T08:00:10.000Z",
        }
      );

    assert.equal(
      recorded.accounting
        .accountedCost,
      0.4
    );

    assert.equal(
      recorded.attempts[0]
        .costSource,
      "ACTUAL"
    );
  }
);

test(
  "4.6B utilise l'estimation conservatrice si le coût réel est inconnu",
  () => {
    const recorded =
      recordGoalDevRetryAttempt(
        chain(),
        {
          taskId:
            "task-root",

          finalVerdict:
            "FAIL",

          continuationState:
            "RETRY_CANDIDATE",

          estimatedCost:
            0.75,

          actualCost: null,

          recordedAt:
            "2026-10-11T08:00:10.000Z",
        }
      );

    assert.equal(
      recorded.accounting
        .accountedCost,
      0.75
    );

    assert.equal(
      recorded.attempts[0]
        .costSource,
      "ESTIMATED_CONSERVATIVE"
    );
  }
);

test(
  "4.6B coût totalement inconnu bloque tout retry futur",
  () => {
    const recorded =
      recordGoalDevRetryAttempt(
        chain(),
        {
          taskId:
            "task-root",

          finalVerdict:
            "FAIL",

          continuationState:
            "RETRY_CANDIDATE",

          recordedAt:
            "2026-10-11T08:00:10.000Z",
        }
      );

    const assessment =
      assessGoalDevRetry(
        recorded,
        {
          now:
            "2026-10-11T08:00:20.000Z",
        }
      );

    assert.equal(
      assessment.eligible,
      false
    );

    assert.equal(
      assessment.reasonCode,
      "GOAL_DEV_RETRY_COST_UNKNOWN"
    );
  }
);

test(
  "4.6B RETRY_CANDIDATE peut seulement produire un candidat sans autorité",
  () => {
    const recorded =
      recordGoalDevRetryAttempt(
        chain(),
        {
          taskId:
            "task-root",

          finalVerdict:
            "FAIL",

          failureCategory:
            "VALIDATION_FAILED",

          continuationState:
            "RETRY_CANDIDATE",

          estimatedCost:
            0.5,

          recordedAt:
            "2026-10-11T08:00:10.000Z",
        }
      );

    const candidate =
      projectGoalDevRetryCandidate(
        recorded,
        {
          now:
            "2026-10-11T08:00:20.000Z",

          taskId:
            "task-retry-1",
        }
      );

    assert.equal(
      candidate
        .attemptIndex,
      2
    );

    assert.equal(
      candidate
        .parentTaskId,
      "task-root"
    );

    assert.equal(
      candidate
        .candidateOnly,
      true
    );

    assert.equal(
      candidate
        .retryAuthorized,
      false
    );

    assert.equal(
      candidate
        .executionAuthorized,
      false
    );
  }
);

test(
  "4.6B chaque tentative reçoit un taskId distinct",
  () => {
    const recorded =
      recordGoalDevRetryAttempt(
        chain(),
        {
          taskId:
            "task-root",

          finalVerdict:
            "FAIL",

          continuationState:
            "RETRY_CANDIDATE",

          estimatedCost:
            0.5,

          recordedAt:
            "2026-10-11T08:00:10.000Z",
        }
      );

    assert.throws(
      () =>
        projectGoalDevRetryCandidate(
          recorded,
          {
            now:
              "2026-10-11T08:00:20.000Z",

            taskId:
              "task-root",
          }
        ),
      {
        code:
          "GOAL_DEV_RETRY_TASK_ID_REUSED",
      }
    );
  }
);

test(
  "4.6B le budget retry est global à la chaîne et non au taskId",
  () => {
    let value =
      recordGoalDevRetryAttempt(
        chain(),
        {
          taskId:
            "task-root",

          finalVerdict:
            "FAIL",

          continuationState:
            "RETRY_CANDIDATE",

          estimatedCost: 1,

          recordedAt:
            "2026-10-11T08:00:10.000Z",
        }
      );

    const candidate =
      projectGoalDevRetryCandidate(
        value,
        {
          now:
            "2026-10-11T08:00:20.000Z",

          taskId:
            "task-retry-1",
        }
      );

    value =
      appendGoalDevRetryCandidate(
        value,
        candidate,
        {
          updatedAt:
            "2026-10-11T08:00:20.000Z",
        }
      );

    value =
      recordGoalDevRetryAttempt(
        value,
        {
          taskId:
            "task-retry-1",

          finalVerdict:
            "FAIL",

          continuationState:
            "RETRY_CANDIDATE",

          estimatedCost: 1.5,

          recordedAt:
            "2026-10-11T08:00:30.000Z",
        }
      );

    const assessment =
      assessGoalDevRetry(
        value,
        {
          now:
            "2026-10-11T08:00:40.000Z",
        }
      );

    assert.equal(
      assessment.eligible,
      true
    );

    assert.equal(
      assessment.remaining
        .estimatedCost,
      0.5
    );

    assert.equal(
      assessment.remaining
        .retries,
      1
    );
  }
);

test(
  "4.6B maxRetries est global à la chaîne",
  () => {
    let value =
      createGoalDevRetryChain({
        chainId: "chain-limit",

        goalRef: {
          goalId: "goal-1",
          workspaceId:
            "workspace-1",
        },

        rootTaskId:
          "task-1",

        limits: {
          maxRetries: 1,
          maxDuration:
            60_000,
          maxEstimatedCost:
            10,
        },

        createdAt:
          "2026-10-11T08:00:00.000Z",
      });

    value =
      recordGoalDevRetryAttempt(
        value,
        {
          taskId:
            "task-1",

          finalVerdict:
            "FAIL",

          continuationState:
            "RETRY_CANDIDATE",

          estimatedCost: 1,

          recordedAt:
            "2026-10-11T08:00:10.000Z",
        }
      );

    const candidate =
      projectGoalDevRetryCandidate(
        value,
        {
          now:
            "2026-10-11T08:00:20.000Z",

          taskId:
            "task-2",
        }
      );

    value =
      appendGoalDevRetryCandidate(
        value,
        candidate,
        {
          updatedAt:
            "2026-10-11T08:00:20.000Z",
        }
      );

    value =
      recordGoalDevRetryAttempt(
        value,
        {
          taskId:
            "task-2",

          finalVerdict:
            "FAIL",

          continuationState:
            "RETRY_CANDIDATE",

          estimatedCost: 1,

          recordedAt:
            "2026-10-11T08:00:30.000Z",
        }
      );

    const assessment =
      assessGoalDevRetry(
        value,
        {
          now:
            "2026-10-11T08:00:40.000Z",
        }
      );

    assert.equal(
      assessment.eligible,
      false
    );

    assert.equal(
      assessment.reasonCode,
      "GOAL_DEV_RETRY_LIMIT_EXHAUSTED"
    );
  }
);

test(
  "4.6B la durée est mesurée depuis le début de la chaîne",
  () => {
    const recorded =
      recordGoalDevRetryAttempt(
        chain({
          limits: {
            maxRetries: 2,
            maxDuration:
              5_000,
            maxEstimatedCost:
              10,
          },
        }),
        {
          taskId:
            "task-root",

          finalVerdict:
            "FAIL",

          continuationState:
            "RETRY_CANDIDATE",

          estimatedCost: 1,

          recordedAt:
            "2026-10-11T08:00:01.000Z",
        }
      );

    const assessment =
      assessGoalDevRetry(
        recorded,
        {
          now:
            "2026-10-11T08:00:06.000Z",
        }
      );

    assert.equal(
      assessment.eligible,
      false
    );

    assert.equal(
      assessment.reasonCode,
      "GOAL_DEV_RETRY_DURATION_EXHAUSTED"
    );
  }
);

test(
  "4.6B STOP ferme définitivement la chaîne",
  () => {
    const recorded =
      recordGoalDevRetryAttempt(
        chain(),
        {
          taskId:
            "task-root",

          finalVerdict:
            "PASS",

          continuationState:
            "STOP",

          estimatedCost:
            0.4,

          actualCost:
            0.3,

          recordedAt:
            "2026-10-11T08:00:10.000Z",
        }
      );

    assert.equal(
      recorded.state,
      "STOPPED"
    );

    const assessment =
      assessGoalDevRetry(
        recorded,
        {
          now:
            "2026-10-11T08:00:20.000Z",
        }
      );

    assert.equal(
      assessment.eligible,
      false
    );

    assert.equal(
      assessment.reasonCode,
      "GOAL_DEV_RETRY_CHAIN_STOPPED"
    );
  }
);

test(
  "4.6B REVIEW n'est jamais transformé en retry candidat",
  () => {
    const recorded =
      recordGoalDevRetryAttempt(
        chain(),
        {
          taskId:
            "task-root",

          finalVerdict:
            "PARTIAL",

          continuationState:
            "REVIEW",

          estimatedCost:
            0.2,

          recordedAt:
            "2026-10-11T08:00:10.000Z",
        }
      );

    const assessment =
      assessGoalDevRetry(
        recorded,
        {
          now:
            "2026-10-11T08:00:20.000Z",
        }
      );

    assert.equal(
      assessment.eligible,
      false
    );

    assert.equal(
      assessment.reasonCode,
      "GOAL_DEV_RETRY_NOT_CANDIDATE"
    );
  }
);
