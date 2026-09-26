"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createDevWorkspaceAgentExecutionLoop,
} = require("../services/dev/workspace-agent-execution-loop");

function fixture({ exits = [0], preview = null, approval = null } = {}) {
  const events = [];
  const terminals = new Map();
  const session = {
    id: "session-1", workspaceId: "workspace-1", repositoryRoot: "/tmp/workspace",
    problems: { status: "EMPTY", counts: { error: 0, warning: 0, info: 0 }, problems: [] },
    gitDiff: { counts: { total: 2, staged: 0, unstaged: 1, untracked: 1, conflicted: 0 }, files: [] },
  };
  let index = 0;
  const terminalService = {
    getSession(id) {
      if (id !== session.id) throw Object.assign(new Error("stale"), { code: "DEV_WORKSPACE_NOT_FOUND" });
      return structuredClone(session);
    },
    createTerminal(input) {
      assert.equal(input.owner, "NOON");
      const terminal = { id: `terminal-${terminals.size + 1}`, running: false, exitCode: null };
      terminals.set(terminal.id, terminal);
      return terminal;
    },
    runCommand(input) {
      assert.equal(input.origin, "NOON");
      const terminal = terminals.get(input.terminalId);
      terminal.running = true;
      terminal.exitCode = exits[index++] ?? 0;
      terminal.command = input.command;
      return { terminal, classification: "SAFE_READ" };
    },
    poll(input) {
      const terminal = terminals.get(input.terminalId);
      terminal.running = false;
      return { terminal: { ...terminal }, output: [{ stream: terminal.exitCode ? "stderr" : "stdout", text: "redacted" }], next: 1 };
    },
    closeTerminal(input) {
      const terminal = terminals.get(input.terminalId);
      terminal.running = false;
      terminal.exitCode = null;
      terminal.closed = true;
      return { closed: true };
    },
    async inspectGitDiff() { return structuredClone(session.gitDiff); },
  };
  const loop = createDevWorkspaceAgentExecutionLoop({
    terminalService,
    operationalSecurityPolicy: { evaluate: () => ({ outcome: "ALLOW" }) },
    approvalEngine: approval,
    previewStateProvider: async () => preview || { status: "READY", loadState: "LOADED", url: "http://127.0.0.1:3000/" },
    observability: (event, metadata) => events.push({ event, metadata }),
    sleep: async () => {},
  });
  return { loop, session, terminals, events, terminalService };
}

function input(overrides = {}) {
  return {
    workspaceSessionId: "session-1",
    task: "Vérifier le projet",
    plan: { actionCommand: "npm run lint", validationCommand: "npm test", riskLevel: "low" },
    ...overrides,
  };
}

test("crée un modèle canonique borné et un plan structuré", async () => {
  const { loop } = fixture();
  const result = await loop.run(input());
  assert.match(result.executionId, /^dev-execution-/);
  assert.equal(result.workspaceSessionId, "session-1");
  assert.equal(result.repositoryRoot, "/tmp/workspace");
  assert.equal(result.plan.intent, "DEV_WORKSPACE_TASK");
  assert.equal(result.maxAutomaticCorrectionCycles, 1);
  assert.equal(result.status, "COMPLETED");
});

test("exécute action et validation dans un unique terminal NOON canonique", async () => {
  const { loop, terminals } = fixture();
  const result = await loop.run(input());
  assert.equal(terminals.size, 1);
  assert.equal(result.terminalExecutionRefs.length, 2);
  assert.deepEqual(result.terminalExecutionRefs.map((item) => item.kind), ["ACTION", "VALIDATION"]);
  assert.equal(result.validationState, "PASS");
});

test("agrège Terminal Problems Git et Preview dans un snapshot déterministe", async () => {
  const { loop, session } = fixture();
  session.problems = {
    status: "READY", counts: { error: 1, warning: 2, info: 3 },
    problems: [{ file: "src/a.js", line: 2, column: 1, message: "Erreur", source: "lint" }],
  };
  const result = await loop.run(input());
  assert.equal(result.observation.terminal.exitCode, 0);
  assert.deepEqual(result.observation.problems.errors, 1);
  assert.equal(result.observation.git.changed, 2);
  assert.equal(result.observation.preview.status, "READY");
  assert.equal(result.observation.preview.url, "http://127.0.0.1:3000/");
});

test("une action rouge ne peut jamais finir SUCCESS même si la validation est verte", async () => {
  const { loop } = fixture({
    exits: [1, 0],
  });

  const result =
    await loop.run(input());

  assert.equal(
    result.status,
    "FAILED"
  );

  assert.equal(
    result.decision,
    "FAIL_STOP"
  );

  assert.equal(
    result.validationState,
    "PASS"
  );

  assert.equal(
    result.terminalExecutionRefs[0].exitCode,
    1
  );

  assert.equal(
    result.steps.find(
      (step) =>
        step.phase === "ACTION"
    )?.status,
    "FAIL"
  );
});

