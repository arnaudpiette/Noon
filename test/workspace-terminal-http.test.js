"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

process.env.NOON_SAFE_MODE = "1";

const {
  server,
  startNoonServer,
  stopNoonServer,
} = require("../server");

const AUTH_SECRET = "noon-terminal-http-test-secret";

let origin;

async function request(route, {
  method = "GET",
  auth = true,
  trusted = true,
  body,
} = {}) {
  const headers = {};

  if (auth) {
    headers["X-Noon-Local-Auth"] =
      AUTH_SECRET;
  }

  if (trusted) {
    headers["X-Noon-Request"] = "1";
  }

  if (body !== undefined) {
    headers["Content-Type"] =
      "application/json";
  }

  const response = await fetch(
    `${origin}${route}`,
    {
      method,
      headers,
      body:
        body === undefined
          ? undefined
          : JSON.stringify(body),
    }
  );

  let payload = null;

  try {
    payload = await response.json();
  } catch {}

  return {
    status: response.status,
    payload,
  };
}

test.before(async () => {
  await startNoonServer({
    port: 0,
    authSecret: AUTH_SECRET,
  });

  const address = server.address();

  assert.ok(address);
  assert.equal(
    typeof address.port,
    "number"
  );

  origin =
    `http://127.0.0.1:${address.port}`;
});

test.after(async () => {
  await stopNoonServer();
});


test(
  "les routes Git Diff réelles exigent l’auth locale",
  async () => {
    const result =
      await request(
        "/api/dev/workspace-terminal/sessions/missing/git-diff",
        {
          auth: false,
          trusted: true,
        }
      );

    assert.equal(
      result.status,
      401
    );
  }
);

test(
  "les routes Git Diff réelles exigent l’UI de confiance",
  async () => {
    const result =
      await request(
        "/api/dev/workspace-terminal/sessions/missing/git-diff",
        {
          auth: true,
          trusted: false,
        }
      );

    assert.equal(
      result.status,
      403
    );

    assert.equal(
      result.payload?.code,
      "TRUSTED_UI_REQUIRED"
    );
  }
);

test(
  "la route inventaire Git Diff atteint réellement la session",
  async () => {
    const result =
      await request(
        "/api/dev/workspace-terminal/sessions/missing/git-diff"
      );

    assert.equal(
      result.status,
      404
    );

    assert.equal(
      result.payload?.code,
      "DEV_WORKSPACE_NOT_FOUND"
    );
  }
);

test(
  "la route fichier Git Diff atteint réellement la session",
  async () => {
    const result =
      await request(
        "/api/dev/workspace-terminal/sessions/missing/git-diff/file?file=tracked.txt&scope=WORKTREE"
      );

    assert.equal(
      result.status,
      404
    );

    assert.equal(
      result.payload?.code,
      "DEV_WORKSPACE_NOT_FOUND"
    );
  }
);

test(
  "les routes terminal exigent l’auth locale",
  async () => {
    const result = await request(
      "/api/dev/workspace-terminal/sessions",
      {
        method: "POST",
        auth: false,
        trusted: true,
        body: {
          workspaceId:
            "workspace-inexistant",
        },
      }
    );

    assert.equal(result.status, 401);

    assert.equal(
      result.payload?.status,
      "error"
    );

    assert.match(
      result.payload?.message || "",
      /Authentification locale requise/i
    );
  }
);

test(
  "les mutations terminal exigent X-Noon-Request",
  async () => {
    const result = await request(
      "/api/dev/workspace-terminal/sessions",
      {
        method: "POST",
        auth: true,
        trusted: false,
        body: {
          workspaceId:
            "workspace-inexistant",
        },
      }
    );

    assert.equal(result.status, 403);

    assert.equal(
      result.payload?.code,
      "TRUSTED_UI_REQUIRED"
    );
  }
);

