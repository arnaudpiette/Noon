"use strict";

function executeTrustedDevProjectRuleMutation({ workspaceEngine, repository, payload, actor = "OWNER_EXPLICIT_UI" } = {}) {
  if (!workspaceEngine?.context || !repository) throw new TypeError("Dépendances de règles DEV requises.");
  if (!payload || typeof payload !== "object" || !["create", "update", "disable", "delete"].includes(payload.action)) throw Object.assign(new Error("Mutation de règle invalide."), { code: "RULE_MUTATION_INVALID" });
  const context = workspaceEngine.context(String(payload.workspaceId || ""));
  const projects = context.projects || [];
  if (projects.length !== 1 || !context.workspace?.profileScope) throw Object.assign(new Error("Projet DEV non résolu ou ambigu."), { code: "DEV_PROJECT_UNRESOLVED" });
  // L'identifiant affiché après lecture est une contrainte anti-changement de
  // contexte, jamais une autorité : le projet et le propriétaire restent résolus ici.
  if (String(payload.expectedProjectId || "") !== String(projects[0].id)) throw Object.assign(new Error("Le projet DEV a changé. Relis les règles avant toute action."), { code: "DEV_PROJECT_CHANGED" });
  const scope = { ruleId: String(payload.ruleId || ""), projectId: projects[0].id, ownerProfileScope: context.workspace.profileScope, expectedVersion: payload.expectedVersion, actor };
  if (payload.action === "create") return repository.create({ ...scope, text: payload.text });
  if (payload.action === "update") return repository.update({ ...scope, text: payload.text });
  return payload.action === "disable" ? repository.disable(scope) : repository.remove(scope);
}

function listTrustedDevProjectRules({ workspaceEngine, repository, workspaceId } = {}) {
  if (!workspaceEngine?.context || !repository?.listForProject) throw new TypeError("Dépendances de règles DEV requises.");
  const context = workspaceEngine.context(String(workspaceId || ""));
  const projects = context.projects || [];
  if (projects.length !== 1 || !context.workspace?.profileScope) throw Object.assign(new Error("Projet DEV non résolu ou ambigu."), { code: "DEV_PROJECT_UNRESOLVED" });
  return { project: { id: projects[0].id, name: String(projects[0].name || projects[0].displayName || context.displayName || "Projet DEV") }, storage: repository.kind === "sqlite" ? "READ_WRITE" : "READ_ONLY", rules: repository.listForProject({ projectId: projects[0].id, ownerProfileScope: context.workspace.profileScope }) };
}

module.exports = { executeTrustedDevProjectRuleMutation, listTrustedDevProjectRules };
