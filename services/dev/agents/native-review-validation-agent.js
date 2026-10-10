"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const {
  createReviewValidationAgent,
} = require("./review-validation-agent");

const {
  changedSince,
  reviewDiff,
} = require("../../delegation/dev-delegation-runner");

const {
  snapshotRepository,
} = require("../../delegation/repository-preflight");

const VALIDATION_SNAPSHOT_VERSION = "native-dev-validation-snapshot-v1";
const TERMINAL_VALIDATION_KIND = "TERMINAL_REVIEW_VALIDATION";
const trustedValidationSnapshots = new WeakSet();

function trustedValidationSnapshot(value) {
  const snapshot = Object.freeze(value);
  trustedValidationSnapshots.add(snapshot);
  return snapshot;
}

function isTrustedValidationSnapshot(value) {
  return Boolean(
    value
      && typeof value === "object"
      && trustedValidationSnapshots.has(value)
  );
}

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

function identityRefs(contract = {}) {
  const taskId = text(contract.taskId);
  const workspaceId = text(contract.workspaceId);
  const sessionId = contract.sessionId == null ? null : text(contract.sessionId);

  if (!taskId || !workspaceId || (contract.sessionId != null && !sessionId)) {
    return null;
  }

  return {
    taskRef: opaqueRef("native_dev_task", { taskId, workspaceId, sessionId }),
    workspaceRef: opaqueRef("native_dev_workspace", { workspaceId }),
    sessionRef: sessionId
      ? opaqueRef("native_dev_session", { workspaceId, sessionId })
      : null,
  };
}

function snapshotObservation(snapshot, repositoryRoot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return {
      snapshotRef: null,
      coverage: "UNAVAILABLE",
    };
  }

  const head = text(snapshot.head);
  const status = typeof snapshot.status === "string" ? snapshot.status : null;
  const files = Array.isArray(snapshot.files) && snapshot.files.every((item) => typeof item === "string")
    ? [...snapshot.files].sort()
    : null;
  const fingerprints = snapshot.fingerprints && typeof snapshot.fingerprints === "object"
    ? snapshot.fingerprints
    : null;

  if (!head || status == null || !files || !fingerprints) {
    return {
      snapshotRef: null,
      coverage: "UNAVAILABLE",
    };
  }

  const root = text(repositoryRoot);
  const fingerprintEntries = files.map((file) => [file, fingerprints[file] ?? null]);
  const hasSymlinkOrUnreadablePath = files.some((file) => {
    if (!root) {
      return true;
    }

    const candidate = path.resolve(root, file);
    if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
      return true;
    }

    try {
      return fs.lstatSync(candidate).isSymbolicLink();
    } catch {
      return true;
    }
  });
  const hasStagedChanges = status.split("\n").some((line) =>
    line
      && !line.startsWith("?? ")
      && line[0] !== " ");
  const complete = !hasStagedChanges
    && !hasSymlinkOrUnreadablePath
    && fingerprintEntries.every(([, fingerprint]) =>
      typeof fingerprint === "string" && /^[a-f0-9]{64}$/i.test(fingerprint));

  return {
    snapshotRef: opaqueRef("native_dev_snapshot", {
      head,
      status,
      fingerprintEntries,
    }),
    coverage: complete
      ? "GIT_VISIBLE_COMPLETE"
      : "GIT_VISIBLE_PARTIAL",
  };
}

