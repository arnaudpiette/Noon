"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createContextBuilder, estimateTokens } = require("../services/context/context-builder");
const { createHardRulesRegistry } = require("../services/rules/hard-rules-registry");
const { PROVIDERS } = require("../services/models/model-registry");
const { createProviderPrivacyPolicy } = require("../services/security/provider-privacy-policy");

function memoryResult(overrides = {}) {
  return {
    hardRules: [], profileContext: [], relevantMemories: [], projectContext: [],
    conversationContext: [], privateContext: [], localOnlyContext: [], remoteContext: [],
    metadata: { counts: { excludedPrivacy: 0, deduplicated: 0 }, truncated: false },
    ...overrides,
  };
}

function createFixture(result = memoryResult(), debug = null) {
  const calls = [];
  const registry = createHardRulesRegistry();
  const builder = createContextBuilder({
    personalityProvider: () => "Personnalité Noon fictive et concise.",
    hardRulesRegistry: registry,
    memoryEngine: {
      getRelevantContext(input) {
        calls.push(input);
        return typeof result === "function" ? result(input) : result;
      },
    },
    permissionsProvider: ({ intent }) => intent === "email" ? [{ capability: "PREPARE" }] : [],
    debug,
  });
  return { builder, calls, registry };
}

test("injecte uniquement les objectifs pertinents et exclut local_only avant le modèle", () => {
  const registry = createHardRulesRegistry();
  const calls = [];
  const builder = createContextBuilder({
    personalityProvider: () => "Noon",
    hardRulesRegistry: registry,
    memoryEngine: { getRelevantContext: () => memoryResult() },
    goalContextProvider(input) {
      calls.push(input);
      return input.remote ? [{ goalId: "goal-public", title: "Livrer Qwenta", activeMilestone: "Soutenance", relevantConstraint: null, alignmentNeed: null }] : [];
    },
  });
  const context = builder.buildContext({ query: "Où en est Qwenta ?", projectId: "project-qwenta", profileScope: "arnaud" });
  assert.equal(calls[0].remote, true);
  assert.deepEqual(context.remoteModelContext.userContext.relevantGoals.map((item) => item.goalId), ["goal-public"]);
  assert.match(builder.renderRemoteSystemContext(context), /Livrer Qwenta/);
});

function memory(id, value, overrides = {}) {
  return {
    id, value, source: "private_memory", profileId: "arnaud",
    allowedForRemoteModel: true, apiPolicy: "contextual", relevance: 1,
    ...overrides,
  };
}

test("une demande de code ne charge aucun profil familial", () => {
  const { builder, calls } = createFixture();
  const context = builder.buildContext({ query: "Quelle commande npm lance Vite ?", mode: "DEV" });
  assert.deepEqual(calls[0].peopleIds, []);
  assert.deepEqual(context.userContext.people, []);
  assert.equal(context.metadata.ruleIds.includes("calendar.protected_lunch"), false);
});

test("une personne explicitement nommée est la seule demandée à MemoryEngine", () => {
  const { builder, calls } = createFixture((input) => memoryResult({
    remoteContext: [memory("alex-1", "Préférence fictive d’Alexandra", { profileId: "alexandra" })],
  }));
  const context = builder.buildContext({ query: "Quelle préférence Alexandra a-t-elle indiquée ?" });
  assert.deepEqual(calls[0].peopleIds, ["alexandra"]);
  assert.deepEqual(context.metadata.people, ["alexandra"]);
});

test("une mémoire local_only reste locale et disparaît du contexte distant", () => {
  const local = memory("local-1", "Secret fictif local", {
    allowedForRemoteModel: false, apiPolicy: "local_only",
  });
  const { builder } = createFixture(memoryResult({ localOnlyContext: [local] }));
  const context = builder.buildContext({ query: "Rappelle mon secret fictif" });
  assert.deepEqual(context.remoteModelContext.userContext.memories, []);
  assert.deepEqual(context.localContext.localOnly.map((item) => item.id), ["local-1"]);
  assert.equal(context.metadata.exclusionReasons.some((item) => item.id === "local-1" && item.reason === "local_only"), true);
});

test("le contexte distant expose seulement des métadonnées de confidentialité sans contenu", () => {
  const privacy = createProviderPrivacyPolicy({ providerRegistry: PROVIDERS });
  const registry = createHardRulesRegistry();
  const builder = createContextBuilder({
    personalityProvider: () => "Noon",
    hardRulesRegistry: registry,
    memoryEngine: { getRelevantContext: () => memoryResult({
      remoteContext: [memory("private-1", "Préférence privée fictive")],
      localOnlyContext: [memory("local-1", "Secret local fictif", { apiPolicy: "local_only" })],
    }) },
    privacyClassifier: privacy.inspectContextFragment,
  });
  const context = builder.buildContext({ query: "Question fictive" });
  assert.ok(context.metadata.privacy.fragments.some((item) => item.classification === "PRIVATE"));
  assert.equal(context.metadata.privacy.fragments.some((item) => item.classification === "LOCAL_ONLY"), false);
  assert.doesNotMatch(JSON.stringify(context.metadata.privacy), /Préférence privée|Secret local/);
});

