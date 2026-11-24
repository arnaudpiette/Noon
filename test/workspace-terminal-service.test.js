"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const {
  createSandboxExecutionContractV1,
  createSessionAndTerminal,
  fixture,
  sanitizedTerminalEnvironment,
} = require("./helpers/workspace-terminal-service-fixtures");

test("crée une session uniquement sur une racine workspace autorisée", (context) => {
  const data = fixture(context);

  const session = data.service.createSession({
    workspaceId: "workspace-test",
  });

  assert.equal(
    session.repositoryRoot,
    fs.realpathSync(data.root)
  );

  assert.equal(
    session.workspaceId,
    "workspace-test"
  );

  assert.equal(
    session.executionState,
    "READY"
  );
});

test("refuse une racine étrangère au workspace", (context) => {
  const data = fixture(context);

  assert.throws(
    () =>
      data.service.createSession({
        workspaceId: "workspace-test",
        repositoryRoot: data.foreignRoot,
      }),
    (error) =>
      error?.code === "WORKSPACE_ROOT_DENIED"
  );
});

test("supporte plusieurs terminaux indépendants", (context) => {
  const data = fixture(context);

  const session = data.service.createSession({
    workspaceId: "workspace-test",
  });

  const first = data.service.createTerminal({
    sessionId: session.id,
  });

  const second = data.service.createTerminal({
    sessionId: session.id,
  });

  assert.notEqual(first.id, second.id);

  const current = data.service.getSession(session.id);

  assert.equal(current.terminalSessions.length, 2);
  assert.equal(current.activeTerminalId, second.id);
});

test("un terminal appartient à USER par défaut", (context) => {
  const data = fixture(context);
  const { terminal } = createSessionAndTerminal(data);

  assert.equal(terminal.owner, "USER");
});

test("un terminal NOON doit être explicitement créé", (context) => {
  const data = fixture(context);

  const { terminal } = createSessionAndTerminal(
    data,
    { owner: "NOON" }
  );

  assert.equal(terminal.owner, "NOON");
});

test("npm test utilise exactement executable + arguments sans shell", (context) => {
  const data = fixture(context);
  const { session, terminal } =
    createSessionAndTerminal(data);

  const result = data.service.runCommand({
    sessionId: session.id,
    terminalId: terminal.id,
    origin: "USER",
    command: "npm test",
  });

  assert.equal(data.spawnCalls.length, 1);

  const call = data.spawnCalls[0];

  assert.equal(call.executable, "npm");
  assert.deepEqual(call.args, ["test"]);
  assert.equal(call.options.cwd, fs.realpathSync(data.root));
  assert.equal(call.options.shell, false);

  assert.equal(
    Object.hasOwn(call.options.env, "OPENAI_API_KEY"),
    false
  );

  assert.equal(
    Object.hasOwn(call.options.env, "GOOGLE_CLIENT_SECRET"),
    false
  );

  assert.equal(
    Object.hasOwn(call.options.env, "GITHUB_TOKEN"),
    false
  );

  assert.equal(result.classification, "SAFE_READ");
});

test("node --test conserve des arguments structurés", (context) => {
  const data = fixture(context);
  const { session, terminal } =
    createSessionAndTerminal(data);

  data.service.runCommand({
    sessionId: session.id,
    terminalId: terminal.id,
    origin: "USER",
    command: "node --test test/foo.test.js",
  });

  assert.equal(data.spawnCalls.length, 1);

  assert.equal(
    data.spawnCalls[0].executable,
    "node"
  );

  assert.deepEqual(
    data.spawnCalls[0].args,
    ["--test", "test/foo.test.js"]
  );

  assert.equal(
    data.spawnCalls[0].options.shell,
    false
  );
});

