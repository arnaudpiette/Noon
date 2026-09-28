"use strict";

const {
  createImplementationAgent,
} = require("./implementation-agent");

function createNativeImplementationAgent({
  implementationEngine,
} = {}) {
  if (
    typeof implementationEngine
      ?.runImplementation !== "function"
  ) {
    throw new TypeError(
      "NativeDevImplementationEngine requis."
    );
  }

  return createImplementationAgent({
    execute: async (input = {}) => {
      const analysis =
        input.analysis &&
        typeof input.analysis === "object"
          ? input.analysis
          : null;

      if (
        !analysis?.contract ||
        !analysis?.preflight
      ) {
        throw Object.assign(
          new Error(
            "Analyse DEV complète requise avant implémentation."
          ),
          {
            code:
              "DEV_ANALYSIS_REQUIRED",
          }
        );
      }

      const progress =
        input.progress &&
        typeof input.progress ===
          "object"
          ? input.progress
          : {
              backendReached:
                false,
            };

      const result =
        await implementationEngine.runImplementation({
          contract:
            analysis.contract,
          preflight:
            analysis.preflight,
          input:
            input.originalInput ||
            input,
          taskId:
            input.taskId ||
            analysis.contract.taskId,
          signal:
            input.signal,
          defaultCommands:
            Array.isArray(
              analysis.defaultCommands
            )
              ? analysis.defaultCommands
              : [],
          deadline:
            analysis.deadline,
          progress,
        });

      return {
        status:
          result.solved
            ? "PASS"
            : "PARTIAL",

        finalVerdict:
          result.solved
            ? "PASS"
            : "PARTIAL",

        failureCategory:
          result.solved
            ? null
            : "MAX_ITERATIONS",

        solved:
          result.solved,

        iterations:
          result.iterations,

        touched:
          result.touched,

        providerCalls:
          result.providerCalls,

        escalationCount:
          result.escalationCount,

        backendReached:
          progress.backendReached ===
          true,

        validations:
          result.lastValidations,
      };
    },

    // L'annulation réelle est portée par le signal AbortController
    // fourni par DevOrchestrator.
    cancel: () => ({
      cancelled: false,
      reason:
        "CANCELLED_BY_SIGNAL",
    }),
  });
}

module.exports = {
  createNativeImplementationAgent,
};
