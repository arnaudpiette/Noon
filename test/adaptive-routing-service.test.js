"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createAdaptiveRoutingService,
} = require("../services/learning/adaptive-routing-service");

function performance(snapshot) {
  return {
    snapshot() {
      return structuredClone(snapshot);
    },
  };
}

test("aucune preuve suffisante ne produit de route adaptative", () => {
  let calls = 0;

  const service = createAdaptiveRoutingService({
    performanceEngine: performance({
      totalSamples: 4,
      adaptiveEvidence: [],
      historicalLatency: {},
    }),
    selectModelRoute() {
      calls += 1;
      return { model: "gpt-5.6-luna" };
    },
  });

  const result = service.evaluate(
    {
      taskDomain: "GENERAL",
      requiredQuality: "NORMAL",
    },
    { model: "gpt-5.6-terra" }
  );

  assert.equal(result.status, "INSUFFICIENT_EVIDENCE");
  assert.equal(result.shadowRoute, null);
  assert.equal(calls, 0);
});

test("les latences apprises sont injectées uniquement dans la route shadow", () => {
  let received = null;

  const service = createAdaptiveRoutingService({
    performanceEngine: performance({
      totalSamples: 12,
      adaptiveEvidence: [
        {
          taskDomain: "GENERAL",
          requiredQuality: "NORMAL",
          model: "gpt-5.6-terra",
          sampleCount: 12,
          confidence: "medium",
        },
      ],
      historicalLatency: {
        "gpt-5.6-terra": 420,
      },
    }),
    selectModelRoute(input) {
      received = input;
      return {
        model: "gpt-5.6-terra",
        provider: "openai",
      };
    },
  });

  const original = {
    taskDomain: "GENERAL",
    requiredQuality: "NORMAL",
  };

  const active = {
    model: "gpt-5.6-terra",
    provider: "openai",
  };

  const result = service.evaluate(original, active);

  assert.deepEqual(received.historicalLatency, {
    "gpt-5.6-terra": 420,
  });

  assert.equal(original.historicalLatency, undefined);
  assert.equal(result.shadowRoute.model, "gpt-5.6-terra");
  assert.equal(result.status, "MATCH");
});

test("une route shadow différente n'altère jamais la route active", () => {
  const active = Object.freeze({
    model: "gpt-5.6-terra",
    provider: "openai",
  });

  const service = createAdaptiveRoutingService({
    performanceEngine: performance({
      totalSamples: 20,
      adaptiveEvidence: [
        {
          taskDomain: "GENERAL",
          requiredQuality: "NORMAL",
          model: "gpt-5.6-luna",
          sampleCount: 20,
          confidence: "high",
        },
      ],
      historicalLatency: {
        "gpt-5.6-luna": 200,
      },
    }),
    selectModelRoute() {
      return {
        model: "gpt-5.6-luna",
        provider: "openai",
      };
    },
  });

  const result = service.evaluate({}, active);

  assert.equal(result.status, "MISMATCH");
  assert.equal(result.activeRoute.model, "gpt-5.6-terra");
  assert.equal(result.shadowRoute.model, "gpt-5.6-luna");
  assert.equal(active.model, "gpt-5.6-terra");
});

test("le ShadowComparator existant est réutilisé", () => {
  let compared = null;

  const service = createAdaptiveRoutingService({
    performanceEngine: performance({
      totalSamples: 8,
      adaptiveEvidence: [{
        model: "gpt-5.6-terra",
        sampleCount: 8,
        confidence: "medium",
      }],
      historicalLatency: { "gpt-5.6-terra": 300 },
    }),
    selectModelRoute() {
      return { model: "gpt-5.6-terra" };
    },
    shadowComparator: {
      compare(input) {
        compared = input;
        return {
          status: "MATCH",
          match: true,
        };
      },
    },
  });

  service.evaluate(
    { taskDomain: "GENERAL", requiredQuality: "NORMAL" },
    { model: "gpt-5.6-terra" },
    { flagId: "router.adaptive-learning" }
  );

  assert.equal(compared.flagId, "router.adaptive-learning");
  assert.equal(compared.legacyResult.model, "gpt-5.6-terra");
  assert.equal(compared.shadowResult.model, "gpt-5.6-terra");
});

test("le service refuse des dépendances invalides", () => {
  assert.throws(
    () =>
      createAdaptiveRoutingService({
        performanceEngine: {},
        selectModelRoute() {},
      }),
    /ModelPerformanceEngine requis/
  );

  assert.throws(
    () =>
      createAdaptiveRoutingService({
        performanceEngine: { snapshot() {} },
      }),
    /ModelRouter requis/
  );
});

