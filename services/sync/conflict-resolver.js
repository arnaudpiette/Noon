"use strict";

const crypto = require("node:crypto");

function createConflictResolver({ now = () => Date.now() } = {}) {
  function resolve({ current, incoming, changedFields = [], baseFieldVersions = {} } = {}) {
    if (!current) return { strategy: "VERSION_WINS", state: "AUTO_RESOLVED", entity: incoming, conflicts: [] };
    if (current.deletedAt || incoming.deletedAt) {
      const tombstone = current.deletedAt && (!incoming.deletedAt || current.revision >= incoming.revision) ? current : incoming;
      return { strategy: "TOMBSTONE_WINS", state: "AUTO_RESOLVED", entity: tombstone, conflicts: [] };
    }
    if (incoming.entityType === "conversation_message" && current.entityId !== incoming.entityId) return { strategy: "APPEND_MERGE", state: "AUTO_RESOLVED", entity: incoming, conflicts: [] };
    if (["job_status", "notification_state"].includes(incoming.entityType)) return { strategy: "VERSION_WINS", state: "AUTO_RESOLVED", entity: incoming.revision >= current.revision ? incoming : current, conflicts: [] };
    const conflicts = [];
    const payload = { ...current.payload }; const fieldVersions = { ...current.fieldVersions };
    for (const field of changedFields) {
      const currentVersion = current.fieldVersions?.[field]; const baseVersion = baseFieldVersions?.[field]; const incomingVersion = incoming.fieldVersions?.[field];
      const concurrentlyChanged = currentVersion && (!baseVersion || currentVersion.counter > baseVersion.counter) && currentVersion.deviceId !== incoming.originDeviceId;
      if (concurrentlyChanged && JSON.stringify(current.payload?.[field]) !== JSON.stringify(incoming.payload?.[field])) {
        conflicts.push({ conflictId: `conflict_${crypto.randomUUID()}`, entityType: incoming.entityType, entityId: incoming.entityId, field, versionA: { value: current.payload?.[field], version: currentVersion }, versionB: { value: incoming.payload?.[field], version: incomingVersion }, deviceA: current.originDeviceId, deviceB: incoming.originDeviceId, detectedAt: new Date(now()).toISOString(), resolutionState: "NEEDS_USER" });
        continue;
      }
      payload[field] = incoming.payload?.[field]; fieldVersions[field] = incomingVersion;
    }
    if (conflicts.length) return { strategy: "USER_RESOLUTION", state: "NEEDS_USER", entity: current, conflicts };
    return { strategy: "FIELD_MERGE", state: "AUTO_RESOLVED", entity: { ...current, payload, fieldVersions, revision: Math.max(current.revision, incoming.revision), originDeviceId: incoming.originDeviceId, updatedAt: incoming.updatedAt }, conflicts: [] };
  }
  return { resolve };
}

module.exports = { createConflictResolver };
