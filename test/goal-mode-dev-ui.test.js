"use strict";

// UI Goal Mode DEV sans navigateur : vm + faux DOM. innerHTML lève une erreur,
// localStorage / sessionStorage / document.cookie / console sont piégés.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "public", "goal-mode-dev-ui.js"), "utf8");
const TOKEN = "T".repeat(43);
const TOKEN_2 = "U".repeat(43);
const APPROVAL = "approval_11111111-1111-1111-1111-111111111111";
const APPROVAL_2 = "approval_22222222-2222-2222-2222-222222222222";

class Node {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.parent = null;
    this.attributes = new Map();
    this.listeners = new Map();
    this.ownText = "";
    this.hidden = false;
    this.disabled = false;
    this.value = "";
  }
  get textContent() { return this.ownText + this.children.map((child) => child.textContent).join(""); }
  set textContent(value) { this.children = []; this.ownText = String(value); }
  set innerHTML(_) { throw new Error("innerHTML interdit"); }
  get innerHTML() { throw new Error("innerHTML interdit"); }
  insertAdjacentHTML() { throw new Error("insertAdjacentHTML interdit"); }
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  replaceChildren(...nodes) { this.children = []; this.ownText = ""; this.append(...nodes); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(type, handler) { this.listeners.set(type, [...(this.listeners.get(type) || []), handler]); }
  click() { for (const handler of this.listeners.get("click") || []) handler(); }
  dispatch(type) { for (const handler of this.listeners.get(type) || []) handler(); }
  all() { return [this, ...this.children.flatMap((child) => child.all())]; }
  querySelectorAll(selector) {
    if (selector !== "button[data-action]") throw new Error(`sélecteur non pris en charge: ${selector}`);
    return this.all().filter((node) => node.tagName === "BUTTON" && node.attributes.has("data-action"));
  }
  buttons(label) { return this.all().filter((node) => node.tagName === "BUTTON" && node.textContent === label); }
  serialize() {
    return this.all().map((node) => `${node.tagName}|${node.ownText}|${node.value}|${[...node.attributes].join(",")}|${node.className || ""}`).join("\n");
  }
}

function trap(name, touched) {
  return new Proxy({}, { get() { touched.push(name); throw new Error(`${name} interdit`); }, set() { touched.push(name); throw new Error(`${name} interdit`); } });
}

function load() {
  const touched = [];
  const consoleCalls = [];
  const document = {
    createElement: (tag) => new Node(tag),
    get cookie() { touched.push("cookie"); throw new Error("cookie interdit"); },
    set cookie(_) { touched.push("cookie"); throw new Error("cookie interdit"); },
  };
  const timers = [];
  const window = {
    document,
    localStorage: trap("localStorage", touched),
    sessionStorage: trap("sessionStorage", touched),
    confirm: () => true,
    setInterval: (fn, ms) => { timers.push({ fn, ms, active: true }); return timers.length - 1; },
    clearInterval: (handle) => { if (timers[handle]) timers[handle].active = false; },
  };
  const console = new Proxy({}, { get: (_, key) => (...args) => consoleCalls.push([key, args]) });
  vm.runInNewContext(SOURCE, { window, console, Date, encodeURIComponent, Number, String, Math, JSON, Map, Set, Object, Array, Promise });
  return { ui: window.NoonGoalModeDevUi, window, touched, consoleCalls, timers };
}

function fakeApi(routes) {
  const calls = [];
  const respond = (method, route, body) => {
    calls.push({ method, route, body: body === undefined ? undefined : JSON.parse(JSON.stringify(body)) });
    const handler = routes[`${method} ${route}`];
    const result = typeof handler === "function" ? handler(body, calls) : handler;
    return Promise.resolve(result || { ok: false, status: 404, code: "GOAL_MODE_DEV_ROUTE_NOT_FOUND" });
  };
  return { calls, get: (route) => respond("GET", route), post: (route, body) => respond("POST", route, body) };
}

const ok = (body) => ({ ok: true, status: 200, body });
const err = (code, status = 422) => ({ ok: false, status, code });
const flush = () => new Promise((resolve) => setImmediate(resolve));

