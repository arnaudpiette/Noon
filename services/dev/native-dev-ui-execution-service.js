"use strict";

const crypto =
  require("node:crypto");

function executionError(
  code,
  message,
  statusCode = 400
) {
  return Object.assign(
    new Error(message),
    {
      code,
      statusCode,
    }
  );
}

function clean(
  value,
  max
) {
  return String(
    value || ""
  )
    .replace(
      /[\0\r\n]+/g,
      " "
    )
    .trim()
    .slice(
      0,
      max
    );
}

function finalStatus(
  result
) {
  const verdict =
    String(
      result?.finalVerdict ||
      ""
    ).toUpperCase();

  if (verdict === "PASS") {
    return "COMPLETED";
  }

  if (
    verdict === "CANCELLED"
  ) {
    return "CANCELLED";
  }

  if (
    verdict === "TIMEOUT"
  ) {
    return "TIMEOUT";
  }

  return "FAILED";
}

function safeResult(
  result
) {
  if (
    !result ||
    typeof result !== "object"
  ) {
    return null;
  }

  const estimated =
    Number(
      result.metrics
        ?.estimatedCost
    );

  const actual =
    Number(
      result.metrics
        ?.actualCost
    );

  return {
    finalVerdict:
      result.finalVerdict ||
      null,

    failureCategory:
      result.failureCategory ||
      null,

    backendReached:
      result.metrics
        ?.backendReached === true,

    changedFileCount:
      Number(
        result.metrics
          ?.fileCount
      ) || 0,

    duration:
      Number(
        result.metrics
          ?.duration
      ) || 0,

    estimatedCost:
      Number.isFinite(
        estimated
      )
        ? estimated
        : null,

    actualCost:
      Number.isFinite(
        actual
      )
        ? actual
        : null,
  };
}

