"use strict";

const assert =
  require("node:assert/strict");
const test =
  require("node:test");

const {
  createCodebaseAnalyst,
} =
  require("../services/dev/agents/codebase-analyst");

const {
  createImplementationAgent,
} =
  require("../services/dev/agents/implementation-agent");

const {
  createReviewValidationAgent,
} =
  require("../services/dev/agents/review-validation-agent");

const {
  createDevOrchestrator,
} =
  require("../services/dev/dev-orchestrator");

function fixture(
  overrides = {}
) {
  const calls = [];
  let clock =
    Date.parse(
      "2026-09-28T08:30:00.000Z"
    );

  const codebaseAnalyst =
    createCodebaseAnalyst({
      analyze:
        overrides.analyze ||
        (async (input) => {
          calls.push(
            "analyze"
          );

          return {
            repositoryRoot:
              input.repositoryRoot,
            findings: [
              "repo-ready",
            ],
          };
        }),
    });

  const implementationAgent =
    createImplementationAgent({
      execute:
        overrides.execute ||
        (async () => {
          calls.push(
            "implement"
          );

          return {
            status: "PASS",
            finalVerdict:
              "PASS",
            changedFiles: [
              "src/a.js",
            ],
          };
        }),

      cancel:
        overrides.cancel ||
        (() => ({
          cancelled: true,
        })),
    });

  const reviewValidationAgent =
    createReviewValidationAgent({
      baseline:
        overrides.baseline ||
        (async () => {
          calls.push(
            "baseline"
          );

          return [
            {
              command:
                "npm test",
              status:
                "PASS",
            },
          ];
        }),

      review:
        overrides.review ||
        (async () => {
          calls.push(
            "review"
          );

          return {
            finalVerdict:
              "PASS",
            validationState:
              "PASS",
          };
        }),
    });

  const orchestrator =
    createDevOrchestrator({
      codebaseAnalyst,
      implementationAgent,
      reviewValidationAgent,
      now: () =>
        clock++,
      createTaskId:
        () => "task-1",
    });

  return {
    orchestrator,
    calls,
  };
}

test(
  "B3 séquence Analyst puis Implementation puis Review",
  async () => {
    const {
      orchestrator,
      calls,
    } = fixture();

    const result =
      await orchestrator
        .runTask({
          objective:
            "Corriger le bug",
          repositoryRoot:
            "/tmp/repo",
        });

    assert.deepEqual(
      calls,
      [
        "analyze",
        "baseline",
        "implement",
        "review",
      ]
    );

    assert.equal(
      result.analysis.role,
      "CODEBASE_ANALYST"
    );

    assert.deepEqual(
      result.baseline,
      [
        {
          command:
            "npm test",
          status:
            "PASS",
        },
      ]
    );

    assert.equal(
      result.implementation.role,
      "IMPLEMENTATION_AGENT"
    );

    assert.equal(
      result.review.role,
      "REVIEW_VALIDATION_AGENT"
    );

    assert.equal(
      result.status,
      "COMPLETED"
    );

    assert.equal(
      result.finalVerdict,
      "PASS"
    );
  }
);

test(
  "B3 échoue fermé si l'Implementation Agent échoue même si Review annonce PASS",
  async () => {
    const {
      orchestrator,
    } = fixture({
      execute:
        async () => ({
          status: "FAIL",
          finalVerdict:
            "FAIL",
          failureCategory:
            "TASK_FAILURE",
        }),

      review:
        async () => ({
          finalVerdict:
            "PASS",
        }),
    });

    const result =
      await orchestrator
        .runTask({
          objective:
            "Corriger le bug",
        });

    assert.equal(
      result.status,
      "FAILED"
    );

    assert.equal(
      result.finalVerdict,
      "FAIL"
    );

    assert.equal(
      result.failureCategory,
      "TASK_FAILURE"
    );
  }
);

test(
  "B3 n'implémente rien si l'analyse échoue",
  async () => {
    let implementationCalls =
      0;

    const {
      orchestrator,
    } = fixture({
      analyze:
        async () => {
          throw Object.assign(
            new Error(
              "analyse impossible"
            ),
            {
              code:
                "ANALYSIS_FAILURE",
            }
          );
        },

      execute:
        async () => {
          implementationCalls +=
            1;

          return {
            status: "PASS",
          };
        },
    });

    await assert.rejects(
      () =>
        orchestrator.runTask({
          objective:
            "Corriger le bug",
        }),
      (error) =>
        error.code ===
        "ANALYSIS_FAILURE"
    );

    assert.equal(
      implementationCalls,
      0
    );

    assert.equal(
      orchestrator
        .getTaskStatus(
          "task-1"
        )
        .failureCategory,
      "ANALYSIS_FAILURE"
    );
  }
);

