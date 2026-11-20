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

async function harness({ goal = goalFixture() } = {}) {
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
    enabled: true, preference: "BALANCED", ledgerCalls: 0, providerCalls: 0,
    facadeCalls: [], cancels: [], gate: null, audit: [],
  };
  const workspace = {
    workspace: { id: "workspace-b2", status: "active", profileScope: "arnaud" },
    projects: [{ id: "project-b2", rootPath: repositoryRoot }],
    relevantRoots: [{ path: writable, mode: "read-write" }],
  };
  const runtime = createGoalModeDevRuntime({
    database,
    goalStrategyEngine: { registry: { get: (goalId) => (goalId === goal.goalId ? goal : null), list: () => [goal] } },
    workspaceEngine: { context: (id) => (id === "workspace-b2" ? workspace : null) },
    devBudgetService: { effectiveRemaining: () => 10, taskProviderCalls: () => state.ledgerCalls },
    devTaskJournal: createDevTaskJournal({ directory: path.join(directory, "journal") }),
    approvalEngine: createApprovalEngine({}),
    operationalSecurityPolicy: createOperationalSecurityPolicy(),
    projectRuleResolver: { resolve: () => ({ applied: [{ text: "SYNTHETIC_PROJECT_RULE_B2" }] }) },
    nativeDevFacade: {
      async runTask(payload) {
        state.facadeCalls.push(payload);
        if (state.gate) await state.gate.promise;
        return { taskId: payload.taskId, status: "COMPLETED", finalVerdict: "PASS" };
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
    authorizePrivacy: () => ({}),
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
            requestedCapabilities: { network: true, gitWrite: false, destructiveActions: false },
            requiresUserInput: false,
          }),
          toolCalls: [],
          usage: { inputTokens: 100, cachedInputTokens: 0, outputTokens: 50, totalTokens: 150 },
          provider: "openai", model: "synthetic-model",
        };
      },
    },
  });
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
  });
  const server = http.createServer((req, res) => {
    handler.handle(req, res, new URL(req.url, "http://127.0.0.1").pathname).then((handled) => {
      if (!handled) { res.writeHead(404); res.end(); }
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
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
    directory, repositoryRoot, database, runtime, server, state, call, goal,
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
    const reservation = await h.call("GET", `runs/${run.runId}/reservations/${prepared.body.reservationId}`);
    assert.equal(reservation.status, 200);
    assert.equal(reservation.body.reservationStatus, "MAY_HAVE_STARTED");
    assert.equal(JSON.stringify(reservation.body).includes("goal-mode-dev-"), false);
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
    for (const [method, route] of [["POST", "unknown"], ["GET", "runs"], ["DELETE", `runs/${run.runId}`],
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
    assert.equal(status.body.reservationStatus, "MAY_HAVE_STARTED");
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
