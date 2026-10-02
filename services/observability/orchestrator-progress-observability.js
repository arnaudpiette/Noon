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

function createOrchestratorProgressObservability({
  observability,
  progressAdapter,
} = {}) {
  if (
    !observability ||
    typeof observability !== "object"
  ) {
    throw new TypeError(
      "NoonObservability requis.",
    );
  }

  if (
    !progressAdapter ||
    typeof progressAdapter.orchestrator !==
      "function"
  ) {
    throw new TypeError(
      "UserProgressAdapter orchestrator requis.",
    );
  }

  function project(
    event,
    executionId,
    metadata = {},
  ) {
    if (!executionId) {
      return;
    }

    try {
      progressAdapter.orchestrator(
        event,
        {
          executionId:
            String(executionId),

          ...metadata,
        },
      );
    } catch {
      /*
       * La projection user-facing ne doit
       * jamais casser l'observabilité
       * technique ni l'orchestrateur.
       */
    }
  }

  function callBase(
    method,
    args,
  ) {
    const fn =
      observability[method];

    if (
      typeof fn !== "function"
    ) {
      return undefined;
    }

    return fn.apply(
      observability,
      args,
    );
  }

  return {
    ...observability,

    startExecution(input = {}) {
      const result =
        callBase(
          "startExecution",
          [input],
        );

      project(
        "started",
        input.executionId,
      );

      return result;
    },

    recordContext(
      executionId,
      metadata = {},
    ) {
      const result =
        callBase(
          "recordContext",
          [
            executionId,
            metadata,
          ],
        );

      project(
        "context",
        executionId,
      );

      return result;
    },

    recordRouting(
      executionId,
      metadata = {},
    ) {
      const result =
        callBase(
          "recordRouting",
          [
            executionId,
            metadata,
          ],
        );

      project(
        "routing",
        executionId,
      );

      return result;
    },

    recordTool(
      executionId,
      metadata = {},
    ) {
      const result =
        callBase(
          "recordTool",
          [
            executionId,
            metadata,
          ],
        );

      project(
        "tool",
        executionId,
        {
          toolStatus:
            safeCode(
              metadata.toolStatus,
            ),

          approvalRequired:
            metadata.approvalRequired ===
            true,

          errorCode:
            safeCode(
              metadata.errorCode ||
              metadata.errorType,
            ),
        },
      );

      return result;
    },

    recordApproval(
      executionId,
      metadata = {},
    ) {
      const result =
        callBase(
          "recordApproval",
          [
            executionId,
            metadata,
          ],
        );

      project(
        "approval",
        executionId,
        {
          status:
            safeCode(
              metadata.status,
            ),

          proposalId:
            metadata.proposalId
              ? String(
                  metadata.proposalId,
                ).slice(
                  0,
                  120,
                )
              : null,
        },
      );

      return result;
    },

    completeExecution(
      executionId,
      metadata = {},
    ) {
      const result =
        callBase(
          "completeExecution",
          [
            executionId,
            metadata,
          ],
        );

      project(
        "completed",
        executionId,
      );

      return result;
    },

    failExecution(
      executionId,
      error,
      metadata = {},
    ) {
      const result =
        callBase(
          "failExecution",
          [
            executionId,
            error,
            metadata,
          ],
        );

      project(
        "failed",
        executionId,
        {
          errorCode:
            safeCode(
              error?.code ||
              error?.type ||
              error?.name,
            ),
        },
      );

      return result;
    },
  };
}

module.exports = {
  createOrchestratorProgressObservability,
};
