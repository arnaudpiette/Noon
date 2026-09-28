"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { renderBriefMarkdown, renderDailyBriefStructured } = require("../public/ui-utils");
function element(tagName, ownerDocument) {
  return {
    tagName,
    ownerDocument,
    children: [],
    attributes: {},
    dataset: {},
    append(...nodes) { this.children.push(...nodes); },
    replaceChildren(...nodes) { this.children = nodes; },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name] ?? null; },
    set textContent(text) { this.children = [String(text)]; },
    get textContent() { return this.children.map(n => typeof n === "string" ? n : n.textContent).join(""); },
  };
}
const doc = { createElement: tag => element(tag, doc), createTextNode: text => String(text) };
test("brief Markdown renders headings, emphasis, both lists and harmless HTML", () => {
  const root = element("article", doc);
  renderBriefMarkdown(root, '# A\n## B\n### C\n\n**gras** *italique*\n\n- un\n- deux\n\n1. trois\n2. quatre\n\n<script>alert(1)</script>\n<img src=x onerror=alert(2)>\n[lien](javascript:alert(3))');
  assert.deepEqual(root.children.map(n => n.tagName), ['h1','h2','h3','p','ul','ol','p']);
  assert.equal(root.children[3].children[1].tagName, 'strong');
  assert.equal(root.children[3].children[3].tagName, 'em');
  assert.equal(root.children[4].children.length, 2);
  assert.equal(root.children[5].children.length, 2);
  assert.match(root.textContent, /<script>alert\(1\)<\/script>/);
  assert.equal(root.children[6].children.every(n => typeof n === 'string'), true);
});

test("structured renderer creates assistant sections without parsing provider HTML", () => {
  const root = element("div", doc);

  renderDailyBriefStructured(root, {
    date: "2026-09-28",
    priorities: [{
      id: "p1",
      title: "<script>Priorité</script>",
      reasons: ["échéance proche"],
    }],
    calendar: [],
    proposals: [{
      title: "Avancer Noon",
      confirmedSlot: false,
      reason: "projet prioritaire",
    }],
    reminders: [],
    projects: [],
    emails: [],
    tomorrow: [],
    creative: [],
    sourceStatus: { "google-calendar": "unavailable" },
    scheduledBlocks: [],
  });

  assert.match(root.textContent, /Bonjour Arnaud/);
  assert.match(root.textContent, /<script>Priorité<\/script>/);
  assert.match(root.textContent, /Noon te propose/);
  assert.equal(
    root.children.some((child) => String(child.tagName).toLowerCase() === "script"),
    false
  );
});