test("le scoring valorise fiabilité, premier passage et confiance", () => {
  const {
    adaptiveScore,
  } = require("../services/learning/adaptive-routing-service");

  const reliable = adaptiveScore({
    sampleCount: 20,
    confidence: "high",
    successRate: 0.96,
    firstPassSuccessRate: 0.9,
    qualityFailureRate: 0.02,
    fallbackRate: 0.05,
    escalationRate: 0.03,
  });

  const weak = adaptiveScore({
    sampleCount: 20,
    confidence: "high",
    successRate: 0.75,
    firstPassSuccessRate: 0.55,
    qualityFailureRate: 0.2,
    fallbackRate: 0.3,
    escalationRate: 0.25,
  });

  assert.ok(reliable > weak);
});

test("cinq observations low confidence restent beaucoup moins autoritaires que vingt", () => {
  const {
    adaptiveScore,
  } = require("../services/learning/adaptive-routing-service");

  const low = adaptiveScore({
    sampleCount: 5,
    confidence: "low",
    successRate: 1,
    firstPassSuccessRate: 1,
  });

  const high = adaptiveScore({
    sampleCount: 20,
    confidence: "high",
    successRate: 1,
    firstPassSuccessRate: 1,
  });

  assert.ok(low < high);
});

test("le shadow adaptatif peut préférer un candidat historiquement plus fiable", () => {
  const service = createAdaptiveRoutingService({
    performanceEngine: performance({
      totalSamples: 40,
      adaptiveEvidence: [
        {
          taskDomain: "GENERAL",
          requiredQuality: "NORMAL",
          provider: "openai",
          model: "gpt-5.6-terra",
          sampleCount: 20,
          confidence: "high",
          successRate: 0.7,
          firstPassSuccessRate: 0.5,
          qualityFailureRate: 0.2,
          fallbackRate: 0.25,
          escalationRate: 0.2,
        },
        {
          taskDomain: "GENERAL",
          requiredQuality: "NORMAL",
          provider: "google_ai",
          model: "gemini-3.8-flash",
          sampleCount: 20,
          confidence: "high",
          successRate: 0.98,
          firstPassSuccessRate: 0.95,
          qualityFailureRate: 0.01,
          fallbackRate: 0.02,
          escalationRate: 0.01,
        },
      ],
      historicalLatency: {
        "gpt-5.6-terra": 500,
        "gemini-3.8-flash": 450,
      },
    }),
    selectModelRoute(input) {
      const scores = input.adaptiveCandidateScores;
      return scores["gemini-3.8-flash"].score >
        scores["gpt-5.6-terra"].score
        ? { model: "gemini-3.8-flash", provider: "google_ai" }
        : { model: "gpt-5.6-terra", provider: "openai" };
    },
  });

  const active = {
    model: "gpt-5.6-terra",
    provider: "openai",
  };

  const result = service.evaluate(
    {
      taskDomain: "GENERAL",
      requiredQuality: "NORMAL",
      eligibleProviders: ["openai", "google_ai"],
      providerRollouts: { google_ai: "LIMITED" },
    },
    active
  );

  assert.equal(result.activeRoute.model, "gpt-5.6-terra");
  assert.equal(result.shadowRoute.model, "gemini-3.8-flash");
  assert.equal(result.status, "MISMATCH");
});

test("le snapshot adaptatif n'utilise que les trente derniers jours", () => {
  let filters = null;

  const service = createAdaptiveRoutingService({
    performanceEngine: {
      snapshot(input) {
        filters = input;
        return {
          totalSamples: 0,
          adaptiveEvidence: [],
          historicalLatency: {},
        };
      },
    },
    selectModelRoute() {
      throw new Error("ne doit pas être appelé");
    },
    now: () => Date.parse("2026-09-28T10:00:00.000Z"),
  });

  service.evaluate({
    taskDomain: "DEV",
    requiredQuality: "NORMAL",
  });

  assert.equal(filters.since, "2026-08-29T10:00:00.000Z");
});

test("une preuve low confidence de cinq samples ne peut plus proposer de bascule", () => {
  let routeCalls = 0;

  const service = createAdaptiveRoutingService({
    performanceEngine: performance({
      totalSamples: 5,
      adaptiveEvidence: [
        {
          taskDomain: "GENERAL",
          requiredQuality: "NORMAL",
          provider: "openai",
          model: "gpt-5.6-luna",
          sampleCount: 5,
          confidence: "low",
          successRate: 1,
          firstPassSuccessRate: 1,
        },
      ],
      historicalLatency: {
        "gpt-5.6-luna": 100,
      },
    }),
    selectModelRoute() {
      routeCalls += 1;
      return { model: "gpt-5.6-luna", provider: "openai" };
    },
  });

  const result = service.evaluate(
    {},
    { model: "gpt-5.6-terra", provider: "openai" }
  );

  assert.equal(result.status, "INSUFFICIENT_STABLE_EVIDENCE");
  assert.equal(result.shadowRoute, null);
  assert.equal(routeCalls, 0);
});

