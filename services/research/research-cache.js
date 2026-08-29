"use strict";

const crypto = require("node:crypto");

const TTL = Object.freeze({ LIVE: 60_000, RECENT: 10 * 60_000, CURRENT: 60 * 60_000, EVERGREEN: 24 * 60 * 60_000, HISTORICAL: 24 * 60 * 60_000 });
function keyFor(request, provider) { return crypto.createHash("sha256").update(JSON.stringify({ query: request.query.toLocaleLowerCase().replace(/\s+/g, " ").trim(), freshness: request.freshnessRequirement, provider, timeRange: request.timeRange, domains: request.domains })).digest("hex"); }
function createResearchCache({ now = () => Date.now(), maximumEntries = 100 } = {}) {
  const entries = new Map();
  function get(request, provider) {
    if (request.forceRefresh) return { status: "BYPASS", value: null };
    const key = keyFor(request, provider); const entry = entries.get(key);
    if (!entry) return { status: "MISS", value: null };
    if (entry.expiresAt <= now()) { entries.delete(key); return { status: "STALE", value: null }; }
    return { status: "HIT", value: structuredClone(entry.value), key };
  }
  function set(request, provider, value) {
    const key = keyFor(request, provider); entries.set(key, { value: structuredClone(value), expiresAt: now() + (TTL[request.freshnessRequirement] || TTL.EVERGREEN) });
    while (entries.size > maximumEntries) entries.delete(entries.keys().next().value);
    return key;
  }
  return { clear: () => entries.clear(), get, keyFor, set, size: () => entries.size };
}

module.exports = { TTL, createResearchCache, keyFor };
