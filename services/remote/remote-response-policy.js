"use strict";

const BLOCKED = new Set(["LOCAL_ONLY", "LOCAL_ONLY_DERIVED", "PROTECTED", "SECRET"]);
function createRemoteResponsePolicy({ syncPolicy = null } = {}) {
  function evaluate({ classification = "NORMAL", profileScope = "arnaud", device = null, sourceRefs = [] } = {}) {
    const reasons = [];
    if (BLOCKED.has(String(classification).toUpperCase())) reasons.push("REMOTE_OUTPUT_CLASSIFICATION_DENY");
    if (["alexandra", "sinan", "kaan"].includes(profileScope)) reasons.push("PROTECTED_PROFILE_REMOTE_DENY");
    if (sourceRefs.some((ref) => ["LOCAL_ONLY", "LOCAL_ONLY_DERIVED"].includes(String(ref?.classification).toUpperCase()))) reasons.push("DERIVED_LOCAL_ONLY_DENY");
    if (!device || device.status !== "ACTIVE") reasons.push("DEVICE_NOT_ACTIVE");
    if (syncPolicy && syncPolicy.evaluate({ entityType: "conversation_message", profileScope, destinationDevice: device }).allowed === false) reasons.push("SYNC_POLICY_DENY");
    return { allowed: reasons.length === 0, reasonCodes: reasons, classification: String(classification).toUpperCase() };
  }
  return { evaluate };
}

module.exports = { createRemoteResponsePolicy };
