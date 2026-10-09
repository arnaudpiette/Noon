"use strict";

const assert =
  require("node:assert/strict");

const {
  EventEmitter,
} = require("node:events");

const fs =
  require("node:fs");

const os =
  require("node:os");

const path =
  require("node:path");

const test =
  require("node:test");

const {
  createDevProcessRunner,
  createSandboxExecutionContractV1,
} = require(
  "../services/security/dev-process-runner"
);

function fakeExecutable(
  executable
) {
  return `/resolved/${executable}`;
}

function createRoot(t) {
  const root =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "noon-sandbox-v1-"
      )
    );

  t.after(
    () =>
      fs.rmSync(
        root,
        {
          recursive: true,
          force: true,
        }
      )
  );

  return fs.realpathSync(
    root
  );
}

function fakeChild({
  pid = 12345,
  onKill = null,
} = {}) {
  const child =
    new EventEmitter();

  child.pid = pid;

  child.stdout =
    new EventEmitter();

  child.stderr =
    new EventEmitter();

  child.killCalls = [];

  child.kill =
    (signal) => {
      child.killCalls.push(
        signal
      );

      onKill?.(
        signal,
        child
      );

      return true;
    };

  return child;
}

function contract(
  root,
  overrides = {}
) {
  return createSandboxExecutionContractV1(
    {
      executionId:
        "sandbox-test-1",

      workspaceId:
        "workspace-test",

      workspaceSessionId:
        "session-test",

      canonicalWorkspaceRoot:
        root,

      command:
        "npm test",

      limits: {
        wallTimeMs: 1_000,
        terminateGraceMs:
          50,
        stdoutBytes: 128,
        stderrBytes: 128,
      },

      ...overrides,
    },
    {
      resolveExecutable:
        fakeExecutable,

      now:
        () => 1_000,
    }
  );
}

function runnerFor(
  root,
  {
    spawnProcess,
    resolveContext = null,
    revalidate = null,
    observability = null,
  } = {}
) {
  return createDevProcessRunner({
    spawnProcess,

    now:
      () => 1_000,

    resolveExecutable:
      fakeExecutable,

    environment: {
      PATH:
        "/usr/local/bin:/usr/bin:/bin",

      LANG:
        "fr_FR.UTF-8",

      HOME:
        "/Users/private",

      OPENAI_API_KEY:
        "sk-secret-value",

      GOOGLE_APPLICATION_CREDENTIALS:
        "/private/credentials.json",
    },

    resolveContext:
      resolveContext ||
      (async () => ({
        workspaceId:
          "workspace-test",

        workspaceSessionId:
          "session-test",

        canonicalWorkspaceRoot:
          root,
      })),

    revalidate:
      revalidate ||
      (async () => ({
        allowed: true,
      })),

    observability,
  });
}

test(
  "le contrat reconstruit la commande allowlistée côté serveur",
  (t) => {
    const root =
      createRoot(t);

    const value =
      contract(root);

    assert.equal(
      value.version,
      1
    );

    assert.equal(
      value.owner,
      "NOON"
    );

    assert.equal(
      value.purpose,
      "DEV_VALIDATION"
    );

    assert.equal(
      value.executableIdentity,
      "/resolved/npm"
    );

    assert.deepEqual(
      value.argv,
      ["test"]
    );

    assert.equal(
      value.isolation.level,
      "APPLICATION_CONSTRAINED"
    );

    assert.equal(
      Object.isFrozen(value),
      true
    );

    assert.equal(
      Object.isFrozen(
        value.argv
      ),
      true
    );
  }
);

test(
  "une commande inconnue est refusée avant tout spawn",
  (t) => {
    const root =
      createRoot(t);

    assert.throws(
      () =>
        createSandboxExecutionContractV1(
          {
            executionId: "x",
            workspaceId: "w",
            workspaceSessionId:
              "s",
            canonicalWorkspaceRoot:
              root,
            command:
              "rm -rf /",
          },
          {
            resolveExecutable:
              fakeExecutable,
          }
        )
    );
  }
);

test(
  "une racine symlinkée n'est pas acceptée comme racine canonique",
  (t) => {
    const root =
      createRoot(t);

    const alias =
      `${root}-alias`;

    fs.symlinkSync(
      root,
      alias,
      "dir"
    );

    t.after(
      () => {
        try {
          fs.unlinkSync(
            alias
          );
        } catch {}
      }
    );

    assert.throws(
      () =>
        createSandboxExecutionContractV1(
          {
            executionId: "x",
            workspaceId: "w",
            workspaceSessionId:
              "s",
            canonicalWorkspaceRoot:
              alias,
            command:
              "npm test",
          },
          {
            resolveExecutable:
              fakeExecutable,
          }
        ),
      (error) =>
        error.code ===
        "SANDBOX_ROOT_NOT_CANONICAL"
    );
  }
);

