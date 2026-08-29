"use strict";

const CONFIG_SCHEMA_VERSION = 1;
const CONFIG_SCOPES = Object.freeze(["BUILD", "MACHINE", "USER", "WORKSPACE", "SESSION", "TEST"]);
const RESTART_POLICIES = Object.freeze(["LIVE", "SESSION", "APP_RESTART"]);

const CONFIG_DEFINITIONS = Object.freeze([
  { key: "search.maxResults", type: "integer", defaultValue: 10, min: 1, max: 100, allowedScopes: ["USER", "WORKSPACE", "SESSION", "TEST"], sensitive: false, public: true, userEditable: true, restartRequired: "LIVE" },
  { key: "context.maxTokens", type: "integer", defaultValue: 12000, min: 1000, max: 100000, allowedScopes: ["MACHINE", "USER", "WORKSPACE", "SESSION", "TEST"], sensitive: false, public: true, userEditable: true, restartRequired: "SESSION" },
  { key: "voice.primary", type: "string", defaultValue: "marin", allowedValues: ["marin", "cedar"], allowedScopes: ["USER", "SESSION", "TEST"], sensitive: false, public: true, userEditable: true, restartRequired: "SESSION" },
  { key: "reliability.timeoutMs", type: "integer", defaultValue: 10000, min: 1000, max: 120000, allowedScopes: ["MACHINE", "TEST"], sensitive: false, public: true, userEditable: false, restartRequired: "LIVE" },
  { key: "openai.connectionRef", type: "string", defaultValue: "openai-api-key", allowedScopes: ["MACHINE", "TEST"], sensitive: true, public: false, userEditable: false, restartRequired: "APP_RESTART" },
  { key: "routing.profileDefault", type: "enum", defaultValue: "balanced", allowedValues: ["economical", "balanced", "maximum"], allowedScopes: ["USER", "WORKSPACE", "SESSION", "TEST"], sensitive: false, public: true, userEditable: true, restartRequired: "SESSION" },
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
