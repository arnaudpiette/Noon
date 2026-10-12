"use strict";

const assert =
  require("node:assert/strict");

const test =
  require("node:test");

const {
  createApprovalEngine,
} = require(
  "../services/approvals/approval-engine"
);

const {
  createGoalDevRetryExecutionTemplate,
} = require(
  "../services/goals/goal-dev-retry-execution-template"
);

const {
  appendGoalDevRetryCandidate,
  createGoalDevRetryChain,
  markGoalDevRetryExecutionUncertain,
  projectGoalDevRetryCandidate,
  recordGoalDevRetryAttempt,
} = require(
  "../services/goals/goal-dev-retry-chain"
);

const {
  OPERATION,
  SKILL_NAME,
} = require(
  "../services/goals/goal-dev-retry-permit-service"
);

const {
  createGoalDevApprovedRetryService,
} = require(
  "../services/goals/goal-dev-approved-retry-service"
);

const NOW =
  "2026-10-12T05:59:40.000Z";

function initialChain() {
  const template =
    createGoalDevRetryExecutionTemplate({
      objective:
        "Corriger le bug Retry.",

      requiredQuality:
        "HIGH",

      branch:
        "v2/multi-provider",

      allowedPaths: [
        "/repo/src",
      ],

      forbiddenPaths: [
        "/repo/.env",
      ],

      constraints: [
        "Préserver les changements existants",
      ],

      validationCommands: [
        "npm test",
      ],

      maxIterations: 3,
      maxDuration: 60_000,
      maxEstimatedCost: 3,
      localOnly: true,
    });

  let chain =
    createGoalDevRetryChain({
      chainId:
        "chain-approved-1",

      goalRef: {
        goalId:
          "goal-1",

        goalVersion: 4,

        workspaceId:
          "workspace-1",

        projectId:
          "project-1",
      },

      rootTaskId:
        "task-root",

      executionTemplate:
        template,

      limits: {
        maxRetries: 2,
        maxDuration:
          60_000,
        maxEstimatedCost: 3,
      },

      createdAt:
        "2026-10-12T05:59:00.000Z",
    });

  chain =
    recordGoalDevRetryAttempt(
      chain,
      {
        taskId:
          "task-root",

        finalVerdict:
          "FAIL",

        failureCategory:
          "VALIDATION_FAILED",

        continuationState:
          "RETRY_CANDIDATE",

        estimatedCost: 0.5,
        actualCost: 0.4,

        recordedAt:
          "2026-10-12T05:59:30.000Z",
      }
    );

  return chain;
}

function fakeStore({
  atomic = true,
} = {}) {
  let chain =
    initialChain();

  let revision = 4;

  const calls = [];

  function conflict(
    expectedRevision
  ) {
    if (
      expectedRevision !==
      revision
    ) {
      throw Object.assign(
        new Error("stale"),
        {
          code:
            "GOAL_DEV_RETRY_PERSISTENCE_CONFLICT",
        }
      );
    }
  }

  return {
    calls,

    get() {
      return {
        revision,
        chain,
      };
    },

    persistenceCapabilities() {
      return atomic
        ? {
            backend:
              "SQLITE",

            atomicRevisionCas:
              true,
          }
        : {
            backend:
              "JSON_FALLBACK",

            atomicRevisionCas:
              false,
          };
    },

    projectCandidate(
      chainId,
      input
    ) {
      assert.equal(
        chainId,
        chain.chainId
      );

      return projectGoalDevRetryCandidate(
        chain,
        input
      );
    },

    appendCandidate(
      chainId,
      candidate,
      input
    ) {
      assert.equal(
        chainId,
        chain.chainId
      );

      conflict(
        input.expectedRevision
      );

      calls.push(
        "append"
      );

      chain =
        appendGoalDevRetryCandidate(
          chain,
          candidate,
          {
            updatedAt:
              input.updatedAt,
          }
        );

      revision += 1;

      return {
        revision,
        chain,
      };
    },

    markExecutionUncertain(
      chainId,
      input
    ) {
      assert.equal(
        chainId,
        chain.chainId
      );

      conflict(
        input.expectedRevision
      );

      calls.push(
        "uncertain"
      );

      chain =
        markGoalDevRetryExecutionUncertain(
          chain,
          input
        );

      revision += 1;

      return {
        revision,
        chain,
      };
    },

    recordAttempt(
      chainId,
      input
    ) {
      assert.equal(
        chainId,
        chain.chainId
      );

      conflict(
        input.expectedRevision
      );

      calls.push(
        "record"
      );

      chain =
        recordGoalDevRetryAttempt(
          chain,
          input
        );

      revision += 1;

      return {
        revision,
        chain,
      };
    },

    bumpRevision() {
      revision += 1;
    },
  };
}