test(
  "B3 refuse un objectif vide",
  async () => {
    const {
      orchestrator,
    } = fixture();

    await assert.rejects(
      () =>
        orchestrator.runTask({
          objective: "",
        }),
      (error) =>
        error.code ===
        "DEV_OBJECTIVE_REQUIRED"
    );
  }
);

test(
  "B3 refuse de réutiliser le même taskId",
  async () => {
    const {
      orchestrator,
    } = fixture();

    await orchestrator.runTask({
      taskId: "same",
      objective:
        "Première tâche",
    });

    await assert.rejects(
      () =>
        orchestrator.runTask({
          taskId: "same",
          objective:
            "Deuxième tâche",
        }),
      (error) =>
        error.code ===
        "DEV_TASK_ALREADY_EXISTS"
    );
  }
);

test(
  "B3 ne contient aucune primitive Git ou process mutante",
  () => {
    const fs =
      require("node:fs");

    const source =
      fs.readFileSync(
        require.resolve(
          "../services/dev/dev-orchestrator"
        ),
        "utf8"
      );

    assert.doesNotMatch(
      source,
      /child_process|\bspawn\s*\(|\bexec\s*\(/
    );

    assert.doesNotMatch(
      source,
      /\bgit\s+(?:add|commit|push|pull|reset|checkout|clean|rebase)\b/i
    );
  }
);

test(
  "B3 annule pendant l'analyse et n'appelle ni Implementation ni Review",
  async () => {
    let releaseAnalysis;
    let implementationCalls = 0;
    let reviewCalls = 0;

    const analysisStarted =
      new Promise((resolve) => {
        releaseAnalysis =
          resolve;
      });

    let continueAnalysis;

    const analysisGate =
      new Promise((resolve) => {
        continueAnalysis =
          resolve;
      });

    const codebaseAnalyst =
      createCodebaseAnalyst({
        analyze:
          async () => {
            releaseAnalysis();

            await analysisGate;

            return {
              findings: [
                "ready",
              ],
            };
          },
      });

    const implementationAgent =
      createImplementationAgent({
        execute:
          async () => {
            implementationCalls +=
              1;

            return {
              status: "PASS",
              finalVerdict:
                "PASS",
            };
          },

        cancel:
          () => ({
            cancelled: true,
          }),
      });

    const reviewValidationAgent =
      createReviewValidationAgent({
        review:
          async () => {
            reviewCalls +=
              1;

            return {
              finalVerdict:
                "PASS",
            };
          },
      });

    const orchestrator =
      createDevOrchestrator({
        codebaseAnalyst,
        implementationAgent,
        reviewValidationAgent,
        createTaskId:
          () =>
            "task-cancel-analysis",
      });

    const running =
      orchestrator.runTask({
        objective:
          "Corriger le bug",
      });

    await analysisStarted;

    const cancelled =
      orchestrator.cancelTask(
        "task-cancel-analysis"
      );

    assert.equal(
      cancelled.cancelled,
      true
    );

    continueAnalysis();

    const result =
      await running;

    assert.equal(
      result.status,
      "CANCELLED"
    );

    assert.equal(
      result.failureCategory,
      "CANCELLED"
    );

    assert.equal(
      implementationCalls,
      0
    );

    assert.equal(
      reviewCalls,
      0
    );
  }
);

test(
  "B3 n'implémente rien si la baseline échoue",
  async () => {
    let implementationCalls =
      0;
    let reviewCalls =
      0;

    const {
      orchestrator,
    } = fixture({
      baseline:
        async () => {
          throw Object.assign(
            new Error(
              "baseline impossible"
            ),
            {
              code:
                "BASELINE_FAILURE",
            }
          );
        },

      execute:
        async () => {
          implementationCalls +=
            1;

          return {
            status:
              "PASS",
            finalVerdict:
              "PASS",
          };
        },

      review:
        async () => {
          reviewCalls +=
            1;

          return {
            finalVerdict:
              "PASS",
          };
        },
    });

    await assert.rejects(
      () =>
        orchestrator.runTask({
          objective:
            "Corriger le bug",
        }),
      (error) =>
        error.code ===
        "BASELINE_FAILURE"
    );

    assert.equal(
      implementationCalls,
      0
    );

    assert.equal(
      reviewCalls,
      0
    );

    assert.equal(
      orchestrator
        .getTaskStatus(
          "task-1"
        )
        .failureCategory,
      "BASELINE_FAILURE"
    );
  }
);

