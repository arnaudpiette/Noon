"use strict";

function safeCode(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const normalized =
    String(value)
      .trim()
      .toUpperCase();

  return /^[A-Z0-9_-]{1,80}$/.test(
    normalized,
  )
    ? normalized
    : null;
}

function safeInteger(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const number =
    Number(value);

  return Number.isInteger(number) &&
    number >= 1 &&
    number <= 10_000
    ? number
    : null;
}

function safeProgress(metadata = {}) {
  const candidate =
    metadata.progress &&
    typeof metadata.progress === "object"
      ? metadata.progress.percent
      : metadata.progress ??
        metadata.percent;

  if (
    candidate === undefined ||
    candidate === null
  ) {
    return null;
  }

  const number =
    Number(candidate);

  return Number.isFinite(number)
    ? number
    : null;
}

function createUserProgressAdapter({
  progressEngine,
} = {}) {
  if (!progressEngine?.publish) {
    throw new TypeError(
      "UserProgressEngine requis.",
    );
  }

  function publish(input) {
    if (!input.executionId) {
      return {
        emitted: false,
        ignored: true,
        reason:
          "MISSING_EXECUTION_ID",
      };
    }

    try {
      return progressEngine.publish(
        input,
      );
    } catch (error) {
      /*
       * La projection user-facing ne doit
       * jamais casser le moteur métier.
       */
      return {
        emitted: false,
        ignored: true,
        reason:
          "PROGRESS_EVENT_REJECTED",
        errorCode:
          String(
            error?.code ||
            error?.name ||
            "UNKNOWN",
          ).slice(0, 80),
      };
    }
  }

  function common(
    metadata = {},
  ) {
    return {
      progress:
        safeProgress(metadata),

      currentStep:
        safeInteger(
          metadata.currentStep,
        ),

      totalSteps:
        safeInteger(
          metadata.totalSteps,
        ),
    };
  }

  function transactional(
    event,
    metadata = {},
  ) {
    const name =
      String(event || "")
        .toLowerCase();

    const executionId =
      metadata.executionId ||
      metadata.execution_id;

    const stepId =
      metadata.stepId ||
      metadata.step_id ||
      null;

    const reasonCode =
      safeCode(
        metadata.reasonCode ||
        metadata.code,
      );

    const base = {
      executionId,
      stepId,
      source:
        "transactional_execution",
      ...common(metadata),
    };

    if (
      name === "execution_created"
    ) {
      return publish({
        ...base,
        state: "PLANNED",
        phase: "PLAN",
        progress: 0,
      });
    }

    if (
      name ===
      "execution_awaiting_approval"
    ) {
      return publish({
        ...base,
        state: "WAITING",
        phase: "APPROVAL",
        reasonCode:
          "APPROVAL_REQUIRED",
      });
    }

    if (
      name ===
      "execution_unknown_outcome"
    ) {
      return publish({
        ...base,
        state: "BLOCKED",
        phase: "RECOVERY",
        reasonCode:
          "UNKNOWN_OUTCOME",
      });
    }

    if (
      name ===
        "execution_compensation_started" ||
      name ===
        "execution_compensation_completed" ||
      name ===
        "execution_compensation_failed"
    ) {
      return publish({
        ...base,
        state: "RUNNING",
        phase: "RECOVERY",
        reasonCode:
          name.endsWith("_failed")
            ? (
                reasonCode ||
                "COMPENSATION_FAILED"
              )
            : null,
      });
    }

    if (
      name ===
      "execution_recovered"
    ) {
      return publish({
        ...base,
        state: "BLOCKED",
        phase: "RECOVERY",
        reasonCode:
          "EXECUTION_INTERRUPTED",
      });
    }

    if (
      name ===
        "execution_verification_failed"
    ) {
      return publish({
        ...base,
        state: "RUNNING",
        phase: "VALIDATION",
        reasonCode,
      });
    }

    if (
      name ===
        "execution_verification_ms" ||
      name ===
        "execution_step_verified" ||
      name ===
        "execution_step_applied"
    ) {
      return publish({
        ...base,
        state: "RUNNING",
        phase: "VALIDATION",
      });
    }

    if (
      name ===
      "execution_step_failed"
    ) {
      /*
       * Une étape peut échouer sans que
       * l'exécution complète soit encore
       * terminale : CONTINUE_INDEPENDENT
       * et RETURN_PARTIAL existent.
       */
      return publish({
        ...base,
        state: "RUNNING",
        phase: "ACTION",
        reasonCode:
          reasonCode ||
          "STEP_FAILURE",
      });
    }

    if (
      name ===
        "execution_started" ||
      name ===
        "execution_step_started"
    ) {
      return publish({
        ...base,
        state: "RUNNING",
        phase: "ACTION",
      });
    }

    if (
      name ===
      "execution_partial"
    ) {
      return publish({
        ...base,
        state: "FAILED",
        phase: "FINALIZE",
        reasonCode:
          "PARTIAL_RESULT",
      });
    }

    if (
      name ===
      "execution_interrupted"
    ) {
      return publish({
        ...base,
        state: "FAILED",
        phase: "FINALIZE",
        reasonCode:
          reasonCode ||
          "EXECUTION_INTERRUPTED",
      });
    }

    if (
      name ===
      "execution_completed"
    ) {
      return publish({
        ...base,
        state: "SUCCEEDED",
        phase: "FINALIZE",
        progress: 100,
      });
    }

    if (
      /cancel/.test(name)
    ) {
      return publish({
        ...base,
        state: "CANCELLED",
        phase: "ACTION",
        reasonCode:
          "USER_CANCELLED",
      });
    }

    return {
      emitted: false,
      ignored: true,
      reason:
        "UNMAPPED_EVENT",
    };
  }

  function backgroundJob(
    event,
    metadata = {},
  ) {
    const name =
      String(event || "")
        .toLowerCase();

    const executionId =
      metadata.jobId ||
      metadata.job_id ||
      metadata.id;

    const reasonCode =
      safeCode(
        metadata.reasonCode ||
        metadata.code,
      );

    const base = {
      executionId,
      stepId: null,
      source:
        "background_job",
      ...common(metadata),
    };

    if (
      name === "job_enqueued"
    ) {
      return publish({
        ...base,
        state: "PLANNED",
        phase: "PLAN",
        progress: 0,
      });
    }

    if (
      name === "job_progress"
    ) {
      return publish({
        ...base,
        state: "RUNNING",
        phase: "ACTION",
      });
    }

    if (
      name === "job_waiting"
    ) {
      return publish({
        ...base,
        state: "WAITING",
        phase:
          reasonCode ===
          "APPROVAL_REQUIRED"
            ? "APPROVAL"
            : "ACTION",
        reasonCode:
          reasonCode ||
          "JOB_WAITING",
      });
    }

    if (
      name ===
      "job_retry_scheduled"
    ) {
      return publish({
        ...base,
        state: "WAITING",
        phase: "RECOVERY",
        reasonCode:
          reasonCode ||
          "RETRY_SCHEDULED",
      });
    }

    if (
      name === "job_failed" &&
      reasonCode ===
        "UNKNOWN_OUTCOME"
    ) {
      return publish({
        ...base,
        state: "BLOCKED",
        phase: "RECOVERY",
        reasonCode:
          "UNKNOWN_OUTCOME",
      });
    }

    if (
      name === "job_failed"
    ) {
      return publish({
        ...base,
        state: "FAILED",
        phase: "FINALIZE",
        reasonCode:
          reasonCode ||
          "JOB_FAILED",
      });
    }

    if (
      name === "job_cancelled"
    ) {
      return publish({
        ...base,
        state: "CANCELLED",
        phase: "ACTION",
        reasonCode:
          "USER_CANCELLED",
      });
    }

    if (
      name === "job_succeeded"
    ) {
      return publish({
        ...base,
        state: "SUCCEEDED",
        phase: "FINALIZE",
        progress: 100,
      });
    }

    return {
      emitted: false,
      ignored: true,
      reason:
        "UNMAPPED_EVENT",
    };
  }

  function devAgent(
    event,
    metadata = {},
  ) {
    const name =
      String(event || "")
        .toLowerCase();

    const executionId =
      metadata.executionId ||
      metadata.execution_id;

    const reasonCode =
      safeCode(
        metadata.reason ||
        metadata.reasonCode ||
        metadata.code,
      );

    const publicPhase =
      String(
        metadata.phase || "",
      ).toUpperCase();

    const base = {
      executionId,
      stepId:
        metadata.stepId ||
        metadata.step_id ||
        null,
      source:
        "dev_agent_loop",
      ...common(metadata),
    };

    /*
     * Le DEV loop V1 signale actuellement
     * l'approval par execution_failed +
     * reason=APPROVAL_REQUIRED.
     */
    if (
      name ===
        "approval_required" ||
      reasonCode ===
        "APPROVAL_REQUIRED"
    ) {
      return publish({
        ...base,
        state: "WAITING",
        phase: "APPROVAL",
        reasonCode:
          "APPROVAL_REQUIRED",
      });
    }

    if (
      name ===
        "execution_started" ||
      name === "plan_ready"
    ) {
      return publish({
        ...base,
        state: "RUNNING",
        phase:
          publicPhase === "PLAN"
            ? "PLAN"
            : "PLAN",
      });
    }

    if (
      name ===
        "action_started" ||
      name ===
        "action_finished"
    ) {
      return publish({
        ...base,
        state: "RUNNING",
        phase: "ACTION",
      });
    }

    if (
      name ===
        "validation_started" ||
      name ===
        "validation_finished" ||
      name ===
        "observation_created"
    ) {
      return publish({
        ...base,
        state: "RUNNING",
        phase: "VALIDATION",
      });
    }

    if (
      name ===
      "execution_cancelled"
    ) {
      return publish({
        ...base,
        state: "CANCELLED",
        phase: "ACTION",
        reasonCode:
          "USER_CANCELLED",
      });
    }

    if (
      name ===
      "execution_failed"
    ) {
      return publish({
        ...base,
        state: "FAILED",
        phase: "FINALIZE",
        reasonCode:
          reasonCode ||
          "EXECUTION_FAILED",
      });
    }

    if (
      name ===
      "execution_completed"
    ) {
      return publish({
        ...base,
        state: "SUCCEEDED",
        phase: "FINALIZE",
        progress: 100,
      });
    }

    return {
      emitted: false,
      ignored: true,
      reason:
        "UNMAPPED_EVENT",
    };
  }


  function nativeDev(
    event,
    metadata = {},
  ) {
    const name =
      String(event || "")
        .trim()
        .toLowerCase();

    const executionId =
      metadata.executionId ||
      metadata.execution_id ||
      metadata.taskId ||
      metadata.task_id;

    const reasonCode =
      safeCode(
        metadata.failureCategory ||
        metadata.reasonCode ||
        metadata.code,
      );

    const base = {
      executionId,
      stepId: null,
      source: "native_dev",
      ...common(metadata),
    };

    // PROGRESS_OBSERVABILITY_NATIVE_DEV_V1
    // Projection volontairement minimale.
    // Aucun prompt, contenu source, arguments
    // ou raisonnement interne n'est propagé.
    if (
      name ===
      "dev_orchestrator.analysis_started"
    ) {
      return publish({
        ...base,
        state: "RUNNING",
        phase: "PLAN",
        progress: 10,
      });
    }

    if (
      name ===
      "dev_orchestrator.baseline_started"
    ) {
      return publish({
        ...base,
        state: "RUNNING",
        phase: "VALIDATION",
        progress: 25,
      });
    }

    if (
      name ===
      "dev_orchestrator.implementation_started"
    ) {
      return publish({
        ...base,
        state: "RUNNING",
        phase: "ACTION",
        progress: 45,
      });
    }

    if (
      name ===
      "dev_orchestrator.review_started"
    ) {
      return publish({
        ...base,
        state: "RUNNING",
        phase: "VALIDATION",
        progress: 80,
      });
    }

    if (
      name ===
      "dev_orchestrator.cancelled"
    ) {
      return publish({
        ...base,
        state: "CANCELLED",
        phase: "ACTION",
        reasonCode:
          "USER_CANCELLED",
      });
    }

    if (
      name ===
      "dev_orchestrator.failed"
    ) {
      return publish({
        ...base,
        state: "FAILED",
        phase: "FINALIZE",
        reasonCode:
          reasonCode ||
          "DEV_ORCHESTRATION_FAILED",
      });
    }

    if (
      name ===
      "dev_orchestrator.completed"
    ) {
      return publish({
        ...base,
        state: "SUCCEEDED",
        phase: "VALIDATION",
        progress: 100,
      });
    }

    return {
      emitted: false,
      ignored: true,
      reason:
        "UNMAPPED_EVENT",
    };
  }


  function orchestrator(
    event,
    metadata = {},
  ) {
    const name =
      String(event || "")
        .trim()
        .toLowerCase();

    const executionId =
      metadata.executionId ||
      metadata.execution_id;

    const base = {
      executionId,
      stepId: null,
      source: "orchestrator",
      progress: null,
      currentStep: null,
      totalSteps: null,
    };

    if (
      name === "started" ||
      name === "context"
    ) {
      return publish({
        ...base,
        state: "PLANNED",
        phase: "PLAN",
        progress: 0,
      });
    }

    if (
      name === "routing"
    ) {
      return publish({
        ...base,
        state: "RUNNING",
        phase: "PLAN",
      });
    }

    if (
      name === "tool"
    ) {
      const toolStatus =
        safeCode(
          metadata.toolStatus,
        );

      if (
        toolStatus ===
          "APPROVAL_REQUIRED" ||
        metadata.approvalRequired ===
          true
      ) {
        return publish({
          ...base,
          state: "WAITING",
          phase: "APPROVAL",
          reasonCode:
            "APPROVAL_REQUIRED",
        });
      }

      return publish({
        ...base,
        state: "RUNNING",
        phase: "TOOL",

        reasonCode:
          toolStatus === "FAILED"
            ? (
                safeCode(
                  metadata.errorCode,
                ) ||
                "TOOL_FAILED"
              )
            : null,
      });
    }

    if (
      name === "approval"
    ) {
      const status =
        safeCode(
          metadata.status,
        );

      const hasProposal =
        Boolean(
          metadata.proposalId,
        );

      if (
        status === "REQUIRED"
      ) {
        return publish({
          ...base,
          state: "WAITING",
          phase: "APPROVAL",
          reasonCode:
            "APPROVAL_REQUIRED",
        });
      }

      if (
        status === "STALE" ||
        status === "EXPIRED"
      ) {
        return publish({
          ...base,
          state: "BLOCKED",
          phase: "APPROVAL",
          reasonCode:
            `APPROVAL_${status}`,
        });
      }

      if (
        status === "FAILED"
      ) {
        return publish({
          ...base,
          state: "FAILED",
          phase: "FINALIZE",
          reasonCode:
            "APPROVAL_FAILED",
        });
      }

      /*
       * Un workflow de proposition spécialiste
       * se termine directement après rejet
       * ou consommation de son approval.
       *
       * Pour une approval outil normale,
       * ces mêmes statuts ne terminent pas
       * nécessairement toute l'exécution.
       */
      if (
        hasProposal &&
        (
          status === "CONSUMED" ||
          status === "REJECTED"
        )
      ) {
        return publish({
          ...base,
          state: "SUCCEEDED",
          phase: "FINALIZE",
          progress: 100,
        });
      }

      if (
        [
          "ACCEPTED",
          "APPROVED",
          "CONSUMED",
          "REJECTED",
        ].includes(status)
      ) {
        return publish({
          ...base,
          state: "RUNNING",
          phase: "ACTION",
        });
      }

      return {
        emitted: false,
        ignored: true,
        reason:
          "UNMAPPED_APPROVAL_STATUS",
      };
    }

    if (
      name === "completed"
    ) {
      return publish({
        ...base,
        state: "SUCCEEDED",
        phase: "FINALIZE",
        progress: 100,
      });
    }

    if (
      name === "failed"
    ) {
      return publish({
        ...base,
        state: "FAILED",
        phase: "FINALIZE",

        reasonCode:
          safeCode(
            metadata.errorCode,
          ) ||
          "ORCHESTRATOR_FAILED",
      });
    }

    return {
      emitted: false,
      ignored: true,
      reason:
        "UNMAPPED_EVENT",
    };
  }

  return {
    transactional,
    backgroundJob,
    devAgent,
    nativeDev,
    orchestrator,
  };
}

module.exports = {
  createUserProgressAdapter,
};
