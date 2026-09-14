"use strict";

const CONFIG_SCHEMA_VERSION = 1;
const CONFIG_SCOPES = Object.freeze(["BUILD", "MACHINE", "USER", "WORKSPACE", "SESSION", "TEST"]);
const RESTART_POLICIES = Object.freeze(["LIVE", "SESSION", "APP_RESTART"]);

const CONFIG_DEFINITIONS = Object.freeze([
  { key: "search.maxResults", type: "integer", defaultValue: 10, min: 1, max: 100, allowedScopes: ["USER", "WORKSPACE", "SESSION", "TEST"], sensitive: false, public: true, userEditable: true, restartRequired: "LIVE" },
  { key: "context.maxTokens", type: "integer", defaultValue: 12000, min: 1000, max: 100000, allowedScopes: ["MACHINE", "USER", "WORKSPACE", "SESSION", "TEST"], sensitive: false, public: true, userEditable: true, restartRequired: "SESSION" },
  { key: "voice.primary", type: "string", defaultValue: "arbor", allowedValues: ["arbor"], allowedScopes: ["USER", "SESSION", "TEST"], sensitive: false, public: true, userEditable: true, restartRequired: "SESSION" },
  { key: "reliability.timeoutMs", type: "integer", defaultValue: 10000, min: 1000, max: 120000, allowedScopes: ["MACHINE", "TEST"], sensitive: false, public: true, userEditable: false, restartRequired: "LIVE" },
  { key: "openai.connectionRef", type: "string", defaultValue: "openai-api-key", allowedScopes: ["MACHINE", "TEST"], sensitive: true, public: false, userEditable: false, restartRequired: "APP_RESTART" },
  { key: "gemini.connectionRef", type: "string", defaultValue: "gemini-api-key", allowedScopes: ["MACHINE", "TEST"], sensitive: true, public: false, userEditable: false, restartRequired: "APP_RESTART" },
  { key: "gemini.enabled", type: "boolean", defaultValue: false, allowedScopes: ["MACHINE", "USER", "TEST"], sensitive: false, public: true, userEditable: true, restartRequired: "APP_RESTART" },
  { key: "gemini.rollout", type: "enum", defaultValue: "SHADOW", allowedValues: ["OFF", "SHADOW", "LIMITED"], allowedScopes: ["MACHINE", "USER", "TEST"], sensitive: false, public: true, userEditable: true, restartRequired: "APP_RESTART" },
  { key: "gemini.tier", type: "enum", defaultValue: "UNKNOWN", allowedValues: ["UNKNOWN", "FREE", "PAID"], allowedScopes: ["MACHINE", "TEST"], sensitive: false, public: false, userEditable: false, restartRequired: "APP_RESTART" },
  { key: "routing.profileDefault", type: "enum", defaultValue: "balanced", allowedValues: ["economical", "balanced", "maximum"], allowedScopes: ["USER", "WORKSPACE", "SESSION", "TEST"], sensitive: false, public: true, userEditable: true, restartRequired: "SESSION" },
  { key: "delegation.maxSubtasks", type: "integer", defaultValue: 3, min: 1, max: 4, allowedScopes: ["MACHINE", "USER", "WORKSPACE", "SESSION", "TEST"], sensitive: false, public: true, userEditable: true, restartRequired: "LIVE" },
  { key: "delegation.maxParallel", type: "integer", defaultValue: 2, min: 1, max: 2, allowedScopes: ["MACHINE", "USER", "WORKSPACE", "SESSION", "TEST"], sensitive: false, public: true, userEditable: true, restartRequired: "LIVE" },
  { key: "delegation.maxWallTimeMs", type: "integer", defaultValue: 45000, min: 1000, max: 120000, allowedScopes: ["MACHINE", "USER", "WORKSPACE", "SESSION", "TEST"], sensitive: false, public: true, userEditable: true, restartRequired: "LIVE" },
  { key: "jobs.maxQueued", type: "integer", defaultValue: 500, min: 10, max: 5000, allowedScopes: ["MACHINE", "TEST"], sensitive: false, public: true, userEditable: false, restartRequired: "APP_RESTART" },
  { key: "jobs.maxRunning", type: "integer", defaultValue: 2, min: 1, max: 8, allowedScopes: ["MACHINE", "TEST"], sensitive: false, public: true, userEditable: false, restartRequired: "APP_RESTART" },
  { key: "jobs.leaseMs", type: "integer", defaultValue: 30000, min: 5000, max: 300000, allowedScopes: ["MACHINE", "TEST"], sensitive: false, public: false, userEditable: false, restartRequired: "APP_RESTART" },
  { key: "sync.batchSize", type: "integer", defaultValue: 100, min: 1, max: 500, allowedScopes: ["MACHINE", "TEST"], sensitive: false, public: false, userEditable: false, restartRequired: "LIVE" },
  { key: "sync.maxOutbox", type: "integer", defaultValue: 10000, min: 100, max: 100000, allowedScopes: ["MACHINE", "TEST"], sensitive: false, public: false, userEditable: false, restartRequired: "APP_RESTART" },
  { key: "sync.tombstoneRetentionDays", type: "integer", defaultValue: 90, min: 7, max: 365, allowedScopes: ["MACHINE", "TEST"], sensitive: false, public: false, userEditable: false, restartRequired: "APP_RESTART" },
  { key: "remote.presenceTtlMs", type: "integer", defaultValue: 60000, min: 5000, max: 600000, allowedScopes: ["MACHINE", "TEST"], sensitive: false, public: false, userEditable: false, restartRequired: "LIVE" },
  { key: "remote.requestTtlMs", type: "integer", defaultValue: 300000, min: 10000, max: 86400000, allowedScopes: ["MACHINE", "TEST"], sensitive: false, public: false, userEditable: false, restartRequired: "LIVE" },
  { key: "remote.maxMediaBytes", type: "integer", defaultValue: 10485760, min: 1024, max: 52428800, allowedScopes: ["MACHINE", "TEST"], sensitive: false, public: false, userEditable: false, restartRequired: "APP_RESTART" },
  { key: "context.ambientDefaultTtlMs", type: "integer", defaultValue: 900000, min: 1000, max: 3600000, allowedScopes: ["MACHINE", "USER", "SESSION", "TEST"], sensitive: false, public: true, userEditable: true, restartRequired: "LIVE" },
  { key: "context.ambientMaxSessionMs", type: "integer", defaultValue: 3600000, min: 60000, max: 14400000, allowedScopes: ["MACHINE", "USER", "TEST"], sensitive: false, public: false, userEditable: true, restartRequired: "LIVE" },
  { key: "context.activeAppDebounceMs", type: "integer", defaultValue: 1500, min: 250, max: 30000, allowedScopes: ["MACHINE", "USER", "TEST"], sensitive: false, public: false, userEditable: true, restartRequired: "LIVE" },
  { key: "decision.maxOptions", type: "integer", defaultValue: 12, min: 2, max: 20, allowedScopes: ["MACHINE", "USER", "WORKSPACE", "TEST"], sensitive: false, public: true, userEditable: true, restartRequired: "LIVE" },
  { key: "decision.maxCriteria", type: "integer", defaultValue: 20, min: 1, max: 30, allowedScopes: ["MACHINE", "USER", "WORKSPACE", "TEST"], sensitive: false, public: true, userEditable: true, restartRequired: "LIVE" },
  { key: "decision.cacheEntries", type: "integer", defaultValue: 100, min: 0, max: 1000, allowedScopes: ["MACHINE", "TEST"], sensitive: false, public: false, userEditable: false, restartRequired: "LIVE" },
  { key: "goals.contextMaxItems", type: "integer", defaultValue: 5, min: 1, max: 10, allowedScopes: ["MACHINE", "USER", "WORKSPACE", "SESSION", "TEST"], sensitive: false, public: true, userEditable: true, restartRequired: "LIVE" },
  { key: "goals.reviewCooldownHours", type: "integer", defaultValue: 168, min: 24, max: 720, allowedScopes: ["MACHINE", "USER", "TEST"], sensitive: false, public: true, userEditable: true, restartRequired: "LIVE" },
  { key: "portfolio.capacityCacheTtlMs", type: "integer", defaultValue: 60000, min: 1000, max: 900000, allowedScopes: ["MACHINE", "USER", "WORKSPACE", "TEST"], sensitive: false, public: true, userEditable: true, restartRequired: "LIVE" },
  { key: "portfolio.tightUtilizationRatio", type: "integer", defaultValue: 85, min: 50, max: 95, allowedScopes: ["MACHINE", "USER", "WORKSPACE", "TEST"], sensitive: false, public: true, userEditable: true, restartRequired: "LIVE" },
  { key: "portfolio.forecastPeriods", type: "integer", defaultValue: 8, min: 1, max: 12, allowedScopes: ["MACHINE", "USER", "WORKSPACE", "TEST"], sensitive: false, public: true, userEditable: true, restartRequired: "LIVE" },
  { key: "notifications.quietHoursEnabled", type: "boolean", defaultValue: false, allowedScopes: ["USER", "SESSION", "TEST"], sensitive: false, public: true, userEditable: true, restartRequired: "LIVE" },
  { key: "notifications.quietHoursStart", type: "string", defaultValue: "22:00", allowedScopes: ["USER", "SESSION", "TEST"], sensitive: false, public: true, userEditable: true, restartRequired: "LIVE" },
  { key: "notifications.quietHoursEnd", type: "string", defaultValue: "07:00", allowedScopes: ["USER", "SESSION", "TEST"], sensitive: false, public: true, userEditable: true, restartRequired: "LIVE" },
  { key: "notifications.maxNonCriticalPerHour", type: "integer", defaultValue: 3, min: 0, max: 20, allowedScopes: ["USER", "TEST"], sensitive: false, public: true, userEditable: true, restartRequired: "LIVE" },
  { key: "notifications.lockScreenDetail", type: "enum", defaultValue: "GENERIC", allowedValues: ["FULL", "REDACTED", "GENERIC", "HIDDEN"], allowedScopes: ["USER", "TEST"], sensitive: false, public: true, userEditable: true, restartRequired: "LIVE" },
  { key: "runtime.executionPreference", type: "enum", defaultValue: "BALANCED", allowedValues: ["QUALITY_FIRST", "BALANCED", "LOCAL_PREFERRED", "LOCAL_ONLY", "COST_SAVING"], allowedScopes: ["USER", "SESSION", "TEST"], sensitive: false, public: true, userEditable: true, restartRequired: "LIVE" },
  { key: "offline.autoFallback", type: "boolean", defaultValue: true, allowedScopes: ["USER", "TEST"], sensitive: false, public: true, userEditable: true, restartRequired: "LIVE" },
  { key: "offline.queueNetworkJobs", type: "boolean", defaultValue: true, allowedScopes: ["USER", "TEST"], sensitive: false, public: true, userEditable: true, restartRequired: "LIVE" },
  { key: "localModel.enabled", type: "boolean", defaultValue: false, allowedScopes: ["MACHINE", "USER", "TEST"], sensitive: false, public: true, userEditable: true, restartRequired: "APP_RESTART" },
  { key: "localModel.provider", type: "enum", defaultValue: "NONE", allowedValues: ["NONE", "OLLAMA", "MLX", "LLAMACPP"], allowedScopes: ["MACHINE", "USER", "TEST"], sensitive: false, public: true, userEditable: true, restartRequired: "APP_RESTART" },
  { key: "extensions.developerMode", type: "boolean", defaultValue: false, allowedScopes: ["MACHINE", "TEST"], sensitive: false, public: true, userEditable: false, restartRequired: "APP_RESTART" },
  { key: "extensions.storageQuotaBytes", type: "integer", defaultValue: 1048576, min: 65536, max: 104857600, allowedScopes: ["MACHINE", "TEST"], sensitive: false, public: false, userEditable: false, restartRequired: "APP_RESTART" },
]);

