"use strict";

const assert =
  require("node:assert/strict");
const test =
  require("node:test");

const {
  adaptNativeDevResult,
} =
  require("../services/dev/native-dev-result-adapter");

test(
  "B3 Result Adapter reproduit le contrat Native DEV sur un PASS",
  () => {
    const result =
      adaptNativeDevResult({
        taskId:
          "task-pass",

        status:
          "COMPLETED",

        finalVerdict:
          "PASS",

        failureCategory:
          null,

        startedAt:
          "2026-09-28T08:00:00.000Z",

        endedAt:
          "2026-09-28T08:00:02.000Z",

        analysis: {
          contract: {
            requiredQuality:
              "HIGH",
          },

          preflight: {
            branch:
              "main",
            language:
              "javascript",
            framework:
              "node",
            snapshot: {
              files: [
                "user.txt",
              ],
            },
          },
        },

        baseline: [
          {
            command:
              "npm test",
            status:
              "FAIL",
          },
        ],

        implementation: {
          solved: true,

          backendReached:
            true,

          escalationCount:
            1,

          providerCalls: [
            {
              provider:
                "openai",
              model:
                "fixture",
              estimatedCost:
                0.01,
              actualCost:
                0.012,
            },
          ],

          iterations: [
            {
              iteration: 1,
              changedFiles: [
                "src/a.js",
              ],
              validations: [
                {
                  command:
                    "npm test",
                  status:
                    "PASS",
                },
              ],
            },
          ],

          validations: [
            {
              command:
                "npm test",
              status:
                "PASS",
            },
          ],
        },

        review: {
          finalVerdict:
            "PASS",

          failureCategory:
            null,

          preExistingFailure:
            true,

          unresolvedPreExistingFailure:
            false,

          preExistingChanges: [
            "user.txt",
          ],

          preExistingChangesPreserved:
            true,

          changedFiles: [
            "src/a.js",
          ],

          validations: [
            {
              command:
                "npm test",
              status:
                "PASS",
            },
          ],

          diffReview: {
            valid: true,
            issues: [],
          },

          diffCheck: {
            command:
              "git diff --check",
            status:
              "PASS",
          },
        },
      });

    assert.equal(
      result.executionMode,
      "NATIVE_NOON"
    );

    assert.equal(
      result.status,
      "PASS"
    );

    assert.equal(
      result.finalVerdict,
      "PASS"
    );

    assert.equal(
      result.codexUsed,
      false
    );

    assert.deepEqual(
      result.changedFiles,
      ["src/a.js"]
    );

    assert.equal(
      result
        .preExistingChangesPreserved,
      true
    );

    assert.equal(
      result.diffReview.valid,
      true
    );

    assert.equal(
      result.metrics.backendReached,
      true
    );

    assert.equal(
      result.metrics.duration,
      2000
    );

    assert.equal(
      result.metrics.modelCallCount,
      1
    );

    assert.equal(
      result.metrics.estimatedCost,
      0.01
    );

    assert.equal(
      result.metrics.actualCost,
      0.012
    );

    assert.equal(
      result.metrics.commandCount,
      3
    );
  }
);

test(
  "B3 Result Adapter préserve PARTIAL",
  () => {
    const result =
      adaptNativeDevResult({
        taskId:
          "task-partial",

        status:
          "FAILED",

        finalVerdict:
          "PARTIAL",

        failureCategory:
          "MAX_ITERATIONS",

        analysis: {
          contract: {
            requiredQuality:
              "NORMAL",
          },
          preflight: {
            snapshot: {
              files: [],
            },
          },
        },

        implementation: {
          solved: false,
          iterations: [],
          providerCalls: [],
        },

        review: {
          finalVerdict:
            "PARTIAL",
          failureCategory:
            "MAX_ITERATIONS",
          changedFiles: [
            "src/a.js",
          ],
          diffReview: {
            valid: true,
            issues: [],
          },
        },
      });

    assert.equal(
      result.status,
      "PARTIAL"
    );

    assert.equal(
      result.finalVerdict,
      "PARTIAL"
    );

    assert.equal(
      result.failureCategory,
      "MAX_ITERATIONS"
    );

    assert.equal(
      result.metrics.success,
      false
    );
  }
);

test(
  "B3 Result Adapter restaure CANCELLED comme état terminal natif",
  () => {
    const result =
      adaptNativeDevResult({
        taskId:
          "task-cancel",

        status:
          "CANCELLED",

        finalVerdict:
          "FAIL",

        failureCategory:
          "CANCELLED",
      });

    assert.equal(
      result.status,
      "CANCELLED"
    );

    assert.equal(
      result.finalVerdict,
      "CANCELLED"
    );

    assert.equal(
      result.failureCategory,
      "CANCELLED"
    );

    assert.equal(
      result.metrics.success,
      false
    );
  }
);
