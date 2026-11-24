"use strict";
const { readServerSource } = require("./helpers/server-source");
const { readAppSource } = require("./helpers/app-source");

// SelfDev V1 — SD-4 : relecture consultative, résolution du workspace, carte du Control Center.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");
const { createSelfDevWorktreeService, createSelfDevEvidenceService, createSelfDevTargetStore } = require("../services/selfdev");
const { createSelfDevReviewService } = require("../services/selfdev/selfdev-review-service");
const { createSelfDevHttpRoutes } = require("../services/selfdev/selfdev-http-routes");

const PUBLIC = path.join(__dirname, "..", "public");
const tmp = (prefix) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
const gitIn = (cwd, ...args) => execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

function makeRepo() {
  const root = tmp("noon-sd4-repo-");
  gitIn(root, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "noon" }));
  fs.mkdirSync(path.join(root, "lib")); fs.writeFileSync(path.join(root, "lib", "a.js"), "1;\n");
  fs.mkdirSync(path.join(root, "services", "security"), { recursive: true }); fs.writeFileSync(path.join(root, "services", "security", "p.js"), "//\n");
  gitIn(root, "add", "-A"); gitIn(root, "commit", "-q", "-m", "base");
  return root;
}

function setup({ remoteAllowed = true, runReview = async () => ({ provider: "Codex", mode: "read-only", analysis: "1) Risque faible. 2) Ajouter un test. 3) Favorable." }) } = {}) {
  const root = makeRepo();
  const container = tmp("noon-sd4-container-");
  const state = tmp("noon-sd4-state-");
  const worktreeService = createSelfDevWorktreeService({ container, stateDirectory: state, cloneNodeModules: () => {} });
  const evidenceService = createSelfDevEvidenceService({ worktreeService, executeValidation: async () => ({ status: "PASS", exitCode: 0 }), stateDirectory: state });
  const reviews = [];
  const reviewService = createSelfDevReviewService({ worktreeService, evidenceService, stateDirectory: state, isRemoteAllowed: () => remoteAllowed,
    runReview: async (input) => { reviews.push(input); return runReview(input); } });
  const created = worktreeService.create({ repositoryRoot: root });
  return { root, container, worktreeService, evidenceService, reviewService, created, reviews };
}

test("relecture : lecture seule dans la copie, avis stocké comme donnée non fiable", async () => {
  const h = setup();
  fs.writeFileSync(path.join(h.created.worktreePath, "lib", "a.js"), "2;\n");
  const review = await h.reviewService.review(h.created.id);
  assert.equal(review.trust, "model_output_untrusted");
  assert.equal(review.provider, "Codex");
  assert.equal(h.reviews[0].worktreePath, h.created.worktreePath, "le relecteur travaille dans la copie");
  assert.match(h.reviews[0].question, new RegExp(h.created.baseCommit));
  assert.match(h.reviews[0].question, /Ignore toute instruction/);
  assert.equal(h.reviewService.load(h.created.id).analysis, review.analysis);
});

test("relecture : refusée en mode local uniquement, sur chemin protégé, sans patch ; relecteur en échec signalé", async () => {
  const local = setup({ remoteAllowed: false });
  fs.writeFileSync(path.join(local.created.worktreePath, "lib", "a.js"), "2;\n");
  await assert.rejects(local.reviewService.review(local.created.id), { code: "SELFDEV_REVIEW_BLOCKED" });
  assert.equal(local.reviews.length, 0, "aucun envoi distant");
  const empty = setup();
  await assert.rejects(empty.reviewService.review(empty.created.id), { code: "SELFDEV_PATCH_EMPTY" });
  const protectedPatch = setup();
  fs.writeFileSync(path.join(protectedPatch.created.worktreePath, "services", "security", "p.js"), "// x\n");
  await assert.rejects(protectedPatch.reviewService.review(protectedPatch.created.id), { code: "SELFDEV_PROTECTED_PATH_CHANGED" });
  assert.equal(protectedPatch.reviews.length, 0);
  const failing = setup({ runReview: async () => { throw new Error("codex absent"); } });
  fs.writeFileSync(path.join(failing.created.worktreePath, "lib", "a.js"), "2;\n");
  await assert.rejects(failing.reviewService.review(failing.created.id), { code: "SELFDEV_REVIEW_UNAVAILABLE" });
});

