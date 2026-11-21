"use strict";

// Bout en bout au niveau transport : vrai serveur HTTP de test, vrai runtime,
// SQLite et journal temporaires, fournisseur et façade factices.
// Aucun appel payant, aucun point d'injection dans server.js.

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createGoalModeDevRuntime } = require("../services/goals/goal-mode-dev-runtime");
const { createGoalModeDevHttpHandler } = require("../services/goals/goal-mode-dev-http-routes");
const { readJsonBody } = require("../services/http/request-utils");
const { createPersonalDatabase } = require("../services/persistence/database");
const { createApprovalEngine } = require("../services/approvals/approval-engine");
const { createDevTaskJournal } = require("../services/dev/dev-task-journal");
const { createOperationalSecurityPolicy } = require("../services/security/operational-security-policy");
const { createDataDirectoryLock, LOCK_FILE } = require("../services/runtime/data-directory-lock");
const { createGoalModeDevLockMaintenance } = require("../services/goals/goal-mode-dev-lock-maintenance");

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function goalFixture(overrides = {}) {
  const criterion = (criterionId, description) => ({
    criterionId, description, type: "BOOLEAN", targetValue: true, currentValue: false,
    status: "NOT_MET", evidenceRefs: [],
  });
  return {
    goalId: "goal-b2", title: "SYNTHETIC_GOAL_TITLE", status: "ACTIVE",
    outcomeDefinition: "Valider le transport Goal Mode DEV.",
    successCriteria: [criterion("criterion-global", "Transport validé.")],
    milestones: [{
      milestoneId: "milestone-1", goalId: "goal-b2", title: "Étape B2", description: "Étape transport.",
      status: "IN_PROGRESS", dependencies: [], linkedProjectIds: ["project-b2"],
      completionCriteria: [criterion("criterion-m1", "Étape faite.")], evidenceRefs: [],
    }],
    linkedProjectIds: ["project-b2"], linkedWorkspaceIds: ["workspace-b2"], constraints: [],
    profileScope: "arnaud", sensitivity: "NORMAL", userConfirmed: true, version: 3,
    ...overrides,
  };
}

