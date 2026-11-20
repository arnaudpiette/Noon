"use strict";

// Garde-fous B2 sur le vrai serveur Noon, dans un processus enfant :
// - cwd temporaire vide : aucun .env n'est chargé par dotenv ;
// - clés de fournisseurs retirées de l'environnement et forcées à vide ;
// - NOON_DATA_DIR temporaire, NOON_SAFE_MODE=1 ;
// - jamais /planning ni resume approve : aucun appel fournisseur possible.

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const SERVER = path.join(__dirname, "..", "server.js");
const PROVIDER_KEYS = ["OPENAI_API_KEY", "GEMINI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY", "MISTRAL_API_KEY", "OPENROUTER_API_KEY"];

function childEnvironment(dataDirectory) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/(_API_KEY|_TOKEN|_SECRET|_PASSWORD)$/.test(key)) continue;
    env[key] = value;
  }
  for (const key of PROVIDER_KEYS) env[key] = "";
  delete env.NOON_UI_VALIDATION;
  return { ...env, NOON_DATA_DIR: dataDirectory, NOON_SAFE_MODE: "1" };
}

function enableFlags(dataDirectory) {
  const flag = { mode: "LIMITED", percentage: 100 };
  fs.writeFileSync(path.join(dataDirectory, "runtime-config.json"), JSON.stringify({
    schemaVersion: 1, configVersion: 1,
    layers: { BUILD: {}, MACHINE: {}, USER: {}, WORKSPACE: {}, SESSION: {}, TEST: {} },
    flags: { "goals.engine": flag, "dev.native-core": flag, "goals.mode-dev": flag },
    killSwitches: {}, updatedAt: "2026-11-20T00:00:00.000Z",
  }));
}

async function startChild({ flags }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noon-b2-server-"));
  const dataDirectory = path.join(root, "data");
  const cwd = path.join(root, "cwd");
  fs.mkdirSync(dataDirectory);
  fs.mkdirSync(cwd);
  if (flags) enableFlags(dataDirectory);
  const script = `
    const { startNoonServer, server } = require(${JSON.stringify(SERVER)});
    startNoonServer({ port: 0 }).then(() => {
      process.stdout.write("NOON_PORT=" + server.address().port + "\\n");
    }, (error) => { process.stderr.write(String(error && error.code)); process.exit(2); });
    process.stdin.on("end", () => process.exit(0));
    process.stdin.resume();
  `;
  const child = spawn(process.execPath, ["-e", script], {
    cwd, env: childEnvironment(dataDirectory), stdio: ["pipe", "pipe", "pipe"],
  });
  const port = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("server start timeout")), 60_000);
    child.stdout.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/NOON_PORT=(\d+)/);
      if (match) { clearTimeout(timer); resolve(Number(match[1])); }
    });
    child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`server exited ${code}`)); });
  });
  const origin = `http://127.0.0.1:${port}`;
  async function call(method, route, body, { trusted = true } = {}) {
    const response = await fetch(`${origin}${route}`, {
      method,
      headers: { "Content-Type": "application/json", ...(trusted ? { "x-noon-request": "1" } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json = null;
    try { json = await response.json(); } catch { json = null; }
    return { status: response.status, body: json };
  }
  return {
    dataDirectory, call,
    async stop() {
      child.stdin.end();
      await new Promise((resolve) => {
        const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 5_000);
        child.on("exit", () => { clearTimeout(timer); resolve(); });
      });
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

test("B2 serveur réel : flag OFF par défaut → toutes les routes Goal Mode DEV en 404", async () => {
  const server = await startChild({ flags: false });
  try {
    for (const [method, route, body] of [
      ["GET", "/api/goals/mode-dev/runs/goal-run-x"],
      ["POST", "/api/goals/mode-dev/runs", {}],
      ["POST", "/api/goals/mode-dev/planning", { runId: "goal-run-x", confirmProviderCall: true }],
      ["POST", "/api/goals/mode-dev/dispatch/resume", {}],
    ]) {
      const response = await server.call(method, route, body);
      assert.equal(response.status, 404, route);
      assert.equal(response.body?.code, "GOAL_MODE_DEV_DISABLED", route);
      const untrusted = await server.call(method, route, body, { trusted: false });
      assert.equal(untrusted.status, 404, route);
    }
  } finally { await server.stop(); }
});

test("B2 serveur réel : flag actif → runtime composé, routes avant /api/goals, garde-fous, LOCAL_ONLY", async () => {
  const server = await startChild({ flags: true });
  try {
    // Runtime composé et aiguillage avant le GET /api/goals générique.
    const missing = await server.call("GET", "/api/goals/mode-dev/runs/goal-run-missing");
    assert.equal(missing.status, 404, JSON.stringify(missing.body));
    assert.equal(missing.body.code, "GOAL_MODE_RUN_NOT_FOUND");
    const untrusted = await server.call("GET", "/api/goals/mode-dev/runs/goal-run-missing", undefined, { trusted: false });
    assert.equal(untrusted.status, 403);
    assert.equal(untrusted.body.code, "TRUSTED_UI_REQUIRED");
    // POST non capturé par le bloc POST /api/goals/* générique.
    const unknownRoute = await server.call("POST", "/api/goals/mode-dev/unknown", {});
    assert.equal(unknownRoute.status, 404);
    assert.equal(unknownRoute.body.code, "GOAL_MODE_DEV_ROUTE_NOT_FOUND");
    const limits = { maxSteps: 2, maxRetries: 0, maxProviderCalls: 2, maxDuration: 600_000, maxEstimatedCost: 1 };
    const injected = await server.call("POST", "/api/goals/mode-dev/runs", {
      goalId: "goal-x", workspaceId: "w-x", projectId: "p-x", userConfirmed: true, limits, taskId: "goal-mode-dev-x",
    });
    assert.equal(injected.status, 400);
    assert.equal(injected.body.code, "GOAL_MODE_DEV_HTTP_BODY_INVALID");
    const unknownGoal = await server.call("POST", "/api/goals/mode-dev/runs", {
      goalId: "goal-unknown", workspaceId: "w-x", projectId: "p-x", userConfirmed: true, limits,
    });
    assert.equal(unknownGoal.status, 404);
    assert.equal(unknownGoal.body.code, "GOAL_MODE_DEV_GOAL_NOT_FOUND");
    // Goal LOCAL_ONLY créé par l'API existante : refus avant toute création de run.
    const created = await server.call("POST", "/api/goals/create", {
      title: "Goal local", outcomeDefinition: "Rester local.", sensitivity: "LOCAL_ONLY",
      successCriteria: [{ criterionId: "c-1", description: "Local.", type: "BOOLEAN", targetValue: true }],
    });
    assert.ok([200, 201].includes(created.status), JSON.stringify(created.body));
    const goalId = created.body.result.goalId;
    const localOnly = await server.call("POST", "/api/goals/mode-dev/runs", {
      goalId, workspaceId: "w-x", projectId: "p-x", userConfirmed: true, limits,
    });
    assert.equal(localOnly.status, 422);
    assert.equal(localOnly.body.code, "GOAL_MODE_DEV_LOCAL_ONLY_REQUIRED");
    assert.deepEqual(Object.keys(localOnly.body).sort(), ["code", "message", "status"]);
  } finally { await server.stop(); }
});
