"use strict";

// Dossiers temporaires uniquement : le vrai dev-task-journal/ n'est jamais ouvert.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { readServerSource } = require("./helpers/server-source");

const { createNativeDevOrchestratorFacade } = require("../services/dev/native-dev-orchestrator-facade");
const { createDevTaskJournal, hashedJournalName } = require("../services/dev/dev-task-journal");

function completedTask(taskId) {
  return {
    taskId, status: "COMPLETED", finalVerdict: "PASS", failureCategory: null,
    startedAt: "2026-09-28T08:00:00.000Z", endedAt: "2026-09-28T08:00:01.000Z",
    analysis: { contract: { requiredQuality: "NORMAL" }, preflight: { branch: "main", snapshot: { files: [] } } },
    baseline: [],
    implementation: { solved: true, backendReached: true, iterations: [], providerCalls: [], validations: [] },
    review: {
      finalVerdict: "PASS", failureCategory: null, preExistingChanges: [], preExistingChangesPreserved: true,
      changedFiles: [], validations: [], diffReview: { valid: true, issues: [] },
      diffCheck: { command: "git diff --check", status: "PASS" },
    },
  };
}

function harness(orchestratorOverrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noon-facade-journal-"));
  const journal = createDevTaskJournal({ directory });
  const calls = [];
  const orchestrator = {
    async runTask(input) {
      calls.push(input.taskId);
      return completedTask(input.taskId);
    },
    getTaskStatus() { return null; },
    cancelTask() { return { cancelled: false }; },
    ...orchestratorOverrides,
  };
  const facade = createNativeDevOrchestratorFacade({ orchestrator, journal, featureMode: () => "LIMITED" });
  return {
    directory, journal, facade, calls,
    close() {
      try { fs.chmodSync(directory, 0o700); } catch {}
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

test("façade : enregistrement de démarrage écrit avant tout await, puis état terminal", async () => {
  let observed = null;
  let h = null;
  h = harness({
    async runTask(input) {
      // Première instruction de l'orchestrateur : la trace existe déjà sur disque.
      observed = createDevTaskJournal({ directory: h.directory }).lookup(input.taskId);
      return completedTask(input.taskId);
    },
  });
  try {
    const pending = h.facade.runTask({ taskId: "task-claim", objective: "SYNTHETIC_PRIVATE_OBJECTIVE", workspaceId: "w" });
    // Synchrone : présent avant même que l'orchestrateur ne s'exécute.
    assert.equal(h.journal.lookup("task-claim").status, "PRESENT");
    const result = await pending;
    assert.equal(result.finalVerdict, "PASS");
    assert.equal(observed.status, "PRESENT");
    assert.equal(observed.record.state, "CLAIMED");
    const record = h.journal.load("task-claim");
    assert.equal(record.state, "PASS");
    assert.equal(record.finalVerdict, "PASS");
    assert.equal(record.source, "B3");
    assert.equal(fs.readFileSync(path.join(h.directory, hashedJournalName("task-claim")), "utf8")
      .includes("SYNTHETIC_PRIVATE_OBJECTIVE"), false);
  } finally { h.close(); }
});

test("façade : taskId déjà connu ou journal illisible → aucun lancement", async () => {
  const h = harness();
  try {
    h.journal.claim("task-known");
    const known = await h.facade.runTask({ taskId: "task-known", objective: "x" });
    assert.equal(known.finalVerdict, "FAIL");
    assert.equal(known.failureCategory, "DEV_TASK_ALREADY_EXISTS");
    fs.writeFileSync(path.join(h.directory, hashedJournalName("task-corrupt")), "{broken");
    const corrupt = await h.facade.runTask({ taskId: "task-corrupt", objective: "x" });
    assert.equal(corrupt.failureCategory, "DEV_TASK_JOURNAL_UNAVAILABLE");
    assert.deepEqual(h.calls, []);
    assert.equal(fs.readFileSync(path.join(h.directory, hashedJournalName("task-corrupt")), "utf8"), "{broken");
  } finally { h.close(); }
});

test("façade : échec ou annulation pendant l'analyse laissent une trace terminale", async () => {
  for (const [status, expected] of [["FAILED", "FAIL"], ["CANCELLED", "CANCELLED"]]) {
    const tasks = new Map();
    const h = harness({
      async runTask(input) {
        tasks.set(input.taskId, { taskId: input.taskId, status, finalVerdict: null, failureCategory: `ANALYSIS_${status}` });
        throw Object.assign(new Error("analysis"), { code: `ANALYSIS_${status}` });
      },
      getTaskStatus(taskId) { return tasks.get(taskId) || null; },
    });
    try {
      await h.facade.runTask({ taskId: "task-analysis", objective: "x" });
      const record = h.journal.load("task-analysis");
      assert.equal(record.state, expected, status);
      assert.equal(record.finalVerdict, expected, status);
      assert.equal(h.journal.interrupted().length, 0, status);
    } finally { h.close(); }
  }
  // Exception sans état orchestrateur : FAIL avec le code d'erreur.
  const h = harness({ async runTask() { throw Object.assign(new Error("x"), { code: "SYNTHETIC_BOOM" }); } });
  try {
    await h.facade.runTask({ taskId: "task-boom", objective: "x" });
    const record = h.journal.load("task-boom");
    assert.equal(record.finalVerdict, "FAIL");
    assert.equal(record.failureCategory, "SYNTHETIC_BOOM");
  } finally { h.close(); }
});

test("façade : après redémarrage, la trace persiste et la relance du même taskId est refusée", async () => {
  const h = harness();
  try {
    await h.facade.runTask({ taskId: "task-restart", objective: "x" });
    const restartedCalls = [];
    const restarted = createNativeDevOrchestratorFacade({
      orchestrator: {
        async runTask(input) { restartedCalls.push(input.taskId); return completedTask(input.taskId); },
        getTaskStatus() { return null; },
        cancelTask() { return { cancelled: false }; },
      },
      journal: createDevTaskJournal({ directory: h.directory }),
      featureMode: () => "LIMITED",
    });
    assert.equal(restarted.getTaskStatus("task-restart").state, "PASS");
    const again = await restarted.runTask({ taskId: "task-restart", objective: "x" });
    assert.equal(again.failureCategory, "DEV_TASK_ALREADY_EXISTS");
    assert.deepEqual(restartedCalls, []);
  } finally { h.close(); }
});

test("façade : statut et récupération explicites quand le journal est illisible", () => {
  const h = harness();
  try {
    fs.writeFileSync(path.join(h.directory, hashedJournalName("task-bad")), "{bad");
    assert.deepEqual(h.facade.getTaskStatus("task-bad"), {
      taskId: "task-bad", status: "JOURNAL_UNREADABLE", finalVerdict: null, failureCategory: "JOURNAL_UNREADABLE",
    });
    assert.equal(h.facade.getTaskStatus("task-missing"), null);
    const recovered = h.facade.recoverInterrupted();
    assert.deepEqual(recovered, [{
      taskId: null, status: "JOURNAL_UNREADABLE", finalVerdict: null, failureCategory: "JOURNAL_UNREADABLE",
      file: hashedJournalName("task-bad"), requiresUserDecision: true,
    }]);
  } finally { h.close(); }
});

test("câblage serveur : la façade B3 reçoit le journal persistant réel", () => {
  const source = readServerSource();
  assert.match(source, /const nativeDevJournal = createDevTaskJournal\(\{ directory: path\.join\(DATA_DIRECTORY, "dev-task-journal"\) \}\);/);
  const start = source.indexOf("const nativeDevB3Facade = createNativeDevOrchestratorFacade({");
  assert.notEqual(start, -1);
  assert.match(source.slice(start, start + 300), /journal: nativeDevJournal/);
});