async function harness({ goal = goalFixture(), realLock = false, proposalNetwork = true } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noon-b2-transport-"));
  const writable = path.join(directory, "rw");
  const repository = path.join(writable, "repo");
  fs.mkdirSync(repository, { recursive: true });
  git(repository, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(repository, "target.js"), "module.exports = 1;\n");
  git(repository, "add", "target.js");
  git(repository, "-c", "user.name=Synthetic", "-c", "user.email=synthetic@example.invalid",
    "-c", "commit.gpgsign=false", "commit", "-q", "-m", "init");
  const repositoryRoot = fs.realpathSync(repository);
  const database = createPersonalDatabase(path.join(directory, "personal.sqlite"));
  const state = {
    enabled: true, preference: "BALANCED", ledgerCalls: 0, providerCalls: 0, ledgerEntries: [],
    // Façade factice réaliste (4C-2) : NORMAL | SKIP_CLAIM (feature gate) | INTERRUPT.
    facadeMode: "NORMAL", facadeCalls_: 0, callCost: { estimatedCost: 0.06, actualCost: 0.05 }, unknownPending: false,
    facadeCalls: [], cancels: [], gate: null, audit: [],
  };
  const workspace = {
    workspace: { id: "workspace-b2", status: "active", profileScope: "arnaud" },
    projects: [{ id: "project-b2", rootPath: repositoryRoot }],
    relevantRoots: [{ path: writable, mode: "read-write" }],
  };
  const journal = createDevTaskJournal({ directory: path.join(directory, "journal") });
  state.clockOffset = 0;
  state.events = [];
  // Construit un runtime sur ces données ; appelé à nouveau pour simuler un redémarrage.
  const makeRuntime = (databaseHandle, lock = { isHeld: () => state.lockHeld === true }) => createGoalModeDevRuntime({
    database: databaseHandle,
    dataDirectoryLock: lock,
    now: () => new Date(Date.now() + state.clockOffset),
    observability: (event, metadata) => state.events.push({ event, metadata }),
    goalStrategyEngine: { registry: { get: (goalId) => (goalId === goal.goalId ? goal : null), list: () => [goal] } },
    workspaceEngine: { context: (id) => (id === "workspace-b2" ? workspace : null) },
    // Ledger factice : entrées contrôlables par taskId (4C-2).
    devBudgetService: {
      effectiveRemaining: () => 10,
      taskProviderCalls: (taskId) => state.ledgerCalls +
        state.ledgerEntries.filter((entry) => entry.taskId === taskId && entry.status !== "RELEASED").length,
      entries: () => state.ledgerEntries.map((entry) => ({ ...entry })),
    },
    devTaskJournal: journal,
    approvalEngine: createApprovalEngine({}),
    operationalSecurityPolicy: createOperationalSecurityPolicy(),
    projectRuleResolver: { resolve: () => ({ applied: [{ text: "SYNTHETIC_PROJECT_RULE_B2" }] }) },
    nativeDevFacade: {
      async runTask(payload) {
        state.facadeCalls.push(payload);
        // Processus bloqué avant la réservation de démarrage (jamais résolu).
        if (state.facadeMode === "HANG_BEFORE_CLAIM") return new Promise(() => {});
        if (state.facadeMode === "SKIP_CLAIM") {
          // Feature gate désactivé : retour avant la réservation de démarrage.
          return { taskId: payload.taskId, status: "FAILED", finalVerdict: "FAIL", failureCategory: "FEATURE_DISABLED" };
        }
        journal.claim(payload.taskId, { source: "B3" });
        state.ledgerEntries.push({ taskId: payload.taskId, status: "RECONCILED", ...state.callCost });
        if (state.facadeMode === "HANG_AFTER_CLAIM") return new Promise(() => {});
        if (state.reservedLeftover) {
          state.ledgerEntries.push({ taskId: payload.taskId, status: "RESERVED", estimatedCost: 0.03, actualCost: null });
        }
        if (state.unknownPending) {
          state.ledgerEntries.push({ taskId: payload.taskId, status: "UNKNOWN_PENDING_RECONCILIATION", estimatedCost: 0.07, actualCost: null });
        }
        if (state.gate) await state.gate.promise;
        if (state.facadeMode === "INTERRUPT") throw Object.assign(new Error("interrupted"), { code: "SYNTHETIC_INTERRUPT" });
        const cancelled = state.cancels.includes(payload.taskId);
        journal.finish(payload.taskId, cancelled ? "CANCELLED" : "PASS", cancelled ? "CANCELLED" : null);
        const calls = state.ledgerEntries.filter((entry) => entry.taskId === payload.taskId)
          .map(() => ({ provider: "openai", model: "synthetic-model" }));
        return {
          taskId: payload.taskId, status: cancelled ? "CANCELLED" : "COMPLETED",
          finalVerdict: cancelled ? "CANCELLED" : "PASS", metrics: { providerCalls: calls },
        };
      },
      cancelTask(taskId) { state.cancels.push(taskId); return { cancelled: true }; },
      getTaskStatus() { return { status: "RUNNING", finalVerdict: null, failureCategory: null }; },
    },
    featureMode: () => "LIMITED",
    selectModelRoute: () => ({
      provider: "openai", model: "synthetic-model", effort: "medium", verbosity: "low",
      estimatedCost: { status: "available", total: 0.2 },
    }),
    estimateCost: () => ({ status: "available", total: 0.15 }),
    authorizePrivacy: () => { state.privacyCalls = (state.privacyCalls || 0) + 1; return {}; },
    providerAdapter: {
      provider: "openai",
      async execute() {
        state.providerCalls += 1;
        return {
          text: JSON.stringify({
            objective: "SYNTHETIC_PRIVATE_OBJECTIVE",
            expectedOutcome: "Le transport est validé.",
            evidenceTargetIds: ["milestone-1", "criterion-m1"],
            usage: { steps: 1, retries: 0, providerCalls: 1, estimatedCost: 0.2 },
            requestedCapabilities: { network: proposalNetwork, gitWrite: false, destructiveActions: false },
            requiresUserInput: false,
          }),
          toolCalls: [],
          usage: { inputTokens: 100, cachedInputTokens: 0, outputTokens: 50, totalTokens: 150 },
          provider: "openai", model: "synthetic-model",
        };
      },
    },
  });
  // B3b : vrai verrou DATA_DIRECTORY (dossier temporaire) partagé par le runtime et la maintenance.
  const dataLock = realLock ? createDataDirectoryLock({ directory: path.join(directory, "data") }) : null;
  const runtime = dataLock ? makeRuntime(database, dataLock) : makeRuntime(database);
  const lockMaintenance = dataLock ? createGoalModeDevLockMaintenance({
    lock: dataLock, runtime, audit: (event, metadata) => state.audit.push({ event, metadata }),
  }) : null;
  const handler = createGoalModeDevHttpHandler({
    runtime,
    goalStrategyEngine: { registry: { get: (goalId) => (goalId === goal.goalId ? goal : null) } },
    enabled: () => state.enabled,
    requireTrustedUi: (req) => {
      if (req.headers["x-noon-request"] !== "1") throw Object.assign(new Error("x"), { code: "TRUSTED_UI_REQUIRED" });
    },
    readJsonBody,
    executionPreference: () => state.preference,
    audit: (event, metadata) => state.audit.push({ event, metadata }),
    lockMaintenance,
  });
  const server = http.createServer((req, res) => {
    handler.handle(req, res, new URL(req.url, "http://127.0.0.1").pathname).then((handled) => {
      if (!handled) { res.writeHead(404); res.end(); }
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const restarted = [];
  async function call(method, route, body, { trusted = true, signal } = {}) {
    const response = await fetch(`${origin}/api/goals/mode-dev/${route}`, {
      method,
      headers: { "Content-Type": "application/json", ...(trusted ? { "x-noon-request": "1" } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
    const json = await response.json();
    // Succès : { status: "ok", result } ; erreur : { status: "error", code, ... }.
    if (response.ok) assert.equal(json.status, "ok", JSON.stringify(json));
    else assert.equal(json.status, "error", JSON.stringify(json));
    return { status: response.status, body: response.ok ? json.result : json, raw: json };
  }
  return {
    directory, repositoryRoot, database, runtime, server, state, call, goal, journal, dataLock,
    // Redémarrage simulé : nouvelle connexion SQLite, nouveau runtime, mêmes données.
    restart(lock) {
      const handle = createPersonalDatabase(path.join(directory, "personal.sqlite"));
      restarted.push(handle);
      return makeRuntime(handle, lock);
    },
    async createRunning() {
      const created = await call("POST", "runs", {
        goalId: "goal-b2", workspaceId: "workspace-b2", projectId: "project-b2", userConfirmed: true,
        limits: { maxSteps: 4, maxRetries: 1, maxProviderCalls: 4, maxDuration: 600_000, maxEstimatedCost: 3 },
      });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      const started = await call("POST", "runs/start", {
        runId: created.body.runId, expectedRevision: created.body.revision,
      });
      assert.equal(started.status, 200, JSON.stringify(started.body));
      return started.body;
    },
    async planned() {
      const run = await this.createRunning();
      const planning = await call("POST", "planning", { runId: run.runId, confirmProviderCall: true });
      assert.equal(planning.status, 200, JSON.stringify(planning.body));
      assert.equal(planning.body.status, "PROPOSED", JSON.stringify(planning.body));
      const current = await call("GET", `runs/${run.runId}`);
      return { runId: run.runId, stepId: planning.body.stepId, revision: current.body.revision };
    },
    async prepared() {
      const planned = await this.planned();
      const prepared = await call("POST", "dispatch/prepare", {
        runId: planned.runId, expectedRevision: planned.revision, stepId: planned.stepId,
      });
      assert.equal(prepared.status, 201, JSON.stringify(prepared.body));
      return { ...planned, prepared: prepared.body };
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
      dataLock?.release();
      for (const handle of restarted) handle.close();
      database.close();
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

// Attente bornée : échoue proprement au lieu de boucler indéfiniment.
async function waitFor(predicate, label, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`waitFor timeout: ${label}`);
    await new Promise((done) => setTimeout(done, 10));
  }
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("B2 transport : parcours complet run → planning → proposition → prepare → approve → dispatch", async () => {
  const h = await harness();
  try {
    const run = await h.createRunning();
    assert.equal(run.status, "RUNNING");
    // Plafonds fixés par le serveur, localOnly dérivé (false ici), jamais fournis par le client.
    const stored = h.runtime.runStore.get(run.runId).state.contract;
    assert.deepEqual(stored.capabilityCeilings, { network: true, gitWrite: false, destructiveActions: false });
    assert.equal(stored.localOnly, false);
    const restart = await h.call("POST", "runs/start", { runId: run.runId, expectedRevision: run.revision });
    assert.equal(restart.status, 409);
    assert.equal(restart.body.code, "GOAL_MODE_DEV_RUN_NOT_READY");
    const planning = await h.call("POST", "planning", { runId: run.runId, confirmProviderCall: true });
    assert.equal(planning.status, 200, JSON.stringify(planning.body));
    assert.equal(planning.body.status, "PROPOSED");
    assert.equal(h.state.providerCalls, 1);
    const proposal = await h.call("GET", `runs/${run.runId}/proposals/${planning.body.stepId}`);
    assert.equal(proposal.status, 200, JSON.stringify(proposal.body));
    assert.equal(proposal.body.admission.decision, "ADMIT", JSON.stringify(proposal.body));
    const current = await h.call("GET", `runs/${run.runId}`);
    const prepared = await h.call("POST", "dispatch/prepare", {
      runId: run.runId, expectedRevision: current.body.revision, stepId: planning.body.stepId,
    });
    assert.equal(prepared.status, 201, JSON.stringify(prepared.body));
    assert.match(prepared.body.resumeToken, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(prepared.body.display.instruction, "SYNTHETIC_PRIVATE_OBJECTIVE");
    assert.deepEqual(prepared.body.display.projectRules, ["SYNTHETIC_PROJECT_RULE_B2"]);
    assert.equal(JSON.stringify(prepared.body).includes("goal-mode-dev-"), false); // aucun taskId
    const dispatched = await h.call("POST", "dispatch/resume", {
      approvalId: prepared.body.approval.approvalId, resumeToken: prepared.body.resumeToken, decision: "approve",
    });
    assert.equal(dispatched.status, 200, JSON.stringify(dispatched.body));
    assert.equal(dispatched.body.status, "DISPATCHED");
    assert.equal(dispatched.body.native.finalVerdict, "PASS");
    assert.equal(Object.hasOwn(dispatched.body, "resumeToken"), false);
    assert.equal(Object.hasOwn(dispatched.body, "display"), false);
    assert.equal(h.state.facadeCalls.length, 1);
    assert.deepEqual(h.state.facadeCalls[0].projectInstructions, ["SYNTHETIC_PROJECT_RULE_B2"]);
    // 4C-2 : réconciliation immédiate en fin de resume, comptabilité exacte.
    assert.deepEqual(dispatched.body.reconciliation.accounting,
      { providerCalls: 1, accountedCost: 0.05, actualCostKnown: true });
    assert.equal(dispatched.body.reconciliation.outcome, "RECONCILED");
    assert.equal(dispatched.body.reconciliation.basis, "ACTUAL");
    assert.equal(dispatched.body.reconciliationRequired, false);
    const reservation = await h.call("GET", `runs/${run.runId}/reservations/${prepared.body.reservationId}`);
    assert.equal(reservation.status, 200);
    assert.equal(reservation.body.reservationStatus, "RECONCILED");
    assert.equal(reservation.body.observation.journal, "TERMINAL");
    assert.deepEqual(reservation.body.observation.ledger, { RECONCILED: 1 });
    assert.equal(JSON.stringify(reservation.body).includes("goal-mode-dev-"), false);
    const after = await h.call("GET", `runs/${run.runId}`);
    // Usage du run : planning (1 appel) + DEV réconcilié (1 appel, 0,05 USD), une seule fois.
    assert.equal(after.body.usage.steps, 1);
    assert.equal(after.body.usage.providerCalls, current.body.usage.providerCalls + 1);
    assert.ok(Math.abs(after.body.usage.estimatedCost - (current.body.usage.estimatedCost + 0.05)) < 1e-9);
    const replay = await h.call("POST", "dispatch/resume", {
      approvalId: prepared.body.approval.approvalId, resumeToken: prepared.body.resumeToken, decision: "approve",
    });
    assert.equal(replay.status, 410);
    assert.equal(replay.body.code, "APPROVAL_CONSUMED");
    assert.equal(h.state.facadeCalls.length, 1);
    // Audit : route, statut, code. Jamais de corps, jeton ni affichage.
    const audit = JSON.stringify(h.state.audit);
    for (const secret of [prepared.body.resumeToken, "SYNTHETIC_PRIVATE_OBJECTIVE", "SYNTHETIC_PROJECT_RULE_B2",
      "SYNTHETIC_GOAL_TITLE", h.repositoryRoot]) {
      assert.equal(audit.includes(secret), false, secret);
    }
    assert.ok(h.state.audit.every((item) => Object.keys(item.metadata).sort().join() === "code,route,status"));
  } finally { await h.close(); }
});

test("B4a transport : proposition sans réseau → prepare accordé par le serveur, source tracée, dispatch unique", async () => {
  const h = await harness({ proposalNetwork: false });
  try {
    const run = await h.createRunning();
    const planning = await h.call("POST", "planning", { runId: run.runId, confirmProviderCall: true });
    assert.equal(planning.status, 200, JSON.stringify(planning.body));
    const stored = h.runtime.stepProposalStore.get(planning.body.stepId);
    assert.equal(stored.proposal.requestedCapabilities.network, false);
    const current = await h.call("GET", `runs/${run.runId}`);
    const prepared = await h.call("POST", "dispatch/prepare", {
      runId: run.runId, expectedRevision: current.body.revision, stepId: planning.body.stepId,
    });
    assert.equal(prepared.status, 201, JSON.stringify(prepared.body));
    // La carte montre le réseau ; jamais Git write ni action destructive.
    assert.ok(prepared.body.display.permissions.includes("NETWORK"));
    assert.equal(prepared.body.display.permissions.some((item) => /GIT|DESTRUCTIVE/.test(item)), false);
    const issued = h.state.events.filter((item) => item.event === "goal_mode_dev.approval_issued");
    assert.equal(issued.length, 1);
    assert.equal(issued[0].metadata.networkSource, "NATIVE_DEV_RUNTIME");
    assert.equal(JSON.stringify(h.state.events).includes("SYNTHETIC_PRIVATE_OBJECTIVE"), false);
    const reservation = h.runtime.runStore.get(run.runId).state.executionReservations
      .find((item) => item.reservationId === prepared.body.reservationId);
    assert.equal(reservation.status, "PREPARED");
    const dispatched = await h.call("POST", "dispatch/resume", {
      approvalId: prepared.body.approval.approvalId, resumeToken: prepared.body.resumeToken, decision: "approve",
    });
    assert.equal(dispatched.status, 200, JSON.stringify(dispatched.body));
    assert.equal(dispatched.body.status, "DISPATCHED");
    assert.equal(h.state.facadeCalls.length, 1);
  } finally { await h.close(); }
});

test("B4a runtime : Goal devenu LOCAL_ONLY après le planning → prepare refusé avant réservation, zéro appel", async () => {
  const h = await harness({ proposalNetwork: false });
  try {
    const run = await h.createRunning();
    const planning = await h.call("POST", "planning", { runId: run.runId, confirmProviderCall: true });
    assert.equal(planning.status, 200, JSON.stringify(planning.body));
    const callsAfterPlanning = h.state.providerCalls;
    const before = h.runtime.runStore.get(run.runId);
    assert.equal(before.state.contract.localOnly, false);
    // Le Goal passe LOCAL_ONLY (même version), sans traverser le garde HTTP :
    // l'admission recompose le contrat et refuse (local_only ∩ plafond réseau)
    // avant la projection ; le refus de la projection est couvert à part.
    h.goal.sensitivity = "LOCAL_ONLY";
    assert.throws(() => h.runtime.dispatchService.prepare(run.runId, {
      expectedRevision: before.revision, stepId: planning.body.stepId,
    }), { code: "GOAL_MODE_LOCAL_ONLY_NETWORK_CONFLICT" });
    const after = h.runtime.runStore.get(run.runId);
    assert.equal(after.revision, before.revision);
    assert.deepEqual(after.state.executionReservations || [], []);
    assert.equal(h.state.providerCalls, callsAfterPlanning);
    assert.equal(h.state.facadeCalls.length, 0);
    assert.equal(h.state.events.some((item) => item.event === "goal_mode_dev.approval_issued"), false);
  } finally { await h.close(); }
});

test("B2 transport : 404 si désactivé (réévalué à chaque requête), 403 sans en-tête, 404 route inconnue", async () => {
  const h = await harness();
  try {
    const run = await h.createRunning();
    h.state.enabled = false;
    for (const [method, route, body] of [
      ["POST", "runs", {}], ["GET", `runs/${run.runId}`], ["POST", "dispatch/resume", {}],
      ["POST", "planning", { runId: run.runId, confirmProviderCall: true }],
    ]) {
      const response = await h.call(method, route, body);
      assert.equal(response.status, 404, route);
      assert.equal(response.body.code, "GOAL_MODE_DEV_DISABLED", route);
    }
    assert.equal(h.state.providerCalls, 0);
    h.state.enabled = true;
    const untrusted = await h.call("GET", `runs/${run.runId}`, undefined, { trusted: false });
    assert.equal(untrusted.status, 403);
    assert.equal(untrusted.body.code, "TRUSTED_UI_REQUIRED");
    for (const [method, route] of [["POST", "unknown"], ["GET", `runs/${run.runId}/unknown`], ["DELETE", `runs/${run.runId}`],
      ["GET", "dispatch/prepare"]]) {
      const response = await h.call(method, route, method === "POST" ? {} : undefined);
      assert.equal(response.status, 404, `${method} ${route}`);
      assert.equal(response.body.code, "GOAL_MODE_DEV_ROUTE_NOT_FOUND", `${method} ${route}`);
    }
    const missing = await h.call("GET", "runs/goal-run-missing");
    assert.equal(missing.status, 404);
    assert.equal(missing.body.code, "GOAL_MODE_RUN_NOT_FOUND");
  } finally { await h.close(); }
});

test("B2 transport : aucune autorité injectée par le client, decision et confirmProviderCall obligatoires", async () => {
  const h = await harness();
  try {
    const base = {
      goalId: "goal-b2", workspaceId: "workspace-b2", projectId: "project-b2", userConfirmed: true,
      limits: { maxSteps: 4, maxRetries: 1, maxProviderCalls: 4, maxDuration: 600_000, maxEstimatedCost: 3 },
    };
    for (const injected of [{ taskId: "goal-mode-dev-x" }, { repositoryRoot: "/tmp" }, { localOnly: false },
      { capabilityCeilings: { network: true, gitWrite: true, destructiveActions: true } },
      { permissions: ["READ_WRITE_WORKSPACE"] }, { projectInstructions: ["x"] }]) {
      const response = await h.call("POST", "runs", { ...base, ...injected });
      assert.equal(response.status, 400, JSON.stringify(injected));
      assert.equal(response.body.code, "GOAL_MODE_DEV_HTTP_BODY_INVALID");
    }
    const unconfirmed = await h.call("POST", "runs", { ...base, userConfirmed: false });
    assert.equal(unconfirmed.status, 400);
    const planned = await h.planned();
    const noConfirm = await h.call("POST", "planning", { runId: planned.runId });
    assert.equal(noConfirm.status, 400);
    const falseConfirm = await h.call("POST", "planning", { runId: planned.runId, confirmProviderCall: false });
    assert.equal(falseConfirm.status, 400);
    assert.equal(h.state.providerCalls, 1);
    const prepared = await h.call("POST", "dispatch/prepare", {
      runId: planned.runId, expectedRevision: planned.revision, stepId: planned.stepId, taskId: "goal-mode-dev-x",
    });
    assert.equal(prepared.status, 400);
    const ok = await h.call("POST", "dispatch/prepare", {
      runId: planned.runId, expectedRevision: planned.revision, stepId: planned.stepId,
    });
    assert.equal(ok.status, 201);
    const { approvalId } = ok.body.approval;
    for (const decision of [undefined, null, "Approve", "yes", true, ""]) {
      const body = { approvalId, resumeToken: ok.body.resumeToken };
      if (decision !== undefined) body.decision = decision;
      const response = await h.call("POST", "dispatch/resume", body);
      assert.equal(response.status, 400, String(decision));
    }
    assert.equal(h.state.facadeCalls.length, 0);
    const still = await h.call("POST", "dispatch/resume", {
      approvalId, resumeToken: ok.body.resumeToken, decision: "approve",
    });
    assert.equal(still.status, 200, JSON.stringify(still.body));
  } finally { await h.close(); }
});

test("B2 transport : LOCAL_ONLY du Goal refusé avant toute création ou réservation", async () => {
  const h = await harness({ goal: goalFixture({ sensitivity: "LOCAL_ONLY" }) });
  try {
    const response = await h.call("POST", "runs", {
      goalId: "goal-b2", workspaceId: "workspace-b2", projectId: "project-b2", userConfirmed: true,
      limits: { maxSteps: 4, maxRetries: 1, maxProviderCalls: 4, maxDuration: 600_000, maxEstimatedCost: 3 },
    });
    assert.equal(response.status, 422);
    assert.equal(response.body.code, "GOAL_MODE_DEV_LOCAL_ONLY_REQUIRED");
    const rows = h.database.database.prepare(
      "SELECT COUNT(*) AS count FROM goal_strategy_records WHERE record_type = 'GOAL_MODE_RUN_STATE'"
    ).get();
    assert.equal(rows.count, 0);
    assert.equal(h.state.providerCalls, 0);
  } finally { await h.close(); }
});

test("B2 transport : préférence LOCAL_ONLY refuse planning, prepare et resume, sans réservation ni dispatch", async () => {
  const h = await harness();
  try {
    const run = await h.createRunning();
    h.state.preference = "LOCAL_ONLY";
    const planning = await h.call("POST", "planning", { runId: run.runId, confirmProviderCall: true });
    assert.equal(planning.status, 422);
    assert.equal(planning.body.code, "GOAL_MODE_DEV_LOCAL_ONLY_REQUIRED");
    assert.equal(h.state.providerCalls, 0);
    h.state.preference = "BALANCED";
    const planned = await h.call("POST", "planning", { runId: run.runId, confirmProviderCall: true });
    const current = await h.call("GET", `runs/${run.runId}`);
    h.state.preference = "LOCAL_ONLY";
    const refused = await h.call("POST", "dispatch/prepare", {
      runId: run.runId, expectedRevision: current.body.revision, stepId: planned.body.stepId,
    });
    assert.equal(refused.status, 422);
    assert.equal((await h.call("GET", `runs/${run.runId}`)).body.reservations.length, 0);
    h.state.preference = "BALANCED";
    const prepared = await h.call("POST", "dispatch/prepare", {
      runId: run.runId, expectedRevision: current.body.revision, stepId: planned.body.stepId,
    });
    assert.equal(prepared.status, 201);
    // La préférence change après l'approbation : resume refusé, approbation intacte.
    h.state.preference = "LOCAL_ONLY";
    const resume = { approvalId: prepared.body.approval.approvalId, resumeToken: prepared.body.resumeToken, decision: "approve" };
    const blocked = await h.call("POST", "dispatch/resume", resume);
    assert.equal(blocked.status, 422);
    assert.equal(h.state.facadeCalls.length, 0);
    // Préférence inconnue (erreur) : traitée comme LOCAL_ONLY.
    h.state.preference = undefined;
    assert.equal((await h.call("POST", "dispatch/resume", resume)).status, 422);
    h.state.preference = "BALANCED";
    const allowed = await h.call("POST", "dispatch/resume", resume);
    assert.equal(allowed.status, 200, JSON.stringify(allowed.body));
    assert.equal(h.state.facadeCalls.length, 1);
  } finally { await h.close(); }
});

test("B2 transport : refus, renouvellement, mauvais jeton, puis approbation", async () => {
  const h = await harness();
  try {
    const { prepared } = await h.prepared();
    const wrongToken = await h.call("POST", "dispatch/resume", {
      approvalId: prepared.approval.approvalId, resumeToken: "A".repeat(43), decision: "approve",
    });
    assert.equal(wrongToken.status, 403);
    assert.equal(wrongToken.body.code, "APPROVAL_TOKEN_INVALID");
    const rejected = await h.call("POST", "dispatch/resume", {
      approvalId: prepared.approval.approvalId, resumeToken: prepared.resumeToken, decision: "reject",
    });
    assert.equal(rejected.raw.status, "ok");
    assert.deepEqual(rejected.body, { status: "rejected", reservationId: prepared.reservationId });
    const renewed = await h.call("POST", "dispatch/renew", { reservationId: prepared.reservationId });
    assert.equal(renewed.status, 201, JSON.stringify(renewed.body));
    assert.notEqual(renewed.body.approval.approvalId, prepared.approval.approvalId);
    assert.match(renewed.body.resumeToken, /^[A-Za-z0-9_-]{43}$/);
    const old = await h.call("POST", "dispatch/resume", {
      approvalId: prepared.approval.approvalId, resumeToken: prepared.resumeToken, decision: "approve",
    });
    assert.ok([409, 410].includes(old.status), JSON.stringify(old.body));
    const approved = await h.call("POST", "dispatch/resume", {
      approvalId: renewed.body.approval.approvalId, resumeToken: renewed.body.resumeToken, decision: "approve",
    });
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    assert.equal(h.state.facadeCalls.length, 1);
  } finally { await h.close(); }
});

test("B2 transport : pause (releasePrepared, ledger non nul), reprise, libération, arrêt", async () => {
  const h = await harness();
  try {
    const { runId, prepared } = await h.prepared();
    h.state.ledgerCalls = 1;
    let run = await h.call("GET", `runs/${runId}`);
    const paused = await h.call("POST", "runs/pause", {
      runId, expectedRevision: run.body.revision, reasonCode: "USER_PAUSE", releasePrepared: true,
    });
    assert.equal(paused.status, 200, JSON.stringify(paused.body));
    assert.equal(paused.body.status, "PAUSED");
    assert.equal(paused.body.approvalsCancelled, 1);
    assert.equal(paused.body.release.released, false);
    assert.equal(paused.body.release.code, "GOAL_MODE_EXECUTION_RELEASE_LEDGER_ENGAGED");
    const resumed = await h.call("POST", "runs/resume", { runId, expectedRevision: paused.body.revision });
    assert.equal(resumed.status, 200);
    assert.deepEqual(resumed.body.releaseRequired, [prepared.reservationId]);
    h.state.ledgerCalls = 0;
    const released = await h.call("POST", "dispatch/release", {
      runId, expectedRevision: resumed.body.revision, reservationId: prepared.reservationId,
    });
    assert.equal(released.status, 200, JSON.stringify(released.body));
    assert.equal(released.body.status, "RELEASED");
    run = await h.call("GET", `runs/${runId}`);
    const stopped = await h.call("POST", "runs/stop", { runId, expectedRevision: run.body.revision, status: "CANCELLED" });
    assert.equal(stopped.status, 200);
    assert.equal(stopped.body.status, "CANCELLED");
    const again = await h.call("POST", "runs/resume", { runId, expectedRevision: stopped.body.revision });
    assert.equal(again.status, 409);
    assert.equal(again.body.code, "GOAL_MODE_DEV_RUN_NOT_PAUSED");
    const conflict = await h.call("POST", "runs/pause", { runId, expectedRevision: 1 });
    assert.equal(conflict.status, 409);
    assert.equal(h.state.facadeCalls.length, 0);
  } finally { await h.close(); }
});

test("B2 transport : annulation pendant un dispatch, statut, puis fin du dispatch", async () => {
  const h = await harness();
  try {
    const { runId, prepared } = await h.prepared();
    h.state.gate = deferred();
    const pending = h.call("POST", "dispatch/resume", {
      approvalId: prepared.approval.approvalId, resumeToken: prepared.resumeToken, decision: "approve",
    });
    await waitFor(() => h.state.facadeCalls.length > 0, "dispatch démarré");
    const status = await h.call("GET", `runs/${runId}/reservations/${prepared.reservationId}`);
    assert.equal(status.body.reservationStatus, "MAY_HAVE_STARTED");
    assert.equal(status.body.dispatchedByThisInstance, true);
    const cancelled = await h.call("POST", "dispatch/cancel", { runId, reservationId: prepared.reservationId });
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
    assert.equal(cancelled.body.cancelRequested, true);
    assert.equal(cancelled.body.reservationStatus, "MAY_HAVE_STARTED");
    assert.equal(h.state.cancels.length, 1);
    h.state.gate.resolve();
    const done = await pending;
    assert.equal(done.status, 200);
    // Annulation observée complètement (journal terminal CANCELLED) : RECONCILED.
    assert.equal(done.body.reconciliation.outcome, "RECONCILED");
    assert.equal(h.journal.load(h.state.facadeCalls[0].taskId).state, "CANCELLED");
  } finally { await h.close(); }
});

test("B2 transport : une déconnexion du client ne coupe pas le dispatch", async () => {
  const h = await harness();
  try {
    const { runId, prepared } = await h.prepared();
    h.state.gate = deferred();
    const controller = new AbortController();
    const pending = h.call("POST", "dispatch/resume", {
      approvalId: prepared.approval.approvalId, resumeToken: prepared.resumeToken, decision: "approve",
    }, { signal: controller.signal }).catch((error) => error);
    await waitFor(() => h.state.facadeCalls.length > 0, "dispatch démarré");
    controller.abort();
    const outcome = await pending;
    assert.equal(outcome?.name, "AbortError");
    h.state.gate.resolve();
    await waitFor(() => h.state.audit.some((item) => item.metadata.route === "POST dispatch/resume"),
      "fin du dispatch côté serveur");
    const entry = h.state.audit.find((item) => item.metadata.route === "POST dispatch/resume");
    assert.equal(entry.metadata.status, 200); // dispatch terminé côté serveur
    const status = await h.call("GET", `runs/${runId}/reservations/${prepared.reservationId}`);
    assert.equal(status.body.reservationStatus, "RECONCILED"); // réconcilié malgré la déconnexion
    assert.equal(h.state.facadeCalls.length, 1);
  } finally { await h.close(); }
});

test("B2 transport : requestTimeout borne la réception de la requête, pas la durée de la réponse", async () => {
  const h = await harness();
  try {
    h.server.requestTimeout = 400;
    h.server.headersTimeout = 300;
    const { prepared } = await h.prepared();
    h.state.gate = deferred();
    setTimeout(() => h.state.gate.resolve(), 1_200);
    const started = Date.now();
    const response = await h.call("POST", "dispatch/resume", {
      approvalId: prepared.approval.approvalId, resumeToken: prepared.resumeToken, decision: "approve",
    });
    assert.ok(Date.now() - started >= 1_000);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.status, "DISPATCHED");
  } finally { await h.close(); }
});

test("B2 transport : proposition d'un autre run introuvable", async () => {
  const h = await harness();
  try {
    const planned = await h.planned();
    const other = await h.createRunning();
    const response = await h.call("GET", `runs/${other.runId}/proposals/${planned.stepId}`);
    assert.equal(response.status, 404);
    assert.equal(response.body.code, "GOAL_MODE_DEV_PROPOSAL_NOT_FOUND");
  } finally { await h.close(); }
});

// ---- 4C-2 : réconciliation ----

async function dispatchDirect(h, prepared) {
  return h.runtime.dispatchService.resume({
    approvalId: prepared.approval.approvalId, resumeToken: prepared.resumeToken, decision: "approve",
  });
}

test("4C-2 fin de resume : façade jamais atteinte (feature gate) → RECONCILED à engagement nul", async () => {
  const h = await harness();
  try {
    const { runId, revision, prepared } = await h.prepared();
    const before = (await h.call("GET", `runs/${runId}`)).body;
    h.state.facadeMode = "SKIP_CLAIM";
    const dispatched = await h.call("POST", "dispatch/resume", {
      approvalId: prepared.approval.approvalId, resumeToken: prepared.resumeToken, decision: "approve",
    });
    assert.equal(dispatched.status, 200, JSON.stringify(dispatched.body));
    assert.deepEqual(dispatched.body.reconciliation, {
      outcome: "RECONCILED", reason: "NEVER_LAUNCHED", basis: "NEVER_LAUNCHED", reservationStatus: "RECONCILED",
      accounting: { providerCalls: 0, accountedCost: 0, actualCostKnown: true }, durationMs: null,
    });
    const record = h.runtime.runStore.get(runId).state.executionReservations.at(-1);
    assert.equal(record.observedSteps, 0);
    assert.equal(record.observedProviderCalls, 0);
    const after = (await h.call("GET", `runs/${runId}`)).body;
    assert.deepEqual(after.usage, before.usage); // rien consommé
    assert.ok(revision > 0);
  } finally { await h.close(); }
});

test("4C-2 appel au résultat inconnu + journal terminal → RECONCILED prudent, basis visible dans l'audit et la route", async () => {
  const h = await harness();
  try {
    const { runId, prepared } = await h.prepared();
    h.state.unknownPending = true;
    const dispatched = await h.call("POST", "dispatch/resume", {
      approvalId: prepared.approval.approvalId, resumeToken: prepared.resumeToken, decision: "approve",
    });
    assert.equal(dispatched.status, 200, JSON.stringify(dispatched.body));
    assert.equal(dispatched.body.reconciliation.basis, "ESTIMATED_UPPER_BOUND");
    const accounting = dispatched.body.reconciliation.accounting;
    assert.equal(accounting.providerCalls, 2);
    assert.equal(accounting.actualCostKnown, false);
    assert.ok(Math.abs(accounting.accountedCost - 0.12) < 1e-9); // somme IEEE exacte de 0,05 + 0,07
    const record = h.runtime.runStore.get(runId).state.executionReservations.at(-1);
    assert.equal(record.status, "RECONCILED");
    assert.equal(record.observedActualCost, null);
    assert.equal(record.accountedCost, accounting.accountedCost);
    const audit = h.state.events.find((item) => item.event === "goal_mode_dev.reconciliation");
    assert.equal(audit.metadata.basis, "ESTIMATED_UPPER_BOUND");
    assert.equal(audit.metadata.trigger, "RESUME_END");
    assert.equal(JSON.stringify(h.state.events).includes("SYNTHETIC_PRIVATE_OBJECTIVE"), false);
  } finally { await h.close(); }
});

test("4C-2 tâche interrompue (journal non terminal) → UNKNOWN, puis plus aucune réservation", async () => {
  const h = await harness();
  try {
    const { runId, prepared } = await h.prepared();
    h.state.facadeMode = "INTERRUPT";
    const dispatched = await h.call("POST", "dispatch/resume", {
      approvalId: prepared.approval.approvalId, resumeToken: prepared.resumeToken, decision: "approve",
    });
    assert.equal(dispatched.status, 502);
    assert.equal(dispatched.body.code, "GOAL_MODE_DEV_DISPATCH_OUTCOME_UNCERTAIN");
    assert.equal(dispatched.body.details.status, "UNKNOWN");
    const record = h.runtime.runStore.get(runId).state.executionReservations.at(-1);
    assert.equal(record.status, "UNKNOWN");
    assert.equal(record.unknownReasonCode, "OUTCOME_UNCERTAIN");
    assert.equal(record.observedProviderCalls, 1);
  } finally { await h.close(); }
});

test("4C-2 ledger encore en cours → aucune transition ; route explicite ensuite, idempotente, conflit refusé", async () => {
  const h = await harness();
  try {
    const { runId, prepared } = await h.prepared();
    h.state.reservedLeftover = true;
    const dispatched = await h.call("POST", "dispatch/resume", {
      approvalId: prepared.approval.approvalId, resumeToken: prepared.resumeToken, decision: "approve",
    });
    assert.equal(dispatched.status, 200);
    assert.equal(dispatched.body.reconciliation.outcome, "UNCHANGED");
    assert.equal(dispatched.body.reconciliation.reason, "LEDGER_IN_PROGRESS");
    assert.equal(dispatched.body.reconciliationRequired, true);
    let run = await h.call("GET", `runs/${runId}`);
    const stale = await h.call("POST", "dispatch/reconcile", {
      runId, expectedRevision: run.body.revision - 1, reservationId: prepared.reservationId,
    });
    assert.equal(stale.status, 409);
    const injected = await h.call("POST", "dispatch/reconcile", {
      runId, expectedRevision: run.body.revision, reservationId: prepared.reservationId, taskId: "goal-mode-dev-x",
    });
    assert.equal(injected.status, 400);
    const ledgerBefore = JSON.stringify(h.state.ledgerEntries);
    const facadeBefore = h.state.facadeCalls.length;
    const stillRunning = await h.call("POST", "dispatch/reconcile", {
      runId, expectedRevision: run.body.revision, reservationId: prepared.reservationId,
    });
    assert.equal(stillRunning.body.outcome, "UNCHANGED");
    // L'appel en suspens se règle (ledger), puis réconciliation explicite.
    h.state.ledgerEntries.find((entry) => entry.status === "RESERVED").status = "RECONCILED";
    const done = await h.call("POST", "dispatch/reconcile", {
      runId, expectedRevision: run.body.revision, reservationId: prepared.reservationId,
    });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.equal(done.body.outcome, "RECONCILED");
    assert.equal(done.body.basis, "ESTIMATED_UPPER_BOUND");
    assert.equal(done.body.accounting.providerCalls, 2);
    run = await h.call("GET", `runs/${runId}`);
    const again = await h.call("POST", "dispatch/reconcile", {
      runId, expectedRevision: run.body.revision, reservationId: prepared.reservationId,
    });
    assert.equal(again.body.outcome, "UNCHANGED");
    assert.equal(again.body.reason, "NOT_MAY_HAVE_STARTED");
    // Réconcilier n'appelle jamais le dispatcher et n'écrit jamais le ledger.
    assert.equal(h.state.facadeCalls.length, facadeBefore);
    assert.equal(h.state.cancels.length, 0);
    assert.notEqual(JSON.stringify(h.state.ledgerEntries), ledgerBefore); // modifié par le test seulement
  } finally { await h.close(); }
});

test("4C-2 redémarrage : scan au démarrage sous verrou, jamais lancée et interrompue, RELEASED ignorée", async () => {
  const h = await harness();
  try {
    // Run A : bloqué avant la réservation de démarrage (crash entre CAS et façade).
    const a = await h.prepared();
    h.state.facadeMode = "HANG_BEFORE_CLAIM";
    dispatchDirect(h, a.prepared);
    await waitFor(() => h.runtime.runStore.get(a.runId).state.executionReservations.at(-1).status === "MAY_HAVE_STARTED", "A");
    // Run B : bloqué après la réservation de démarrage (tâche interrompue).
    const b = await h.prepared();
    h.state.facadeMode = "HANG_AFTER_CLAIM";
    dispatchDirect(h, b.prepared);
    await waitFor(() => h.journal.lookup(h.state.facadeCalls.at(-1).taskId).status === "PRESENT", "B");
    // Run C : réservation libérée (ignorée par le scan).
    const c = await h.prepared();
    h.runtime.runStore.releaseExecution(c.runId, {
      expectedRevision: h.runtime.runStore.get(c.runId).revision, reservationId: c.prepared.reservationId,
    });
    const facadeBefore = h.state.facadeCalls.length;
    const ledgerBefore = JSON.stringify(h.state.ledgerEntries);
    // Sans verrou : aucun scan.
    const unlocked = h.restart({ isHeld: () => false });
    assert.throws(() => unlocked.dispatchService.reconcileAtStartup(), { code: "GOAL_MODE_DEV_RECONCILE_LOCK_REQUIRED" });
    // Avec verrou : le processus d'origine est réputé disparu.
    const restarted = h.restart({ isHeld: () => true });
    const summary = restarted.dispatchService.reconcileAtStartup();
    assert.deepEqual({ ...summary }, { scanned: 2, reconciled: 1, unknown: 1, unchanged: 0, failed: 0 });
    const statusOf = (runId) => restarted.runStore.get(runId).state.executionReservations.at(-1);
    assert.equal(statusOf(a.runId).status, "RECONCILED");
    assert.equal(statusOf(a.runId).observedSteps, 0);
    assert.equal(statusOf(b.runId).status, "UNKNOWN");
    assert.equal(statusOf(b.runId).unknownReasonCode, "OUTCOME_UNCERTAIN");
    assert.equal(statusOf(c.runId).status, "RELEASED");
    // Rejouer le scan ne change rien (idempotent), sans aucun effet de bord.
    assert.deepEqual({ ...restarted.dispatchService.reconcileAtStartup() },
      { scanned: 0, reconciled: 0, unknown: 0, unchanged: 0, failed: 0 });
    assert.equal(h.state.facadeCalls.length, facadeBefore);
    assert.equal(JSON.stringify(h.state.ledgerEntries), ledgerBefore);
  } finally { await h.close(); }
});

test("4C-2 route explicite « jamais lancée » : dispatch en cours, verrou, délai de grâce de 2 min", async () => {
  const h = await harness();
  try {
    const { runId, prepared } = await h.prepared();
    h.state.facadeMode = "HANG_BEFORE_CLAIM";
    dispatchDirect(h, prepared);
    await waitFor(() => h.runtime.runStore.get(runId).state.executionReservations.at(-1).status === "MAY_HAVE_STARTED", "dispatch");
    let revision = h.runtime.runStore.get(runId).revision;
    const input = { runId, expectedRevision: revision, reservationId: prepared.reservationId };
    // Même processus, dispatch en cours : jamais de conclusion.
    h.state.lockHeld = true;
    h.state.clockOffset = 10 * 60_000;
    assert.equal(h.runtime.dispatchService.reconcileExecution(input).reason, "IN_PROGRESS");
    // Autre processus (redémarré) : verrou requis, puis délai de grâce.
    h.state.clockOffset = 0;
    const lockState = { held: false };
    const other = h.restart({ isHeld: () => lockState.held });
    assert.equal(other.dispatchService.reconcileExecution(input).reason, "LOCK_NOT_HELD");
    lockState.held = true;
    assert.equal(other.dispatchService.reconcileExecution(input).reason, "GRACE_PERIOD");
    h.state.clockOffset = 119_000;
    assert.equal(other.dispatchService.reconcileExecution(input).reason, "GRACE_PERIOD");
    h.state.clockOffset = 121_000;
    const result = other.dispatchService.reconcileExecution(input);
    assert.equal(result.outcome, "RECONCILED");
    assert.equal(result.basis, "NEVER_LAUNCHED");
    revision = other.runStore.get(runId).revision;
    assert.equal(other.runStore.get(runId).state.executionReservations.at(-1).observedSteps, 0);
    assert.ok(revision > input.expectedRevision);
  } finally { await h.close(); }
});

test("4C-2 course entre deux processus sur la même réservation : un seul CAS gagne", async () => {
  const h = await harness();
  try {
    const { runId, prepared } = await h.prepared();
    h.state.reservedLeftover = true;
    await dispatchDirect(h, prepared);
    h.state.ledgerEntries.find((entry) => entry.status === "RESERVED").status = "RECONCILED";
    const revision = h.runtime.runStore.get(runId).revision;
    const input = { runId, expectedRevision: revision, reservationId: prepared.reservationId };
    const first = h.restart({ isHeld: () => true });
    const second = h.restart({ isHeld: () => true });
    const won = first.dispatchService.reconcileExecution(input);
    assert.equal(won.outcome, "RECONCILED");
    assert.throws(() => second.dispatchService.reconcileExecution(input), { code: "GOAL_MODE_RUN_PERSISTENCE_CONFLICT" });
    const usage = h.runtime.runStore.get(runId).state.usage;
    // Comptabilité appliquée une seule fois.
    assert.equal(h.runtime.runStore.get(runId).state.executionReservations.at(-1).observedProviderCalls, 2);
    assert.ok(usage.providerCalls >= 2);
  } finally { await h.close(); }
});

test("B3a transport : GET runs liste les runs récents en lecture seule, sans contenu de tâche", async () => {
  const h = await harness();
  try {
    const empty = await h.call("GET", "runs");
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.body, { runs: [] });
    const first = await h.createRunning();
    h.state.clockOffset = 60_000;
    const { runId: second, prepared } = await h.prepared();
    const listed = await h.call("GET", "runs");
    assert.equal(listed.status, 200);
    // Tri par updatedAt décroissant : le run le plus récent d'abord.
    assert.deepEqual(listed.body.runs.map((run) => run.runId), [second, first.runId]);
    const top = listed.body.runs[0];
    assert.deepEqual(Object.keys(top).sort(),
      ["deadline", "goalId", "limits", "reservations", "revision", "runId", "status", "updatedAt", "usage"]);
    assert.equal(top.goalId, "goal-b2");
    assert.equal(top.limits.maxDuration, 600_000);
    assert.deepEqual(top.reservations, [{ reservationId: prepared.reservationId, status: "PREPARED" }]);
    const serialized = JSON.stringify(listed.raw);
    for (const secret of ["SYNTHETIC_PRIVATE_OBJECTIVE", "SYNTHETIC_PROJECT_RULE_B2", prepared.resumeToken, h.repositoryRoot]) {
      assert.equal(serialized.includes(secret), false, secret);
    }
    // Lecture seule : aucune révision modifiée.
    assert.equal((await h.call("GET", `runs/${second}`)).body.revision, top.revision);
    const untrusted = await h.call("GET", "runs", undefined, { trusted: false });
    assert.equal(untrusted.status, 403);
    h.state.enabled = false;
    const disabled = await h.call("GET", "runs");
    assert.equal(disabled.status, 404);
    assert.equal(disabled.body.code, "GOAL_MODE_DEV_DISABLED");
  } finally { await h.close(); }
});

test("B3a transport : planning-estimate donne le coût maximal sans appel fournisseur, réservation ni autorisation", async () => {
  const h = await harness();
  try {
    const run = await h.createRunning();
    const before = await h.call("GET", `runs/${run.runId}`);
    const privacyBefore = h.state.privacyCalls || 0;
    const estimate = await h.call("GET", `runs/${run.runId}/planning-estimate`);
    assert.equal(estimate.status, 200, JSON.stringify(estimate.body));
    assert.deepEqual(estimate.body, { decision: "PLAN", maxEstimatedCost: 0.2, currency: "USD" });
    assert.equal(h.state.providerCalls, 0);
    assert.equal(h.state.privacyCalls || 0, privacyBefore);
    const after = await h.call("GET", `runs/${run.runId}`);
    assert.equal(after.body.revision, before.body.revision);
    assert.deepEqual(after.body.usage, before.body.usage);
    assert.deepEqual(after.body.reservations, []);
    // Préférence LOCAL_ONLY : refus avant toute estimation.
    h.state.preference = "LOCAL_ONLY";
    const local = await h.call("GET", `runs/${run.runId}/planning-estimate`);
    assert.equal(local.status, 422);
    assert.equal(local.body.code, "GOAL_MODE_DEV_LOCAL_ONLY_REQUIRED");
    h.state.preference = "BALANCED";
    const missing = await h.call("GET", "runs/goal-run-missing/planning-estimate");
    assert.equal(missing.status, 404);
    // L'estimation n'a pas consommé le planning : l'appel confirmé reste possible.
    const planning = await h.call("POST", "planning", { runId: run.runId, confirmProviderCall: true });
    assert.equal(planning.status, 200, JSON.stringify(planning.body));
    assert.equal(h.state.providerCalls, 1);
  } finally { await h.close(); }
});

function deadPid() {
  return Number(execFileSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" }));
}

test("B3b transport : état du verrou, reprise explicite d'un verrou périmé, sans scan automatique", async () => {
  const h = await harness({ realLock: true });
  try {
    const absent = await h.call("GET", "maintenance/lock");
    assert.equal(absent.status, 200);
    assert.deepEqual(absent.body, {
      state: "ABSENT", holderPid: null, holderHostname: null, holderCreatedAt: null, sameHost: null,
      machineRestarted: null, takeoverPending: false, canTakeOver: true,
    });
    const pid = deadPid();
    const lockFile = path.join(h.directory, "data", LOCK_FILE);
    fs.mkdirSync(path.dirname(lockFile), { recursive: true });
    const staleContent = JSON.stringify({ pid, hostname: os.hostname(), token: "stale-token", createdAt: "2026-10-13T12:00:00.000Z" });
    fs.writeFileSync(lockFile, staleContent);
    const stale = await h.call("GET", "maintenance/lock");
    assert.equal(stale.body.state, "STALE");
    assert.equal(stale.body.holderPid, pid);
    assert.equal(stale.body.sameHost, true);
    assert.equal(stale.body.canTakeOver, true);
    assert.equal(JSON.stringify(stale.raw).includes("stale-token"), false);
    // Corps exacts : confirmation et détenteur attendu obligatoires.
    for (const invalid of [{ confirm: false, expectedHolderPid: pid }, { confirm: true }, { expectedHolderPid: pid },
      { confirm: true, expectedHolderPid: pid, force: true }, { confirm: true, expectedHolderPid: "1" }]) {
      const response = await h.call("POST", "maintenance/lock-takeover", invalid);
      assert.equal(response.status, 400, JSON.stringify(invalid));
    }
    const mismatch = await h.call("POST", "maintenance/lock-takeover", { confirm: true, expectedHolderPid: pid + 1 });
    assert.equal(mismatch.status, 409);
    assert.equal(mismatch.body.code, "GOAL_MODE_DEV_LOCK_EXPECTED_HOLDER_MISMATCH");
    assert.equal(fs.readFileSync(lockFile, "utf8"), staleContent);
    const scansBefore = h.state.events.filter((item) => /reconcil/.test(item.event)).length;
    const taken = await h.call("POST", "maintenance/lock-takeover", { confirm: true, expectedHolderPid: pid });
    assert.equal(taken.status, 200, JSON.stringify(taken.body));
    assert.deepEqual(taken.body, { acquired: true, reason: "TAKEN_OVER", previousPid: pid, reconcileRecommended: true });
    assert.equal(h.dataLock.isHeld(), true);
    assert.equal((await h.call("GET", "maintenance/lock")).body.state, "HELD_BY_THIS");
    // Ancien verrou conservé (renommé), aucun scan lancé par la reprise explicite.
    const kept = fs.readdirSync(path.dirname(lockFile)).filter((name) => name.startsWith(`${LOCK_FILE}.stale-`));
    assert.equal(kept.length, 1);
    assert.equal(fs.readFileSync(path.join(path.dirname(lockFile), kept[0]), "utf8"), staleContent);
    assert.equal(h.state.events.filter((item) => /reconcil/.test(item.event)).length, scansBefore);
    assert.deepEqual(h.state.audit.filter((item) => item.event === "goals.mode-dev.lock_takeover").map((item) => item.metadata),
      [{ mode: "EXPLICIT", previousPid: pid, reason: "USER_CONFIRMED" }]);
    assert.equal(h.state.audit.some((item) => item.event === "goals.mode-dev.reconcile_scan"), false);
    // Déjà détenu : idempotent.
    const again = await h.call("POST", "maintenance/lock-takeover", { confirm: true, expectedHolderPid: null });
    assert.equal(again.body.reason, "ALREADY_HELD");
  } finally { await h.close(); }
});

test("B3b transport : détenteur vivant sur la même machine → reprise refusée, verrou intact", async () => {
  const h = await harness({ realLock: true });
  try {
    const lockFile = path.join(h.directory, "data", LOCK_FILE);
    fs.mkdirSync(path.dirname(lockFile), { recursive: true });
    // Le processus de test lui-même est vivant : détenteur vivant sur ce Mac.
    const live = JSON.stringify({ pid: process.pid, hostname: os.hostname(), token: "live-token", createdAt: "2026-10-13T12:00:00.000Z", bootTime: 0 });
    fs.writeFileSync(lockFile, live);
    const state = await h.call("GET", "maintenance/lock");
    assert.equal(state.body.state, "HELD");
    assert.equal(state.body.canTakeOver, false);
    assert.equal(state.body.machineRestarted, true); // indication seulement
    const refused = await h.call("POST", "maintenance/lock-takeover", { confirm: true, expectedHolderPid: process.pid });
    assert.equal(refused.status, 409);
    assert.equal(refused.body.code, "GOAL_MODE_DEV_LOCK_HOLDER_ALIVE");
    assert.equal(fs.readFileSync(lockFile, "utf8"), live);
    assert.equal(h.dataLock.isHeld(), false);
    assert.deepEqual(h.state.audit.filter((item) => item.event === "goals.mode-dev.lock_takeover_refused").map((item) => item.metadata),
      [{ reason: "HOLDER_ALIVE" }]);
    const scan = await h.call("POST", "maintenance/reconcile-scan", { confirm: true });
    assert.equal(scan.status, 409);
    assert.equal(scan.body.code, "GOAL_MODE_DEV_RECONCILE_LOCK_REQUIRED");
  } finally { await h.close(); }
});

test("B3b transport : « Réconcilier maintenant » en EXPLICIT — dispatch en vol jamais conclu, ledger réglé réconcilié", async () => {
  const h = await harness({ realLock: true });
  try {
    assert.equal((await h.call("POST", "maintenance/lock-takeover", { confirm: true, expectedHolderPid: null })).body.reason, "ACQUIRED");
    // Run A : dispatch de ce processus en vol, avant la réservation de démarrage.
    const a = await h.prepared();
    h.state.facadeMode = "HANG_BEFORE_CLAIM";
    dispatchDirect(h, a.prepared);
    await waitFor(() => h.runtime.runStore.get(a.runId).state.executionReservations.at(-1).status === "MAY_HAVE_STARTED", "A");
    // Run B : appel resté RESERVED dans le ledger à la fin de resume, puis réglé.
    h.state.facadeMode = "NORMAL";
    const b = await h.prepared();
    h.state.reservedLeftover = true;
    const resumed = await h.call("POST", "dispatch/resume", {
      approvalId: b.prepared.approval.approvalId, resumeToken: b.prepared.resumeToken, decision: "approve",
    });
    assert.equal(resumed.body.reconciliation.reason, "LEDGER_IN_PROGRESS");
    h.state.ledgerEntries.find((entry) => entry.status === "RESERVED").status = "RECONCILED";
    // Même au-delà du délai de grâce, le dispatch en vol n'est jamais conclu.
    h.state.clockOffset = 10 * 60_000;
    const facadeBefore = h.state.facadeCalls.length;
    const invalid = await h.call("POST", "maintenance/reconcile-scan", {});
    assert.equal(invalid.status, 400);
    const scan = await h.call("POST", "maintenance/reconcile-scan", { confirm: true });
    assert.equal(scan.status, 200, JSON.stringify(scan.body));
    assert.deepEqual(scan.body, { scanned: 2, reconciled: 1, unknown: 0, unchanged: 1, failed: 0 });
    const statusOf = (runId) => h.runtime.runStore.get(runId).state.executionReservations.at(-1).status;
    assert.equal(statusOf(a.runId), "MAY_HAVE_STARTED");
    assert.equal(statusOf(b.runId), "RECONCILED");
    assert.equal(h.state.facadeCalls.length, facadeBefore);
    const scanAudit = h.state.audit.filter((item) => item.event === "goals.mode-dev.reconcile_scan");
    assert.deepEqual(scanAudit.map((item) => item.metadata), [{ scanned: 2, reconciled: 1, unknown: 0, unchanged: 1, failed: 0, trigger: "EXPLICIT" }]);
    // Les réconciliations du scan sont EXPLICIT, jamais STARTUP.
    const triggers = h.state.events.filter((item) => item.event === "goal_mode_dev.reconciliation").map((item) => item.metadata.trigger);
    assert.equal(triggers.includes("STARTUP"), false);
  } finally { await h.close(); }
});

test("B3b transport : maintenance absente → 503, flag OFF → 404, sans en-tête → 403", async () => {
  const h = await harness();
  try {
    const missing = await h.call("GET", "maintenance/lock");
    assert.equal(missing.status, 503);
    assert.equal(missing.body.code, "GOAL_MODE_DEV_LOCK_MAINTENANCE_UNAVAILABLE");
    assert.equal((await h.call("POST", "maintenance/reconcile-scan", { confirm: true })).status, 503);
    assert.equal((await h.call("GET", "maintenance/lock", undefined, { trusted: false })).status, 403);
    h.state.enabled = false;
    for (const [method, route, body] of [["GET", "maintenance/lock"], ["POST", "maintenance/lock-takeover", { confirm: true, expectedHolderPid: null }],
      ["POST", "maintenance/reconcile-scan", { confirm: true }]]) {
      const response = await h.call(method, route, body);
      assert.equal(response.status, 404, route);
      assert.equal(response.body.code, "GOAL_MODE_DEV_DISABLED", route);
    }
  } finally { await h.close(); }
});
