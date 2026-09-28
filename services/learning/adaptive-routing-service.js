"use strict";

const CONFIDENCE_WEIGHT = Object.freeze({
  insufficient: 0,
  low: 0.35,
  medium: 0.7,
  high: 1,
});

const DEFAULT_LOOKBACK_DAYS = 30;
const DEFAULT_STABLE_MINIMUM_SAMPLES = 8;
const DEFAULT_MINIMUM_SCORE_DELTA = 5;
const STABLE_CONFIDENCE = new Set(["medium", "high"]);

function boundedRate(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(0, Math.min(1, number))
    : fallback;
}

function adaptiveScore(evidence = {}) {
  const confidenceWeight =
    CONFIDENCE_WEIGHT[evidence.confidence] ?? 0;

  if (!confidenceWeight || Number(evidence.sampleCount) < 5) {
    return 0;
  }

  const success = boundedRate(evidence.successRate, 0.5);
  const firstPass = boundedRate(evidence.firstPassSuccessRate, success);
  const qualityReliability =
    1 - boundedRate(evidence.qualityFailureRate, 0);
  const fallbackReliability =
    1 - boundedRate(evidence.fallbackRate, 0);
  const escalationReliability =
    1 - boundedRate(evidence.escalationRate, 0);

  const raw =
    success * 0.45 +
    firstPass * 0.25 +
    qualityReliability * 0.15 +
    fallbackReliability * 0.075 +
    escalationReliability * 0.075;

  return Number((raw * confidenceWeight * 100).toFixed(2));
}

function adaptiveScores(evidence = []) {
  return Object.fromEntries(
    evidence
      .filter((item) => item?.model)
      .map((item) => [
        item.model,
        Object.freeze({
          score: adaptiveScore(item),
          sampleCount: Number(item.sampleCount) || 0,
          confidence: item.confidence || "insufficient",
          successRate: item.successRate ?? null,
          firstPassSuccessRate: item.firstPassSuccessRate ?? null,
          qualityFailureRate: item.qualityFailureRate ?? null,
          fallbackRate: item.fallbackRate ?? null,
          escalationRate: item.escalationRate ?? null,
        }),
      ])
  );
}

function stableAdaptiveScores(
  evidence = [],
  {
    minimumSamples = DEFAULT_STABLE_MINIMUM_SAMPLES,
  } = {}
) {
  return adaptiveScores(
    evidence.filter(
      (item) =>
        Number(item.sampleCount) >= minimumSamples &&
        STABLE_CONFIDENCE.has(item.confidence)
    )
  );
}

function scoreDelta(activeRoute, shadowRoute, scores = {}) {
  if (!activeRoute?.model || !shadowRoute?.model) return null;

  const activeScore = Number(scores[activeRoute.model]?.score);
  const shadowScore = Number(scores[shadowRoute.model]?.score);

  if (!Number.isFinite(activeScore) || !Number.isFinite(shadowScore)) {
    return null;
  }

  return Number((shadowScore - activeScore).toFixed(2));
}


