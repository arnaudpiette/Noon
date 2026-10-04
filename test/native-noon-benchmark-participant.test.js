"use strict";

const assert =
  require("node:assert/strict");

const test =
  require("node:test");

const {
  createNativeNoonBenchmarkParticipant,
} =
  require(
    "../services/dev/benchmark/native-noon-benchmark-participant"
  );

test(
  "le participant Native transmet la telemetry Code Context sans contenu source",
  async () => {
    let received =
      null;

    const participant =
      createNativeNoonBenchmarkParticipant({
        coordinator: {
          async runTask(input) {
            received =
              input;

            return {
              status:
                "PASS",

              failureCategory:
                null,

              metrics: {
                backendReached:
                  true,

                iterations:
                  2,

                repairCycles:
                  1,

                inputTokens:
                  12,

                outputTokens:
                  7,

                contextEvaluation: {
                  version: 1,

                  plan: {
                    requestedFiles: [
                      "src/a.js",
                    ],
                  },
                },

                providerCalls: [
                  {
                    provider:
                      "openai",

                    model:
                      "fixture-model",
                  },
                ],

                estimatedCost:
                  0.01,

                actualCost:
                  0.009,

                fileCount:
                  1,
              },
            };
          },

          cancelTask() {
            return true;
          },
        },
      });

    const result =
      await participant.execute({
        runId:
          "run-context",

        benchmarkSessionId:
          "session-context",

        benchmarkBudget: {
          id:
            "session-context",
        },

        workspace:
          "/tmp/context-fixture",

        objective:
          "Fixture",

        allowedPaths: [
          "src",
        ],

        forbiddenPaths: [
          ".git",
        ],
      });

    assert.equal(
      received.benchmark.id,
      "session-context"
    );

    assert.equal(
      result.iterations,
      2
    );

    assert.equal(
      result.repairCycles,
      1
    );

    assert.equal(
      result.inputTokens,
      12
    );

    assert.equal(
      result.outputTokens,
      7
    );

    assert.deepEqual(
      result.contextEvaluation,
      {
        version: 1,

        plan: {
          requestedFiles: [
            "src/a.js",
          ],
        },
      }
    );
  }
);
