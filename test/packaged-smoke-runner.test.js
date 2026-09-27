"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const test = require("node:test");
const { isAlive, runPackagedSmoke } = require("../scripts/packaged-smoke-runner");

const FIXTURE_SOURCE = `
"use strict";
const fs = require("fs");
const { spawn } = require("child_process");
const mode = process.argv[2];
const resultPath = process.argv[3];
const pidPath = process.argv[4];
const signalReadyPath = process.argv[5];
const stayAlive = () => setInterval(() => {}, 1_000);
if (mode === "ready-term") {
  setTimeout(() => fs.writeFileSync(resultPath, JSON.stringify({ status: "ok", smoke: "packaged-startup", serverStartedObserved: true, serverStartedLatencyMs: 12, healthReadyLatencyMs: 18, elapsedMs: 18 })), 30);
  process.on("SIGTERM", () => process.exit(0));
  stayAlive();
} else if (mode === "timeout-term") {
  process.on("SIGTERM", () => process.exit(0));
  stayAlive();
} else if (mode === "timeout-ignore") {
  process.on("SIGTERM", () => {});
  fs.writeFileSync(signalReadyPath, "ready");
  stayAlive();
} else if (mode === "fetch-after-timeout") {
  process.on("SIGTERM", () => console.error("TypeError: fetch failed"));
  stayAlive();
} else if (mode === "timeout-tree") {
  const helper = spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], { stdio: "ignore" });
  fs.writeFileSync(pidPath, String(helper.pid));
  process.on("SIGTERM", () => {});
  stayAlive();
} else {
  process.exit(2);
}
`;

function createFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noon-smoke-runner-test-"));
  const fixturePath = path.join(directory, "child.js");
  const resultPath = path.join(directory, "smoke-result.json");
  const pidPath = path.join(directory, "helper.pid");
  const signalReadyPath = path.join(directory, "signal-ready");
  fs.writeFileSync(fixturePath, FIXTURE_SOURCE);
  return { directory, fixturePath, resultPath, pidPath, signalReadyPath };
}