function createNativeDevUiExecutionService({
  terminalService,
  nativeDevFacade,
  workspaceEngine,
  projectRuleResolver,
  featureMode = () =>
    "OFF",
  createTaskId = () =>
    `dev-ui-${crypto.randomUUID()}`,
  now = () => Date.now(),
  observability = null,
} = {}) {
  if (
    typeof terminalService
      ?.getSession !==
    "function"
  ) {
    throw new TypeError(
      "WorkspaceTerminalService requis."
    );
  }

  if (
    typeof nativeDevFacade
      ?.runTask !==
      "function" ||
    typeof nativeDevFacade
      ?.getTaskStatus !==
      "function" ||
    typeof nativeDevFacade
      ?.cancelTask !==
      "function"
  ) {
    throw new TypeError(
      "NativeDevFacade requise."
    );
  }

  if (
    typeof workspaceEngine
      ?.context !==
    "function"
  ) {
    throw new TypeError(
      "WorkspaceEngine requis."
    );
  }

  if (
    typeof projectRuleResolver
      ?.resolve !==
    "function"
  ) {
    throw new TypeError(
      "DevProjectRuleResolver requis."
    );
  }

  const records =
    new Map();

  const activeBySession =
    new Map();

  function emit(
    event,
    metadata
  ) {
    try {
      observability?.(
        event,
        metadata
      );
    } catch {}
  }

  function publicRecord(
    record
  ) {
    return Object.freeze({
      taskId:
        record.taskId,

      executionMode:
        "NATIVE_NOON",

      workspaceSessionId:
        record.workspaceSessionId,

      workspaceId:
        record.workspaceId,

      status:
        record.status,

      finalVerdict:
        record.result
          ?.finalVerdict ||
        null,

      failureCategory:
        record.result
          ?.failureCategory ||
        null,

      backendReached:
        record.result
          ?.backendReached ===
        true,

      changedFileCount:
        Number(
          record.result
            ?.changedFileCount
        ) || 0,

      duration:
        Number(
          record.result
            ?.duration
        ) || 0,

      estimatedCost:
        record.result
          ?.estimatedCost ??
        null,

      actualCost:
        record.result
          ?.actualCost ??
        null,

      startedAt:
        record.startedAt,

      endedAt:
        record.endedAt,
    });
  }

  function resolveFeatureMode(
    context
  ) {
    return String(
      typeof featureMode ===
        "function"
        ? featureMode(
            context
          )
        : featureMode
    ).toUpperCase();
  }

  function start(
    input = {}
  ) {
    const workspaceSessionId =
      clean(
        input.workspaceSessionId,
        180
      );

    const validationCommand =
      clean(
        input.validationCommand,
        1000
      );

    if (!workspaceSessionId) {
      throw executionError(
        "DEV_NATIVE_UI_SESSION_REQUIRED",
        "Session Workspace DEV requise."
      );
    }

    if (!validationCommand) {
      throw executionError(
        "DEV_NATIVE_UI_VALIDATION_REQUIRED",
        "Validation DEV autorisée requise."
      );
    }

    const session =
      terminalService.getSession(
        workspaceSessionId
      );

    const workspaceId =
      clean(
        session?.workspaceId,
        160
      );

    const repositoryRoot =
      String(
        session
          ?.repositoryRoot ||
        ""
      );

    if (
      !workspaceId ||
      !repositoryRoot
    ) {
      throw executionError(
        "DEV_NATIVE_UI_WORKSPACE_INVALID",
        "Workspace DEV invalide."
      );
    }

    if (
      resolveFeatureMode({
        workspaceId,
        sessionId:
          workspaceSessionId,
      }) !== "LIMITED"
    ) {
      throw executionError(
        "DEV_NATIVE_FEATURE_DISABLED",
        "Native DEV n’est pas actif pour ce Workspace.",
        409
      );
    }

    if (
      activeBySession.has(
        workspaceSessionId
      )
    ) {
      throw executionError(
        "DEV_NATIVE_UI_ALREADY_RUNNING",
        "Une exécution Native DEV est déjà active pour ce Workspace.",
        409
      );
    }

    const context =
      workspaceEngine.context(
        workspaceId
      );

    const projects =
      Array.isArray(
        context?.projects
      )
        ? context.projects
        : [];

    const ownerProfileScope =
      context?.workspace
        ?.profileScope ||
      null;

    if (
      projects.length !== 1 ||
      !ownerProfileScope
    ) {
      throw executionError(
        "DEV_PROJECT_UNRESOLVED",
        "Projet DEV non résolu ou ambigu."
      );
    }

    const ruleProjection =
      projectRuleResolver
        .resolve({
          projectId:
            projects[0].id,

          ownerProfileScope,

          taskRestrictions:
            [],
        });

    const taskId =
      clean(
        createTaskId(),
        180
      );

    if (!taskId) {
      throw executionError(
        "DEV_NATIVE_UI_TASK_ID_INVALID",
        "Identifiant Native DEV invalide."
      );
    }

    const record = {
      taskId,
      workspaceSessionId,
      workspaceId,

      status:
        "RUNNING",

      result:
        null,

      cancelRequested:
        false,

      startedAt:
        new Date(
          now()
        ).toISOString(),

      endedAt:
        null,
    };

    records.set(
      taskId,
      record
    );

    activeBySession.set(
      workspaceSessionId,
      taskId
    );

    emit(
      "started",
      {
        taskId,
        workspaceSessionId,
        workspaceId,
      }
    );

    let promise;

    try {
      promise =
        nativeDevFacade
          .runTask({
            taskId,

            sessionId:
              workspaceSessionId,

            workspaceId,

            repositoryRoot,

            objective:
              "Corriger le Workspace afin que la validation autorisée réussisse, avec les modifications strictement nécessaires.",

            projectInstructions:
              Array.isArray(
                ruleProjection
                  ?.applied
              )
                ? ruleProjection
                    .applied
                    .map(
                      (rule) =>
                        rule?.text
                    )
                    .filter(
                      Boolean
                    )
                : [],

            validationCommands:
              [
                validationCommand,
              ],

            requiredQuality:
              "NORMAL",

            maxIterations:
              3,

            maxDuration:
              10 * 60_000,

            permissions:
              [
                "READ_WRITE_WORKSPACE",
                "TERMINAL_SAFE",
              ],
          });
    } catch (error) {
      records.delete(
        taskId
      );

      activeBySession.delete(
        workspaceSessionId
      );

      throw error;
    }

    Promise.resolve(
      promise
    )
      .then(
        (result) => {
          const projected =
            safeResult(
              result
            );

          if (
            record.cancelRequested
          ) {
            record.result = {
              ...(projected || {}),

              finalVerdict:
                "CANCELLED",

              failureCategory:
                "CANCELLED",
            };

            record.status =
              "CANCELLED";
          } else {
            record.result =
              projected;

            record.status =
              finalStatus(
                result
              );
          }

          record.endedAt =
            new Date(
              now()
            ).toISOString();

          emit(
            "completed",
            {
              taskId,
              workspaceSessionId,
              workspaceId,
              status:
                record.status,
            }
          );
        }
      )
      .catch(
        (error) => {
          if (
            record.cancelRequested
          ) {
            record.result = {
              finalVerdict:
                "CANCELLED",

              failureCategory:
                "CANCELLED",

              backendReached:
                false,

              changedFileCount:
                0,

              duration: 0,

              estimatedCost:
                null,

              actualCost:
                null,
            };

            record.status =
              "CANCELLED";
          } else {
            record.result = {
              finalVerdict:
                "FAIL",

              failureCategory:
                clean(
                  error?.code ||
                  "DEV_NATIVE_UI_FAILURE",
                  100
                ),

              backendReached:
                false,

              changedFileCount:
                0,

              duration: 0,

              estimatedCost:
                null,

              actualCost:
                null,
            };

            record.status =
              "FAILED";
          }

          record.endedAt =
            new Date(
              now()
            ).toISOString();

          emit(
            record.cancelRequested
              ? "cancelled"
              : "failed",
            {
              taskId,
              workspaceSessionId,
              workspaceId,
              failureCategory:
                record.result
                  .failureCategory,
            }
          );
        }
      )
      .finally(
        () => {
          if (
            activeBySession.get(
              workspaceSessionId
            ) === taskId
          ) {
            activeBySession.delete(
              workspaceSessionId
            );
          }
        }
      );

    return publicRecord(
      record
    );
  }

  function get(
    taskId
  ) {
    const id =
      clean(
        taskId,
        180
      );

    const record =
      records.get(id);

    if (record) {
      return publicRecord(
        record
      );
    }

    const recovered =
      nativeDevFacade
        .getTaskStatus(id);

    if (!recovered) {
      return null;
    }

    const result =
      safeResult(
        recovered
      );

    const interrupted =
      recovered
        ?.failureCategory ===
      "PROCESS_RESTARTED";

    return Object.freeze({
      taskId:
        id,

      executionMode:
        "NATIVE_NOON",

      workspaceSessionId:
        null,

      workspaceId:
        null,

      status:
        interrupted
          ? "INTERRUPTED"
          : finalStatus(
              recovered
            ),

      finalVerdict:
        interrupted
          ? "PARTIAL"
          : result
              ?.finalVerdict ||
            null,

      failureCategory:
        recovered
          ?.failureCategory ||
        result
          ?.failureCategory ||
        null,

      backendReached:
        result
          ?.backendReached ===
        true,

      changedFileCount:
        result
          ?.changedFileCount ||
        0,

      duration:
        result?.duration ||
        0,

      estimatedCost:
        result
          ?.estimatedCost ??
        null,

      actualCost:
        result
          ?.actualCost ??
        null,

      startedAt:
        recovered
          ?.startedAt ||
        null,

      endedAt:
        recovered
          ?.endedAt ||
        null,
    });
  }

  function cancel(
    taskId
  ) {
    const id =
      clean(
        taskId,
        180
      );

    const result =
      nativeDevFacade
        .cancelTask(id);

    const record =
      records.get(id);

    if (
      result?.cancelled ===
        true &&
      record
    ) {
      record.cancelRequested =
        true;

      record.status =
        "CANCELLED";

      record.result = {
        finalVerdict:
          "CANCELLED",

        failureCategory:
          "CANCELLED",

        backendReached:
          record.result
            ?.backendReached ===
          true,

        changedFileCount:
          record.result
            ?.changedFileCount ||
          0,

        duration:
          record.result
            ?.duration ||
          0,

        estimatedCost:
          record.result
            ?.estimatedCost ??
          null,

        actualCost:
          record.result
            ?.actualCost ??
          null,
      };

      record.endedAt =
        new Date(
          now()
        ).toISOString();

      emit(
        "cancelled",
        {
          taskId:
            id,

          workspaceSessionId:
            record
              .workspaceSessionId,

          workspaceId:
            record.workspaceId,
        }
      );
    }

    return result;
  }

  return Object.freeze({
    start,
    get,
    cancel,
  });
}

module.exports = {
  createNativeDevUiExecutionService,
};
