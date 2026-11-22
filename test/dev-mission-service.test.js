"use strict";

// V3-L5c — mission DEV : approbation au lancement, exécution isolée, approbation du diff exact,
// application sans commit, refus en cas de conflit local ou de patch modifié.
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { ApprovalEngine } = require("../services/approvals/approval-engine");
const { createExecutorWorktreeManager } = require("../services/delegation/executor-worktree");
const { createDevDelegationRunner } = require("../services/delegation/dev-delegation-runner");
const { assertSpecialistAgentAdapter } = require("../services/delegation/specialist-agent-adapter");
const { createDevMissionService, cleanRelativePaths } = require("../services/delegation/dev-mission-service");
const { createDevMissionHttpRoutes } = require("../services/delegation/dev-mission-http-routes");
const { genericApprovals } = require("../services/approvals/goal-mode-dev-approval-guard");

const git = (root, args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
function repository() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "noon-mission-repo-")));
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "value.js"), "module.exports = 1;\n");
  fs.writeFileSync(path.join(root, "README.md"), "fixture\n");
  git(root, ["init", "-q"]); git(root, ["config", "user.email", "fixture@example.test"]); git(root, ["config", "user.name", "Fixture"]);
  git(root, ["add", "."]); git(root, ["commit", "-qm", "fixture"]);
  return root;
}
const agent = (execute) => assertSpecialistAgentAdapter({ id: "codex-cli", name: "Codex", async isAvailable() { return true; }, getCapabilities() { return {}; }, executeTask: execute, async cancelTask() { return true; }, async getTaskStatus() { return "UNKNOWN"; } });
const writesTwo = agent(async (contract) => { fs.writeFileSync(path.join(contract.repositoryRoot, "src", "value.js"), "module.exports = 2;\n"); return { taskId: contract.taskId, agent: "codex-cli", status: "SUCCESS", summary: "Valeur passée à 2." }; });

function setup({ specialist = writesTwo, enabled = true, authorized = true } = {}) {
  const root = repository();
  const approvals = new ApprovalEngine({ ttlMs: 60_000 });
  const worktreeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "noon-mission-wt-"));
  const runner = createDevDelegationRunner({ workspaceEngine: { context: () => ({ roots: [{ path: root, mode: "read-write" }] }) }, specialistAgent: specialist, worktreeManager: createExecutorWorktreeManager({ rootDir: worktreeRoot, cloneDependencies: false }), validationExecutor: async (command) => ({ command, status: "PASS", durationMs: 1 }) });
  const authCalls = [];
  const service = createDevMissionService({ runner, approvals, isEnabled: () => enabled, authorizeRepository: (workspaceId, repo) => { authCalls.push([workspaceId, repo]); return authorized; } });
  return { root, approvals, service, authCalls, worktreeRoot };
}
const propose = (h, overrides = {}) => h.service.propose({ workspaceId: "fixture", repositoryRoot: h.root, objective: "Passer la valeur à 2.", allowedPaths: ["src"], ...overrides });

test("parcours complet : proposer → approuver le lancement → mission isolée → approuver le diff → appliqué sans commit", async () => {
  const h = setup();
  const proposed = propose(h);
  assert.equal(proposed.status, "awaiting_start");
  assert.equal(proposed.approval.kind, "start");
  assert.equal(proposed.executor, "codex-cli");
  assert.deepEqual(h.authCalls, [["fixture", h.root]]);
  assert.equal(genericApprovals(h.approvals.listPending()).length, 0, "absente des validations génériques");

  const started = h.service.start(proposed.id, { approvalId: proposed.approval.id });
  assert.equal(started.status, "running");
  assert.equal(fs.readFileSync(path.join(h.root, "src", "value.js"), "utf8"), "module.exports = 1;\n", "rien dans le dossier pendant la mission");
  await h.service.settled(proposed.id);

  const done = h.service.get(proposed.id);
  assert.equal(done.status, "awaiting_apply");
  assert.equal(done.result.finalVerdict, "PASS");
  assert.equal(done.result.sourceRepositoryUntouched, true);
  assert.deepEqual(done.result.files, [{ status: "M", path: "src/value.js" }]);
  assert.equal(done.approval.kind, "apply");
  assert.throws(() => h.service.start(proposed.id, { approvalId: proposed.approval.id }), (error) => error.code === "MISSION_STATE_INVALID");

  const diff = h.service.patch(proposed.id);
  assert.match(diff.text, /^-module\.exports = 1;$/m);
  assert.match(diff.text, /^\+module\.exports = 2;$/m);
  assert.equal(diff.truncated, false);

  const applied = h.service.apply(proposed.id, { approvalId: done.approval.id });
  assert.equal(applied.status, "applied");
  assert.equal(fs.readFileSync(path.join(h.root, "src", "value.js"), "utf8"), "module.exports = 2;\n");
  assert.equal(git(h.root, ["log", "--oneline"]).trim().split("\n").length, 1, "aucun commit");
  assert.equal(git(h.root, ["diff", "--cached", "--name-only"]).trim(), "", "rien d'indexé");
  assert.throws(() => h.service.apply(proposed.id, { approvalId: done.approval.id }), (error) => error.code === "MISSION_STATE_INVALID");
});