function terminalValidationSnapshot({ contract, input, validation, before, after }) {
  const refs = identityRefs(contract);
  const taskMatches = text(input.taskId) === text(contract.taskId);
  const workspaceMatches = input.workspaceId === undefined
    || text(input.workspaceId) === text(contract.workspaceId);
  const sessionMatches = input.sessionId === undefined
    || (input.sessionId == null
      ? contract.sessionId == null
      : text(input.sessionId) === text(contract.sessionId));

  if (!refs || !taskMatches || !workspaceMatches || !sessionMatches) {
    return trustedValidationSnapshot({
      version: VALIDATION_SNAPSHOT_VERSION,
      validationKind: TERMINAL_VALIDATION_KIND,
      localOnly: true,
      taskRef: null,
      workspaceRef: null,
      sessionRef: null,
      bindingState: "UNLINKED",
      reasonCode: "IDENTITY_MISMATCH",
      validationStatus: "UNKNOWN",
      snapshotRef: null,
      snapshotCoverage: "UNAVAILABLE",
    });
  }

  const beforeObservation = snapshotObservation(before, contract.repositoryRoot);
  const afterObservation = snapshotObservation(after, contract.repositoryRoot);
  const status = ["PASS", "FAIL"].includes(validation?.status)
    ? validation.status
    : "UNKNOWN";
  const common = {
    version: VALIDATION_SNAPSHOT_VERSION,
    validationKind: TERMINAL_VALIDATION_KIND,
    localOnly: true,
    ...refs,
    validationStatus: status,
    snapshotRef: afterObservation.snapshotRef,
    snapshotCoverage: afterObservation.coverage,
  };

  if (status === "UNKNOWN") {
    return trustedValidationSnapshot({
      ...common,
      bindingState: "UNLINKED",
      reasonCode: "VALIDATION_UNOBSERVED",
    });
  }
  if (validation.outputTruncated === true || validation.cleanupConfirmed !== true) {
    return trustedValidationSnapshot({
      ...common,
      bindingState: "UNLINKED",
      reasonCode: "VALIDATION_INCOMPLETE",
    });
  }
  if (beforeObservation.coverage !== "GIT_VISIBLE_COMPLETE"
    || afterObservation.coverage !== "GIT_VISIBLE_COMPLETE") {
    return trustedValidationSnapshot({
      ...common,
      bindingState: "UNLINKED",
      reasonCode: beforeObservation.coverage === "UNAVAILABLE"
        || afterObservation.coverage === "UNAVAILABLE"
        ? "SNAPSHOT_UNAVAILABLE"
        : "SNAPSHOT_INCOMPLETE",
    });
  }
  if (beforeObservation.snapshotRef !== afterObservation.snapshotRef) {
    return trustedValidationSnapshot({
      ...common,
      bindingState: "UNLINKED",
      reasonCode: "REPOSITORY_DIVERGED",
    });
  }

  return trustedValidationSnapshot({
    ...common,
    bindingState: "LINKED",
    reasonCode: null,
  });
}

function captureSnapshot(repositoryRoot) {
  try {
    return snapshotRepository(repositoryRoot);
  } catch {
    return null;
  }
}

