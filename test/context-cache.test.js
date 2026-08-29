"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createContextBuilder } = require("../services/context/context-builder");
const { createContextCache } = require("../services/context/context-cache");
const { createHardRulesRegistry } = require("../services/rules/hard-rules-registry");

function emptyResult(overrides = {}) {
  return {
    projectContext: [], conversationContext: [], localOnlyContext: [], remoteContext: [],
    metadata: { counts: { excludedPrivacy: 0, deduplicated: 0 }, sourcesUsed: [], remoteMemoryIds: [], truncated: false },
    ...overrides,
  };
}
function item(id, value, overrides = {}) {
  return { id, value, source: "private_memory", profileId: "arnaud", apiPolicy: "contextual", allowedForRemoteModel: true, ...overrides };
}
function fixture({ resolver = () => emptyResult(), registry = createHardRulesRegistry(), cache = createContextCache(), permissions = () => [] } = {}) {
  let retrievals = 0;
  const builder = createContextBuilder({
    personalityProvider: () => "Personnalité fictive.", hardRulesRegistry: registry, cache,
    permissionsProvider: permissions,
    memoryEngine: { getRelevantContext(input) { retrievals += 1; return resolver(input); } },
  });
  return { builder, cache, retrievals: () => retrievals };
}

test("deux constructions identiques réutilisent static, session et memory", () => {
  const { builder, retrievals } = fixture();
  const input = { query: "Question stable", conversationId: "session-a", memoryVersion: "1" };
  const cold = builder.buildContext(input);
  const warm = builder.buildContext(input);
  assert.equal(cold.metadata.cache.static.hit, false);
  assert.equal(warm.metadata.cache.static.hit, true);
  assert.equal(warm.metadata.cache.session.hit, true);
  assert.equal(warm.metadata.cache.memory.hit, true);
  assert.equal(retrievals(), 1);
});

test("une version Hard Rules différente invalide le segment statique", () => {
  const base = createHardRulesRegistry();
  let version = "1";
  const registry = { ...base, version: () => version };
  const { builder } = fixture({ registry });
  builder.buildContext({ query: "Question", conversationId: "s" });
  version = "2";
  const changed = builder.buildContext({ query: "Question", conversationId: "s" });
  assert.equal(changed.metadata.cache.static.hit, false);
});

test("mode et projet font partie du scope de session", () => {
  const { builder } = fixture({ resolver: (input) => emptyResult({
    projectContext: input.projectId ? [item(input.projectId, { name: input.projectId }, { source: "project_memory", profileId: `project:${input.projectId}` })] : [],
  }) });
  builder.buildContext({ query: "Projet", conversationId: "s", mode: "DA", projectId: "a" });
  const modeChanged = builder.buildContext({ query: "Projet", conversationId: "s", mode: "DEV", projectId: "a" });
  const projectChanged = builder.buildContext({ query: "Projet", conversationId: "s", mode: "DEV", projectId: "b" });
  assert.equal(modeChanged.metadata.cache.session.hit, false);
  assert.equal(projectChanged.metadata.cache.session.hit, false);
  assert.deepEqual(projectChanged.metadata.projectIds, ["b"]);
  assert.equal(JSON.stringify(projectChanged.remoteModelContext).includes('"name":"a"'), false);
});

test("invalidation mémoire et oubli empêchent le retour d'une valeur ancienne", () => {
  let memories = [item("old", "Valeur fictive ancienne")];
  const { builder, retrievals } = fixture({ resolver: () => emptyResult({ remoteContext: memories }) });
  const input = { query: "Valeur fictive", conversationId: "s" };
  builder.buildContext(input);
  memories = [];
  builder.invalidateMemory();
  const afterForget = builder.buildContext(input);
  assert.equal(retrievals(), 2);
  assert.deepEqual(afterForget.metadata.memoryIds, []);
});

test("local_only reste local après un cache hit", () => {
  const local = item("private-local", "Donnée fictive locale", { apiPolicy: "local_only", allowedForRemoteModel: false });
  const { builder } = fixture({ resolver: () => emptyResult({ localOnlyContext: [local] }) });
  const input = { query: "Donnée fictive", conversationId: "s" };
  builder.buildContext(input);
  const warm = builder.buildContext(input);
  assert.equal(warm.metadata.cache.memory.hit, true);
  assert.deepEqual(warm.remoteModelContext.userContext.memories, []);
  assert.deepEqual(warm.localContext.localOnly.map(({ id }) => id), ["private-local"]);
});

