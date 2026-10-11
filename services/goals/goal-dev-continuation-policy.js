"use strict";

const POLICY_VERSION =
  "goal-dev-continuation-v1";

const STATES =
  Object.freeze({
    STOP: "STOP",
    REVIEW: "REVIEW",
    RETRY_CANDIDATE:
      "RETRY_CANDIDATE",
  });

const EVALUATION_VERDICTS =
  new Set([
    "PASS",
    "PARTIAL",
    "FAIL",
    "INSUFFICIENT_EVIDENCE",
  ]);

/*
 * Liste volontairement étroite.
 *
 * RETRY_CANDIDATE ne signifie jamais
 * "relancer".
 *
 * Elle signifie uniquement :
 * "cet échec pourra être étudié par
 * une future politique Goal de retry".
 */
const RETRYABLE_FAILURES =
  new Set([
    "VALIDATION_FAILED",
    "VALIDATION_FAILURE",
    "TASK_FAILURE",
    "MALFORMED_PROVIDER_RESPONSE",
    "PROVIDER_FAILURE",
  ]);

function clean(
  value,
  max = 100
) {
  return String(
    value ?? ""
  )
    .replace(
      /[\0\r\n]+/g,
      " "
    )
    .trim()
    .slice(0, max);
}

function freeze(
  value
) {
  if (
    !value ||
    typeof value !==
      "object" ||
    Object.isFrozen(value)
  ) {
    return value;
  }

  for (
    const child of
      Object.values(value)
  ) {
    freeze(child);
  }

  return Object.freeze(value);
}

function deriveGoalDevContinuation({
  devResult,
  evaluation,
} = {}) {
  if (
    !devResult ||
    typeof devResult !==
      "object" ||
    Array.isArray(devResult)
  ) {
    throw new TypeError(
      "Résultat Native DEV requis."
    );
  }

  if (
    !evaluation ||
    typeof evaluation !==
      "object" ||
    Array.isArray(evaluation)
  ) {
    throw new TypeError(
      "AgentEvaluation requise."
    );
  }

  const verdict =
    clean(
      evaluation.verdict,
      40
    ).toUpperCase();

  if (
    !EVALUATION_VERDICTS.has(
      verdict
    )
  ) {
    throw new TypeError(
      `Verdict AgentEvaluation invalide : ${verdict}`
    );
  }

  const finalVerdict =
    clean(
      devResult.finalVerdict ||
        devResult.status,
      40
    ).toUpperCase();

  const failureCategory =
    clean(
      devResult
        .failureCategory,
      100
    ).toUpperCase() ||
    null;

  let state =
    STATES.REVIEW;

  let reasonCode =
    "GOAL_DEV_REVIEW_REQUIRED";

  if (
    verdict === "PASS" &&
    finalVerdict === "PASS"
  ) {
    state =
      STATES.STOP;

    reasonCode =
      "GOAL_DEV_EVALUATION_PASS";
  } else if (
    verdict === "FAIL" &&
    failureCategory &&
    RETRYABLE_FAILURES.has(
      failureCategory
    )
  ) {
    state =
      STATES
        .RETRY_CANDIDATE;

    reasonCode =
      "GOAL_DEV_RETRY_CANDIDATE";
  } else if (
    verdict ===
      "INSUFFICIENT_EVIDENCE"
  ) {
    reasonCode =
      "GOAL_DEV_EVIDENCE_INSUFFICIENT";
  } else if (
    verdict === "PARTIAL"
  ) {
    reasonCode =
      "GOAL_DEV_PARTIAL_REVIEW_REQUIRED";
  } else if (
    verdict === "FAIL"
  ) {
    reasonCode =
      "GOAL_DEV_FAILURE_REVIEW_REQUIRED";
  }

  return freeze({
    policyVersion:
      POLICY_VERSION,

    state,

    reasonCode,

    evaluationVerdict:
      verdict,

    evaluationConfidence:
      clean(
        evaluation.confidence,
        40
      ) || null,

    failureCategory,

    /*
     * Ces valeurs restent fausses
     * pour toute la tranche 4.5D.
     */
    automatic: false,
    retryScheduled: false,
    retryAuthorized: false,
    executionAuthorized:
      false,

    evaluationApplied: true,
    goalStateMutated: false,

    requiresUserReview:
      state !==
      STATES.STOP,
  });
}

module.exports = {
  POLICY_VERSION,
  RETRYABLE_FAILURES,
  STATES,
  deriveGoalDevContinuation,
};
