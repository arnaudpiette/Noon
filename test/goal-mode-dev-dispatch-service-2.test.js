"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  createDevTaskJournal,
  createGoalModeDevDispatchService,
  createNativeDevOrchestratorFacade,
  deterministicGoalModeDevTaskId,
  fixture,
  resume,
} = require("./helpers/goal-mode-dev-dispatch-service-fixtures");

test("journal fiable : prepare refusé dès la réservation si le journal connaît déjà la tâche", () => {
  for (const [state, code] of [
    ["PRESENT", "GOAL_MODE_EXECUTION_JOURNAL_ENGAGED"],
    ["UNREADABLE", "GOAL_MODE_EXECUTION_JOURNAL_UNREADABLE"],
  ]) {
    const f = fixture();
    try {
      const taskId = deterministicGoalModeDevTaskId(
        f.running.state.runId, "step-dispatch", `sha256:${"a".repeat(64)}`
      );
      f.journalStates.set(taskId, state);
      assert.throws(() => f.prepare(f.makeService()), { code }, state);
      assert.equal(f.latest().state.executionReservations, undefined, state);
      assert.equal(f.latest().revision, f.running.revision, state);
    } finally { f.close(); }
  }
  const g = fixture();
  try {
    const { devTaskJournal, ...withoutJournal } = {
      runStore: g.storeA, goalStrategyEngine: g.goalStrategyEngine,
      devBudgetService: { effectiveRemaining: () => 1, taskProviderCalls: () => 0 },
      permissionSource: { current: () => ({}) }, dispatcher: g.dispatcher,
      approvalEngine: g.approvalEngine, devTaskJournal: g.devTaskJournal,
    };
    assert.ok(devTaskJournal);
    assert.throws(() => createGoalModeDevDispatchService(withoutJournal), TypeError);
  } finally { g.close(); }
});

test("journal fiable : intégration façade réelle — CAS avant l'enregistrement de démarrage", async () => {
  const f = fixture();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noon-goal-journal-"));
  try {
    const journal = createDevTaskJournal({ directory });
    const seen = [];
    const facade = createNativeDevOrchestratorFacade({
      journal,
      featureMode: () => "LIMITED",
      orchestrator: {
        async runTask(input) {
          seen.push({
            reservation: f.status(),
            journal: journal.lookup(input.taskId).record?.state,
          });
          return {
            taskId: input.taskId, status: "COMPLETED", finalVerdict: "PASS", failureCategory: null,
            startedAt: "2026-10-13T12:00:03.000Z", endedAt: "2026-10-13T12:00:04.000Z",
            implementation: { backendReached: true, providerCalls: [], validations: [] },
            review: { finalVerdict: "PASS", changedFiles: [], validations: [] },
          };
        },
        getTaskStatus() { return null; },
        cancelTask() { return { cancelled: false }; },
      },
    });
    const service = f.makeService(f.storeA, { dispatcher: facade, devTaskJournal: journal });
    const prepared = f.prepare(service);
    assert.equal(journal.lookup(prepared.ticket.taskId).status, "ABSENT");
    await resume(service, prepared);
    assert.deepEqual(seen, [{ reservation: "MAY_HAVE_STARTED", journal: "CLAIMED" }]);
    assert.equal(journal.load(prepared.ticket.taskId).state, "PASS");
    assert.equal(f.status(), "MAY_HAVE_STARTED");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
    f.close();
  }
});

test("journal fiable : crash entre CAS et façade → MAY_HAVE_STARTED avec journal ABSENT (preuve pour 4C-2)", async () => {
  const f = fixture();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noon-goal-journal-"));
  try {
    const journal = createDevTaskJournal({ directory });
    let facadeCalls = 0;
    const facade = { async runTask() { facadeCalls += 1; } };
    const crashing = Object.freeze({
      ...f.storeA,
      markExecutionMayHaveStarted(...args) {
        f.storeA.markExecutionMayHaveStarted(...args);
        throw Object.assign(new Error("synthetic crash"), { code: "SYNTHETIC_CRASH" });
      },
    });
    const service = f.makeService(crashing, { dispatcher: facade, devTaskJournal: journal });
    const prepared = f.prepare(service);
    await assert.rejects(() => resume(service, prepared), { code: "SYNTHETIC_CRASH" });
    assert.equal(facadeCalls, 0);
    assert.equal(f.status(), "MAY_HAVE_STARTED");
    assert.equal(createDevTaskJournal({ directory }).lookup(prepared.ticket.taskId).status, "ABSENT");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
    f.close();
  }
});

