"use strict";

const crypto = require("node:crypto");

function hash(value) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16); }
function createShadowComparator({ observability = null, now = () => Date.now() } = {}) {
  function compare({ flagId, legacyResult, shadowResult, legacyLatencyMs = 0, shadowLatencyMs = 0, legacyCost = 0, shadowCost = 0, security = false } = {}) {
    const legacyCode = legacyResult?.outcome || legacyResult?.model || legacyResult?.intent || legacyResult?.id || hash(legacyResult);
    const shadowCode = shadowResult?.outcome || shadowResult?.model || shadowResult?.intent || shadowResult?.id || hash(shadowResult);
    const match = JSON.stringify(legacyCode) === JSON.stringify(shadowCode);
    const permissiveness = { DENY: 0, REQUIRE_APPROVAL: 1, APPROVAL: 1, ALLOW_WITH_CONSTRAINTS: 2, ALLOW: 3 };
    const critical = security && (permissiveness[shadowCode] ?? 0) > (permissiveness[legacyCode] ?? 0);
    const result = { flagId, status: critical ? "CRITICAL_MISMATCH" : match ? "MATCH" : "MISMATCH", match, critical, legacyCode, shadowCode, legacyHash: hash(legacyResult), shadowHash: hash(shadowResult), latencyDeltaMs: shadowLatencyMs - legacyLatencyMs, costDelta: shadowCost - legacyCost, comparedAt: new Date(now()).toISOString() };
    observability?.("feature_flag_shadow", { flagId, status: result.status, latencyDeltaMs: result.latencyDeltaMs, costDelta: result.costDelta });
    return result;
  }
  return { compare };
}

module.exports = { createShadowComparator };
