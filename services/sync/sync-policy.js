"use strict";

const { DEVICE_SCOPES, SYNC_CLASSIFICATIONS } = require("./sync-schema");

const ENTITY_RULES = Object.freeze({
  conversation: { classification: "SYNC_ALLOWED", scope: "CONVERSATIONS", mode: "FULL", fields: ["id", "title", "workspaceId", "folderId", "createdAt", "updatedAt", "deletedAt"] },
  conversation_message: { classification: "SYNC_ALLOWED", scope: "CONVERSATIONS", mode: "FULL", fields: ["id", "conversationId", "role", "content", "turn", "createdAt", "updatedAt", "deletedAt"] },
  workspace: { classification: "SYNC_METADATA_ONLY", scope: "WORKSPACES", mode: "METADATA", fields: ["id", "name", "type", "status", "profileScope", "pinned", "createdAt", "updatedAt", "archivedAt", "deletedAt"] },
  conversation_folder: { classification: "SYNC_METADATA_ONLY", scope: "CONVERSATIONS", mode: "METADATA", fields: ["id", "name", "position", "updatedAt", "deletedAt"] },
  job_status: { classification: "SYNC_METADATA_ONLY", scope: "JOB_STATUS", mode: "METADATA", fields: ["id", "type", "state", "priority", "progress", "reasonCode", "workspaceId", "executionNode", "createdAt", "updatedAt", "completedAt"] },
  notification_state: { classification: "SYNC_METADATA_ONLY", scope: "NOTIFICATIONS", mode: "METADATA", fields: ["id", "kind", "state", "createdAt", "readAt", "dismissedAt"] },
  artifact: { classification: "SYNC_METADATA_ONLY", scope: "ARTIFACT_METADATA", mode: "METADATA", fields: ["artifactId", "version", "artifactType", "outputFormat", "title", "contentFingerprint", "availability", "workspaceId", "createdAt", "updatedAt"] },
  artifact_blob: { classification: "SYNC_ON_REQUEST", scope: "ARTIFACT_DOWNLOAD", mode: "ON_REQUEST", fields: ["artifactId", "version", "blobRef", "contentHash", "sizeBytes", "mimeType"] },
  remote_request: { classification: "SYNC_ALLOWED", scope: "REMOTE_REQUESTS", mode: "FULL", fields: ["requestId", "sourceDeviceId", "intentEnvelope", "nonce", "createdAt", "expiresAt", "executionNode"] },
  private_memory: { classification: "SYNC_FORBIDDEN", scope: null, mode: "NONE", fields: [] },
  protected_profile: { classification: "SYNC_FORBIDDEN", scope: null, mode: "NONE", fields: [] },
  oauth_token: { classification: "SYNC_FORBIDDEN", scope: null, mode: "NONE", fields: [] },
  api_key: { classification: "SYNC_FORBIDDEN", scope: null, mode: "NONE", fields: [] },
  approval_secret: { classification: "SYNC_FORBIDDEN", scope: null, mode: "NONE", fields: [] },
  filesystem_root: { classification: "SYNC_FORBIDDEN", scope: null, mode: "NONE", fields: [] },
  runtime_feature_flag: { classification: "LOCAL_ONLY", scope: null, mode: "NONE", fields: [] },
  audio_device_setting: { classification: "LOCAL_ONLY", scope: null, mode: "NONE", fields: [] },
});

function createSyncPolicy({ hardRulesRegistry = null, operationalSecurityPolicy = null, consentProvider = null } = {}) {
  function evaluate({ entityType, profileScope = "arnaud", sensitivity = "normal", destinationDevice = null, requestedMode = null, localOnly = false, onRequest = false } = {}) {
    const rule = ENTITY_RULES[entityType] || { classification: "SYNC_FORBIDDEN", scope: null, mode: "NONE", fields: [] };
    const reasons = [];
    if (localOnly || sensitivity === "local_only") reasons.push("LOCAL_ONLY_ABSOLUTE");
    if (["alexandra", "sinan", "kaan"].includes(profileScope)) reasons.push("PROTECTED_PROFILE_DEFAULT_DENY");
    if (rule.classification === "SYNC_FORBIDDEN") reasons.push("ENTITY_SYNC_FORBIDDEN");
    if (rule.classification === "LOCAL_ONLY") reasons.push("DEVICE_LOCAL_DATA");
    if (rule.classification === "SYNC_ON_REQUEST" && !onRequest) reasons.push("EXPLICIT_REQUEST_REQUIRED");
    if (destinationDevice && destinationDevice.status !== "ACTIVE") reasons.push("DEVICE_NOT_ACTIVE");
    if (destinationDevice && rule.scope && !destinationDevice.syncScopes?.includes(rule.scope)) reasons.push("DEVICE_SCOPE_MISSING");
    if (consentProvider && !consentProvider({ entityType, profileScope, destinationDevice })) reasons.push("CONSENT_MISSING");
    if (hardRulesRegistry?.getRule?.("sync.disabled")?.enabled) reasons.push("HARD_RULE_SYNC_DISABLED");
    // La policy opérationnelle peut durcir la décision, jamais l'assouplir.
    if (operationalSecurityPolicy?.syncAllowed && operationalSecurityPolicy.syncAllowed({ entityType, profileScope }) === false) reasons.push("OPERATIONAL_POLICY_DENY");
    const denied = reasons.length > 0;
    const allowedMode = requestedMode && ["FULL", "METADATA", "ON_REQUEST"].includes(requestedMode) ? requestedMode : rule.mode;
    return { allowed: !denied, classification: denied && reasons.includes("LOCAL_ONLY_ABSOLUTE") ? "LOCAL_ONLY" : rule.classification, mode: denied ? "NONE" : allowedMode, requiredScope: rule.scope, fieldsAllowed: denied ? [] : [...rule.fields], fieldsRedacted: [], reasonCodes: reasons };
  }
  function sanitize(entityType, payload, decision) {
    if (!decision?.allowed) return null;
    const source = payload && typeof payload === "object" ? payload : {};
    return Object.fromEntries(decision.fieldsAllowed.filter((field) => Object.hasOwn(source, field)).map((field) => [field, source[field]]));
  }
  return { classifications: SYNC_CLASSIFICATIONS, entityRules: () => structuredClone(ENTITY_RULES), evaluate, sanitize, scopes: DEVICE_SCOPES };
}

module.exports = { ENTITY_RULES, createSyncPolicy };
