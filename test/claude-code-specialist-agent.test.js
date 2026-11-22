"use strict";

// V3-L5b — adaptateur Claude Code CLI et choix de l'exécutant (sans processus réel).
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const {
  ALLOWED_TOOLS, DISALLOWED_TOOLS, buildClaudeArgs, createClaudeCodeSpecialistAgent, createExecutorSelector, parseClaudeStream, resolveClaudeExecutable,
} = require("../services/delegation/claude-code-specialist-agent");

const task = (overrides = {}) => ({ taskId: "mission-1", objective: "Passer la valeur à 2.", repositoryRoot: "/wt/mission-1", allowedPaths: ["/wt/mission-1/src"], forbiddenPaths: [], constraints: [], maxIterations: 3, maxDuration: 60_000, ...overrides });

function fakeSpawn({ lines = [], code = 0, stderr = "" } = {}) {
  const calls = [];
  const spawnProcess = (executable, args, options) => {
    calls.push({ executable, args, options });
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.killed = false;
    child.kill = (signal) => { child.killed = true; setImmediate(() => child.emit("close", null, signal)); return true; };
    setImmediate(() => {
      for (const line of lines) child.stdout.write(`${JSON.stringify(line)}\n`);
      if (stderr) child.stderr.write(stderr);
      if (code !== "hang") setImmediate(() => child.emit("close", code, null));
    });
    return child;
  };
  return { spawnProcess, calls };
}
const agentWith = (spawn, version = "2.1.0 (Claude Code)") => createClaudeCodeSpecialistAgent({
  executableResolver: () => ({ executable: "/usr/local/bin/claude", source: "USR_LOCAL" }),
  versionProvider: () => (version ? { status: "VERSION_OK", version } : { status: "EXECUTABLE_NOT_FOUND", version: null }),
  spawnProcess: spawn.spawnProcess,
});