test("une différence adaptative inférieure à cinq points ne provoque aucune bascule shadow", () => {
  const service = createAdaptiveRoutingService({
    performanceEngine: performance({
      totalSamples: 40,
      adaptiveEvidence: [
        {
          model: "gpt-5.6-terra",
          provider: "openai",
          taskDomain: "GENERAL",
          requiredQuality: "NORMAL",
          sampleCount: 20,
          confidence: "high",
          successRate: 0.90,
          firstPassSuccessRate: 0.90,
          qualityFailureRate: 0.05,
          fallbackRate: 0.05,
          escalationRate: 0.05,
        },
        {
          model: "gemini-3.8-flash",
          provider: "google_ai",
          taskDomain: "GENERAL",
          requiredQuality: "NORMAL",
          sampleCount: 20,
          confidence: "high",
          successRate: 0.91,
          firstPassSuccessRate: 0.91,
          qualityFailureRate: 0.04,
          fallbackRate: 0.04,
          escalationRate: 0.04,
        },
      ],
      historicalLatency: {},
    }),
    selectModelRoute(input) {
      return {
        model: "gemini-3.8-flash",
        provider: "google_ai",
        adaptiveCandidateScores: input.adaptiveCandidateScores,
      };
    },
  });

  const active = {
    model: "gpt-5.6-terra",
    provider: "openai",
  };

  const result = service.evaluate(
    {
      eligibleProviders: ["openai", "google_ai"],
      providerRollouts: { google_ai: "LIMITED" },
    },
    active
  );

  assert.equal(result.shadowRoute.model, "gpt-5.6-terra");
  assert.equal(result.suppressedByStabilityMargin, true);
  assert.ok(result.scoreDelta < 5);
});

test("une différence adaptative significative peut proposer une bascule shadow", () => {
  const service = createAdaptiveRoutingService({
    performanceEngine: performance({
      totalSamples: 40,
      adaptiveEvidence: [
        {
          model: "gpt-5.6-terra",
          provider: "openai",
          taskDomain: "GENERAL",
          requiredQuality: "NORMAL",
          sampleCount: 20,
          confidence: "high",
          successRate: 0.65,
          firstPassSuccessRate: 0.50,
          qualityFailureRate: 0.20,
          fallbackRate: 0.20,
          escalationRate: 0.20,
        },
        {
          model: "gemini-3.8-flash",
          provider: "google_ai",
          taskDomain: "GENERAL",
          requiredQuality: "NORMAL",
          sampleCount: 20,
          confidence: "high",
          successRate: 0.98,
          firstPassSuccessRate: 0.96,
          qualityFailureRate: 0.01,
          fallbackRate: 0.01,
          escalationRate: 0.01,
        },
      ],
      historicalLatency: {},
    }),
    selectModelRoute() {
      return {
        model: "gemini-3.8-flash",
        provider: "google_ai",
      };
    },
  });

  const active = {
    model: "gpt-5.6-terra",
    provider: "openai",
  };

  const result = service.evaluate(
    {
      eligibleProviders: ["openai", "google_ai"],
      providerRollouts: { google_ai: "LIMITED" },
    },
    active
  );

  assert.equal(result.shadowRoute.model, "gemini-3.8-flash");
  assert.equal(result.suppressedByStabilityMargin, false);
  assert.ok(result.scoreDelta >= 5);
});

test("les garde-fous adaptatifs ne peuvent pas être configurés sous les minimums sûrs", () => {
  const base = {
    performanceEngine: performance({
      totalSamples: 0,
      adaptiveEvidence: [],
      historicalLatency: {},
    }),
    selectModelRoute() {
      return {};
    },
  };

  assert.throws(
    () =>
      createAdaptiveRoutingService({
        ...base,
        lookbackDays: 0,
      }),
    /lookbackDays/
  );

  assert.throws(
    () =>
      createAdaptiveRoutingService({
        ...base,
        stableMinimumSamples: 5,
      }),
    /entier >= 8/
  );

  assert.throws(
    () =>
      createAdaptiveRoutingService({
        ...base,
        minimumScoreDelta: -1,
      }),
    /minimumScoreDelta/
  );
});
