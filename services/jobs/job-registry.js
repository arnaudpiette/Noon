"use strict";

const JOB_STATES = Object.freeze([
  "CREATED", "QUEUED", "RUNNING", "WAITING", "RETRY_SCHEDULED",
  "CANCEL_REQUESTED", "CANCELLED", "SUCCEEDED", "FAILED", "BLOCKED", "INTERRUPTED",
]);
const TERMINAL_JOB_STATES = Object.freeze(["CANCELLED", "SUCCEEDED", "FAILED", "BLOCKED"]);
const JOB_PRIORITIES = Object.freeze(["LOW", "NORMAL", "HIGH", "URGENT"]);
const RESOURCE_CLASSES = Object.freeze(["LIGHT", "MODEL", "HEAVY_IO"]);
const INPUT_MODES = Object.freeze(["REFERENCE_ONLY", "PUBLIC_SNAPSHOT"]);
const MISSED_POLICIES = Object.freeze(["RUN_ONCE", "SKIP", "RESCHEDULE"]);

const BUILTIN_JOB_TYPES = Object.freeze([
  { type: "PUBLIC_RESEARCH", handlerVersion: 1, inputMode: "PUBLIC_SNAPSHOT", priority: "NORMAL", resumable: true, retryable: true, maxAttempts: 3, resourceClass: "MODEL", requiresNetwork: true, requiresWorkspace: false, userVisible: true, missedPolicy: "RUN_ONCE", coalesce: true },
  { type: "PERSONAL_REINDEX", handlerVersion: 1, inputMode: "REFERENCE_ONLY", priority: "LOW", resumable: true, retryable: true, maxAttempts: 2, resourceClass: "HEAVY_IO", requiresNetwork: false, requiresWorkspace: true, userVisible: false, missedPolicy: "RESCHEDULE", coalesce: true },
  { type: "WORKSPACE_ANALYSIS", handlerVersion: 1, inputMode: "REFERENCE_ONLY", priority: "NORMAL", resumable: true, retryable: true, maxAttempts: 2, resourceClass: "MODEL", requiresNetwork: false, requiresWorkspace: true, userVisible: true, missedPolicy: "RUN_ONCE", coalesce: false },
  { type: "MULTIMODAL_ANALYSIS", handlerVersion: 1, inputMode: "REFERENCE_ONLY", priority: "NORMAL", resumable: false, retryable: true, maxAttempts: 2, resourceClass: "MODEL", requiresNetwork: true, requiresWorkspace: false, userVisible: true, missedPolicy: "RUN_ONCE", coalesce: false },
  { type: "CONVERSATION_COMPACTION", handlerVersion: 1, inputMode: "REFERENCE_ONLY", priority: "LOW", resumable: true, retryable: true, maxAttempts: 2, resourceClass: "LIGHT", requiresNetwork: false, requiresWorkspace: false, userVisible: false, missedPolicy: "RESCHEDULE", coalesce: true },
  { type: "DELEGATED_ANALYSIS", handlerVersion: 1, inputMode: "REFERENCE_ONLY", priority: "NORMAL", resumable: true, retryable: true, maxAttempts: 2, resourceClass: "MODEL", requiresNetwork: true, requiresWorkspace: false, userVisible: true, missedPolicy: "RUN_ONCE", coalesce: false },
  { type: "MAINTENANCE", handlerVersion: 1, inputMode: "REFERENCE_ONLY", priority: "LOW", resumable: true, retryable: true, maxAttempts: 2, resourceClass: "LIGHT", requiresNetwork: false, requiresWorkspace: false, userVisible: false, missedPolicy: "RESCHEDULE", coalesce: true },
]);

function validateDefinition(definition) {
  if (!definition?.type || !/^[A-Z][A-Z0-9_]{2,80}$/.test(definition.type)) throw new TypeError("Type de job invalide.");
  if (!INPUT_MODES.includes(definition.inputMode)) throw new TypeError(`inputMode invalide : ${definition.type}`);
  if (!JOB_PRIORITIES.includes(definition.priority)) throw new TypeError(`Priorité invalide : ${definition.type}`);
  if (!RESOURCE_CLASSES.includes(definition.resourceClass)) throw new TypeError(`Classe de ressource invalide : ${definition.type}`);
  if (!MISSED_POLICIES.includes(definition.missedPolicy)) throw new TypeError(`Politique de retard invalide : ${definition.type}`);
  if (!Number.isInteger(definition.handlerVersion) || definition.handlerVersion < 1) throw new TypeError(`Version de handler invalide : ${definition.type}`);
  if (!Number.isInteger(definition.maxAttempts) || definition.maxAttempts < 1 || definition.maxAttempts > 10) throw new TypeError(`Nombre de tentatives invalide : ${definition.type}`);
  return Object.freeze({ ...definition });
}

function createJobRegistry(definitions = BUILTIN_JOB_TYPES) {
  const entries = new Map();
  const handlers = new Map();
  for (const definition of definitions) {
    const validated = validateDefinition(definition);
    if (entries.has(validated.type)) throw new TypeError(`Type de job dupliqué : ${validated.type}`);
    entries.set(validated.type, validated);
  }
  return {
    get(type) { const value = entries.get(type); if (!value) throw Object.assign(new Error(`Type de job inconnu : ${type}`), { code: "JOB_TYPE_UNKNOWN" }); return value; },
    has: (type) => entries.has(type),
    list: () => [...entries.values()],
    registerHandler(type, handler) { if (!entries.has(type) || typeof handler !== "function") throw new TypeError("Handler de job invalide."); handlers.set(type, handler); },
    handler(type) { return handlers.get(type) || null; },
  };
}

module.exports = { BUILTIN_JOB_TYPES, INPUT_MODES, JOB_PRIORITIES, JOB_STATES, MISSED_POLICIES, RESOURCE_CLASSES, TERMINAL_JOB_STATES, createJobRegistry };
