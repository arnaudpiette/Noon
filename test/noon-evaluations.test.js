"use strict";

// Exécute les scénarios conversationnels de non-régression de l’intelligence Noon.

const test = require("node:test");
const assert = require("node:assert/strict");
const { NOON_EVALUATION_CASES } = require("../lib/noon-evaluations");
const { selectModelRoute } = require("../lib/noon-intelligence");

test("conserve les vingt scénarios conversationnels reproductibles", () => {
  assert.equal(NOON_EVALUATION_CASES.length, 20);
  assert.equal(new Set(NOON_EVALUATION_CASES.map(({ id }) => id)).size, 20);
  assert.equal(NOON_EVALUATION_CASES.filter(({ voice }) => voice).length, 5);
});

test("les scénarios Luna, Terra et Sol suivent le routeur budgétaire", () => {
  for (const scenario of NOON_EVALUATION_CASES) {
    if (["interrupted", "device-change", "reconnecting"].includes(scenario.expectedState)) continue;
    const route = selectModelRoute({
      question: scenario.question,
      budgetMode: scenario.budgetMode || "NORMAL",
    });
    assert.equal(route.model, `gpt-5.6-${scenario.expectedTier}`, scenario.id);
  }
});
