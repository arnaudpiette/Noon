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

function fixture(context, { mode = "read-write" } = {}) {
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
