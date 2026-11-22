"use strict";

// V3-L6 — bilan « Santé de Noon » : agrégats des traces, coût par jour ventilé à l'écriture,
// budgets G.2, absence de données dite telle quelle ; panneau en texte brut.
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createNoonHealthReport, withDailyCost } = require("../services/observability/noon-health-report");
const { createNoonObservability } = require("../services/observability/noon-observability");

const NOW = Date.parse("2026-11-22T15:00:00Z"); // 16:00 à Paris
const trace = (startedAt, overrides = {}) => ({ executionId: `e-${startedAt}-${Math.random()}`, startedAt, completedAt: startedAt, channel: "chat", status: "completed", errors: [], technicalExecutionMs: 1500, costs: { total: 0.01 }, voice: {}, ...overrides });

test("withDailyCost : la hausse du coût va au jour courant ; nouveau mois → ventilation remise à zéro", () => {
  const costOf = (usage) => usage.total;
  const first = withDailyCost({ month: "2026-11", total: 2 }, { month: "2026-11", total: 2.5 }, { costOf, today: "2026-11-22" });
  assert.deepEqual(first.dailyCostUSD, { "2026-11-22": 0.5 });
  assert.equal(first.dailyCostSince, "2026-11-22");
  const second = withDailyCost(first, { ...first, total: 2.75 }, { costOf, today: "2026-11-23" });
  assert.deepEqual(second.dailyCostUSD, { "2026-11-22": 0.5, "2026-11-23": 0.25 });
  assert.equal(second.dailyCostSince, "2026-11-22");
  const nextMonth = withDailyCost(second, { month: "2026-12", total: 0.1 }, { costOf, today: "2026-12-01" });
  assert.deepEqual(nextMonth.dailyCostUSD, { "2026-12-01": 0.1 });
  assert.equal(nextMonth.dailyCostSince, "2026-12-01");
  const unchanged = withDailyCost(second, { ...second }, { costOf, today: "2026-11-23" });
  assert.deepEqual(unchanged.dailyCostUSD, second.dailyCostUSD, "aucune hausse : rien d'ajouté");
});

test("bilan : latences, réussite, coût du jour, budgets ; jours non mesurés à null", () => {
  const traces = [
    trace("2026-11-22T08:00:00Z", { technicalExecutionMs: 1200 }),
    trace("2026-11-22T09:00:00Z", { technicalExecutionMs: 3000 }),
    trace("2026-11-22T10:00:00Z", { status: "failed", errors: [{ code: "X" }], technicalExecutionMs: 9000 }),
    trace("2026-11-21T09:00:00Z", { channel: "live_voice", voice: { firstAudioMs: 800 }, technicalExecutionMs: 60000 }),
    trace("2026-11-20T09:00:00Z", { channel: "background" }),
    trace("2026-11-01T09:00:00Z"),
  ];
  const health = createNoonHealthReport({
    listTraces: () => traces,
    usageStatus: () => ({ month: "2026-11", costUSD: 4.2, monthlyBudgetUSD: 30, remainingUSD: 25.8, mode: "NORMAL", requests: 12, dailyCostUSD: { "2026-11-22": 1.4 }, dailyCostSince: "2026-11-21" }),
    briefUsage: () => ({ days: 14, generated: 5, onTime: 4, opened: 3, openedStreak: 2 }),
    now: () => NOW,
  }).report({ days: 7 });
  assert.equal(health.byDay.length, 7);
  assert.equal(health.byDay.at(-1).date, "2026-11-22");
  assert.equal(health.totals.exchanges, 5, "trace hors période ignorée");
  assert.equal(health.totals.failures, 1);
  assert.equal(health.totals.textP50Ms, 1200, "échec exclu des latences");
  assert.equal(health.totals.voiceFirstAudioP50Ms, 800);
  assert.deepEqual(health.budgets.textResponse, { value: 1200, limit: 2000, status: "OK" });
  assert.deepEqual(health.budgets.voiceFirstAudio, { value: 800, limit: 1000, status: "OK" });
  assert.deepEqual(health.budgets.dailyCost, { value: 1.4, limit: 1, status: "OVER" });
  assert.equal(health.byDay.at(-1).successRate, 0.667);
  assert.equal(health.byDay.at(-2).costUSD, 0, "jour mesuré sans dépense = 0");
  assert.equal(health.byDay.at(-3).costUSD, null, "jour avant la mesure = non mesuré");
  assert.equal(health.byDay.at(-3).background, 1);
  assert.equal(health.month.costUSD, 4.2);
  assert.equal(health.brief.onTime, 4);
  assert.deepEqual(health.notMeasured, ["correctionRate"]);
});

test("bilan sans données : aucune valeur inventée", () => {
  const health = createNoonHealthReport({ listTraces: () => [], usageStatus: () => ({ month: "2026-11" }), now: () => NOW }).report({ days: 400 });
  assert.equal(health.days, 30);
  assert.equal(health.totals.successRate, null);
  assert.equal(health.budgets.textResponse.status, "NO_DATA");
  assert.equal(health.budgets.dailyCost.status, "NO_DATA");
  assert.ok(health.byDay.every((day) => day.costUSD === null && day.successRate === null));
  assert.equal(health.brief, null);
});

