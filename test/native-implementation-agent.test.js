"use strict";

const assert =
  require("node:assert/strict");
const test =
  require("node:test");

const {
  createNativeImplementationAgent,
} =
  require("../services/dev/agents/native-implementation-agent");

test(
  "B3 Native Implementation Agent délègue au moteur d'implémentation",
  async () => {
    let received = null;

    const agent =
      createNativeImplementationAgent({
        implementationEngine: {
          async runImplementation(
            input
          ) {
            received = input;
            input.progress.backendReached =
              true;

            return {
              solved: true,
              iterations: [
                {
                  iteration: 1,
                  changedFiles: [
                    "src/a.js",
                  ],
                  validations: [],
                },
              ],
              touched: [
                "src/a.js",
              ],
              providerCalls: [],
              escalationCount: 0,
              lastValidations: [
                {
                  command:
                    "npm test",
                  status:
                    "PASS",
                },
              ],
            };
          },
        },
      });

    const controller =
      new AbortController();

    const contract = {
      taskId: "task-1",
    };

    const preflight = {
      branch: "main",
    };

    const result =
      await agent.implementTask({
        taskId: "task-1",
        objective:
          "Corriger le bug",
        signal:
          controller.signal,
        analysis: {
          contract,
          preflight,
          defaultCommands: [
            "npm test",
          ],
          deadline: 12345,
        },
      });

    assert.equal(
      result.role,
      "IMPLEMENTATION_AGENT"
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
      result.solved,
      true
    );

    assert.equal(
      result.backendReached,
      true
    );

    assert.equal(
      received.contract,
      contract
    );

    assert.equal(
      received.preflight,
      preflight
    );

    assert.deepEqual(
      received.defaultCommands,
      ["npm test"]
    );

    assert.equal(
      received.deadline,
      12345
    );

    assert.equal(
      received.signal,
      controller.signal
    );
  }
);

test(
  "B3 Native Implementation Agent traduit max iterations en PARTIAL",
  async () => {
    const agent =
      createNativeImplementationAgent({
        implementationEngine: {
          async runImplementation() {
            return {
              solved: false,
              iterations: [],
              touched: [],
              providerCalls: [],
              escalationCount: 0,
              lastValidations: [],
            };
          },
        },
      });

    const result =
      await agent.implementTask({
        analysis: {
          contract: {
            taskId:
              "task-partial",
          },
          preflight: {},
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
  }
);

test(
  "B3 Native Implementation Agent refuse l'absence d'analyse canonique",
  async () => {
    const agent =
      createNativeImplementationAgent({
        implementationEngine: {
          async runImplementation() {
            throw new Error(
              "ne doit pas être appelé"
            );
          },
        },
      });

    await assert.rejects(
      () =>
        agent.implementTask({
          objective:
            "Corriger",
        }),
      (error) =>
        error.code ===
        "DEV_ANALYSIS_REQUIRED"
    );
  }
);
