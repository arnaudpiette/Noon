"use strict";
const { readAppSource } = require("./helpers/app-source");

// V3-L5d — panneau « Missions DEV » : préparer, lancer après validation, suivre, relire le diff,
// appliquer après confirmation ; rendu en texte brut ; masqué si le flag est OFF.
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const PUBLIC = path.join(__dirname, "..", "public");

class FakeElement {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase(); this.children = []; this.hidden = false; this.disabled = false;
    this.className = ""; this.dataset = {}; this.listeners = {}; this.attributes = {}; this.ownText = ""; this.type = ""; this.value = "";
  }
  get childNodes() { return this.children; }
  get textContent() { return this.ownText + this.children.map((child) => child.textContent).join(""); }
  set textContent(value) { this.children = []; this.ownText = String(value); }
  set innerHTML(_) { throw new Error("innerHTML interdit"); }
  get innerHTML() { throw new Error("innerHTML interdit"); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = [...nodes]; this.ownText = ""; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
  dispatch(type) { for (const handler of this.listeners[type] || []) handler({ target: this }); }
  click() { this.dispatch("click"); }
}
const all = (node) => node.children.flatMap((child) => [child, ...all(child)]);
const buttonByText = (root, text) => all(root).find((node) => node.tagName === "BUTTON" && node.textContent === text);
const settle = async () => { for (let index = 0; index < 8; index += 1) await new Promise((resolve) => setImmediate(resolve)); };
const NOW = Date.parse("2026-11-22T10:00:00Z");

function loadUi({ list, replies = {}, confirm = () => true }) {
  const document = { createElement: (tag) => new FakeElement(tag), createTextNode: (text) => { const node = new FakeElement("#text"); node.ownText = String(text); return node; } };
  const context = { document, Promise, Object, String, Array, Set, Map, Number, JSON, Error, TypeError, Date, Math };
  context.window = context;
  vm.runInNewContext(fs.readFileSync(path.join(PUBLIC, "dev-missions-ui.js"), "utf8"), context);
  const ui = context.window.NoonDevMissionsUi;
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, method: options.method, headers: { ...(options.headers || {}) }, body: options.body ? JSON.parse(options.body) : undefined });
    if (options.method === "GET" && url === "/api/dev-missions") return list === 404 ? { ok: false, status: 404, json: async () => ({ code: "MISSION_DISABLED" }) } : { ok: true, status: 200, json: async () => ({ status: "ok", enabled: true, ...list() }) };
    const reply = replies[`${options.method} ${url}`];
    if (reply?.error) return { ok: false, status: 409, json: async () => ({ code: reply.error, message: "brut", files: reply.files }) };
    return { ok: true, status: 200, json: async () => reply || { status: "ok" } };
  };
  const root = new FakeElement("section"); root.ownerDocument = document; root.hidden = true;
  const timers = [];
  const controller = ui.createDevMissionsController({ elements: { root }, api: ui.createDevMissionsApi({ fetchImpl }), confirmImpl: confirm, now: () => NOW, setTimer: (fn) => { timers.push(fn); return timers.length; }, clearTimer: () => {} });
  return { controller, root, calls, timers, ui };
}

const executors = [{ id: "codex-cli", name: "Codex CLI", available: true, default: true, version: "0.160.0" }, { id: "claude-code", name: "Claude Code CLI", available: false, default: false, version: null }];
const repositories = [{ workspaceId: "ws-noon", workspaceName: "Noon", repositoryRoot: "/Users/test/Noon", name: "Noon" }];
const mission = (overrides = {}) => ({
  id: "mission-0123456789ab", status: "awaiting_start", objective: "Passer la valeur à 2.", repositoryRoot: "/Users/test/Noon", allowedPaths: ["src"], executor: "codex-cli", baseCommit: "abcdef1234567",
  approval: { id: "approval_start", kind: "start", expiresAt: "2026-11-22T10:05:00Z", summary: "Codex travaillera dans une copie isolée de Noon." }, result: null, error: null, ...overrides,
});
const ready = (overrides = {}) => mission({
  status: "awaiting_apply", approval: { id: "approval_apply", kind: "apply", expiresAt: "2026-11-22T10:05:00Z", summary: "Appliquer 1 fichier(s) à Noon sans commit : src/value.js" },
  result: { finalVerdict: "PASS", summary: "Valeur passée à 2.", files: [{ status: "M", path: "src/value.js" }], validations: [{ command: "npm test", status: "PASS" }], sourceUncommittedChanges: 2, patchBytes: 120 }, ...overrides,
});

test("panneau masqué si le flag est OFF (404)", async () => {
  const { controller, root } = loadUi({ list: 404 });
  assert.equal(await controller.init(), false);
  assert.equal(root.hidden, true);
});