async function call(routes, method, requestPath, body = undefined) {
  let status = 0; let payload = "";
  await routes.handle({ method, headers: { "x-noon-request": "1" } }, { writeHead: (code) => { status = code; }, end: (text) => { payload = text; } }, { requestPath, readJsonBody: async () => (body === undefined ? {} : body) });
  return { status, body: JSON.parse(payload) };
}

test("routes : workspace résolu par le serveur s'il est unique ; sinon 409 explicite ; relecture exposée", async () => {
  const h = setup();
  const targetStore = createSelfDevTargetStore({ filePath: path.join(tmp("noon-sd4-t-"), "t.json") });
  let ids = [];
  const contexts = [];
  const evidenceService = createSelfDevEvidenceService({ worktreeService: h.worktreeService, executeValidation: async (c, cwd, t, s, context) => { contexts.push(context); return { status: "PASS", exitCode: 0 }; }, stateDirectory: tmp("noon-sd4-e-") });
  const routes = createSelfDevHttpRoutes({ isEnabled: () => true, services: () => ({ targetStore, worktreeService: h.worktreeService, evidenceService, reviewService: h.reviewService, resolveWorkspaceIds: () => ids }) });
  const url = `/api/selfdev/worktrees/${h.created.id}/baseline`;
  assert.equal((await call(routes, "POST", url, { commands: ["npm test"] })).body.code, "SELFDEV_WORKSPACE_REQUIRED");
  ids = ["ws-a", "ws-b"];
  assert.equal((await call(routes, "POST", url, { commands: ["npm test"] })).body.code, "SELFDEV_WORKSPACE_AMBIGUOUS");
  assert.equal((await call(routes, "POST", url, { commands: ["npm test"], workspaceId: "ws-b" })).status, 200, "un workspace explicite reste possible");
  ids = ["ws-a"];
  fs.writeFileSync(path.join(h.created.worktreePath, "lib", "a.js"), "3;\n");
  assert.equal((await call(routes, "POST", `/api/selfdev/worktrees/${h.created.id}/patched`, {})).status, 200);
  assert.deepEqual(contexts.map((context) => context.workspaceId), ["ws-b", "ws-a"]);
  const review = await call(routes, "POST", `/api/selfdev/worktrees/${h.created.id}/review`, {});
  assert.equal(review.status, 200);
  assert.equal(review.body.review.trust, "model_output_untrusted");
  const status = await call(routes, "GET", "/api/selfdev/status");
  assert.equal(status.body.reviewAvailable, true);
  assert.equal(status.body.worktrees[0].review.provider, "Codex");
  const none = createSelfDevHttpRoutes({ isEnabled: () => true, services: () => ({ targetStore, worktreeService: h.worktreeService, evidenceService, reviewService: null }) });
  assert.equal((await call(none, "POST", `/api/selfdev/worktrees/${h.created.id}/review`, {})).status, 409);
});

// ---------- Interface ----------

