"use strict";

const {
  createDevTaskContract,
} = require("../delegation/dev-task-contract");

const {
  changedSince,
  reviewDiff,
} = require("../delegation/dev-delegation-runner");

const {
  repositoryPreflight,
  snapshotRepository,
} = require("../delegation/repository-preflight");

const {
  runSafeCommand,
} = require("./native-repository-tools");

const {
  createNativeDevImplementationEngine,
  isBlockingValidationFailure,
  normalizeReasoning,
} = require("./native-dev-implementation-engine");

function safeError(
  error,
  fallback = "TASK_FAILURE"
) {
  return {
    code: String(
      error?.code || fallback
    ).slice(0, 80),

    message: String(
      error?.message ||
        "Échec de la tâche DEV."
    ).slice(0, 240),
  };
}

function workspaceInput(
  workspaceEngine,
  input
) {
  if (
    input.workspaceAuthorized ===
      true &&
    Array.isArray(
      input.workspaceRoots
    ) &&
    input.workspaceRoots.length
  ) {
    return input;
  }

  const workspace =
    workspaceEngine.context(
      input.workspaceId
    );

  const roots = (
    workspace.relevantRoots ||
    workspace.roots ||
    []
  )
    .filter(
      (item) =>
        item.mode ===
        "read-write"
    )
    .map(
      (item) => item.path
    );

  return {
    ...input,
    workspaceAuthorized:
      roots.length > 0,
    workspaceRoots: roots,
  };
}

function unique(items) {
  return [
    ...new Set(
      items.filter(Boolean)
    ),
  ];
}

