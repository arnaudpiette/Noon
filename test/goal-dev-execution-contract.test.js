"use strict";

const assert =
  require("node:assert/strict");
const fs =
  require("node:fs");
const os =
  require("node:os");
const path =
  require("node:path");
const {
  execFileSync,
} = require("node:child_process");

const test =
  require("node:test");

const {
  projectGoalDevExecution,
} = require(
  "../services/goals/goal-dev-execution-contract"
);
const {
  createGoalDevExecutionService,
} = require(
  "../services/goals/goal-dev-execution-service"
);
const {
  createDevTaskContract,
} = require(
  "../services/delegation/dev-task-contract"
);
const {
  repositoryPreflight,
} = require(
  "../services/delegation/repository-preflight"
);

function goal(
  overrides = {}
) {
  return {
    goalId: "goal-1",
    title: "Stabiliser Noon",
    description: "",
    status: "ACTIVE",
    horizon: "SHORT_TERM",
    category: "PROJECT",
    outcomeDefinition:
      "Livrer une version stable de Noon.",
    successCriteria: [],
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
          "constraint-1",
        description:
          "Ne jamais pousser automatiquement.",
        strength: "HARD",
        source:
          "explicit_user",
        evidenceRefs: [],
      },
    ],
    progress: {
      status: "IN_PROGRESS",
      value: null,
      method: "UNKNOWN",
      confidence: 0,
      measuredAt: null,
      evidenceRefs: [],
    },
    confidence: 1,
    targetDate: null,
    reviewCadence: null,
    importance: null,
    profileScope: "arnaud",
    sensitivity: "NORMAL",
    createdAt:
      "2026-10-10T20:00:00.000Z",
    updatedAt:
      "2026-10-10T20:00:00.000Z",
    source: "explicit_user",
    userConfirmed: true,
    version: 3,
    qualityWarnings: [],

    ...overrides,
  };
}

function request(
  overrides = {}
) {
  return {
    taskId: "task-goal-1",
    sessionId: "session-1",
    workspaceId:
      "workspace-noon",
    projectId:
      "project-noon",
    repositoryRoot:
      "/tmp/noon",
    objective:
      "Corriger le composant ciblé.",
    constraints: [
      "Ne modifier que les fichiers explicitement nécessaires.",
    ],
    validationCommands: [
      "npm test",
    ],
    requiredQuality: "HIGH",

    limits: {
      maxIterations: 8,
      maxRetries: 2,
      maxDuration:
        60 * 60_000,
      maxEstimatedCost: 2,
    },

    permissions: {
      allowNetwork: true,
      allowGitWrite: false,
      allowDestructiveActions:
        false,
    },

    ...overrides,
  };
}

test(
  "4.5B projette Goal vers Native DEV en réduisant toutes les limites supportées",
  () => {
    const budgetCalls = [];

    const result =
      projectGoalDevExecution({
        goal: goal(),

        request:
          request(),

        budgetService: {
          effectiveRemaining(
            taskId,
            taskLimit
          ) {
            budgetCalls.push({
              taskId,
              taskLimit,
            });

            return 0.75;
          },
        },
      });

    assert.equal(
      result.version,
      "goal-dev-execution-v1"
    );

    assert.equal(
      result.devInput
        .maxIterations,
      3
    );

    assert.equal(
      result.devInput
        .maxDuration,
      30 * 60_000
    );

    assert.equal(
      result.devInput
        .maxEstimatedCost,
      0.75
    );

    assert.equal(
      result.devInput
        .enforceTaskBudget,
      true
    );

    assert.deepEqual(
      result.devInput
        .permissions,
      [
        "READ_WRITE_WORKSPACE",
        "TERMINAL_SAFE",
      ]
    );

    assert.equal(
      result.capabilities
        .executionAuthority,
      false
    );

    assert.equal(
      result.capabilities
        .gitWriteAllowed,
      false
    );

    assert.equal(
      result.capabilities
        .destructiveActionsAllowed,
      false
    );

    assert.ok(
      result.devInput
        .constraints
        .some(
          (item) =>
            item.includes(
              "Ne jamais pousser automatiquement."
            )
        )
    );

    assert.deepEqual(
      budgetCalls,
      [
        {
          taskId:
            "task-goal-1",
          taskLimit: 2,
        },
      ]
    );

    assert.equal(
      Object.isFrozen(result),
      true
    );

    assert.equal(
      Object.isFrozen(
        result.devInput
      ),
      true
    );
  }
);

