"use strict";
const { readServerSource } = require("./helpers/server-source");

// SelfDev V1 — SD-3 : politique de chemins pour Goal Mode DEV, routes HTTP, câblage serveur.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { execFileSync } = require("node:child_process");
const { createSelfDevWorktreeService, createSelfDevEvidenceService, createSelfDevPathPolicyProvider, createSelfDevTargetStore } = require("../services/selfdev");
const { createSelfDevHttpRoutes } = require("../services/selfdev/selfdev-http-routes");
const { FEATURE_FLAGS } = require("../services/config/feature-flag-registry");

const tmp = (prefix) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
const gitIn = (cwd, ...args) => execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

function makeRepo() {
  const root = tmp("noon-sd3-repo-");
  gitIn(root, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "noon", version: "0.0.0" }));
  fs.mkdirSync(path.join(root, "lib", "deep"), { recursive: true });
  fs.writeFileSync(path.join(root, "lib", "math.js"), "exports.add = (a, b) => a - b;\n");
  fs.writeFileSync(path.join(root, "lib", "deep", "AGENTS.md"), "# règles locales\n");
  fs.mkdirSync(path.join(root, "test"));
  fs.writeFileSync(path.join(root, "test", "existing.test.js"), "require('node:test')('ok', () => {});\n");
  fs.mkdirSync(path.join(root, "services", "security"), { recursive: true });
  fs.writeFileSync(path.join(root, "services", "security", "policy.js"), "//\n");
  gitIn(root, "add", "-A");
  gitIn(root, "commit", "-q", "-m", "base");
  return root;
}

function setup({ enabled = true, executeValidation = async () => ({ status: "PASS", exitCode: 0 }) } = {}) {
  const root = makeRepo();
  const container = tmp("noon-sd3-container-");
  const state = tmp("noon-sd3-state-");
  const targetStore = createSelfDevTargetStore({ filePath: path.join(state, "target.json"), writableRootsProvider: () => [container] });
  const worktreeService = createSelfDevWorktreeService({ container, stateDirectory: path.join(state, "wt"), cloneNodeModules: () => {} });
  const evidenceService = createSelfDevEvidenceService({ worktreeService, executeValidation, stateDirectory: path.join(state, "wt") });
  let flag = enabled;
  const routes = createSelfDevHttpRoutes({ isEnabled: () => flag, services: () => ({ targetStore, worktreeService, evidenceService }) });
  return { root, container, targetStore, worktreeService, evidenceService, routes, setFlag: (value) => { flag = value; } };
}

async function call(routes, method, requestPath, body = undefined, headers = { "x-noon-request": "1" }) {
  let status = 0; let payload = "";
  const res = { writeHead: (code) => { status = code; }, end: (text) => { payload = text; } };
  const req = { method, headers };
  await routes.handle(req, res, { requestPath, readJsonBody: async () => (body === undefined ? {} : body) });
  return { status, body: JSON.parse(payload) };
}

// ---------- Politique de chemins pour la projection ----------

test("politique Goal Mode : hors conteneur → null ; worktree → zones protégées, tests existants et AGENTS.md interdits", () => {
  const h = setup();
  const provider = createSelfDevPathPolicyProvider({ getContext: () => ({ worktreeService: h.worktreeService }) });
  assert.equal(provider({ repositoryRoot: h.root }), null, "le dépôt principal n'est pas concerné");
  const created = h.worktreeService.create({ repositoryRoot: h.root });
  const policy = provider({ repositoryRoot: created.worktreePath });
  assert.equal(policy.selfDevId, created.id);
  for (const relative of ["services/security", "package.json", "test/existing.test.js", "lib/deep/AGENTS.md"]) {
    assert.ok(policy.forbiddenPaths.includes(path.join(created.worktreePath, relative)), relative);
  }
  assert.equal(policy.forbiddenPaths.some((item) => item.endsWith(path.join("lib", "math.js"))), false, "le code applicatif reste modifiable");
  assert.equal(policy.forbiddenPaths.includes(path.join(created.worktreePath, "test")), false, "de nouveaux tests restent possibles");
});