test(
  "le spawn utilise executable canonique argv structurés shell false et environnement sans secrets",
  async (t) => {
    const root =
      createRoot(t);

    const calls = [];

    const child =
      fakeChild();

    const runner =
      runnerFor(root, {
        spawnProcess(
          executable,
          args,
          options
        ) {
          calls.push({
            executable,
            args,
            options,
          });

          queueMicrotask(
            () => {
              child.stdout.emit(
                "data",
                "ok\n"
              );

              child.emit(
                "close",
                0,
                null
              );
            }
          );

          return child;
        },
      });

    const result =
      await runner.run(
        contract(root)
      );

    assert.equal(
      result.status,
      "PASS"
    );

    assert.equal(
      calls.length,
      1
    );

    assert.equal(
      calls[0].executable,
      "/resolved/npm"
    );

    assert.deepEqual(
      calls[0].args,
      ["test"]
    );

    assert.equal(
      calls[0].options.shell,
      false
    );

    assert.equal(
      calls[0].options.detached,
      false
    );

    assert.deepEqual(
      calls[0].options.stdio,
      [
        "ignore",
        "pipe",
        "pipe",
      ]
    );

    assert.equal(
      calls[0].options.cwd,
      root
    );

    assert.equal(
      calls[0].options.env.HOME,
      undefined
    );

    assert.equal(
      calls[0].options.env
        .OPENAI_API_KEY,
      undefined
    );

    assert.equal(
      calls[0].options.env
        .GOOGLE_APPLICATION_CREDENTIALS,
      undefined
    );

    assert.equal(
      calls[0].options.env.CI,
      "1"
    );

    assert.equal(
      calls[0].options.env
        .NO_COLOR,
      "1"
    );
  }
);

test(
  "un changement de Workspace est refusé avant spawn",
  async (t) => {
    const root =
      createRoot(t);

    let spawnCount = 0;

    const runner =
      runnerFor(root, {
        spawnProcess() {
          spawnCount += 1;

          return fakeChild();
        },

        resolveContext:
          async () => ({
            workspaceId:
              "autre-workspace",

            workspaceSessionId:
              "session-test",

            canonicalWorkspaceRoot:
              root,
          }),
      });

    await assert.rejects(
      () =>
        runner.run(
          contract(root)
        ),
      (error) =>
        error.code ===
        "SANDBOX_CONTEXT_STALE"
    );

    assert.equal(
      spawnCount,
      0
    );
  }
);

test(
  "une révocation d'autorité est refusée avant spawn",
  async (t) => {
    const root =
      createRoot(t);

    let spawnCount = 0;

    const runner =
      runnerFor(root, {
        spawnProcess() {
          spawnCount += 1;

          return fakeChild();
        },

        revalidate:
          async () => ({
            allowed: false,
          }),
      });

    await assert.rejects(
      () =>
        runner.run(
          contract(root)
        ),
      (error) =>
        error.code ===
        "SANDBOX_REVALIDATION_DENIED"
    );

    assert.equal(
      spawnCount,
      0
    );
  }
);

test(
  "une capacité OS non démontrée échoue avant spawn",
  async (t) => {
    const root =
      createRoot(t);

    let spawnCount = 0;

    const runner =
      runnerFor(root, {
        spawnProcess() {
          spawnCount += 1;

          return fakeChild();
        },
      });

    const value =
      contract(
        root,
        {
          requiredCapabilities:
            {
              networkDenied:
                true,
            },
        }
      );

    await assert.rejects(
      () =>
        runner.run(value),
      (error) =>
        error.code ===
        "SANDBOX_CAPABILITY_UNAVAILABLE"
    );

    assert.equal(
      spawnCount,
      0
    );
  }
);

test(
  "une annulation déjà active produit zéro spawn",
  async (t) => {
    const root =
      createRoot(t);

    let spawnCount = 0;

    const controller =
      new AbortController();

    controller.abort();

    const runner =
      runnerFor(root, {
        spawnProcess() {
          spawnCount += 1;

          return fakeChild();
        },
      });

    const result =
      await runner.run(
        contract(root),
        {
          signal:
            controller.signal,
        }
      );

    assert.equal(
      result.status,
      "CANCELLED"
    );

    assert.equal(
      result.reasonCode,
      "CANCELLED_BEFORE_SPAWN"
    );

    assert.equal(
      spawnCount,
      0
    );
  }
);

