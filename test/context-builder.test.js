"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createContextBuilder, estimateTokens } = require("../services/context/context-builder");
const { createHardRulesRegistry } = require("../services/rules/hard-rules-registry");
const { PROVIDERS } = require("../services/models/model-registry");
const { createProviderPrivacyPolicy } = require("../services/security/provider-privacy-policy");
const { createCanonicalEntityResolver } = require("../services/context/canonical-entity-resolver");

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
  assert.equal(context.excluded.some((item) => item.sourceId === "local-1" && item.privacyClassification === "LOCAL_ONLY"), true);
});

test("le contrat A1 expose une vue stable, sûre et sans duplication du contexte distant", () => {
  const local = memory("local-contract", "VALEUR_PRIVEE_FICTIVE", { allowedForRemoteModel: false, apiPolicy: "local_only" });
  const { builder } = createFixture(memoryResult({ remoteContext: [memory("remote-contract", "Préférence pertinente")], localOnlyContext: [local] }));
  const context = builder.buildContext({ query: "Question de contrat", maxContextTokens: 1000 });
  for (const field of ["localContext", "remoteModelContext", "sources", "included", "excluded", "budget", "privacy", "cache", "diagnostics"]) assert.ok(Object.hasOwn(context, field), field);
  assert.equal(context.diagnostics.contractVersion, 1);
  assert.notStrictEqual(context.localContext, context.remoteModelContext);
  assert.doesNotMatch(JSON.stringify({ sources: context.sources, diagnostics: context.diagnostics, privacy: context.privacy, cache: context.cache }), /VALEUR_PRIVEE_FICTIVE/);
  assert.equal(context.budget.maximumTokens, 1000);
  assert.equal(context.budget.usedTokens, context.metadata.estimatedTokens);
});

test("le ContextBuilder utilise le resolver canonique sans injecter un projet ambigu", () => {
  const resolver = createCanonicalEntityResolver({ projectProvider: () => [
    { id: "portfolio", name: "Portfolio", aliases: ["portfolio", "site"] },
    { id: "website", name: "Website", aliases: ["site"] },
  ] });
  const calls = [];
  const registry = createHardRulesRegistry();
  const builder = createContextBuilder({
    personalityProvider: () => "Noon", hardRulesRegistry: registry, entityResolver: resolver,
    memoryEngine: { getRelevantContext: (input) => { calls.push(input); return memoryResult(); } },
  });
  const resolved = builder.buildContext({ query: "continue mon portfolio" });
  assert.equal(calls[0].projectId, "portfolio");
  assert.deepEqual(resolved.diagnostics.entityResolution, {
    status: "RESOLVED", type: "PROJECT", entityId: "portfolio", method: "alias_in_query",
    source: "project_registry", confidence: 0.82, candidateCount: 1,
  });
  const ambiguous = builder.buildContext({ query: "continue le site" });
  assert.equal(calls[1].projectId, null);
  assert.equal(ambiguous.diagnostics.entityResolution.status, "AMBIGUOUS");
});

test("le contexte reste local et déterministe lorsque les providers sont indisponibles", () => {
  const { builder } = createFixture(memoryResult({ localOnlyContext: [memory("offline-local", "Contexte local", { allowedForRemoteModel: false, apiPolicy: "local_only" })] }));
  const context = builder.buildContext({ query: "Fonctionne hors ligne", provider: "down" });
  assert.deepEqual(context.localContext.localOnly.map((item) => item.id), ["offline-local"]);
  assert.deepEqual(context.remoteModelContext.userContext.memories, []);
  assert.equal(context.diagnostics.contractVersion, 1);
});

test("A3 ajoute les sources autorisées au contexte local sans copier un item privé au modèle", async () => {
  const registry = createHardRulesRegistry();
  const builder = createContextBuilder({
    personalityProvider: () => "Noon", hardRulesRegistry: registry,
    memoryEngine: { getRelevantContext: () => memoryResult() },
    authorizedContextSources: {
      async collect() {
        return {
          items: [
            { sourceType: "notes", sourceId: "private-note", relevance: 1, privacyClass: "PRIVATE", localOnly: true, payload: { excerpt: "Note privée" } },
            { sourceType: "execution", sourceId: "summary", relevance: 0.9, privacyClass: "PRIVATE", allowedForRemoteModel: true, payload: { pendingActions: 2 } },
          ],
          diagnostics: { notes: { selected: true, status: "AVAILABLE", count: 1, truncated: false, durationMs: 2 }, execution: { selected: true, status: "AVAILABLE", count: 1, truncated: false, durationMs: 1 } },
        };
      },
    },
  });
  const context = await builder.buildContextAsync({ query: "où en sont mes actions ?", maxContextTokens: 1000 });
  assert.equal(context.localContext.authorizedSources.length, 2);
  assert.deepEqual(context.remoteModelContext.userContext.authorizedSources.map((item) => item.sourceType), ["execution"]);
  assert.equal(context.diagnostics.sourceDiagnostics.notes.status, "AVAILABLE");
  assert.doesNotMatch(JSON.stringify(context.diagnostics), /Note privée/);
});

