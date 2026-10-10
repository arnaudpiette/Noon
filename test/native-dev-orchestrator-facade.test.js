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

test(
  "4.4D façade projette explicitement une tâche Native DEV sans la réexécuter",
  () => {
    const task =
      completedTask(
        "task-decision-evidence"
      );

    let runCalls = 0;
    let adapterCalls = 0;
    let received = null;

    const mappings = [
      {
        source: "TERMINAL",
        optionId: "option-a",
        criterionId: "quality",
      },
    ];

    const context = {
      decisionRequest: {
        schemaVersion: 2,
      },
    };

    const projection =
      Object.freeze({
        adapterVersion:
          "native-dev-evidence-v1",
        sourceDevRef:
          "native_dev_task_fixture",
        evidence: Object.freeze([]),
        attestedEvidenceIds:
          Object.freeze([]),
      });

    const facade =
      createNativeDevOrchestratorFacade({
        orchestrator:
          baseOrchestrator({
            async runTask(input) {
              runCalls += 1;

              return completedTask(
                input.taskId
              );
            },

            getTaskStatus(taskId) {
              return taskId ===
                task.taskId
                ? task
                : null;
            },
          }),

        decisionEvidenceAdapter(
          input
        ) {
          adapterCalls += 1;
          received = input;

          return projection;
        },
      });

    const result =
      facade.projectDecisionEvidence({
        taskId:
          task.taskId,
        mappings,
        context,
      });

    assert.equal(
      runCalls,
      0
    );

    assert.equal(
      adapterCalls,
      1
    );

    assert.equal(
      received.devResult,
      task
    );

    assert.equal(
      received.mappings,
      mappings
    );

    assert.equal(
      received.context,
      context
    );

    assert.equal(
      result,
      projection
    );
  }
);

test(
  "4.4D façade ne réatteste jamais une tâche disponible uniquement dans le journal",
  () => {
    let journalLoads = 0;
    let adapterCalls = 0;

    const facade =
      createNativeDevOrchestratorFacade({
        orchestrator:
          baseOrchestrator({
            getTaskStatus() {
              return null;
            },
          }),

        journal: {
          load() {
            journalLoads += 1;

            return {
              taskId:
                "task-old",
            };
          },

          interrupted() {
            return [];
          },
        },

        decisionEvidenceAdapter() {
          adapterCalls += 1;

          return {};
        },
      });

    assert.throws(
      () =>
        facade.projectDecisionEvidence({
          taskId:
            "task-old",
          mappings: [],
          context: {},
        }),
      (error) =>
        error?.code ===
        "DEV_DECISION_EVIDENCE_UNAVAILABLE"
    );

    assert.equal(
      journalLoads,
      0
    );

    assert.equal(
      adapterCalls,
      0
    );
  }
);

test(
  "4.4D runTask reste indépendant de Decision Evidence",
  async () => {
    let adapterCalls = 0;

    const facade =
      createNativeDevOrchestratorFacade({
        orchestrator:
          baseOrchestrator(),

        featureMode:
          () => "LIMITED",

        decisionEvidenceAdapter() {
          adapterCalls += 1;

          throw new Error(
            "ne doit pas être appelée"
          );
        },
      });

    const result =
      await facade.runTask({
        taskId:
          "task-no-decision-side-effect",
        objective:
          "Corriger",
      });

    assert.equal(
      result.status,
      "PASS"
    );

    assert.equal(
      adapterCalls,
      0
    );

    assert.equal(
      Object.hasOwn(
        result,
        "decisionEvidence"
      ),
      false
    );
  }
);