test("une validation rouge produit FAIL_STOP sans retry", async () => {
  const { loop } = fixture({ exits: [0, 1] });
  const result = await loop.run(input());
  assert.equal(result.status, "FAILED");
  assert.equal(result.decision, "FAIL_STOP");
  assert.equal(result.validationState, "FAIL");
  assert.equal(result.terminalExecutionRefs.length, 2);
});

test("une approbation requise bloque avant toute action", async () => {
  const prepared = [];
  const { loop, terminals } = fixture({ approval: { prepareAction: (value) => (prepared.push(value), { id: "approval-1", status: "pending", resumeToken: "secret-token" }) } });
  const result = await loop.run(input({ plan: { requiresApproval: true, actionCommand: "npm test" } }));
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.decision, "BLOCKED_APPROVAL");
  assert.equal(terminals.size, 0);
  assert.equal(prepared.length, 1);
  assert.equal(result.approvalState.resumeToken, undefined);
  assert.doesNotMatch(JSON.stringify(result), /secret-token/);
});

test("refuse deux exécutions concurrentes dans la même session", async () => {
  let release;
  const { loop } = fixture();
  const slow = new Promise((resolve) => { release = resolve; });
  const custom = createDevWorkspaceAgentExecutionLoop({
    terminalService: {
      getSession: () => ({ id: "session-1", workspaceId: "workspace-1", repositoryRoot: "/tmp/workspace" }),
      createTerminal: () => ({ id: "terminal-1" }), runCommand: () => ({ terminal: {} }),
      poll: async () => slow, closeTerminal: () => ({}), inspectGitDiff: async () => ({ counts: {} }),
    },
    operationalSecurityPolicy: { evaluate: () => ({ outcome: "ALLOW" }) },
    planner: { plan: async () => slow },
  });
  custom.start(input());
  assert.throws(() => custom.start(input()), /déjà active/);
  release({ terminal: { running: false, exitCode: 0 }, output: [] });
  assert.ok(loop);
});

test("cancel est borné au terminal NOON de l’exécution", async () => {
  let polling = true;
  const { loop, terminalService, terminals } = fixture();
  terminalService.poll = (value) => ({ terminal: { ...terminals.get(value.terminalId), running: polling }, output: [], next: 0 });
  terminalService.closeTerminal = (value) => { polling = false; terminals.get(value.terminalId).closed = true; return { closed: true }; };
  const started = loop.start(input());
  assert.equal(loop.cancel(started.executionId).cancelled, true);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(loop.get(started.executionId).status, "CANCELLED");
  assert.equal([...terminals.values()][0].closed, true);
});

test("rejette une session Workspace stale", async () => {
  const { loop, terminalService } = fixture();
  let calls = 0;
  const original = terminalService.getSession;
  terminalService.getSession = (id) => {
    const value = original(id);
    calls += 1;
    if (calls > 2) value.repositoryRoot = "/tmp/other";
    return value;
  };
  const result = await loop.run(input());
  assert.equal(result.status, "FAILED");
  assert.equal(result.stopReason, "WORKSPACE_SESSION_STALE");
});

test("ne conserve jamais stdout stderr complets ni URL Preview distante", async () => {
  const { loop } = fixture({ preview: { status: "READY", url: "https://example.com/private?token=secret" } });
  const result = await loop.run(input());
  assert.equal(result.observation.preview.url, null);
  assert.equal(result.terminalExecutionRefs[0].stdoutSummary, "AVAILABLE_REDACTED");
  assert.doesNotMatch(JSON.stringify(result), /token=secret|"text":"redacted"/i);
});

test("trace le cycle sans prompt ni sortie complète", async () => {
  const { loop, events } = fixture();
  await loop.run(input());
  for (const event of ["execution_started", "plan_ready", "action_started", "action_finished", "validation_started", "validation_finished", "observation_created", "execution_completed"]) {
    assert.ok(events.some((item) => item.event === event), event);
  }
  assert.doesNotMatch(JSON.stringify(events), /stdout|stderr|Vérifier le projet/);
});

test("n’expose aucune primitive Git ou remote mutante", () => {
  const source = require("node:fs").readFileSync(require.resolve("../services/dev/workspace-agent-execution-loop"), "utf8");
  assert.doesNotMatch(source, /\bgit\s+(?:add|commit|restore|reset|checkout|clean|push|pull|rebase)\b/i);
  assert.doesNotMatch(source, /child_process|\bspawn\s*\(|\bexec\s*\(/);
});

test("les décisions et statuts publics restent explicitement bornés", () => {
  const { loop } = fixture();
  assert.ok(loop.statuses.includes("CANCELLED"));
  assert.deepEqual(loop.decisions, ["SUCCESS", "FAIL_STOP", "BLOCKED_APPROVAL", "PROPOSE_FIX", "APPLY_SINGLE_FIX", "CANCELLED"]);
});
