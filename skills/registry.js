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

function pseudonymizeSession(sessionId) {
  return crypto.createHash("sha256").update(String(sessionId || "noon-local")).digest("hex").slice(0, 16);
}

function createSkillRegistry(skills = DEFAULT_SKILLS, { auditLog = null } = {}) {
  const byName = new Map();
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

  async function executeSkill(name, args, context = {}) {
    const skill = byName.get(name);
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
    const skill = byName.get(name);
    if (!skill) return { allowed: false, code: "UNKNOWN_SKILL" };
    return authorizeSkill(skill, context, args);
  }

  return {
    getAllSkills: () => [...byName.values()], getSkillByName: (name) => byName.get(name) || null,
    getToolDefinitions: ({ deferRare = false } = {}) => [...byName.values()].map((skill) => ({ ...skill.definition, ...(deferRare && skill.deferred ? { defer_loading: true } : {}) })),
    authorize, executeSkill, validateRegistry: () => ([...byName.values()].forEach(validateSkill), true),
  };
}

module.exports = { DEFAULT_SKILLS, createSkillRegistry, pseudonymizeSession };
