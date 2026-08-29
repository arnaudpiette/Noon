"use strict";

// Exécute exactement un chemin autoritaire. En SHADOW, le nouveau chemin doit
// être une fonction locale/dry-run et son résultat ne peut jamais être retourné.
function createFeatureRolloutService({ featureFlags, comparator, observability = null } = {}) {
  if (!featureFlags?.evaluate || !comparator?.compare) throw new TypeError("FeatureFlagService et ShadowComparator requis.");
  async function run({ flagId, context = {}, legacy, modern, shadowSafe = false, compareOptions = {} } = {}) {
    const evaluation = featureFlags.evaluate(flagId, context);
    if (typeof legacy !== "function" || typeof modern !== "function") throw new TypeError("Deux implémentations sont requises.");
    if (evaluation.mode === "OFF") return { result: await legacy(), evaluation, activePath: "legacy", comparison: null };
    if (evaluation.mode === "SHADOW") {
      const legacyStarted = performance.now();
      const result = await legacy();
      const legacyLatencyMs = performance.now() - legacyStarted;
      if (!shadowSafe) {
        observability?.("feature_flag_shadow", { flagId, status: "SKIPPED_UNSAFE" });
        return { result, evaluation, activePath: "legacy", comparison: null };
      }
      const shadowStarted = performance.now();
      const shadowResult = await modern({ dryRun: true, authority: false });
      const shadowLatencyMs = performance.now() - shadowStarted;
      const comparison = comparator.compare({ flagId, legacyResult: result, shadowResult, legacyLatencyMs, shadowLatencyMs, ...compareOptions });
      return { result, evaluation, activePath: "legacy", comparison };
    }
    return { result: await modern({ dryRun: false, authority: true }), evaluation, activePath: "modern", comparison: null };
  }
  return { run };
}

module.exports = { createFeatureRolloutService };