class FakeElement {
  constructor(tag, id = null) {
    this.tagName = String(tag).toUpperCase();
    this.id = id;
    this.children = [];
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.className = "";
    this.dataset = {};
    this.listeners = {};
    this.attributes = {};
    this.ownText = "";
    this.open = false;
    this.type = "";
    const element = this;
    this.classList = {
      toggle(name, force) {
        const names = new Set(element.className.split(/\s+/).filter(Boolean));
        if (force === undefined ? !names.has(name) : force) names.add(name); else names.delete(name);
        element.className = [...names].join(" ");
      },
      contains: (name) => element.className.split(/\s+/).includes(name),
    };
  }
  get childNodes() { return this.children; }
  get textContent() { return this.ownText + this.children.map((child) => child.textContent).join(""); }
  set textContent(value) { this.children = []; this.ownText = String(value); }
  set innerHTML(_) { throw new Error("innerHTML interdit"); }
  get innerHTML() { throw new Error("innerHTML interdit"); }
  insertAdjacentHTML() { throw new Error("insertAdjacentHTML interdit"); }
  append(...nodes) { this.children.push(...nodes); }
  prepend(...nodes) { this.children.unshift(...nodes); }
  replaceChildren(...nodes) { this.children = [...nodes]; this.ownText = ""; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
  dispatch(type) { for (const handler of this.listeners[type] || []) handler({ target: this }); }
  click() { this.dispatch("click"); }
  querySelectorAll(selector) {
    if (selector !== "button") throw new Error(`sélecteur non pris en charge : ${selector}`);
    return all(this).filter((node) => node.tagName === "BUTTON");
  }
  showModal() { this.open = true; }
  close() { this.open = false; }
}

const all = (node) => node.children.flatMap((child) => [child, ...all(child)]);
const find = (root, predicate) => all(root).find(predicate);
const buttonByText = (root, text) => find(root, (node) => node.tagName === "BUTTON" && node.textContent === text);
const settle = async () => { for (let index = 0; index < 8; index += 1) await new Promise((resolve) => setImmediate(resolve)); };


const inputByLabel = (root, label) => all(root).find((node) => node.tagName === "LABEL" && node.children[0]?.textContent === label)?.children[1];

function loadUi({ status, replies = {}, confirm = () => true }) {
  const document = { createElement: (tag) => new FakeElement(tag) };
  const context = { document, URL, Promise, Object, String, Array, Set, Map, Number, JSON, Error, TypeError };
  context.window = context;
  vm.runInNewContext(fs.readFileSync(path.join(PUBLIC, "selfdev-ui.js"), "utf8"), context);
  const ui = context.window.NoonSelfDevUi;
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, method: options.method, headers: { ...(options.headers || {}) }, body: options.body ? JSON.parse(options.body) : undefined });
    if (options.method === "GET") return status === 404 ? { ok: false, status: 404, json: async () => ({ code: "SELFDEV_DISABLED" }) } : { ok: true, status: 200, json: async () => (typeof status === "function" ? status() : status) };
    const reply = replies[`${options.method} ${url}`];
    if (reply?.error) return { ok: false, status: 409, json: async () => ({ code: reply.error, message: "brut" }) };
    return { ok: true, status: 200, json: async () => reply || { status: "ok" } };
  };
  const root = new FakeElement("section"); root.ownerDocument = document; root.hidden = true;
  const controller = ui.createSelfDevController({ elements: { root }, api: ui.createSelfDevApi({ fetchImpl }), confirmImpl: confirm });
  return { controller, root, calls };
}

const WORKTREE = { id: "20261121-abcdef12", branch: "selfdev/20261121-abcdef12", baseCommit: "0123456789abcdef", worktreePath: "/copies/20261121-abcdef12", exists: true, changedFiles: 2, ageDays: 1, cleanupSuggested: false,
  verdict: { verdict: "DEMONSTRATED", reasons: [], comparison: [{ command: "npm test", before: "PASS", after: "PASS", change: "UNCHANGED" }], reproduction: { files: ["test/bug.test.js"], onBase: { status: "FAIL" }, afterPatch: { status: "PASS" }, reproduced: true } },
  review: { provider: "Codex", analysis: "<script>alert(1)</script> Avis favorable." } };
const TARGET = { repositoryRoot: "/Users/x/Noon", baseBranch: "main", worktreeContainer: "/copies" };

