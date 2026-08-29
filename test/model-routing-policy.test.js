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

test("le corpus couvre quarante routes reproductibles", () => {
  assert.equal(NOON_ROUTING_CORPUS.length, 40);
  assert.equal(new Set(NOON_ROUTING_CORPUS.map(({ id }) => id)).size, 40);
});

test("le routeur respecte les routes attendues sur tout le corpus", () => {
  for (const scenario of NOON_ROUTING_CORPUS) {
    const route = selectModelRoute(scenario);
    assert.equal(route.model, `gpt-5.6-${scenario.expectedTier}`, `${scenario.id}: score=${route.score} ${route.reasonCodes.join(",")}`);
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
  assert.equal(comparison.length, 40);
  assert.ok(comparison.some((item) => item.id === "audit-word" && item.previousModel.endsWith("sol") && item.currentModel.endsWith("terra")));
});

test("les fallbacks dégradent Sol vers Terra puis Luna", () => {
  assert.deepEqual(modelFallbacks("gpt-5.6-sol"), ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]);
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
