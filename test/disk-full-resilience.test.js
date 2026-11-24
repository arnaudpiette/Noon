"use strict";

// Incident disque plein (2026-11-24) : une écriture impossible ne doit ni bloquer une requête
// (réponse 500 explicite), ni faire échouer l'action qui s'audite, ni tronquer les traces.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createAuditLog } = require("../services/security/audit-log");
const { createNoonObservability } = require("../services/observability/noon-observability");
const { DEPENDENCIES, createNoonHttpServer } = require("../services/http/noon-http-server");
const { NOT_HANDLED } = require("../services/http/route-result");

function temporaryDirectory(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("audit : un échec d'écriture est compté et signalé une fois par code, sans exception", () => {
  const directory = temporaryDirectory("noon-audit-fail-");
  const blocker = path.join(directory, "fichier");
  fs.writeFileSync(blocker, "");
  const warnings = [];
  // Le dossier parent est un fichier : mkdirSync échoue (ENOTDIR/EEXIST), comme un disque plein.
  const audit = createAuditLog(path.join(blocker, "tool-audit.json"), 500, { warn: (message) => warnings.push(message) });
  assert.equal(audit.append("action.sensible", { token: "sk-secret" }), false);
  assert.equal(audit.append("action.sensible", {}), false);
  const health = audit.health();
  assert.equal(health.failures, 2);
  assert.match(health.lastErrorCode, /^E[A-Z]+$/);
  assert.equal(typeof health.lastFailureAt, "string");
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].includes("sk-secret"), false);
});

test("audit : écriture normale inchangée, sans fichier temporaire résiduel", () => {
  const directory = temporaryDirectory("noon-audit-ok-");
  const filePath = path.join(directory, "tool-audit.json");
  const audit = createAuditLog(filePath, 2);
  assert.equal(audit.append("a"), true);
  assert.equal(audit.append("b"), true);
  assert.equal(audit.append("c"), true);
  assert.deepEqual(audit.read().map((entry) => entry.event), ["b", "c"]);
  assert.equal(fs.existsSync(`${filePath}.tmp`), false);
  assert.deepEqual(audit.health(), { failures: 0, lastErrorCode: null, lastFailureAt: null });
});

test("observabilité : une purge de démarrage impossible laisse le fichier de traces intact", async () => {
  const directory = temporaryDirectory("noon-observability-fail-");
  const filePath = path.join(directory, "noon-observability.jsonl");
  const old = JSON.stringify({ executionId: "exec_ancienne", startedAt: "2000-01-01T00:00:00.000Z" });
  const recent = JSON.stringify({ executionId: "exec_recente", startedAt: new Date().toISOString() });
  const original = `${old}\n${recent}\n`;
  fs.writeFileSync(filePath, original);
  fs.mkdirSync(`${filePath}.tmp`); // écriture du fichier temporaire impossible
  const metrics = createNoonObservability({ filePath });
  await metrics.flush();
  assert.equal(fs.readFileSync(filePath, "utf8"), original);
});

test("observabilité : la purge de démarrage réussie reste appliquée, par renommage", async () => {
  const directory = temporaryDirectory("noon-observability-ok-");
  const filePath = path.join(directory, "noon-observability.jsonl");
  const old = JSON.stringify({ executionId: "exec_ancienne", startedAt: "2000-01-01T00:00:00.000Z" });
  const recent = JSON.stringify({ executionId: "exec_recente", startedAt: new Date().toISOString() });
  fs.writeFileSync(filePath, `${old}\n${recent}\n`);
  const metrics = createNoonObservability({ filePath });
  await metrics.flush();
  assert.equal(fs.readFileSync(filePath, "utf8"), `${recent}\n`);
  assert.equal(fs.existsSync(`${filePath}.tmp`), false);
});

function serverWithRoute(route) {
  const inert = async () => NOT_HANDLED;
  const deps = Object.fromEntries(DEPENDENCIES.map((name) => [name, name.endsWith("HttpRoutes") ? inert : {}]));
  Object.assign(deps, {
    http, NOT_HANDLED, UI_VALIDATION_MODE: false, isUiValidationExternalRequest: () => false,
    staticAssets: { matches: () => false },
    figmaBridgeHttpRoutes: { matches: () => false },
    memoryHttpRoutes: { matches: () => false },
    workspaceHttpRoutes: route,
  });
  return createNoonHttpServer(deps).server;
}

async function request(server, requestPath) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}${requestPath}`, {
      headers: { "x-noon-local-auth": process.env.NOON_LOCAL_AUTH_SECRET || "" },
      signal: AbortSignal.timeout(5000),
    });
    return { status: response.status, body: await response.json(), cache: response.headers.get("cache-control") };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("serveur HTTP : une exception de route donne une réponse 500 au lieu d'une requête bloquée", async () => {
  const errors = [];
  const original = console.error;
  console.error = (message) => errors.push(String(message));
  try {
    const server = serverWithRoute(async () => {
      throw Object.assign(new Error("ENOSPC: no space left on device, write '/secret/path'"), { code: "ENOSPC" });
    });
    const result = await request(server, "/control-center/state");
    assert.equal(result.status, 500);
    assert.equal(result.cache, "no-store");
    assert.deepEqual(result.body, { status: "error", code: "INTERNAL_ERROR", message: "Erreur interne de Noon." });
  } finally {
    console.error = original;
  }
  assert.equal(errors.length, 1);
  assert.match(errors[0], /GET \/control-center\/state \(ENOSPC\)/);
  assert.equal(errors[0].includes("/secret/path"), false);
});

test("serveur HTTP : une route sans erreur et une route inconnue restent inchangées", async () => {
  const ok = serverWithRoute(async (req, res, requestPath) => {
    if (requestPath !== "/ok") return NOT_HANDLED;
    res.writeHead(200);
    return res.end(JSON.stringify({ status: "ok" }));
  });
  assert.deepEqual((await request(ok, "/ok")).body, { status: "ok" });
  const unknown = serverWithRoute(async () => NOT_HANDLED);
  const result = await request(unknown, "/inconnue");
  assert.equal(result.status, 404);
  assert.equal(result.body.message, "Route inconnue.");
});