test("politique Goal Mode : dossier inconnu du conteneur → échec fermé ; aucune cible → null", () => {
  const h = setup();
  const provider = createSelfDevPathPolicyProvider({ getContext: () => ({ worktreeService: h.worktreeService }) });
  const stray = path.join(h.container, "copie-orpheline");
  fs.mkdirSync(stray);
  assert.throws(() => provider({ repositoryRoot: stray }), { code: "SELFDEV_WORKTREE_UNKNOWN" });
  assert.throws(() => provider({ repositoryRoot: path.join(h.container, "absent") }), { code: "SELFDEV_REPOSITORY_INVALID" });
  assert.equal(createSelfDevPathPolicyProvider({ getContext: () => null })({ repositoryRoot: stray }), null);
});

// ---------- Routes HTTP ----------

test("routes : flag OFF → 404 ; mutation sans en-tête → 403 ; champs inconnus → 400", async () => {
  const h = setup({ enabled: false });
  assert.equal((await call(h.routes, "GET", "/api/selfdev/status")).status, 404);
  h.setFlag(true);
  assert.equal((await call(h.routes, "GET", "/api/selfdev/status")).status, 200);
  assert.equal((await call(h.routes, "POST", "/api/selfdev/worktrees", {}, {})).status, 403);
  const extra = await call(h.routes, "PUT", "/api/selfdev/target", { repositoryRoot: h.root, baseBranch: "main", worktreeContainer: h.container, permissions: ["ALL"] });
  assert.equal(extra.status, 400);
  assert.equal(extra.body.code, "SELFDEV_BODY_INVALID");
  assert.equal(h.routes.matches("/api/selfdev/worktrees/../../etc"), false);
});

test("routes : cible, copie, mesures base/patch/reproduction et verdict, sans chemin fourni par le client", async () => {
  const calls = [];
  const h = setup({ executeValidation: async (command, cwd, timeout, signal, context) => {
    calls.push({ command, cwd, context });
    const failing = path.basename(cwd).includes("-probe-") && command.includes("repro");
    return { status: failing ? "FAIL" : "PASS", exitCode: failing ? 1 : 0, outputTail: failing ? "not ok 1 - repro\n" : "" };
  } });
  assert.equal((await call(h.routes, "PUT", "/api/selfdev/target", { repositoryRoot: h.root, baseBranch: "main", worktreeContainer: h.container })).status, 200);
  const created = await call(h.routes, "POST", "/api/selfdev/worktrees", {});
  assert.equal(created.status, 200);
  const id = created.body.worktree.id;
  const base = await call(h.routes, "POST", `/api/selfdev/worktrees/${id}/baseline`, { workspaceId: "ws-1", commands: ["npm test"] });
  assert.equal(base.status, 200, JSON.stringify(base.body));
  fs.writeFileSync(path.join(created.body.worktree.worktreePath, "lib", "math.js"), "exports.add = (a, b) => a + b;\n");
  fs.writeFileSync(path.join(created.body.worktree.worktreePath, "test", "repro.test.js"), "// repro\n");
  assert.equal((await call(h.routes, "POST", `/api/selfdev/worktrees/${id}/patched`, { workspaceId: "ws-1" })).status, 200);
  const repro = await call(h.routes, "POST", `/api/selfdev/worktrees/${id}/reproduction`, { workspaceId: "ws-1", testFiles: ["test/repro.test.js"] });
  assert.equal(repro.body.verdict.verdict, "DEMONSTRATED", JSON.stringify(repro.body));
  assert.ok(calls.every((item) => item.context.workspaceId === "ws-1" && item.context.taskId === `selfdev-${id}` && item.context.permissions.join() === "TERMINAL_SAFE"));
  assert.ok(calls.every((item) => item.cwd.startsWith(h.container)), "exécution uniquement dans le conteneur SelfDev");
  const status = await call(h.routes, "GET", "/api/selfdev/status");
  assert.equal(status.body.worktrees[0].verdict.verdict, "DEMONSTRATED");
  assert.equal((await call(h.routes, "POST", `/api/selfdev/worktrees/${id}/baseline`, { workspaceId: "ws-1", commands: ["npm test"], cwd: "/" })).status, 400, "aucun dossier d'exécution accepté du client");
  const blocked = await call(h.routes, "DELETE", `/api/selfdev/worktrees/${id}`, {});
  assert.equal(blocked.body.code, "SELFDEV_WORKTREE_HAS_CHANGES");
  assert.equal((await call(h.routes, "DELETE", `/api/selfdev/worktrees/${id}`, { discardChanges: true })).status, 200);
});

