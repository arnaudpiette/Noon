"use strict";

const EXTENSION_API_VERSION = "1";
const EXTENSION_TYPES = Object.freeze([
  "SKILL", "CONNECTOR", "SEARCH_PROVIDER", "CONTEXT_ADAPTER",
  "ARTIFACT_RENDERER", "LOCAL_MODEL_PROVIDER", "MEDIA_PROCESSOR", "NOTIFICATION_CHANNEL",
]);
const PERMISSION_LEVELS = Object.freeze(["READ", "PREPARE", "WRITE", "EXECUTE", "DESTRUCTIVE", "EXTERNAL"]);
const PROVENANCE = Object.freeze(["CORE", "BUNDLED", "LOCAL_DEVELOPMENT", "SIGNED_EXTERNAL", "UNKNOWN"]);
const TRUST = Object.freeze(["CORE", "TRUSTED", "USER_INSTALLED", "UNTRUSTED"]);
const ALLOWED_FIELDS = new Set([
  "id", "name", "version", "apiVersion", "type", "entrypoint", "capabilities", "permissions",
  "skills", "commands", "requiresCapabilities", "configSchema", "supportedPlatforms",
  "minimumNoonVersion", "allowedDomains", "events", "critical", "description",
]);

function error(code, message) { return Object.assign(new TypeError(message), { code }); }
function semver(value, field) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(String(value || ""))) throw error("EXTENSION_MANIFEST_INVALID", `${field} doit utiliser SemVer.`);
  return String(value);
}
function strictObjectSchema(schema, field) {
  if (!schema || schema.type !== "object" || schema.additionalProperties !== false || !schema.properties || !Array.isArray(schema.required)) {
    throw error("EXTENSION_SCHEMA_INVALID", `${field} doit être un schéma objet strict.`);
  }
  return structuredClone(schema);
}
function normalizeSkill(skill, extensionId) {
  if (!skill || !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/.test(String(skill.id || ""))) throw error("EXTENSION_MANIFEST_INVALID", "Identifiant de skill invalide.");
  if (!String(skill.id).startsWith(`${extensionId}.`)) throw error("EXTENSION_SKILL_NAMESPACE_REQUIRED", "Une skill doit être namespacée par l’extension.");
  if (!PERMISSION_LEVELS.includes(skill.permissionLevel)) throw error("EXTENSION_PERMISSION_INVALID", `Permission invalide pour ${skill.id}.`);
  return Object.freeze({
    id: skill.id,
    description: String(skill.description || skill.id).slice(0, 500),
    permissionLevel: skill.permissionLevel,
    inputSchema: strictObjectSchema(skill.inputSchema, `${skill.id}.inputSchema`),
    outputSchema: strictObjectSchema(skill.outputSchema, `${skill.id}.outputSchema`),
    timeoutMs: Math.min(120_000, Math.max(100, Number(skill.timeoutMs) || 10_000)),
  });
}
function compareSemver(left, right) {
  const a = String(left).split(/[.-]/).slice(0, 3).map(Number); const b = String(right).split(/[.-]/).slice(0, 3).map(Number);
  for (let i = 0; i < 3; i += 1) { if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1; }
  return 0;
}
function compatibility(manifest, { noonVersion = "1.0.0", apiVersion = EXTENSION_API_VERSION } = {}) {
  if (manifest.apiVersion !== apiVersion) return manifest.apiVersion < apiVersion ? "DEPRECATED" : "INCOMPATIBLE";
  if (compareSemver(noonVersion, manifest.minimumNoonVersion) < 0) return "INCOMPATIBLE";
  return "COMPATIBLE";
}
function validateManifest(raw, options = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw error("EXTENSION_MANIFEST_INVALID", "Manifest absent.");
  const unknown = Object.keys(raw).filter((key) => !ALLOWED_FIELDS.has(key));
  if (unknown.length) throw error("EXTENSION_MANIFEST_UNKNOWN_FIELD", `Champ inconnu : ${unknown[0]}.`);
  const id = String(raw.id || "");
  if (!/^[a-z][a-z0-9]*(?:\.[a-z0-9-]+){2,}$/.test(id)) throw error("EXTENSION_MANIFEST_INVALID", "ID d’extension invalide.");
  if (!EXTENSION_TYPES.includes(raw.type)) throw error("EXTENSION_MANIFEST_INVALID", "Type d’extension invalide.");
  const permissions = [...new Set(raw.permissions || [])];
  if (!permissions.every((item) => typeof item === "string" && /^(READ|PREPARE|WRITE|EXECUTE|DESTRUCTIVE|EXTERNAL|[a-z][a-z0-9_.:-]+)$/.test(item))) throw error("EXTENSION_PERMISSION_INVALID", "Permission déclarative invalide.");
  const manifest = Object.freeze({
    id, name: String(raw.name || "").trim().slice(0, 120), version: semver(raw.version, "version"),
    apiVersion: String(raw.apiVersion || ""), type: raw.type, entrypoint: String(raw.entrypoint || "./index.js"),
    capabilities: Object.freeze([...new Set(raw.capabilities || [])]), permissions: Object.freeze(permissions),
    skills: Object.freeze((raw.skills || []).map((skill) => normalizeSkill(skill, id))),
    commands: Object.freeze(structuredClone(raw.commands || [])), requiresCapabilities: Object.freeze([...new Set(raw.requiresCapabilities || [])]),
    configSchema: raw.configSchema ? strictObjectSchema(raw.configSchema, "configSchema") : null,
    supportedPlatforms: Object.freeze([...new Set(raw.supportedPlatforms || ["darwin"])]),
    minimumNoonVersion: semver(raw.minimumNoonVersion || "1.0.0", "minimumNoonVersion"),
    allowedDomains: Object.freeze([...new Set(raw.allowedDomains || [])].map((item) => String(item).toLowerCase())),
    events: Object.freeze([...new Set(raw.events || [])]), critical: raw.critical === true,
    description: String(raw.description || "").slice(0, 1000),
  });
  if (!manifest.name) throw error("EXTENSION_MANIFEST_INVALID", "Nom d’extension absent.");
  return { manifest, compatibility: compatibility(manifest, options) };
}

module.exports = { EXTENSION_API_VERSION, EXTENSION_TYPES, PERMISSION_LEVELS, PROVENANCE, TRUST, compareSemver, compatibility, strictObjectSchema, validateManifest };
