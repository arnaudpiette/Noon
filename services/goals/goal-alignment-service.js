"use strict";

const { ALIGNMENTS, GoalError, id } = require("./goal-schema");

function createGoalAlignmentService({ registry, projectProvider = () => [], workspaceProvider = () => [] } = {}) {
  if (!registry) throw new TypeError("GoalRegistry requis.");

  function validateLinks(goal) {
    const projectIds = new Set((projectProvider() || []).map((item) => String(item.id)));
    const workspaceIds = new Set((workspaceProvider() || []).map((item) => String(item.id)));
    const missingProjects = goal.linkedProjectIds.filter((projectId) => !projectIds.has(projectId));
    const missingWorkspaces = goal.linkedWorkspaceIds.filter((workspaceId) => !workspaceIds.has(workspaceId));
    if (missingProjects.length) throw new GoalError("GOAL_PROJECT_NOT_FOUND", `Projet introuvable : ${missingProjects[0]}`);
    if (missingWorkspaces.length) throw new GoalError("GOAL_WORKSPACE_NOT_FOUND", `Workspace introuvable : ${missingWorkspaces[0]}`);
    return goal;
  }

  function evaluate(subject = {}, goal, evidence = []) {
    const refs = [...new Set((evidence || []).map((item) => String(item.evidenceId || item)).filter(Boolean))];
    let alignment = "UNKNOWN"; let confidence = 0; let explanation = "Aucune preuve d’alignement explicite.";
    if (subject.projectId && goal.linkedProjectIds.includes(String(subject.projectId))) {
      alignment = "DIRECT"; confidence = 1; explanation = "Le projet est explicitement lié à l’objectif.";
    } else if (subject.workspaceId && goal.linkedWorkspaceIds.includes(String(subject.workspaceId))) {
      alignment = "SUPPORTING"; confidence = 0.9; explanation = "Le workspace est explicitement lié à l’objectif.";
    } else if (subject.goalId && subject.goalId === goal.goalId) {
      alignment = "DIRECT"; confidence = 1; explanation = "Le sujet référence explicitement cet objectif.";
    } else if (ALIGNMENTS.includes(subject.explicitAlignment) && refs.length) {
      alignment = subject.explicitAlignment; confidence = Math.max(0, Math.min(1, Number(subject.confidence) || 0.7));
      explanation = String(subject.explanation || "Alignement fourni avec une preuve explicite.").slice(0, 500);
    }
    return Object.freeze({ subjectRef: String(subject.subjectRef || subject.id || subject.projectId || subject.workspaceId || "unknown"), goalId: goal.goalId, alignment, confidence, explanation, evidenceRefs: refs.slice(0, 30) });
  }

  function strategicSignal(subject, goals, evidence = []) {
    const alignments = goals.map((goal) => evaluate(subject, goal, evidence));
    const rank = { DIRECT: 1, SUPPORTING: 0.7, NEUTRAL: 0, CONFLICTING: -1, UNKNOWN: 0 };
    const known = alignments.filter((item) => item.alignment !== "UNKNOWN");
    return { signalId: id("goal-alignment"), type: "STRATEGIC_ALIGNMENT", value: known.length ? Math.max(-1, Math.min(1, Math.max(...known.map((item) => rank[item.alignment])))) : null, alignments, singleSignal: true };
  }

  return { evaluate, strategicSignal, validateLinks };
}

module.exports = { createGoalAlignmentService };
