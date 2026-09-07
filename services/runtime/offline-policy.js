"use strict";

const NETWORK_STATES = Object.freeze(["ONLINE", "DEGRADED", "PROVIDER_UNAVAILABLE", "OFFLINE", "LOCAL_ONLY"]);
const EXECUTION_PREFERENCES = Object.freeze(["QUALITY_FIRST", "BALANCED", "LOCAL_PREFERRED", "LOCAL_ONLY", "COST_SAVING"]);

function createOfflinePolicy() {
  function resolve({ requiredCapability, alternatives = [], privacy = "STANDARD", qualityRequirement = "BASIC", userPreference = "BALANCED", networkState = "ONLINE", queueAllowed = false, explicitQueueIntent = false, highRisk = false } = {}) {
    const remoteForbidden = privacy === "LOCAL_ONLY" || userPreference === "LOCAL_ONLY" || networkState === "LOCAL_ONLY";
    const available = [requiredCapability, ...alternatives].filter(Boolean).filter((item) => item.availability === "AVAILABLE" || item.availability === "DEGRADED");
    const local = available.find((item) => item.executionLocation.startsWith("LOCAL") && item.supportsLocalOnly);
    const remote = available.find((item) => item.executionLocation.startsWith("REMOTE") && !remoteForbidden && networkState === "ONLINE");
    const selected = userPreference === "LOCAL_PREFERRED" || userPreference === "COST_SAVING" || remoteForbidden ? local || remote : remote || local;
    if (selected) {
      const degraded = selected.availability === "DEGRADED" || ["LIMITED", "BASIC"].includes(selected.qualityClass) || (requiredCapability && selected.capabilityId !== requiredCapability.capabilityId);
      return { status: degraded ? "DEGRADED" : "AVAILABLE", mode: selected.executionLocation, capabilityId: selected.capabilityId, quality: selected.qualityClass,
        userDisclosureRequired: degraded, queueRemoteRetry: false, reasonCode: degraded ? "LOWER_QUALITY_ALTERNATIVE" : "PRIMARY_AVAILABLE", remoteForbidden };
    }
    const mayQueue = queueAllowed && explicitQueueIntent && !highRisk && !remoteForbidden;
    return { status: "UNAVAILABLE", mode: mayQueue ? "WAITING_NETWORK" : "UNAVAILABLE", capabilityId: null, quality: "UNAVAILABLE",
      userDisclosureRequired: true, queueRemoteRetry: mayQueue, reasonCode: remoteForbidden ? "REMOTE_FORBIDDEN" : networkState === "OFFLINE" ? "NETWORK_OFFLINE" : "CAPABILITY_UNAVAILABLE", remoteForbidden };
  }
  return { resolve };
}

module.exports = { EXECUTION_PREFERENCES, NETWORK_STATES, createOfflinePolicy };