test("B1 règles projet : résolues au prepare, liées au binding v2, envoyées à l'identique", async () => {
  const { rulesFingerprint } = require("../services/goals/goal-mode-dev-approval-action");
  const f = fixture();
  try {
    f.rules.list = ["Ne jamais pousser automatiquement.", "Préserver la structure."];
    const service = f.makeService();
    const prepared = f.prepare(service);
    assert.deepEqual({ ...f.rules.lastInput, constraints: [...f.rules.lastInput.constraints] },
      { workspaceId: "workspace-1", projectId: "project-1", constraints: [] });
    const exact = f.approvalEngine.getPreparedGoalModeDevDispatchExactAction({
      approvalId: prepared.approval.id, resumeToken: prepared.resumeToken,
    });
    assert.equal(exact.normalizedArgs.rulesFingerprint, rulesFingerprint(f.rules.list));
    assert.deepEqual([...prepared.display.projectRules], f.rules.list);
    await resume(service, prepared);
    assert.deepEqual(f.calls[0].payload.projectInstructions, f.rules.list);
    f.calls[0].payload.projectInstructions.push("forged");
    assert.deepEqual([...prepared.display.projectRules], ["Ne jamais pousser automatiquement.", "Préserver la structure."]);
    // Rien des règles n'est persisté (approbation, audit, état du run).
    const persisted = JSON.stringify([f.approvalRow(prepared.approval.id), f.audit, f.latest().state]);
    assert.equal(persisted.includes("Ne jamais pousser"), false);
  } finally { f.close(); }
});

test("B1 règles modifiées après l'approbation : RULES_CHANGED au pré-contrôle, approbation intacte, sans CAS", async () => {
  const f = fixture();
  try {
    const service = f.makeService();
    const prepared = f.prepare(service);
    f.rules.list = ["SYNTHETIC_PROJECT_RULE", "NEW_RULE"];
    await assert.rejects(() => resume(service, prepared), { code: "GOAL_MODE_DEV_DISPATCH_RULES_CHANGED" });
    assert.equal(f.approvalRow(prepared.approval.id).status, "pending");
    assert.equal(f.status(), "PREPARED");
    assert.equal(f.calls.length, 0);
    f.rules.list = ["SYNTHETIC_PROJECT_RULE"];
    f.rules.throws = true;
    await assert.rejects(() => resume(service, prepared), { code: "GOAL_MODE_DEV_DISPATCH_RULES_UNAVAILABLE" });
    assert.equal(f.status(), "PREPARED");
    // Règles rétablies à l'identique : la même approbation reste utilisable.
    f.rules.throws = false;
    await resume(service, prepared);
    assert.equal(f.calls.length, 1);
  } finally { f.close(); }
});

test("B1 règles modifiées entre préconditions et recheck interne : refus avant consommation et CAS", async () => {
  const f = fixture();
  try {
    const service = f.makeService();
    const prepared = f.prepare(service);
    const base = f.rules.calls;
    // Appels : pré-contrôle (+1), préconditions (+2), recheck interne (+3).
    f.rules.onResolve = (calls) => {
      if (calls === base + 3) f.rules.list = ["CHANGED_BEFORE_CAS"];
    };
    await assert.rejects(() => resume(service, prepared), { code: "GOAL_MODE_DEV_DISPATCH_RULES_CHANGED" });
    assert.equal(f.approvalRow(prepared.approval.id).status, "failed");
    assert.equal(f.status(), "PREPARED");
    assert.equal(f.calls.length, 0);
  } finally { f.close(); }

  const g = fixture();
  try {
    const service = g.makeService();
    const prepared = g.prepare(service);
    const base = g.rules.calls;
    // Changement visible dès les préconditions : approval_stale.
    g.rules.onResolve = (calls) => {
      if (calls === base + 2) g.rules.list = ["CHANGED_AT_PRECONDITIONS"];
    };
    await assert.rejects(() => resume(service, prepared), { code: "approval_stale" });
    assert.equal(g.status(), "PREPARED");
    assert.equal(g.calls.length, 0);
  } finally { g.close(); }
});

test("B1 règles indisponibles ou invalides au prepare : réservation à libérer, aucune approbation", () => {
  for (const setup of [
    (f) => { f.rules.throws = true; },
    (f) => { f.rules.list = [42]; },
    (f) => { f.rules.list = ["  "]; },
    (f) => { f.rules.list = Array.from({ length: 21 }, (_, index) => `rule-${index}`); },
    (f) => { f.rules.list = ["x".repeat(2_001)]; },
  ]) {
    const f = fixture();
    try {
      setup(f);
      assert.throws(() => f.prepare(f.makeService()), (error) =>
        error.code === "GOAL_MODE_DEV_DISPATCH_RULES_UNAVAILABLE" && error.details.releaseRequired === true);
      assert.equal(f.status(), "PREPARED");
      assert.equal(f.audit.some((item) => item.event === "approval.created"), false);
    } finally { f.close(); }
  }
});
