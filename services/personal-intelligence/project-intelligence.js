"use strict";

function ageDays(value, now) { return value ? Math.floor((now - new Date(value)) / 86_400_000) : Infinity; }
function analyzeProject(project, now = new Date()) {
  const signals = []; const source = { type: "project", reference: project.id };
  if (project.status === "in_progress" && !project.nextAction) signals.push({ code: "missing-next-action", confidence: 1, severity: 80, message: "Le projet actif n’a pas de prochaine action.", source });
  if (["todo", "in_progress"].includes(project.status) && ageDays(project.lastActivityAt, now) >= 7) signals.push({ code: "inactive-project", confidence: 0.85, severity: 55, message: "Aucune activité récente n’est enregistrée.", source });
  if (project.deadline) { const days = (new Date(project.deadline) - now) / 86_400_000; if (days >= 0 && days <= 5) signals.push({ code: "deadline-near", confidence: 1, severity: days <= 2 ? 90 : 70, message: `Échéance dans ${Math.ceil(days)} jour(s).`, source }); }
  if (project.status === "blocked" || project.blockers?.length) signals.push({ code: "blocked", confidence: 0.95, severity: 85, message: project.blockers?.[0] || "Projet déclaré bloqué.", source });
  if (project.estimatedMinutesRemaining != null && project.actualMinutesSpent > project.estimatedMinutesRemaining) signals.push({ code: "estimate-exceeded", confidence: 0.9, severity: 60, message: "Le temps réel dépasse l’estimation restante initiale.", source });
  return signals;
}
function createProjectIntelligenceService(repository) {
  function listWithSignals(now = new Date()) { return repository.listProjects().map((project) => ({ ...project, signals: analyzeProject(project, now) })); }
  function ensureNextActions() { return listWithSignals().filter((p) => p.signals.some((s) => s.code === "missing-next-action")); }
  return { analyzeProject, ensureNextActions, listWithSignals, upsert: repository.upsertProject };
}
module.exports = { analyzeProject, createProjectIntelligenceService };
