"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createMemoryEngine } = require("../services/memory/memory-engine");
const { createHardRulesRegistry } = require("../services/rules/hard-rules-registry");

function privateFixture(memories = []) {
  const byId = new Map(memories.map((item) => [item.id, item]));
  return {
    available: true,
    listMemories: () => [...byId.values()],
    getMemory: (id) => byId.get(id) || null,
    isProfileEnabled: () => true,
    settings: () => ({ enabled: true, sensitiveApiAllowed: false }),
    hardRules: () => [{ id: "rule-1", statement: "Règle fictive", enabled: true }],
  };
}

function privateItem(overrides = {}) {
  return {
    id: "private-1", subjectId: "arnaud", category: "preference",
    statement: "Préférer une interface sobre", sensitivity: "low",
    status: "confirmed", confidence: 1, apiPolicy: "contextual",
    consentRequired: false, consentStatus: "granted", tags: [],
    updatedAt: "2026-01-01T00:00:00.000Z", ...overrides,
  };
}

function createFixture({ privateMemories = [], structured = [], legacy = [], projects = [], conversation = [], failingStructured = false, debug = null } = {}) {
  const privateService = privateFixture(privateMemories);
  const allowedPrivateIds = privateMemories
    .filter((item) => item.status === "confirmed" && item.apiPolicy !== "local_only")
    .map((item) => item.id);
  return createMemoryEngine({
    privateMemoryService: privateService,
    privateContextBuilder: { build: () => ({ memoryIds: allowedPrivateIds }) },
    structuredRepository: {
      searchMemories() {
        if (failingStructured) throw Object.assign(new Error("panne fictive"), { code: "SOURCE_DOWN" });
        return structured;
      },
      getMemory(id) { return structured.find((item) => item.id === id) || null; },
    },
    legacyStore: { relevant: () => legacy, load: () => ({ memories: legacy }) },
    projectProvider: () => projects,
    conversationProvider: () => conversation,
    debug,
    now: () => new Date("2026-06-01T00:00:00.000Z"),
  });
}

test("une demande projet ne charge pas les profils privés sans rapport", () => {
  const engine = createFixture({
    privateMemories: [privateItem()],
    projects: [{ id: "kasa", name: "Kasa", objective: "Application React", status: "active" }],
  });
  const result = engine.getRelevantContext({ query: "Analyse le projet Kasa", intent: "project", projectId: "kasa" });
  assert.equal(result.privateContext.length, 0);
  assert.equal(result.projectContext.length, 1);
});

test("une demande sur une personne ne retourne que son profil autorisé", () => {
  const engine = createFixture({
    privateMemories: [
      privateItem({ id: "a", subjectId: "arnaud", statement: "Arnaud préfère une interface sobre" }),
      privateItem({ id: "b", subjectId: "alexandra", statement: "Alexandra préfère une interface claire" }),
    ],
  });
  const result = engine.getRelevantContext({ query: "Quelle interface préfère Arnaud ?", peopleIds: ["arnaud"] });
  assert.deepEqual(result.privateContext.map((item) => item.profileId), ["arnaud"]);
});

test("un profil familial n'est jamais chargé implicitement", () => {
  const engine = createFixture({
    privateMemories: [
      privateItem({ id: "owner", subjectId: "arnaud", statement: "Arnaud apprécie les interfaces sobres" }),
      privateItem({ id: "family", subjectId: "alexandra", statement: "Alexandra apprécie les interfaces sobres" }),
    ],
  });
  const result = engine.getRelevantContext({ query: "Quelles interfaces sont appréciées ?" });
  assert.deepEqual(result.privateContext.map((item) => item.profileId), ["arnaud"]);
});

test("local_only reste utilisable localement mais interdit au modèle distant", () => {
  const engine = createFixture({
    privateMemories: [privateItem({ apiPolicy: "local_only", statement: "Information locale fictive" })],
  });
  const result = engine.getRelevantContext({ query: "information locale" });
  assert.equal(result.localOnlyContext.length, 1);
  assert.equal(result.localOnlyContext[0].usableLocally, true);
  assert.equal(result.localOnlyContext[0].allowedForRemoteModel, false);
  assert.equal(result.remoteContext.length, 0);
});

