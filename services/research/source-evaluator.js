"use strict";

const OFFICIAL_HOSTS = [/(^|\.)gov(?:\.|$)/, /(^|\.)gouv\.fr$/, /(^|\.)europa\.eu$/, /(^|\.)openai\.com$/, /(^|\.)nodejs\.org$/, /(^|\.)react\.dev$/, /(^|\.)mozilla\.org$/];
const COMMUNITY_HOSTS = ["reddit.com", "stackoverflow.com", "news.ycombinator.com", "discuss.", "forum."];
const ACADEMIC_HOSTS = ["arxiv.org", "doi.org", ".edu", ".ac."];

function sourceTypeFor(result, query = "") {
  const domain = String(result.sourceDomain || "").toLowerCase();
  if (result.sourceType && result.sourceType !== "UNKNOWN") return result.sourceType;
  if (OFFICIAL_HOSTS.some((pattern) => pattern.test(domain)) || result.official === true) return "OFFICIAL";
  if (ACADEMIC_HOSTS.some((value) => domain.includes(value))) return "ACADEMIC";
  if (COMMUNITY_HOSTS.some((value) => domain.includes(value))) return "COMMUNITY";
  if (/docs|developer|reference|api/i.test(`${domain} ${result.title || ""}`)) return "TECHNICAL";
  if (/news|times|journal|press|actualit/i.test(domain)) return "NEWS";
  if (/buy|shop|pricing|compare|affiliate/i.test(`${domain} ${result.title || ""}`)) return "COMMERCIAL";
  if (query && domain.includes(String(query).toLowerCase().split(/\s+/)[0])) return "PRIMARY";
  return "UNKNOWN";
}
function timestamp(value) { const number = Date.parse(value); return Number.isFinite(number) ? number : null; }
function freshnessFor(result, requirement, now = Date.now()) {
  const dated = timestamp(result.updatedAt) || timestamp(result.publishedAt);
  if (!dated) return { level: "UNKNOWN", stale: ["LIVE", "RECENT", "CURRENT"].includes(requirement), reasonCodes: ["date_unknown"] };
  const ageDays = Math.max(0, (now - dated) / 86_400_000);
  const maximum = { LIVE: 1, RECENT: 14, CURRENT: 365, EVERGREEN: 3650, HISTORICAL: Infinity }[requirement] ?? 3650;
  return { level: ageDays <= maximum ? "FRESH" : "STALE", stale: ageDays > maximum, ageDays: Math.floor(ageDays), reasonCodes: ageDays > maximum ? ["older_than_requirement"] : ["within_requirement"] };
}
function authorityFor(type) { return { OFFICIAL: "HIGH", PRIMARY: "HIGH", ACADEMIC: "HIGH", REFERENCE: "MEDIUM", TECHNICAL: "MEDIUM", NEWS: "MEDIUM", COMMUNITY: "LOW", COMMERCIAL: "LOW", UNKNOWN: "UNKNOWN" }[type] || "UNKNOWN"; }

function createSourceEvaluator({ now = () => Date.now() } = {}) {
  function evaluate(result, request) {
    const sourceType = sourceTypeFor(result, request.query);
    const freshness = freshnessFor(result, request.freshnessRequirement, now());
    const directness = result.snippet ? "DIRECT_PASSAGE" : "METADATA_ONLY";
    const authority = authorityFor(sourceType);
    let confidence = authority === "HIGH" && !freshness.stale ? "HIGH" : authority === "UNKNOWN" || freshness.stale ? "LOW" : "MEDIUM";
    if (request.officialSourcesOnly && !["OFFICIAL", "PRIMARY"].includes(sourceType)) confidence = "LOW";
    return { ...result, sourceType, authoritySignals: { authority, directness, corroborated: false }, freshness, confidence, accepted: !request.officialSourcesOnly || ["OFFICIAL", "PRIMARY"].includes(sourceType), rejectionReason: request.officialSourcesOnly && !["OFFICIAL", "PRIMARY"].includes(sourceType) ? "OFFICIAL_ONLY" : null };
  }
  return { evaluate, freshnessFor, sourceTypeFor };
}

module.exports = { authorityFor, createSourceEvaluator, freshnessFor, sourceTypeFor };
