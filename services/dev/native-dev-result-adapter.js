"use strict";

const crypto = require("node:crypto");

const {
  isTrustedValidationSnapshot,
} = require("./agents/native-review-validation-agent");

const VALIDATION_SNAPSHOT_VERSION = "native-dev-validation-snapshot-v1";
const TERMINAL_VALIDATION_KIND = "TERMINAL_REVIEW_VALIDATION";
const BINDING_STATES = new Set(["LINKED", "UNLINKED"]);
const SNAPSHOT_COVERAGE = new Set([
  "GIT_VISIBLE_COMPLETE",
  "GIT_VISIBLE_PARTIAL",
  "UNAVAILABLE",
]);
const REASON_CODES = new Set([
  "IDENTITY_MISMATCH",
  "VALIDATION_UNOBSERVED",
  "VALIDATION_INCOMPLETE",
  "SNAPSHOT_UNAVAILABLE",
  "SNAPSHOT_INCOMPLETE",
  "REPOSITORY_DIVERGED",
  "TERMINAL_INCOMPLETE",
  "UNAVAILABLE",
]);

function digest(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

function opaqueRef(prefix, value) {
  return `${prefix}_${digest(value).slice(0, 32)}`;
}

function text(value) {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : null;
}

function identityRefs(taskId, contract = {}) {
  const normalizedTaskId = text(taskId);
  const workspaceId = text(contract.workspaceId);
  const sessionId = contract.sessionId == null ? null : text(contract.sessionId);

  if (!normalizedTaskId || !workspaceId || (contract.sessionId != null && !sessionId)) {
    return null;
  }

  return {
    taskRef: opaqueRef("native_dev_task", {
      taskId: normalizedTaskId,
      workspaceId,
      sessionId,
    }),
    workspaceRef: opaqueRef("native_dev_workspace", { workspaceId }),
    sessionRef: sessionId
      ? opaqueRef("native_dev_session", { workspaceId, sessionId })
      : null,
  };
}

function unavailableValidationSnapshot(refs = null, reasonCode = "UNAVAILABLE") {
  return {
    version: VALIDATION_SNAPSHOT_VERSION,
    validationKind: TERMINAL_VALIDATION_KIND,
    localOnly: true,
    taskRef: refs?.taskRef || null,
    workspaceRef: refs?.workspaceRef || null,
    sessionRef: refs?.sessionRef || null,
    bindingState: "UNLINKED",
    reasonCode,
    validationStatus: "UNKNOWN",
    snapshotRef: null,
    snapshotCoverage: "UNAVAILABLE",
  };
}

function adaptValidationSnapshot(raw, { taskId, contract, finalVerdict }) {
  const refs = identityRefs(taskId, contract);
  if (!refs || !raw || typeof raw !== "object" || Array.isArray(raw)) {
    return unavailableValidationSnapshot(refs);
  }
  if (!isTrustedValidationSnapshot(raw)) {
    return unavailableValidationSnapshot(refs);
  }
  if (raw.version !== VALIDATION_SNAPSHOT_VERSION
    || raw.validationKind !== TERMINAL_VALIDATION_KIND
    || raw.localOnly !== true
    || raw.taskRef !== refs.taskRef
    || raw.workspaceRef !== refs.workspaceRef
    || raw.sessionRef !== refs.sessionRef) {
    return unavailableValidationSnapshot(refs, "IDENTITY_MISMATCH");
  }
  if (!["PASS", "FAIL"].includes(raw.validationStatus)
    || !BINDING_STATES.has(raw.bindingState)
    || !SNAPSHOT_COVERAGE.has(raw.snapshotCoverage)
    || (raw.reasonCode !== null && !REASON_CODES.has(raw.reasonCode))
    || (raw.bindingState === "LINKED" && raw.reasonCode !== null)
    || (raw.bindingState === "UNLINKED" && !REASON_CODES.has(raw.reasonCode))) {
    return unavailableValidationSnapshot(refs);
  }
  if (finalVerdict === "CANCELLED" || finalVerdict === "TIMEOUT" || finalVerdict === "PARTIAL") {
    return unavailableValidationSnapshot(refs, "TERMINAL_INCOMPLETE");
  }
  if (raw.bindingState === "LINKED"
    && (raw.reasonCode !== null
      || raw.snapshotCoverage !== "GIT_VISIBLE_COMPLETE"
      || typeof raw.snapshotRef !== "string"
      || !/^native_dev_snapshot_[a-f0-9]{32}$/.test(raw.snapshotRef))) {
    return unavailableValidationSnapshot(refs);
  }

  return {
    version: VALIDATION_SNAPSHOT_VERSION,
    validationKind: TERMINAL_VALIDATION_KIND,
    localOnly: true,
    ...refs,
    bindingState: raw.bindingState,
    reasonCode: raw.reasonCode,
    validationStatus: raw.validationStatus,
    snapshotRef: typeof raw.snapshotRef === "string"
      && /^native_dev_snapshot_[a-f0-9]{32}$/.test(raw.snapshotRef)
      ? raw.snapshotRef
      : null,
    snapshotCoverage: raw.snapshotCoverage,
  };
}

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

  const validationSnapshot =
    adaptValidationSnapshot(
      review.validationSnapshot,
      {
        taskId: task.taskId,
        contract,
        finalVerdict,
      }
    );

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

    validationSnapshot,

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