test("les commandes non allowlistées ne créent jamais de process", (context) => {
  const deniedCommands = [
    "node -e \"require('fs').writeFileSync('x','x')\"",
    "python3 -c \"open('x','w').write('x')\"",
    "echo foo > fichier.txt",
    "echo foo | tee fichier.txt",
    "npm test ; echo hacked",
    "npm test && echo hacked",
    "npm test || echo hacked",
    "sh -c 'echo hacked'",
    "bash -c 'echo hacked'",
    "zsh -c 'echo hacked'",
    "curl https://example.com",
    "wget https://example.com",
    "ssh example.com",
    "npm install lodash",
    "git push origin main",
    "rm -rf test",
    "sudo echo nope",
  ];

  for (const command of deniedCommands) {
    const data = fixture(context);
    const { session, terminal } =
      createSessionAndTerminal(data);

    assert.throws(
      () =>
        data.service.runCommand({
          sessionId: session.id,
          terminalId: terminal.id,
          origin: "USER",
          command,
        }),
      (error) =>
        typeof error?.code === "string"
    );

    assert.equal(
      data.spawnCalls.length,
      0,
      `aucun spawn attendu pour: ${command}`
    );

    assert.equal(
      data.policyCalls.length,
      0,
      `la policy opérationnelle ne doit pas rendre autorisable: ${command}`
    );
  }
});

test("un terminal USER refuse une commande provenant de NOON", (context) => {
  const data = fixture(context);

  const { session, terminal } =
    createSessionAndTerminal(data);

  assert.throws(
    () =>
      data.service.runCommand({
        sessionId: session.id,
        terminalId: terminal.id,
        origin: "NOON",
        command: "npm test",
      }),
    (error) =>
      error?.code ===
      "USER_TERMINAL_AUTOMATION_DENIED"
  );

  assert.equal(data.spawnCalls.length, 0);
});

test("un terminal NOON refuse une commande provenant de USER", (context) => {
  const data = fixture(context);

  const { session, terminal } =
    createSessionAndTerminal(
      data,
      { owner: "NOON" }
    );

  assert.throws(
    () =>
      data.service.runCommand({
        sessionId: session.id,
        terminalId: terminal.id,
        origin: "USER",
        command: "npm test",
      }),
    (error) =>
      error?.code ===
      "NOON_TERMINAL_ORIGIN_DENIED"
  );

  assert.equal(data.spawnCalls.length, 0);
});

test("un terminal NOON accepte une commande explicitement NOON", async (context) => {
  const data = fixture(context);

  const { session, terminal } =
    createSessionAndTerminal(
      data,
      { owner: "NOON" }
    );

  data.service.runCommand({
    sessionId: session.id,
    terminalId: terminal.id,
    origin: "NOON",
    command: "git diff --check",
  });

  assert.equal(data.spawnCalls.length, 1);

  assert.equal(
    path.isAbsolute(
      data.spawnCalls[0].executable
    ),
    true
  );

  assert.match(
    data.spawnCalls[0].executable,
    /(?:^|\/)git$/
  );

  assert.deepEqual(
    data.spawnCalls[0].args,
    ["diff", "--check"]
  );

  data.children[0].emit("close", 0, null);
  await new Promise((resolve) => setImmediate(resolve));
});

test("les sorties sont redacted avant stockage public", (context) => {
  const data = fixture(context);

  const { session, terminal } =
    createSessionAndTerminal(data);

  data.service.runCommand({
    sessionId: session.id,
    terminalId: terminal.id,
    origin: "USER",
    command: "npm test",
  });

  const secret =
    "sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZ123456789";

  data.children[0].stdout.emit(
    "data",
    `result=${secret}`
  );

  const result = data.service.poll({
    sessionId: session.id,
    terminalId: terminal.id,
    from: 0,
  });

  assert.equal(
    JSON.stringify(result).includes(secret),
    false
  );
});

test("un terminal occupé refuse une seconde commande", (context) => {
  const data = fixture(context);

  const { session, terminal } =
    createSessionAndTerminal(data);

  data.service.runCommand({
    sessionId: session.id,
    terminalId: terminal.id,
    origin: "USER",
    command: "npm test",
  });

  assert.throws(
    () =>
      data.service.runCommand({
        sessionId: session.id,
        terminalId: terminal.id,
        origin: "USER",
        command: "git diff --check",
      }),
    (error) =>
      error?.code === "TERMINAL_BUSY"
  );

  assert.equal(data.spawnCalls.length, 1);
});

