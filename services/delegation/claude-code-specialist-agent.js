"use strict";

// V3-L5b — adaptateur Claude Code CLI (D.1), même contrat que l'adaptateur Codex.
// Mode non interactif (`claude -p`), sortie stream-json, dossier de travail = worktree de la
// mission. Outils bornés : lecture, édition dans le dossier de travail, et quelques commandes de
// validation ; ni commit, ni push, ni réseau, ni installation. Environnement nettoyé (aucune clé :
// seule la session déjà ouverte de Claude Code sur ce Mac est utilisée). Absent = indisponible,
// jamais simulé.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { executableFile } = require("../../lib/codex-executable-resolver");
const { safeTaskPrompt, sanitizedAgentEnvironment } = require("./codex-specialist-agent");
const { assertSpecialistAgentAdapter, normalizeSpecialistAgentResult } = require("./specialist-agent-adapter");

const ALLOWED_TOOLS = Object.freeze([
  "Read", "Glob", "Grep", "Edit", "MultiEdit", "Write",
  "Bash(npm test:*)", "Bash(npm run lint:*)", "Bash(npm run typecheck:*)", "Bash(node --test:*)", "Bash(node --check:*)",
  "Bash(git status:*)", "Bash(git diff:*)", "Bash(git log:*)", "Bash(ls:*)",
]);
const DISALLOWED_TOOLS = Object.freeze([
  "WebFetch", "WebSearch", "Bash(git commit:*)", "Bash(git push:*)", "Bash(git reset:*)", "Bash(git checkout:*)",
  "Bash(git clean:*)", "Bash(npm install:*)", "Bash(npm i:*)", "Bash(rm:*)", "Bash(sudo:*)", "Bash(curl:*)",
]);

function resolveClaudeExecutable({ env = process.env, homeDirectory = os.homedir(), fsImpl = fs } = {}) {
  for (const directory of String(env.PATH || "").split(path.delimiter)) {
    if (!path.isAbsolute(directory)) continue;
    const executable = executableFile(path.join(directory, "claude"), { fsImpl });
    if (executable) return { executable, source: "PATH" };
  }
  for (const [candidate, source] of [
    ["/opt/homebrew/bin/claude", "HOMEBREW"],
    ["/usr/local/bin/claude", "USR_LOCAL"],
    [path.join(homeDirectory, ".local", "bin", "claude"), "LOCAL_BIN"],
    [path.join(homeDirectory, ".claude", "local", "claude"), "CLAUDE_LOCAL"],
  ]) {
    const executable = executableFile(candidate, { fsImpl });
    if (executable) return { executable, source };
  }
  return { executable: null, source: "NOT_FOUND" };
}

function claudeVersionProbe(executable) {
  const result = spawnSync(executable, ["--version"], { encoding: "utf8", timeout: 5_000, env: sanitizedAgentEnvironment() });
  const value = String(result.stdout || "").trim().split("\n")[0].slice(0, 120);
  if (result.error?.code === "ENOENT") return { status: "EXECUTABLE_NOT_FOUND", version: null };
  if (result.error || result.status !== 0) return { status: "VERSION_COMMAND_FAILED", version: null };
  return /\d+\.\d+\.\d+/.test(value) ? { status: "VERSION_OK", version: value } : { status: "VERSION_PARSE_FAILED", version: null };
}

function buildClaudeArgs(task, preflight) {
  return [
    "-p", safeTaskPrompt(task, preflight || { agentsFiles: [] }),
    "--output-format", "stream-json", "--verbose",
    "--permission-mode", "acceptEdits",
    "--max-turns", String(Math.max(4, Math.min(60, task.maxIterations * 8))),
    "--allowedTools", ALLOWED_TOOLS.join(","),
    "--disallowedTools", DISALLOWED_TOOLS.join(","),
  ];
}

