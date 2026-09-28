"use strict";

const crypto =
  require("node:crypto");

const {
  adaptNativeDevResult,
} = require("./native-dev-result-adapter");

function createNativeDevOrchestratorFacade({
  orchestrator,
  journal = null,
  featureMode = () =>
    "OFF",
  now = () => Date.now(),
  createTaskId = () =>
    `dev-task-${crypto.randomUUID()}`,
} = {}) {
  if (
    typeof orchestrator?.runTask !==
      "function" ||
    typeof orchestrator?.getTaskStatus !==
      "function" ||
    typeof orchestrator?.cancelTask !==
      "function"
  ) {
    throw new TypeError(
      "NativeDevOrchestrator requis."
    );
  }

  if (
    journal !== null &&
    (
      typeof journal?.load !==
        "function" ||
      typeof journal?.interrupted !==
        "function"
    )
  ) {
    throw new TypeError(
      "Journal DEV invalide."
    );
  }

  function adapt(task) {
    return adaptNativeDevResult(
      task,
      { now }
    );
  }

  function featureState(
    input = {}
  ) {
    return String(
      typeof featureMode ===
        "function"
        ? featureMode(input)
        : featureMode
    );
  }

  async function runTask(
    input = {}
  ) {
    /*
     * Compatibilité NativeDevCoordinator :
     * le feature gate est évalué avant de démarrer
     * l'orchestration ou d'atteindre le backend.
     */
    if (
      featureState(input) !==
      "LIMITED"
    ) {
      return adapt({
        taskId:
          input.taskId ||
          null,
        status:
          "FAILED",
        finalVerdict:
          "FAIL",
        failureCategory:
          "FEATURE_DISABLED",
        startedAt:
          new Date(now())
            .toISOString(),
        endedAt:
          new Date(now())
            .toISOString(),
        implementation: {
          backendReached:
            false,
        },
      });
    }

    const taskId =
      String(
        input.taskId ||
          createTaskId()
      );

    try {
      const task =
        await orchestrator.runTask({
          ...input,
          taskId,
        });

      return adapt(task);
    } catch (error) {
      const task =
        orchestrator.getTaskStatus(
          taskId
        );

      if (task) {
        return adapt(task);
      }

      const failureCategory =
        String(
          error?.code ||
            "DEV_ORCHESTRATION_FAILURE"
        ).slice(0, 100);

      return adapt({
        taskId,
        status:
          "FAILED",
        finalVerdict:
          "FAIL",
        failureCategory,
        startedAt:
          new Date(now())
            .toISOString(),
        endedAt:
          new Date(now())
            .toISOString(),
        implementation: {
          backendReached:
            false,
        },
      });
    }
  }

  function getTaskStatus(
    taskId
  ) {
    const id =
      String(taskId);

    const task =
      orchestrator.getTaskStatus(
        id
      );

    if (task) {
      return adapt(task);
    }

    /*
     * Même fallback que NativeDevCoordinator :
     * après restart, le journal persistant reste lisible.
     */
    return (
      journal?.load(id) ||
      null
    );
  }

  function cancelTask(
    taskId
  ) {
    return orchestrator.cancelTask(
      String(taskId)
    );
  }

  function recoverInterrupted() {
    if (!journal) {
      return [];
    }

    return journal
      .interrupted()
      .map((record) => ({
        taskId:
          record.taskId,
        status:
          "INTERRUPTED",
        finalVerdict:
          "PARTIAL",
        failureCategory:
          "PROCESS_RESTARTED",
        requiresUserDecision:
          true,
      }));
  }

  return Object.freeze({
    runTask,
    getTaskStatus,
    cancelTask,
    recoverInterrupted,
  });
}

module.exports = {
  createNativeDevOrchestratorFacade,
};