const GOAL = {
  goalId: "goal-1", title: "SYNTHETIC_GOAL_TITLE", status: "ACTIVE", userConfirmed: true,
  linkedWorkspaceIds: ["workspace-1"], linkedProjectIds: ["project-1"],
};
const RUN = {
  runId: "run-1", goalId: "goal-1", revision: 4, status: "RUNNING", updatedAt: "2026-10-13T12:00:00.000Z",
  usage: { steps: 0, retries: 0, providerCalls: 1, estimatedCost: 0.1 },
  limits: { maxSteps: 4, maxRetries: 1, maxProviderCalls: 4, maxDuration: 600_000, maxEstimatedCost: 3 },
  reservations: [],
};
const PREPARED = (approvalId = APPROVAL, token = TOKEN) => ({
  reservationId: "res-1", reservedRevision: 5,
  approval: { approvalId, expiresAt: "2026-10-13T12:05:00.000Z", title: "Lancer une tâche DEV Goal Mode", summary: "s" },
  resumeToken: token,
  display: {
    goalTitle: "SYNTHETIC_GOAL_TITLE", instruction: "<img src=x onerror=alert(1)> Corriger le bug",
    repositoryRoot: "/Users/x/repo", branch: "main", permissions: ["READ_WRITE_WORKSPACE", "NETWORK"],
    maxEstimatedCost: 0.4, maxProviderCalls: 2, maxDuration: 300_000, projectRules: ["<b>Règle</b> A", "Règle B"],
  },
});

function baseRoutes(overrides = {}) {
  return {
    "GET runs": ok({ runs: [RUN] }),
    "GET /api/goals": ok({ goals: [GOAL, { ...GOAL, goalId: "goal-paused", status: "PAUSED" }] }),
    "GET runs/run-1": ok(RUN),
    "GET runs/run-1/planning-estimate": ok({ decision: "PLAN", maxEstimatedCost: 0.12, currency: "USD" }),
    "POST planning": ok({ status: "PROPOSED", stepId: "step-1", recovered: false }),
    "GET runs/run-1/proposals/step-1": ok({ objective: "Objectif", expectedOutcome: "Résultat", admission: { decision: "ADMIT" } }),
    "POST dispatch/prepare": ok(PREPARED()),
    ...overrides,
  };
}

async function ready(routes, options = {}) {
  const env = load();
  const root = new Node("section");
  const api = fakeApi(routes);
  const confirmations = [];
  let clock = Date.parse("2026-10-13T12:00:00.000Z");
  const controller = env.ui.createGoalModeDevController({
    elements: { root }, api,
    confirmAction: (message) => { confirmations.push(message); return options.confirm ?? true; },
    setTimer: env.window.setInterval, clearTimer: env.window.clearInterval,
    now: () => clock,
  });
  const enabled = await controller.init();
  return { ...env, root, api, controller, confirmations, enabled, advance: (ms) => { clock += ms; } };
}

test("UI : panneau masqué si le flag est OFF", async () => {
  const h = await ready({ "GET runs": err("GOAL_MODE_DEV_DISABLED", 404) });
  assert.equal(h.enabled, false);
  assert.equal(h.root.hidden, true);
  assert.deepEqual(h.api.calls.map((call) => call.route), ["runs"]);
});

test("UI : panneau, formulaire (Goals actifs liés) et liste des runs", async () => {
  const h = await ready(baseRoutes());
  assert.equal(h.enabled, true);
  assert.equal(h.root.hidden, false);
  const text = h.root.textContent;
  assert.ok(text.includes("Goal Mode DEV"));
  assert.ok(text.includes("SYNTHETIC_GOAL_TITLE · RUNNING"));
  const options = h.root.all().filter((node) => node.tagName === "OPTION").map((node) => node.value);
  assert.ok(options.includes("goal-1"));
  assert.equal(options.includes("goal-paused"), false);
  h.api.calls.length = 0;
  h.root.buttons("Créer et démarrer")[0].click();
  await flush();
  // POST runs puis runs/start : limites converties (minutes → ms), userConfirmed explicite.
  await flush();
  const create = h.api.calls.find((call) => call.route === "runs" && call.method === "POST");
  assert.deepEqual(create.body, {
    goalId: "goal-1", workspaceId: "workspace-1", projectId: "project-1", userConfirmed: true,
    limits: { maxSteps: 4, maxRetries: 1, maxProviderCalls: 4, maxDuration: 1_800_000, maxEstimatedCost: 1 },
  });
});

