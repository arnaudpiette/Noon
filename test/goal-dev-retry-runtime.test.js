"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  createApprovalEngine,
} = require("../services/approvals/approval-engine");

const {
  createOperationalSecurityPolicy,
} = require("../services/security/operational-security-policy");

const {
  createInterventionPermissionEngine,
} = require("../services/security/intervention-permission-engine");

const {
  createPersonalDatabase,
} = require("../services/persistence/database");

const {
  createApprovalRepository,
} = require("../services/persistence/repositories/approval-repository");

const {
  createGoalDevRetryExecutionTemplate,
} = require("../services/goals/goal-dev-retry-execution-template");

const {
  createGoalDevRetryRuntime,
} = require("../services/goals/goal-dev-retry-runtime");

const NOW =
  "2026-10-12T05:59:40.000Z";

function fixture() {
  const directory =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "noon-retry-runtime-"
      )
    );

  const databasePath =
    path.join(
      directory,
      "personal.sqlite"
    );

  const repositoryRoot =
    path.join(
      directory,
      "repo"
    );

  fs.mkdirSync(
    repositoryRoot,
    { recursive: true }
  );

  const database =
    createPersonalDatabase(
      databasePath
    );

  const approvalEngine =
    createApprovalEngine({
      repository:
        createApprovalRepository(database),

      now:
        () => Date.parse(NOW),
    });

  const roots = [
    {
      path: repositoryRoot,
      mode: "read-write",
    },
  ];

  const workspaceEngine = {
    context(workspaceId) {
      assert.equal(
        workspaceId,
        "workspace-1"
      );

      return {
        workspace: {
          id: "workspace-1",
          profileScope: "arnaud",
        },

        projects: [
          {
            id: "project-1",
          },
        ],

        roots:
          structuredClone(roots),

        relevantRoots:
          structuredClone(roots),
      };
    },
  };

  const projectProvider =
    () => [
      {
        id: "project-1",
        rootPath: repositoryRoot,
      },
    ];

  let devCalls = 0;
  let lastRequest = null;

  const goalDevExecutionService = {
    async run({
      goalId,
      request,
    }) {
      devCalls += 1;

      assert.equal(
        goalId,
        "goal-1"
      );

      lastRequest =
        structuredClone(request);

      return {
        taskId: request.taskId,

        devResult: {
          taskId: request.taskId,
          status: "COMPLETED",
          finalVerdict: "PASS",
          actualCost: 0,
        },
      };
    },
  };

  const operationalSecurityPolicy =
    createOperationalSecurityPolicy({
      allowedRootsProvider:
        () => [repositoryRoot],

      allowedWriteRootsProvider:
        () => [repositoryRoot],

      now:
        () => Date.parse(NOW),
    });

  const runtime =
    createGoalDevRetryRuntime({
      database,
      approvalEngine,
      operationalSecurityPolicy,

      interventionPermissionEngine:
        createInterventionPermissionEngine(),

      goalDevExecutionService,
      workspaceEngine,
      projectProvider,

      profileScopeProvider:
        () => "arnaud",

      now:
        () => NOW,
    });

  return {
    directory,
    database,
    repositoryRoot,
    roots,
    runtime,

    devCalls:
      () => devCalls,

    request:
      () => lastRequest,

    close() {
      database.close();

      fs.rmSync(
        directory,
        {
          recursive: true,
          force: true,
        }
      );
    },
  };
}

function seedRetry(current) {
  const template =
    createGoalDevRetryExecutionTemplate({
      objective:
        "Corriger le bug Retry.",

      requiredQuality: "HIGH",
      branch: "v2/multi-provider",

      allowedPaths: [
        current.repositoryRoot,
      ],

      forbiddenPaths: [],

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

  const created =
    current.runtime.chainStore.create({
      chainId: "chain-runtime-1",

      goalRef: {
        goalId: "goal-1",
        goalVersion: 4,
        workspaceId: "workspace-1",
        projectId: "project-1",
      },

      rootTaskId: "task-root",
      executionTemplate: template,

      limits: {
        maxRetries: 2,
        maxDuration: 60_000,
        maxEstimatedCost: 3,
      },

      createdAt:
        "2026-10-12T05:59:00.000Z",
    });

  const recorded =
    current.runtime.chainStore
      .recordAttempt(
        "chain-runtime-1",
        {
          expectedRevision:
            created.revision,

          taskId: "task-root",
          finalVerdict: "FAIL",

          failureCategory:
            "VALIDATION_FAILED",

          continuationState:
            "RETRY_CANDIDATE",

          estimatedCost: 0.5,
          actualCost: 0.4,

          recordedAt:
            "2026-10-12T05:59:10.000Z",
        }
      );

  assert.equal(
    recorded.revision,
    2
  );
}

test(
  "4.6J câble SQLite + Permit + Approval + Approved Retry jusqu'à l'unique Goal DEV",
  async () => {
    const current = fixture();

    try {
      seedRetry(current);

      assert.deepEqual(
        current.runtime
          .persistenceCapabilities(),
        {
          backend: "SQLITE",
          atomicRevisionCas: true,
        }
      );

      const permit =
        await current.runtime
          .permitService
          .prepare({
            chainId:
              "chain-runtime-1",
          });

      assert.equal(
        permit.permitState,
        "PENDING_APPROVAL"
      );

      assert.equal(
        permit.approval.status,
        "pending"
      );

      assert.equal(
        current.devCalls(),
        0
      );

      const resumed =
        await current.runtime
          .approvedRetryService
          .resume({
            approvalId:
              permit.approval.approvalId,

            resumeToken:
              permit.approval.resumeToken,

            decision: "approve",
          });

      assert.equal(
        resumed.status,
        "consumed"
      );

      assert.equal(
        current.devCalls(),
        1
      );

      assert.equal(
        current.request()
          .repositoryRoot,
        fs.realpathSync.native(
          current.repositoryRoot
        )
      );

      assert.equal(
        current.request().branch,
        "v2/multi-provider"
      );

      assert.equal(
        current.request()
          .permissions
          .allowGitWrite,
        false
      );

      assert.equal(
        current.request()
          .permissions
          .allowDestructiveActions,
        false
      );

      const latest =
        current.runtime.chainStore.get(
          "chain-runtime-1"
        );

      assert.equal(
        latest.revision,
        5
      );

      const attempt =
        latest.chain
          .attempts
          .at(-1);

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
        attempt.continuationState,
        "STOP"
      );
    } finally {
      current.close();
    }
  }
);

test(
  "4.6J refuse la reprise si le root read-write est révoqué après préparation",
  async () => {
    const current = fixture();

    try {
      seedRetry(current);

      const permit =
        await current.runtime
          .permitService
          .prepare({
            chainId:
              "chain-runtime-1",
          });

      current.roots.splice(
        0,
        current.roots.length,
        {
          path:
            current.repositoryRoot,

          mode: "read-only",
        }
      );

      await assert.rejects(
        () =>
          current.runtime
            .approvedRetryService
            .resume({
              approvalId:
                permit.approval.approvalId,

              resumeToken:
                permit.approval.resumeToken,
            }),
        {
          code:
            "PERMISSION_RECHECK_FAILED",
        }
      );

      assert.equal(
        current.devCalls(),
        0
      );

      const latest =
        current.runtime.chainStore.get(
          "chain-runtime-1"
        );

      assert.equal(
        latest.revision,
        2
      );

      assert.equal(
        latest.chain.attempts.length,
        1
      );
    } finally {
      current.close();
    }
  }
);