test("A3 respecte le budget A1 et conserve un contexte utilisable quand une source échoue", async () => {
  const { builder } = createFixture();
  const guarded = createContextBuilder({
    personalityProvider: () => "Noon", hardRulesRegistry: createHardRulesRegistry(),
    memoryEngine: { getRelevantContext: () => memoryResult() },
    authorizedContextSources: { async collect() { return {
      items: [{ sourceType: "gmail", sourceId: "mail", relevance: 1, localOnly: true, payload: { excerpt: "x".repeat(10_000) } }],
      diagnostics: { gmail: { selected: true, status: "ERROR", count: 0, truncated: false, durationMs: 1 } },
    }; } },
  });
  assert.ok(builder.buildContext({ query: "bonjour" }).remoteModelContext);
  const context = await guarded.buildContextAsync({ query: "email", maxContextTokens: 256 });
  assert.equal(context.localContext.authorizedSources.length, 0);
  assert.equal(context.budget.usedTokens, context.metadata.estimatedTokens);
  assert.equal(context.diagnostics.sourceDiagnostics.gmail.status, "ERROR");
});

test("A3 projette un timeout sûr avec sa source sans exposer les diagnostics bruts", async () => {
  const builder = createContextBuilder({
    personalityProvider: () => "Noon", hardRulesRegistry: createHardRulesRegistry(),
    memoryEngine: { getRelevantContext: () => memoryResult() },
    authorizedContextSources: { async collect() { return {
      items: [{ sourceType: "reminders", sourceId: "r1", localOnly: true, payload: { summary: "Rappel fictif" } }],
      diagnostics: {
        notes: { selected: true, status: "ERROR", reasonCode: "CONTEXT_SOURCE_TIMEOUT", systemPermission: "TCC_UNVERIFIED", count: 0, truncated: false, durationMs: 5, message: "secret fournisseur", stack: "trace privée" },
        reminders: { selected: true, status: "AVAILABLE", reasonCode: null, systemPermission: "GRANTED", count: 1, truncated: false, durationMs: 1, providerPayload: "secret" },
      },
    }; } },
  });
  const context = await builder.buildContextAsync({ query: "notes et tâche" });
  assert.equal(context.diagnostics.sourceDiagnostics.notes.reasonCode, "CONTEXT_SOURCE_TIMEOUT");
  assert.equal(context.diagnostics.sourceDiagnostics.notes.status, "ERROR");
  assert.equal(context.diagnostics.sourceDiagnostics.notes.durationMs, 5);
  assert.equal(context.diagnostics.sourceDiagnostics.notes.systemPermission, "TCC_UNVERIFIED");
  assert.equal(context.diagnostics.sourceDiagnostics.reminders.systemPermission, null);
  assert.equal(context.diagnostics.sourceDiagnostics.reminders.status, "AVAILABLE");
  assert.equal(context.localContext.authorizedSources.length, 1);
  assert.deepEqual(Object.keys(context.diagnostics.sourceDiagnostics.notes).sort(), ["count", "durationMs", "reasonCode", "selected", "status", "systemPermission", "truncated"]);
  assert.doesNotMatch(JSON.stringify(context.diagnostics), /secret fournisseur|trace privée|providerPayload/);
});

test("le cache est réutilisé puis invalidé par mémoire, projet et permission", () => {
  let permissions = [{ capability: "READ" }];
  let memoryCalls = 0;
  const registry = createHardRulesRegistry();
  const builder = createContextBuilder({
    personalityProvider: () => "Noon", hardRulesRegistry: registry,
    memoryEngine: { getRelevantContext: () => { memoryCalls += 1; return memoryResult(); } },
    permissionsProvider: () => permissions,
  });
  builder.buildContext({ query: "Même requête", projectId: "p1" });
  const cached = builder.buildContext({ query: "Même requête", projectId: "p1" });
  assert.ok(cached.cache.hits > 0);
  assert.equal(memoryCalls, 1);
  builder.invalidateMemory(); builder.buildContext({ query: "Même requête", projectId: "p1" });
  assert.equal(memoryCalls, 2);
  builder.invalidateProject("p1"); builder.buildContext({ query: "Même requête", projectId: "p1" });
  assert.equal(memoryCalls, 3);
  permissions = [];
  const revoked = builder.buildContext({ query: "Même requête", projectId: "p1" });
  assert.deepEqual(revoked.runtime.permissions, []);
  builder.invalidatePermissions();
  assert.equal(builder.cacheInspection().some((item) => item.segment === "dynamic"), false);
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
