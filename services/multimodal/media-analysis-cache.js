"use strict";

function createMediaAnalysisCache({ maximumEntries = 100, ttlMs = 24 * 60 * 60_000, now = () => Date.now() } = {}) {
  const entries = new Map();
  const keyFor = ({ fingerprint, strategy, analysisVersion, userIntent = "" }) => `${fingerprint}:${strategy}:${analysisVersion}:${String(userIntent).toLowerCase().replace(/\s+/g, " ").slice(0, 300)}`;
  function get(input) { const key = keyFor(input); const entry = entries.get(key); if (!entry) return null; if (now() - entry.storedAt > ttlMs) { entries.delete(key); return null; } entries.delete(key); entries.set(key, entry); return structuredClone(entry.value); }
  function set(input, value) { const key = keyFor(input); entries.delete(key); entries.set(key, { storedAt: now(), value: structuredClone(value) }); while (entries.size > maximumEntries) entries.delete(entries.keys().next().value); return value; }
  return { get, set, clear: () => entries.clear(), keyFor, size: () => entries.size };
}

module.exports = { createMediaAnalysisCache };
