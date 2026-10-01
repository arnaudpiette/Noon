"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createPersonalSearchEngine, inferIntent, selectSources } = require("../services/search/personal-search-engine");
const { createFileSearchAdapter } = require("../services/search/file-search-adapter");

function adapter(results, { authorized = true, version = "1", delay = 0 } = {}) {
  return {
    version: () => version,
    isAuthorized: () => authorized,
    async search() {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      return results;
    },
  };
}

test("déduit les intentions et sélectionne les sources sans tout interroger", () => {
  assert.equal(inferIntent("où avons-nous parlé de ce choix ?"), "HISTORY_LOOKUP");
  assert.deepEqual(selectSources("retrouve cet email", "SOURCE_LOOKUP").primary, ["email"]);
  assert.deepEqual(selectSources("VoiceIdentity", "EXACT_LOOKUP", ["file"]).primary, ["file"]);
});

test("classe un symbole exact avant une correspondance sémantique", async () => {
  const engine = createPersonalSearchEngine({ adapters: { file: adapter([
    { id: "semantic", title: "Voix", snippet: "La voix principale est gérée ici", locator: { path: "/a" } },
    { id: "exact", title: "VoiceIdentity", snippet: "class VoiceIdentity", locator: { path: "/b", line: 4 } },
  ]) } });
  const result = await engine.search({ query: "VoiceIdentity", sourceScopes: ["file"] });
  assert.equal(result.results[0].sourceId, "exact");
  assert.equal(result.citations[0].resultId, result.results[0].resultId);
});

test("étend progressivement la recherche uniquement en absence de résultat", async () => {
  let conversations = 0; let files = 0;
  const engine = createPersonalSearchEngine({ adapters: {
    conversation: { version: () => "1", search: () => (conversations++, []) },
    memory: adapter([]),
    project: adapter([]),
    file: { version: () => "1", search: () => (files++, [{ id: "f", title: "accord", snippet: "confirmation", locator: { path: "/f" } }]) },
  } });
  const result = await engine.search({ query: "accord" });
  assert.equal(conversations, 1);
  assert.equal(files, 1);
  assert.equal(result.status, "found");
});

test("n’étend pas une recherche quand la source primaire répond", async () => {
  let files = 0;
  const engine = createPersonalSearchEngine({ adapters: {
    conversation: adapter([{ id: "c", title: "accord", snippet: "accord confirmé" }]),
    memory: adapter([]), project: adapter([]),
    file: { version: () => "1", search: () => (files++, []) },
  } });
  await engine.search({ query: "accord" });
  assert.equal(files, 0);
});

test("isole les profils et les projets", async () => {
  const engine = createPersonalSearchEngine({ adapters: { memory: adapter([
    { id: "a", title: "Préférence", snippet: "thé vert", profileScope: "arnaud", projectId: "p1" },
    { id: "b", title: "Préférence", snippet: "thé vert", profileScope: "alexandra", projectId: "p1" },
    { id: "c", title: "Préférence", snippet: "thé vert", profileScope: "arnaud", projectId: "p2" },
  ]) } });
  const result = await engine.search({ query: "thé vert", sourceScopes: ["memory"], profileScope: "arnaud", projectId: "p1" });
  assert.deepEqual(result.results.map((item) => item.sourceId), ["a"]);
});

test("local_only reste visible localement mais absent de l’evidence distante", async () => {
  const engine = createPersonalSearchEngine({ adapters: { memory: adapter([
    { id: "secret", title: "Mémoire", snippet: "information privée", localOnly: true, locator: { memoryId: "secret" } },
  ]) } });
  const result = await engine.search({ query: "information privée", sourceScopes: ["memory"] });
  const remote = engine.toRemoteEvidence(result);
  assert.equal(result.results.length, 1);
  assert.equal(result.remoteResults.length, 0);
  assert.equal(remote.results.length, 0);
  assert.equal(remote.citations.length, 0);
});