test("approbations : mauvaise approbation refusée, usage unique, dépôt non autorisé, commit déplacé, flag OFF", () => {
  const h = setup();
  const one = propose(h); const two = propose(h);
  assert.throws(() => h.service.start(one.id, { approvalId: two.approval.id }), (error) => error.code === "MISSION_APPROVAL_MISMATCH");
  git(h.root, ["commit", "-q", "--allow-empty", "-m", "nouveau commit"]);
  assert.throws(() => h.service.start(one.id, { approvalId: one.approval.id }), (error) => error.code === "MISSION_STALE");
  assert.throws(() => setup({ authorized: false }).service.propose({ workspaceId: "fixture", repositoryRoot: os.tmpdir(), objective: "x" }), (error) => error.code === "MISSION_REPOSITORY_FORBIDDEN");
  assert.throws(() => setup({ enabled: false }).service.propose({}), (error) => error.code === "MISSION_DISABLED");
  assert.throws(() => propose(h, { executor: "cursor" }), (error) => error.code === "MISSION_EXECUTOR_INVALID");
  assert.throws(() => propose(h, { allowedPaths: ["../etc"] }), (error) => error.code === "MISSION_PATHS_INVALID");
  assert.throws(() => propose(h, { objective: "  " }), (error) => error.code === "MISSION_OBJECTIVE_INVALID");
});

test("application refusée : fichier modifié localement, patch altéré après approbation", async () => {
  const h = setup();
  const mission = propose(h);
  h.service.start(mission.id, { approvalId: mission.approval.id });
  await h.service.settled(mission.id);
  const ready = h.service.get(mission.id);

  fs.writeFileSync(path.join(h.root, "src", "value.js"), "module.exports = 'travail local';\n");
  assert.throws(() => h.service.apply(mission.id, { approvalId: ready.approval.id }), (error) => error.code === "MISSION_LOCAL_CONFLICT" && error.files[0] === "src/value.js");
  assert.equal(fs.readFileSync(path.join(h.root, "src", "value.js"), "utf8"), "module.exports = 'travail local';\n", "travail local intact");
  git(h.root, ["checkout", "--", "src/value.js"]);

  // Altération du patch après l'approbation : l'empreinte change, l'approbation ne vaut plus.
  fs.appendFileSync(path.join(h.worktreeRoot, "patches", `${mission.id}.patch`), "\n");
  assert.throws(() => h.service.apply(mission.id, { approvalId: ready.approval.id }), (error) => error.code === "APPROVAL_ACTION_CHANGED");
  assert.equal(fs.readFileSync(path.join(h.root, "src", "value.js"), "utf8"), "module.exports = 1;\n");
});

test("mission sans changement, mission échouée, abandon et renouvellement de l'approbation d'application", async () => {
  const idle = setup({ specialist: agent(async (contract) => ({ taskId: contract.taskId, agent: "codex-cli", status: "SUCCESS", summary: "Rien à faire." })) });
  const none = propose(idle);
  idle.service.start(none.id, { approvalId: none.approval.id });
  await idle.service.settled(none.id);
  assert.equal(idle.service.get(none.id).status, "no_changes");

  const broken = setup({ specialist: agent(async (contract) => { fs.writeFileSync(path.join(contract.repositoryRoot, "README.md"), "hors périmètre\n"); return { taskId: contract.taskId, agent: "codex-cli", status: "SUCCESS", summary: "x" }; }) });
  const bad = propose(broken);
  broken.service.start(bad.id, { approvalId: bad.approval.id });
  await broken.service.settled(bad.id);
  const failed = broken.service.get(bad.id);
  assert.equal(failed.status, "failed");
  assert.equal(failed.approval, null, "aucune approbation d'application pour une mission FAIL");

  const h = setup();
  const mission = propose(h);
  h.service.start(mission.id, { approvalId: mission.approval.id });
  await h.service.settled(mission.id);
  const before = h.service.get(mission.id).approval.id;
  const renewed = h.service.renewApplyApproval(mission.id);
  assert.notEqual(renewed.approval.id, before);
  assert.throws(() => h.service.apply(mission.id, { approvalId: before }), (error) => error.code === "MISSION_APPROVAL_MISMATCH");
  const discarded = h.service.discard(mission.id);
  assert.equal(discarded.status, "discarded");
  assert.equal(h.approvals.listPending().length, 0);
  assert.equal(fs.readFileSync(path.join(h.root, "src", "value.js"), "utf8"), "module.exports = 1;\n");
});

