"use strict";

function normalizeSourceItem(sourceType, item, options = {}) {
  const reference = String(item.id || item.reference || item.path || "").slice(0, 300);
  if (!reference) throw new Error("Référence source manquante.");
  return {
    sourceType, sourceReference: reference, title: String(item.title || item.subject || item.name || "Élément à examiner").slice(0, 300),
    action: String(item.action || item.nextAction || options.action || "Examiner cet élément").slice(0, 800), projectId: item.projectId || null,
    deadline: item.deadline || item.dueAt || null, estimatedDuration: item.estimatedDuration || item.estimatedDurationMinutes || null,
    importance: Math.max(0, Math.min(1, Number(item.importance ?? options.importance ?? 0.5))), energyRequired: item.energyRequired || options.energyRequired || "medium",
    requiredContext: String(item.requiredContext || "").slice(0, 500), status: item.status || "detected", expiresAt: item.expiresAt || null,
    sensitivity: item.sensitivity || "normal", sourceUpdatedAt: item.updatedAt || null, sourceStale: options.offline === true,
  };
}
function createInboxService(repository) {
  function ingest(sourceType, items, options = {}) { return (items || []).map((item) => repository.upsertInbox(normalizeSourceItem(sourceType, item, options))); }
  function list(filters = {}) { return repository.listInbox(filters); }
  function associate(id, projectId) { return repository.updateInbox(id, { projectId }); }
  function convertToNextAction(id) { const item = repository.updateInbox(id, { status: "accepted" }); if (!item.projectId) throw new Error("Associez d’abord cet élément à un projet."); const project = repository.getProject(item.projectId); return repository.upsertProject({ ...project, nextAction: item.action || item.title, status: project.status === "todo" ? "in_progress" : project.status }); }
  function expire(at = new Date()) { const expired=[]; for(const item of list()){if(item.expiresAt&&new Date(item.expiresAt)<=at&&!['completed','expired'].includes(item.status)) expired.push(repository.updateInbox(item.id,{status:'expired'}));} return expired; }
  function toPriorityActions(filters = {}) {
    const projectPriorities = new Map(repository.listProjects().map((project) => [project.id, project.priority]));
    return list(filters).filter((item) => ["detected", "ready", "proposed"].includes(item.status)).map((item) => ({
      id: item.id, title: item.action || item.title, sourceType: item.sourceType,
      sourceId: item.sourceReference, dueAt: item.deadline,
      estimatedDurationMinutes: item.estimatedDuration,
      projectId: item.projectId, projectPriority: projectPriorities.get(item.projectId) ?? 50,
      importance: item.importance, impact: item.importance,
      urgency: item.deadline ? 0.65 : 0.3,
      confidence: item.sourceStale ? 0.45 : 0.8,
      energyRequired: item.energyRequired, updatedAt: item.updatedAt,
      metadata: { inboxItemId: item.id, sourceStale: item.sourceStale },
    }));
  }
  return { associate, convertToNextAction, expire, ingest, list, normalizeSourceItem, toPriorityActions };
}
module.exports = { createInboxService, normalizeSourceItem };