test("déduplique à la lecture en privilégiant privé puis structuré puis historique", () => {
  const statement = "Préférer une interface sobre";
  const engine = createFixture({
    privateMemories: [privateItem({ statement })],
    structured: [{ id: "structured-1", subject: statement, value: statement, status: "confirmed", confidence: 1, useAllowed: true }],
    legacy: [{ id: "legacy-1", text: statement, updatedAt: "2025-01-01T00:00:00.000Z" }],
  });
  const result = engine.getRelevantContext({ query: "interface sobre" });
  assert.equal(result.relevantMemories.length, 1);
  assert.equal(result.relevantMemories[0].source, "private_memory");
  assert.equal(result.metadata.counts.deduplicated, 2);
});

test("exclut une mémoire privée expirée ou supprimée", () => {
  const engine = createFixture({
    privateMemories: [
      privateItem({ id: "expired", statement: "Information expirée", expiresAt: "2020-01-01T00:00:00.000Z" }),
      privateItem({ id: "deleted", statement: "Information supprimée", status: "deleted" }),
    ],
  });
  const result = engine.getRelevantContext({ query: "information" });
  assert.deepEqual(result.privateContext, []);
});

test("confirm_each_use n'est distant qu'après confirmation explicite", () => {
  const item = privateItem({ apiPolicy: "confirm_each_use", statement: "Information protégée fictive" });
  const engine = createFixture({ privateMemories: [item] });
  const blocked = engine.getRelevantContext({ query: "information protégée" });
  assert.equal(blocked.localOnlyContext.length, 1);
  assert.equal(blocked.remoteContext.length, 0);
  const confirmed = engine.getRelevantContext({ query: "information protégée", confirmedMemoryIds: [item.id] });
  assert.equal(confirmed.remoteContext.length, 1);
});

test("retourne un résultat vide propre lorsqu'aucune mémoire n'est pertinente", () => {
  const result = createFixture().getRelevantContext({ query: "question sans contexte" });
  assert.deepEqual(result.relevantMemories, []);
  assert.deepEqual(result.metadata.memoryIds, []);
  assert.equal(result.metadata.truncated, false);
});

test("exclut une mémoire legacy renvoyée sans rapport avec la question", () => {
  const result = createFixture({
    legacy: [{ id: "legacy-profile", text: "Arnaud est directeur artistique", tags: ["profil"] }],
  }).getRelevantContext({ query: "Différence entre HTTP et WebSocket" });
  assert.deepEqual(result.relevantMemories, []);
  assert.equal(result.metadata.counts.excludedIrrelevant, 1);
});

test("une source en erreur n'empêche pas les autres sources de répondre", () => {
  const events = [];
  const engine = createFixture({
    failingStructured: true,
    legacy: [{ id: "legacy-1", text: "Projet Kasa en React", updatedAt: "2025-01-01T00:00:00.000Z" }],
    debug: (event, metadata) => events.push({ event, metadata }),
  });
  const result = engine.getRelevantContext({ query: "Kasa React" });
  assert.equal(result.relevantMemories.length, 1);
  assert.equal(result.metadata.errors[0].source, "structured_memory");
  assert.equal(events[0].event, "memory-engine.summary");
  assert.doesNotMatch(JSON.stringify(events), /Projet Kasa/);
});

test("borne le contexte et expose la provenance sans données privées dans les métriques", () => {
  const engine = createFixture({
    structured: Array.from({ length: 5 }, (_, index) => ({
      id: `s-${index}`, subject: `Préférence ${index}`, value: `interface ${index} ${"x".repeat(100)}`,
      status: "confirmed", confidence: 1, useAllowed: true,
    })),
  });
  const result = engine.getRelevantContext({ query: "interface", maxItems: 2, maxCharacters: 500 });
  assert.equal(result.relevantMemories.length, 2);
  assert.equal(result.metadata.truncated, true);
  assert.equal(result.relevantMemories.every((item) => item.source === "structured_memory"), true);
});

