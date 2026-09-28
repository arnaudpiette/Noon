"use strict";

const DEFAULT_MINIMUM_SAMPLES = 5;

function median(values = []) {
  const sorted = values
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  if (!sorted.length) return null;

  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function rate(values = []) {
  const known = values.filter((value) => typeof value === "boolean");
  if (!known.length) return null;
  return known.filter(Boolean).length / known.length;
}

function confidenceFor(sampleCount) {
  if (sampleCount < 5) return "insufficient";
  if (sampleCount < 8) return "low";
  if (sampleCount < 20) return "medium";
  return "high";
}

function failureBreakdown(samples = []) {
  const counts = {};

  for (const sample of samples) {
    if (sample.success !== false || !sample.failureCategory) continue;
    counts[sample.failureCategory] = (counts[sample.failureCategory] || 0) + 1;
  }

  const failures = Object.values(counts).reduce((sum, value) => sum + value, 0);

  return Object.fromEntries(
    Object.entries(counts)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([category, count]) => [
        category,
        {
          count,
          rateAmongFailures: failures ? count / failures : null,
        },
      ])
  );
}

function aggregateGroup(samples = []) {
  const sampleCount = samples.length;
  const successKnown = samples.filter((item) => typeof item.success === "boolean");
  const firstPassKnown = samples.filter(
    (item) => typeof item.firstPassSuccess === "boolean"
  );

  const confidence = confidenceFor(sampleCount);

  return Object.freeze({
    provider: samples[0]?.provider || null,
    model: samples[0]?.model || null,
    taskDomain: samples[0]?.taskDomain || null,
    requiredQuality: samples[0]?.requiredQuality || null,

    sampleCount,
    successSampleCount: successKnown.length,
    firstPassSampleCount: firstPassKnown.length,

    successRate: rate(successKnown.map((item) => item.success)),
    firstPassSuccessRate: rate(
      firstPassKnown.map((item) => item.firstPassSuccess)
    ),

    medianLatencyMs: median(samples.map((item) => item.latencyMs)),
    medianActualCost: median(samples.map((item) => item.actualCost)),
    medianInputTokens: median(samples.map((item) => item.inputTokens)),
    medianOutputTokens: median(samples.map((item) => item.outputTokens)),

    fallbackRate: rate(samples.map((item) => item.fallbackUsed)),
    escalationRate: rate(samples.map((item) => item.escalationUsed)),

    failures: failureBreakdown(samples),
    qualityFailureRate: sampleCount
      ? samples.filter(
          (item) =>
            item.success === false &&
            ["QUALITY_FAILURE", "VALIDATION_FAILURE"].includes(item.failureCategory)
        ).length / sampleCount
      : null,

    confidence,
    evidenceStatus:
      sampleCount >= DEFAULT_MINIMUM_SAMPLES
        ? "sufficient"
        : "insufficient_evidence",
  });
}

function createModelPerformanceEngine({
  repository,
  minimumSamples = DEFAULT_MINIMUM_SAMPLES,
} = {}) {
  if (!repository?.record || !repository?.list) {
    throw new TypeError("ModelPerformanceRepository requis.");
  }

  if (
    !Number.isInteger(minimumSamples) ||
    minimumSamples < DEFAULT_MINIMUM_SAMPLES
  ) {
    throw new TypeError("minimumSamples doit être un entier >= 5.");
  }

  function recordOutcome(input) {
    return repository.record(input);
  }

  function snapshot(filters = {}) {
    const samples = repository.list({
      taskDomain: filters.taskDomain,
      requiredQuality: filters.requiredQuality,
      provider: filters.provider,
      model: filters.model,
      since: filters.since,
      limit: filters.limit || 5000,
    });

    const groups = new Map();

    for (const sample of samples) {
      const key = [
        sample.taskDomain,
        sample.requiredQuality,
        sample.provider,
        sample.model,
      ].join("::");

      const values = groups.get(key) || [];
      values.push(sample);
      groups.set(key, values);
    }

    const performance = [...groups.values()]
      .map(aggregateGroup)
      .sort(
        (left, right) =>
          left.taskDomain.localeCompare(right.taskDomain) ||
          left.requiredQuality.localeCompare(right.requiredQuality) ||
          left.provider.localeCompare(right.provider) ||
          left.model.localeCompare(right.model)
      );

    const eligible = performance.filter(
      (item) => item.sampleCount >= minimumSamples
    );

    return Object.freeze({
      generatedAt: new Date().toISOString(),
      minimumSamples,
      totalSamples: samples.length,
      performance,
      adaptiveEvidence: eligible.map((item) =>
        Object.freeze({
          taskDomain: item.taskDomain,
          requiredQuality: item.requiredQuality,
          provider: item.provider,
          model: item.model,
          sampleCount: item.sampleCount,
          confidence: item.confidence,
          successRate: item.successRate,
          firstPassSuccessRate: item.firstPassSuccessRate,
          medianLatencyMs: item.medianLatencyMs,
          medianActualCost: item.medianActualCost,
          qualityFailureRate: item.qualityFailureRate,
          fallbackRate: item.fallbackRate,
          escalationRate: item.escalationRate,
        })
      ),
      historicalLatency: Object.fromEntries(
        eligible
          .filter((item) => Number.isFinite(item.medianLatencyMs))
          .map((item) => [item.model, item.medianLatencyMs])
      ),
    });
  }

  return Object.freeze({
    recordOutcome,
    snapshot,
  });
}

module.exports = {
  DEFAULT_MINIMUM_SAMPLES,
  aggregateGroup,
  confidenceFor,
  createModelPerformanceEngine,
  failureBreakdown,
  median,
};