function createNativeDevCoordinator({
  workspaceEngine,
  transactionalExecutionEngine,
  operationalSecurityPolicy,
  skillRegistry,
  reasoner,
  journal,
  featureMode = () =>
    "OFF",
  qualityEscalationMode = () =>
    "OFF",
  sameTierRepairAttempts = () =>
    2,
  observability = null,
  now = () => Date.now(),
  validationRunner = runSafeCommand,
} = {}) {
  if (!workspaceEngine?.context) {
    throw new TypeError(
      "WorkspaceEngine requis."
    );
  }

  if (
    !transactionalExecutionEngine
      ?.execute
  ) {
    throw new TypeError(
      "TransactionalExecutionEngine requis."
    );
  }

  if (
    !operationalSecurityPolicy
      ?.evaluate
  ) {
    throw new TypeError(
      "OperationalSecurityPolicy requise."
    );
  }

  if (
    !skillRegistry?.executeSkill
  ) {
    throw new TypeError(
      "SkillRegistry requis."
    );
  }

  if (!reasoner?.reason) {
    throw new TypeError(
      "Reasoner DEV requis."
    );
  }

  if (!journal?.start) {
    throw new TypeError(
      "Journal DEV requis."
    );
  }

  const controllers =
    new Map();

  const results =
    new Map();

  const emit =
    (
      event,
      metadata = {}
    ) => {
      try {
        observability?.(
          event,
          metadata
        );
      } catch {}
    };

  const implementationEngine =
    createNativeDevImplementationEngine(
      {
        transactionalExecutionEngine,
        operationalSecurityPolicy,
        skillRegistry,
        reasoner,
        journal,
        qualityEscalationMode,
        sameTierRepairAttempts,
        now,
        validationRunner,
      }
    );

  async function runTask(
    input = {}
  ) {
    const started =
      now();

    let contract;
    let preflight;
    let taskId =
      input.taskId || null;
    let controller;

    const progress = {
      backendReached: false,
    };

    try {
      const mode =
        String(
          typeof featureMode ===
            "function"
            ? featureMode(input)
            : featureMode
        );

      if (
        mode !== "LIMITED"
      ) {
        throw Object.assign(
          new Error(
            "Noon Dev Core est désactivé."
          ),
          {
            code:
              "FEATURE_DISABLED",
          }
        );
      }

      contract =
        createDevTaskContract(
          workspaceInput(
            workspaceEngine,
            input
          )
        );

      taskId =
        contract.taskId;

      controller =
        new AbortController();

      controllers.set(
        taskId,
        controller
      );

      if (input.signal) {
        input.signal.addEventListener(
          "abort",
          () =>
            controller.abort(),
          {
            once: true,
          }
        );
      }

      preflight =
        repositoryPreflight(
          contract,
          {
            now,
          }
        );

      journal.start(
        contract,
        preflight
      );

      const deadline =
        started +
        contract.maxDuration;

      const defaultCommands =
        unique(
          contract
            .validationCommands
            .length
            ? contract
                .validationCommands
            : Object.values(
                preflight.commands
              ).filter(Boolean)
        );

      journal.transition(
        taskId,
        "BASELINE"
      );

      const baseline = [];

      for (
        const command of
        defaultCommands
      ) {
        baseline.push(
          await implementationEngine.validate(
            contract,
            taskId,
            command,
            0,
            controller.signal
          )
        );
      }

      const implementation =
        await implementationEngine.runImplementation(
          {
            contract,
            preflight,
            input,
            taskId,
            signal:
              controller.signal,
            defaultCommands,
            deadline,
            progress,
          }
        );

      journal.transition(
        taskId,
        "REVIEW"
      );

      const after =
        snapshotRepository(
          contract.repositoryRoot
        );

      const changedFiles =
        changedSince(
          preflight.snapshot,
          after
        );

      const review =
        reviewDiff(
          contract,
          changedFiles
        );

      if (
        preflight.snapshot
          .head !== after.head
      ) {
        review.valid = false;
        review.issues.push({
          code:
            "GIT_LOCAL_MUTATION",
        });
      }

      const touched =
        new Set(
          implementation.touched
        );

      const untouchedPreserved =
        preflight.snapshot.files
          .filter(
            (file) =>
              !touched.has(file)
          )
          .every(
            (file) =>
              after.files.includes(
                file
              ) &&
              preflight.snapshot
                .fingerprints[
                file
              ] ===
                after.fingerprints[
                  file
                ]
          );

      if (
        !untouchedPreserved
      ) {
        review.valid = false;

        review.issues.push({
          code:
            "PRE_EXISTING_CHANGE_LOST",
        });
      }

      const diffCheck =
        await implementationEngine.validate(
          contract,
          taskId,
          "git diff --check",
          implementation
            .iterations.length,
          controller.signal
        );

      const failureCategory =
        !implementation.solved
          ? "MAX_ITERATIONS"
          : !review.valid
            ? review.issues[0]
                ?.code ||
              "VALIDATION_FAILURE"
            : diffCheck.status !==
                "PASS"
              ? "VALIDATION_FAILURE"
              : null;

      const preExistingFailure =
        baseline.some(
          (item) =>
            item.status !==
            "PASS"
        );

      const lastValidations =
        implementation
          .lastValidations;

      const unresolvedPreExistingFailure =
        baseline.some(
          (item) =>
            item.status !==
              "PASS" &&
            lastValidations.find(
              (candidate) =>
                candidate.command ===
                item.command
            )?.status !== "PASS"
        );

      const finalVerdict =
        failureCategory
          ? changedFiles.length
            ? "PARTIAL"
            : "FAIL"
          : unresolvedPreExistingFailure
            ? "PARTIAL"
            : "PASS";

      journal.finish(
        taskId,
        finalVerdict,
        failureCategory
      );

      const estimatedCosts =
        implementation
          .providerCalls
          .map(
            (item) =>
              item.estimatedCost
          )
          .filter(
            Number.isFinite
          );

      const actualCosts =
        implementation
          .providerCalls
          .map(
            (item) =>
              item.actualCost
          )
          .filter(
            Number.isFinite
          );

      const result = {
        taskId,
        executionMode:
          "NATIVE_NOON",
        status: finalVerdict,
        finalVerdict,
        failureCategory,

        preflight: {
          branch:
            preflight.branch,
          language:
            preflight.language,
          framework:
            preflight.framework,
        },

        baseline,
        preExistingFailure,
        unresolvedPreExistingFailure,
        preExistingChanges:
          preflight.snapshot
            .files,
        preExistingChangesPreserved:
          untouchedPreserved,
        changedFiles,
        iterations:
          implementation
            .iterations,
        validations:
          lastValidations,
        diffReview: review,
        codexUsed: false,

        metrics: {
          taskDomain: "DEV",
          requiredQuality:
            contract
              .requiredQuality,
          duration:
            now() - started,
          iterations:
            implementation
              .iterations
              .length,
          fileCount:
            changedFiles.length,
          commandCount:
            baseline.length +
            implementation
              .iterations
              .reduce(
                (
                  sum,
                  item
                ) =>
                  sum +
                  item
                    .validations
                    .length,
                0
              ) +
            1,

          providerCalls:
            implementation
              .providerCalls,

          repairCycles:
            Math.max(
              0,
              implementation
                .iterations
                .length - 1
            ),

          inputTokens:
            implementation
              .providerCalls
              .some(
                (item) =>
                  item?.usage
                    ?.inputTokens != null ||
                  item?.usage
                    ?.input_tokens != null
              )
              ? implementation
                  .providerCalls
                  .reduce(
                    (sum, item) =>
                      sum +
                      Math.max(
                        0,
                        Number(
                          item?.usage
                            ?.inputTokens ??
                          item?.usage
                            ?.input_tokens ??
                          0
                        ) || 0
                      ),
                    0
                  )
              : null,

          outputTokens:
            implementation
              .providerCalls
              .some(
                (item) =>
                  item?.usage
                    ?.outputTokens != null ||
                  item?.usage
                    ?.output_tokens != null
              )
              ? implementation
                  .providerCalls
                  .reduce(
                    (sum, item) =>
                      sum +
                      Math.max(
                        0,
                        Number(
                          item?.usage
                            ?.outputTokens ??
                          item?.usage
                            ?.output_tokens ??
                          0
                        ) || 0
                      ),
                    0
                  )
              : null,

          contextEvaluation:
            implementation
              .contextEvaluation ||
            null,

          modelCallCount:
            implementation
              .providerCalls
              .length,

          backendReached:
            progress
              .backendReached,

          estimatedCost:
            estimatedCosts
              .length
              ? estimatedCosts.reduce(
                  (
                    sum,
                    value
                  ) =>
                    sum +
                    value,
                  0
                )
              : null,

          actualCost:
            actualCosts.length
              ? actualCosts.reduce(
                  (
                    sum,
                    value
                  ) =>
                    sum +
                    value,
                  0
                )
              : null,

          retryCount: 0,
          fallbackCount: 0,

          escalationCount:
            implementation
              .escalationCount,

          secondOpinionCount:
            0,

          specialistDelegationCount:
            0,

          success:
            finalVerdict ===
            "PASS",

          finalVerdict,
          failureCategory,
        },
      };

      results.set(
        taskId,
        result
      );

      emit(
        "native_dev.completed",
        result.metrics
      );

      return result;
    } catch (error) {
      const failure =
        safeError(error);

      const finalVerdict =
        [
          "CANCELLED",
          "TIMEOUT",
        ].includes(
          failure.code
        )
          ? failure.code
          : "FAIL";

      if (
        taskId &&
        journal.load(taskId)
      ) {
        journal.finish(
          taskId,
          finalVerdict,
          failure.code
        );
      }

      const result = {
        taskId,
        executionMode:
          "NATIVE_NOON",
        status: finalVerdict,
        finalVerdict,
        failureCategory:
          failure.code,
        error: failure,
        codexUsed: false,

        metrics: {
          taskDomain: "DEV",
          duration:
            now() - started,
          backendReached:
            progress
              .backendReached,
          success: false,
          failureCategory:
            failure.code,
        },
      };

      if (taskId) {
        results.set(
          taskId,
          result
        );
      }

      emit(
        "native_dev.failed",
        result.metrics
      );

      return result;
    } finally {
      if (taskId) {
        controllers.delete(
          taskId
        );
      }
    }
  }

  function cancelTask(
    taskId
  ) {
    const controller =
      controllers.get(
        String(taskId)
      );

    if (!controller) {
      return {
        cancelled: false,
        reason:
          "NOT_RUNNING",
      };
    }

    controller.abort();

    return {
      cancelled: true,
      taskId:
        String(taskId),
    };
  }

  function getTaskStatus(
    taskId
  ) {
    return (
      results.get(
        String(taskId)
      ) ||
      journal.load(
        String(taskId)
      ) ||
      null
    );
  }

  function recoverInterrupted() {
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

  return {
    runTask,
    cancelTask,
    getTaskStatus,
    recoverInterrupted,
  };
}

module.exports = {
  createNativeDevCoordinator,
  isBlockingValidationFailure,
  normalizeReasoning,
};
