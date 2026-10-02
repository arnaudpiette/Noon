"use strict";

function executeTrustedDevProjectRuleMutation({ workspaceEngine, repository, payload, actor = "OWNER_EXPLICIT_UI" } = {}) {
  if (!workspaceEngine?.context || !repository) throw new TypeError("Dépendances de règles DEV requises.");
  if (!payload || typeof payload !== "object" || !["create", "update", "disable", "delete"].includes(payload.action)) throw Object.assign(new Error("Mutation de règle invalide."), { code: "RULE_MUTATION_INVALID" });
  const context = workspaceEngine.context(String(payload.workspaceId || ""));
  const projects = context.projects || [];
  if (projects.length !== 1 || !context.workspace?.profileScope) throw Object.assign(new Error("Projet DEV non résolu ou ambigu."), { code: "DEV_PROJECT_UNRESOLVED" });
  const scope = { ruleId: String(payload.ruleId || ""), projectId: projects[0].id, ownerProfileScope: context.workspace.profileScope, expectedVersion: payload.expectedVersion, actor };
  if (payload.action === "create") return repository.create({ ...scope, text: payload.text });
  if (payload.action === "update") return repository.update({ ...scope, text: payload.text });
  return payload.action === "disable" ? repository.disable(scope) : repository.remove(scope);
}
module.exports = { executeTrustedDevProjectRuleMutation };