test(
  "un exit non nul produit FAIL avec exitCode conservé",
  async (t) => {
    const root =
      createRoot(t);

    const child =
      fakeChild();

    const runner =
      runnerFor(root, {
        spawnProcess() {
          queueMicrotask(
            () =>
              child.emit(
                "close",
                2,
                null
              )
          );

          return child;
        },
      });

    const result =
      await runner.run(
        contract(root)
      );

    assert.equal(
      result.status,
      "FAIL"
    );

    assert.equal(
      result.exitCode,
      2
    );

    assert.equal(
      result.reasonCode,
      "PROCESS_EXIT_NON_ZERO"
    );
  }
);

test(
  "stdout et stderr sont bornés avec troncature explicite",
  async (t) => {
    const root =
      createRoot(t);

    const child =
      fakeChild();

    const runner =
      runnerFor(root, {
        spawnProcess() {
          queueMicrotask(
            () => {
              child.stdout.emit(
                "data",
                "A".repeat(
                  500
                )
              );

              child.stderr.emit(
                "data",
                "B".repeat(
                  500
                )
              );

              child.emit(
                "close",
                0,
                null
              );
            }
          );

          return child;
        },
      });

    const result =
      await runner.run(
        contract(root)
      );

    assert.equal(
      result.status,
      "PASS"
    );

    assert.equal(
      result.stdoutTruncated,
      true
    );

    assert.equal(
      result.stderrTruncated,
      true
    );

    assert.equal(
      result.outputTruncated,
      true
    );

    assert.ok(
      Buffer.byteLength(
        result.stdoutTail
      ) <= 128
    );

    assert.ok(
      Buffer.byteLength(
        result.stderrTail
      ) <= 128
    );
  }
);

test(
  "timeout attend la fermeture observée avant de conclure TIMEOUT",
  async (t) => {
    const root =
      createRoot(t);

    const child =
      fakeChild({
        onKill(
          signal,
          target
        ) {
          if (
            signal ===
            "SIGTERM"
          ) {
            queueMicrotask(
              () =>
                target.emit(
                  "close",
                  null,
                  "SIGTERM"
                )
            );
          }
        },
      });

    const runner =
      runnerFor(root, {
        spawnProcess() {
          return child;
        },
      });

    const result =
      await runner.run(
        contract(
          root,
          {
            limits: {
              wallTimeMs: 10,
              terminateGraceMs:
                20,
              stdoutBytes: 128,
              stderrBytes: 128,
            },
          }
        )
      );

    assert.equal(
      result.status,
      "TIMEOUT"
    );

    assert.equal(
      result.cleanupConfirmed,
      true
    );

    assert.deepEqual(
      child.killCalls,
      ["SIGTERM"]
    );
  }
);

test(
  "annulation demande SIGTERM puis conclut seulement après close",
  async (t) => {
    const root =
      createRoot(t);

    const controller =
      new AbortController();

    const child =
      fakeChild({
        onKill(
          signal,
          target
        ) {
          if (
            signal ===
            "SIGTERM"
          ) {
            queueMicrotask(
              () =>
                target.emit(
                  "close",
                  null,
                  "SIGTERM"
                )
            );
          }
        },
      });

    const runner =
      runnerFor(root, {
        spawnProcess() {
          queueMicrotask(
            () =>
              controller.abort()
          );

          return child;
        },
      });

    const result =
      await runner.run(
        contract(root),
        {
          signal:
            controller.signal,
        }
      );

    assert.equal(
      result.status,
      "CANCELLED"
    );

    assert.equal(
      result.cleanupConfirmed,
      true
    );

    assert.deepEqual(
      child.killCalls,
      ["SIGTERM"]
    );
  }
);

test(
  "absence de close après escalade reste CLEANUP_UNCONFIRMED",
  async (t) => {
    const root =
      createRoot(t);

    const child =
      fakeChild();

    const runner =
      runnerFor(root, {
        spawnProcess() {
          return child;
        },
      });

    const result =
      await runner.run(
        contract(
          root,
          {
            limits: {
              wallTimeMs: 5,
              terminateGraceMs:
                5,
              stdoutBytes: 128,
              stderrBytes: 128,
            },
          }
        )
      );

    assert.equal(
      result.status,
      "CLEANUP_UNCONFIRMED"
    );

    assert.equal(
      result.cleanupConfirmed,
      false
    );

    assert.deepEqual(
      child.killCalls,
      [
        "SIGTERM",
        "SIGKILL",
      ]
    );
  }
);

