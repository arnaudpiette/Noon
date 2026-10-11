"use strict";

const assert =
  require("node:assert/strict");

const test =
  require("node:test");

const {
  createGoalDevExecutionService,
} = require(
  "../services/goals/goal-dev-execution-service"
);

function goal() {
  return {
    goalId: "goal-1",
    status: "ACTIVE",
    userConfirmed: true,
  };
}

function projected() {
  return {
    version:
      "goal-dev-execution-v1",

    goalRef: {
      goalId: "goal-1",
      version: 4,
      workspaceId:
        "workspace-1",
      projectId:
        "project-1",
    },

    devInput: {
      taskId: "task-1",
      sessionId: "session-1",
      workspaceId:
        "workspace-1",
      repositoryRoot:
        "/tmp/repository",
      objective:
        "Corriger le bug.",
      constraints: [
        "Ne modifier que le nécessaire.",
      ],
      validationCommands: [
        "npm test",
      ],
      requiredQuality: "HIGH",
      maxIterations: 3,
      maxDuration: 60_000,
      maxEstimatedCost: 1,
      enforceTaskBudget: true,
      localOnly: false,
      permissions: [
        "READ_WRITE_WORKSPACE",
        "TERMINAL_SAFE",
      ],
    },
  };
}

function fixture({
  devResult = {
    taskId: "task-1",
    status: "COMPLETED",
    finalVerdict: "PASS",
  },
} = {}) {
  const calls = {
    projector: [],
    rules: [],
    dev: [],
    events: [],
  };

  const service =
    createGoalDevExecutionService({
      goalStrategyEngine: {
        registry: {
          get(goalId) {
            assert.equal(
              goalId,
              "goal-1"
            );

            return goal();
          },
        },
      },

      workspaceEngine: {
        context(workspaceId) {
          assert.equal(
            workspaceId,
            "workspace-1"
          );

          return {
            workspace: {
              profileScope:
                "arnaud",
            },

            projects: [
              {
                id:
                  "project-1",
              },
            ],
          };
        },
      },

      projectRuleResolver: {
        resolve(input) {
          calls.rules.push(
            structuredClone(
              input
            )
          );

          return {
            applied: [
              {
                text:
                  "Ne jamais pousser automatiquement.",
              },
            ],
          };
        },
      },

      budgetService: {
        effectiveRemaining() {
          return 1;
        },
      },

      contractProjector(
        input
      ) {
        calls.projector.push(
          input
        );

        return projected();
      },

      nativeDevFacade: {
        async runTask(input) {
          calls.dev.push(
            structuredClone(
              input
            )
          );

          return structuredClone(
            devResult
          );
        },
      },

      observability(
        event,
        metadata
      ) {
        calls.events.push({
          event,
          metadata,
        });
      },
    });

  return {
    service,
    calls,
  };
}

test(
  "4.5C lance explicitement une seule tâche Native DEV depuis un Goal",
  async () => {
    const {
      service,
      calls,
    } = fixture();

    const request = {
      taskId: "task-1",
      workspaceId:
        "workspace-1",
      projectId:
        "project-1",
      repositoryRoot:
        "/tmp/repository",
      objective:
        "Corriger le bug.",
    };

    const result =
      await service.run({
        goalId: "goal-1",
        request,
      });

    assert.equal(
      calls.projector.length,
      1
    );

    assert.equal(
      calls.dev.length,
      1
    );

    assert.equal(
      calls.dev[0]
        .taskId,
      "task-1"
    );

    assert.equal(
      calls.dev[0]
        .enforceTaskBudget,
      true
    );

    assert.deepEqual(
      calls.dev[0]
        .projectInstructions,
      [
        "Ne jamais pousser automatiquement.",
      ]
    );

    assert.equal(
      result.devResult
        .finalVerdict,
      "PASS"
    );

    assert.equal(
      result.continuation
        .automatic,
      false
    );

    assert.equal(
      result.continuation
        .retryScheduled,
      false
    );

    assert.equal(
      result.continuation
        .evaluationApplied,
      false
    );

    assert.equal(
      result.continuation
        .goalStateMutated,
      false
    );

    assert.equal(
      result.authority
        .goalGrantsExecution,
      false
    );

    assert.equal(
      result.authority
        .securityPipelineBypassed,
      false
    );

    assert.equal(
      Object.isFrozen(
        result
      ),
      true
    );
  }
);