test("UI : Planifier affiche le coût maximal estimé et exige la confirmation", async () => {
  const refused = await ready(baseRoutes(), { confirm: false });
  refused.api.calls.length = 0;
  await refused.controller.plan("run-1");
  assert.ok(refused.confirmations[0].includes("0.12 USD"));
  assert.ok(refused.confirmations[0].includes("payant"));
  assert.equal(refused.api.calls.some((call) => call.route === "planning"), false);
  const h = await ready(baseRoutes());
  await h.controller.plan("run-1");
  const planning = h.api.calls.find((call) => call.route === "planning");
  assert.deepEqual(planning.body, { runId: "run-1", confirmProviderCall: true });
  assert.ok(h.root.textContent.includes("Objectif"));
  assert.equal(h.root.buttons("Préparer").length, 1);
});

test("UI : carte d'approbation en textContent, jeton jamais dans le DOM ni le stockage", async () => {
  const h = await ready(baseRoutes());
  const approvalId = await h.controller.prepare("run-1", "step-1");
  assert.equal(approvalId, APPROVAL);
  const text = h.root.textContent;
  for (const value of ["SYNTHETIC_GOAL_TITLE", "<img src=x onerror=alert(1)> Corriger le bug", "Repository : /Users/x/repo (main)",
    "Permissions : READ_WRITE_WORKSPACE, NETWORK", "Coût maximal : 0.4 USD", "Appels maximum : 2",
    "Durée maximale : 300 s", "Règles projet (2)", "<b>Règle</b> A", "Règle B"]) {
    assert.ok(text.includes(value), value);
  }
  const prepareCall = h.api.calls.find((call) => call.route === "dispatch/prepare");
  assert.deepEqual(prepareCall.body, { runId: "run-1", expectedRevision: 4, stepId: "step-1" });
  assert.equal(h.controller.hasToken(APPROVAL), true);
  assert.equal(h.root.serialize().includes(TOKEN), false);
  assert.deepEqual(h.touched, []);
  assert.deepEqual(h.consoleCalls, []);
  for (const label of ["Approuver", "Refuser", "Renouveler"]) assert.equal(h.root.buttons(label).length, 1, label);
});

test("UI : Approuver envoie une decision explicite, efface le jeton et affiche « coût estimé (borne haute) »", async () => {
  const h = await ready(baseRoutes({
    "POST dispatch/resume": ok({
      status: "DISPATCHED", reservationId: "res-1",
      reconciliation: { outcome: "RECONCILED", basis: "ESTIMATED_UPPER_BOUND", accounting: { providerCalls: 2, accountedCost: 0.12, actualCostKnown: false } },
    }),
  }));
  await h.controller.prepare("run-1", "step-1");
  const approve = h.root.buttons("Approuver")[0];
  approve.click();
  approve.click(); // double clic : une seule requête
  await flush(); await flush(); await flush();
  const resumes = h.api.calls.filter((call) => call.route === "dispatch/resume");
  assert.equal(resumes.length, 1);
  assert.deepEqual(resumes[0].body, { approvalId: APPROVAL, resumeToken: TOKEN, decision: "approve" });
  assert.equal(h.controller.hasToken(APPROVAL), false);
  const text = h.root.textContent;
  assert.ok(text.includes("Réconciliation : RECONCILED"));
  assert.ok(text.includes("coût estimé (borne haute)"));
  assert.ok(text.includes("2 appels · 0.12 USD"));
  assert.equal(h.root.serialize().includes(TOKEN), false);
  assert.deepEqual(h.touched, []);
});