test("les scopes de profils ne partagent jamais une entrée mémoire", () => {
  const { builder, retrievals } = fixture({ resolver: (input) => emptyResult({
    remoteContext: input.peopleIds.map((id) => item(`memory-${id}`, `Préférence fictive ${id}`, { profileId: id })),
  }) });
  const alex = builder.buildContext({ query: "Préférence Alexandra", conversationId: "s" });
  const arnaud = builder.buildContext({ query: "Préférence Arnaud", conversationId: "s" });
  assert.equal(retrievals(), 2);
  assert.deepEqual(alex.metadata.people, ["alexandra"]);
  assert.deepEqual(arnaud.metadata.people, ["arnaud"]);
});

test("un changement de version projet rafraîchit son segment", () => {
  const { builder } = fixture({ resolver: () => emptyResult({ projectContext: [item("p", { name: "Projet" }, { source: "project_memory" })] }) });
  builder.buildContext({ query: "Projet", projectId: "p", projectVersion: "mtime-1" });
  const warm = builder.buildContext({ query: "Projet", projectId: "p", projectVersion: "mtime-1" });
  const changed = builder.buildContext({ query: "Projet", projectId: "p", projectVersion: "mtime-2" });
  assert.equal(warm.metadata.cache.project.hit, true);
  assert.equal(changed.metadata.cache.project.hit, false);
});

test("une panne du cache retombe sur la construction normale", () => {
  const brokenCache = {
    getOrCreate() { throw new Error("cache indisponible"); },
    stats: () => ({ entries: 0, memoryBytesEstimate: 0 }),
    fingerprint: () => "fallback-fingerprint",
    clear: () => 0, invalidate: () => 0, inspect: () => [],
  };
  const { builder } = fixture({ cache: brokenCache });
  const context = builder.buildContext({ query: "Question" });
  assert.ok(context.system.personality);
  assert.equal(context.metadata.cache.static.fallback, true);
});

test("le cache est borné et son inspection ne révèle aucun contenu", () => {
  const cache = createContextCache({ maxEntries: 2, maxBytes: 10_000 });
  cache.getOrCreate("memory", { query: "SECRET_FICTIF_1" }, () => ({ value: "SECRET_FICTIF_1" }));
  cache.getOrCreate("memory", { query: "SECRET_FICTIF_2" }, () => ({ value: "SECRET_FICTIF_2" }));
  cache.getOrCreate("memory", { query: "SECRET_FICTIF_3" }, () => ({ value: "SECRET_FICTIF_3" }));
  assert.equal(cache.stats().entries, 2);
  assert.doesNotMatch(JSON.stringify(cache.inspect()), /SECRET_FICTIF/);
});

test("un TTL dynamique expiré provoque une reconstruction", () => {
  let time = 1000;
  let builds = 0;
  const cache = createContextCache({ now: () => time });
  cache.getOrCreate("dynamic", { calendar: true }, () => ++builds, { ttlMs: 50 });
  time += 25;
  assert.equal(cache.getOrCreate("dynamic", { calendar: true }, () => ++builds, { ttlMs: 50 }).hit, true);
  time += 30;
  assert.equal(cache.getOrCreate("dynamic", { calendar: true }, () => ++builds, { ttlMs: 50 }).hit, false);
  assert.equal(builds, 2);
});

test("les outils sont omis du cache quand inutiles et conservés quand demandés", () => {
  const { builder } = fixture();
  const simple = builder.buildContext({ query: "Explique React" });
  assert.equal(simple.metadata.cache.tools.skipped, true);
  assert.deepEqual(simple.segments.tools.requested, []);
  const calendar = builder.buildContext({
    query: "Consulte mon agenda", conversationId: "calendar-session",
    requestedTools: ["calendar.read"],
  });
  assert.deepEqual(calendar.segments.tools.requested, ["calendar.read"]);
  assert.equal(calendar.metadata.ruleIds.includes("calendar.protected_lunch"), true);
});

test("Live Voice réutilise le contexte stable sans élargir son budget", () => {
  const { builder, retrievals } = fixture();
  const input = { query: "Bonjour Noon", channel: "live_voice", conversationId: "voice-session" };
  builder.buildContext(input);
  const warm = builder.buildContext(input);
  assert.equal(warm.metadata.cache.memory.hit, true);
  assert.equal(warm.metadata.budgetTokens, 1600);
  assert.equal(retrievals(), 1);
});