test(
  "4.5C les règles projet viennent du resolver autoritatif et non du Goal",
  async () => {
    const {
      service,
      calls,
    } = fixture();

    await service.run({
      goalId: "goal-1",

      request: {
        objective: "test",
      },
    });

    assert.equal(
      calls.rules.length,
      1
    );

    assert.deepEqual(
      calls.rules[0],
      {
        projectId:
          "project-1",

        ownerProfileScope:
          "arnaud",

        taskRestrictions: [
          "Ne modifier que le nécessaire.",
        ],
      }
    );
  }
);

test(
  "4.5C refuse un projet workspace ambigu ou divergent avant Native DEV",
  async () => {
    let devCalls = 0;

    const base = {
      goalStrategyEngine: {
        registry: {
          get() {
            return goal();
          },
        },
      },

      projectRuleResolver: {
        resolve() {
          return {
            applied: [],
          };
        },
      },

      contractProjector() {
        return projected();
      },

      nativeDevFacade: {
        async runTask() {
          devCalls += 1;

          return {};
        },
      },
    };

    const ambiguous =
      createGoalDevExecutionService({
        ...base,

        workspaceEngine: {
          context() {
            return {
              workspace: {
                profileScope:
                  "arnaud",
              },

              projects: [],
            };
          },
        },
      });

    await assert.rejects(
      () =>
        ambiguous.run({
          goalId: "goal-1",
          request: {},
        }),
      {
        code:
          "GOAL_DEV_PROJECT_UNRESOLVED",
      }
    );

    const divergent =
      createGoalDevExecutionService({
        ...base,

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
                    "project-other",
                },
              ],
            };
          },
        },
      });

    await assert.rejects(
      () =>
        divergent.run({
          goalId: "goal-1",
          request: {},
        }),
      {
        code:
          "GOAL_DEV_PROJECT_MISMATCH",
      }
    );

    assert.equal(
      devCalls,
      0
    );
  }
);

test(
  "4.5C un FAIL DEV n'entraîne ni retry ni second runTask",
  async () => {
    const {
      service,
      calls,
    } = fixture({
      devResult: {
        taskId: "task-1",
        status: "FAILED",
        finalVerdict: "FAIL",
        failureCategory:
          "VALIDATION_FAILED",
      },
    });

    const result =
      await service.run({
        goalId: "goal-1",
        request: {},
      });

    assert.equal(
      calls.dev.length,
      1
    );

    assert.equal(
      result.devResult
        .finalVerdict,
      "FAIL"
    );

    assert.equal(
      result.continuation
        .retryScheduled,
      false
    );

    assert.equal(
      result.continuation
        .evaluationApplied,
      false
    );
  }
);

test(
  "4.5C ne modifie jamais le Goal via le registry",
  async () => {
    let updateCalls = 0;

    const {
      service,
    } =
      (() => {
        const calls = {};

        const service =
          createGoalDevExecutionService({
            goalStrategyEngine: {
              registry: {
                get() {
                  return goal();
                },

                update() {
                  updateCalls += 1;
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
                        "project-1",
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

            contractProjector() {
              return projected();
            },

            nativeDevFacade: {
              async runTask() {
                return {
                  taskId:
                    "task-1",
                  finalVerdict:
                    "PASS",
                };
              },
            },
          });

        return {
          service,
          calls,
        };
      })();

    await service.run({
      goalId: "goal-1",
      request: {},
    });

    assert.equal(
      updateCalls,
      0
    );
  }
);
