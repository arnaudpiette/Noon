"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { selectModelRoute } = require("../lib/noon-intelligence");
const { FEATURE_FLAGS } = require("../services/config/feature-flag-registry");

function route(overrides = {}) {
  return selectModelRoute({
    question: "Fixture synthétique publique",
    multiProviderRouting: true,
    costAwareRouting: true,
    eligibleProviders: ["openai", "google_ai"],
    providerRollouts: { google_ai: "LIMITED" },
    estimatedUsage: { inputTokens: 2_000, outputTokens: 500 },
    requiredQuality: "NORMAL",
    requiredCapabilities: ["TEXT"],
    ...overrides,
  });
}

test("minimum sufficient intelligence choisit le moins cher qui atteint la qualité", () => {
  assert.equal(route({ requiredQuality: "LOW" }).model, "gpt-5.6-luna");
  const normal = route();
  assert.equal(normal.model, "gemini-3.8-flash");
  assert.equal(normal.provider, "google_ai");
  assert.ok(normal.reasonCodes.includes("MINIMUM_SUFFICIENT_MODEL"));
  assert.ok(normal.estimatedCost.total > 0);
  assert.equal(route({ requiredQuality: "HIGH" }).model, "gpt-5.6-sol");
});

test("la complexité élève la qualité minimale sans imposer un modèle par nom", () => {
  const selected = route({ requiredQuality: undefined, question: "Analyse en profondeur une architecture logicielle complexe avec plusieurs contraintes" });
  assert.equal(selected.requiredQuality, "HIGH");
  assert.equal(selected.model, "gpt-5.6-sol");
});

test("capabilities puis privacy filtrent avant le coût", () => {
  const openaiOnly = route({ eligibleProviders: ["openai"] });
  assert.equal(openaiOnly.provider, "openai");
  assert.equal(openaiOnly.model, "gpt-5.6-terra");
  assert.ok(openaiOnly.excludedCandidates.some((candidate) => candidate.provider === "google_ai" && candidate.excludedReasonCodes.includes("PRIVACY_RESTRICTED")));
  assert.throws(() => route({ requiredCapabilities: ["AUDIO_GENERATION"] }), (error) => error.code === "MODEL_CAPABILITY_UNAVAILABLE" || error.code === "NO_SUFFICIENT_MODEL");
});

test("local-only sans provider distant échoue honnêtement", () => {
  assert.throws(() => route({ eligibleProviders: [] }), (error) => error.code === "NO_SUFFICIENT_MODEL");
});

test("le plafond exclut les modèles trop chers sans dégrader la qualité", () => {
  const gemini = route({ maxEstimatedCost: 0.01 });
  assert.equal(gemini.model, "gemini-3.8-flash");
  assert.throws(() => route({ requiredQuality: "HIGH", maxEstimatedCost: 0.001 }), (error) => error.code === "NO_SUFFICIENT_MODEL");
});

test("Gemini SHADOW ne participe jamais à une sélection active", () => {
  const selected = route({ providerRollouts: { google_ai: "SHADOW" } });
  assert.equal(selected.provider, "openai");
});

test("une cible de latence exclut seulement les candidats historiquement trop lents", () => {
  const selected = route({ latencyTarget: 500, historicalLatency: { "gemini-3.8-flash": 900, "gpt-5.6-terra": 300 } });
  assert.equal(selected.model, "gpt-5.6-terra");
  assert.ok(selected.excludedCandidates.find((item) => item.model === "gemini-3.8-flash").excludedReasonCodes.includes("LATENCY_LIMIT"));
});

test("second opinion reste exceptionnelle, indépendante du routage simple", () => {
  assert.equal(route({ secondOpinion: true }).secondOpinionEligible, false);
  const eligible = route({ secondOpinion: true, highUncertainty: true });
  assert.equal(eligible.secondOpinionEligible, true);
  assert.notEqual(eligible.secondOpinionCandidate.provider, eligible.provider);
});

test("fallback cross-provider n'est préparé que si explicitement autorisé", () => {
  assert.equal(route().fallbackEligible, false);
  const fallback = route({ crossProviderFallback: true });
  assert.equal(fallback.fallbackEligible, true);
  assert.ok(fallback.fallbackCandidates.every((candidate) => candidate.provider !== fallback.provider));
});

test("l'escalade qualité exige une preuve et choisit uniquement un palier supérieur", () => {
  const sameTier = route({ eligibleProviders: ["openai"], qualityEscalation: true, qualityFailureEvidence: false, escalationFromModel: "gpt-5.6-terra" });
  assert.equal(sameTier.model, "gpt-5.6-terra");
  const escalated = route({ eligibleProviders: ["openai"], qualityEscalation: true, qualityFailureEvidence: true, escalationFromModel: "gpt-5.6-terra" });
  assert.equal(escalated.model, "gpt-5.6-sol");
  assert.ok(escalated.routingReasonCodes.includes("QUALITY_ESCALATION"));
});

test("une escalade trop chère échoue sans dégrader la qualité", () => {
  assert.throws(() => route({ eligibleProviders: ["openai"], qualityEscalation: true, qualityFailureEvidence: true, escalationFromModel: "gpt-5.6-terra", maxEstimatedCost: 0.001 }), (error) => error.code === "ESCALATION_BLOCKED_BUDGET");
});

test("les cinq flags V2.4 sont prudents et réversibles", () => {
  const ids = ["router.multi-provider", "router.cost-aware", "router.gemini-limited", "router.second-opinion", "router.cross-provider-fallback"];
  for (const id of ids) {
    const flag = FEATURE_FLAGS.find((item) => item.flagId === id);
    assert.ok(flag);
    assert.equal(flag.defaultMode, "OFF");
    assert.equal(flag.rollbackSafe, true);
  }
});

test("les flags DEV V2.7 sont OFF et réversibles par défaut", () => {
  for (const id of ["dev.auto-routing", "dev.budget-enforcement", "dev.quality-escalation"]) {
    const flag = FEATURE_FLAGS.find((item) => item.flagId === id);
    assert.equal(flag.defaultMode, "OFF");
    assert.equal(flag.rollbackSafe, true);
  }
});
