"use strict";

// Dossiers temporaires uniquement ; fournisseur factice, aucun appel payant.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createGoalModeDevRuntime } = require("../services/goals/goal-mode-dev-runtime");
const { createGoalModeRunContract } = require("../services/goals/goal-mode-run-contract");
const { createPersonalDatabase } = require("../services/persistence/database");
const { createApprovalEngine } = require("../services/approvals/approval-engine");
const { createDevTaskJournal } = require("../services/dev/dev-task-journal");
const { createOperationalSecurityPolicy } = require("../services/security/operational-security-policy");
const { reportInterruptedNativeDevTasks } = require("../services/dev/native-dev-interrupted-report");

function harness(overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noon-b1-runtime-"));
  const writable = path.join(directory, "rw");
  const repository = path.join(writable, "repo");
  const readOnly = path.join(directory, "read-only");
  fs.mkdirSync(repository, { recursive: true });
  fs.mkdirSync(readOnly);
  const database = createPersonalDatabase(path.join(directory, "personal.sqlite"));
  const events = [];
  const facadeCalls = [];
  const providerCalls = [];
  const flags = { "dev.native-core": "LIMITED" };
  const workspace = {
    workspace: { id: "workspace-1", status: "active", profileScope: "arnaud" },
    projects: [{ id: "project-1", rootPath: repository }],
    relevantRoots: [
      { path: writable, mode: "read-write" },
      { path: readOnly, mode: "read-only" },
    ],
  };
  const deps = {
    database,
    goalStrategyEngine: { registry: { get: () => null, list: () => [] } },
    workspaceEngine: { context: (id) => (id === "workspace-1" ? workspace : null) },
    devBudgetService: { effectiveRemaining: () => 10, taskProviderCalls: () => 0 },
    devTaskJournal: createDevTaskJournal({ directory: path.join(directory, "journal") }),
    approvalEngine: createApprovalEngine({}),
    operationalSecurityPolicy: createOperationalSecurityPolicy(),
    projectRuleResolver: {
      resolve(input) {
        events.push({ event: "rules", input });
        return { applied: [{ text: "  Règle A  " }, { text: "" }, { text: "Règle B" }] };
      },
    },
    nativeDevFacade: {
      runTask: async (payload) => { facadeCalls.push(["runTask", payload]); return { taskId: payload.taskId }; },
      cancelTask: (taskId) => { facadeCalls.push(["cancelTask", taskId]); return { cancelled: true }; },
      getTaskStatus: (taskId) => { facadeCalls.push(["getTaskStatus", taskId]); return null; },
    },
    featureMode: (flagId) => flags[flagId] || "OFF",
    selectModelRoute: () => { providerCalls.push("route"); return {}; },
    estimateCost: () => 0,
    authorizePrivacy: () => ({ allowed: false }),
    providerAdapter: {
      provider: "synthetic-provider",
      async execute() { providerCalls.push("provider"); throw new Error("no paid call"); },
    },
    observability: (event, metadata) => events.push({ event, metadata }),
    ...overrides,
  };
  return {
    directory, repository, readOnly, database, events, facadeCalls, providerCalls, flags, workspace, deps,
    close() { database.close(); fs.rmSync(directory, { recursive: true, force: true }); },
  };
}