test("les règles critiques restent présentes même avec un budget presque épuisé", () => {
  const { builder } = createFixture(memoryResult({
    remoteContext: [memory("large", "x".repeat(5000))],
  }));
  const context = builder.buildContext({ query: "Supprime ce fichier", maxContextTokens: 256 });
  assert.equal(context.metadata.ruleIds.includes("security.destructive_confirmation"), true);
  assert.equal(context.remoteModelContext.system.hardRules.some((rule) => rule.id === "security.destructive_confirmation"), true);
  assert.deepEqual(context.remoteModelContext.userContext.memories, []);
  assert.equal(context.metadata.truncated, true);
});

test("MemoryEngine choisit la mémoire pertinente avant le budget du builder", () => {
  const recent = memory("recent", "Décision récente et pertinente");
  const { builder, calls } = createFixture(memoryResult({ remoteContext: [recent] }));
  const context = builder.buildContext({ query: "Quelle est la décision récente ?", maxContextTokens: 1000 });
  assert.equal(calls.length, 1);
  assert.deepEqual(context.metadata.memoryIds, ["recent"]);
});

test("une conversation simple produit un contexte minimal et structuré", () => {
  const { builder } = createFixture();
  const context = builder.buildContext({ query: "Bonjour", conversationId: "session-1234" });
  assert.equal(context.runtime.channel, "chat");
  assert.deepEqual(context.userContext.projects, []);
  assert.deepEqual(context.userContext.memories, []);
  assert.ok(context.system.personality);
});

test("le mode DEV et un seul projet actif sont conservés", () => {
  const project = memory("kasa", { name: "Kasa", objective: "Application React" }, {
    source: "project_memory", profileId: "project:kasa",
  });
  const { builder } = createFixture(memoryResult({ projectContext: [project] }));
  const context = builder.buildContext({ query: "Analyse le router", mode: "DEV", projectId: "kasa" });
  assert.equal(context.runtime.mode, "DEV");
  assert.deepEqual(context.metadata.projectIds, ["kasa"]);
  assert.equal(context.userContext.projects.length, 1);
});

test("Calendar et e-mail ne chargent que leurs règles et permissions pertinentes", () => {
  const { builder } = createFixture();
  const calendar = builder.buildContext({ query: "Ajoute un rendez-vous dans mon agenda" });
  assert.equal(calendar.metadata.ruleIds.includes("calendar.protected_lunch"), true);
  assert.equal(calendar.metadata.ruleIds.includes("email.send_requires_explicit_permission"), false);
  const email = builder.buildContext({ query: "Prépare un brouillon Gmail" });
  assert.equal(email.metadata.ruleIds.includes("email.send_requires_explicit_permission"), true);
  assert.deepEqual(email.runtime.permissions, [{ capability: "PREPARE" }]);
});

test("live_voice réduit automatiquement mémoire et conversation", () => {
  const many = Array.from({ length: 10 }, (_, index) => memory(`m-${index}`, `mémoire ${index}`));
  const { builder, calls } = createFixture(memoryResult({ remoteContext: many }));
  const context = builder.buildContext({ query: "Parle-moi", channel: "live_voice" });
  assert.equal(calls[0].maxItems, 5);
  assert.equal(calls[0].conversationLimit, 4);
  assert.equal(context.metadata.budgetTokens, 1600);
});

test("le brief utilise un budget plus large mais borné", () => {
  const { builder } = createFixture();
  const context = builder.buildContext({ query: "Prépare le point du jour", channel: "brief", purpose: "daily_brief" });
  assert.equal(context.metadata.budgetTokens, 8000);
  assert.equal(context.runtime.purpose, "daily_brief");
  assert.equal(context.metadata.ruleIds.includes("brief.schedule_0700"), true);
});

test("les métriques debug ne contiennent aucun contenu privé", () => {
  const events = [];
  const secret = "SECRET_FICTIF_NE_PAS_LOGGER";
  const { builder } = createFixture(memoryResult({ remoteContext: [memory("safe-id", secret)] }),
    (event, metadata) => events.push({ event, metadata }));
  builder.buildContext({ query: "question neutre" });
  assert.equal(events[0].event, "context-builder.summary");
  assert.doesNotMatch(JSON.stringify(events), new RegExp(secret));
});

test("la sélection réduit un contexte exhaustif représentatif", () => {
  const selected = memory("selected", "Contexte pertinent court");
  const allPossible = "x".repeat(24_000);
  const { builder } = createFixture(memoryResult({ remoteContext: [selected] }));
  const context = builder.buildContext({ query: "Question ciblée", maxContextTokens: 1000 });
  assert.ok(context.metadata.estimatedTokens < estimateTokens(allPossible));
  assert.equal(context.metadata.memoryIds.length, 1);
});

test("injecte une synthèse structurée sans recopier les preuves brutes", () => {
  const { builder } = createFixture();
  const rendered = builder.renderStructuredSynthesis({
    synthesisId: "synthesis-1", mode: "COMPARE", answer: "Conclusion vérifiée",
    keyPoints: [{ text: "Point", citationIds: ["citation-1"] }],
    conflicts: [{ conflictId: "conflict-1", type: "VALUE_CONFLICT" }],
    citations: [{ citationId: "citation-1", locator: { path: "/fichier", line: 2 } }],
    evidence: [{ content: "PREUVE_BRUTE_INTERDITE" }], confidence: "medium",
  });
  assert.equal(rendered.answer, "Conclusion vérifiée");
  assert.equal(rendered.conflicts.length, 1);
  assert.equal(Object.hasOwn(rendered, "evidence"), false);
  assert.doesNotMatch(JSON.stringify(rendered), /PREUVE_BRUTE_INTERDITE/);
});
