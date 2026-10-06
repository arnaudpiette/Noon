"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  createDevWorkspaceTerminalService,
  sanitizedTerminalEnvironment,
} = require("../services/dev/workspace-terminal-service");

function fakeChild(pid = 4242) {
  const child = new EventEmitter();

  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = pid;
  child.killed = false;
  child.lastSignal = null;

  child.kill = (signal = "SIGTERM") => {
    child.killed = true;
    child.lastSignal = signal;
    return true;
  };

  return child;
}

function fixture(context, {
  mode = "read-write",
  now = () => Date.now(),
} = {}) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "noon-terminal-root-")
  );

  const foreignRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "noon-terminal-foreign-")
  );

  context.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(foreignRoot, { recursive: true, force: true });
  });

  const spawnCalls = [];
  const policyCalls = [];
  const children = [];

  const workspaceEngine = {
    context(workspaceId) {
      assert.equal(workspaceId, "workspace-test");

      return {
        workspaceId: "workspace-test",
        displayName: "Workspace Test",
        activeProject: {
          id: "project-test",
          name: "Projet Test",
        },
        roots: [
          {
            path: root,
            mode,
          },
        ],
      };
    },
  };

  const operationalSecurityPolicy = {
    evaluate(input) {
      policyCalls.push(input);

      return {
        outcome: "ALLOW",
        requiredApproval: false,
      };
    },
  };

  const spawnProcess = (executable, args, options) => {
    const child = fakeChild(4000 + children.length);

    children.push(child);

    spawnCalls.push({
      executable,
      args,
      options,
      child,
    });

    return child;
  };

  const service = createDevWorkspaceTerminalService({
    workspaceEngine,
    operationalSecurityPolicy,
    spawnProcess,
    now,
    environment: {
      PATH: process.env.PATH || "/usr/bin:/bin",
      HOME: "/Users/test",
      LANG: "fr_FR.UTF-8",
      TERM: "xterm-256color",

      // Ces secrets ne doivent jamais être transmis au child.
      OPENAI_API_KEY: "sk-proj-secret-value-123456789",
      GOOGLE_CLIENT_SECRET: "private-google-secret",
      GITHUB_TOKEN: "ghp_private-token-value",
    },
  });

  return {
    root,
    foreignRoot,
    service,
    spawnCalls,
    policyCalls,
    children,
  };
}

function createSessionAndTerminal(
  data,
  { owner = "USER" } = {}
) {
  const session = data.service.createSession({
    workspaceId: "workspace-test",
  });

  const terminal = data.service.createTerminal({
    sessionId: session.id,
    owner,
  });

  return {
    session,
    terminal,
  };
}

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