test("signale explicitement une source non autorisée sans inventer de résultat", async () => {
  const engine = createPersonalSearchEngine({ adapters: { email: adapter([], { authorized: false }) } });
  const result = await engine.search({ query: "contrat", sourceScopes: ["email"] });
  assert.equal(result.status, "unavailable");
  assert.equal(result.sourceCoverage[0].status, "unauthorized");
  assert.match(result.message, /pas pu vérifier/i);
});

test("retourne des résultats partiels lorsqu’une source expire", async () => {
  const engine = createPersonalSearchEngine({ perSourceTimeoutMs: 15, adapters: {
    note: adapter([{ id: "n", title: "budget", snippet: "budget validé" }]),
    email: adapter([], { delay: 50 }),
  } });
  const result = await engine.search({ query: "budget", sourceScopes: ["note", "email"] });
  assert.equal(result.status, "partial");
  assert.equal(result.sourcesFailed, 1);
  assert.ok(result.sourceCoverage.some((item) => item.status === "timeout"));
});

test("déduplique une information et conserve ses sources de soutien", async () => {
  const shared = { title: "Décision", snippet: "Le lancement est vendredi", canonicalKey: "launch-friday" };
  const engine = createPersonalSearchEngine({ adapters: {
    conversation: adapter([{ id: "c", ...shared }]), memory: adapter([{ id: "m", ...shared }]),
  } });
  const result = await engine.search({ query: "lancement vendredi", sourceScopes: ["conversation", "memory"] });
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].supportingSources.length, 1);
});

test("signale les contradictions au lieu de les fusionner", async () => {
  const engine = createPersonalSearchEngine({ adapters: { memory: adapter([
    { id: "old", title: "Date lancement", snippet: "Lancement lundi", timestamp: "2026-08-01" },
    { id: "new", title: "Date lancement", snippet: "Lancement vendredi", timestamp: "2026-08-20" },
  ]) } });
  const result = await engine.search({ query: "lancement", sourceScopes: ["memory"] });
  assert.equal(result.unresolvedConflicts.length, 1);
  assert.equal(result.unresolvedConflicts[0].status, "unresolved");
});

test("le cache est invalidé par la version source et les logs n’incluent pas la requête", async () => {
  let version = "1"; let calls = 0; const audits = [];
  const engine = createPersonalSearchEngine({ audit: (event, metadata) => audits.push({ event, metadata }), adapters: {
    memory: { version: () => version, search: () => (calls++, [{ id: version, title: "secret", snippet: "secret trouvé" }]) },
  } });
  const first = await engine.search({ query: "secret très personnel", sourceScopes: ["memory"] });
  const cached = await engine.search({ query: "secret très personnel", sourceScopes: ["memory"] });
  version = "2";
  const refreshed = await engine.search({ query: "secret très personnel", sourceScopes: ["memory"] });
  assert.equal(first.cacheHit, false); assert.equal(cached.cacheHit, true); assert.equal(refreshed.cacheHit, false);
  assert.equal(calls, 2);
  assert.ok(!JSON.stringify(audits).includes("secret très personnel"));
});

test("l’adaptateur fichier recherche le contenu autorisé et bloque un symlink sortant", async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "noon-search-"));
  const root = path.join(temporary, "root"); const outside = path.join(temporary, "outside");
  fs.mkdirSync(root); fs.mkdirSync(outside);
  fs.writeFileSync(path.join(root, "voice.js"), "class VoiceIdentity {}\n");
  fs.writeFileSync(path.join(outside, "private.txt"), "VoiceIdentity secret\n");
  fs.symlinkSync(outside, path.join(root, "escape"));
  const adapter = createFileSearchAdapter({ rootsProvider: () => [root] });
  const results = adapter.search({ query: "où est gérée la voix principale", exactTerms: [], profileScope: "arnaud", resultsPerSource: 10 });
  assert.equal(results.length, 1);
  assert.equal(results[0].title, "voice.js");
  assert.ok(!results.some((item) => item.locator.path.includes("private.txt")));
  assert.deepEqual(adapter.search({ query: "VoiceIdentity", projectId: "inconnu", resultsPerSource: 10 }), []);
});