test(
  "une création de session atteint bien WorkspaceEngine après les deux gardes",
  async () => {
    const result = await request(
      "/api/dev/workspace-terminal/sessions",
      {
        method: "POST",
        body: {
          workspaceId:
            "workspace-http-fixture-inexistant",
        },
      }
    );

    assert.equal(result.status, 400);

    assert.equal(
      result.payload?.status,
      "error"
    );

    assert.equal(
      result.payload?.code,
      "WORKSPACE_NOT_FOUND"
    );
  }
);

test(
  "une session terminal inconnue répond 404",
  async () => {
    const result = await request(
      "/api/dev/workspace-terminal/sessions/dev-workspace-inexistant"
    );

    assert.equal(result.status, 404);

    assert.equal(
      result.payload?.code,
      "DEV_WORKSPACE_NOT_FOUND"
    );
  }
);

test(
  "les routes HTTP ne peuvent jamais créer un terminal NOON",
  () => {
    const source = fs.readFileSync(
      path.join(__dirname, "..", "server.js"),
      "utf8"
    );

    const start = source.indexOf(
      "function requireTrustedDevUi"
    );

    const end = source.indexOf(
      'if (requestPath === "/api/dev/native/tasks"',
      start
    );

    assert.ok(start >= 0);
    assert.ok(end > start);

    const terminalRoutes =
      source.slice(start, end);

    assert.match(
      terminalRoutes,
      /owner:\s*"USER"/
    );

    assert.match(
      terminalRoutes,
      /origin:\s*"USER"/
    );

    assert.doesNotMatch(
      terminalRoutes,
      /owner:\s*body\.owner/
    );

    assert.doesNotMatch(
      terminalRoutes,
      /origin:\s*body\.origin/
    );

    assert.doesNotMatch(
      terminalRoutes,
      /owner:\s*"NOON"/
    );

    assert.doesNotMatch(
      terminalRoutes,
      /origin:\s*"NOON"/
    );
  }
);

test(
  "les six opérations HTTP terminal sont présentes",
  () => {
    const source = fs.readFileSync(
      path.join(__dirname, "..", "server.js"),
      "utf8"
    );

    for (const expected of [
      "/api/dev/workspace-terminal/sessions",
      "/terminals$",
      "/run$",
      "/output$",
      "/close$",
    ]) {
      assert.ok(
        source.includes(expected),
        `route absente : ${expected}`
      );
    }

    assert.match(
      source,
      /devWorkspaceTerminalService\.createSession/
    );

    assert.match(
      source,
      /devWorkspaceTerminalService\.createTerminal/
    );

    assert.match(
      source,
      /devWorkspaceTerminalService\.runCommand/
    );

    assert.match(
      source,
      /devWorkspaceTerminalService\.poll/
    );

    assert.match(
      source,
      /devWorkspaceTerminalService\.closeTerminal/
    );

    assert.match(
      source,
      /devWorkspaceTerminalService\.closeSession/
    );
  }
);

test(
  "la création de session traduit le Focus UI en workspace legacy read-write",
  () => {
    const source = fs.readFileSync(
      path.join(__dirname, "..", "server.js"),
      "utf8"
    );

    const start = source.indexOf(
      'requestPath ===\n    "/api/dev/workspace-terminal/sessions"'
    );

    const end = source.indexOf(
      "const devTerminalSessionRead",
      start
    );

    assert.ok(start >= 0);
    assert.ok(end > start);

    const route = source.slice(start, end);

    assert.match(
      route,
      /workspaceEngine\.ensureLegacy/
    );

    assert.match(
      route,
      /legacyId:\s*focusId/
    );

    assert.match(
      route,
      /mode:\s*"read-write"/
    );

    assert.match(
      route,
      /devWorkspaceTerminalService\.createSession/
    );

    assert.doesNotMatch(
      route,
      /mode:\s*body\./
    );

    assert.doesNotMatch(
      route,
      /workspaceId:\s*body\.workspaceId/
    );
  }
);
