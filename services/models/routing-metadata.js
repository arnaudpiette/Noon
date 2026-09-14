"use strict";

const { estimateModelCost } = require("../observability/model-pricing");

const TASK_DOMAINS = Object.freeze(["GENERAL", "DEV", "RESEARCH", "ARTIFACT"]);
const QUALITY_LEVELS = Object.freeze(["LOW", "NORMAL", "HIGH", "CRITICAL"]);
const FAILURE_CATEGORIES = Object.freeze([
  "PROVIDER_FAILURE", "NETWORK_FAILURE", "RATE_LIMIT", "TIMEOUT", "AUTH_ERROR", "MODEL_UNAVAILABLE",
  "QUALITY_FAILURE", "VALIDATION_FAILURE", "TASK_FAILURE",
]);

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function normalizeCost(cost) {
  if (!cost || cost.status !== "available" || finiteOrNull(cost.total) === null) return null;
  return Object.freeze({ currency: cost.currency || "USD", total: finiteOrNull(cost.total) });
}

function classifyFailureCategory(errorOrCode) {
  const code = String(errorOrCode?.code || errorOrCode?.type || errorOrCode || "").toUpperCase();
  if (code === "RATE_LIMIT" || code.includes("RATE_LIMIT")) return "RATE_LIMIT";
  if (code === "TIMEOUT" || code.includes("TIMEOUT") || code === "ABORTERROR") return "TIMEOUT";
  if (code === "AUTH_ERROR" || code.includes("AUTH_ERROR")) return "AUTH_ERROR";
  if (code === "MODEL_UNAVAILABLE" || code.includes("MODEL_UNAVAILABLE")) return "MODEL_UNAVAILABLE";
  if (code === "NETWORK_ERROR" || code.includes("NETWORK") || ["ENOTFOUND", "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN"].includes(code)) return "NETWORK_FAILURE";
  if (code.includes("QUALITY")) return "QUALITY_FAILURE";
  if (code === "INVALID_RESPONSE" || code.includes("VALIDATION")) return "VALIDATION_FAILURE";
  if (code.includes("TASK")) return "TASK_FAILURE";
  return "PROVIDER_FAILURE";
}

function normalizeRoutingMetadata(metadata = {}, { provider = null, model = null, usage = null, latencyMs = null, success = null, error = null } = {}) {
  const taskDomain = TASK_DOMAINS.includes(metadata.taskDomain) ? metadata.taskDomain : "GENERAL";
  const requiredQuality = QUALITY_LEVELS.includes(metadata.requiredQuality) ? metadata.requiredQuality : "NORMAL";
  const actualCost = usage && provider && model ? normalizeCost(estimateModelCost(provider, model, usage)) : normalizeCost(metadata.actualCost);
  const estimatedCost = normalizeCost(metadata.estimatedCost || (
    metadata.estimatedUsage && provider && model ? estimateModelCost(provider, model, metadata.estimatedUsage) : null
  ));
  const resolvedSuccess = typeof success === "boolean" ? success : typeof metadata.success === "boolean" ? metadata.success : null;
  return Object.freeze({
    taskDomain,
    requiredQuality,
    maxEstimatedCost: finiteOrNull(metadata.maxEstimatedCost),
    estimatedCost,
    actualCost,
    latency: finiteOrNull(latencyMs ?? metadata.latency),
    success: resolvedSuccess,
    failureCategory: error || metadata.failureCategory ? classifyFailureCategory(error || metadata.failureCategory) : null,
  });
}

module.exports = { FAILURE_CATEGORIES, QUALITY_LEVELS, TASK_DOMAINS, classifyFailureCategory, normalizeRoutingMetadata };