test(
  "4.5B LOCAL_ONLY et allowNetwork false ne peuvent jamais être élargis",
  () => {
    const fromGoal =
      projectGoalDevExecution({
        goal:
          goal({
            sensitivity:
              "LOCAL_ONLY",
          }),

        request:
          request({
            permissions: {
              allowNetwork: true,
              allowGitWrite:
                false,
              allowDestructiveActions:
                false,
            },
          }),
      });

    assert.equal(
      fromGoal.devInput
        .localOnly,
      true
    );

    assert.equal(
      fromGoal.capabilities
        .networkAllowed,
      false
    );

    const fromRequest =
      projectGoalDevExecution({
        goal: goal(),

        request:
          request({
            permissions: {
              allowNetwork: false,
              allowGitWrite:
                false,
              allowDestructiveActions:
                false,
            },
          }),
      });

    assert.equal(
      fromRequest.devInput
        .localOnly,
      true
    );
  }
);

test(
  "4.5B refuse Goal inactif, workspace ou projet hors liaison",
  () => {
    assert.throws(
      () =>
        projectGoalDevExecution({
          goal:
            goal({
              status:
                "PAUSED",
            }),
          request: request(),
        }),
      {
        code:
          "GOAL_DEV_GOAL_NOT_ACTIVE",
      }
    );

    assert.throws(
      () =>
        projectGoalDevExecution({
          goal: goal(),
          request:
            request({
              workspaceId:
                "workspace-other",
            }),
        }),
      {
        code:
          "GOAL_DEV_WORKSPACE_MISMATCH",
      }
    );

    assert.throws(
      () =>
        projectGoalDevExecution({
          goal: goal(),
          request:
            request({
              projectId:
                "project-other",
            }),
        }),
      {
        code:
          "GOAL_DEV_PROJECT_MISMATCH",
      }
    );
  }
);

test(
  "4.5B refuse les limites non encore imposables plutôt que les ignorer",
  () => {
    for (
      const key of [
        "maxSteps",
        "maxProviderCalls",
        "maxShellCommands",
      ]
    ) {
      assert.throws(
        () =>
          projectGoalDevExecution({
            goal: goal(),

            request:
              request({
                limits: {
                  ...request()
                    .limits,
                  [key]: 2,
                },
              }),
          }),
        {
          code:
            "GOAL_DEV_LIMIT_UNSUPPORTED",
        }
      );
    }
  }
);

test(
  "4.5B ne peut créer ni permission Git ni permission destructive",
  () => {
    assert.throws(
      () =>
        projectGoalDevExecution({
          goal: goal(),

          request:
            request({
              permissions: {
                allowNetwork: true,
                allowGitWrite:
                  true,
                allowDestructiveActions:
                  false,
              },
            }),
        }),
      {
        code:
          "GOAL_DEV_CAPABILITY_UNSUPPORTED",
      }
    );

    assert.throws(
      () =>
        projectGoalDevExecution({
          goal: goal(),

          request:
            request({
              permissions: {
                allowNetwork: true,
                allowGitWrite:
                  false,
                allowDestructiveActions:
                  true,
              },
            }),
        }),
      {
        code:
          "GOAL_DEV_CAPABILITY_UNSUPPORTED",
      }
    );
  }
);

test(
  "4.5B ne mute ni Goal ni requête",
  () => {
    const sourceGoal =
      goal();

    const sourceRequest =
      request();

    const beforeGoal =
      structuredClone(
        sourceGoal
      );

    const beforeRequest =
      structuredClone(
        sourceRequest
      );

    projectGoalDevExecution({
      goal: sourceGoal,
      request: sourceRequest,
    });

    assert.deepEqual(
      sourceGoal,
      beforeGoal
    );

    assert.deepEqual(
      sourceRequest,
      beforeRequest
    );
  }
);

