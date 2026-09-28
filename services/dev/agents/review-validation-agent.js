"use strict";

function createReviewValidationAgent({
  baseline = null,
  review,
} = {}) {
  if (typeof review !== "function") {
    throw new TypeError(
      "ReviewValidationAgent.review requis."
    );
  }

  async function baselineTask(input = {}) {
    if (typeof baseline !== "function") {
      return [];
    }

    const result =
      await baseline(input);

    if (!Array.isArray(result)) {
      throw Object.assign(
        new Error(
          "Baseline DEV invalide."
        ),
        {
          code:
            "DEV_BASELINE_INVALID",
        }
      );
    }

    return result;
  }

  async function reviewTask(input = {}) {
    const result =
      await review(input);

    if (
      !result ||
      typeof result !== "object" ||
      Array.isArray(result)
    ) {
      throw Object.assign(
        new Error(
          "Review DEV invalide."
        ),
        {
          code:
            "DEV_REVIEW_INVALID",
        }
      );
    }

    const finalVerdict =
      [
        "PASS",
        "PARTIAL",
        "FAIL",
      ].includes(
        result.finalVerdict
      )
        ? result.finalVerdict
        : "FAIL";

    return Object.freeze({
      ...result,
      role:
        "REVIEW_VALIDATION_AGENT",
      finalVerdict,
    });
  }

  return Object.freeze({
    role:
      "REVIEW_VALIDATION_AGENT",
    baselineTask,
    reviewTask,
  });
}

module.exports = {
  createReviewValidationAgent,
};