function binding(
  store
) {
  const current =
    store.get();

  const candidate =
    store.projectCandidate(
      current.chain.chainId,
      {
        now: NOW,

        taskId:
          "task-retry-1",
      }
    );

  return {
    version:
      "goal-dev-retry-permit-binding-v1",

    chainId:
      current.chain.chainId,

    chainRevision:
      current.revision,

    goalId:
      current.chain
        .goalRef
        .goalId,

    workspaceId:
      current.chain
        .goalRef
        .workspaceId,

    projectId:
      current.chain
        .goalRef
        .projectId,

    rootTaskId:
      current.chain
        .rootTaskId,

    parentTaskId:
      candidate
        .parentTaskId,

    taskId:
      candidate
        .taskId,

    attemptIndex:
      candidate
        .attemptIndex,

    executionTemplateFingerprint:
      candidate
        .executionTemplateFingerprint,
  };
}

function prepareApproval(
  approvalEngine,
  value
) {
  return approvalEngine
    .prepareAction({
      executionId:
        `goal-retry:${value.chainId}:${value.attemptIndex}:${value.taskId}`,

      skillName:
        SKILL_NAME,

      operation:
        OPERATION,

      normalizedArgs:
        value,

      target:
        value.taskId,

      permissionLevel:
        "write",

      preconditions: {
        chainId:
          value.chainId,

        chainRevision:
          value.chainRevision,

        executionTemplateFingerprint:
          value
            .executionTemplateFingerprint,

        parentTaskId:
          value.parentTaskId,
      },
    });
}

function fixture({
  atomic = true,
  securityAllowed = true,
  permissionAllowed = true,

  devResult = {
    taskId:
      "task-retry-1",

    status:
      "COMPLETED",

    finalVerdict:
      "PASS",

    actualCost: 0,
  },

  executionError =
    null,
} = {}) {
  const store =
    fakeStore({
      atomic,
    });

  const approvalEngine =
    createApprovalEngine({
      now:
        () =>
          Date.parse(NOW),
    });

  const approvedBinding =
    binding(store);

  const approval =
    prepareApproval(
      approvalEngine,
      approvedBinding
    );

  const approvalId =
    approval.approvalId ||
    approval.id;

  const calls = [];

  let requestSeen =
    null;

  const service =
    createGoalDevApprovedRetryService({
      chainStore:
        store,

      approvalEngine,

      executionContextResolver:
        async ({
          binding:
            current,
        }) => {
          calls.push(
            "context"
          );

          assert.equal(
            current.taskId,
            approvedBinding
              .taskId
          );

          return {
            repositoryRoot:
              "/authoritative/noon",
          };
        },

      securityRecheck:
        async () => {
          calls.push(
            "security"
          );

          return securityAllowed;
        },

      permissionRecheck:
        async () => {
          calls.push(
            "permission"
          );

          return permissionAllowed;
        },

      goalDevExecutionService: {
        async run({
          goalId,
          request,
        }) {
          calls.push(
            "goal"
          );

          assert.equal(
            goalId,
            approvedBinding
              .goalId
          );

          requestSeen =
            structuredClone(
              request
            );

          if (executionError) {
            throw executionError;
          }

          return {
            taskId:
              request.taskId,

            devResult:
              structuredClone(
                devResult
              ),
          };
        },
      },

      now:
        () => NOW,
    });

  return {
    service,
    store,
    approvalEngine,
    approvalId,

    resumeToken:
      approval.resumeToken,

    approvedBinding,
    calls,

    request:
      () =>
        requestSeen,
  };
}

test(
  "4.6I consomme l'approbation, persiste la frontière avant DEV et enregistre PASS",
  async () => {
    const current =
      fixture();

    const result =
      await current
        .service
        .resume({
          approvalId:
            current.approvalId,

          resumeToken:
            current.resumeToken,

          decision:
            "approve",
        });

    assert.equal(
      result.status,
      "consumed"
    );

    assert.deepEqual(
      current.store.calls,
      [
        "append",
        "uncertain",
        "record",
      ]
    );

    assert.deepEqual(
      current.calls,
      [
        "security",
        "permission",
        "context",
        "goal",
      ]
    );

    const request =
      current.request();

    assert.equal(
      request.repositoryRoot,
      "/authoritative/noon"
    );

    assert.equal(
      request.branch,
      "v2/multi-provider"
    );

    assert.equal(
      request.taskId,
      "task-retry-1"
    );

    assert.equal(
      request.localOnly,
      true
    );

    assert.equal(
      request.permissions
        .allowNetwork,
      false
    );

    assert.equal(
      request.permissions
        .allowGitWrite,
      false
    );

    assert.equal(
      request.permissions
        .allowDestructiveActions,
      false
    );

    const latest =
      current.store.get();

    const attempt =
      latest.chain
        .attempts
        .at(-1);

    assert.equal(
      latest.revision,
      7
    );

    assert.equal(
      attempt.state,
      "RECORDED"
    );

    assert.equal(
      attempt.executionBoundary,
      "MAY_HAVE_STARTED"
    );

    assert.equal(
      attempt.finalVerdict,
      "PASS"
    );

    assert.equal(
      attempt.actualCost,
      0
    );

    assert.equal(
      attempt.accountedCost,
      0
    );

    assert.equal(
      attempt.continuationState,
      "STOP"
    );

    assert.equal(
      result.result
        .authority
        .retrySelfAuthorized,
      false
    );
  }
);