test("la fermeture d’un terminal tue uniquement son process", (context) => {
  const data = fixture(context);

  const session = data.service.createSession({
    workspaceId: "workspace-test",
  });

  const first = data.service.createTerminal({
    sessionId: session.id,
  });

  const second = data.service.createTerminal({
    sessionId: session.id,
  });

  data.service.runCommand({
    sessionId: session.id,
    terminalId: first.id,
    origin: "USER",
    command: "npm test",
  });

  data.service.runCommand({
    sessionId: session.id,
    terminalId: second.id,
    origin: "USER",
    command: "git diff --check",
  });

  const firstChild = data.children[0];
  const secondChild = data.children[1];

  data.service.closeTerminal({
    sessionId: session.id,
    terminalId: first.id,
  });

  assert.equal(firstChild.killed, true);
  assert.equal(firstChild.lastSignal, "SIGTERM");

  assert.equal(secondChild.killed, false);
});

test("une validation Noon annulée par l’utilisateur ne devient jamais UNRESOLVED", async (context) => {
  const data = fixture(context);
  const session = data.service.createSession({ workspaceId: "workspace-test" });
  const failedTerminal = data.service.createTerminal({ sessionId: session.id });

  data.service.runCommand({
    sessionId: session.id,
    terminalId: failedTerminal.id,
    origin: "USER",
    command: "npm test",
  });

  data.children[0].emit("close", 1, null);
  assert.equal(data.service.getSession(session.id).problems.status, "UNRESOLVED");

  const terminal = data.service.createTerminal({ sessionId: session.id, owner: "NOON" });
  data.service.runCommand({ sessionId: session.id, terminalId: terminal.id, origin: "NOON", command: "npm test" });
  const child = data.children[1];
  data.service.closeTerminal({ sessionId: session.id, terminalId: terminal.id, reason: "USER_CANCELLED" });
  child.emit("close", null, "SIGTERM");
  await new Promise((resolve) => setImmediate(resolve));
  const current = data.service.getSession(session.id);
  assert.equal(current.problems.status, "CANCELLED");
  assert.equal(current.lastValidationState.status, "CANCELLED");
});

test(
  "un terminal NOON annulé après absence de onSpawn synchrone ne peut jamais lancer plus tard",
  async (context) => {
    let lateSpawnCount = 0;
    let receivedSignal = null;
    let releaseAsyncGate = null;

    const gate =
      new Promise(
        (resolve) => {
          releaseAsyncGate = resolve;
        }
      );

    const data =
      fixture(
        context,
        {
          serviceOptions: {
            createSandboxRunner() {
              return {
                async run(
                  _contract,
                  options = {}
                ) {
                  receivedSignal =
                    options.signal ||
                    null;

                  await gate;

                  if (
                    receivedSignal?.aborted
                  ) {
                    return {
                      status:
                        "CANCELLED",
                      exitCode: null,
                      signal:
                        "SIGTERM",
                      reasonCode:
                        "CANCELLED_BEFORE_SPAWN",
                      cleanupConfirmed:
                        true,
                    };
                  }

                  lateSpawnCount += 1;

                  options.onSpawn?.({
                    pid: 9999,
                  });

                  return {
                    status: "PASS",
                    exitCode: 0,
                    signal: null,
                    cleanupConfirmed:
                      true,
                  };
                },
              };
            },
          },
        }
      );

    const {
      session,
      terminal,
    } =
      createSessionAndTerminal(
        data,
        {
          owner: "NOON",
        }
      );

    assert.throws(
      () =>
        data.service.runCommand({
          sessionId:
            session.id,

          terminalId:
            terminal.id,

          origin:
            "NOON",

          command:
            "npm test",
        })
    );

    assert.ok(
      receivedSignal,
      "le Terminal doit transmettre un AbortSignal au runner"
    );

    assert.equal(
      receivedSignal.aborted,
      true,
      "le refus synchrone doit annuler immédiatement le runner"
    );

    releaseAsyncGate();

    await new Promise(
      (resolve) =>
        setImmediate(resolve)
    );

    assert.equal(
      lateSpawnCount,
      0,
      "aucun spawn ne doit devenir possible après le refus synchrone"
    );
  }
);