test("B1 runtime : composition complète sur les modules canoniques, persistance atomique", () => {
  const h = harness();
  try {
    const runtime = createGoalModeDevRuntime(h.deps);
    assert.equal(Object.isFrozen(runtime), true);
    for (const key of ["runStore", "stepProposalStore", "nextStepPlanner", "planningCallService",
      "durablePlanningService", "stepAdmissionService", "devProjectionService", "dispatchService",
      "permissionSource", "projectRulesResolver"]) {
      assert.ok(runtime[key], key);
    }
    const persistence = runtime.persistenceCapabilities();
    assert.equal(persistence.backend, "SQLITE");
    assert.equal(persistence.atomicRevisionCas, true);
    assert.deepEqual(Object.keys(runtime.dispatchService).sort(), [
      "cancelExecution", "executionStatus", "pauseRun", "prepare", "renewApproval",
      "resume", "resumeRun", "stopRun",
    ]);
    const composed = h.events.find((item) => item.event === "goal_mode_dev.runtime_composed");
    assert.ok(composed);
    assert.equal(composed.metadata.persistence.backend, "SQLITE");
    // Composer n'appelle ni fournisseur ni Native DEV.
    assert.deepEqual(h.providerCalls, []);
    assert.deepEqual(h.facadeCalls, []);
  } finally { h.close(); }
});

test("B1 runtime : la réservation exacte passe par la projection canonique composée", () => {
  const h = harness();
  try {
    const runtime = createGoalModeDevRuntime(h.deps);
    const contract = createGoalModeRunContract({
      goal: {
        goalId: "goal-b1", title: "Goal B1", status: "ACTIVE", outcomeDefinition: "B1",
        successCriteria: [{ criterionId: "c-1", type: "BOOLEAN", targetValue: true }],
        linkedProjectIds: [], linkedWorkspaceIds: [], constraints: [],
        profileScope: "arnaud", sensitivity: "NORMAL", userConfirmed: true, version: 1,
      },
      request: {
        userConfirmed: true,
        limits: { maxSteps: 2, maxRetries: 0, maxProviderCalls: 2, maxDuration: 600_000, maxEstimatedCost: 1 },
        capabilityCeilings: { network: true, gitWrite: false, destructiveActions: false },
      },
      now: () => new Date("2026-10-13T12:00:00.000Z"), idFactory: () => "goal-run-b1",
    });
    const created = runtime.runStore.create(contract);
    const running = runtime.runStore.transition(created.state.runId, "RUNNING", {
      expectedRevision: created.revision, transitionedAt: "2026-10-13T12:00:01.000Z",
    });
    // Sans proposition admise, la projection canonique refuse : ni « non composé »,
    // ni « projection requise », et aucune réservation n'est écrite.
    assert.throws(() => runtime.runStore.reserveExecutionWithExactProjection(running.state.runId, {
      expectedRevision: running.revision, stepId: "step-missing",
    }), (error) => typeof error.code === "string" &&
      !["GOAL_MODE_DEV_RUNTIME_NOT_READY", "GOAL_MODE_EXECUTION_PROJECTION_REQUIRED"].includes(error.code));
    assert.equal(runtime.runStore.get(running.state.runId).revision, running.revision);
    assert.deepEqual(h.providerCalls, []);
  } finally { h.close(); }
});

