"use strict";

function numericSum(values = []) {
  const numbers =
    values.filter(
      Number.isFinite
    );

  return numbers.length
    ? numbers.reduce(
        (sum, value) =>
          sum + value,
        0
      )
    : null;
}

function durationFromTask(
  task,
  now = () => Date.now()
) {
  const started =
    Date.parse(
      task?.startedAt || ""
    );

  const ended =
    task?.endedAt
      ? Date.parse(task.endedAt)
      : now();

  if (
    !Number.isFinite(started) ||
    !Number.isFinite(ended)
  ) {
    return 0;
  }

  return Math.max(
    0,
    ended - started
  );
}

function normalizeFinalVerdict(
  task = {}
) {
  if (
    task.failureCategory ===
    "CANCELLED"
  ) {
    return "CANCELLED";
  }

  if (
    task.failureCategory ===
    "TIMEOUT"
  ) {
    return "TIMEOUT";
  }

  if (
    [
      "PASS",
      "PARTIAL",
      "FAIL",
    ].includes(
      task.finalVerdict
    )
  ) {
    return task.finalVerdict;
  }

  return "FAIL";
}

function adaptNativeDevResult(
  task = {},
  {
    now = () => Date.now(),
  } = {}
) {
  if (
    !task ||
    typeof task !== "object" ||
    Array.isArray(task)
  ) {
    throw new TypeError(
      "Résultat DevOrchestrator requis."
    );
  }

  const analysis =
    task.analysis &&
    typeof task.analysis ===
      "object"
      ? task.analysis
      : {};

  const contract =
    analysis.contract &&
    typeof analysis.contract ===
      "object"
      ? analysis.contract
      : {};

  const preflight =
    analysis.preflight &&
    typeof analysis.preflight ===
      "object"
      ? analysis.preflight
      : {};

  const implementation =
    task.implementation &&
    typeof task.implementation ===
      "object"
      ? task.implementation
      : {};

  const review =
    task.review &&
    typeof task.review ===
      "object"
      ? task.review
      : {};

  const baseline =
    Array.isArray(task.baseline)
      ? task.baseline
      : Array.isArray(
          review.baseline
        )
        ? review.baseline
        : [];

  const iterations =
    Array.isArray(
      implementation.iterations
    )
      ? implementation.iterations
      : [];

  const providerCalls =
    Array.isArray(
      implementation.providerCalls
    )
      ? implementation.providerCalls
      : [];

  const changedFiles =
    Array.isArray(
      review.changedFiles
    )
      ? review.changedFiles
      : [];

  const validations =
    Array.isArray(
      review.validations
    )
      ? review.validations
      : Array.isArray(
          implementation.validations
        )
        ? implementation.validations
        : [];

  const finalVerdict =
    normalizeFinalVerdict(
      task
    );

  const failureCategory =
    finalVerdict === "PASS"
      ? null
      : task.failureCategory ||
        review.failureCategory ||
        implementation.failureCategory ||
        "DEV_ORCHESTRATION_FAILURE";

  const estimatedCost =
    numericSum(
      providerCalls.map(
        (item) =>
          item?.estimatedCost
      )
    );

  const actualCost =
    numericSum(
      providerCalls.map(
        (item) =>
          item?.actualCost
      )
    );

  const commandCount =
    baseline.length +
    iterations.reduce(
      (sum, item) =>
        sum +
        (
          Array.isArray(
            item?.validations
          )
            ? item.validations
                .length
            : 0
        ),
      0
    ) +
    (review.diffCheck
      ? 1
      : 0);

  return {
    taskId:
      task.taskId || null,

    executionMode:
      "NATIVE_NOON",

    status:
      finalVerdict,

    finalVerdict,

    failureCategory,

    preflight: {
      branch:
        preflight.branch ??
        null,
      language:
        preflight.language ??
        null,
      framework:
        preflight.framework ??
        null,
    },

    baseline,

    preExistingFailure:
      review.preExistingFailure ===
      true,

    unresolvedPreExistingFailure:
      review
        .unresolvedPreExistingFailure ===
      true,

    preExistingChanges:
      Array.isArray(
        review.preExistingChanges
      )
        ? review.preExistingChanges
        : Array.isArray(
            preflight.snapshot
              ?.files
          )
          ? preflight.snapshot
              .files
          : [],

    preExistingChangesPreserved:
      review
        .preExistingChangesPreserved !==
      false,

    changedFiles,

    iterations,

    validations,

    diffReview:
      review.diffReview || {
        valid:
          finalVerdict ===
          "PASS",
        issues: [],
      },

    codexUsed: false,

    metrics: {
      taskDomain: "DEV",

      requiredQuality:
        contract.requiredQuality ||
        null,

      duration:
        durationFromTask(
          task,
          now
        ),

      iterations:
        iterations.length,

      fileCount:
        changedFiles.length,

      commandCount,

      providerCalls,

      modelCallCount:
        providerCalls.length,

      backendReached:
        implementation
          .backendReached ===
        true,

      estimatedCost,

      actualCost,

      retryCount: 0,
      fallbackCount: 0,

      escalationCount:
        Number(
          implementation
            .escalationCount
        ) || 0,

      secondOpinionCount: 0,

      specialistDelegationCount:
        0,

      success:
        finalVerdict ===
        "PASS",

      finalVerdict,

      failureCategory,
    },
  };
}

module.exports = {
  adaptNativeDevResult,
};