test(
  "4.6I un refus ne requiert aucun backend et ne mute ni chaîne ni DEV",
  async () => {
    const current =
      fixture({
        atomic: false,
      });

    const result =
      await current
        .service
        .resume({
          approvalId:
            current.approvalId,

          resumeToken:
            current.resumeToken,

          decision:
            "reject",
        });

    assert.equal(
      result.status,
      "rejected"
    );

    assert.deepEqual(
      current.store.calls,
      []
    );

    assert.deepEqual(
      current.calls,
      []
    );

    assert.equal(
      current.store
        .get()
        .revision,
      4
    );
  }
);

test(
  "4.6I refuse tout backend sans CAS SQLite avant consommation",
  async () => {
    const current =
      fixture({
        atomic: false,
      });

    await assert.rejects(
      () =>
        current
          .service
          .resume({
            approvalId:
              current.approvalId,

            resumeToken:
              current.resumeToken,
          }),
      {
        code:
          "GOAL_DEV_RETRY_ATOMIC_PERSISTENCE_REQUIRED",
      }
    );

    assert.equal(
      current
        .approvalEngine
        .get(
          current.approvalId
        )
        .status,
      "pending"
    );

    assert.deepEqual(
      current.store.calls,
      []
    );
  }
);

test(
  "4.6I une révision stale échoue avant mutation ou DEV",
  async () => {
    const current =
      fixture();

    current.store
      .bumpRevision();

    await assert.rejects(
      () =>
        current
          .service
          .resume({
            approvalId:
              current.approvalId,

            resumeToken:
              current.resumeToken,
          }),
      {
        code:
          "approval_stale",
      }
    );

    assert.deepEqual(
      current.store.calls,
      []
    );

    assert.equal(
      current.calls
        .includes("goal"),
      false
    );

    assert.equal(
      current
        .approvalEngine
        .get(
          current.approvalId
        )
        .status,
      "failed"
    );
  }
);

test(
  "4.6I revalide sécurité et permission avant toute mutation",
  async () => {
    for (
      const denied of [
        "security",
        "permission",
      ]
    ) {
      const current =
        fixture({
          securityAllowed:
            denied !==
            "security",

          permissionAllowed:
            denied !==
            "permission",
        });

      await assert.rejects(
        () =>
          current
            .service
            .resume({
              approvalId:
                current.approvalId,

              resumeToken:
                current.resumeToken,
            }),
        {
          code:
            denied ===
            "security"
              ? "HARD_RULE_RECHECK_FAILED"
              : "PERMISSION_RECHECK_FAILED",
        }
      );

      assert.deepEqual(
        current.store.calls,
        []
      );

      assert.equal(
        current.calls
          .includes("goal"),
        false
      );
    }
  }
);

test(
  "4.6I un échec après la frontière laisse durablement MAY_HAVE_STARTED",
  async () => {
    const current =
      fixture({
        executionError:
          Object.assign(
            new Error(
              "simulation"
            ),
            {
              code:
                "NATIVE_SIMULATED_FAILURE",
            }
          ),
      });

    await assert.rejects(
      () =>
        current
          .service
          .resume({
            approvalId:
              current.approvalId,

            resumeToken:
              current.resumeToken,
          }),
      {
        code:
          "NATIVE_SIMULATED_FAILURE",
      }
    );

    assert.deepEqual(
      current.store.calls,
      [
        "append",
        "uncertain",
      ]
    );

    const latest =
      current.store.get();

    const attempt =
      latest.chain
        .attempts
        .at(-1);

    assert.equal(
      latest.revision,
      6
    );

    assert.equal(
      attempt.state,
      "PLANNED"
    );

    assert.equal(
      attempt.executionBoundary,
      "MAY_HAVE_STARTED"
    );

    assert.equal(
      attempt.actualCost,
      null
    );

    assert.equal(
      current
        .approvalEngine
        .get(
          current.approvalId
        )
        .status,
      "failed"
    );
  }
);

test(
  "4.6I n'invente aucun coût et classe un FAIL terminal en REVIEW",
  async () => {
    const current =
      fixture({
        devResult: {
          taskId:
            "task-retry-1",

          status:
            "FAILED",

          finalVerdict:
            "FAIL",

          failureCategory:
            "VALIDATION_FAILED",

          metrics: {
            estimatedCost: 99,
            actualCost: 99,
          },
        },
      });

    const result =
      await current
        .service
        .resume({
          approvalId:
            current.approvalId,

          resumeToken:
            current.resumeToken,
        });

    assert.equal(
      result.status,
      "consumed"
    );

    const attempt =
      current.store
        .get()
        .chain
        .attempts
        .at(-1);

    assert.equal(
      attempt.finalVerdict,
      "FAIL"
    );

    assert.equal(
      attempt.continuationState,
      "REVIEW"
    );

    assert.equal(
      attempt.estimatedCost,
      null
    );

    assert.equal(
      attempt.actualCost,
      null
    );

    assert.equal(
      attempt.accountedCost,
      null
    );

    assert.equal(
      current.store
        .get()
        .chain
        .accounting
        .costKnown,
      false
    );
  }
);