test("un terminal NOON refuse un état démarré sans onSpawn synchrone", (context) => {
  const data = fixture(context, {
    serviceOptions: {
      createSandboxRunner() {
        return {
          run() {
            return Promise.resolve({ status: "PASS" });
          },
        };
      },
    },
  });
  const { session, terminal } = createSessionAndTerminal(data, { owner: "NOON" });

  assert.throws(
    () => data.service.runCommand({
      sessionId: session.id,
      terminalId: terminal.id,
      origin: "NOON",
      command: "npm test",
    }),
    (error) => error.code === "SANDBOX_TERMINAL_SYNC_START_REQUIRED"
  );

  const current = data.service.getSession(session.id);
  assert.equal(current.terminalSessions[0].running, false);
  assert.equal(current.problems.status, "EMPTY");
});

test("une annulation NOON conserve CANCELLED et expose cleanup non confirmé", async (context) => {
  const data = fixture(context, {
    serviceOptions: {
      createSandboxContract(input, options) {
        return createSandboxExecutionContractV1({
          ...input,
          limits: {
            wallTimeMs: 50,
            terminateGraceMs: 5,
            stdoutBytes: 128,
            stderrBytes: 128,
          },
        }, options);
      },
    },
  });
  const { session, terminal } = createSessionAndTerminal(data, { owner: "NOON" });

  data.service.runCommand({
    sessionId: session.id,
    terminalId: terminal.id,
    origin: "NOON",
    command: "npm test",
  });

  data.service.closeTerminal({
    sessionId: session.id,
    terminalId: terminal.id,
    reason: "USER_CANCELLED",
  });

  await new Promise((resolve) => setTimeout(resolve, 30));

  const current = data.service.getSession(session.id);
  assert.equal(current.problems.status, "CANCELLED");
  assert.equal(current.lastValidationState.status, "CANCELLED");
  assert.equal(current.lastValidationState.cleanupStatus, "CLEANUP_UNCONFIRMED");
  assert.equal(current.terminalSessions[0].cleanupStatus, "CLEANUP_UNCONFIRMED");
});

test("un résultat NOON tardif ne remplace pas Problems ni validation USER plus récente", async (context) => {
  const data = fixture(context);
  const session = data.service.createSession({ workspaceId: "workspace-test" });
  const noon = data.service.createTerminal({ sessionId: session.id, owner: "NOON" });

  data.service.runCommand({
    sessionId: session.id,
    terminalId: noon.id,
    origin: "NOON",
    command: "npm test",
  });

  const user = data.service.createTerminal({ sessionId: session.id, owner: "USER" });
  data.service.runCommand({
    sessionId: session.id,
    terminalId: user.id,
    origin: "USER",
    command: "npm test",
  });
  data.children[1].stderr.emit("data", "test at test/a.test.js:1:1\nAssertionError [ERR_ASSERTION]: current user failure");
  data.children[1].emit("close", 1, null);

  data.children[0].emit("close", 0, null);
  await new Promise((resolve) => setImmediate(resolve));

  const current = data.service.getSession(session.id);
  assert.equal(current.problems.command, "npm test");
  assert.ok(current.problems.counts.error > 0);
  assert.equal(current.lastValidationState.origin, "USER");
  assert.equal(current.lastValidationState.status, "FAIL");
});

test("la fermeture d’une session ferme tous ses terminaux", (context) => {
  const data = fixture(context);

  const session = data.service.createSession({
    workspaceId: "workspace-test",
  });

  const first = data.service.createTerminal({
    sessionId: session.id,
  });

  const second = data.service.createTerminal({
    sessionId: session.id,
  });

  data.service.runCommand({
    sessionId: session.id,
    terminalId: first.id,
    origin: "USER",
    command: "npm test",
  });

  data.service.runCommand({
    sessionId: session.id,
    terminalId: second.id,
    origin: "USER",
    command: "git diff --check",
  });

  data.service.closeSession(session.id);

  assert.equal(data.children[0].killed, true);
  assert.equal(data.children[1].killed, true);

  assert.throws(
    () => data.service.getSession(session.id),
    (error) =>
      error?.code === "DEV_WORKSPACE_NOT_FOUND"
  );
});

test("error puis close ne finalisent pas deux fois le terminal", (context) => {
  const data = fixture(context);

  const { session, terminal } =
    createSessionAndTerminal(data);

  data.service.runCommand({
    sessionId: session.id,
    terminalId: terminal.id,
    origin: "USER",
    command: "npm test",
  });

  const child = data.children[0];

  child.emit(
    "error",
    Object.assign(new Error("fixture failure"), {
      code: "FIXTURE_FAILURE",
    })
  );

  child.emit("close", 1, null);

  const current =
    data.service.getSession(session.id);

  const value =
    current.terminalSessions.find(
      (item) => item.id === terminal.id
    );

  assert.equal(value.status, "EXITED");
});