test("conserve les IDs de profils attendus, y compris les projets préfixés", () => {
  const expected = ["arnaud", "alexandra", "sinan", "kaan", "household", "noon", "projects", "project:kasa"];
  const memories = expected.map((subjectId, index) => privateItem({ id: `p-${index}`, subjectId, statement: `Profil fictif ${subjectId}` }));
  const result = createFixture({ privateMemories: memories }).getRelevantContext({ query: "profil fictif", peopleIds: expected });
  assert.deepEqual(new Set(result.privateContext.map((item) => item.profileId)), new Set(expected));
});

test("caractérise le contexte conversationnel récent et sa limite", () => {
  const conversation = Array.from({ length: 20 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: `message ${index}` }));
  const result = createFixture({ conversation }).getRelevantContext({ query: "suite", conversationId: "session-1234", conversationLimit: 6 });
  assert.equal(result.conversationContext.length, 6);
  assert.equal(result.conversationContext[0].value, "message 14");
  assert.equal(result.conversationContext[5].value, "message 19");
});

test("distingue les Hard Rules canoniques des contraintes mémoire legacy", () => {
  const registry = createHardRulesRegistry();
  const engine = createMemoryEngine({
    hardRulesRegistry: registry,
    structuredRepository: {
      searchMemories: () => [{
        id: "legacy-rule", type: "permanent_constraint",
        subject: "Aucun e-mail envoyé sans ordre",
        value: { rule: "Aucun e-mail envoyé sans ordre" },
        status: "confirmed", confidence: 1, useAllowed: true,
      }],
    },
  });
  const result = engine.getRelevantContext({ query: "Prépare un e-mail", intent: "email" });
  assert.equal(result.relevantMemories.length, 0);
  assert.equal(result.hardRules.some((rule) => rule.id === "email.send_requires_explicit_permission"), true);
});

test("relit une source offloadée par son autorité sans registre de contenu parallèle", () => {
  const engine = createFixture({
    privateMemories: [privateItem({ id: "private-resolve", statement: "Préférence relue" })],
    structured: [{
      id: "structured-resolve", subject: "Décision", value: { choice: "A" },
      status: "confirmed", confidence: 1, useAllowed: true,
      metadata: { profileId: "arnaud", apiPolicy: "contextual" },
    }],
    projects: [{
      id: "project-resolve", name: "Projet", objective: "Livrer", currentState: "Actif",
      nextAction: "Tester", blockers: [], status: "in_progress",
    }],
    conversation: [{ id: "message-resolve", role: "user", content: "Message relu" }],
  });
  assert.equal(engine.canResolveContextSource("private_memory"), true);
  assert.equal(engine.resolveContextSource({
    sourceType: "private_memory", sourceId: "private-resolve", subjectScope: "arnaud",
  }).content, "Préférence relue");
  assert.deepEqual(engine.resolveContextSource({
    sourceType: "structured_memory", sourceId: "structured-resolve", subjectScope: "arnaud",
  }).content, { choice: "A" });
  assert.equal(engine.resolveContextSource({
    sourceType: "conversation_memory", sourceId: "message-resolve", conversationId: "conversation-a",
  }, {
    access: "remote",
    authorizationContext: { conversationId: "conversation-a", includeConversation: true },
  }).content, "Message relu");
  assert.equal(engine.resolveContextSource({
    sourceType: "private_memory", sourceId: "private-resolve", subjectScope: "alexandra",
  }).authorized, false);
});

test("la relecture offload revérifie la politique mémoire actuelle", () => {
  const item = privateItem({
    id: "private-confirm", statement: "Préférence protégée",
    apiPolicy: "confirm_each_use",
  });
  const engine = createFixture({ privateMemories: [item] });
  const ref = {
    sourceType: "private_memory",
    sourceId: item.id,
    subjectScope: "arnaud",
    profileScope: "arnaud",
  };
  const denied = engine.resolveContextSource(ref, {
    access: "remote",
    authorizationContext: {
      query: "Préférence protégée",
      profileScope: "arnaud",
      confirmedMemoryIds: [],
    },
  });
  assert.equal(denied.authorized, true);
  assert.equal(denied.allowedForRemoteModel, false);

  const allowed = engine.resolveContextSource(ref, {
    access: "remote",
    authorizationContext: {
      query: "Préférence protégée",
      profileScope: "arnaud",
      confirmedMemoryIds: [item.id],
    },
  });
  assert.equal(allowed.allowedForRemoteModel, true);
});