// Lit la sortie stream-json : résumé final, nombre de tours, coût déclaré, erreur éventuelle.
function parseClaudeStream(output) {
  const parsed = { summary: null, turns: null, cost: null, usage: null, isError: false, errorSubtype: null };
  for (const line of String(output || "").split("\n")) {
    let event; try { event = JSON.parse(line); } catch { continue; }
    if (event?.type !== "result") continue;
    parsed.summary = typeof event.result === "string" ? event.result.slice(0, 4000) : parsed.summary;
    parsed.turns = Number.isInteger(event.num_turns) ? event.num_turns : parsed.turns;
    parsed.cost = Number.isFinite(event.total_cost_usd) ? event.total_cost_usd : parsed.cost;
    parsed.usage = event.usage && typeof event.usage === "object" ? event.usage : parsed.usage;
    parsed.isError = event.is_error === true || (event.subtype && event.subtype !== "success");
    parsed.errorSubtype = parsed.isError ? String(event.subtype || "error").slice(0, 60) : null;
  }
  return parsed;
}

function createClaudeCodeSpecialistAgent({ executableResolver = resolveClaudeExecutable, spawnProcess = spawn, versionProvider = claudeVersionProbe, now = () => Date.now(), observability = null } = {}) {
  const tasks = new Map();
  const resolved = executableResolver();
  const executable = resolved?.executable || null;
  const probe = executable ? versionProvider(executable) : { status: "EXECUTABLE_NOT_FOUND", version: null };
  const version = probe?.version || null;
  const emit = (event, details) => { try { observability?.(event, details); } catch {} };
  const unavailable = (task, preSpawnFailure) => normalizeSpecialistAgentResult({ taskId: task.taskId, agent: adapter.id, status: "FAILED", summary: "Claude Code indisponible sur ce Mac.", failureCategory: "AGENT_UNAVAILABLE", backend: { invoked: false, spawnAttempted: preSpawnFailure === "SPAWN_CONSTRUCTION_FAILED", preSpawnFailure } });

  const adapter = {
    id: "claude-code",
    name: "Claude Code CLI",
    async isAvailable() { return Boolean(version); },
    getCapabilities() {
      return Object.freeze({ version, method: "claude -p", nonInteractive: true, structuredOutput: true, workingDirectory: true, sandbox: "accept-edits-bounded-tools", cancellation: true, availability: version ? "AVAILABLE" : probe.status });
    },
    async executeTask(task, context = {}) {
      const started = now();
      emit("claude_code_resolution", { taskId: task.taskId, source: resolved?.source || "NOT_FOUND", found: Boolean(executable), version });
      if (!version) return unavailable(task, probe.status);
      let child;
      try { child = spawnProcess(executable, buildClaudeArgs(task, context.preflight), { cwd: task.repositoryRoot, stdio: ["ignore", "pipe", "pipe"], env: sanitizedAgentEnvironment() }); }
      catch { return unavailable(task, "SPAWN_CONSTRUCTION_FAILED"); }
      const record = { child, status: "RUNNING" };
      tasks.set(task.taskId, record);
      let output = ""; let errors = ""; let killTimer = null;
      const stop = (signal = "SIGTERM") => { if (!child.killed) child.kill(signal); };
      if (context.signal) context.signal.addEventListener("abort", () => stop(), { once: true });
      const timer = setTimeout(() => { record.timedOut = true; stop(); killTimer = setTimeout(() => stop("SIGKILL"), 2_000); killTimer.unref?.(); }, task.maxDuration);
      timer.unref?.();
      child.stdout?.on("data", (chunk) => { output = (output + chunk).slice(-1_000_000); });
      child.stderr?.on("data", (chunk) => { errors = (errors + chunk).slice(-50_000); });
      const exit = await new Promise((resolve) => { child.once("error", (error) => resolve({ code: null, error })); child.once("close", (code, signal) => resolve({ code, signal })); });
      clearTimeout(timer); clearTimeout(killTimer); tasks.delete(task.taskId);
      const stream = parseClaudeStream(output);
      const status = record.cancelled || context.signal?.aborted ? "CANCELLED" : record.timedOut ? "TIMEOUT" : exit.code === 0 && !stream.isError ? "SUCCESS" : "FAILED";
      const failureCategory = status === "CANCELLED" ? "CANCELLED" : status === "TIMEOUT" ? "TIMEOUT" : status === "FAILED"
        ? (/auth|log ?in|api key|credential/i.test(errors + (stream.summary || "")) ? "AUTH_ERROR" : stream.errorSubtype === "error_max_turns" ? "BUDGET_EXCEEDED" : "TASK_FAILURE") : null;
      const endedAt = now();
      emit("claude_code_result", { taskId: task.taskId, exitCode: Number.isInteger(exit.code) ? exit.code : null, status, turns: stream.turns, durationMs: endedAt - started });
      return normalizeSpecialistAgentResult({
        taskId: task.taskId, agent: adapter.id, status, summary: stream.summary || (status === "SUCCESS" ? "Mission Claude Code terminée." : "Mission Claude Code échouée."),
        errors: exit.error ? [exit.error.code || "AGENT_UNAVAILABLE"] : [],
        // Un « tour » Claude Code est un échange outil ; on le ramène à des itérations édition/test.
        iterations: stream.turns ? Math.max(1, Math.ceil(stream.turns / 8)) : 1,
        duration: endedAt - started, usage: stream.usage, estimatedCost: null, actualCost: stream.cost,
        failureCategory, backend: { invoked: true, startedAt: started, endedAt, exitCode: Number.isInteger(exit.code) ? exit.code : null, signal: exit.signal || null, spawnAttempted: true },
      });
    },
    async cancelTask(taskId) { const record = tasks.get(String(taskId)); if (!record) return false; record.cancelled = true; record.child.kill("SIGTERM"); return true; },
    async getTaskStatus(taskId) { return tasks.get(String(taskId))?.status || "UNKNOWN"; },
  };
  return assertSpecialistAgentAdapter(adapter);
}