test("l’environnement terminal est strictement allowlisté", () => {
  const env = sanitizedTerminalEnvironment({
    PATH: "/usr/bin:/bin",
    HOME: "/Users/test",
    LANG: "fr_FR.UTF-8",
    TERM: "xterm-256color",
    OPENAI_API_KEY: "secret",
    GOOGLE_CLIENT_SECRET: "secret",
    GITHUB_TOKEN: "secret",
  });

  assert.equal(env.PATH, "/usr/bin:/bin");
  assert.equal(env.HOME, "/Users/test");
  assert.equal(env.CI, "1");
  assert.equal(env.NO_COLOR, "1");

  assert.equal(
    Object.hasOwn(env, "OPENAI_API_KEY"),
    false
  );

  assert.equal(
    Object.hasOwn(env, "GOOGLE_CLIENT_SECRET"),
    false
  );

  assert.equal(
    Object.hasOwn(env, "GITHUB_TOKEN"),
    false
  );
});

test(
  "le curseur de polling progresse au-delà du buffer borné",
  (context) => {
    const data = fixture(context);

    const { session, terminal } =
      createSessionAndTerminal(data);

    data.service.runCommand({
      sessionId: session.id,
      terminalId: terminal.id,
      origin: "USER",
      command: "npm test",
    });

    const child = data.children[0];

    for (let index = 0; index < 405; index += 1) {
      child.stdout.emit(
        "data",
        `line-${index}\n`
      );
    }

    const first = data.service.poll({
      sessionId: session.id,
      terminalId: terminal.id,
      from: 0,
    });

    // 1 événement "input" + 405 stdout = 406 événements,
    // mais seulement les 400 derniers sont conservés.
    assert.equal(
      first.output.length,
      400
    );

    assert.equal(
      first.next,
      406
    );

    assert.equal(
      first.output[0].text,
      "line-5\n"
    );

    const cursor =
      first.next;

    child.stdout.emit(
      "data",
      "line-405\n"
    );

    const second = data.service.poll({
      sessionId: session.id,
      terminalId: terminal.id,
      from: cursor,
    });

    assert.equal(
      second.output.length,
      1
    );

    assert.equal(
      second.output[0].text,
      "line-405\n"
    );

    assert.equal(
      second.next,
      407
    );

    // Le compteur interne ne fuit pas
    // dans le contrat public HTTP/UI.
    assert.deepEqual(
      Object.keys(second.output[0]).sort(),
      ["at", "text", "type"].sort()
    );
  }
);

test(
  "une session DEV expose Problems vide avant toute validation",
  (context) => {
    const data =
      fixture(context);

    const session =
      data.service.createSession({
        workspaceId:
          "workspace-test",
      });

    assert.deepEqual(
      session.problems,
      {
        status: "EMPTY",
        source: null,
        command: null,
        terminalId: null,
        exitCode: null,
        counts: {
          total: 0,
          error: 0,
          warning: 0,
          info: 0,
        },
        truncated: false,
        problems: [],
      }
    );
  }
);

test(
  "Problems passe RUNNING pendant une validation",
  (context) => {
    const data =
      fixture(context);

    const {
      session,
      terminal,
    } =
      createSessionAndTerminal(
        data
      );

    data.service.runCommand({
      sessionId:
        session.id,
      terminalId:
        terminal.id,
      origin: "USER",
      command: "npm test",
    });

    const current =
      data.service.getSession(
        session.id
      );

    assert.equal(
      current.problems.status,
      "RUNNING"
    );

    assert.equal(
      current.problems.source,
      "test"
    );

    assert.equal(
      current.problems.command,
      "npm test"
    );

    assert.equal(
      current.problems
        .terminalId,
      terminal.id
    );

    assert.deepEqual(
      current.problems.counts,
      {
        total: 0,
        error: 0,
        warning: 0,
        info: 0,
      }
    );
  }
);