test("UI : jamais lancée, UNKNOWN bloquant, UNCHANGED avec bouton Réconcilier", async () => {
  for (const [reconciliation, expected] of [
    [{ outcome: "RECONCILED", basis: "NEVER_LAUNCHED", accounting: { providerCalls: 0, accountedCost: 0, actualCostKnown: true } }, "jamais lancée — rien consommé"],
    [{ outcome: "UNKNOWN", reason: "OUTCOME_UNCERTAIN" }, "le DEV de ce run est bloqué"],
    [{ outcome: "UNCHANGED", reason: "LEDGER_IN_PROGRESS" }, "Non réconcilié (LEDGER_IN_PROGRESS)"],
  ]) {
    const h = await ready(baseRoutes({
      "POST dispatch/resume": ok({ status: "DISPATCHED", reservationId: "res-1", reconciliation }),
      "POST dispatch/reconcile": ok({ outcome: "RECONCILED", basis: "ACTUAL", accounting: { providerCalls: 1, accountedCost: 0.05, actualCostKnown: true } }),
    }));
    await h.controller.prepare("run-1", "step-1");
    await h.controller.decide(APPROVAL, "approve");
    assert.ok(h.root.textContent.includes(expected), expected);
    if (reconciliation.outcome === "UNCHANGED") {
      const reconcileButton = h.root.all().find((node) => node.tagName === "BUTTON" && node.textContent === "Réconcilier");
      reconcileButton.click();
      await flush(); await flush(); await flush();
      const call = h.api.calls.find((item) => item.route === "dispatch/reconcile");
      assert.deepEqual(call.body, { runId: "run-1", expectedRevision: 4, reservationId: "res-1" });
      assert.ok(h.root.textContent.includes("coût réel"));
    }
  }
});

test("UI : Refuser, Renouveler (ancien jeton effacé), erreurs traduites", async () => {
  const h = await ready(baseRoutes({
    "POST dispatch/resume": (body) => (body.decision === "reject"
      ? ok({ status: "rejected", reservationId: "res-1" }) : err("approval_expired", 410)),
    "POST dispatch/renew": ok(PREPARED(APPROVAL_2, TOKEN_2)),
  }));
  await h.controller.prepare("run-1", "step-1");
  await h.controller.decide(APPROVAL, "reject");
  assert.deepEqual(h.api.calls.find((call) => call.route === "dispatch/resume").body.decision, "reject");
  assert.ok(h.root.textContent.includes("La réservation reste préparée"));
  await h.controller.prepare("run-1", "step-1");
  await h.controller.renew("res-1", "run-1");
  assert.equal(h.controller.hasToken(APPROVAL), false);
  assert.equal(h.controller.hasToken(APPROVAL_2), true);
  await h.controller.decide(APPROVAL_2, "approve");
  assert.ok(h.root.textContent.includes("Approbation expirée : renouvelez-la."));
  assert.equal(h.controller.hasToken(APPROVAL_2), false);
  assert.equal(await h.controller.decide("approval_unknown", "approve"), null);
  assert.ok(h.root.textContent.includes("Approbation inconnue de cette session"));
  const local = await ready(baseRoutes({ "GET runs/run-1/planning-estimate": err("GOAL_MODE_DEV_LOCAL_ONLY_REQUIRED") }));
  await local.controller.plan("run-1");
  assert.ok(local.root.textContent.includes("traitement local"));
  assert.equal(local.confirmations.length, 0);
  assert.equal(h.root.serialize().includes(TOKEN_2), false);
});