// Choix de l'exécutant par mission. Exécutant demandé absent → échec explicite, jamais de
// bascule silencieuse vers un autre.
function createExecutorSelector({ agents, defaultId }) {
  const byId = new Map(Object.entries(agents || {}).map(([id, agent]) => [id, assertSpecialistAgentAdapter(agent)]));
  if (!byId.has(defaultId)) throw new TypeError("Exécutant par défaut inconnu.");
  const owners = new Map();
  const pick = (id) => byId.get(id || defaultId) || null;
  const selector = {
    id: "executor-selector",
    name: "Sélecteur d'exécutant",
    async isAvailable() { return pick(defaultId).isAvailable(); },
    getCapabilities() { return Object.freeze({ defaultExecutor: defaultId, executors: [...byId.keys()] }); },
    async list() {
      return Promise.all([...byId.entries()].map(async ([id, agent]) => ({ id, name: agent.name, available: await agent.isAvailable(), default: id === defaultId, version: agent.getCapabilities()?.version || null })));
    },
    async executeTask(task, context = {}) {
      const agent = pick(context.executorId);
      if (!agent) return normalizeSpecialistAgentResult({ taskId: task.taskId, agent: String(context.executorId || "unknown"), status: "FAILED", summary: "Exécutant inconnu.", failureCategory: "AGENT_UNAVAILABLE", backend: { invoked: false, spawnAttempted: false, preSpawnFailure: "EXECUTOR_UNKNOWN" } });
      owners.set(task.taskId, agent);
      try { return await agent.executeTask(task, context); } finally { owners.delete(task.taskId); }
    },
    async cancelTask(taskId) { return owners.get(String(taskId))?.cancelTask(taskId) ?? false; },
    async getTaskStatus(taskId) { return owners.get(String(taskId))?.getTaskStatus(taskId) ?? "UNKNOWN"; },
  };
  return assertSpecialistAgentAdapter(selector);
}

module.exports = { ALLOWED_TOOLS, DISALLOWED_TOOLS, buildClaudeArgs, claudeVersionProbe, createClaudeCodeSpecialistAgent, createExecutorSelector, parseClaudeStream, resolveClaudeExecutable };