function createAdaptiveRoutingService({
  performanceEngine,
  selectModelRoute,
  shadowComparator = null,
  audit = null,
  lookbackDays = DEFAULT_LOOKBACK_DAYS,
  stableMinimumSamples = DEFAULT_STABLE_MINIMUM_SAMPLES,
  minimumScoreDelta = DEFAULT_MINIMUM_SCORE_DELTA,
  now = () => Date.now(),
} = {}) {
  if (!performanceEngine?.snapshot) {
    throw new TypeError("ModelPerformanceEngine requis.");
  }

  if (typeof selectModelRoute !== "function") {
    throw new TypeError("ModelRouter requis.");
  }

  if (!Number.isInteger(lookbackDays) || lookbackDays < 1 || lookbackDays > 365) {
    throw new TypeError("lookbackDays doit être compris entre 1 et 365.");
  }

  if (
    !Number.isInteger(stableMinimumSamples) ||
    stableMinimumSamples < DEFAULT_STABLE_MINIMUM_SAMPLES
  ) {
    throw new TypeError("stableMinimumSamples doit être un entier >= 8.");
  }

  if (
    !Number.isFinite(Number(minimumScoreDelta)) ||
    Number(minimumScoreDelta) < 0 ||
    Number(minimumScoreDelta) > 100
  ) {
    throw new TypeError("minimumScoreDelta doit être compris entre 0 et 100.");
  }

  function evaluate(input = {}, activeRoute = null, { flagId = "router.adaptive-learning" } = {}) {
    const since = new Date(
      now() - lookbackDays * 24 * 60 * 60 * 1000
    ).toISOString();

    const snapshot = performanceEngine.snapshot({
      taskDomain: input.taskDomain || "GENERAL",
      requiredQuality: input.requiredQuality || "NORMAL",
      since,
    });

    if (!snapshot.adaptiveEvidence?.length) {
      const result = Object.freeze({
        status: "INSUFFICIENT_EVIDENCE",
        activeRoute,
        shadowRoute: null,
        sampleCount: snapshot.totalSamples || 0,
        historicalLatency: {},
      });

      audit?.("routing.adaptive_shadow_skipped", {
        flagId,
        status: result.status,
        sampleCount: result.sampleCount,
      });

      return result;
    }

    const stableScores = stableAdaptiveScores(
      snapshot.adaptiveEvidence,
      { minimumSamples: stableMinimumSamples }
    );

    if (!Object.keys(stableScores).length) {
      const result = Object.freeze({
        status: "INSUFFICIENT_STABLE_EVIDENCE",
        activeRoute,
        shadowRoute: null,
        sampleCount: snapshot.totalSamples || 0,
        evidenceCount: snapshot.adaptiveEvidence.length,
        stableEvidenceCount: 0,
        historicalLatency: snapshot.historicalLatency || {},
        since,
      });

      audit?.("routing.adaptive_shadow_skipped", {
        flagId,
        status: result.status,
        sampleCount: result.sampleCount,
        evidenceCount: result.evidenceCount,
      });

      return result;
    }

    const adaptiveInput = {
      ...input,
      adaptiveRouting: true,
      multiProviderRouting: true,
      costAwareRouting: true,
      adaptiveCandidateScores: stableScores,
      historicalLatency: {
        ...(input.historicalLatency || {}),
        ...(snapshot.historicalLatency || {}),
      },
    };

    const proposedShadowRoute = selectModelRoute(adaptiveInput);
    const delta = scoreDelta(activeRoute, proposedShadowRoute, stableScores);
    const shadowRoute =
      activeRoute &&
      proposedShadowRoute?.model !== activeRoute.model &&
      delta !== null &&
      delta < Number(minimumScoreDelta)
        ? activeRoute
        : proposedShadowRoute;

    const comparison = activeRoute && shadowComparator
      ? shadowComparator.compare({
          flagId,
          legacyResult: activeRoute,
          shadowResult: shadowRoute,
        })
      : null;

    const result = Object.freeze({
      status: comparison?.status || (
        activeRoute?.model === shadowRoute?.model ? "MATCH" : "MISMATCH"
      ),
      activeRoute,
      shadowRoute,
      comparison,
      sampleCount: snapshot.totalSamples,
      evidenceCount: snapshot.adaptiveEvidence.length,
      stableEvidenceCount: Object.keys(stableScores).length,
      historicalLatency: snapshot.historicalLatency,
      adaptiveEvidence: snapshot.adaptiveEvidence,
      scoreDelta: delta,
      minimumScoreDelta: Number(minimumScoreDelta),
      suppressedByStabilityMargin:
        proposedShadowRoute?.model !== activeRoute?.model &&
        shadowRoute?.model === activeRoute?.model,
      since,
    });

    audit?.("routing.adaptive_shadow_evaluated", {
      flagId,
      status: result.status,
      activeModel: activeRoute?.model || null,
      shadowModel: shadowRoute?.model || null,
      sampleCount: result.sampleCount,
      evidenceCount: result.evidenceCount,
      stableEvidenceCount: result.stableEvidenceCount,
      scoreDelta: result.scoreDelta,
      suppressedByStabilityMargin: result.suppressedByStabilityMargin,
    });

    return result;
  }

  return Object.freeze({
    evaluate,
  });
}

module.exports = {
  CONFIDENCE_WEIGHT,
  DEFAULT_LOOKBACK_DAYS,
  DEFAULT_MINIMUM_SCORE_DELTA,
  DEFAULT_STABLE_MINIMUM_SAMPLES,
  adaptiveScore,
  adaptiveScores,
  stableAdaptiveScores,
  scoreDelta,
  createAdaptiveRoutingService,
};