test("observabilité : listTraces ne rend que les traces terminées, sans champs internes", () => {
  let clock = NOW;
  const observability = createNoonObservability({ now: () => clock });
  observability.startExecution({ executionId: "done", channel: "chat" });
  clock += 900;
  observability.completeExecution("done", {});
  observability.startExecution({ executionId: "open", channel: "chat" });
  const listed = observability.listTraces({ sinceMs: 60_000 });
  assert.deepEqual(listed.map((item) => item.executionId), ["done"]);
  assert.equal(listed[0].technicalExecutionMs, 900);
  assert.ok(!Object.keys(listed[0]).some((key) => key.startsWith("_")));
});

// ---------- Panneau ----------

class FakeElement {
  constructor(tag) { this.tagName = String(tag).toUpperCase(); this.children = []; this.hidden = false; this.className = ""; this.dataset = {}; this.listeners = {}; this.attributes = {}; this.ownText = ""; this.value = ""; }
  get childNodes() { return this.children; }
  get textContent() { return this.ownText + this.children.map((child) => child.textContent).join(""); }
  set textContent(value) { this.children = []; this.ownText = String(value); }
  set innerHTML(_) { throw new Error("innerHTML interdit"); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = [...nodes]; this.ownText = ""; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
  dispatch(type) { for (const handler of this.listeners[type] || []) handler({ target: this }); }
}
const all = (node) => node.children.flatMap((child) => [child, ...all(child)]);

function loadPanel(reply) {
  const document = { createElement: (tag) => new FakeElement(tag), createTextNode: (text) => { const node = new FakeElement("#text"); node.ownText = String(text); return node; } };
  const context = { document, Promise, Object, String, Array, Number, JSON, Error, TypeError, Date, Math, encodeURIComponent };
  context.window = context;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "public", "noon-health-ui.js"), "utf8"), context);
  const urls = [];
  const fetchImpl = async (url) => { urls.push(url); return reply === 500 ? { ok: false, status: 500, json: async () => ({}) } : { ok: true, status: 200, json: async () => ({ status: "ok", health: reply }) }; };
  const root = new FakeElement("section"); root.ownerDocument = document; root.hidden = true;
  const ui = context.window.NoonHealthUi;
  return { controller: ui.createNoonHealthController({ elements: { root }, api: ui.createNoonHealthApi({ fetchImpl }) }), root, urls };
}

test("panneau : résumé, budgets, jours ; période modifiable ; erreur → masqué", async () => {
  const report = createNoonHealthReport({
    listTraces: () => [trace("2026-11-22T08:00:00Z", { technicalExecutionMs: 2500 })],
    usageStatus: () => ({ month: "2026-11", costUSD: 1.5, monthlyBudgetUSD: 30, mode: "NORMAL", dailyCostUSD: { "2026-11-22": 0.2 }, dailyCostSince: "2026-11-22" }),
    briefUsage: () => ({ days: 14, generated: 5, onTime: 4, opened: 3, openedStreak: 2 }),
    now: () => NOW,
  }).report({ days: 7 });
  const { controller, root, urls } = loadPanel(report);
  assert.equal(await controller.init(), true);
  assert.equal(root.hidden, false);
  const text = root.textContent;
  assert.match(text, /1 échange\(s\) tracé\(s\), réussite 100 %/);
  assert.match(text, /Hors budget/, "2,5 s > 2 s");
  assert.match(text, /Pas de données/, "aucune session Live");
  assert.match(text, /Taux de correction par toi : pas encore mesuré/);
  assert.match(text, /dont 4 à l'heure/);
  assert.equal(all(root).filter((node) => node.tagName === "TR").length, 8, "en-tête + 7 jours");
  const select = all(root).find((node) => node.tagName === "SELECT");
  select.value = "30"; select.dispatch("change");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(urls.at(-1), "/api/noon-health?days=30");

  const broken = loadPanel(500);
  assert.equal(await broken.controller.init(), false);
  assert.equal(broken.root.hidden, true);
});

test("câblage : Control Center, index, app et serveur", () => {
  const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
  const index = read("public/index.html");
  assert.ok(index.includes('id="controlCenterHealth"'));
  assert.ok(index.indexOf('<script src="noon-health-ui.js"></script>') < index.indexOf('<script src="app.js"></script>'));
  assert.match(read("public/app.js"), /window\.NoonControlCenter\?\.setHealthAvailable\?\.\(available === true\)/);
  assert.match(read("public/control-center.js"), /\[HEALTH_SECTION\]: "Santé de Noon"/);
  const server = read("server.js");
  assert.match(server, /req\.url === "\/noon-health-ui\.js"/);
  assert.match(server, /requestPath === "\/api\/noon-health"/);
  assert.match(server, /withDailyCost\(previous, usage/);
});
