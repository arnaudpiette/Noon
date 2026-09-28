"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createNoonObservability,
} = require("../services/observability/noon-observability");

function performanceFixture() {
  const samples = [];

  return {
    samples,
    recordOutcome(input) {
      samples.push(structuredClone(input));
      return input;
    },
    snapshot() {
      return {
        performance: [],
        adaptiveEvidence: [],
        historicalLatency: {},
      };
    },
  };
}

test("recordModelCall enregistre une observation structurée sans contenu brut", () => {
  const observability = createNoonObservability();
  const performance = performanceFixture();

  observability.attachModelPerformanceEngine(performance);

  const id = observability.startExecution({
    executionId: "exec-performance-1",
    channel: "chat",
  });

  observability.recordModelCall(id, {
    provider: "openai",
    model: "gpt-5.6-terra",
    modelTotalMs: 1200,
    usage: {
      inputTokens: 100,
      outputTokens: 50,
    },
    routingMetadata: {
      taskDomain: "DEV",
      requiredQuality: "NORMAL",
    },
    firstPassSuccess: true,
    fallbackUsed: false,
    escalationUsed: false,
    prompt: "INTERDIT",
    response: "INTERDIT",
  });

  assert.equal(performance.samples.length, 1);

  const sample = performance.samples[0];

  assert.equal(sample.taskDomain, "DEV");
  assert.equal(sample.requiredQuality, "NORMAL");
  assert.equal(sample.provider, "openai");
  assert.equal(sample.model, "gpt-5.6-terra");
  assert.equal(sample.success, true);
  assert.equal(sample.latencyMs, 1200);
  assert.equal(sample.inputTokens, 100);
  assert.equal(sample.outputTokens, 50);
  assert.equal(sample.firstPassSuccess, true);
  assert.equal(sample.fallbackUsed, false);
  assert.equal(sample.escalationUsed, false);

  assert.equal("prompt" in sample, false);
  assert.equal("response" in sample, false);
  assert.equal("content" in sample, false);
});

test("un appel modèle en échec produit une observation failure structurée", () => {
  const observability = createNoonObservability();
  const performance = performanceFixture();

  observability.attachModelPerformanceEngine(performance);

  const id = observability.startExecution({
    executionId: "exec-performance-2",
  });

  observability.recordModelCall(id, {
    provider: "google_ai",
    model: "gemini-3.8-flash",
    modelTotalMs: 800,
    status: "failed",
    failureCategory: "RATE_LIMIT",
    routingMetadata: {
      taskDomain: "RESEARCH",
      requiredQuality: "NORMAL",
    },
    firstPassSuccess: false,
    fallbackUsed: false,
    escalationUsed: false,
  });

  const sample = performance.samples[0];

  assert.equal(sample.success, false);
  assert.equal(sample.failureCategory, "RATE_LIMIT");
  assert.equal(sample.latencyMs, 800);
});

test("une panne du learning store ne casse jamais l'observabilité", () => {
  const observability = createNoonObservability();

  observability.attachModelPerformanceEngine({
    recordOutcome() {
      throw new Error("store unavailable");
    },
    snapshot() {
      return {};
    },
  });

  const id = observability.startExecution({
    executionId: "exec-performance-3",
  });

  assert.doesNotThrow(() => {
    observability.recordModelCall(id, {
      provider: "openai",
      model: "gpt-5.6-luna",
      modelTotalMs: 100,
      routingMetadata: {
        taskDomain: "GENERAL",
        requiredQuality: "LOW",
      },
    });
  });

  const trace = observability.getTrace(id);

  assert.equal(trace.modelCalls.length, 1);
  assert.equal(trace.modelCalls[0].model, "gpt-5.6-luna");
});

test("un moteur invalide ne peut pas être attaché", () => {
  const observability = createNoonObservability();

  assert.throws(
    () => observability.attachModelPerformanceEngine({}),
    /ModelPerformanceEngine invalide/
  );
});
