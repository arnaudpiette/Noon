"use strict";

const DEFAULT_COMPACT_THRESHOLD = 120_000;

function compactionConfiguration(env = process.env) {
  const enabled = env.ENABLE_RESPONSE_COMPACTION === "true";
  const parsed = Number(env.RESPONSE_COMPACTION_THRESHOLD_TOKENS);
  const threshold = Number.isFinite(parsed) && parsed >= 20_000 ? Math.floor(parsed) : DEFAULT_COMPACT_THRESHOLD;
  return { enabled, threshold };
}

function applyCompactionOptions(requestOptions, env = process.env) {
  const config = compactionConfiguration(env);
  if (!config.enabled) return { ...requestOptions };
  return { ...requestOptions, context_management: [{ type: "compaction", compact_threshold: config.threshold }] };
}

function isCompactionCompatibilityError(error) {
  const text = `${error?.message || ""} ${error?.error?.message || ""}`;
  return [400, 404, 422].includes(error?.status) && /context_management|compaction|compact_threshold/i.test(text);
}

async function createWithCompactionFallback(client, requestOptions, requestConfig, env = process.env) {
  const compacted = applyCompactionOptions(requestOptions, env);
  try { return await client.responses.create(compacted, requestConfig); }
  catch (error) {
    if (!compacted.context_management || !isCompactionCompatibilityError(error)) throw error;
    const fallback = { ...requestOptions }; delete fallback.context_management;
    const response = await client.responses.create(fallback, requestConfig);
    response.noonCompactionFallback = true;
    return response;
  }
}

module.exports = { DEFAULT_COMPACT_THRESHOLD, applyCompactionOptions, compactionConfiguration, createWithCompactionFallback, isCompactionCompatibilityError };