test("un terminal NOON accepte une commande explicitement NOON", (context) => {
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
    data.spawnCalls[0].executable,
    "git"
  );

  assert.deepEqual(
    data.spawnCalls[0].args,
    ["diff", "--check"]
  );
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

test("une validation Noon annulée par l’utilisateur ne devient jamais UNRESOLVED", (context) => {
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
  const current = data.service.getSession(session.id);
  assert.equal(current.problems.status, "CANCELLED");
  assert.equal(current.lastValidationState.status, "CANCELLED");
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


test(
  "une validation plus ancienne ne remplace pas Problems d'une validation plus récente",
  (context) => {
    const data =
      fixture(context);

    const session =
      data.service.createSession({
        workspaceId:
          "workspace-test",
      });

    const olderTerminal =
      data.service.createTerminal({
        sessionId:
          session.id,
      });

    const newerTerminal =
      data.service.createTerminal({
        sessionId:
          session.id,
      });

    data.service.runCommand({
      sessionId:
        session.id,
      terminalId:
        olderTerminal.id,
      origin: "USER",
      command: "npm test",
    });

    const olderChild =
      data.children[0];

    data.service.runCommand({
      sessionId:
        session.id,
      terminalId:
        newerTerminal.id,
      origin: "USER",
      command:
        "npm run lint",
    });

    const newerChild =
      data.children[1];

    let current =
      data.service.getSession(
        session.id
      );

    assert.equal(
      current.problems.status,
      "RUNNING"
    );

    assert.equal(
      current.problems.terminalId,
      newerTerminal.id
    );

    assert.equal(
      current.problems.source,
      "lint"
    );

    olderChild.stderr.emit(
      "data",
      [
        "AssertionError [ERR_ASSERTION]: ancien problème",
        `    at TestContext.<anonymous> (${session.repositoryRoot}/test/old.test.js:19:7)`,
        "",
      ].join("\n")
    );

    olderChild.emit(
      "close",
      1,
      null
    );

    current =
      data.service.getSession(
        session.id
      );

    assert.equal(
      current.problems.status,
      "RUNNING"
    );

    assert.equal(
      current.problems.terminalId,
      newerTerminal.id
    );

    assert.equal(
      current.problems.source,
      "lint"
    );

    assert.equal(
      current.problems.counts.total,
      0
    );

    newerChild.stderr.emit(
      "data",
      [
        `${session.repositoryRoot}/src/new.js:12`,
        "SyntaxError: problème récent",
        "",
      ].join("\n")
    );

    newerChild.emit(
      "close",
      1,
      null
    );

    current =
      data.service.getSession(
        session.id
      );

    assert.equal(
      current.problems.status,
      "READY"
    );

    assert.equal(
      current.problems.terminalId,
      newerTerminal.id
    );

    assert.equal(
      current.problems.source,
      "lint"
    );

    assert.equal(
      current.problems.counts.total,
      1
    );

    assert.equal(
      current.problems.problems[0]
        .file,
      "src/new.js"
    );

    assert.doesNotMatch(
      JSON.stringify(
        current.problems
      ),
      /old\.test\.js/
    );
  }
);



// TERMINAL COMPLETION #5.4D

test(
  "Terminal #5.4D propose les vrais scripts package.json sans lancer de process",
  (context) => {
    const data =
      fixture(context);

    fs.writeFileSync(
      path.join(
        data.root,
        "package.json"
      ),
      JSON.stringify({
        scripts: {
          dev: "vite",
          build: "vite build",
          lint: "eslint .",
          test: "node --test",
        },
      })
    );

    const session =
      data.service.createSession({
        workspaceId:
          "workspace-test",
      });

    const result =
      data.service.getCompletions({
        sessionId:
          session.id,
        query:
          "npm run d",
      });

    assert.deepEqual(
      result.completions,
      [
        "npm run dev",
      ]
    );

    assert.equal(
      data.spawnCalls.length,
      0
    );
  }
);

test(
  "Terminal #5.4D complète fichiers et dossiers uniquement dans le repositoryRoot",
  (context) => {
    const data =
      fixture(context);

    fs.mkdirSync(
      path.join(
        data.root,
        "src",
        "components"
      ),
      {
        recursive: true,
      }
    );

    fs.writeFileSync(
      path.join(
        data.root,
        "src",
        "index.js"
      ),
      "module.exports = {};\n"
    );

    const session =
      data.service.createSession({
        workspaceId:
          "workspace-test",
      });

    const result =
      data.service.getCompletions({
        sessionId:
          session.id,
        query:
          "src/",
      });

    assert.ok(
      result.completions.includes(
        "src/components/"
      )
    );

    assert.ok(
      result.completions.includes(
        "src/index.js"
      )
    );

    const cdResult =
      data.service.getCompletions({
        sessionId:
          session.id,
        query:
          "cd s",
      });

    assert.ok(
      cdResult.completions.includes(
        "cd src/"
      )
    );

    assert.equal(
      data.spawnCalls.length,
      0
    );
  }
);

test(
  "Terminal #5.4D exclut métadonnées, dépendances et fichiers sensibles",
  (context) => {
    const data =
      fixture(context);

    fs.mkdirSync(
      path.join(
        data.root,
        ".git"
      )
    );

    fs.mkdirSync(
      path.join(
        data.root,
        "node_modules"
      )
    );

    fs.writeFileSync(
      path.join(
        data.root,
        ".env"
      ),
      "SECRET=value\n"
    );

    fs.writeFileSync(
      path.join(
        data.root,
        "token.pem"
      ),
      "secret\n"
    );

    fs.mkdirSync(
      path.join(
        data.root,
        "src"
      )
    );

    const session =
      data.service.createSession({
        workspaceId:
          "workspace-test",
      });

    const result =
      data.service.getCompletions({
        sessionId:
          session.id,
        query:
          "./",
      });

    const serialized =
      JSON.stringify(
        result.completions
      );

    assert.doesNotMatch(
      serialized,
      /\.git/
    );

    assert.doesNotMatch(
      serialized,
      /node_modules/
    );

    assert.doesNotMatch(
      serialized,
      /\.env/
    );

    assert.doesNotMatch(
      serialized,
      /token\.pem/
    );

    assert.match(
      serialized,
      /src\//
    );
  }
);

test(
  "Terminal #5.4D refuse traversée parent et symlink sortant du repo",
  (context) => {
    const data =
      fixture(context);

    fs.mkdirSync(
      path.join(
        data.foreignRoot,
        "private"
      )
    );

    fs.symlinkSync(
      data.foreignRoot,
      path.join(
        data.root,
        "escape"
      )
    );

    fs.mkdirSync(
      path.join(
        data.root,
        "safe"
      )
    );

    const session =
      data.service.createSession({
        workspaceId:
          "workspace-test",
      });

    const traversal =
      data.service.getCompletions({
        sessionId:
          session.id,
        query:
          "cd ../",
      });

    assert.deepEqual(
      traversal.completions,
      []
    );

    const rootResult =
      data.service.getCompletions({
        sessionId:
          session.id,
        query:
          "./",
      });

    assert.ok(
      rootResult.completions.includes(
        "./safe/"
      )
    );

    assert.equal(
      rootResult.completions.some(
        (item) =>
          item.includes("escape")
      ),
      false
    );

    assert.equal(
      data.spawnCalls.length,
      0
    );
  }
);

/* NATIVE_UI_SERVER_AUTH_REGRESSIONS */

test("autorisation Native : commande terminée, exacte et à usage unique", (t) => {
  const f = fixture(t);
  const { session, terminal } = createSessionAndTerminal(f);

  const claim = (command = "npm test") =>
    f.service.claimAuthorizedValidation({
      sessionId: session.id,
      command,
    });

  assert.equal(claim(), false);

  f.service.runCommand({
    sessionId: session.id,
    terminalId: terminal.id,
    origin: "USER",
    command: "npm test",
  });

  assert.equal(claim(), false);

  f.children.at(-1).emit("close", 0, null);

  assert.equal(claim("npm run build"), false);
  assert.equal(claim(), true);
  assert.equal(claim(), false);
});

test("autorisation Native : FAIL légitime, signal refusé", (t) => {
  const f = fixture(t);
  const { session, terminal } = createSessionAndTerminal(f);

  const claim = () =>
    f.service.claimAuthorizedValidation({
      sessionId: session.id,
      command: "npm test",
    });

  f.service.runCommand({
    sessionId: session.id,
    terminalId: terminal.id,
    origin: "USER",
    command: "npm test",
  });

  f.children.at(-1).emit("close", 1, null);
  assert.equal(claim(), true);

  f.service.runCommand({
    sessionId: session.id,
    terminalId: terminal.id,
    origin: "USER",
    command: "npm test",
  });

  f.children.at(-1).emit("close", null, "SIGTERM");
  assert.equal(claim(), false);
});

test("autorisation Native : expiration et origine NOON refusées", (t) => {
  let clock = Date.parse("2026-10-06T08:00:00.000Z");
  const f = fixture(t, { now: () => clock });
  const { session, terminal } = createSessionAndTerminal(f);

  const claim = () =>
    f.service.claimAuthorizedValidation({
      sessionId: session.id,
      command: "npm test",
    });

  f.service.runCommand({
    sessionId: session.id,
    terminalId: terminal.id,
    origin: "USER",
    command: "npm test",
  });

  f.children.at(-1).emit("close", 0, null);

  clock += 31 * 60_000;
  assert.equal(claim(), false);

  const noon = f.service.createTerminal({
    sessionId: session.id,
    owner: "NOON",
  });

  f.service.runCommand({
    sessionId: session.id,
    terminalId: noon.id,
    origin: "NOON",
    command: "npm test",
  });

  f.children.at(-1).emit("close", 0, null);
  assert.equal(claim(), false);
});

/* NATIVE_UI_SERVER_AUTH_REGRESSIONS_END */
