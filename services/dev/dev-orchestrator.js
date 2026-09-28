"use strict";

const crypto =
  require("node:crypto");

const STATUSES =
  Object.freeze([
    "ANALYZING",
    "BASELINING",
    "IMPLEMENTING",
    "REVIEWING",
    "COMPLETED",
    "FAILED",
    "CANCELLED",
  ]);

function error(
  message,
  code
) {
  return Object.assign(
    new Error(message),
    { code }
  );
}

function createDevOrchestrator({
  codebaseAnalyst,
  implementationAgent,
  reviewValidationAgent,
  observability = null,
  now = () => Date.now(),
  createTaskId = () =>
    `dev-orchestration-${crypto.randomUUID()}`,
} = {}) {
  if (
    typeof codebaseAnalyst
      ?.analyzeTask !==
    "function"
  ) {
    throw new TypeError(
      "CodebaseAnalyst requis."
    );
  }

  if (
    typeof implementationAgent
      ?.implementTask !==
    "function"
  ) {
    throw new TypeError(
      "ImplementationAgent requis."
    );
  }

  if (
    typeof reviewValidationAgent
      ?.baselineTask !==
      "function" ||
    typeof reviewValidationAgent
      ?.reviewTask !==
      "function"
  ) {
    throw new TypeError(
      "ReviewValidationAgent requis."
    );
  }

  const tasks =
    new Map();

  const controllers =
    new Map();

  const emit =
    (
      event,
      task,
      metadata = {}
    ) => {
      try {
        observability?.(
          event,
          {
            taskId:
              task.taskId,
            status:
              task.status,
            ...metadata,
          }
        );
      } catch {}
    };

  function publicTask(task) {
    return structuredClone(
      task
    );
  }

  function assertNotCancelled(
    task,
    controller
  ) {
    if (
      controller.signal.aborted ||
      task.status ===
        "CANCELLED"
    ) {
      throw error(
        "Tâche DEV annulée.",
        "DEV_ORCHESTRATION_CANCELLED"
      );
    }
  }

  async function runTask(
    input = {}
  ) {
    const objective =
      String(
        input.objective ||
          input.task ||
          ""
      )
        .trim()
        .slice(0, 4000);

    if (!objective) {
      throw error(
        "Objectif DEV requis.",
        "DEV_OBJECTIVE_REQUIRED"
      );
    }

    const taskId =
      String(
        input.taskId ||
          createTaskId()
      );

    if (!taskId) {
      throw error(
        "Identifiant DEV invalide.",
        "DEV_TASK_ID_INVALID"
      );
    }

    if (tasks.has(taskId)) {
      throw error(
        "Tâche DEV déjà existante.",
        "DEV_TASK_ALREADY_EXISTS"
      );
    }

    const task = {
      taskId,
      objective,
      status:
        "ANALYZING",
      phase: "ANALYZE",
      startedAt:
        new Date(
          now()
        ).toISOString(),
      endedAt: null,
      analysis: null,
      baseline: null,
      implementation: null,
      review: null,
      finalVerdict: null,
      failureCategory: null,
    };

    tasks.set(
      taskId,
      task
    );

    const controller =
      new AbortController();

    controllers.set(
      taskId,
      controller
    );

    try {
      emit(
        "dev_orchestrator.analysis_started",
        task
      );

      task.analysis =
        await codebaseAnalyst
          .analyzeTask({
            ...input,
            taskId,
            objective,
            signal:
              controller.signal,
          });

      assertNotCancelled(
        task,
        controller
      );

      task.status =
        "BASELINING";
      task.phase =
        "BASELINE";

      emit(
        "dev_orchestrator.baseline_started",
        task
      );

      task.baseline =
        await reviewValidationAgent
          .baselineTask({
            ...input,
            taskId,
            objective,
            analysis:
              task.analysis,
            signal:
              controller.signal,
          });

      assertNotCancelled(
        task,
        controller
      );

      task.status =
        "IMPLEMENTING";
      task.phase =
        "IMPLEMENT";

      emit(
        "dev_orchestrator.implementation_started",
        task
      );

      task.implementation =
        await implementationAgent
          .implementTask({
            ...input,
            taskId,
            objective,
            analysis:
              task.analysis,
            signal:
              controller.signal,
          });

      assertNotCancelled(
        task,
        controller
      );

      task.status =
        "REVIEWING";
      task.phase =
        "REVIEW";

      emit(
        "dev_orchestrator.review_started",
        task
      );

      task.review =
        await reviewValidationAgent
          .reviewTask({
            ...input,
            taskId,
            objective,
            analysis:
              task.analysis,
            baseline:
              task.baseline,
            implementation:
              task.implementation,
            signal:
              controller.signal,
          });

      assertNotCancelled(
        task,
        controller
      );

      const implementationFailed =
        [
          "FAIL",
          "FAILED",
          "CANCELLED",
          "TIMEOUT",
        ].includes(
          task.implementation
            ?.finalVerdict ||
            task.implementation
              ?.status
        );

      task.finalVerdict =
        implementationFailed
          ? "FAIL"
          : task.review
              .finalVerdict;

      task.failureCategory =
        task.finalVerdict ===
        "PASS"
          ? null
          : task.review
              .failureCategory ||
            task.implementation
              ?.failureCategory ||
            "DEV_ORCHESTRATION_FAILURE";

      task.status =
        task.finalVerdict ===
        "PASS"
          ? "COMPLETED"
          : "FAILED";

      task.phase = "STOP";
      task.endedAt =
        new Date(
          now()
        ).toISOString();

      emit(
        task.status ===
          "COMPLETED"
          ? "dev_orchestrator.completed"
          : "dev_orchestrator.failed",
        task,
        {
          finalVerdict:
            task.finalVerdict,
        }
      );

      return publicTask(
        task
      );
    } catch (cause) {
      if (
        controller.signal.aborted ||
        cause?.code ===
          "DEV_ORCHESTRATION_CANCELLED"
      ) {
        task.status =
          "CANCELLED";
        task.phase =
          "STOP";
        task.finalVerdict =
          "FAIL";
        task.failureCategory =
          "CANCELLED";
        task.endedAt =
          task.endedAt ||
          new Date(
            now()
          ).toISOString();

        emit(
          "dev_orchestrator.cancelled",
          task
        );

        return publicTask(
          task
        );
      }

      task.status =
        "FAILED";
      task.phase =
        "STOP";
      task.finalVerdict =
        "FAIL";
      task.failureCategory =
        String(
          cause?.code ||
            "DEV_ORCHESTRATION_FAILURE"
        ).slice(0, 100);
      task.endedAt =
        new Date(
          now()
        ).toISOString();

      emit(
        "dev_orchestrator.failed",
        task,
        {
          failureCategory:
            task.failureCategory,
        }
      );

      throw cause;
    } finally {
      controllers.delete(
        taskId
      );
    }
  }

  function getTaskStatus(
    taskId
  ) {
    const task =
      tasks.get(
        String(taskId)
      );

    return task
      ? publicTask(task)
      : null;
  }

  function cancelTask(
    taskId
  ) {
    const task =
      tasks.get(
        String(taskId)
      );

    if (
      !task ||
      [
        "COMPLETED",
        "FAILED",
        "CANCELLED",
      ].includes(
        task.status
      )
    ) {
      return {
        cancelled: false,
        reason:
          "NOT_RUNNING",
      };
    }

    controllers
      .get(task.taskId)
      ?.abort();

    const result =
      implementationAgent
        .cancelTask?.(
          task.taskId
        ) || {
          cancelled: false,
        };

    task.status =
      "CANCELLED";
    task.phase =
      "STOP";
    task.finalVerdict =
      "FAIL";
    task.failureCategory =
      "CANCELLED";
    task.endedAt =
      new Date(
        now()
      ).toISOString();

    emit(
      "dev_orchestrator.cancelled",
      task
    );

    return {
      cancelled: true,
      taskId:
        task.taskId,
      delegated:
        result.cancelled ===
        true,
    };
  }

  return Object.freeze({
    runTask,
    getTaskStatus,
    cancelTask,
    statuses: STATUSES,
  });
}

module.exports = {
  STATUSES,
  createDevOrchestrator,
};
