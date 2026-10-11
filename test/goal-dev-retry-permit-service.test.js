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
  createOperationalSecurityPolicy,
} = require(
  "../services/security/operational-security-policy"
);

const {
  createInterventionPermissionEngine,
} = require(
  "../services/security/intervention-permission-engine"
);

const {
  createGoalDevRetryExecutionTemplate,
} = require(
  "../services/goals/goal-dev-retry-execution-template"
);

const {
  assessGoalDevRetry,
  createGoalDevRetryChain,
  projectGoalDevRetryCandidate,
  recordGoalDevRetryAttempt,
} = require(
  "../services/goals/goal-dev-retry-chain"
);

const {
  createGoalDevRetryPermitService,
} = require(
  "../services/goals/goal-dev-retry-permit-service"
);

const NOW =
  "2026-10-11T08:00:20.000Z";

function retryChain() {
  const template =
    createGoalDevRetryExecutionTemplate({
      objective:
        "Corriger le bug de validation.",

      requiredQuality:
        "HIGH",

      branch:
        "v2/multi-provider",

      allowedPaths: [
        "/repo/src",
        "/repo/test",
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
        "chain-permit-1",

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
        "2026-10-11T08:00:00.000Z",
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

        estimatedCost:
          0.5,

        actualCost:
          0.4,

        recordedAt:
          "2026-10-11T08:00:10.000Z",
      }
    );

  return chain;
}

function fixture({
  chain =
    retryChain(),

  permission = {
    allowed: true,
    code:
      "AUTHORIZED_GOAL_DEV_RETRY",
  },

  interventionOverride =
    null,
} = {}) {
  let appendCalls = 0;

  const chainStore = {
    get(chainId) {
      assert.equal(
        chainId,
        chain.chainId
      );

      return {
        revision: 4,
        chain,
      };
    },

    assess(
      chainId,
      options
    ) {
      assert.equal(
        chainId,
        chain.chainId
      );

      return assessGoalDevRetry(
        chain,
        options
      );
    },

    projectCandidate(
      chainId,
      options
    ) {
      assert.equal(
        chainId,
        chain.chainId
      );

      return projectGoalDevRetryCandidate(
        chain,
        {
          ...options,

          /*
           * déterministe uniquement
           * pour ce test.
           */
          taskId:
            "task-retry-1",
        }
      );
    },

    appendCandidate() {
      appendCalls += 1;

      throw new Error(
        "4.6F ne doit jamais muter la Retry Chain."
      );
    },
  };

  const securityPolicy =
    createOperationalSecurityPolicy({
      allowedRootsProvider:
        () => [],

      allowedWriteRootsProvider:
        () => [],

      now:
        () =>
          Date.parse(NOW),
    });

  const canonicalIntervention =
    createInterventionPermissionEngine();

  const interventionPermissionEngine =
    interventionOverride
      ? {
          evaluate:
            interventionOverride,
        }
      : canonicalIntervention;

  const approvalEngine =
    createApprovalEngine({
      now:
        () =>
          Date.parse(NOW),
    });

  const service =
    createGoalDevRetryPermitService({
      chainStore,
      securityPolicy,
      interventionPermissionEngine,
      approvalEngine,

      permissionResolver:
        async () =>
          structuredClone(
            permission
          ),

      profileScopeProvider:
        () =>
          "arnaud",

      now:
        () =>
          NOW,
    });

  return {
    approvalEngine,
    chainStore,
    getAppendCalls:
      () => appendCalls,
    service,
  };
}

test(
  "4.6F prépare une approbation canonique sans autoriser ni exécuter le retry",
  async () => {
    const current =
      fixture();

    const result =
      await current
        .service
        .prepare({
          chainId:
            "chain-permit-1",
        });

    assert.equal(
      result.version,
      "goal-dev-retry-permit-request-v1"
    );

    assert.equal(
      result.permitState,
      "PENDING_APPROVAL"
    );

    assert.equal(
      result.security
        .interventionDecision,
      "CONFIRM"
    );

    assert.equal(
      result.authority
        .retryAuthorized,
      false
    );

    assert.equal(
      result.authority
        .executionAuthorized,
      false
    );

    assert.equal(
      result.authority
        .approvalGranted,
      false
    );

    assert.equal(
      current.getAppendCalls(),
      0
    );

    const approval =
      current.approvalEngine
        .get(
          result.approval
            .approvalId
        );

    assert.equal(
      approval.status,
      "pending"
    );

    assert.deepEqual(
      approval.actions,
      [
        "approve",
        "reject",
      ]
    );
  }
);

test(
  "4.6F lie l'approbation à chain revision attempt task et template fingerprint",
  async () => {
    const current =
      fixture();

    const result =
      await current
        .service
        .prepare({
          chainId:
            "chain-permit-1",
        });

    assert.deepEqual(
      {
        chainId:
          result.binding
            .chainId,

        chainRevision:
          result.binding
            .chainRevision,

        parentTaskId:
          result.binding
            .parentTaskId,

        taskId:
          result.binding
            .taskId,

        attemptIndex:
          result.binding
            .attemptIndex,
      },
      {
        chainId:
          "chain-permit-1",

        chainRevision: 4,

        parentTaskId:
          "task-root",

        taskId:
          "task-retry-1",

        attemptIndex: 2,
      }
    );

    assert.match(
      result.binding
        .executionTemplateFingerprint,
      /^sha256:[a-f0-9]{64}$/
    );
  }
);

test(
  "4.6F ne divulgue ni objectif brut ni chemins du Retry Execution Template",
  async () => {
    const current =
      fixture();

    const result =
      await current
        .service
        .prepare({
          chainId:
            "chain-permit-1",
        });

    const serialized =
      JSON.stringify(
        result
      );

    assert.equal(
      serialized.includes(
        "Corriger le bug de validation"
      ),
      false
    );

    assert.equal(
      serialized.includes(
        "/repo/src"
      ),
      false
    );

    assert.equal(
      serialized.includes(
        "npm test"
      ),
      false
    );

    assert.equal(
      serialized.includes(
        "READ_WRITE_WORKSPACE"
      ),
      false
    );
  }
);

test(
  "4.6F ApprovalEngine refuse un binding modifié après approbation",
  async () => {
    const current =
      fixture();

    const result =
      await current
        .service
        .prepare({
          chainId:
            "chain-permit-1",
        });

    current.approvalEngine
      .confirm(
        result.approval
          .approvalId
      );

    const tampered =
      structuredClone(
        result.binding
      );

    tampered.attemptIndex =
      99;

    assert.throws(
      () =>
        current.approvalEngine
          .consumeApproval(
            result.approval
              .approvalId,
            {
              provider:
                "goal.dev.retry",

              action:
                "execute_goal_dev_retry",

              target:
                result.binding
                  .taskId,

              payload:
                tampered,
            }
          ),
      {
        code:
          "APPROVAL_ACTION_CHANGED",
      }
    );
  }
);

test(
  "4.6F l'approbation canonique est consommable exactement une fois",
  async () => {
    const current =
      fixture();

    const result =
      await current
        .service
        .prepare({
          chainId:
            "chain-permit-1",
        });

    current.approvalEngine
      .confirm(
        result.approval
          .approvalId
      );

    const exactInput = {
      provider:
        "goal.dev.retry",

      action:
        "execute_goal_dev_retry",

      target:
        result.binding
          .taskId,

      payload:
        result.binding,
    };

    assert.equal(
      current.approvalEngine
        .consumeApproval(
          result.approval
            .approvalId,
          exactInput
        ),
      true
    );

    assert.throws(
      () =>
        current.approvalEngine
          .consumeApproval(
            result.approval
              .approvalId,
            exactInput
          ),
      {
        code:
          "APPROVAL_INVALID",
      }
    );
  }
);

test(
  "4.6F une permission autoritative refusée bloque avant ApprovalEngine",
  async () => {
    const current =
      fixture({
        permission: {
          allowed: false,
          code:
            "PERMISSION_DENIED",
        },
      });

    await assert.rejects(
      () =>
        current.service
          .prepare({
            chainId:
              "chain-permit-1",
          }),
      {
        code:
          "GOAL_DEV_RETRY_PERMISSION_DENIED",
      }
    );

    assert.equal(
      current.approvalEngine
        .listPending()
        .length,
      0
    );
  }
);

test(
  "4.6F une Retry Chain non éligible ne peut produire aucune approbation",
  async () => {
    const base =
      retryChain();

    const stopped =
      recordGoalDevRetryAttempt;

    /*
     * Recrée directement une chaîne
     * qui se termine sur STOP.
     */
    const template =
      base.executionTemplate;

    let chain =
      createGoalDevRetryChain({
        chainId:
          "chain-stopped",

        goalRef:
          base.goalRef,

        rootTaskId:
          "task-stop",

        executionTemplate:
          template,

        limits:
          base.limits,

        createdAt:
          "2026-10-11T08:00:00.000Z",
      });

    chain =
      stopped(
        chain,
        {
          taskId:
            "task-stop",

          finalVerdict:
            "PASS",

          continuationState:
            "STOP",

          estimatedCost:
            0.1,

          actualCost:
            0.1,

          recordedAt:
            "2026-10-11T08:00:10.000Z",
        }
      );

    const current =
      fixture({
        chain,
      });

    await assert.rejects(
      () =>
        current.service
          .prepare({
            chainId:
              "chain-stopped",
          }),
      {
        code:
          "GOAL_DEV_RETRY_NOT_ELIGIBLE",
      }
    );

    assert.equal(
      current.approvalEngine
        .listPending()
        .length,
      0
    );
  }
);

test(
  "4.6F échoue fermé si InterventionPermissionEngine répond PROCEED",
  async () => {
    const current =
      fixture({
        interventionOverride:
          () => ({
            decision:
              "PROCEED",

            executable: true,

            requiresApproval:
              false,

            actionFingerprint:
              "forged-proceed",

            policyVersion:
              "fixture",
          }),
      });

    await assert.rejects(
      () =>
        current.service
          .prepare({
            chainId:
              "chain-permit-1",
          }),
      {
        code:
          "GOAL_DEV_RETRY_APPROVAL_REQUIRED",
      }
    );

    assert.equal(
      current.approvalEngine
        .listPending()
        .length,
      0
    );
  }
);

test(
  "4.6F refuse un Retry Candidate dont le template fingerprint diverge",
  async () => {
    const chain =
      retryChain();

    const baseFixture =
      fixture({
        chain,
      });

    const original =
      baseFixture.chainStore
        .projectCandidate;

    baseFixture.chainStore
      .projectCandidate =
      (...args) => ({
        ...original(...args),

        executionTemplateFingerprint:
          "sha256:" +
          "0".repeat(64),
      });

    await assert.rejects(
      () =>
        baseFixture.service
          .prepare({
            chainId:
              "chain-permit-1",
          }),
      {
        code:
          "GOAL_DEV_RETRY_PERMIT_CANDIDATE_INVALID",
      }
    );

    assert.equal(
      baseFixture.approvalEngine
        .listPending()
        .length,
      0
    );
  }
);