test("arguments : mode non interactif, prompt borné, outils limités, aucun commit/push/réseau/installation", () => {
  const args = buildClaudeArgs(task(), { agentsFiles: ["/wt/mission-1/AGENTS.md"] });
  assert.equal(args[0], "-p");
  assert.match(args[1], /Objective: Passer la valeur à 2\./);
  assert.match(args[1], /Do not commit, push, install packages/);
  assert.deepEqual(args.slice(2, 7), ["--output-format", "stream-json", "--verbose", "--permission-mode", "acceptEdits"]);
  assert.equal(args[args.indexOf("--max-turns") + 1], "24");
  assert.ok(!args.includes("--dangerously-skip-permissions"));
  for (const tool of ["WebFetch", "WebSearch", "Bash(git commit:*)", "Bash(git push:*)", "Bash(npm install:*)", "Bash(rm:*)"]) assert.ok(DISALLOWED_TOOLS.includes(tool), tool);
  assert.ok(!ALLOWED_TOOLS.some((tool) => /^Bash\((?:git (?:commit|push)|npm i|curl|rm)/.test(tool)));
});

test("succès : résumé, tours, coût déclaré ; dossier de travail = worktree ; environnement sans clés", async () => {
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-should-not-leak";
  try {
    const spawn = fakeSpawn({ lines: [{ type: "system", subtype: "init" }, { type: "result", subtype: "success", is_error: false, result: "Valeur passée à 2, tests verts.", num_turns: 9, total_cost_usd: 0.12, usage: { input_tokens: 10 } }] });
    const result = await agentWith(spawn).executeTask(task());
    assert.equal(result.status, "SUCCESS");
    assert.equal(result.agent, "claude-code");
    assert.equal(result.summary, "Valeur passée à 2, tests verts.");
    assert.equal(result.iterations, 2);
    assert.equal(result.actualCost, 0.12);
    assert.equal(spawn.calls[0].options.cwd, "/wt/mission-1");
    assert.equal(spawn.calls[0].options.env.ANTHROPIC_API_KEY, undefined);
    assert.equal(spawn.calls[0].options.env.OPENAI_API_KEY, undefined);
  } finally { delete process.env.ANTHROPIC_API_KEY; }
});

test("échecs : indisponible sans lancer de processus, authentification, limite de tours, annulation", async () => {
  const none = fakeSpawn();
  const unavailable = await agentWith(none, null).executeTask(task());
  assert.equal(unavailable.failureCategory, "AGENT_UNAVAILABLE");
  assert.equal(unavailable.backend.invoked, false);
  assert.equal(none.calls.length, 0);
  assert.equal(await agentWith(none, null).isAvailable(), false);

  const auth = await agentWith(fakeSpawn({ code: 1, stderr: "Invalid API key · Please run /login" })).executeTask(task());
  assert.equal(auth.failureCategory, "AUTH_ERROR");
  const turns = await agentWith(fakeSpawn({ code: 0, lines: [{ type: "result", subtype: "error_max_turns", is_error: true, num_turns: 24 }] })).executeTask(task());
  assert.equal(turns.status, "FAILED");
  assert.equal(turns.failureCategory, "BUDGET_EXCEEDED");

  const controller = new AbortController();
  const pending = agentWith(fakeSpawn({ code: "hang" })).executeTask(task(), { signal: controller.signal });
  setImmediate(() => controller.abort());
  const cancelled = await pending;
  assert.equal(cancelled.status, "CANCELLED");
});

test("parseClaudeStream ignore les lignes non JSON et lit le dernier résultat", () => {
  assert.deepEqual(parseClaudeStream("bruit\n{\"type\":\"result\",\"subtype\":\"success\",\"result\":\"ok\",\"num_turns\":3}\n"), { summary: "ok", turns: 3, cost: null, usage: null, isError: false, errorSubtype: null });
});

test("résolution : PATH puis emplacements connus ; absent = NOT_FOUND", () => {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "noon-claude-home-")));
  const empty = resolveClaudeExecutable({ env: { PATH: "" }, homeDirectory: home });
  assert.ok(empty.source === "NOT_FOUND" || ["HOMEBREW", "USR_LOCAL"].includes(empty.source), "rien dans ce HOME de test");
  const local = path.join(home, ".claude", "local");
  fs.mkdirSync(local, { recursive: true });
  fs.writeFileSync(path.join(local, "claude"), "#!/bin/sh\n", { mode: 0o755 });
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "noon-claude-bin-"));
  const found = resolveClaudeExecutable({ env: { PATH: binDir }, homeDirectory: home });
  assert.ok(["CLAUDE_LOCAL", "HOMEBREW", "USR_LOCAL", "LOCAL_BIN"].includes(found.source));
  fs.writeFileSync(path.join(binDir, "claude"), "#!/bin/sh\n", { mode: 0o755 });
  assert.equal(resolveClaudeExecutable({ env: { PATH: binDir }, homeDirectory: home }).source, "PATH");
});

test("sélecteur : Codex par défaut, Claude Code sur demande, exécutant absent ou inconnu → échec explicite sans bascule", async () => {
  const used = [];
  const fake = (id, available = true) => ({ id, name: id, async isAvailable() { return available; }, getCapabilities() { return { version: available ? "1.0.0" : null }; }, async executeTask(contract) { used.push(id); return { taskId: contract.taskId, agent: id, status: available ? "SUCCESS" : "FAILED", failureCategory: available ? null : "AGENT_UNAVAILABLE" }; }, async cancelTask() { return true; }, async getTaskStatus() { return "UNKNOWN"; } });
  const selector = createExecutorSelector({ agents: { "codex-cli": fake("codex-cli"), "claude-code": fake("claude-code", false) }, defaultId: "codex-cli" });
  assert.equal((await selector.executeTask(task())).agent, "codex-cli");
  const claude = await selector.executeTask(task(), { executorId: "claude-code" });
  assert.equal(claude.failureCategory, "AGENT_UNAVAILABLE");
  assert.deepEqual(used, ["codex-cli", "claude-code"], "aucune bascule vers Codex quand Claude Code est demandé");
  const unknown = await selector.executeTask(task(), { executorId: "cursor" });
  assert.equal(unknown.failureCategory, "AGENT_UNAVAILABLE");
  assert.equal(used.length, 2);
  assert.deepEqual((await selector.list()).map((item) => [item.id, item.available, item.default]), [["codex-cli", true, true], ["claude-code", false, false]]);
  assert.throws(() => createExecutorSelector({ agents: {}, defaultId: "codex-cli" }));
});