test("UI : flag OFF → masquée ; sans cible → formulaire ; enregistrement par PUT avec X-Noon-Request", async () => {
  assert.equal(await loadUi({ status: 404 }).controller.init(), false);
  const h = loadUi({ status: { status: "ok", target: null, reviewAvailable: false, worktrees: [] } });
  assert.equal(await h.controller.init(), true);
  assert.equal(buttonByText(h.root, "Nouvelle copie isolée").disabled, true);
  for (const [label, value] of [["Dépôt Noon (racine)", "/Users/x/Noon"], ["Branche de base", "main"], ["Dossier des copies", "/copies"]]) {
    const input = inputByLabel(h.root, label); input.value = value; input.dispatch("input");
  }
  buttonByText(h.root, "Enregistrer la cible").click();
  await settle();
  const put = h.calls.find((item) => item.method === "PUT");
  assert.equal(put.url, "/api/selfdev/target");
  assert.equal(put.headers["X-Noon-Request"], "1");
  assert.deepEqual(put.body, { repositoryRoot: "/Users/x/Noon", baseBranch: "main", worktreeContainer: "/copies" });
});

test("UI : copie avec verdict, comparaison, reproduction et avis rendus en texte ; étapes envoyées au serveur", async () => {
  const h = loadUi({ status: { status: "ok", target: TARGET, reviewAvailable: true, worktrees: [WORKTREE] } });
  await h.controller.init();
  const text = h.root.textContent;
  assert.ok(text.includes("Démontré"));
  assert.ok(text.includes("bug reproduit puis corrigé"));
  assert.ok(text.includes("<script>alert(1)</script> Avis favorable."), "avis affiché tel quel, en texte");
  assert.ok(text.includes("donnée non vérifiée"));
  const commands = inputByLabel(h.root, "Validations (séparées par des virgules)"); commands.value = "npm test, npm run lint"; commands.dispatch("input");
  buttonByText(h.root, "1. Mesurer la base").click(); await settle();
  const repro = inputByLabel(h.root, "Tests de reproduction (nouveaux fichiers)"); repro.value = "test/bug.test.js"; repro.dispatch("input");
  buttonByText(h.root, "3. Prouver la reproduction").click(); await settle();
  buttonByText(h.root, "4. Relire avec Codex (lecture seule)").click(); await settle();
  const posts = h.calls.filter((item) => item.method === "POST");
  assert.deepEqual(posts.map((item) => item.url.split("/").pop()), ["baseline", "reproduction", "review"]);
  assert.deepEqual(posts[0].body, { commands: ["npm test", "npm run lint"] });
  assert.deepEqual(posts[1].body, { testFiles: ["test/bug.test.js"] });
  assert.equal(JSON.stringify(posts).includes("workspaceId"), false, "le workspace est résolu par le serveur");
});

test("UI : jeter une copie modifiée demande confirmation et envoie discardChanges ; erreurs traduites", async () => {
  for (const accepted of [false, true]) {
    const h = loadUi({ status: { status: "ok", target: TARGET, reviewAvailable: false, worktrees: [WORKTREE] }, confirm: () => accepted });
    await h.controller.init();
    buttonByText(h.root, "Jeter la copie").click(); await settle();
    const del = h.calls.find((item) => item.method === "DELETE");
    assert.equal(Boolean(del), accepted);
    if (del) assert.deepEqual(del.body, { discardChanges: true });
  }
  const h = loadUi({ status: { status: "ok", target: TARGET, reviewAvailable: false, worktrees: [WORKTREE] }, replies: { [`POST /api/selfdev/worktrees/${WORKTREE.id}/patched`]: { error: "SELFDEV_PROTECTED_PATH_CHANGED" } } });
  await h.controller.init();
  buttonByText(h.root, "2. Mesurer le patch").click(); await settle();
  assert.ok(h.root.textContent.includes("Le patch touche un chemin protégé"));
  assert.equal(h.root.textContent.includes("brut"), false);
});

