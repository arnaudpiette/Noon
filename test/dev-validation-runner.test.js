"use strict";

const assert =
  require("node:assert/strict");

const fs =
  require("node:fs");

const os =
  require("node:os");

const path =
  require("node:path");

const test =
  require("node:test");

const {
  createSandboxDevValidationExecutor,
} = require(
  "../services/security/dev-validation-runner"
);

function root(t) {
  const value =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "noon-validation-runner-"
      )
    );

  t.after(
    () =>
      fs.rmSync(
        value,
        {
          recursive: true,
          force: true,
        }
      )
  );

  return fs.realpathSync(
    value
  );
}

function policy(
  outcome = "ALLOW"
) {
  return {
    evaluate() {
      return {
        outcome,
        policyVersion:
          "test-policy",
        decisionId:
          "decision-test",
      };
    },
  };
}

test(
  "l'adaptateur utilise sessionId explicite et mappe PASS",
  async (t) => {
    const workspaceRoot =
      root(t);

    const contracts = [];

    const executor =
      createSandboxDevValidationExecutor({
        workspaceEngine: {
          context() {
            return {
              roots: [
                {
                  path:
                    workspaceRoot,
                  mode:
                    "read-write",
                },
              ],
            };
          },
        },

        operationalSecurityPolicy:
          policy(),

        createExecutionId:
          () =>
            "execution-test",

        createContract(
          input
        ) {
          contracts.push(
            input
          );

          return {
            fake: true,
          };
        },

        createRunner() {
          return {
            async run() {
              return {
                status: "PASS",
                exitCode: 0,
                durationMs: 12,
                outputTail: "",
                outputTruncated:
                  false,
                cleanupConfirmed:
                  true,
                isolation: {
                  level:
                    "APPLICATION_CONSTRAINED",
                },
              };
            },
          };
        },
      });

    const result =
      await executor(
        "npm test",
        workspaceRoot,
        5_000,
        null,
        {
          taskId:
            "task-1",

          workspaceId:
            "workspace-1",

          sessionId:
            "session-1",

          permissions: [
            "TERMINAL_SAFE",
          ],
        }
      );

    assert.equal(
      contracts.length,
      1
    );

    assert.equal(
      contracts[0]
        .workspaceSessionId,
      "session-1"
    );

    assert.equal(
      result.status,
      "PASS"
    );

    assert.equal(
      result.failureCategory,
      null
    );
  }
);

test(
  "taskId canonique sert de scope quand aucune session distincte n'existe",
  async (t) => {
    const workspaceRoot =
      root(t);

    let contractInput;

    const executor =
      createSandboxDevValidationExecutor({
        workspaceEngine: {
          context() {
            return {
              relevantRoots: [
                {
                  path:
                    workspaceRoot,
                  mode:
                    "read-write",
                },
              ],
            };
          },
        },

        operationalSecurityPolicy:
          policy(),

        createContract(
          input
        ) {
          contractInput =
            input;

          return {};
        },

        createRunner() {
          return {
            async run() {
              return {
                status:
                  "TIMEOUT",
                reasonCode:
                  "TIMEOUT",
                exitCode: null,
                durationMs: 50,
                outputTail:
                  "timeout",
                outputTruncated:
                  false,
                cleanupConfirmed:
                  true,
                isolation: {
                  level:
                    "APPLICATION_CONSTRAINED",
                },
              };
            },
          };
        },
      });

    const result =
      await executor(
        "npm test",
        workspaceRoot,
        100,
        null,
        {
          taskId:
            "task-specialist",

          workspaceId:
            "workspace-1",

          sessionId: null,

          permissions: [
            "TERMINAL_SAFE",
          ],
        }
      );

    assert.equal(
      contractInput
        .workspaceSessionId,
      "task-specialist"
    );

    assert.equal(
      result.status,
      "FAIL"
    );

    assert.equal(
      result.failureCategory,
      "TIMEOUT"
    );
  }
);

test(
  "une policy révoquée bloque avant création du runner",
  async (t) => {
    const workspaceRoot =
      root(t);

    let runnerCount = 0;

    const executor =
      createSandboxDevValidationExecutor({
        workspaceEngine: {
          context() {
            return {
              roots: [
                {
                  path:
                    workspaceRoot,
                  mode:
                    "read-write",
                },
              ],
            };
          },
        },

        operationalSecurityPolicy:
          policy("DENY"),

        createRunner() {
          runnerCount += 1;
          return {};
        },
      });

    const result =
      await executor(
        "npm test",
        workspaceRoot,
        1_000,
        null,
        {
          taskId:
            "task-1",

          workspaceId:
            "workspace-1",

          permissions: [
            "TERMINAL_SAFE",
          ],
        }
      );

    assert.equal(
      runnerCount,
      0
    );

    assert.equal(
      result.status,
      "FAIL"
    );

    assert.equal(
      result.failureCategory,
      "PERMISSION_DENIED"
    );
  }
);

test(
  "COMMAND_NOT_ALLOWLISTED reste DENIED pour compatibilité Native",
  async (t) => {
    const workspaceRoot =
      root(t);

    const executor =
      createSandboxDevValidationExecutor({
        workspaceEngine: {
          context() {
            return {
              roots: [
                {
                  path:
                    workspaceRoot,
                  mode:
                    "read-write",
                },
              ],
            };
          },
        },

        operationalSecurityPolicy:
          policy(),

        createContract() {
          throw Object.assign(
            new Error(
              "not allowed"
            ),
            {
              code:
                "COMMAND_NOT_ALLOWLISTED",
            }
          );
        },

        createRunner() {
          throw new Error(
            "runner must not be created"
          );
        },
      });

    const result =
      await executor(
        "rm -rf .",
        workspaceRoot,
        1_000,
        null,
        {
          taskId:
            "task-1",

          workspaceId:
            "workspace-1",

          permissions: [
            "TERMINAL_SAFE",
          ],
        }
      );

    assert.equal(
      result.status,
      "DENIED"
    );

    assert.equal(
      result.failureCategory,
      "COMMAND_NOT_ALLOWLISTED"
    );
  }
);