test("routes HTTP : 404 flag OFF, en-tête exigé, clés exactes, erreurs connues", async () => {
  const call = async (routes, method, url, body, headers = {}) => {
    let status; let payload;
    const res = { writeHead: (code) => { status = code; }, end: (text) => { payload = JSON.parse(text); } };
    await routes.handle({ method, headers }, res, { requestPath: url, readJsonBody: async () => body });
    return { status, payload };
  };
  const h = setup();
  const off = createDevMissionHttpRoutes({ isEnabled: () => false, service: h.service });
  assert.equal((await call(off, "GET", "/api/dev-missions")).status, 404);
  const routes = createDevMissionHttpRoutes({ isEnabled: () => true, service: h.service });
  assert.equal(routes.matches("/api/dev-missions/mission-0123456789ab/start"), true);
  assert.equal(routes.matches("/api/dev-missions/../x"), false);
  assert.equal((await call(routes, "POST", "/api/dev-missions", { workspaceId: "fixture", repositoryRoot: h.root, objective: "x" })).status, 403);
  assert.equal((await call(routes, "POST", "/api/dev-missions", { workspaceId: "fixture", repositoryRoot: h.root, objective: "x", force: true }, { "x-noon-request": "1" })).payload.code, "MISSION_BODY_INVALID");
  const created = await call(routes, "POST", "/api/dev-missions", { workspaceId: "fixture", repositoryRoot: h.root, objective: "Passer à 2.", allowedPaths: ["src"] }, { "x-noon-request": "1" });
  assert.equal(created.status, 200);
  const listed = await call(routes, "GET", "/api/dev-missions");
  assert.equal(listed.payload.missions.length, 1);
  assert.deepEqual(listed.payload.repositories, []);
  assert.equal((await call(routes, "GET", `/api/dev-missions/${created.payload.mission.id}/patch`)).payload.code, "MISSION_PATCH_UNAVAILABLE", "aucun diff avant exécution");
  assert.equal((await call(routes, "POST", `/api/dev-missions/${created.payload.mission.id}/patch`, {}, { "x-noon-request": "1" })).status, 405);
  assert.equal((await call(routes, "POST", `/api/dev-missions/${created.payload.mission.id}/start`, { approvalId: "approval_00000000-0000-0000-0000-000000000000" }, { "x-noon-request": "1" })).payload.code, "MISSION_APPROVAL_MISMATCH");
});

test("D.2 : une mission qui écrit dans les fichiers de travail privés échoue, sans approbation d'application", async () => {
  const h = setup({ specialist: agent(async (contract) => { fs.writeFileSync(path.join(contract.repositoryRoot, "dev-cost-ledger.json"), "{}\n"); return { taskId: contract.taskId, agent: "codex-cli", status: "SUCCESS", summary: "x" }; }) });
  const mission = propose(h, { allowedPaths: ["."] });
  h.service.start(mission.id, { approvalId: mission.approval.id });
  await h.service.settled(mission.id);
  const done = h.service.get(mission.id);
  assert.equal(done.status, "failed");
  assert.equal(done.approval, null);
  assert.equal(fs.existsSync(path.join(h.root, "dev-cost-ledger.json")), false);
});

test("cleanRelativePaths normalise et refuse les chemins absolus ou remontants", () => {
  assert.deepEqual(cleanRelativePaths(["src/", "src", "test"]), ["src", "test"]);
  assert.deepEqual(cleanRelativePaths([]), ["."]);
  assert.throws(() => cleanRelativePaths(["/etc"]));
  assert.throws(() => cleanRelativePaths(["a/../../b"]));
});