function createConfigRegistry(definitions = CONFIG_DEFINITIONS) {
  const entries = new Map();
  for (const definition of definitions) {
    if (!definition?.key || entries.has(definition.key)) throw new TypeError(`Définition de configuration invalide : ${definition?.key || "missing"}`);
    if (!CONFIG_SCOPES.every((scope) => typeof scope === "string") || !RESTART_POLICIES.includes(definition.restartRequired)) throw new TypeError(`Politique invalide : ${definition.key}`);
    entries.set(definition.key, Object.freeze({ ...definition, allowedScopes: Object.freeze([...definition.allowedScopes]) }));
  }
  function get(key) { const entry = entries.get(key); if (!entry) throw Object.assign(new Error(`Clé de configuration inconnue : ${key}`), { code: "CONFIG_UNKNOWN_KEY" }); return entry; }
  function validate(key, value, scope = "USER") {
    const entry = get(key);
    if (scope !== "BUILD" && !entry.allowedScopes.includes(scope)) throw Object.assign(new Error(`Scope ${scope} interdit pour ${key}`), { code: "CONFIG_SCOPE_FORBIDDEN" });
    if (entry.type === "integer" && (!Number.isInteger(value) || value < entry.min || value > entry.max)) throw Object.assign(new Error(`Valeur hors limites pour ${key}`), { code: "CONFIG_INVALID_VALUE" });
    if (entry.type === "string" && typeof value !== "string") throw Object.assign(new Error(`Type invalide pour ${key}`), { code: "CONFIG_INVALID_TYPE" });
    if (entry.type === "boolean" && typeof value !== "boolean") throw Object.assign(new Error(`Type invalide pour ${key}`), { code: "CONFIG_INVALID_TYPE" });
    if (entry.type === "enum" && !entry.allowedValues?.includes(value)) throw Object.assign(new Error(`Valeur invalide pour ${key}`), { code: "CONFIG_INVALID_VALUE" });
    if (entry.allowedValues && !entry.allowedValues.includes(value)) throw Object.assign(new Error(`Valeur invalide pour ${key}`), { code: "CONFIG_INVALID_VALUE" });
    return value;
  }
  return { get, has: (key) => entries.has(key), list: () => [...entries.values()], validate, schemaVersion: CONFIG_SCHEMA_VERSION };
}

module.exports = { CONFIG_DEFINITIONS, CONFIG_SCHEMA_VERSION, CONFIG_SCOPES, RESTART_POLICIES, createConfigRegistry };
