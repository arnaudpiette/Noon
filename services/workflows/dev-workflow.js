"use strict";
// Workflow Développement : diagnostic, proposition de diff, validation, tests et préparation de soutenance.
function buildDiagnosticPlan(project) { return { projectId: project.id, phase: "diagnostic", steps: ["Reproduire", "Lire l’erreur", "Vérifier le code", "Expliquer", "Préparer le diff", "Demander l’autorisation", "Appliquer", "Tester"] }; }
function validateProposedDiff(proposal) { if (!proposal?.files?.length || !proposal?.diff) throw new Error("Diff exact obligatoire avant autorisation."); return proposal; }
function buildDefensePlan(project) { return { project: project.name, sections: ["Objectif", "Démonstration", "Architecture", "Fichiers clés", "Sécurité", "Questions probables"], explainBeforeFix: true }; }
module.exports = { buildDiagnosticPlan, validateProposedDiff, buildDefensePlan };
