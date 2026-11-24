"use strict";

// Shared setup for test/workspace-terminal-service*.test.js (moved verbatim from test/workspace-terminal-service.test.js, V3-L7).

const assert = require("node:assert/strict");

const { EventEmitter } = require("node:events");

const fs = require("node:fs");

const os = require("node:os");

const path = require("node:path");

const {
  createDevWorkspaceTerminalService,
  sanitizedTerminalEnvironment,
} = require("../../services/dev/workspace-terminal-service");

const {
  createSandboxExecutionContractV1,
} = require("../../services/security/dev-process-runner");

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
  serviceOptions = {},
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
    ...serviceOptions,
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

module.exports = {
  createSandboxExecutionContractV1,
  createSessionAndTerminal,
  fixture,
  sanitizedTerminalEnvironment,
};
