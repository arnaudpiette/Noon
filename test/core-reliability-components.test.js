"use strict";

// V3-L7 — composants surveillés par ReliabilityEngine, enregistrés hors de server.js : mêmes
// composants, dans le même ordre, et contrôles de santé toujours fondés sur l'état réel.
const assert = require("node:assert/strict");
const test = require("node:test");
const { DEPENDENCIES, registerCoreReliabilityComponents } = require("../services/reliability/core-reliability-components");
const { SCHEMA_VERSION } = require("../services/persistence/database");
const { readServerSource } = require("./helpers/server-source");

function fixture(overrides = {}) {
  const registered = [];
  const connector = (id) => ({ id, readCapabilities: ["read"], status: { authState: "connected" }, listRecentNotes: async () => [], listIncompleteReminders: async () => [] });
  const deps = {
    ARTIFACT_PREVIEW_DIRECTORY: "/nonexistent",
    calendarConnector: { connected: false },
    contextBuilder: { cacheStats: () => ({ entries: 0 }), clearContextCache: () => {} },
    getAllowedDirectories: () => [],
    gmailConnector: { connected: false },
    notesConnector: connector("apple-notes"),
    personalDatabase: { kind: "sqlite", database: { prepare: (sql) => ({ get: () => (sql.includes("schema_migrations") ? { version: SCHEMA_VERSION } : { ok: 1 }) }) } },
    portfolioCapacityEngine: { health: () => ({ ok: true }) },
    privateMemoryCipher: {},
    privateMemoryService: { available: true },
    reliabilityEngine: { register: (component) => registered.push(component) },
    remindersConnector: connector("apple-reminders"),
    ...overrides,
  };
  registerCoreReliabilityComponents(deps);
  return Object.fromEntries(registered.map((component) => [component.componentId, component]));
}

test("dépendance manquante refusée avant tout enregistrement", () => {
  for (const name of DEPENDENCIES) {
    const registered = [];
    const deps = Object.fromEntries(DEPENDENCIES.filter((other) => other !== name).map((other) => [other, other === "reliabilityEngine" ? { register: (c) => registered.push(c) } : {}]));
    assert.throws(() => registerCoreReliabilityComponents(deps), new RegExp(`Dépendance manquante : ${name}$`));
    assert.equal(registered.length, 0);
  }
});

test("mêmes composants, dans l'ordre d'avant", () => {
  assert.deepEqual(Object.keys(fixture()), [
    "sqlite", "private-memory", "filesystem", "context-cache", "portfolio-capacity", "artifacts",
    "apple-notes", "apple-reminders", "gmail", "google-calendar", "openai-models", "google-ai-models",
    "gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol", "gpt-6-astra", "gemini-3.8-flash", "realtime",
    "wake-word", "scheduler", "multimodal-image", "multimodal-screenshot", "multimodal-pdf", "multimodal-audio",
  ]);
});

test("contrôles de santé : schéma SQLite, mémoire privée, frontière de capacité, connecteurs", async () => {
  assert.deepEqual(await fixture().sqlite.healthCheck({ deep: false }), { ok: true });
  const mismatch = fixture({ personalDatabase: { kind: "sqlite", database: { prepare: () => ({ get: () => ({ version: SCHEMA_VERSION - 1 }) }) } } });
  await assert.rejects(() => mismatch.sqlite.healthCheck({ deep: false }), { code: "SCHEMA_MISMATCH" });
  await assert.rejects(() => fixture({ personalDatabase: { kind: "json" } }).sqlite.healthCheck({}), { code: "SQLITE_FALLBACK" });
  await assert.rejects(() => fixture({ privateMemoryCipher: null })["private-memory"].healthCheck(), { code: "KEYSTORE_UNAVAILABLE" });
  await assert.rejects(() => fixture()["filesystem"].healthCheck(), { code: "CONFIGURATION_ERROR" });
  await assert.rejects(() => fixture({ portfolioCapacityEngine: { health: () => ({ calendarWriteAuthority: true }) } })["portfolio-capacity"].healthCheck(), { code: "PORTFOLIO_AUTHORITY_VIOLATION" });
  await assert.rejects(() => fixture().gmail.healthCheck(), { code: "AUTH_MISSING" });
  assert.equal(fixture()["google-calendar"].authState(), "missing");
});

test("server.js enregistre ces composants juste après les connecteurs, avant la politique de sécurité", () => {
  const source = readServerSource();
  const call = source.indexOf("\nregisterCoreReliabilityComponents({\n");
  assert.notEqual(call, -1);
  assert.ok(source.indexOf("const calendarConnector = createCalendarConnector(") < call);
  assert.ok(call < source.indexOf("const operationalSecurityPolicy = createOperationalSecurityPolicy("));
  for (const name of DEPENDENCIES) assert.ok(source.slice(call, source.indexOf("\n});", call)).includes(`\n  ${name},`), name);
});
