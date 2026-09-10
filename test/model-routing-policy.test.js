"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { NOON_ROUTING_CORPUS } = require("../lib/noon-routing-corpus");
const {
  ROUTING_POLICY_VERSION,
  compareRoutingPolicies,
  modelFallbacks,
  selectModelRoute,
} = require("../lib/noon-intelligence");

test("le corpus couvre quarante-trois routes reproductibles", () => {
  assert.equal(NOON_ROUTING_CORPUS.length, 43);
  assert.equal(new Set(NOON_ROUTING_CORPUS.map(({ id }) => id)).size, 43);
});

test("le routeur respecte les routes attendues sur tout le corpus", () => {
  for (const scenario of NOON_ROUTING_CORPUS) {
    const route = selectModelRoute(scenario);
    const family = scenario.modelFamily || "gpt-5.6";
    assert.equal(route.model, `${family}-${scenario.expectedTier}`, `${scenario.id}: score=${route.score} ${route.reasonCodes.join(",")}`);
    assert.equal(route.routingPolicyVersion, ROUTING_POLICY_VERSION);
    assert.ok(Number.isFinite(route.routingMs));
    assert.ok(Array.isArray(route.reasonCodes) && route.reasonCodes.length > 0);
  }
});

test("un mot complexe isolé ne déclenche plus Sol", () => {
  assert.equal(selectModelRoute({ question: "Fais un audit de cette phrase" }).model, "gpt-5.6-terra");
  assert.equal(selectModelRoute({ question: "Définis le mot architecture" }).model, "gpt-5.6-terra");
});

test("Sol exige plusieurs signaux ou une demande maximale explicite", () => {
  const complex = selectModelRoute({ question: "Analyse en profondeur l'architecture logicielle et ses régressions" });
  assert.equal(complex.model, "gpt-5.6-sol");
  assert.ok(complex.reasonCodes.includes("multi_signal_complexity"));
  assert.equal(selectModelRoute({ question: "Propose une identité", profile: "maximum" }).model, "gpt-5.6-sol");
});

test("le shadow test décrit les changements sans activer l'ancienne politique", () => {
  const comparison = compareRoutingPolicies(NOON_ROUTING_CORPUS);
  assert.equal(comparison.length, 43);
  assert.ok(comparison.some((item) => item.id === "audit-word" && item.previousModel.endsWith("sol") && item.currentModel.endsWith("terra")));
});

test("les fallbacks dégradent Sol vers Terra puis Luna", () => {
  assert.deepEqual(modelFallbacks("gpt-5.6-sol"), ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]);
});

test("Astra reste exceptionnel, explicable et distinct de Sol", () => {
  const boundary = selectModelRoute({ question: "Analyse en profondeur ces quatre fichiers et trouve la régression qui fait planter ce composant", attachments: 4, tools: { expectedCount: 2 }, astraMode: "ON", astraAvailability: "AVAILABLE" });
  assert.equal(boundary.model, "gpt-5.6-sol");
  const route = selectModelRoute({ question: "Audite tout ce repo, identifie une race condition traversant scheduler, jobs, DB et Electron, puis propose un correctif minimisant les régressions", context: { estimatedTokens: 30000, sourceCount: 8 }, tools: { expectedCount: 4 }, risk: { level: "high" }, output: { expectedLength: "long" }, astraMode: "ON", astraAvailability: "AVAILABLE" });
  assert.equal(route.model, "gpt-6-astra");
  assert.equal(route.effort, "high");
  assert.ok(route.reasonCodes.includes("COMPLEX_CODEBASE_ANALYSIS"));
  assert.deepEqual(modelFallbacks("gpt-6-astra"), ["gpt-6-astra", "gpt-5.6-sol"]);
});

test("Astra indisponible, rate limited, local-only ou sous contrainte budget retombe sur Sol ou Luna", () => {
  const exceptional = { question: "Audite tout ce repo et analyse une race condition entre plusieurs systèmes", context: { estimatedTokens: 30000, sourceCount: 8 }, tools: { expectedCount: 4 }, risk: { level: "high" }, astraMode: "ON" };
  assert.equal(selectModelRoute({ ...exceptional, astraAvailability: "UNAVAILABLE" }).model, "gpt-5.6-sol");
  assert.equal(selectModelRoute({ ...exceptional, astraAvailability: "RATE_LIMITED" }).model, "gpt-5.6-sol");
  assert.equal(selectModelRoute({ ...exceptional, astraAvailability: "AVAILABLE", budgetMode: "ECO" }).model, "gpt-5.6-luna");
  assert.notEqual(selectModelRoute({ ...exceptional, astraAvailability: "AVAILABLE", networkState: "LOCAL_ONLY" }).model, "gpt-6-astra");
});

test("une demande Astra explicite respecte policy et disponibilité sans accorder d'autorité", () => {
  const selected = selectModelRoute({ question: "Utilise Astra pour comparer ces architectures", astraMode: "ON", astraAvailability: "AVAILABLE" });
  assert.equal(selected.model, "gpt-6-astra");
  assert.ok(selected.reasonCodes.includes("EXPLICIT_ASTRA_REQUEST"));
  const fallback = selectModelRoute({ question: "Utilise Astra pour comparer ces architectures", astraMode: "ON", astraAvailability: "NOT_AUTHORIZED" });
  assert.equal(fallback.model, "gpt-5.6-sol");
  assert.ok(fallback.reasonCodes.includes("ASTRA_NOT_AUTHORIZED"));
});

test("le mode shadow calcule Astra sans le sélectionner", () => {
  const route = selectModelRoute({ question: "Compare 30 sources contradictoires et produis un rapport professionnel exhaustif", context: { estimatedTokens: 50000, sourceCount: 30 }, tools: { expectedCount: 3 }, artifact: { complexity: "high" }, astraMode: "SHADOW", astraAvailability: "AVAILABLE" });
  assert.equal(route.model, "gpt-5.6-sol");
  assert.equal(route.astra.wouldSelectAstra, true);
  assert.equal(route.astra.selected, false);
});

test("le routeur expose et contrôle les capacités multimodales requises", () => {
  const route = selectModelRoute({
    question: "Analyse cette capture",
    requiredCapabilities: ["VISION", "STRUCTURED_OUTPUT"],
  });
  assert.deepEqual(route.requiredCapabilities, ["VISION", "STRUCTURED_OUTPUT"]);
  assert.throws(
    () => selectModelRoute({ question: "Analyse", requiredCapabilities: ["VIDEO_UNDERSTANDING"] }),
    (error) => error.code === "MODEL_CAPABILITY_UNAVAILABLE"
  );
});