test(
  "une erreur de spawn ne devient jamais un succès",
  async (t) => {
    const root =
      createRoot(t);

    const runner =
      runnerFor(root, {
        spawnProcess() {
          throw new Error(
            "spawn failed"
          );
        },
      });

    const result =
      await runner.run(
        contract(root)
      );

    assert.equal(
      result.status,
      "FAIL"
    );

    assert.equal(
      result.reasonCode,
      "SPAWN_FAILED"
    );
  }
);

test(
  "l'observabilité ne reçoit ni commande ni sortie ni environnement",
  async (t) => {
    const root =
      createRoot(t);

    const events = [];

    const child =
      fakeChild();

    const runner =
      runnerFor(root, {
        observability(
          event,
          metadata
        ) {
          events.push({
            event,
            metadata,
          });
        },

        spawnProcess() {
          queueMicrotask(
            () => {
              child.stdout.emit(
                "data",
                "PRIVATE OUTPUT"
              );

              child.emit(
                "close",
                0,
                null
              );
            }
          );

          return child;
        },
      });

    await runner.run(
      contract(root)
    );

    const serialized =
      JSON.stringify(events);

    assert.equal(
      serialized.includes(
        "npm test"
      ),
      false
    );

    assert.equal(
      serialized.includes(
        "PRIVATE OUTPUT"
      ),
      false
    );

    assert.equal(
      serialized.includes(
        "sk-secret-value"
      ),
      false
    );

    assert.ok(
      events.some(
        (item) =>
          item.event ===
          "dev_process_runner.completed"
      )
    );
  }
);

test(
  "onSpawn expose uniquement le PID du processus",
  async (t) => {
    const root =
      createRoot(t);

    const child =
      fakeChild({
        pid: 9876,
      });

    let metadata = null;

    const runner =
      runnerFor(root, {
        spawnProcess() {
          queueMicrotask(
            () =>
              child.emit(
                "close",
                0,
                null
              )
          );

          return child;
        },
      });

    const result =
      await runner.run(
        contract(root),
        {
          onSpawn(value) {
            metadata = value;
          },
        }
      );

    assert.deepEqual(
      metadata,
      {
        pid: 9876,
      }
    );

    assert.equal(
      Object.hasOwn(
        metadata,
        "child"
      ),
      false
    );

    assert.equal(
      result.status,
      "PASS"
    );
  }
);

test(
  "les hooks synchrones lancent le processus avant le retour de run",
  async (t) => {
    const root =
      createRoot(t);

    const child =
      fakeChild();

    let spawnCount = 0;

    const runner =
      runnerFor(root, {
        resolveContext() {
          return {
            workspaceId: "workspace-test",
            workspaceSessionId: "session-test",
            canonicalWorkspaceRoot: root,
          };
        },

        revalidate() {
          return {
            allowed: true,
          };
        },

        spawnProcess() {
          spawnCount += 1;

          queueMicrotask(
            () =>
              child.emit(
                "close",
                0,
                null
              )
          );

          return child;
        },
      });

    const pending =
      runner.run(
        contract(root)
      );

    assert.equal(
      spawnCount,
      1
    );

    assert.equal(
      (await pending).status,
      "PASS"
    );
  }
);

test(
  "une revalidation asynchrone bloque le spawn jusqu'à son autorisation",
  async (t) => {
    const root =
      createRoot(t);

    const child =
      fakeChild();

    let allow;
    let spawnCount = 0;

    const authorization =
      new Promise(
        (resolve) => {
          allow = resolve;
        }
      );

    const runner =
      runnerFor(root, {
        resolveContext() {
          return {
            workspaceId: "workspace-test",
            workspaceSessionId: "session-test",
            canonicalWorkspaceRoot: root,
          };
        },

        revalidate() {
          return authorization;
        },

        spawnProcess() {
          spawnCount += 1;

          queueMicrotask(
            () =>
              child.emit(
                "close",
                0,
                null
              )
          );

          return child;
        },
      });

    const pending =
      runner.run(
        contract(root)
      );

    assert.equal(
      spawnCount,
      0
    );

    allow({ allowed: true });

    assert.equal(
      (await pending).status,
      "PASS"
    );

    assert.equal(
      spawnCount,
      1
    );
  }
);
