"use strict";

const LOOPBACK_ORIGIN = "http://127.0.0.1:3000";
const IDENTIFIER = /^[A-Za-z0-9_-]{1,160}$/;
const OPERATIONS = Object.freeze({
  suite: { method: "GET", path: () => "/api/dev/benchmark/suite" },
  arm: { method: "POST", path: () => "/api/dev/benchmark/arm", body: () => ({}) },
  prepare: { method: "POST", path: ({ armId }) => `/api/dev/benchmark/prepare`, body: ({ armId }) => ({ armId }) },
  status: { method: "GET", path: ({ sessionId }) => `/api/dev/benchmark/status/${encodeURIComponent(sessionId)}` },
  results: { method: "GET", path: ({ sessionId }) => `/api/dev/benchmark/results/${encodeURIComponent(sessionId)}` },
  "run-next": { method: "POST", path: ({ sessionId }) => `/api/dev/benchmark/run-next/${encodeURIComponent(sessionId)}`, body: () => ({}) },
  cancel: { method: "POST", path: ({ sessionId }) => `/api/dev/benchmark/cancel/${encodeURIComponent(sessionId)}`, body: () => ({}) },
  "codex-probe-arm": { method: "POST", path: () => "/api/dev/benchmark/codex-probe/arm", body: () => ({}) },
  "codex-probe-prepare": { method: "POST", path: () => "/api/dev/benchmark/codex-probe/prepare", body: ({ armId }) => ({ armId }) },
  "codex-probe-run": { method: "POST", path: ({ sessionId }) => `/api/dev/benchmark/codex-probe/run/${encodeURIComponent(sessionId)}`, body: () => ({}) },
});

function commandError(code) {
  return Object.assign(new Error(code), { code });
}

function readOption(args, name) {
  const exact = `--${name}`;
  const inline = `${exact}=`;
  const index = args.findIndex((value) => value === exact || value.startsWith(inline));
  if (index < 0) return { value: null, consumed: [] };
  if (args[index].startsWith(inline)) return { value: args[index].slice(inline.length), consumed: [index] };
  return { value: args[index + 1] || null, consumed: [index, index + 1] };
}

function parseBenchmarkControlCommand(argv = []) {
  const marker = argv.indexOf("--benchmark-control");
  if (marker < 0) return null;
  const args = argv.slice(marker + 1);
  const operation = String(args[0] || "");
  if (!Object.hasOwn(OPERATIONS, operation)) throw commandError("BENCHMARK_COMMAND_INVALID");
  const arm = readOption(args.slice(1), "arm-id");
  const session = readOption(args.slice(1), "session-id");
  const consumed = new Set([0, ...arm.consumed.map((index) => index + 1), ...session.consumed.map((index) => index + 1)]);
  if (args.some((_value, index) => !consumed.has(index))) throw commandError("BENCHMARK_COMMAND_INVALID");
  const needsArm = ["prepare", "codex-probe-prepare"].includes(operation);
  const needsSession = ["status", "results", "run-next", "cancel", "codex-probe-run"].includes(operation);
  if (needsArm !== Boolean(arm.value) || needsSession !== Boolean(session.value)) throw commandError("BENCHMARK_COMMAND_INVALID");
  if (arm.value && !IDENTIFIER.test(arm.value)) throw commandError("BENCHMARK_COMMAND_INVALID");
  if (session.value && !IDENTIFIER.test(session.value)) throw commandError("BENCHMARK_COMMAND_INVALID");
  return { operation, armId: arm.value, sessionId: session.value };
}

function redact(value, secret) {
  if (typeof value === "string") return secret ? value.split(secret).join("[REDACTED]") : value;
  if (Array.isArray(value)) return value.map((item) => redact(item, secret));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redact(item, secret)]));
  return value;
}

async function executeBenchmarkControlCommand(command, { loadAuthSecret, fetchImpl = fetch } = {}) {
  if (!command || !Object.hasOwn(OPERATIONS, command.operation)) throw commandError("BENCHMARK_COMMAND_INVALID");
  let secret;
  try { secret = await loadAuthSecret?.(); }
  catch { throw commandError("NOON_AUTH_UNAVAILABLE"); }
  if (typeof secret !== "string" || !secret) throw commandError("NOON_AUTH_UNAVAILABLE");
  const definition = OPERATIONS[command.operation];
  let response;
  try {
    response = await fetchImpl(`${LOOPBACK_ORIGIN}${definition.path(command)}`, {
      method: definition.method,
      headers: { "Content-Type": "application/json", "X-Noon-Request": "1", "X-Noon-Local-Auth": secret },
      body: definition.method === "GET" ? undefined : JSON.stringify(definition.body(command)),
    });
  } catch { throw commandError("NOON_RUNTIME_UNAVAILABLE"); }
  let payload = null;
  try { payload = await response.json(); } catch { throw commandError("NOON_RESPONSE_INVALID"); }
  const safePayload = redact(payload, secret);
  if (!response.ok) throw Object.assign(commandError(String(safePayload?.code || "BENCHMARK_CONTROL_FAILED")), { httpStatus: response.status });
  return { status: "ok", operation: command.operation, httpStatus: response.status, response: safePayload };
}

function publicCommandError(error) {
  return { status: "error", code: String(error?.code || "BENCHMARK_COMMAND_FAILED"), ...(Number.isInteger(error?.httpStatus) ? { httpStatus: error.httpStatus } : {}) };
}

module.exports = { LOOPBACK_ORIGIN, OPERATIONS, executeBenchmarkControlCommand, parseBenchmarkControlCommand, publicCommandError, redact };
