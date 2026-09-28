"use strict";

function createImplementationAgent({
  execute,
  cancel = null,
} = {}) {
  if (typeof execute !== "function") {
    throw new TypeError(
      "ImplementationAgent.execute requis."
    );
  }

  async function implementTask(input = {}) {
    const result =
      await execute(input);

    if (
      !result ||
      typeof result !== "object" ||
      Array.isArray(result)
    ) {
      throw Object.assign(
        new Error(
          "Résultat ImplementationAgent invalide."
        ),
        {
          code:
            "DEV_IMPLEMENTATION_INVALID",
        }
      );
    }

    return Object.freeze({
      ...result,
      role:
        "IMPLEMENTATION_AGENT",
    });
  }

  function cancelTask(taskId) {
    if (
      typeof cancel !==
      "function"
    ) {
      return {
        cancelled: false,
        reason:
          "CANCEL_UNAVAILABLE",
      };
    }

    return cancel(taskId);
  }

  return Object.freeze({
    role:
      "IMPLEMENTATION_AGENT",
    implementTask,
    cancelTask,
  });
}

module.exports = {
  createImplementationAgent,
};