test(
  "la fin d'une validation publie les Problems structurés",
  (context) => {
    const data =
      fixture(context);

    const {
      session,
      terminal,
    } =
      createSessionAndTerminal(
        data
      );

    data.service.runCommand({
      sessionId:
        session.id,
      terminalId:
        terminal.id,
      origin: "USER",
      command: "npm test",
    });

    const child =
      data.children[0];

    child.stdout.emit(
      "data",
      [
        "not ok 1 - exemple",
        `location: '${session.repositoryRoot}/test/example.test.js:42:3'`,
        "failureType: 'testCodeFailure'",
        "error: 'Expected true but received false'",
        "code: 'ERR_ASSERTION'",
        "",
      ].join("\n")
    );

    child.emit(
      "close",
      1,
      null
    );

    const current =
      data.service.getSession(
        session.id
      );

    assert.equal(
      current.problems.status,
      "READY"
    );

    assert.equal(
      current.problems.exitCode,
      1
    );

    assert.equal(
      current.problems.counts.error,
      1
    );

    assert.equal(
      current.problems.counts.total,
      1
    );

    assert.equal(
      current.problems.problems
        .length,
      1
    );

    assert.equal(
      current.problems.problems[0]
        .file,
      "test/example.test.js"
    );

    assert.equal(
      current.problems.problems[0]
        .line,
      42
    );

    assert.equal(
      current.problems.problems[0]
        .column,
      3
    );

    assert.equal(
      current.problems.problems[0]
        .code,
      "ERR_ASSERTION"
    );

    assert.match(
      current.problems.problems[0]
        .message,
      /Expected true/
    );
  }
);

test(
  "une validation suivante ne reparcourt pas les anciens outputs",
  (context) => {
    const data =
      fixture(context);

    const {
      session,
      terminal,
    } =
      createSessionAndTerminal(
        data
      );

    data.service.runCommand({
      sessionId:
        session.id,
      terminalId:
        terminal.id,
      origin: "USER",
      command: "npm test",
    });

    const firstChild =
      data.children[0];

    firstChild.stderr.emit(
      "data",
      [
        "AssertionError [ERR_ASSERTION]: ancien problème",
        `    at TestContext.<anonymous> (${session.repositoryRoot}/test/old.test.js:19:7)`,
        "",
      ].join("\n")
    );

    firstChild.emit(
      "close",
      1,
      null
    );

    assert.equal(
      data.service.getSession(
        session.id
      ).problems.counts.total,
      1
    );

    data.service.runCommand({
      sessionId:
        session.id,
      terminalId:
        terminal.id,
      origin: "USER",
      command: "npm test",
    });

    const secondChild =
      data.children[1];

    secondChild.stdout.emit(
      "data",
      [
        "1..1",
        "# pass 1",
        "# fail 0",
        "",
      ].join("\n")
    );

    secondChild.emit(
      "close",
      0,
      null
    );

    const current =
      data.service.getSession(
        session.id
      );

    assert.equal(
      current.problems.status,
      "EMPTY"
    );

    assert.equal(
      current.problems.exitCode,
      0
    );

    assert.equal(
      current.problems.counts.total,
      0
    );

    assert.deepEqual(
      current.problems.problems,
      []
    );
  }
);

test(
  "le contrat Problems public n'expose jamais la sortie terminal brute",
  (context) => {
    const data =
      fixture(context);

    const {
      session,
      terminal,
    } =
      createSessionAndTerminal(
        data
      );

    data.service.runCommand({
      sessionId:
        session.id,
      terminalId:
        terminal.id,
      origin: "USER",
      command:
        "npm run lint",
    });

    const child =
      data.children[0];

    child.stderr.emit(
      "data",
      `${session.repositoryRoot}/public/app.js:12\nSyntaxError: boom\n`
    );

    child.emit(
      "close",
      1,
      null
    );

    const problems =
      data.service.getSession(
        session.id
      ).problems;

    assert.equal(
      Object.hasOwn(
        problems,
        "stdout"
      ),
      false
    );

    assert.equal(
      Object.hasOwn(
        problems,
        "stderr"
      ),
      false
    );

    assert.equal(
      Object.hasOwn(
        problems,
        "output"
      ),
      false
    );

    assert.doesNotMatch(
      JSON.stringify(problems),
      /terminal\.output/
    );
  }
);