test("B1 permissions vivantes : écriture par racine read-write, réseau = sécurité ∩ dev.native-core", () => {
  const h = harness();
  try {
    const { permissionSource } = createGoalModeDevRuntime(h.deps);
    const base = { runId: "r", stepId: "s", taskId: "t", workspaceId: "workspace-1", projectId: "project-1" };
    const allowed = permissionSource.current({ ...base, repositoryRoot: h.repository });
    assert.deepEqual({ ...allowed }, { network: true, repositoryWrite: true, gitWrite: false, destructiveActions: false });
    assert.equal(Object.isFrozen(allowed), true);
    assert.equal(permissionSource.current({ ...base, repositoryRoot: h.readOnly }).repositoryWrite, false);
    assert.equal(permissionSource.current({ ...base, repositoryRoot: os.tmpdir() }).repositoryWrite, false);
    assert.equal(permissionSource.current({ ...base, repositoryRoot: path.join(h.directory, "missing") }).repositoryWrite, false);
    assert.equal(permissionSource.current({ ...base, repositoryRoot: h.directory }).repositoryWrite, false);
    // dev.native-core autre que LIMITED : pas de réseau (la façade refuserait après le CAS).
    h.flags["dev.native-core"] = "OFF";
    assert.equal(permissionSource.current({ ...base, repositoryRoot: h.repository }).network, false);
    h.flags["dev.native-core"] = "LIMITED";
    // Workspace absent ou sans profil : tout refusé.
    assert.deepEqual({ ...permissionSource.current({ ...base, workspaceId: "other", repositoryRoot: h.repository }) },
      { network: false, repositoryWrite: false, gitWrite: false, destructiveActions: false });
    const profile = h.workspace.workspace.profileScope;
    h.workspace.workspace.profileScope = "";
    assert.equal(permissionSource.current({ ...base, repositoryRoot: h.repository }).network, false);
    h.workspace.workspace.profileScope = profile;
  } finally { h.close(); }

  for (const evaluate of [
    () => ({ outcome: "DENY" }),
    () => ({ outcome: "UNAVAILABLE" }),
    () => ({}),
    () => { throw new Error("policy down"); },
  ]) {
    const g = harness({
      operationalSecurityPolicy: { createActionRequest: (input) => input, evaluate },
    });
    try {
      const { permissionSource } = createGoalModeDevRuntime(g.deps);
      const live = permissionSource.current({
        runId: "r", stepId: "s", taskId: "t", workspaceId: "workspace-1", projectId: "project-1",
        repositoryRoot: g.repository,
      });
      assert.equal(live.network, false);
      assert.equal(live.repositoryWrite, true);
      assert.equal(live.gitWrite, false);
      assert.equal(live.destructiveActions, false);
    } finally { g.close(); }
  }
});

test("B1 règles projet : workspace autoritatif, profil propriétaire, textes bornés", () => {
  const h = harness();
  try {
    const { projectRulesResolver } = createGoalModeDevRuntime(h.deps);
    const rules = projectRulesResolver.resolve({
      workspaceId: "workspace-1", projectId: "project-1", constraints: ["GOAL_CONSTRAINT_HARD: x"],
    });
    assert.deepEqual(rules, ["Règle A", "Règle B"]);
    const call = h.events.find((item) => item.event === "rules");
    assert.deepEqual(call.input, {
      projectId: "project-1", ownerProfileScope: "arnaud", taskRestrictions: ["GOAL_CONSTRAINT_HARD: x"],
    });
    for (const input of [
      { workspaceId: "other", projectId: "project-1" },
      { workspaceId: "workspace-1", projectId: "project-unlinked" },
    ]) {
      assert.throws(() => projectRulesResolver.resolve(input), { code: "GOAL_MODE_DEV_RULES_UNRESOLVED" });
    }
  } finally { h.close(); }
  const many = harness({
    projectRuleResolver: { resolve: () => ({ applied: Array.from({ length: 30 }, (_, i) => ({ text: `r${i}` })) }) },
  });
  try {
    const { projectRulesResolver } = createGoalModeDevRuntime(many.deps);
    assert.equal(projectRulesResolver.resolve({ workspaceId: "workspace-1", projectId: "project-1" }).length, 20);
  } finally { many.close(); }
});

test("B1 dépendances requises : refus de composer sans journal, approbations, façade complète ou flags", () => {
  const h = harness();
  try {
    for (const key of ["database", "devTaskJournal", "approvalEngine", "operationalSecurityPolicy",
      "projectRuleResolver", "nativeDevFacade", "featureMode", "devBudgetService", "workspaceEngine"]) {
      assert.throws(() => createGoalModeDevRuntime({ ...h.deps, [key]: null }), TypeError, key);
    }
    assert.throws(() => createGoalModeDevRuntime({
      ...h.deps, nativeDevFacade: { runTask: async () => ({}) },
    }), TypeError);
  } finally { h.close(); }
});

