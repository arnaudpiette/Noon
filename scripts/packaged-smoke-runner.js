"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); }
  catch { return null; }
}

function writeJson(filePath, value) {
  const temporary = `${filePath}.runner.tmp`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

function isAlive(pid, processGroup) {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try {
    process.kill(processGroup ? -pid : pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function signalOwnedProcess(child, signal, processGroup) {
  if (!child || !Number.isInteger(child.pid) || child.pid <= 1) return false;
  try {
    process.kill(processGroup ? -child.pid : child.pid, signal);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function runPackagedSmoke({
  executable,
  args = [],
  env = process.env,
  resultPath,
  readinessTimeoutMs = 30_000,
  gracefulShutdownMs = 3_000,
  forceShutdownMs = 2_000,
  absoluteTimeoutMs = 40_000,
  pollIntervalMs = 100,
  spawnProcess = spawn,
} = {}) {
  if (!executable || !resultPath) throw new TypeError("executable et resultPath sont requis.");
  if (absoluteTimeoutMs <= readinessTimeoutMs + gracefulShutdownMs) {
    throw new RangeError("La borne absolue doit dépasser le délai de readiness et la grâce SIGTERM.");
  }

  const startedAt = new Date();
  const startedMonotonic = process.hrtime.bigint();
  const processGroup = process.platform !== "win32";
  let child = null;
  let output = "";
  let settled = false;
  let primaryReason = null;
  let secondaryError = null;
  let readinessReached = false;
  let serverStartedObserved = false;
  let terminationRequested = false;
  let forcedTerminationUsed = false;
  let exitCode = null;
  let exitSignal = null;
  let appResult = null;
  const timers = new Set();

  const later = (callback, delay) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      callback();
    }, delay);
    timers.add(timer);
    return timer;
  };

  return new Promise((resolve) => {
    const finish = (status, reason = primaryReason) => {
      if (settled) return;
      settled = true;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      const finishedAt = new Date();
      const durationMs = Math.round(Number(process.hrtime.bigint() - startedMonotonic) / 1_000_000);
      const result = {
        status,
        reason: reason || (status === "PASS" ? "READY" : "UNKNOWN_FAILURE"),
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs,
        readinessReached,
        serverStartedObserved: serverStartedObserved || appResult?.serverStartedObserved === true,
        terminationRequested,
        forcedTerminationUsed,
        exitCode,
        signal: exitSignal,
        ...(secondaryError ? { secondaryError } : {}),
        ...(Number.isFinite(appResult?.serverStartedLatencyMs) ? { serverStartedLatencyMs: appResult.serverStartedLatencyMs } : {}),
        ...(Number.isFinite(appResult?.healthReadyLatencyMs) ? { healthReadyLatencyMs: appResult.healthReadyLatencyMs } : {}),
        ...(Number.isFinite(appResult?.elapsedMs) ? { appElapsedMs: appResult.elapsedMs } : {}),
      };
      try { writeJson(resultPath, result); }
      catch (error) {
        result.resultWriteError = String(error?.code || error?.name || "RESULT_WRITE_FAILED");
      }
      child?.stdout?.destroy();
      child?.stderr?.destroy();
      child?.unref?.();
      resolve({ result, output: output.trim(), pid: child?.pid || null, processGroup });
    };

    const forceAndFinish = (status) => {
      if (settled) return;
      if (isAlive(child?.pid, processGroup)) {
        forcedTerminationUsed = signalOwnedProcess(child, "SIGKILL", processGroup);
      }
      later(() => finish(status), forceShutdownMs);
    };

    const requestShutdown = (status, reason) => {
      if (settled || terminationRequested) return;
      primaryReason ||= reason;
      terminationRequested = true;
      signalOwnedProcess(child, "SIGTERM", processGroup);
      later(() => {
        if (settled) return;
        if (isAlive(child?.pid, processGroup)) forceAndFinish(status);
        else finish(status);
      }, gracefulShutdownMs);
    };

    try {
      child = spawnProcess(executable, args, {
        env,
        detached: processGroup,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      primaryReason = "SPAWN_FAILED";
      secondaryError = String(error?.code || error?.name || "SPAWN_FAILED");
      finish("FAIL");
      return;
    }

    const capture = (chunk) => {
      if (output.length < 1_000_000) output += String(chunk);
      if (String(chunk).includes("Noon est actif sur http://")) serverStartedObserved = true;
    };
    child.stdout?.on("data", capture);
    child.stderr?.on("data", capture);
    child.on("error", (error) => {
      secondaryError = String(error?.code || error?.name || "CHILD_ERROR");
      primaryReason ||= "CHILD_ERROR";
      requestShutdown("FAIL", primaryReason);
    });
    child.on("exit", (code, signal) => {
      exitCode = code;
      exitSignal = signal || null;
    });
    child.on("close", (code, signal) => {
      exitCode = code;
      exitSignal = signal || exitSignal;
      appResult = readJson(resultPath);
      if (appResult?.status === "ok" && appResult?.smoke === "packaged-startup") {
        readinessReached = true;
        finish("PASS", "READY");
        return;
      }
      if (primaryReason === "READINESS_TIMEOUT" || primaryReason === "ABSOLUTE_DEADLINE") {
        finish("FAIL");
        return;
      }
      primaryReason ||= "CHILD_EXIT_BEFORE_READY";
      finish("FAIL");
    });

    const poll = () => {
      if (settled || readinessReached) return;
      const candidate = readJson(resultPath);
      if (candidate?.status === "ok" && candidate?.smoke === "packaged-startup") {
        appResult = candidate;
        readinessReached = true;
        serverStartedObserved ||= candidate.serverStartedObserved === true;
        requestShutdown("PASS", "READY");
        return;
      }
      later(poll, pollIntervalMs);
    };
    later(poll, pollIntervalMs);

    later(() => {
      if (!readinessReached && !settled) requestShutdown("FAIL", "READINESS_TIMEOUT");
    }, readinessTimeoutMs);

    later(() => {
      if (settled) return;
      primaryReason ||= "ABSOLUTE_DEADLINE";
      terminationRequested = true;
      forcedTerminationUsed = signalOwnedProcess(child, "SIGKILL", processGroup) || forcedTerminationUsed;
      finish(readinessReached ? "PASS" : "FAIL");
    }, absoluteTimeoutMs);
  });
}

module.exports = {
  isAlive,
  runPackagedSmoke,
  signalOwnedProcess,
};
