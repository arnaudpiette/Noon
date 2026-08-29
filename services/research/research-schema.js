"use strict";

const crypto = require("node:crypto");

const RESEARCH_SCOPES = Object.freeze(["PERSONAL", "PUBLIC", "MIXED"]);
const RESEARCH_MODES = Object.freeze(["QUICK", "STANDARD", "DEEP", "VERIFY", "COMPARE", "CURRENT_STATE"]);
const RESEARCH_DEPTHS = Object.freeze(["QUICK", "NORMAL", "DEEP"]);
const FRESHNESS_REQUIREMENTS = Object.freeze(["LIVE", "RECENT", "CURRENT", "EVERGREEN", "HISTORICAL"]);
const RESEARCH_STATES = Object.freeze(["PLANNING", "SEARCHING", "RETRIEVING", "EVALUATING", "SYNTHESIZING", "COMPLETED", "PARTIAL", "FAILED", "CANCELLED", "INTERRUPTED"]);
const SOURCE_TYPES = Object.freeze(["OFFICIAL", "PRIMARY", "ACADEMIC", "NEWS", "REFERENCE", "TECHNICAL", "COMMUNITY", "COMMERCIAL", "UNKNOWN"]);
const COMPLETENESS = Object.freeze(["COMPLETE_ENOUGH", "PARTIAL", "INSUFFICIENT"]);

function bounded(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, Math.floor(number))) : fallback;
}
function clean(value, maximum = 2000) { return String(value || "").replace(/[\0\r]+/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum); }
function createResearchId() { return `research_${crypto.randomUUID()}`; }

function normalizeResearchRequest(input = {}) {
  const query = clean(input.query, 4000);
  if (!query) throw Object.assign(new TypeError("Requête publique vide."), { code: "RESEARCH_QUERY_EMPTY" });
  const scope = RESEARCH_SCOPES.includes(input.scope) ? input.scope : "PUBLIC";
  const mode = RESEARCH_MODES.includes(input.mode) ? input.mode : "STANDARD";
  const depth = RESEARCH_DEPTHS.includes(input.depth) ? input.depth : mode === "DEEP" ? "DEEP" : mode === "QUICK" ? "QUICK" : "NORMAL";
  const freshnessRequirement = FRESHNESS_REQUIREMENTS.includes(input.freshnessRequirement) ? input.freshnessRequirement : "EVERGREEN";
  return Object.freeze({
    researchId: clean(input.researchId, 160) || createResearchId(), query, scope, mode, depth,
    intent: clean(input.intent, 80) || "FACT", timeRange: input.timeRange || null, freshnessRequirement,
    domains: [...new Set((Array.isArray(input.domains) ? input.domains : []).map((item) => clean(item, 253).toLowerCase()).filter(Boolean))].slice(0, 20),
    excludedDomains: [...new Set((Array.isArray(input.excludedDomains) ? input.excludedDomains : []).map((item) => clean(item, 253).toLowerCase()).filter(Boolean))].slice(0, 20),
    officialSourcesOnly: input.officialSourcesOnly === true, maxSources: bounded(input.maxSources, mode === "DEEP" ? 12 : mode === "QUICK" ? 3 : 8, 1, 20),
    maxQueries: bounded(input.maxQueries, mode === "DEEP" ? 6 : mode === "QUICK" ? 1 : 2, 1, 8),
    locale: clean(input.locale, 20) || "fr-FR", region: clean(input.region, 20) || "FR", workspaceId: clean(input.workspaceId, 160) || null,
    privacyPolicy: input.privacyPolicy && typeof input.privacyPolicy === "object" ? input.privacyPolicy : {}, citationRequired: input.citationRequired !== false,
    forceRefresh: input.forceRefresh === true, userProvidedPublicTerms: Array.isArray(input.userProvidedPublicTerms) ? input.userProvidedPublicTerms.map((item) => clean(item, 200)).filter(Boolean).slice(0, 20) : [],
  });
}

module.exports = { COMPLETENESS, FRESHNESS_REQUIREMENTS, RESEARCH_DEPTHS, RESEARCH_MODES, RESEARCH_SCOPES, RESEARCH_STATES, SOURCE_TYPES, bounded, clean, createResearchId, normalizeResearchRequest };
