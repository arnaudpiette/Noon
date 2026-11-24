"use strict";

// V3-L7 — assemblage de la recherche personnelle et de la synthèse multi-sources, sorti de
// server.js : dépendances déclarées, moteur multimodal relu à chaque usage, sources et
// permissions de la synthèse inchangées.
const assert = require("node:assert/strict");
const test = require("node:test");
const { DEPENDENCIES, createPersonalSearchComposition } = require("../services/search/personal-search-composition");
const { readServerSource } = require("./helpers/server-source");

function fixture(state) {
  const audits = [];
  const deps = {
    GOOGLE_ACCOUNT_EMAIL: "compte@example.test",
    calendarConnector: { get connected() { return state.calendar; } },
    conversationSummaries: new Map(),
    createConversationKey: ({ sessionId }) => `key:${sessionId}`,
    getAllowedDirectories: () => [],
    getConversationIndex: () => ({ conversations: [] }),
    getConversationTranscript: () => [],
    getValidRegisteredProjects: () => [],
    gmailConnector: { get connected() { return state.gmail; } },
    isExcluded: () => false,
    isPathAllowed: (candidate) => candidate.startsWith("/autorise/"),
    memoryEngine: { search: () => [] },
    metricsService: { record() {} },
    get multimodalEngine() { return state.multimodal; },
    notesConnector: { listRecentNotes: async () => [] },
    projectIntelligenceService: { listWithSignals: () => [] },
    reliabilityEngine: { recordSuccess() {}, recordFailure() { return null; } },
    remindersConnector: { listIncompleteReminders: async () => [] },
    toolAuditLog: { append: (event) => audits.push(event) },
  };
  return { deps, audits };
}

// La version de la source (`multimodal-<nombre d'éléments>`) entre dans la clé de cache : un
// autre nombre d'éléments force une nouvelle recherche.
function media(label, count = 1) {
  return { listAssets: () => Array(count).fill(label), search: async () => [{ id: label, sourceType: "media", title: `Photo ${label}`, content: "photo de plage", timestamp: "2026-11-01T00:00:00.000Z" }] };
}

test("dépendance manquante refusée", () => {
  for (const name of DEPENDENCIES) {
    const { deps } = fixture({});
    delete deps[name];
    assert.throws(() => createPersonalSearchComposition(deps), new RegExp(`Dépendance manquante : ${name}$`));
  }
});

test("les deux moteurs sont construits ; la recherche média lit le moteur multimodal courant", async () => {
  const state = { multimodal: media("a"), gmail: false, calendar: false };
  const { deps, audits } = fixture(state);
  const { personalSearchEngine, multiSourceSynthesisEngine } = createPersonalSearchComposition(deps);
  assert.equal(typeof personalSearchEngine.search, "function");
  assert.equal(typeof multiSourceSynthesisEngine, "object");
  const first = await personalSearchEngine.search({ query: "photo plage", sourceScopes: ["media"] });
  state.multimodal = media("b", 2);
  const second = await personalSearchEngine.search({ query: "photo plage", sourceScopes: ["media"] });
  const ids = (result) => JSON.stringify(result).match(/Photo [ab]/g) || [];
  assert.ok(ids(first).includes("Photo a"), JSON.stringify(first).slice(0, 300));
  assert.ok(ids(second).includes("Photo b"));
  assert.equal(ids(second).includes("Photo a"), false);
  assert.ok(audits.includes("search.started"));
});

test("server.js assemble la recherche après le magasin de conversations, à la place de l'ancien bloc", () => {
  const source = readServerSource();
  const call = source.indexOf("\n({ personalSearchEngine, multiSourceSynthesisEngine } = createPersonalSearchComposition({\n");
  assert.notEqual(call, -1);
  assert.ok(source.indexOf("} = createConversationStore({") < call);
  const args = source.slice(call, source.indexOf("\n}));", call));
  for (const name of DEPENDENCIES) {
    if (name === "multimodalEngine") assert.ok(args.includes("\n  get multimodalEngine() { return multimodalEngine; },"));
    else assert.ok(args.includes(`\n  ${name},`), name);
  }
  assert.match(source, /\nlet personalSearchEngine = null;\nlet multiSourceSynthesisEngine = null;\n/);
});
