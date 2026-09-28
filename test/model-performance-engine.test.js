"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  aggregateGroup,
  confidenceFor,
  createModelPerformanceEngine,
  median,
} = require("../services/learning/model-performance-engine");

function repositoryFixture(initial = []) {
  const samples = structuredClone(initial);

  return {
    record(input) {
      const value = {
        id: input.id || `sample-${samples.length + 1}`,
        taskDomain: input.taskDomain || "GENERAL",
        requiredQuality: input.requiredQuality || "NORMAL",
        provider: input.provider,
        model: input.model,
        success:
          typeof input.success === "boolean" ? input.success : null,
        failureCategory: input.failureCategory || null,
        latencyMs: input.latencyMs ?? null,
        inputTokens: input.inputTokens ?? null,
        outputTokens: input.outputTokens ?? null,
        actualCost: input.actualCost ?? null,
        firstPassSuccess:
          typeof input.firstPassSuccess === "boolean"
            ? input.firstPassSuccess
            : null,
        fallbackUsed: input.fallbackUsed === true,
        escalationUsed: input.escalationUsed === true,
        createdAt: input.createdAt || new Date().toISOString(),
      };
      samples.push(value);
      return value;
    },

    list(filters = {}) {
      return samples.filter(
        (item) =>
          (!filters.taskDomain || item.taskDomain === filters.taskDomain) &&
          (!filters.requiredQuality ||
            item.requiredQuality === filters.requiredQuality) &&
          (!filters.provider || item.provider === filters.provider) &&
          (!filters.model || item.model === filters.model) &&
          (!filters.since || item.createdAt >= filters.since)
      );
    },
  };
}

function sample(overrides = {}) {
  return {
    taskDomain: "DEV",
    requiredQuality: "NORMAL",
    provider: "openai",
    model: "gpt-5.6-terra",
    success: true,
    latencyMs: 1000,
    inputTokens: 100,
    outputTokens: 50,
    actualCost: 0.02,
    firstPassSuccess: true,
    fallbackUsed: false,
    escalationUsed: false,
    createdAt: "2026-09-28T08:00:00.000Z",
    ...overrides,
  };
}

test("la médiane résiste à un outlier important", () => {
  assert.equal(median([100, 110, 120, 130, 5000]), 120);
});

test("la confiance reste insuffisante avant cinq observations", () => {
  assert.equal(confidenceFor(0), "insufficient");
  assert.equal(confidenceFor(4), "insufficient");
  assert.equal(confidenceFor(5), "low");
  assert.equal(confidenceFor(8), "medium");
  assert.equal(confidenceFor(20), "high");
});

test("agrège succès latence coût fallback et échecs sans contenu brut", () => {
  const aggregate = aggregateGroup([
    sample({ latencyMs: 800, actualCost: 0.01 }),
    sample({ latencyMs: 1000, actualCost: 0.02 }),
    sample({
      success: false,
      firstPassSuccess: false,
      latencyMs: 1200,
      actualCost: 0.03,
      failureCategory: "QUALITY_FAILURE",
      fallbackUsed: true,
    }),
    sample({ latencyMs: 1400, actualCost: 0.04 }),
    sample({ latencyMs: 9000, actualCost: 1 }),
  ]);

  assert.equal(aggregate.sampleCount, 5);
  assert.equal(aggregate.successRate, 0.8);
  assert.equal(aggregate.firstPassSuccessRate, 0.8);
  assert.equal(aggregate.medianLatencyMs, 1200);
  assert.equal(aggregate.medianActualCost, 0.03);
  assert.equal(aggregate.fallbackRate, 0.2);
  assert.equal(aggregate.failures.QUALITY_FAILURE.count, 1);
  assert.equal(aggregate.confidence, "low");

  assert.equal("prompt" in aggregate, false);
  assert.equal("content" in aggregate, false);
});

test("les succès inconnus ne dégradent pas artificiellement le taux", () => {
  const aggregate = aggregateGroup([
    sample({ success: true }),
    sample({ success: true }),
    sample({ success: null }),
  ]);

  assert.equal(aggregate.sampleCount, 3);
  assert.equal(aggregate.successSampleCount, 2);
  assert.equal(aggregate.successRate, 1);
});

test("snapshot sépare domaine qualité provider et modèle", () => {
  const repository = repositoryFixture([
    ...Array.from({ length: 5 }, (_, index) =>
      sample({
        latencyMs: 500 + index * 10,
      })
    ),
    ...Array.from({ length: 6 }, (_, index) =>
      sample({
        taskDomain: "RESEARCH",
        provider: "google_ai",
        model: "gemini-3.8-flash",
        latencyMs: 300 + index * 10,
        actualCost: 0.005,
      })
    ),
  ]);

  const engine = createModelPerformanceEngine({ repository });
  const snapshot = engine.snapshot();

  assert.equal(snapshot.totalSamples, 11);
  assert.equal(snapshot.performance.length, 2);
  assert.equal(snapshot.adaptiveEvidence.length, 2);
  assert.equal(snapshot.historicalLatency["gpt-5.6-terra"], 520);
  assert.equal(snapshot.historicalLatency["gemini-3.8-flash"], 325);
});

test("moins de cinq observations ne produisent aucun signal adaptatif", () => {
  const repository = repositoryFixture([
    sample(),
    sample({ latencyMs: 1100 }),
    sample({ latencyMs: 1200 }),
    sample({ latencyMs: 1300 }),
  ]);

  const engine = createModelPerformanceEngine({ repository });
  const snapshot = engine.snapshot({
    taskDomain: "DEV",
    requiredQuality: "NORMAL",
  });

  assert.equal(snapshot.performance.length, 1);
  assert.equal(snapshot.performance[0].evidenceStatus, "insufficient_evidence");
  assert.deepEqual(snapshot.adaptiveEvidence, []);
  assert.deepEqual(snapshot.historicalLatency, {});
});

test("recordOutcome persiste uniquement l'observation structurée fournie", () => {
  const repository = repositoryFixture();
  const engine = createModelPerformanceEngine({ repository });

  const result = engine.recordOutcome(
    sample({
      provider: "openai",
      model: "gpt-5.6-sol",
    })
  );

  assert.equal(result.model, "gpt-5.6-sol");
  assert.equal(repository.list().length, 1);
  assert.equal("prompt" in result, false);
  assert.equal("response" in result, false);
});

test("minimumSamples ne peut jamais être abaissé sous cinq", () => {
  assert.throws(
    () =>
      createModelPerformanceEngine({
        repository: repositoryFixture(),
        minimumSamples: 2,
      }),
    /entier >= 5/
  );
});