test("UI : suivi toutes les 3 s pendant resume, arrêt à la fin ou à maxDuration + 2 min", async () => {
  let resolveResume;
  const h = await ready(baseRoutes({
    "POST dispatch/resume": () => new Promise((resolve) => { resolveResume = resolve; }),
    "GET runs/run-1/reservations/res-1": ok({ reservationStatus: "MAY_HAVE_STARTED" }),
  }));
  await h.controller.prepare("run-1", "step-1");
  const pending = h.controller.decide(APPROVAL, "approve");
  await flush();
  const timer = h.timers.at(-1);
  assert.equal(timer.ms, 3_000);
  assert.equal(timer.active, true);
  await timer.fn();
  assert.ok(h.root.textContent.includes("Tâche DEV : MAY_HAVE_STARTED"));
  // Au-delà de maxDuration (600 s) + 2 min : suivi arrêté, bouton Réconcilier.
  h.advance(600_000 + 120_001);
  await timer.fn();
  assert.equal(timer.active, false);
  assert.ok(h.root.textContent.includes("Suivi arrêté."));
  assert.ok(h.root.buttons("Réconcilier").length >= 1);
  resolveResume(ok({ status: "DISPATCHED", reservationId: "res-1", reconciliation: { outcome: "RECONCILED", basis: "ACTUAL", accounting: { providerCalls: 1, accountedCost: 0.05, actualCostKnown: true } } }));
  await pending;
  // Fin normale : le statut clos arrête aussi le suivi.
  const h2 = await ready(baseRoutes({
    "POST dispatch/resume": () => new Promise(() => {}),
    "GET runs/run-1/reservations/res-1": ok({ reservationStatus: "RECONCILED" }),
  }));
  await h2.controller.prepare("run-1", "step-1");
  void h2.controller.decide(APPROVAL, "approve");
  await flush();
  const timer2 = h2.timers.at(-1);
  await timer2.fn();
  assert.equal(timer2.active, false);
  // Déconnexion : le suivi continue.
  const h3 = await ready(baseRoutes({
    "POST dispatch/resume": { ok: false, status: 0, code: "NETWORK_UNAVAILABLE" },
    "GET runs/run-1/reservations/res-1": ok({ reservationStatus: "MAY_HAVE_STARTED" }),
  }));
  await h3.controller.prepare("run-1", "step-1");
  await h3.controller.decide(APPROVAL, "approve");
  assert.equal(h3.timers.at(-1).active, true);
});

test("UI : contrôles du run (pause, reprise, arrêt, arrêt de tâche, libération) avec confirmations", async () => {
  const h = await ready(baseRoutes({
    "POST runs/pause": ok({ status: "PAUSED", revision: 5, release: { released: false, code: "GOAL_MODE_EXECUTION_RELEASE_LEDGER_ENGAGED" } }),
    "POST runs/resume": ok({ status: "RUNNING", revision: 6, releaseRequired: ["res-1"], reconciliationRequired: [] }),
    "POST runs/stop": ok({ status: "CANCELLED", revision: 7 }),
    "POST dispatch/cancel": ok({ cancelRequested: true }),
    "POST dispatch/release": ok({ reservationId: "res-1", status: "RELEASED" }),
  }));
  await h.controller.pauseRun("run-1", { releasePrepared: true });
  assert.deepEqual(h.api.calls.find((call) => call.route === "runs/pause").body, { runId: "run-1", expectedRevision: 4, releasePrepared: true });
  assert.ok(h.root.textContent.includes("Libération refusée (GOAL_MODE_EXECUTION_RELEASE_LEDGER_ENGAGED)"));
  await h.controller.resumeRun("run-1");
  assert.ok(h.root.textContent.includes("doit être libérée"));
  await h.controller.stopRun("run-1");
  await h.controller.cancelExecution("run-1", "res-1");
  await h.controller.release("run-1", "res-1");
  assert.equal(h.confirmations.length, 3);
  const refused = await ready(baseRoutes(), { confirm: false });
  refused.api.calls.length = 0;
  await refused.controller.stopRun("run-1");
  await refused.controller.cancelExecution("run-1", "res-1");
  await refused.controller.release("run-1", "res-1");
  assert.equal(refused.api.calls.some((call) => call.method === "POST"), false);
});

test("UI : client API (en-tête de confiance, JSON, enveloppe, erreur réseau)", async () => {
  const { ui } = load();
  const requests = [];
  const api = ui.createGoalModeDevApi({
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (url.endsWith("broken")) throw new Error("offline");
      if (url.endsWith("missing")) return { ok: false, status: 404, json: async () => ({ status: "error", code: "GOAL_MODE_DEV_DISABLED" }) };
      return { ok: true, status: 200, json: async () => ({ status: "ok", result: { value: 1 } }) };
    },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(await api.post("runs", { a: 1 }))), { ok: true, status: 200, body: { value: 1 } });
  assert.equal(requests[0].url, "/api/goals/mode-dev/runs");
  assert.equal(requests[0].options.headers["X-Noon-Request"], "1");
  assert.equal(requests[0].options.body, JSON.stringify({ a: 1 }));
  assert.equal((await api.get("/api/goals")).ok, true);
  assert.equal(requests[1].url, "/api/goals");
  assert.equal((await api.get("missing")).code, "GOAL_MODE_DEV_DISABLED");
  assert.equal((await api.get("broken")).code, "NETWORK_UNAVAILABLE");
});