async function runFixture(mode, overrides = {}) {
  const fixture = createFixture();
  const { waitForSignalHandler = false, ...runnerOverrides } = overrides;
  const args = [fixture.fixturePath, mode, fixture.resultPath, fixture.pidPath, fixture.signalReadyPath];
  let child = null;
  if (waitForSignalHandler) {
    child = spawn(process.execPath, args, {
      env: process.env,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const ready = await waitForFile(fixture.signalReadyPath);
    if (!ready) {
      try { process.kill(process.platform === "win32" ? child.pid : -child.pid, "SIGKILL"); } catch {}
      throw new Error("La fixture résistante n'a pas installé son handler SIGTERM.");
    }
  }
  const startedAt = Date.now();
  const execution = await runPackagedSmoke({
    executable: process.execPath,
    args,
    resultPath: fixture.resultPath,
    readinessTimeoutMs: 3_000,
    gracefulShutdownMs: 200,
    forceShutdownMs: 100,
    absoluteTimeoutMs: 3_800,
    pollIntervalMs: 10,
    ...(child ? { spawnProcess: () => child } : {}),
    ...runnerOverrides,
  });
  return { ...fixture, ...execution, wallMs: Date.now() - startedAt };
}

function removeFixture(directory) {
  fs.rmSync(directory, { recursive: true, force: true });
}

async function waitForGone(pid, timeoutMs = 500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive(pid, false)) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return !isAlive(pid, false);
}

async function waitForFile(filePath, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return fs.existsSync(filePath);
}

test("packaged smoke runner accepts successful readiness and exits cleanly", async () => {
  const run = await runFixture("ready-term");
  try {
    assert.equal(run.result.status, "PASS");
    assert.equal(run.result.readinessReached, true);
    assert.equal(run.result.forcedTerminationUsed, false);
    assert.equal(run.result.serverStartedObserved, true);
    assert.ok(run.wallMs < 3_800);
  } finally { removeFixture(run.directory); }
});

test("packaged smoke runner reports a readiness timeout", async () => {
  const run = await runFixture("timeout-term");
  try {
    assert.equal(run.result.status, "FAIL");
    assert.equal(run.result.reason, "READINESS_TIMEOUT");
    assert.equal(run.result.terminationRequested, true);
  } finally { removeFixture(run.directory); }
});

test("packaged smoke runner honors a child that respects SIGTERM", async () => {
  const run = await runFixture("timeout-term");
  try {
    assert.equal(run.result.forcedTerminationUsed, false);
    assert.equal(run.result.signal, null);
    assert.equal(run.result.exitCode, 0);
  } finally { removeFixture(run.directory); }
});

test("packaged smoke runner force-kills an owned child that ignores SIGTERM", async () => {
  const run = await runFixture("timeout-ignore");
  try {
    assert.equal(run.result.status, "FAIL");
    assert.equal(run.result.forcedTerminationUsed, true);
    assert.ok(run.wallMs < 3_800);
    assert.equal(await waitForGone(run.pid), true);
  } finally { removeFixture(run.directory); }
});

test("packaged smoke runner always persists a structured failure result", async () => {
  const run = await runFixture("timeout-ignore");
  try {
    const persisted = JSON.parse(fs.readFileSync(run.resultPath, "utf8"));
    for (const key of ["status", "reason", "startedAt", "finishedAt", "durationMs", "readinessReached", "serverStartedObserved", "terminationRequested", "forcedTerminationUsed", "exitCode", "signal"]) {
      assert.ok(Object.hasOwn(persisted, key), key);
    }
    assert.equal(persisted.status, "FAIL");
  } finally { removeFixture(run.directory); }
});

test("a fetch error after timeout does not replace the primary cause", async () => {
  const run = await runFixture("fetch-after-timeout");
  try {
    assert.match(run.output, /TypeError: fetch failed/);
    assert.equal(run.result.reason, "READINESS_TIMEOUT");
    assert.equal(run.result.forcedTerminationUsed, true);
  } finally { removeFixture(run.directory); }
});

test("forced cleanup removes the owned process tree without an orphan", async () => {
  const run = await runFixture("timeout-tree");
  try {
    const helperPid = Number(fs.readFileSync(run.pidPath, "utf8"));
    assert.equal(run.result.forcedTerminationUsed, true);
    assert.equal(await waitForGone(run.pid), true);
    assert.equal(await waitForGone(helperPid), true);
  } finally { removeFixture(run.directory); }
});

test("the absolute deadline finishes even when cleanup does not settle", async () => {
  const run = await runFixture("timeout-ignore", {
    waitForSignalHandler: true,
    readinessTimeoutMs: 1_500,
    gracefulShutdownMs: 200,
    forceShutdownMs: 1_000,
    absoluteTimeoutMs: 1_900,
  });
  try {
    assert.equal(run.result.status, "FAIL");
    assert.equal(run.result.reason, "READINESS_TIMEOUT");
    assert.equal(run.result.forcedTerminationUsed, true);
    assert.ok(run.wallMs < 2_500);
    assert.equal(await waitForGone(run.pid), true);
  } finally { removeFixture(run.directory); }
});

test("resistant fixtures remain force-killed under concurrent cleanup", async () => {
  const runs = await Promise.all(Array.from({ length: 3 }, () => runFixture("timeout-ignore", {
    waitForSignalHandler: true,
    readinessTimeoutMs: 300,
    gracefulShutdownMs: 100,
    forceShutdownMs: 200,
    absoluteTimeoutMs: 700,
  })));
  try {
    for (const run of runs) {
      assert.equal(run.result.reason, "READINESS_TIMEOUT");
      assert.equal(run.result.forcedTerminationUsed, true);
      assert.equal(await waitForGone(run.pid), true);
    }
  } finally {
    for (const run of runs) removeFixture(run.directory);
  }
});
