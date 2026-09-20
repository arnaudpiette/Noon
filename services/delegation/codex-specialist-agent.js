"use strict";

const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const { resolveCodexExecutable } = require("../../lib/codex-executable-resolver");
const { assertSpecialistAgentAdapter, normalizeSpecialistAgentResult } = require("./specialist-agent-adapter");

function versionProbe(executable) {
  const result = spawnSync(executable, ["--version"], { encoding: "utf8", timeout: 5_000 });
  const value=String(result.stdout||"").trim().slice(0,120); const status=result.error?.code==="ENOENT"?"EXECUTABLE_NOT_FOUND":result.error||result.status!==0?"VERSION_COMMAND_FAILED":!value?"VERSION_EMPTY":/^codex-cli\s+\S+/.test(value)?"VERSION_OK":"VERSION_PARSE_FAILED";
  return {status,version:status==="VERSION_OK"?value:null,executableFound:status!=="EXECUTABLE_NOT_FOUND",commandStarted:!result.error,exitCode:Number.isInteger(result.status)?result.status:null,signal:result.signal||null,reasonCode:status};
}
function executableVersion(executable) { return versionProbe(executable).version; }

function safeTaskPrompt(task, preflight) {
  const relative = (item) => item === task.repositoryRoot ? "." : path.relative(task.repositoryRoot, item);
  return [
    "You are a bounded specialist agent working on a non-sensitive development repository.",
    `Objective: ${task.objective}`,
    `Allowed paths: ${task.allowedPaths.map(relative).join(", ")}`,
    `Forbidden paths: ${task.forbiddenPaths.map(relative).join(", ") || "private and credential files"}`,
    `Constraints: ${task.constraints.join("; ") || "minimal scoped change"}`,
    `Applicable instruction files: ${preflight.agentsFiles.map((item) => item.replace(`${task.repositoryRoot}/`, "")).join(", ") || "none"}`,
    "Preserve every pre-existing change. Do not commit, push, install packages, access secrets, modify .env, or work outside the allowed paths.",
    "Do not use sudo, destructive Git, remote mutation, or disable tests/lint/type checking.",
    `Inspect, implement the smallest change, and run only relevant existing validations. Use at most ${task.maxIterations} edit/test iterations. Stop within the task limits.`,
  ].join("\n");
}

function sanitizedAgentEnvironment(source = process.env) {
  const allowed = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG", "LC_ALL", "TERM", "COLORTERM", "CODEX_HOME", "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS"];
  return Object.fromEntries(allowed.filter((key) => source[key] != null).map((key) => [key, source[key]]));
}

