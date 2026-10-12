"use strict";

const assert =
  require("node:assert/strict");

const fs =
  require("node:fs");

const path =
  require("node:path");

const test =
  require("node:test");

const {
  goalDevRetryHttpStatus,
  normalizeGoalDevRetryPrepareRequest,
  normalizeGoalDevRetryResumeRequest,
  projectGoalDevRetryPermitResponse,
  projectGoalDevRetryResumeResponse,
} = require(
  "../services/goals/goal-dev-retry-http-contract"
);

const APPROVAL_ID =
  "approval_11111111-1111-4111-8111-111111111111";

const RESUME_TOKEN =
  "A".repeat(43);

function permit() {
  return {
    version:
      "goal-dev-retry-permit-request-v1",

    permitState:
      "PENDING_APPROVAL",

    preparedAt:
      "2026-10-12T10:00:00.000Z",

    binding: {
      chainId:
        "chain-1",

      taskId:
        "task-retry-1",

      attemptIndex: 2,

      workspaceId:
        "workspace-secret",

      projectId:
        "project-secret",

      executionTemplateFingerprint:
        `sha256:${"a".repeat(64)}`,
    },

    approval: {
      approvalId:
        APPROVAL_ID,

      executionId:
        "goal-retry:chain-1:2:task-retry-1",

      status:
        "pending",

      expiresAt:
        "2026-10-12T10:05:00.000Z",

      payloadHash:
        "secret-hash",

      resumeToken:
        RESUME_TOKEN,
    },

    security: {
      outcome:
        "CONFIRM",

      policyVersion:
        "secret-policy",

      interventionDecision:
        "CONFIRM",
    },

    authority: {
      retryAuthorized: false,
      executionAuthorized:
        false,
      approvalGranted: false,
      securityBypassed: false,
    },
  };
}

test(
  "4.6K prepare n'accepte que chainId",
  () => {
    assert.deepEqual(
      normalizeGoalDevRetryPrepareRequest({
        chainId:
          "chain-1",
      }),
      {
        chainId:
          "chain-1",
      }
    );

    assert.throws(
      () =>
        normalizeGoalDevRetryPrepareRequest({
          chainId:
            "chain-1",

          taskId:
            "caller-task",
        }),
      {
        code:
          "GOAL_DEV_RETRY_HTTP_BODY_INVALID",
      }
    );
  }
);

test(
  "4.6K resume exige une décision explicite et un token borné",
  () => {
    assert.deepEqual(
      normalizeGoalDevRetryResumeRequest({
        approvalId:
          APPROVAL_ID,

        resumeToken:
          RESUME_TOKEN,

        decision:
          "approve",
      }),
      {
        approvalId:
          APPROVAL_ID,

        resumeToken:
          RESUME_TOKEN,

        decision:
          "approve",
      }
    );

    assert.throws(
      () =>
        normalizeGoalDevRetryResumeRequest({
          approvalId:
            APPROVAL_ID,

          resumeToken:
            RESUME_TOKEN,
        }),
      {
        code:
          "GOAL_DEV_RETRY_HTTP_BODY_INVALID",
      }
    );

    assert.throws(
      () =>
        normalizeGoalDevRetryResumeRequest({
          approvalId:
            APPROVAL_ID,

          resumeToken:
            RESUME_TOKEN,

          decision:
            "yes",
        }),
      {
        code:
          "GOAL_DEV_RETRY_HTTP_BODY_INVALID",
      }
    );
  }
);

test(
  "4.6K la réponse Permit n'expose ni binding interne ni policy ni template",
  () => {
    const projected =
      projectGoalDevRetryPermitResponse(
        permit()
      );

    assert.equal(
      projected.chainId,
      "chain-1"
    );

    assert.equal(
      projected.taskId,
      "task-retry-1"
    );

    assert.equal(
      projected.approval
        .resumeToken,
      RESUME_TOKEN
    );

    const serialized =
      JSON.stringify(projected);

    for (
      const forbidden of [
        "workspace-secret",
        "project-secret",
        "executionTemplateFingerprint",
        "secret-hash",
        "secret-policy",
        "\"security\"",
        "\"binding\"",
      ]
    ) {
      assert.equal(
        serialized.includes(
          forbidden
        ),
        false,
        forbidden
      );
    }

    assert.equal(
      projected.authority
        .approvalGranted,
      false
    );
  }
);

