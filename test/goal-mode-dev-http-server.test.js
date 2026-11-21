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

function childEnvironment(dataDirectory, { safeMode = true } = {}) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/(_API_KEY|_TOKEN|_SECRET|_PASSWORD)$/.test(key)) continue;
    env[key] = value;
  }
  for (const key of PROVIDER_KEYS) env[key] = "";
  delete env.NOON_UI_VALIDATION;
  const result = { ...env, NOON_DATA_DIR: dataDirectory };
  if (safeMode) result.NOON_SAFE_MODE = "1"; else delete result.NOON_SAFE_MODE;
  return result;
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

async function startChild({ flags, safeMode = true, sharedRoot = null }) {
  const root = sharedRoot || fs.mkdtempSync(path.join(os.tmpdir(), "noon-b2-server-"));
  const dataDirectory = path.join(root, "data");
  const cwd = path.join(root, "cwd");
  fs.mkdirSync(dataDirectory, { recursive: true });
  fs.mkdirSync(cwd, { recursive: true });
  if (flags && !fs.existsSync(path.join(dataDirectory, "runtime-config.json"))) enableFlags(dataDirectory);
  const script = `
    const { startNoonServer, server } = require(${JSON.stringify(SERVER)});
    startNoonServer({ port: 0 }).then(() => {
      // 4C-2 : événements de scan de réconciliation vus juste après le démarrage.
      let events = [];
      try {
        const log = JSON.parse(require("fs").readFileSync(require("path").join(process.env.NOON_DATA_DIR, "tool-audit.json"), "utf8"));
        const list = Array.isArray(log) ? log : (log.entries || log.events || []);
        events = list.filter((item) => /goals\.mode-dev\.(reconcile_scan|RECONCILE_SCAN_SKIPPED_LOCK|lock_takeover)/.test(item.event))
          .map((item) => ({ event: item.event, reason: item.details && item.details.reason, mode: item.details && item.details.mode }));
      } catch {}
      process.stdout.write("NOON_AUDIT=" + JSON.stringify(events) + "\\n");
      process.stdout.write("NOON_PORT=" + server.address().port + "\\n");
    }, (error) => { process.stderr.write(String(error && error.code)); process.exit(2); });
    process.stdin.on("end", () => process.exit(0));
    process.stdin.resume();
  `;
  const child = spawn(process.execPath, ["-e", script], {
    cwd, env: childEnvironment(dataDirectory, { safeMode }), stdio: ["pipe", "pipe", "pipe"],
  });
  let audit = [];
  const port = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("server start timeout")), 60_000);
    child.stdout.on("data", (chunk) => {
      output += chunk;
      const auditMatch = output.match(/NOON_AUDIT=(.*)\n/);
      if (auditMatch) audit = JSON.parse(auditMatch[1]);
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
    dataDirectory, call, audit: () => audit, root, origin,
    async stop({ keep = false } = {}) {
      child.stdin.end();
      await new Promise((resolve) => {
        const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 5_000);
        child.on("exit", () => { clearTimeout(timer); resolve(); });
      });
      if (!keep) fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

test("B2 serveur réel : flag OFF par défaut → toutes les routes Goal Mode DEV en 404", async () => {
  const server = await startChild({ flags: false });
  try {
    // B3a : le module UI est servi (le panneau se masque lui-même si le flag vaut OFF).
    const page = await fetch(`${server.origin}/app`);
    assert.ok((await page.text()).includes('<script src="goal-mode-dev-ui.js"></script>'));
    const script = await fetch(`${server.origin}/goal-mode-dev-ui.js`);
    assert.equal(script.status, 200);
    assert.match(script.headers.get("content-type"), /application\/javascript/);
    assert.match(await script.text(), /NoonGoalModeDevUi/);
    for (const [method, route, body] of [
      ["GET", "/api/goals/mode-dev/runs/goal-run-x"],
      ["GET", "/api/goals/mode-dev/runs"],
      ["GET", "/api/goals/mode-dev/runs/goal-run-x/planning-estimate"],
      ["POST", "/api/goals/mode-dev/runs", {}],
      ["POST", "/api/goals/mode-dev/planning", { runId: "goal-run-x", confirmProviderCall: true }],
      ["POST", "/api/goals/mode-dev/dispatch/resume", {}],
      ["GET", "/api/goals/mode-dev/maintenance/lock"],
      ["POST", "/api/goals/mode-dev/maintenance/lock-takeover", { confirm: true, expectedHolderPid: null }],
      ["POST", "/api/goals/mode-dev/maintenance/reconcile-scan", { confirm: true }],
    ]) {
      const response = await server.call(method, route, body);
      assert.equal(response.status, 404, route);
      assert.equal(response.body?.code, "GOAL_MODE_DEV_DISABLED", route);
      const untrusted = await server.call(method, route, body, { trusted: false });
      assert.equal(untrusted.status, 404, route);
    }
    // B4c : flag OFF → aucun journal de diagnostic du verrou créé.
    assert.equal(fs.existsSync(path.join(server.dataDirectory, "goal-mode-dev-lock-diagnostics.json")), false);
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
    // B3a : liste des runs (vide) et estimation de planning d'un run inconnu, sans fournisseur.
    const runs = await server.call("GET", "/api/goals/mode-dev/runs");
    assert.equal(runs.status, 200, JSON.stringify(runs.body));
    assert.deepEqual(runs.body, { status: "ok", result: { runs: [] } });
    const estimate = await server.call("GET", "/api/goals/mode-dev/runs/goal-run-missing/planning-estimate");
    assert.equal(estimate.status, 404);
    assert.equal(estimate.body.code, "GOAL_MODE_RUN_NOT_FOUND");
    const approvals = await server.call("GET", "/approvals");
    assert.equal(approvals.status, 200);
    assert.deepEqual(approvals.body.approvals, []);
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

test("4C-2 serveur réel : deux processus sur le même DATA_DIRECTORY, un seul scan de réconciliation", async () => {
  const first = await startChild({ flags: true, safeMode: false });
  let second = null;
  try {
    assert.deepEqual(first.audit().map((item) => item.event), ["goals.mode-dev.reconcile_scan"]);
    assert.ok(fs.existsSync(path.join(first.dataDirectory, "noon-data.lock")));
    second = await startChild({ flags: true, safeMode: false, sharedRoot: first.root });
    const skipped = second.audit().filter((item) => item.event === "goals.mode-dev.RECONCILE_SCAN_SKIPPED_LOCK");
    assert.deepEqual(skipped, [{ event: "goals.mode-dev.RECONCILE_SCAN_SKIPPED_LOCK", reason: "HELD" }]);
    // B3b : détenteur vivant sur la même machine → jamais repris, ni au démarrage ni explicitement.
    assert.equal(second.audit().some((item) => item.event === "goals.mode-dev.lock_takeover"), false);
    const lockView = await second.call("GET", "/api/goals/mode-dev/maintenance/lock");
    assert.equal(lockView.body.result.state, "HELD");
    assert.equal(lockView.body.result.canTakeOver, false);
    const refused = await second.call("POST", "/api/goals/mode-dev/maintenance/lock-takeover", {
      confirm: true, expectedHolderPid: lockView.body.result.holderPid,
    });
    assert.equal(refused.status, 409);
    assert.equal(refused.body.code, "GOAL_MODE_DEV_LOCK_HOLDER_ALIVE");
    // B4c : journal de diagnostic dédié (rétention propre), métadonnées seulement.
    const diagnosticsFile = path.join(first.dataDirectory, "goal-mode-dev-lock-diagnostics.json");
    const diagnostics = JSON.parse(fs.readFileSync(diagnosticsFile, "utf8"));
    const acquires = diagnostics.filter((item) => item.event === "goals.mode-dev.lock_acquire").map((item) => item.details);
    assert.deepEqual(acquires.map((item) => [item.reason, item.acquired]), [["ACQUIRED", true], ["HELD", false]]);
    const holderPid = lockView.body.result.holderPid;
    assert.equal(acquires[0].selfPid, holderPid);
    assert.equal(acquires[1].holderPid, holderPid);
    assert.notEqual(acquires[1].selfPid, holderPid);
    const inspected = diagnostics.filter((item) => item.event === "goals.mode-dev.lock_inspect").map((item) => item.details);
    assert.equal(inspected.length, 1); // le premier processus (HELD_BY_THIS) n'a rien journalisé
    assert.equal(inspected[0].state, "HELD");
    assert.equal(inspected[0].holderIsSelf, false);
    assert.equal(inspected[0].tokenPresent, false);
    assert.equal(inspected[0].holderPid, holderPid);
    assert.equal(typeof inspected[0].sinceStartupMs, "number");
    assert.deepEqual(diagnostics.filter((item) => item.event === "goals.mode-dev.lock_takeover_refused").map((item) => item.details),
      [{ reason: "HOLDER_ALIVE" }]);
    const raw = fs.readFileSync(diagnosticsFile, "utf8");
    const lockToken = JSON.parse(fs.readFileSync(path.join(first.dataDirectory, "noon-data.lock"), "utf8")).token;
    for (const secret of [lockToken, os.hostname(), first.dataDirectory]) assert.equal(raw.includes(secret), false);
    await second.stop({ keep: true });
    second = null;
    assert.ok(fs.existsSync(path.join(first.dataDirectory, "noon-data.lock"))); // toujours détenu par le premier
  } finally {
    if (second) await second.stop({ keep: true });
    await first.stop({ keep: true });
    // Arrêt propre du détenteur : verrou libéré.
    assert.equal(fs.existsSync(path.join(first.dataDirectory, "noon-data.lock")), false);
    fs.rmSync(first.root, { recursive: true, force: true });
  }
});

test("B3b serveur réel : verrou périmé sur ce Mac (ESRCH) repris au démarrage puis scan ; autre machine jamais repris", async () => {
  const { spawnSync } = require("node:child_process");
  const deadPid = Number(spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" }).stdout);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noon-b3b-server-"));
  const dataDirectory = path.join(root, "data");
  fs.mkdirSync(dataDirectory, { recursive: true });
  const stale = JSON.stringify({ pid: deadPid, hostname: os.hostname(), token: "stale-token", createdAt: "2026-10-13T12:00:00.000Z" });
  fs.writeFileSync(path.join(dataDirectory, "noon-data.lock"), stale);
  const first = await startChild({ flags: true, safeMode: false, sharedRoot: root });
  let firstEvents = 0;
  try {
    firstEvents = first.audit().length;
    assert.deepEqual(first.audit().map((item) => [item.event, item.mode || null]), [
      ["goals.mode-dev.lock_takeover", "AUTOMATIC"], ["goals.mode-dev.reconcile_scan", null],
    ]);
    const kept = fs.readdirSync(dataDirectory).filter((name) => name.startsWith("noon-data.lock.stale-"));
    assert.equal(kept.length, 1);
    assert.equal(fs.readFileSync(path.join(dataDirectory, kept[0]), "utf8"), stale);
    assert.equal(fs.existsSync(path.join(dataDirectory, "noon-data.lock.takeover")), false);
    const view = await first.call("GET", "/api/goals/mode-dev/maintenance/lock");
    assert.equal(view.body.result.state, "HELD_BY_THIS");
    const scan = await first.call("POST", "/api/goals/mode-dev/maintenance/reconcile-scan", { confirm: true });
    assert.equal(scan.status, 200, JSON.stringify(scan.body));
    assert.deepEqual(scan.body.result, { scanned: 0, reconciled: 0, unknown: 0, unchanged: 0, failed: 0 });
  } finally {
    await first.stop({ keep: true });
  }
  // Verrou d'une autre machine : aucun scan, aucune reprise automatique ; reprise explicite possible.
  const foreign = JSON.stringify({ pid: deadPid, hostname: "synthetic-other-host", token: "foreign-token" });
  fs.writeFileSync(path.join(dataDirectory, "noon-data.lock"), foreign);
  const second = await startChild({ flags: true, safeMode: false, sharedRoot: root });
  let stopped = false;
  try {
    // tool-audit.json est persistant : après les événements du premier démarrage viennent
    // son scan explicite, puis le seul événement du second démarrage (aucune reprise).
    assert.deepEqual(second.audit().slice(firstEvents).map((item) => [item.event, item.reason]),
      [["goals.mode-dev.reconcile_scan", undefined], ["goals.mode-dev.RECONCILE_SCAN_SKIPPED_LOCK", "HELD"]]);
    assert.equal(fs.readFileSync(path.join(dataDirectory, "noon-data.lock"), "utf8"), foreign);
    const view = await second.call("GET", "/api/goals/mode-dev/maintenance/lock");
    assert.equal(view.body.result.state, "FOREIGN_HOST");
    assert.equal(view.body.result.canTakeOver, true);
    const scanRefused = await second.call("POST", "/api/goals/mode-dev/maintenance/reconcile-scan", { confirm: true });
    assert.equal(scanRefused.status, 409);
    const taken = await second.call("POST", "/api/goals/mode-dev/maintenance/lock-takeover", { confirm: true, expectedHolderPid: deadPid });
    assert.equal(taken.status, 200, JSON.stringify(taken.body));
    assert.equal(taken.body.result.reason, "TAKEN_OVER");
    assert.equal(taken.body.result.reconcileRecommended, true);
    assert.equal((await second.call("GET", "/api/goals/mode-dev/maintenance/lock")).body.result.state, "HELD_BY_THIS");
    await second.stop({ keep: true });
    stopped = true;
    assert.equal(fs.existsSync(path.join(dataDirectory, "noon-data.lock")), false); // libéré à l'arrêt
  } finally {
    if (!stopped) await second.stop({ keep: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});