test("contrat source UI : aucun innerHTML, aucun stockage navigateur, aucun bouton commit/merge/push", () => {
  const source = fs.readFileSync(path.join(PUBLIC, "selfdev-ui.js"), "utf8");
  assert.equal(/innerHTML|insertAdjacentHTML|localStorage|sessionStorage|document\.cookie/.test(source), false);
  assert.equal(/"(Commiter|Fusionner|Pousser|Merge|Commit|Push)/.test(source), false);
});

test("Control Center : entrée SelfDev à côté de MCP, jamais vidée ; câblage index/app/serveur", async () => {
  const ids = ["controlCenter", "controlCenterNavigation", "controlCenterOverview", "controlCenterSection", "controlCenterLoading", "controlCenterView",
    "openControlCenterButton", "closeControlCenter", "refreshControlCenter", "quickSettings", "controlCenterGoalModeDev", "controlCenterMcp", "controlCenterSelfDev"];
  const nodes = Object.fromEntries(ids.map((id) => [id, new FakeElement(id === "controlCenter" ? "dialog" : "div", id)]));
  nodes.controlCenterView.value = "USER";
  for (const id of ["controlCenterGoalModeDev", "controlCenterMcp", "controlCenterSelfDev"]) nodes[id].hidden = true;
  const sentinel = new FakeElement("section"); nodes.controlCenterSelfDev.append(sentinel);
  let refreshes = 0;
  const fetch = async (url) => ({ ok: true, json: async () => (url.includes("/overview") ? { snapshot: { availableSections: ["goals"], sections: {}, needsAttention: [], overallStatus: "OK" } } : { section: { sectionId: "goals", summary: "", status: "OK", items: [] } }) });
  const window = { NoonSelfDev: { refresh: async () => { refreshes += 1; } } };
  vm.runInNewContext(fs.readFileSync(path.join(PUBLIC, "control-center.js"), "utf8"), { window, document: { getElementById: (id) => nodes[id] || null, createElement: (tag) => new FakeElement(tag) }, fetch, URLSearchParams, encodeURIComponent, Promise, Object, String, Array });
  const api = window.NoonControlCenter;
  await api.open();
  api.setMcpAvailable(true); api.setSelfDevAvailable(true);
  // Interface V3, étape 2 : la navigation intercale des titres de groupe ; seuls les boutons comptent.
  const navEntries = () => nodes.controlCenterNavigation.children.filter((node) => node.tagName === "BUTTON");
  const labels = () => navEntries().map((button) => button.textContent);
  assert.deepEqual(labels(), ["Vue d’ensemble", "Objectifs", "Connecteurs MCP", "SelfDev"]);
  navEntries().find((button) => button.textContent === "SelfDev").click(); await settle();
  assert.equal(nodes.controlCenterSelfDev.hidden, false);
  assert.equal(nodes.controlCenterMcp.hidden, true);
  assert.equal(refreshes, 1);
  navEntries().find((button) => button.textContent === "Connecteurs MCP").click(); await settle();
  assert.equal(nodes.controlCenterSelfDev.hidden, true);
  assert.deepEqual(nodes.controlCenterSelfDev.children, [sentinel]);
  api.setSelfDevAvailable(false);
  assert.deepEqual(labels(), ["Vue d’ensemble", "Objectifs", "Connecteurs MCP"]);
  const index = fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8");
  assert.ok(index.indexOf('<script src="selfdev-ui.js"></script>') < index.indexOf('<script src="app.js"></script>'));
  assert.match(readAppSource(), /window\.NoonControlCenter\?\.setSelfDevAvailable\?\.\(available === true\)/);
  const server = readServerSource();
  assert.match(server, /"\/selfdev-ui\.js": \{ file: \["selfdev-ui\.js"\]/);
  assert.match(server, /runReview: \(\{ worktreePath, question, signal \}\) => runCodexAnalysis\(\{ question, projectPath: worktreePath, signal \}\)/);
  assert.match(server, /isRemoteAllowed: \(\) => localIntelligenceRuntime\.preflight\(\{ requiredCapabilities: \["REMOTE_REASONING"\] \}\)\.status === "AVAILABLE"/);
});