test(
  "4.6K la réponse consumed ne renvoie que la projection terminale",
  () => {
    const projected =
      projectGoalDevRetryResumeResponse({
        status:
          "consumed",

        approval: {
          approvalId:
            APPROVAL_ID,

          status:
            "consumed",

          summary:
            "donnée interne",

          expiresAt:
            "2026-10-12T10:05:00.000Z",
        },

        result: {
          version:
            "goal-dev-approved-retry-execution-v1",

          chainId:
            "chain-1",

          taskId:
            "task-retry-1",

          attemptIndex: 2,

          finalVerdict:
            "PASS",

          failureCategory:
            null,

          continuationState:
            "STOP",

          estimatedCost:
            null,

          actualCost: 0,

          chainRevision: 5,

          authority: {
            approvalConsumedBy:
              "ApprovalEngine",

            retrySelfAuthorized:
              false,

            securityBypassed:
              false,
          },

          repositoryRoot:
            "/secret/repo",

          executionTemplate: {
            objective:
              "secret",
          },
        },
      });

    assert.equal(
      projected.status,
      "consumed"
    );

    assert.equal(
      projected.execution
        .actualCost,
      0
    );

    assert.equal(
      JSON.stringify(
        projected
      ).includes(
        "/secret/repo"
      ),
      false
    );

    assert.equal(
      JSON.stringify(
        projected
      ).includes(
        "donnée interne"
      ),
      false
    );
  }
);

test(
  "4.6K mappe les refus d'autorité sans les transformer en succès",
  () => {
    assert.equal(
      goalDevRetryHttpStatus({
        code:
          "PERMISSION_RECHECK_FAILED",
      }),
      403
    );

    assert.equal(
      goalDevRetryHttpStatus({
        code:
          "approval_stale",
      }),
      409
    );

    assert.equal(
      goalDevRetryHttpStatus({
        code:
          "approval_expired",
      }),
      410
    );

    assert.equal(
      goalDevRetryHttpStatus({
        code:
          "GOAL_DEV_RETRY_ATOMIC_PERSISTENCE_REQUIRED",
      }),
      503
    );
  }
);

test(
  "4.6K le wiring HTTP est placé avant le routeur Goal générique et reste Trusted UI",
  () => {
    const server =
      fs.readFileSync(
        path.join(
          __dirname,
          "..",
          "server.js"
        ),
        "utf8"
      );

    const prepareRoute =
      server.search(
        /requestPath\s*===\s*"\/api\/goals\/dev-retry\/prepare"/
      );

    const resumeRoute =
      server.search(
        /requestPath\s*===\s*"\/api\/goals\/dev-retry\/resume"/
      );

    const genericRoute =
      server.indexOf(
        'req.url.startsWith("/api/goals/")'
      );

    assert.ok(
      prepareRoute >= 0
    );

    assert.ok(
      resumeRoute >= 0
    );

    assert.ok(
      genericRoute >= 0
    );

    assert.ok(
      prepareRoute <
        genericRoute
    );

    assert.ok(
      resumeRoute <
        genericRoute
    );

    const apiSlice =
      server.slice(
        Math.min(
          prepareRoute,
          resumeRoute
        ),
        genericRoute
      );

    assert.match(
      apiSlice,
      /requireTrustedDevUi\(req\)/
    );

    assert.match(
      apiSlice,
      /goalDevRetryRuntime[\s\S]*permitService[\s\S]*prepare/
    );

    assert.match(
      apiSlice,
      /goalDevRetryRuntime[\s\S]*approvedRetryService[\s\S]*resume/
    );

    assert.match(
      apiSlice,
      /normalizeGoalDevRetryResumeRequest/
    );

    assert.doesNotMatch(
      apiSlice,
      /decision\s*\|\|\s*"approve"/
    );
  }
);
