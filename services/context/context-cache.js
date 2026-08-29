"use strict";

const crypto = require("crypto");

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function createContextCache({ maxEntries = 128, maxBytes = 4 * 1024 * 1024, now = () => Date.now() } = {}) {
  const entries = new Map();
  const salt = crypto.randomBytes(32);
  const counters = new Map();
  let bytes = 0;

  function digest(value) {
    return crypto.createHmac("sha256", salt)
      // Les descripteurs sont construits dans un ordre stable par le Context
      // Builder ; éviter ici un tri récursif économise du CPU sur chaque hit.
      .update(JSON.stringify(value))
      .digest("hex");
  }
  function metric(segment) {
    if (!counters.has(segment)) counters.set(segment, { hits: 0, misses: 0, builds: 0, buildMs: 0 });
    return counters.get(segment);
  }
  function clone(value) {
    return structuredClone(value);
  }
  function freeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    if (ArrayBuffer.isView(value)) return value;
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
    return value;
  }
  function remove(key) {
    const entry = entries.get(key);
    if (!entry) return;
    bytes -= entry.bytes;
    entries.delete(key);
  }
  function enforceLimits() {
    while (entries.size > maxEntries || bytes > maxBytes) remove(entries.keys().next().value);
  }
  function getOrCreate(segment, descriptor, build, { ttlMs = 0, scope = {}, copyOnRead = true } = {}) {
    const keyHash = digest({ segment, descriptor });
    const key = `${segment}:${keyHash}`;
    const current = entries.get(key);
    const time = now();
    if (current && (!current.expiresAt || current.expiresAt > time)) {
      entries.delete(key);
      current.lastUsedAt = time;
      current.hits += 1;
      entries.set(key, current);
      metric(segment).hits += 1;
      return { value: copyOnRead ? clone(current.value) : current.value, hit: true, keyHash, ageMs: time - current.createdAt, buildMs: 0 };
    }
    if (current) remove(key);
    metric(segment).misses += 1;
    const startedAt = performance.now();
    const value = build();
    const buildMs = performance.now() - startedAt;
    metric(segment).builds += 1;
    metric(segment).buildMs += buildMs;
    let serialized;
    try { serialized = JSON.stringify(value); } catch { serialized = ""; }
    const entryBytes = Buffer.byteLength(serialized, "utf8");
    if (entryBytes <= maxBytes) {
      entries.set(key, {
        segment, keyHash, value: freeze(clone(value)), bytes: entryBytes,
        createdAt: time, lastUsedAt: time, expiresAt: ttlMs > 0 ? time + ttlMs : 0,
        hits: 0, scope: { ...scope },
      });
      bytes += entryBytes;
      enforceLimits();
    }
    return { value, hit: false, keyHash, ageMs: 0, buildMs };
  }
  function invalidate(segment, predicate = null) {
    let count = 0;
    for (const [key, entry] of entries) {
      if (entry.segment !== segment || (predicate && !predicate(entry.scope))) continue;
      remove(key);
      count += 1;
    }
    return count;
  }
  function clear() {
    const count = entries.size;
    entries.clear();
    bytes = 0;
    return count;
  }
  function stats() {
    const segments = {};
    for (const [segment, values] of counters) {
      const attempts = values.hits + values.misses;
      segments[segment] = {
        ...values,
        hitRate: attempts ? values.hits / attempts : 0,
      };
    }
    const hits = [...counters.values()].reduce((sum, value) => sum + value.hits, 0);
    const misses = [...counters.values()].reduce((sum, value) => sum + value.misses, 0);
    return {
      entries: entries.size,
      memoryBytesEstimate: bytes,
      hits,
      misses,
      hitRate: hits + misses ? hits / (hits + misses) : 0,
      segments,
    };
  }
  function inspect() {
    return [...entries.values()].map((entry) => ({
      segment: entry.segment,
      keyHash: entry.keyHash,
      ageMs: Math.max(0, now() - entry.createdAt),
      bytes: entry.bytes,
      hits: entry.hits,
    }));
  }

  return { clear, fingerprint: digest, getOrCreate, inspect, invalidate, stats };
}

module.exports = { createContextCache, stableValue };