test("B1 signalement des tâches interrompues : compteurs seulement, aucune action", () => {
  const audit = [];
  const summary = reportInterruptedNativeDevTasks({
    sources: [
      { name: "b3", recover: () => [
        { taskId: "task-1", status: "INTERRUPTED", objective: "SYNTHETIC_PRIVATE_OBJECTIVE" },
        { taskId: null, status: "JOURNAL_UNREADABLE", file: "task-abc.json" },
      ] },
      { name: "coordinator", recover: () => [] },
      { name: "broken", recover: () => { throw Object.assign(new Error("x"), { code: "SCAN_EIO" }); } },
    ],
    audit: (event, metadata) => audit.push({ event, metadata }),
  });
  assert.deepEqual(summary.map((item) => ({ ...item })), [
    { source: "b3", interrupted: 1, unreadable: 1, requiresUserDecision: true },
    { source: "coordinator", interrupted: 0, unreadable: 0, requiresUserDecision: false },
    { source: "broken", failed: true, code: "SCAN_EIO" },
  ]);
  assert.deepEqual(audit.map((item) => item.event), [
    "dev.native_interrupted_at_startup", "dev.native_interrupted_at_startup", "dev.native_interrupted_scan_failed",
  ]);
  const serialized = JSON.stringify(audit);
  for (const secret of ["task-1", "task-abc.json", "SYNTHETIC_PRIVATE_OBJECTIVE"]) {
    assert.equal(serialized.includes(secret), false, secret);
  }
  assert.throws(() => reportInterruptedNativeDevTasks({ sources: [] }), TypeError);
});

test("B1 câblage serveur : flag OFF par défaut, composition protégée, signalement au démarrage hors safe mode", () => {
  const { FEATURE_FLAGS } = require("../services/config/feature-flag-registry");
  const flag = FEATURE_FLAGS.find((item) => item.flagId === "goals.mode-dev");
  assert.ok(flag);
  assert.equal(flag.defaultMode, "OFF");
  assert.deepEqual(flag.allowedModes, ["OFF", "LIMITED"]);
  assert.deepEqual([...flag.requires].sort(), ["dev.native-core", "goals.engine"]);
  const source = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const start = source.indexOf("let goalModeDevRuntime = null;");
  assert.notEqual(start, -1);
  const block = source.slice(start, source.indexOf('"goals.dev-retry.runtime_composed"', start));
  assert.match(block, /try \{\s*if \(featureFlags\.evaluate\("goals\.mode-dev", \{\}\)\.mode !== "OFF"\) \{\s*goalModeDevRuntime = createGoalModeDevRuntime\(\{/);
  for (const dependency of ["database: personalDatabase", "devTaskJournal: nativeDevJournal",
    "approvalEngine: approvalManager", "projectRuleResolver: devProjectRuleResolver",
    "nativeDevFacade: nativeDevB3Facade", "devBudgetService: devCostBudgetService"]) {
    assert.ok(block.includes(dependency), dependency);
  }
  assert.match(block, /catch \(error\) \{\s*goalModeDevRuntime = null;\s*toolAuditLog\.append\("goals\.mode-dev\.runtime_unavailable"/);
  // Aucune route Goal Mode DEV en B1.
  assert.equal(/goalModeDevRuntime\s*\.\s*dispatchService/.test(source), false);
  assert.equal(/\/api\/goals\/mode-dev/.test(source), false);
  // Signalement unique au démarrage, hors safe mode, B3 et coordinateur.
  const startup = source.slice(source.indexOf("await reliabilityEngine.diagnose();"));
  assert.match(startup, /if \(!nativeDevInterruptedReported && process\.env\.NOON_SAFE_MODE !== "1"\) \{\s*nativeDevInterruptedReported = true;\s*reportInterruptedNativeDevTasks\(/);
  assert.match(startup.slice(0, 900), /nativeDevB3Facade\.recoverInterrupted\(\)/);
  assert.match(startup.slice(0, 900), /nativeDevCoordinator\.recoverInterrupted\(\)/);
});