function createCodexSpecialistAgent({ executableResolver = resolveCodexExecutable, spawnProcess = spawn, versionProvider = versionProbe, now = () => Date.now(), observability = null } = {}) {
  const tasks = new Map();
  const resolved = executableResolver();
  const resolvedExecutable = resolved?.executable || null;
  const probe = resolvedExecutable ? versionProvider(resolvedExecutable) : { status: "EXECUTABLE_NOT_FOUND", version: null };
  const version=typeof probe==="string"?probe:probe?.version||null; const probeStatus=typeof probe==="string"?"VERSION_OK":probe?.status||"VERSION_COMMAND_FAILED";
  const safeExecutable = resolvedExecutable ? path.basename(resolvedExecutable) : "codex";
  const emit = (event, details) => { try { observability?.(event, details); } catch {} };
  const adapter = {
    id: "codex-cli",
    name: "Codex CLI",
    async isAvailable() { return Boolean(version); },
    getCapabilities() {
      return Object.freeze({ version, method: "codex exec", nonInteractive: true, structuredOutput: true, workingDirectory: true, sandbox: "workspace-write", cancellation: true });
    },
    async executeTask(task, context = {}) {
      const started = now();
      const benchmark = context.benchmarkExecution && typeof context.benchmarkExecution === "object" ? { sessionId: context.benchmarkExecution.sessionId, runId: context.benchmarkExecution.runId, taskId: context.benchmarkExecution.taskId, participant: "CODEX" } : {};
      emit("codex_cli_resolution", { taskId: task.taskId, ...benchmark, source: resolved?.source || "NOT_FOUND", executable: safeExecutable, found: Boolean(resolvedExecutable) });
      emit("codex_version_probe", { taskId: task.taskId, ...benchmark, attempted: true, result: probeStatus, version: version || null });
      if (!version) return normalizeSpecialistAgentResult({ taskId: task.taskId, agent: adapter.id, status: "FAILED", summary: "Codex indisponible.", failureCategory: "AGENT_UNAVAILABLE", backend: { invoked: false, spawnAttempted: false, preSpawnFailure: probeStatus } });
      const args = ["--ask-for-approval", "never", "exec", "--ephemeral", "--json", "--color", "never", "--sandbox", "workspace-write", "-C", task.repositoryRoot, safeTaskPrompt(task, context.preflight || { agentsFiles: [] })];
      emit("codex_spawn_attempt", { taskId: task.taskId, ...benchmark, executable: safeExecutable, cwd: "authorized-workspace", argumentProfile: "codex-exec-workspace-write" });
      let child; try { child = spawnProcess(resolvedExecutable, args, { cwd: task.repositoryRoot, stdio: ["ignore", "pipe", "pipe"], env: sanitizedAgentEnvironment() }); } catch (error) { emit("codex_spawn_result", { taskId: task.taskId, ...benchmark, childCreated: false, reason: "SPAWN_CONSTRUCTION_FAILED" }); return normalizeSpecialistAgentResult({ taskId: task.taskId, agent: adapter.id, status: "FAILED", summary: "Codex indisponible.", failureCategory: "AGENT_UNAVAILABLE", backend: { invoked: false, spawnAttempted: true, preSpawnFailure: "SPAWN_CONSTRUCTION_FAILED" } }); }
      const record = { child, status: "RUNNING", startedAt: started };
      tasks.set(task.taskId, record);
      let output = ""; let errors = ""; let timeoutId; let killId;
      const stop = (signal = "SIGTERM") => { if (!child.killed) child.kill(signal); };
      if (context.signal) context.signal.addEventListener("abort", () => stop(), { once: true });
      timeoutId = setTimeout(() => { record.timedOut = true; stop(); killId = setTimeout(() => stop("SIGKILL"), 2_000); killId.unref?.(); }, task.maxDuration);
      timeoutId.unref?.();
      child.stdout?.on("data", (chunk) => { output = (output + chunk).slice(-1_000_000); });
      child.stderr?.on("data", (chunk) => { errors = (errors + chunk).slice(-50_000); });
      const exit = await new Promise((resolve) => {
        child.once("error", (error) => resolve({ code: null, error }));
        child.once("close", (code, signal) => resolve({ code, signal }));
      });
      clearTimeout(timeoutId); clearTimeout(killId); record.status = record.cancelled || context.signal?.aborted ? "CANCELLED" : record.timedOut ? "TIMEOUT" : exit.code === 0 ? "SUCCESS" : "FAILED";
      let summary = "Mission Codex terminée."; let iterations = 1; let usage = null;
      for (const line of output.split("\n")) try {
        const event = JSON.parse(line);
        if (event.type === "item.completed" && event.item?.type === "agent_message") summary = String(event.item.text || summary).slice(0, 4000);
        if (event.type === "turn.completed" && event.usage) usage = event.usage;
        if (event.type === "turn.started") iterations += 1;
      } catch {}
      const failureCategory = record.status === "CANCELLED" ? "CANCELLED" : record.status === "TIMEOUT" ? "TIMEOUT" : record.status === "FAILED" ? (/auth/i.test(errors) ? "AUTH_ERROR" : "TASK_FAILURE") : null;
      tasks.delete(task.taskId);
      const endedAt = now();
      emit("codex_spawn_result", { taskId: task.taskId, ...benchmark, childCreated: !exit.error, exitCode: Number.isInteger(exit.code) ? exit.code : null, signal: exit.signal || null, durationMs: endedAt - started }); return normalizeSpecialistAgentResult({ taskId: task.taskId, agent: adapter.id, status: record.status, summary, errors: exit.error ? [exit.error.code || "AGENT_UNAVAILABLE"] : [], iterations: Math.max(1, iterations - 1), duration: endedAt - started, usage, estimatedCost: null, actualCost: null, failureCategory, backend: { invoked: true, startedAt: started, endedAt, exitCode: Number.isInteger(exit.code) ? exit.code : null, signal: exit.signal || null, spawnAttempted: true } });
    },
    async cancelTask(taskId) { const record = tasks.get(String(taskId)); if (!record) return false; record.cancelled = true; record.status = "CANCELLED"; record.child.kill("SIGTERM"); return true; },
    async getTaskStatus(taskId) { return tasks.get(String(taskId))?.status || "UNKNOWN"; },
  };
  return assertSpecialistAgentAdapter(adapter);
}

module.exports = { createCodexSpecialistAgent, executableVersion, versionProbe, safeTaskPrompt, sanitizedAgentEnvironment };