function loaderFixture(data) {
  const source = fs.readFileSync(require.resolve('../public/app.js'), 'utf8');
  const start = source.indexOf('async function loadCreativeBrief()');
  const end = source.indexOf('\nasync function ', start + 1);
  const timers = [];
  const requests = [];
  const sandbox = { briefLoadVersion: 0, briefRefreshTimer: null, currentView: "brief",
    window: { NoonUiUtils: { renderBriefMarkdown, renderDailyBriefStructured }, clearTimeout() {}, setTimeout(fn) { timers.push(fn); } },
    document: doc, navigator: { onLine: true },
    fetch: async (url) => { requests.push(url); return { ok:true, json:async()=>data }; }, Date };
  for (const name of ['briefHistorySelect','briefState','personalBriefState','briefContent','personalBriefContent','briefStructuredContent','briefGeneratedAt','briefSourceStates','briefScheduledBlocks','briefDrafts','briefSources','generateBriefButton','readBriefButton','stopBriefReadingButton']) {
    sandbox[name] = element('div',doc); sandbox[name].dataset = {}; sandbox[name].value = '';
  }
  vm.createContext(sandbox); vm.runInContext(source.slice(start,end),sandbox);
  return { sandbox, timers, requests };
}
test("actual loader requests current date, renders Markdown and Paris timestamp", async () => {
  const data = {
    date: '2026-09-06',
    status: 'ready',
    current: {
      date: '2026-09-06',
      content: '## Vue\n**Source non connectée**',
      generatedAt: '2026-09-06T18:08:17.302Z',
      priorities: [{ id: 'p1', title: 'Avancer Noon', reasons: ['projet prioritaire'] }],
      calendar: [{ title: 'Rendez-vous', start: '2026-09-06T08:00:00Z', end: '2026-09-06T09:00:00Z' }],
      proposals: [{ title: 'Avancer Noon', confirmedSlot: true, start: '2026-09-06T10:00:00Z', end: '2026-09-06T11:00:00Z' }],
      reminders: [],
      projects: [],
      emails: [],
      tomorrow: [],
      creative: [],
      sourceStatus: { 'google-calendar': 'ready' },
      dailyPlan: { calendarAvailability: 'confirmed' },
    },
  };
  const { sandbox, requests } = loaderFixture(data);
  await sandbox.loadCreativeBrief();
  assert.equal(requests[0], '/daily-brief/current');
  assert.equal(sandbox.personalBriefState.textContent, 'Brief prêt');
  assert.equal(sandbox.personalBriefContent.children[0].tagName, 'h2');
  assert.match(sandbox.briefStructuredContent.textContent, /Bonjour Arnaud/);
  assert.match(sandbox.briefStructuredContent.textContent, /Tes priorités/);
  assert.match(sandbox.briefStructuredContent.textContent, /Avancer Noon/);
  assert.match(sandbox.briefStructuredContent.textContent, /Créneaux disponibles/);
  assert.match(sandbox.briefGeneratedAt.textContent, /dimanche 6 septembre/i);
  assert.match(sandbox.briefGeneratedAt.textContent, /20:08/);
  assert.equal(
    sandbox.personalBriefState.getAttribute("aria-label"),
    "Brief du jour prêt"
  );
});
test("generation polling disappears when READY even if stored status was generating", async () => {
  const data = { date: '2026-09-06', status: 'generating', generationActive: true, current: null };
  const { sandbox, timers } = loaderFixture(data);
  await sandbox.loadCreativeBrief();
  assert.equal(sandbox.personalBriefState.textContent, 'Génération en cours…');
  data.generationActive = false;
  data.current = { date: data.date, content: '## Prêt' };
  await timers[0]();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sandbox.personalBriefState.textContent, 'Brief prêt');
  assert.equal(sandbox.personalBriefState.dataset.state, 'READY');
});
test("yesterday never renders as current, but remains explicitly historical", async () => {
  const yesterday = { date: '2026-09-05', content: 'Ancien brief' };
  const data = { date: '2026-09-06', status: 'failed', current: yesterday, historical: [yesterday] };
  const { sandbox, requests } = loaderFixture(data);
  await sandbox.loadCreativeBrief();
  assert.equal(sandbox.personalBriefContent.textContent, '');
  assert.match(sandbox.personalBriefState.textContent, /du jour.*2026-09-06.*pas pu/);
  assert.match(sandbox.briefHistorySelect.textContent, /Brief précédent — 2026-09-05/);
  sandbox.briefHistorySelect.value = yesterday.date;
  data.brief = yesterday;
  await sandbox.loadCreativeBrief();
  assert.equal(requests.at(-1), '/daily-brief/history?date=2026-09-05');
  assert.match(sandbox.personalBriefState.textContent, /Brief historique — 2026-09-05/);
  assert.equal(sandbox.personalBriefContent.textContent, 'Ancien brief');
});
test("next-day refresh invalidates visible content and late responses cannot overwrite it", async () => {
  const data = { date: '2026-09-05', current: { date: '2026-09-05', content: 'Hier' } };
  const { sandbox } = loaderFixture(data);
  await sandbox.loadCreativeBrief();
  let release;
  sandbox.fetch = () => new Promise(resolve => { release = resolve; });
  const old = sandbox.loadCreativeBrief();
  assert.equal(sandbox.personalBriefContent.textContent, '');
  sandbox.fetch = async () => ({ ok: true, json: async () => ({ date: '2026-09-06', current: { date: '2026-09-06', content: 'Aujourd’hui' } }) });
  await sandbox.loadCreativeBrief();
  release({ ok: true, json: async () => data }); await old;
  assert.equal(sandbox.personalBriefContent.textContent, 'Aujourd’hui');
});
test("PARTIAL expose un état accessible sans masquer le brief", async () => {
  const data = {
    date: "2026-09-06",
    status: "partial",
    current: {
      date: "2026-09-06",
      content: "Synthèse partielle",
      priorities: [{ id: "p1", title: "Avancer Noon" }],
      calendar: [],
      proposals: [],
      reminders: [],
      projects: [],
      emails: [],
      tomorrow: [],
      creative: [],
      sources: [{ id: "gmail", status: "unavailable", label: "Source momentanément indisponible" }],
    },
  };

  const { sandbox } = loaderFixture(data);
  await sandbox.loadCreativeBrief();

  assert.equal(sandbox.personalBriefState.dataset.state, "PARTIAL");
  assert.equal(
    sandbox.personalBriefState.getAttribute("aria-label"),
    "Brief du jour partiel, certaines sources sont indisponibles"
  );
  assert.match(sandbox.personalBriefContent.textContent, /Synthèse partielle/);
  assert.match(sandbox.briefStructuredContent.textContent, /Avancer Noon/);
});

test("fetch failure terminates both loading indicators", async () => {
  const { sandbox } = loaderFixture({});
  sandbox.fetch = async () => { throw new Error('Serveur indisponible'); };
  await sandbox.loadCreativeBrief();
  assert.equal(sandbox.personalBriefState.dataset.state, 'FAILED');
  assert.equal(sandbox.personalBriefState.textContent, sandbox.briefState.textContent);
  assert.doesNotMatch(sandbox.personalBriefState.textContent, /Génération|Chargement/);
});