test("parcours : préparer → lancer avec l'approbation → suivi → diff relu en texte brut → appliquer après confirmation", async () => {
  let missions = [];
  const { controller, root, calls, timers } = loadUi({
    list: () => ({ executors, repositories, missions }),
    replies: { "GET /api/dev-missions/mission-0123456789ab/patch": { status: "ok", patch: { missionId: "mission-0123456789ab", bytes: 40, truncated: false, text: "+<script>alert(1)</script>\n" } } },
  });
  assert.equal(await controller.init(), true);
  assert.equal(root.hidden, false);
  assert.match(root.textContent, /Claude Code CLI — indisponible/);
  const claudeOption = all(root).find((node) => node.tagName === "OPTION" && node.value === "claude-code");
  assert.equal(claudeOption.disabled, true, "exécutant absent non sélectionnable");

  const textarea = all(root).find((node) => node.tagName === "TEXTAREA");
  textarea.value = "  Passer la valeur à 2.  "; textarea.dispatch("input");
  const paths = all(root).find((node) => node.tagName === "INPUT");
  paths.value = "src, test"; paths.dispatch("input");
  buttonByText(root, "Préparer la mission").click(); await settle();
  const proposal = calls.find((call) => call.method === "POST" && call.url === "/api/dev-missions");
  assert.deepEqual(proposal.body, { workspaceId: "ws-noon", repositoryRoot: "/Users/test/Noon", objective: "Passer la valeur à 2.", allowedPaths: ["src", "test"], executor: "codex-cli" });
  assert.equal(proposal.headers["X-Noon-Request"], "1");

  missions = [mission()];
  await controller.refresh();
  assert.match(root.textContent, /Codex travaillera dans une copie isolée de Noon\./);
  buttonByText(root, "Lancer la mission").click(); await settle();
  assert.deepEqual(calls.find((call) => call.url.endsWith("/start")).body, { approvalId: "approval_start" });

  missions = [mission({ status: "running", approval: null })];
  timers.length = 0;
  await controller.refresh();
  assert.equal(timers.length, 1, "relecture programmée pendant la mission");
  assert.match(root.textContent, /Ton dossier ne bouge pas/);

  missions = [ready()];
  timers.length = 0;
  await controller.refresh();
  assert.equal(timers.length, 0, "plus de relecture une fois le verdict rendu");
  assert.match(root.textContent, /M src\/value\.js/);
  assert.match(root.textContent, /2 modification\(s\) non commitée\(s\)/);
  buttonByText(root, "Voir le diff").click(); await settle();
  const pre = all(root).find((node) => node.tagName === "PRE");
  assert.equal(pre.textContent, "+<script>alert(1)</script>\n", "diff rendu en texte brut");
  assert.ok(buttonByText(root, "Masquer le diff"));

  buttonByText(root, "Appliquer à mon dossier").click(); await settle();
  assert.deepEqual(calls.find((call) => call.url.endsWith("/apply")).body, { approvalId: "approval_apply" });
});

test("application annulée → aucune requête ; conflit local → message avec les fichiers ; validation expirée → renouveler", async () => {
  const { controller, root, calls } = loadUi({ list: () => ({ executors, repositories, missions: [ready()] }), confirm: () => false });
  await controller.init();
  buttonByText(root, "Appliquer à mon dossier").click(); await settle();
  assert.equal(calls.some((call) => call.url.endsWith("/apply")), false);

  const conflict = loadUi({ list: () => ({ executors, repositories, missions: [ready()] }), replies: { "POST /api/dev-missions/mission-0123456789ab/apply": { error: "MISSION_LOCAL_CONFLICT", files: ["src/value.js"] } } });
  await conflict.controller.init();
  buttonByText(conflict.root, "Appliquer à mon dossier").click(); await settle();
  assert.match(conflict.root.textContent, /modifications locales sur un fichier du diff.*\(src\/value\.js\)/);
  assert.equal(conflict.root.textContent.includes("brut"), false);

  const late = loadUi({ list: () => ({ executors, repositories, missions: [ready({ approval: { id: "approval_apply", kind: "apply", expiresAt: "2026-11-22T09:00:00Z", summary: "x" } }), mission({ id: "mission-111111111111", approval: { id: "a2", kind: "start", expiresAt: "2026-11-22T09:00:00Z", summary: "y" } })] }) });
  await late.controller.init();
  assert.equal(buttonByText(late.root, "Appliquer à mon dossier"), undefined);
  buttonByText(late.root, "Renouveler la validation").click(); await settle();
  assert.ok(late.calls.some((call) => call.url === "/api/dev-missions/mission-0123456789ab/renew-apply"));
  assert.equal(buttonByText(late.root, "Lancer la mission").disabled, true, "lancement impossible avec une validation expirée");
});

test("sans dépôt autorisé : formulaire remplacé par une explication", async () => {
  const { controller, root } = loadUi({ list: () => ({ executors, repositories: [], missions: [] }) });
  await controller.init();
  assert.match(root.textContent, /Aucun dépôt Git parmi les dossiers autorisés en écriture/);
  assert.equal(buttonByText(root, "Préparer la mission"), undefined);
});

test("câblage : Control Center, index, app et serveur", () => {
  const index = fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8");
  assert.ok(index.includes('id="controlCenterDevMissions"'));
  assert.ok(index.indexOf('<script src="dev-missions-ui.js"></script>') < index.indexOf('<script src="app.js"></script>'));
  assert.match(readAppSource(), /window\.NoonControlCenter\?\.setDevMissionsAvailable\?\.\(available === true\)/);
  assert.match(fs.readFileSync(path.join(PUBLIC, "control-center.js"), "utf8"), /\[DEV_MISSIONS_SECTION\]: "Missions DEV"/);
  assert.ok(require("../services/http/static-assets").STATIC_ASSETS["/dev-missions-ui.js"], "servi par le serveur");
});
