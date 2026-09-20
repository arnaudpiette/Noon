"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createBenchmarkControlPlane } = require("../services/dev/benchmark/benchmark-control-plane");
const { executeBenchmarkControlCommand, parseBenchmarkControlCommand, publicCommandError } = require("../electron/benchmark-control-client");

const SECRET = "synthetic-local-secret";
const jsonResponse = (payload, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => payload });

test("B10 suite utilise l'auth locale et la route canonique", async () => {
  let observed;
  const result = await executeBenchmarkControlCommand(parseBenchmarkControlCommand(["Noon", "--benchmark-control", "suite"]), {
    loadAuthSecret: () => SECRET,
    fetchImpl: async (url, options) => { observed = { url, options }; return jsonResponse({ status: "ok", suite: { suiteVersion: "benchmark-suite-v1", plan: Array(8) } }); },
  });
  assert.equal(observed.url, "http://127.0.0.1:3000/api/dev/benchmark/suite");
  assert.equal(observed.options.headers["X-Noon-Local-Auth"], SECRET);
  assert.equal(result.response.suite.plan.length, 8);
});

test("B10 expose uniquement l'allowlist benchmark fixe", () => {
  for (const operation of ["suite", "arm", "prepare", "status", "results", "run-next", "cancel", "codex-probe-arm", "codex-probe-prepare", "codex-probe-run"]) assert.ok(parseBenchmarkControlCommand(["Noon", "--benchmark-control", operation, ...["prepare", "codex-probe-prepare"].includes(operation) ? ["--arm-id", "arm-A"] : ["status", "results", "run-next", "cancel", "codex-probe-run"].includes(operation) ? ["--session-id", "session-A"] : []]));
});

test("B10 rejette chemin, URL et options arbitraires avant fetch", async () => {
  for (const args of [["fetch", "/api/private/anything"], ["suite", "--url=https://example.com"], ["arm", "--cap=999"]]) assert.throws(() => parseBenchmarkControlCommand(["Noon", "--benchmark-control", ...args]), (error) => error.code === "BENCHMARK_COMMAND_INVALID");
});

test("B10 expurge le secret des sorties serveur", async () => {
  const result = await executeBenchmarkControlCommand({ operation: "suite" }, { loadAuthSecret: () => SECRET, fetchImpl: async () => jsonResponse({ status: "ok", detail: `value:${SECRET}` }) });
  assert.equal(JSON.stringify(result).includes(SECRET), false); assert.match(result.response.detail, /REDACTED/);
});

test("B10 runtime indisponible échoue fermé sans second serveur", async () => {
  await assert.rejects(executeBenchmarkControlCommand({ operation: "suite" }, { loadAuthSecret: () => SECRET, fetchImpl: async () => { throw new Error("ECONNREFUSED"); } }), (error) => error.code === "NOON_RUNTIME_UNAVAILABLE");
});

function routedFixture(allowed = "session-A", denial = null) {
  const calls = [];
  const runtime = { repository: {}, service: { runNext: async (id) => { calls.push(id); if (denial) throw Object.assign(new Error("denied"), { code: "BENCHMARK_EXECUTION_DENIED", reason: denial }); return { id, state: "PASS" }; } } };
  const control = createBenchmarkControlPlane({ runtime, featureMode: ({ sessionId }) => sessionId === allowed ? "LIMITED" : "OFF" });
  const fetchImpl = async (url) => { const id = decodeURIComponent(new URL(url).pathname.split("/").at(-1)); try { return jsonResponse({ status: "ok", result: await control.execute("runNext", { sessionId: id }) }); } catch (error) { return jsonResponse({ status: "error", code: error.code, reason: error.reason }, error.code === "FEATURE_DISABLED" ? 409 : 400); } };
  return { calls, fetchImpl };
}

test("B10 session correcte traverse le client et atteint le seam B8/B3", async () => {
  const f = routedFixture(); await executeBenchmarkControlCommand({ operation: "run-next", sessionId: "session-A" }, { loadAuthSecret: () => SECRET, fetchImpl: f.fetchImpl }); assert.deepEqual(f.calls, ["session-A"]);
});

test("B10 mauvaise session est refusée avant le participant", async () => {
  const f = routedFixture(); await assert.rejects(executeBenchmarkControlCommand({ operation: "run-next", sessionId: "session-B" }, { loadAuthSecret: () => SECRET, fetchImpl: f.fetchImpl }), (error) => error.code === "FEATURE_DISABLED"); assert.deepEqual(f.calls, []);
});

test("B10 refus B3 workspace reste autoritaire", async () => {
  const f = routedFixture("session-A", "WORKSPACE_NOT_ALLOWED"); await assert.rejects(executeBenchmarkControlCommand({ operation: "run-next", sessionId: "session-A" }, { loadAuthSecret: () => SECRET, fetchImpl: f.fetchImpl }), (error) => error.code === "BENCHMARK_EXECUTION_DENIED"); assert.deepEqual(f.calls, ["session-A"]);
});

test("B10 refus B3 participant reste autoritaire", async () => {
  const f = routedFixture("session-A", "NATIVE_NOT_ALLOWED"); await assert.rejects(executeBenchmarkControlCommand({ operation: "run-next", sessionId: "session-A" }, { loadAuthSecret: () => SECRET, fetchImpl: f.fetchImpl }), (error) => error.code === "BENCHMARK_EXECUTION_DENIED"); assert.deepEqual(f.calls, ["session-A"]);
});

test("B10 échec d'authentification ne tente aucune requête", async () => {
  let fetchCalls = 0; await assert.rejects(executeBenchmarkControlCommand({ operation: "suite" }, { loadAuthSecret: () => { throw new Error(`secret:${SECRET}`); }, fetchImpl: async () => { fetchCalls += 1; } }), (error) => error.code === "NOON_AUTH_UNAVAILABLE" && !JSON.stringify(publicCommandError(error)).includes(SECRET)); assert.equal(fetchCalls, 0);
});