function createNativeReviewValidationAgent({
  implementationEngine,
  journal,
} = {}) {
  if (
    typeof implementationEngine
      ?.validate !== "function"
  ) {
    throw new TypeError(
      "NativeDevImplementationEngine.validate requis."
    );
  }

  if (
    !journal?.start ||
    !journal?.transition ||
    !journal?.finish
  ) {
    throw new TypeError(
      "Journal DEV requis."
    );
  }

  return createReviewValidationAgent({
    baseline: async (
      input = {}
    ) => {
      const analysis =
        input.analysis;

      const contract =
        analysis?.contract;

      const preflight =
        analysis?.preflight;

      if (
        !contract ||
        !preflight
      ) {
        throw Object.assign(
          new Error(
            "Analyse DEV requise pour la baseline."
          ),
          {
            code:
              "DEV_ANALYSIS_REQUIRED",
          }
        );
      }

      journal.start(
        contract,
        preflight
      );

      journal.transition(
        contract.taskId,
        "BASELINE"
      );

      const baseline = [];

      for (
        const command of
        analysis.defaultCommands ||
        []
      ) {
        baseline.push(
          await implementationEngine.validate(
            contract,
            contract.taskId,
            command,
            0,
            input.signal
          )
        );
      }

      return baseline;
    },

    review: async (
      input = {}
    ) => {
      const analysis =
        input.analysis;

      const implementation =
        input.implementation;

      const baseline =
        Array.isArray(
          input.baseline
        )
          ? input.baseline
          : [];

      const contract =
        analysis?.contract;

      const preflight =
        analysis?.preflight;

      if (
        !contract ||
        !preflight ||
        !implementation
      ) {
        throw Object.assign(
          new Error(
            "Contexte DEV incomplet pour la review."
          ),
          {
            code:
              "DEV_REVIEW_CONTEXT_REQUIRED",
          }
        );
      }

      journal.transition(
        contract.taskId,
        "REVIEW"
      );

      const after =
        snapshotRepository(
          contract.repositoryRoot
        );

      const changedFiles =
        changedSince(
          preflight.snapshot,
          after
        );

      const diffReview =
        reviewDiff(
          contract,
          changedFiles
        );

      if (
        preflight.snapshot.head !==
        after.head
      ) {
        diffReview.valid =
          false;

        diffReview.issues.push({
          code:
            "GIT_LOCAL_MUTATION",
        });
      }

      const touched =
        new Set(
          implementation.touched ||
          []
        );

      const preExistingChangesPreserved =
        preflight.snapshot.files
          .filter(
            (file) =>
              !touched.has(file)
          )
          .every(
            (file) =>
              after.files.includes(
                file
              ) &&
              preflight.snapshot
                .fingerprints[file] ===
                after.fingerprints[
                  file
                ]
          );

      if (
        !preExistingChangesPreserved
      ) {
        diffReview.valid =
          false;

        diffReview.issues.push({
          code:
            "PRE_EXISTING_CHANGE_LOST",
        });
      }

      const iterationCount =
        Array.isArray(
          implementation.iterations
        )
          ? implementation
              .iterations.length
          : 0;

      const beforeTerminalValidation =
        captureSnapshot(
          contract.repositoryRoot
        );

      const terminalDiffCheck =
        await implementationEngine.validate(
          contract,
          contract.taskId,
          "git diff --check",
          iterationCount,
          input.signal
        );

      const afterTerminalValidation =
        captureSnapshot(
          contract.repositoryRoot
        );

      const validationSnapshot =
        terminalValidationSnapshot({
          contract,
          input,
          validation: terminalDiffCheck,
          before: beforeTerminalValidation,
          after: afterTerminalValidation,
        });

      const solved =
        implementation.solved ===
        true;

      const failureCategory =
        !solved
          ? "MAX_ITERATIONS"
          : !diffReview.valid
            ? diffReview
                .issues[0]
                ?.code ||
              "VALIDATION_FAILURE"
            : terminalDiffCheck.status !==
                "PASS"
              ? "VALIDATION_FAILURE"
              : null;

      const preExistingFailure =
        baseline.some(
          (item) =>
            item.status !==
            "PASS"
        );

      const validations =
        Array.isArray(
          implementation.validations
        )
          ? implementation.validations
          : [];

      const unresolvedPreExistingFailure =
        baseline.some(
          (item) =>
            item.status !==
              "PASS" &&
            validations.find(
              (candidate) =>
                candidate.command ===
                item.command
            )?.status !== "PASS"
        );

      const finalVerdict =
        failureCategory
          ? changedFiles.length
            ? "PARTIAL"
            : "FAIL"
          : unresolvedPreExistingFailure
            ? "PARTIAL"
            : "PASS";

      journal.finish(
        contract.taskId,
        finalVerdict,
        failureCategory
      );

      return {
        finalVerdict,
        failureCategory,
        baseline,
        preExistingFailure,
        unresolvedPreExistingFailure,
        preExistingChanges:
          preflight.snapshot.files,
        preExistingChangesPreserved,
        changedFiles,
        validations,
        diffReview,
        diffCheck: terminalDiffCheck,
        validationSnapshot,
      };
    },
  });
}

module.exports = {
  createNativeReviewValidationAgent,
  isTrustedValidationSnapshot,
};
