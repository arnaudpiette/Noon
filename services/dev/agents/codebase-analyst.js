"use strict";

function createCodebaseAnalyst({
  analyze,
} = {}) {
  if (typeof analyze !== "function") {
    throw new TypeError(
      "CodebaseAnalyst.analyze requis."
    );
  }

  async function analyzeTask(input = {}) {
    const result =
      await analyze(input);

    if (
      !result ||
      typeof result !== "object" ||
      Array.isArray(result)
    ) {
      throw Object.assign(
        new Error(
          "Analyse codebase invalide."
        ),
        {
          code:
            "DEV_ANALYSIS_INVALID",
        }
      );
    }

    return Object.freeze({
      ...result,
      role: "CODEBASE_ANALYST",
    });
  }

  return Object.freeze({
    role: "CODEBASE_ANALYST",
    analyzeTask,
  });
}

module.exports = {
  createCodebaseAnalyst,
};
