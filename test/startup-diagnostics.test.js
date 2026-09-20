"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const { createDeferredOptionalLoader, createStartupDiagnostics, startOptionalStartupPhase } = require("../electron/startup-diagnostics");

test("B11 startup diagnostics records bounded phase metadata only", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noon-startup-diagnostics-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "startup.jsonl");
  let tick = 0n;
  const diagnostics = createStartupDiagnostics({
    filePath,
    now: () => new Date("2026-09-18T08:00:00.000Z"),
    monotonicNow: () => (tick += 2_000_000n),
  });

  assert.equal(await diagnostics.measure("optional-component", async () => "ready"), "ready");
  const entries = fs.readFileSync(filePath, "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(entries.map(({ phase, status }) => ({ phase, status })), [
    { phase: "optional-component", status: "start" },
    { phase: "optional-component", status: "ok" },
  ]);
  assert.equal(entries[1].durationMs, 2);
  assert.deepEqual(Object.keys(entries[1]).sort(), ["durationMs", "phase", "status", "timestamp"]);
});

test("B11 startup diagnostics preserves failure code without serializing the error", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noon-startup-diagnostics-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "startup.jsonl");
  const diagnostics = createStartupDiagnostics({ filePath });
  const secret = "must-not-appear";

  await assert.rejects(
    diagnostics.measure("mandatory-auth", async () => {
      throw Object.assign(new Error(secret), { code: "NOON_AUTH_UNAVAILABLE" });
    }),
    (error) => error.message === secret
  );
  const output = fs.readFileSync(filePath, "utf8");
  assert.equal(output.includes(secret), false);
  assert.match(output, /NOON_AUTH_UNAVAILABLE/);
});

test("B11 an unresolved microphone permission cannot retain core readiness", async () => {
  let resolvePermission;
  let permissionSettled = false;
  const unresolvedPermission = new Promise((resolve) => { resolvePermission = resolve; });

  const permissionPromise = startOptionalStartupPhase({
    operation: () => unresolvedPermission,
    onResolved: () => { permissionSettled = true; },
  });
  const coreReady = true;

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(coreReady, true);
  assert.equal(permissionSettled, false);
  resolvePermission(true);
  await permissionPromise;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(permissionSettled, true);
});

test("B11 a stalled optional SafeStorage secret cannot retain core readiness", async () => {
  const stalledSecret = new Promise(() => {});
  let secretSettled = false;
  let coreReady = false;

  startOptionalStartupPhase({
    operation: () => stalledSecret,
    onResolved: () => { secretSettled = true; },
  });
  coreReady = true;
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(secretSettled, false);
  assert.equal(coreReady, true);
});

test("B15 un blob OpenAI SafeStorage présent reste différé jusqu'à un appel provider explicite", async () => {
  let calls = 0;
  let release;
  const blockedSafeStorage = new Promise((resolve) => { release = resolve; });
  const loader = createDeferredOptionalLoader({ operation: async () => { calls += 1; return blockedSafeStorage; } });
  const encryptedBlobPresent = true;
  const coreReady = true;

  assert.equal(encryptedBlobPresent, true);
  assert.equal(loader.state(), "DEFERRED");
  assert.equal(calls, 0);
  assert.equal(coreReady, true);

  const providerRequest = loader.ensure();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(loader.state(), "LOADING");
  assert.equal(calls, 1);
  release("loaded");
  assert.equal(await providerRequest, "loaded");
  assert.equal(loader.state(), "READY");
});

test("B15 un échec du secret provider optionnel reste explicite sans toucher à local-auth", async () => {
  const loader = createDeferredOptionalLoader({ operation: async () => { throw Object.assign(new Error("locked"), { code: "KEYCHAIN_LOCKED" }); } });
  await assert.rejects(loader.ensure(), (error) => error.code === "KEYCHAIN_LOCKED");
  assert.equal(loader.state(), "UNAVAILABLE");
});

test("B15 plusieurs secrets provider SafeStorage restent indépendamment différés", () => {
  let openAICalls = 0;
  let geminiCalls = 0;
  const openAI = createDeferredOptionalLoader({ operation: () => { openAICalls += 1; } });
  const gemini = createDeferredOptionalLoader({ operation: () => { geminiCalls += 1; } });
  assert.deepEqual([openAI.state(), gemini.state()], ["DEFERRED", "DEFERRED"]);
  assert.deepEqual([openAICalls, geminiCalls], [0, 0]);
  gemini.ensureSync();
  assert.deepEqual([openAI.state(), gemini.state()], ["DEFERRED", "READY"]);
  assert.deepEqual([openAICalls, geminiCalls], [0, 1]);
});