test("A3 sélectionne les métadonnées avant les lectures de contenu et borne ce budget", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "noon-a3-files-"));
  for (const name of ["voice-a.js", "voice-b.js", "voice-c.js", "voice-d.js", "unrelated.js"]) fs.writeFileSync(path.join(temporary, name), `const token = '${name}';`);
  const adapter = createFileSearchAdapter({ rootsProvider: () => [temporary], maxResults: 10 }); const original = fs.readFileSync; const reads = [];
  fs.readFileSync = (file, ...args) => { reads.push(path.basename(String(file))); return original(file, ...args); };
  try {
    const selected = adapter.search({ query: "voice", fileSearchMode: "metadata", contentReadBudget: 2, resultsPerSource: 3, profileScope: "arnaud" });
    assert.equal(selected.length, 2); assert.deepEqual(reads.sort(), ["voice-a.js", "voice-b.js"]);
    reads.length = 0; assert.deepEqual(adapter.search({ query: "absent", fileSearchMode: "metadata", contentReadBudget: 2, profileScope: "arnaud" }), []); assert.deepEqual(reads, []);
  } finally { fs.readFileSync = original; fs.rmSync(temporary, { recursive: true, force: true }); }
});

test("A3 transmet le mode métadonnées au connecteur fichier sans retirer la recherche de contenu générale", async () => {
  let request; const engine = createPersonalSearchEngine({ adapters: { file: { version: () => "1", search: (input) => { request = input; return [{ id: "f", title: "voice.js", snippet: "match", locator: { path: "/f" } }]; } } } });
  const a3 = await engine.search({ query: "voice", sourceScopes: ["file"], fileSearchMode: "metadata", contentReadBudget: 12, maxResults: 3, resultsPerSource: 3 });
  assert.equal(request.fileSearchMode, "metadata"); assert.equal(request.contentReadBudget, 12); assert.equal(a3.results.length, 1);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "noon-general-files-")); fs.writeFileSync(path.join(temporary, "plain.js"), "needle-content");
  try { assert.equal(createFileSearchAdapter({ rootsProvider: () => [temporary] }).search({ query: "needle-content", profileScope: "arnaud" }).length, 1); } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});

test("le corpus qualité retrouve voix, priorité, accord et historique dans la bonne source", async () => {
  const engine = createPersonalSearchEngine({ adapters: {
    file: adapter([{ id: "voice", title: "voice-identity.js", snippet: "Identité vocale principale VoiceIdentity", locator: { path: "/voice" } }]),
    project: adapter([{ id: "priority", title: "Priority Engine", snippet: "Moteur de priorisation central", locator: { projectId: "noon" } }]),
    conversation: adapter([{ id: "agreement", title: "Accord client", snippet: "Validation donnée dans notre ancien échange", locator: { conversationId: "c1" } }]),
    memory: adapter([]),
  } });
  const voice = await engine.search({ query: "où est gérée la voix principale ?", sourceScopes: ["file"] });
  const priority = await engine.search({ query: "quel projet contient le moteur de priorité ?", sourceScopes: ["project"] });
  const agreement = await engine.search({ query: "dans quelle conversation ai-je donné mon accord ?", sourceScopes: ["conversation"] });
  assert.equal(voice.results[0].sourceId, "voice");
  assert.equal(priority.results[0].sourceId, "priority");
  assert.equal(agreement.results[0].sourceId, "agreement");
});

test("un grand corpus synthétique reste borné et expose les métriques de coût local", async () => {
  const rows = Array.from({ length: 5000 }, (_, index) => ({ id: `row-${index}`, title: `Entrée ${index}`, snippet: index === 0 ? "aiguille exacte" : "bruit" }));
  const recorded = [];
  const engine = createPersonalSearchEngine({ metrics: { record: (metric, value) => recorded.push([metric, value]) }, adapters: { memory: adapter(rows) } });
  const startedAt = Date.now();
  const result = await engine.search({ query: "aiguille exacte", sourceScopes: ["memory"], resultsPerSource: 6 });
  assert.ok(Date.now() - startedAt < 1000);
  assert.ok(result.results.length <= 6);
  assert.ok(recorded.some(([metric]) => metric === "search_sources_attempted"));
  assert.ok(recorded.some(([metric]) => metric === "search_total_ms"));
});
