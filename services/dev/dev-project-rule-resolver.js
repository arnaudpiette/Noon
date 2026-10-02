"use strict";
function normalize(value) { return String(value || "").toLocaleLowerCase("fr").replace(/\s+/g, " ").trim(); }
function isPermissionLike(text) { return /\b(ignore|contourn|bypass|autorise|permission|\.env|secret|push|réseau|network)\b/i.test(text); }
function restrictionBlocks(rule, restrictions) { const normalizedRule = normalize(rule); return restrictions.some((restriction) => { const text = normalize(restriction); return /\b(ne pas|interdit|sans)\b/.test(text) && (text.includes(normalizedRule) || normalizedRule.includes(text.replace(/\b(ne pas|interdit|sans)\b/g, "").trim())); }); }
function createDevProjectRuleResolver({ repository } = {}) {
  if (!repository?.listActiveForProject) throw new TypeError("DevProjectRuleRepository requis.");
  function resolve({ projectId, ownerProfileScope, taskRestrictions = [] } = {}) {
    if (!projectId || !ownerProfileScope) return Object.freeze({ schemaVersion: 1, projectId: projectId || null, applied: [], excluded: [], taskRestrictions: [...taskRestrictions] });
    const rules = repository.listActiveForProject({ projectId, ownerProfileScope }); const excluded = []; const applied = [];
    const textCount = new Map(); for (const rule of rules) textCount.set(normalize(rule.text), (textCount.get(normalize(rule.text)) || 0) + 1);
    for (const rule of rules) { const text = normalize(rule.text); if (textCount.get(text) > 1) excluded.push({ ruleId: rule.ruleId, code: "CONFLICTING_DUPLICATE" }); else if (isPermissionLike(rule.text)) excluded.push({ ruleId: rule.ruleId, code: "PERMISSION_LIKE_RULE" }); else if (restrictionBlocks(rule.text, taskRestrictions)) excluded.push({ ruleId: rule.ruleId, code: "TASK_RESTRICTION_PREVAILS" }); else applied.push({ ruleId: rule.ruleId, version: rule.version, text: rule.text }); }
    return Object.freeze({ schemaVersion: 1, projectId, applied: Object.freeze(applied), excluded: Object.freeze(excluded), taskRestrictions: Object.freeze([...taskRestrictions].map(String)) });
  }
  return { resolve };
}
module.exports = { createDevProjectRuleResolver, isPermissionLike, restrictionBlocks };
