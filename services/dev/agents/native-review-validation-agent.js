"use strict";

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

      const diffCheck =
        await implementationEngine.validate(
          contract,
          contract.taskId,
          "git diff --check",
          iterationCount,
          input.signal
        );

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
            : diffCheck.status !==
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
        diffCheck,
      };
    },
  });
}

module.exports = {
  createNativeReviewValidationAgent,
};