test("UI contrat source : panneau dans index.html, script avant app.js, assemblage et filtre générique", () => {
  const root = path.join(__dirname, "..", "public");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.match(html, /<section id="goalModeDevPanel" class="goal-mode-dev" hidden aria-label="Goal Mode DEV"><\/section>/);
  const panel = html.indexOf('id="approvalsPanel"');
  assert.ok(panel > 0 && html.indexOf('id="goalModeDevPanel"') > panel);
  const ui = html.indexOf('<script src="goal-mode-dev-ui.js"></script>');
  const app = html.indexOf('<script src="app.js"></script>');
  assert.ok(ui > 0 && app > ui, "goal-mode-dev-ui.js chargé avant app.js");
  const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
  assert.match(appSource, /document\.getElementById\("goalModeDevPanel"\)/);
  assert.match(appSource, /createGoalModeDevApi\(\{ fetchImpl: window\.fetch\.bind\(window\) \}\)/);
  assert.match(appSource, /data\.approvals\.filter\(\(item\) => item\.skillName !== "goal_mode_dev"\)/);
  // Le module (hors commentaires) : ni innerHTML, ni stockage navigateur, ni cookie, ni console, ni eval.
  const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(code.includes("textContent"));
  for (const forbidden of [/innerHTML/, /insertAdjacentHTML/, /localStorage/, /sessionStorage/, /document\.cookie/,
    /\bconsole\./, /\beval\(/, /new Function/]) {
    assert.equal(forbidden.test(code), false, String(forbidden));
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  assert.match(pkg.scripts.lint, /node --check public\/goal-mode-dev-ui\.js/);
});

test("UI : après rechargement (aucun jeton), Renouveler depuis la liste rétablit la carte", async () => {
  const withPrepared = { ...RUN, reservations: [{ reservationId: "res-1", status: "PREPARED" }] };
  const h = await ready(baseRoutes({
    "GET runs": ok({ runs: [withPrepared] }),
    "POST dispatch/renew": ok(PREPARED(APPROVAL_2, TOKEN_2)),
  }));
  assert.equal(h.controller.tokenCount(), 0);
  assert.equal(h.root.buttons("Libérer").length, 1);
  h.root.buttons("Renouveler")[0].click();
  await flush(); await flush(); await flush();
  assert.deepEqual(h.api.calls.find((call) => call.route === "dispatch/renew").body, { reservationId: "res-1" });
  assert.equal(h.controller.hasToken(APPROVAL_2), true);
  assert.equal(h.root.buttons("Approuver").length, 1);
  assert.equal(h.root.serialize().includes(TOKEN_2), false);
  // Run en pause : pas de Renouveler (le serveur le refuserait de toute façon).
  const paused = await ready(baseRoutes({ "GET runs": ok({ runs: [{ ...withPrepared, status: "PAUSED" }] }) }));
  assert.equal(paused.root.buttons("Renouveler").length, 0);
  assert.equal(paused.root.buttons("Libérer").length, 1);
});

const LOCK = (overrides = {}) => ({
  state: "STALE", holderPid: 4242, holderHostname: "SYNTHETIC-MAC", holderCreatedAt: "2026-10-13T12:00:00.000Z",
  sameHost: true, machineRestarted: false, takeoverPending: false, canTakeOver: true, ...overrides,
});

test("UI verrou : périmé → confirmation (PID, machine, raison), reprise, puis « Réconcilier maintenant » sans scan automatique", async () => {
  let lockState = LOCK();
  const h = await ready(baseRoutes({
    "GET maintenance/lock": () => ok(lockState),
    "POST maintenance/lock-takeover": () => {
      lockState = LOCK({ state: "HELD_BY_THIS", holderPid: null, holderHostname: null, holderCreatedAt: null, canTakeOver: false });
      return ok({ acquired: true, reason: "TAKEN_OVER", previousPid: 4242, reconcileRecommended: true });
    },
    "POST maintenance/reconcile-scan": ok({ scanned: 2, reconciled: 1, unknown: 1, unchanged: 0, failed: 0 }),
  }));
  assert.ok(h.root.textContent.includes("Verrou périmé : son processus a disparu."));
  assert.ok(h.root.textContent.includes("Détenteur : PID 4242 · SYNTHETIC-MAC"));
  h.api.calls.length = 0;
  h.root.buttons("Reprendre le verrou")[0].click();
  await flush(); await flush(); await flush(); await flush();
  assert.ok(h.confirmations[0].includes("PID 4242 sur SYNTHETIC-MAC"));
  assert.ok(h.confirmations[0].includes("Verrou périmé"));
  assert.deepEqual(h.api.calls.find((call) => call.route === "maintenance/lock-takeover").body, { confirm: true, expectedHolderPid: 4242 });
  // Décision 7 : aucun scan lancé par la reprise explicite, bouton proposé.
  assert.equal(h.api.calls.some((call) => call.route === "maintenance/reconcile-scan"), false);
  assert.ok(h.root.textContent.includes("Verrou des données détenu par cette instance."));
  assert.equal(h.root.buttons("Réconcilier maintenant").length, 1);
  h.root.buttons("Réconcilier maintenant")[0].click();
  await flush(); await flush(); await flush(); await flush();
  assert.deepEqual(h.api.calls.find((call) => call.route === "maintenance/reconcile-scan").body, { confirm: true });
  assert.ok(h.root.textContent.includes("Scan : 2 examinée(s), 1 réconciliée(s), 1 inconnue(s), 0 inchangée(s), 0 en échec."));
  assert.equal(h.root.buttons("Réconcilier maintenant").length, 0);
  assert.deepEqual(h.touched, []);
});

test("UI verrou : annulation, détenteur vivant (aucun bouton), refus serveur traduit, illisible sans PID", async () => {
  const cancelled = await ready(baseRoutes({ "GET maintenance/lock": ok(LOCK()) }), { confirm: false });
  cancelled.api.calls.length = 0;
  await cancelled.controller.takeoverLock();
  assert.equal(cancelled.api.calls.some((call) => call.method === "POST"), false);
  assert.ok(cancelled.root.textContent.includes("Reprise du verrou annulée."));
  const held = await ready(baseRoutes({ "GET maintenance/lock": ok(LOCK({ state: "HELD", machineRestarted: true, canTakeOver: false })) }));
  assert.equal(held.root.buttons("Reprendre le verrou").length, 0);
  assert.ok(held.root.textContent.includes("quittez-la pour le libérer"));
  assert.ok(held.root.textContent.includes("probablement réutilisé"));
  held.api.calls.length = 0;
  assert.equal(await held.controller.takeoverLock(), null);
  assert.equal(held.api.calls.some((call) => call.method === "POST"), false);
  const refused = await ready(baseRoutes({
    "GET maintenance/lock": ok(LOCK()),
    "POST maintenance/lock-takeover": err("GOAL_MODE_DEV_LOCK_HOLDER_ALIVE", 409),
  }));
  await refused.controller.takeoverLock();
  assert.ok(refused.root.textContent.includes("Une autre instance de Noon utilise ces données sur ce Mac"));
  assert.equal(refused.root.buttons("Réconcilier maintenant").length, 0);
  const unreadable = await ready(baseRoutes({
    "GET maintenance/lock": ok(LOCK({ state: "UNREADABLE", holderPid: null, holderHostname: null, holderCreatedAt: null, sameHost: null })),
    "POST maintenance/lock-takeover": ok({ acquired: true, reason: "TAKEN_OVER", previousPid: null, reconcileRecommended: true }),
  }));
  await unreadable.controller.takeoverLock();
  assert.ok(unreadable.confirmations[0].includes("Détenteur : inconnu"));
  assert.deepEqual(unreadable.api.calls.find((call) => call.route === "maintenance/lock-takeover").body, { confirm: true, expectedHolderPid: null });
  const unavailable = await ready(baseRoutes());
  assert.ok(unavailable.root.textContent.includes("État du verrou indisponible."));
});