test("routes : patch touchant un chemin protégé → 409, aucune validation lancée", async () => {
  let runs = 0;
  const h = setup({ executeValidation: async () => { runs += 1; return { status: "PASS", exitCode: 0 }; } });
  await call(h.routes, "PUT", "/api/selfdev/target", { repositoryRoot: h.root, baseBranch: "main", worktreeContainer: h.container });
  const created = await call(h.routes, "POST", "/api/selfdev/worktrees", {});
  const id = created.body.worktree.id;
  await call(h.routes, "POST", `/api/selfdev/worktrees/${id}/baseline`, { workspaceId: "ws-1", commands: ["npm test"] });
  const before = runs;
  fs.writeFileSync(path.join(created.body.worktree.worktreePath, "services", "security", "policy.js"), "// contournement\n");
  const result = await call(h.routes, "POST", `/api/selfdev/worktrees/${id}/patched`, { workspaceId: "ws-1" });
  assert.equal(result.status, 409);
  assert.equal(result.body.code, "SELFDEV_PROTECTED_PATH_CHANGED");
  assert.equal(runs, before);
  assert.equal((await call(h.routes, "GET", `/api/selfdev/worktrees/${id}/verdict`)).body.verdict.verdict, "BLOCKED");
});

test("routes : sans cible enregistrée, création refusée (409)", async () => {
  const h = setup();
  const routes = createSelfDevHttpRoutes({ isEnabled: () => true, services: () => ({ targetStore: h.targetStore, worktreeService: null, evidenceService: null }) });
  const result = await call(routes, "POST", "/api/selfdev/worktrees", {});
  assert.equal(result.status, 409);
  assert.equal(result.body.code, "SELFDEV_TARGET_REQUIRED");
});

// ---------- Flag et câblage ----------

test("flag selfdev.v1 : OFF par défaut, exige goals.mode-dev", () => {
  const flag = FEATURE_FLAGS.find((item) => item.flagId === "selfdev.v1");
  assert.equal(flag.defaultMode, "OFF");
  assert.deepEqual(flag.requires, ["goals.mode-dev"]);
});

test("câblage serveur : politique de chemins transmise à Goal Mode DEV, routes gardées, exécuteur sandboxé", () => {
  const server = readServerSource();
  assert.match(server, /pathPolicyProvider: selfDevPathPolicyProvider,/);
  assert.match(server, /executeValidation: sandboxDevValidationExecutor/);
  assert.match(server, /featureFlags\.evaluate\("selfdev\.v1", \{\}\)\.mode !== "OFF" &&\n\s+!UI_VALIDATION_MODE && process\.env\.NOON_SMOKE_TEST !== "1" && process\.env\.NOON_SAFE_MODE !== "1"/);
  assert.ok(server.indexOf("if (selfDevHttpRoutes.matches(requestPath))") > 0);
  assert.match(server, /writableRootsProvider: \(\) => localPermissionStore\.roots\("read-write"\)/);
});
