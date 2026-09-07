"use strict";

const EXECUTION_LOCATIONS = Object.freeze(["LOCAL_DETERMINISTIC", "LOCAL_MODEL", "REMOTE_MODEL", "REMOTE_SERVICE"]);
const QUALITY_CLASSES = Object.freeze(["FULL", "GOOD", "LIMITED", "BASIC", "UNAVAILABLE", "UNKNOWN"]);
const AVAILABILITY = Object.freeze(["AVAILABLE", "DEGRADED", "UNAVAILABLE", "UNKNOWN"]);

function normalizeCapability(definition) {
  if (!/^[A-Z][A-Z0-9_]{2,79}$/.test(String(definition?.capabilityId || ""))) throw new TypeError("capabilityId invalide.");
  if (!EXECUTION_LOCATIONS.includes(definition.executionLocation)) throw new TypeError(`executionLocation invalide pour ${definition.capabilityId}.`);
  if (!QUALITY_CLASSES.includes(definition.qualityClass)) throw new TypeError(`qualityClass invalide pour ${definition.capabilityId}.`);
  return Object.freeze({
    capabilityId: definition.capabilityId, provider: String(definition.provider || "noon-core"),
    executionLocation: definition.executionLocation, availability: AVAILABILITY.includes(definition.availability) ? definition.availability : "UNKNOWN",
    qualityClass: definition.qualityClass, requiresNetwork: definition.requiresNetwork === true,
    requiresRemoteData: definition.requiresRemoteData === true, supportsLocalOnly: definition.supportsLocalOnly === true,
    estimatedLatency: String(definition.estimatedLatency || "UNKNOWN"), estimatedCost: String(definition.estimatedCost || "NONE"),
    privacyClass: String(definition.privacyClass || "STANDARD"), metadata: Object.freeze({ ...(definition.metadata || {}) }),
  });
}

function createCapabilityRegistry(definitions = []) {
  const entries = new Map();
  function register(definition) { const item = normalizeCapability(definition); if (entries.has(item.capabilityId)) throw new TypeError(`Capacité dupliquée : ${item.capabilityId}`); entries.set(item.capabilityId, item); return item; }
  for (const definition of definitions) register(definition);
  return { register, get: (id) => entries.get(id) || null, has: (id) => entries.has(id), list: () => [...entries.values()] };
}

module.exports = { AVAILABILITY, EXECUTION_LOCATIONS, QUALITY_CLASSES, createCapabilityRegistry, normalizeCapability };