test(
  "Goal DEV conserve une branche attendue sans modifier ses autorités",
  () => {
    const sourceRequest =
      request({
        branch:
          "v2/multi-provider",
      });

    const before =
      structuredClone(
        sourceRequest
      );

    const projected =
      projectGoalDevExecution({
        goal: goal(),
        request: sourceRequest,
      });

    const historical =
      projectGoalDevExecution({
        goal: goal(),
        request: request(),
      });

    assert.equal(
      projected.devInput.branch,
      "v2/multi-provider"
    );

    assert.deepEqual(
      {
        ...projected.devInput,
        branch: undefined,
      },
      {
        ...historical.devInput,
        branch: undefined,
      }
    );

    assert.deepEqual(
      projected.capabilities,
      historical.capabilities
    );

    assert.deepEqual(
      sourceRequest,
      before
    );
  }
);

test(
  "Goal DEV conserve la forme historique sans branche",
  () => {
    const historical =
      projectGoalDevExecution({
        goal: goal(),
        request: request(),
      });

    const explicitNull =
      projectGoalDevExecution({
        goal: goal(),
        request:
          request({
            branch: null,
          }),
      });

    assert.equal(
      Object.hasOwn(
        historical.devInput,
        "branch"
      ),
      false
    );

    assert.deepEqual(
      explicitNull.devInput,
      historical.devInput
    );
  }
);

test(
  "Goal DEV refuse une branche invalide au lieu de la coercer ou tronquer",
  () => {
    for (
      const branch of [
        "",
        "   ",
        " main ",
        "main\n",
        "a".repeat(201),
        0,
        42,
        false,
        true,
        {},
        [],
      ]
    ) {
      assert.throws(
        () =>
          projectGoalDevExecution({
            goal: goal(),
            request:
              request({ branch }),
          }),
        {
          code:
            "GOAL_DEV_BRANCH_INVALID",
        }
      );
    }
  }
);

test(
  "Goal DEV transmet la branche au contrat et au préflight Native canoniques",
  async (t) => {
    const root =
      fs.mkdtempSync(
        path.join(
          os.tmpdir(),
          "noon-goal-branch-"
        )
      );

    t.after(() =>
      fs.rmSync(root, {
        recursive: true,
        force: true,
      })
    );

    execFileSync(
      "git",
      [
        "init",
        "-q",
        "-b",
        "main",
        root,
      ]
    );

    assert.equal(
      createDevTaskContract({
        taskId: "task-null-branch",
        workspaceAuthorized:
          true,
        workspaceId:
          "workspace-noon",
        workspaceRoots: [root],
        repositoryRoot: root,
        objective:
          "Fixture sans branche",
        branch: null,
      }).branch,
      null
    );

    const received = [];
    const service =
      createGoalDevExecutionService({
        goalStrategyEngine: {
          registry: {
            get() {
              return goal();
            },
          },
        },
        workspaceEngine: {
          context() {
            return {
              workspace: {
                profileScope:
                  "arnaud",
              },
              projects: [
                {
                  id:
                    "project-noon",
                },
              ],
            };
          },
        },
        projectRuleResolver: {
          resolve() {
            return {
              applied: [],
            };
          },
        },
        nativeDevFacade: {
          async runTask(input) {
            received.push(input);

            const contract =
              createDevTaskContract({
                ...input,
                workspaceAuthorized:
                  true,
                workspaceRoots: [
                  root,
                ],
              });

            assert.equal(
              contract.branch,
              input.branch
            );

            repositoryPreflight(
              contract
            );

            return {
              taskId:
                input.taskId,
              finalVerdict:
                "PASS",
            };
          },
        },
      });

    const input =
      request({
        repositoryRoot: root,
        branch: "main",
      });

    await service.run({
      goalId: "goal-1",
      request: input,
    });

    assert.equal(
      received[0].branch,
      "main"
    );

    await assert.rejects(
      service.run({
        goalId: "goal-1",
        request:
          request({
            repositoryRoot: root,
            branch: "other",
          }),
      }),
      {
        code:
          "STALE_PRECONDITION",
      }
    );

    assert.equal(
      received[1].branch,
      "other"
    );
  }
);
