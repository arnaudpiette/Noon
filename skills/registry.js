"use strict";

const crypto = require("crypto");
const { validateSkill } = require("./schema-validator");
const { authorizeSkill } = require("./permissions");

const DEFAULT_SKILLS = [
  require("./files/search-files"), require("./files/read-file"), require("./files/browse-directory"),
  require("./gmail/search-emails"), require("./codex/analyze-project"),
  require("./creative/create-artifact"), require("./creative/write-artifact"), require("./creative/generate-image"),
  require("./personal/get-personal-context"), require("./personal/list-inbox"),
  require("./personal/suggest-time-slots"), require("./personal/list-execution-items"),
  require("./personal/update-execution-status"),
  require("./search/personal-search"),
  require("./search/synthesize-personal-sources"),
];

const MODEL_TOOL_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function modelToolName(canonicalName) {
  const name = String(canonicalName || "");
  if (MODEL_TOOL_NAME_PATTERN.test(name)) return name;
  const digest = crypto.createHash("sha256").update(name).digest("hex").slice(0, 10);
  const prefix = name.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 49) || "extension";
  return `ext_${prefix}_${digest}`.slice(0, 64);
}

function pseudonymizeSession(sessionId) {
  return crypto.createHash("sha256").update(String(sessionId || "noon-local")).digest("hex").slice(0, 16);
}

function createSkillRegistry(skills = DEFAULT_SKILLS, { auditLog = null } = {}) {
  const byName = new Map();
  const extensionOwners = new Map();
  const modelAliases = new Map();
  for (const skill of skills) {
    validateSkill(skill);
    if (byName.has(skill.definition.name)) throw new Error(`Nom de skill dupliqué : ${skill.definition.name}`);
    byName.set(skill.definition.name, Object.freeze(skill));
  }

  function append(event, skill, context, details = {}) {
    auditLog?.append(event, {
      session: pseudonymizeSession(context?.sessionId), skill: skill?.definition?.name || "unknown",
      category: skill?.category || "unknown", permission: skill?.permissions?.level || "unknown", ...details,
    });
  }

  function resolveName(name) { return byName.has(name) ? name : modelAliases.get(name) || name; }

  async function executeSkill(name, args, context = {}) {
    const skill = byName.get(resolveName(name));
    if (!skill) throw Object.assign(new Error(`Outil inconnu : ${name}`), { code: "UNKNOWN_SKILL" });
    append("tool.requested", skill, context);
    const decision = authorizeSkill(skill, context, args);
    if (!decision.allowed) {
      append("tool.denied", skill, context, { decision: decision.code });
      throw Object.assign(new Error(`Action refusée : ${decision.code}.`), { code: decision.code });
    }
    append("tool.authorized", skill, context, { decision: decision.code });
    append("tool.started", skill, context);
    const startedAt = Date.now();
    try {
      const result = await skill.execute(args, context);
      append("tool.succeeded", skill, context, { durationMs: Date.now() - startedAt });
      return result;
    } catch (error) {
      const event = error?.name === "AbortError" ? "tool.cancelled" : error?.code === "ETIMEDOUT" ? "tool.timed_out" : "tool.failed";
      append(event, skill, context, { durationMs: Date.now() - startedAt, errorCode: String(error?.code || error?.name || "ERROR").slice(0, 80) });
      throw error;
    }
  }

  function authorize(name, args, context = {}) {
    const skill = byName.get(resolveName(name));
    if (!skill) return { allowed: false, code: "UNKNOWN_SKILL" };
    return authorizeSkill(skill, context, args);
  }

  function registerExtensionSkill(extensionId, extensionSkill, execute) {
    const name = String(extensionSkill?.id || "");
    if (!extensionId || !name.startsWith(`${extensionId}.`) || typeof execute !== "function") {
      throw Object.assign(new Error("Skill d’extension invalide."), { code: "EXTENSION_SKILL_INVALID" });
    }
    if (byName.has(name)) throw Object.assign(new Error(`Nom de skill dupliqué : ${name}`), { code: "EXTENSION_SKILL_COLLISION" });
    const exposedName = modelToolName(name);
    if (modelAliases.has(exposedName) || byName.has(exposedName)) throw Object.assign(new Error(`Alias de skill dupliqué : ${exposedName}`), { code: "EXTENSION_SKILL_COLLISION" });
    const levelMap = { READ: "read", PREPARE: "draft", WRITE: "write", EXECUTE: "external", DESTRUCTIVE: "destructive", EXTERNAL: "external" };
    const skill = Object.freeze({
      definition: Object.freeze({ type: "function", name, description: extensionSkill.description, strict: true, parameters: extensionSkill.inputSchema }),
      permissions: Object.freeze({ level: levelMap[extensionSkill.permissionLevel], explicitOrderRequired: extensionSkill.permissionLevel !== "READ", confirmationRequired: ["EXECUTE", "DESTRUCTIVE", "EXTERNAL"].includes(extensionSkill.permissionLevel), destructive: extensionSkill.permissionLevel === "DESTRUCTIVE" }),
      category: "extension", extensionId, modelToolName: exposedName, execute,
    });
    validateSkill(skill); byName.set(name, skill); modelAliases.set(exposedName, name); extensionOwners.set(name, extensionId); return skill;
  }

  function unregisterExtensionSkills(extensionId) {
    for (const [name, owner] of extensionOwners) if (owner === extensionId) {
      const alias = byName.get(name)?.modelToolName;
      if (alias) modelAliases.delete(alias);
      byName.delete(name); extensionOwners.delete(name);
    }
  }

  return {
    getAllSkills: () => [...byName.values()], getSkillByName: (name) => byName.get(resolveName(name)) || null,
    getToolDefinitions: ({ deferRare = false } = {}) => [...byName.values()].map((skill) => ({ ...skill.definition, name: skill.modelToolName || skill.definition.name, ...(deferRare && skill.deferred ? { defer_loading: true } : {}) })),
    authorize, executeSkill, registerExtensionSkill, unregisterExtensionSkills,
    validateRegistry: () => ([...byName.values()].forEach(validateSkill), true),
  };
}

module.exports = { DEFAULT_SKILLS, createSkillRegistry, modelToolName, pseudonymizeSession };
