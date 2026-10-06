"use strict";

const test =
  require("node:test");

const assert =
  require("node:assert/strict");

const {
  createNativeDevUiExecutionService,
} = require(
  "../services/dev/native-dev-ui-execution-service"
);

function deferred() {
  let resolve;
  let reject;

  const promise =
    new Promise(
      (
        resolvePromise,
        rejectPromise
      ) => {
        resolve =
          resolvePromise;

        reject =
          rejectPromise;
      }
    );

  return {
    promise,
    resolve,
    reject,
  };
}

function fixture({
  mode = "LIMITED",
} = {}) {
  const run =
    deferred();

  const calls = {
    run: [],
    cancel: [],
    rules: [],
  };

  let taskCounter = 0;

  const nativeDevFacade = {
    runTask(input) {
      calls.run.push(
        structuredClone(
          input
        )
      );

      return run.promise;
    },

    getTaskStatus() {
      return null;
    },

    cancelTask(
      taskId
    ) {
      calls.cancel.push(
        taskId
      );

      return {
        cancelled: true,
        taskId,
      };
    },
  };

  const service =
    createNativeDevUiExecutionService({
      terminalService: {
        getSession(
          sessionId
        ) {
          assert.equal(
            sessionId,
            "workspace-session-1"
          );

          return {
            id:
              sessionId,

            workspaceId:
              "workspace-1",

            repositoryRoot:
              "/tmp/noon-native-ui",
          };
        },
      },

      nativeDevFacade,

      workspaceEngine: {
        context(
          workspaceId
        ) {
          assert.equal(
            workspaceId,
            "workspace-1"
          );

          return {
            workspace: {
              profileScope:
                "arnaud",
            },

            projects: [
              {
                id:
                  "project-1",
              },
            ],
          };
        },
      },

      projectRuleResolver: {
        resolve(input) {
          calls.rules.push(
            structuredClone(
              input
            )
          );

          return {
            applied: [
              {
                text:
                  "Préserver la structure existante.",
              },
            ],
          };
        },
      },

      featureMode:
        () =>
          mode,

      createTaskId:
        () => {
          taskCounter += 1;

          return `native-ui-${taskCounter}`;
        },

      now:
        (() => {
          let value =
            Date.parse(
              "2026-10-06T00:00:00.000Z"
            );

          return () => {
            value += 1000;
            return value;
          };
        })(),
    });

  return {
    service,
    run,
    calls,
  };
}

test(
  "Native DEV UI dérive repositoryRoot de la session serveur",
  async () => {
    const f =
      fixture();

    const started =
      f.service.start({
        workspaceSessionId:
          "workspace-session-1",

        validationCommand:
          "npm test",

        repositoryRoot:
          "/tmp/forged-client-root",
      });

    assert.equal(
      started.taskId,
      "native-ui-1"
    );

    assert.equal(
      started.status,
      "RUNNING"
    );

    assert.equal(
      f.calls.run.length,
      1
    );

    assert.equal(
      f.calls.run[0]
        .repositoryRoot,
      "/tmp/noon-native-ui"
    );

    assert.equal(
      f.calls.run[0]
        .workspaceId,
      "workspace-1"
    );

    assert.deepEqual(
      f.calls.run[0]
        .validationCommands,
      [
        "npm test",
      ]
    );

    assert.deepEqual(
      f.calls.run[0]
        .projectInstructions,
      [
        "Préserver la structure existante.",
      ]
    );

    assert.deepEqual(
      f.calls.run[0]
        .permissions,
      [
        "READ_WRITE_WORKSPACE",
        "TERMINAL_SAFE",
      ]
    );

    assert.throws(
      () =>
        f.service.start({
          workspaceSessionId:
            "workspace-session-1",

          validationCommand:
            "npm test",
        }),
      {
        code:
          "DEV_NATIVE_UI_ALREADY_RUNNING",
      }
    );

    f.run.resolve({
      taskId:
        "native-ui-1",

      finalVerdict:
        "PASS",

      failureCategory:
        null,

      metrics: {
        backendReached:
          true,

        fileCount:
          2,

        duration:
          1500,

        actualCost:
          0.01,

        estimatedCost:
          0.012,
      },
    });

    await new Promise(
      (resolve) =>
        setImmediate(
          resolve
        )
    );

    const completed =
      f.service.get(
        "native-ui-1"
      );

    assert.equal(
      completed.status,
      "COMPLETED"
    );

    assert.equal(
      completed.finalVerdict,
      "PASS"
    );

    assert.equal(
      completed.backendReached,
      true
    );

    assert.equal(
      completed.changedFileCount,
      2
    );

    assert.equal(
      completed.actualCost,
      0.01
    );
  }
);

test(
  "Native DEV UI refuse avant run si native-core n'est pas LIMITED",
  () => {
    const f =
      fixture({
        mode: "OFF",
      });

    assert.throws(
      () =>
        f.service.start({
          workspaceSessionId:
            "workspace-session-1",

          validationCommand:
            "npm test",
        }),
      {
        code:
          "DEV_NATIVE_FEATURE_DISABLED",
        statusCode:
          409,
      }
    );

    assert.equal(
      f.calls.run.length,
      0
    );
  }
);

test(
  "Native DEV UI conserve CANCELLED même si la promesse se termine ensuite",
  async () => {
    const f =
      fixture();

    const started =
      f.service.start({
        workspaceSessionId:
          "workspace-session-1",

        validationCommand:
          "npm test",
      });

    const cancelled =
      f.service.cancel(
        started.taskId
      );

    assert.equal(
      cancelled.cancelled,
      true
    );

    assert.deepEqual(
      f.calls.cancel,
      [
        "native-ui-1",
      ]
    );

    assert.equal(
      f.service.get(
        started.taskId
      ).status,
      "CANCELLED"
    );

    f.run.resolve({
      taskId:
        started.taskId,

      finalVerdict:
        "PASS",

      failureCategory:
        null,

      metrics: {
        backendReached:
          true,
        fileCount: 1,
      },
    });

    await new Promise(
      (resolve) =>
        setImmediate(
          resolve
        )
    );

    const final =
      f.service.get(
        started.taskId
      );

    assert.equal(
      final.status,
      "CANCELLED"
    );

    assert.equal(
      final.finalVerdict,
      "CANCELLED"
    );

    assert.equal(
      final.failureCategory,
      "CANCELLED"
    );
  }
);
