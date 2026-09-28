"use strict";

const assert =
  require("node:assert/strict");
const test =
  require("node:test");

const {
  createNativeDevOrchestratorFacade,
} =
  require("../services/dev/native-dev-orchestrator-facade");

function completedTask(
  taskId = "task-1"
) {
  return {
    taskId,
    status:
      "COMPLETED",
    finalVerdict:
      "PASS",
    failureCategory:
      null,
    startedAt:
      "2026-09-28T08:00:00.000Z",
    endedAt:
      "2026-09-28T08:00:01.000Z",

    analysis: {
      contract: {
        requiredQuality:
          "NORMAL",
      },

      preflight: {
        branch:
          "main",
        language:
          "javascript",
        framework:
          "node",
        snapshot: {
          files: [],
        },
      },
    },

    baseline: [],

    implementation: {
      solved: true,
      backendReached:
        true,
      iterations: [],
      providerCalls: [],
      validations: [],
    },

    review: {
      finalVerdict:
        "PASS",
      failureCategory:
        null,
      preExistingChanges:
        [],
      preExistingChangesPreserved:
        true,
      changedFiles:
        [],
      validations:
        [],
      diffReview: {
        valid: true,
        issues: [],
      },
      diffCheck: {
        command:
          "git diff --check",
        status:
          "PASS",
      },
    },
  };
}

function baseOrchestrator(
  overrides = {}
) {
  return {
    async runTask(input) {
      return completedTask(
        input.taskId
      );
    },

    getTaskStatus() {
      return null;
    },

    cancelTask() {
      return {
        cancelled: false,
      };
    },

    ...overrides,
  };
}

test(
  "B3 façade runTask adapte le pipeline multi-agents au contrat Native DEV",
  async () => {
    let received = null;

    const facade =
      createNativeDevOrchestratorFacade({
        orchestrator:
          baseOrchestrator({
            async runTask(
              input
            ) {
              received =
                input;

              return completedTask(
                input.taskId
              );
            },
          }),

        featureMode:
          () => "LIMITED",

        createTaskId:
          () =>
            "generated-task",
      });

    const result =
      await facade.runTask({
        objective:
          "Corriger",
      });

    assert.equal(
      received.taskId,
      "generated-task"
    );

    assert.equal(
      result.taskId,
      "generated-task"
    );

    assert.equal(
      result.executionMode,
      "NATIVE_NOON"
    );

    assert.equal(
      result.status,
      "PASS"
    );

    assert.equal(
      result.codexUsed,
      false
    );

    assert.equal(
      result.metrics.backendReached,
      true
    );
  }
);

test(
  "B3 façade refuse fail-closed quand dev.native-core n'est pas LIMITED",
  async () => {
    let calls = 0;

    const facade =
      createNativeDevOrchestratorFacade({
        orchestrator:
          baseOrchestrator({
            async runTask() {
              calls += 1;

              return completedTask();
            },
          }),

        featureMode:
          () => "OFF",
      });

    const result =
      await facade.runTask({
        objective:
          "Corriger",
      });

    assert.equal(
      calls,
      0
    );

    assert.equal(
      result.status,
      "FAIL"
    );

    assert.equal(
      result.failureCategory,
      "FEATURE_DISABLED"
    );

    assert.equal(
      result.metrics.backendReached,
      false
    );

    assert.equal(
      result.taskId,
      null
    );
  }
);

test(
  "B3 façade transforme un rejet orchestrateur en résultat FAIL compatible",
  async () => {
    const tasks =
      new Map();

    const facade =
      createNativeDevOrchestratorFacade({
        orchestrator:
          baseOrchestrator({
            async runTask(
              input
            ) {
              tasks.set(
                input.taskId,
                {
                  taskId:
                    input.taskId,
                  status:
                    "FAILED",
                  finalVerdict:
                    "FAIL",
                  failureCategory:
                    "ANALYSIS_FAILURE",
                  startedAt:
                    "2026-09-28T08:00:00.000Z",
                  endedAt:
                    "2026-09-28T08:00:01.000Z",
                }
              );

              throw Object.assign(
                new Error(
                  "analyse impossible"
                ),
                {
                  code:
                    "ANALYSIS_FAILURE",
                }
              );
            },

            getTaskStatus(
              taskId
            ) {
              return (
                tasks.get(
                  taskId
                ) ||
                null
              );
            },
          }),

        featureMode:
          () => "LIMITED",

        createTaskId:
          () =>
            "task-failure",
      });

    const result =
      await facade.runTask({
        objective:
          "Corriger",
      });

    assert.equal(
      result.status,
      "FAIL"
    );

    assert.equal(
      result.failureCategory,
      "ANALYSIS_FAILURE"
    );
  }
);

test(
  "B3 façade adapte la mémoire puis retombe sur le journal persistant",
  () => {
    const journalRecord = {
      taskId:
        "task-journal",
      workspaceId:
        "workspace",
      executionMode:
        "NATIVE_NOON",
      state:
        "PASS",
      finalVerdict:
        "PASS",
      failureCategory:
        null,
    };

    const facade =
      createNativeDevOrchestratorFacade({
        orchestrator:
          baseOrchestrator({
            getTaskStatus(
              taskId
            ) {
              return taskId ===
                "task-memory"
                ? completedTask(
                    taskId
                  )
                : null;
            },
          }),

        journal: {
          load(taskId) {
            return taskId ===
              "task-journal"
              ? journalRecord
              : null;
          },

          interrupted() {
            return [];
          },
        },
      });

    const memory =
      facade.getTaskStatus(
        "task-memory"
      );

    assert.equal(
      memory.status,
      "PASS"
    );

    assert.deepEqual(
      facade.getTaskStatus(
        "task-journal"
      ),
      journalRecord
    );

    assert.equal(
      facade.getTaskStatus(
        "missing"
      ),
      null
    );
  }
);

test(
  "B3 façade reproduit recoverInterrupted depuis le journal",
  () => {
    const facade =
      createNativeDevOrchestratorFacade({
        orchestrator:
          baseOrchestrator(),

        journal: {
          load() {
            return null;
          },

          interrupted() {
            return [
              {
                taskId:
                  "task-crashed",
                state:
                  "EDIT",
              },
            ];
          },
        },
      });

    assert.deepEqual(
      facade.recoverInterrupted(),
      [
        {
          taskId:
            "task-crashed",
          status:
            "INTERRUPTED",
          finalVerdict:
            "PARTIAL",
          failureCategory:
            "PROCESS_RESTARTED",
          requiresUserDecision:
            true,
        },
      ]
    );
  }
);

test(
  "B3 façade délègue cancelTask",
  () => {
    let cancelledId =
      null;

    const facade =
      createNativeDevOrchestratorFacade({
        orchestrator:
          baseOrchestrator({
            cancelTask(
              taskId
            ) {
              cancelledId =
                taskId;

              return {
                cancelled: true,
                taskId,
              };
            },
          }),
      });

    const result =
      facade.cancelTask(
        "task-existing"
      );

    assert.equal(
      result.cancelled,
      true
    );

    assert.equal(
      cancelledId,
      "task-existing"
    );
  }
);
