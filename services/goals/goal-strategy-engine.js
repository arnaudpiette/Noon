"use strict";

const {
  GOAL_STATUSES, GoalError, RELATION_TYPES, STRATEGY_STATUSES, clean, id,
  normalizeCriterion, normalizeMilestone,
} = require("./goal-schema");
const { createGoalRegistry } = require("./goal-registry");
const { createGoalAlignmentService } = require("./goal-alignment-service");
const { createGoalProgressService } = require("./goal-progress-service");

const TRANSITIONS = Object.freeze({
  DRAFT: new Set(["ACTIVE", "ABANDONED"]), ACTIVE: new Set(["PAUSED", "ACHIEVED", "ABANDONED", "SUPERSEDED"]),
  PAUSED: new Set(["ACTIVE", "ABANDONED", "SUPERSEDED"]), ACHIEVED: new Set([]), ABANDONED: new Set([]), SUPERSEDED: new Set([]),
});
function clone(value) { return value == null ? value : structuredClone(value); }
function redactTelemetry(metadata = {}) { return Object.fromEntries(Object.entries(metadata).filter(([key]) => !/title|description|outcome|strategy|content|constraint/i.test(key))); }
function normalizeDecisionRecordId(value) {
  if (value == null) return null;
  if (typeof value !== "string") throw new GoalError("DECISION_RECORD_ID_INVALID", "La référence Decision doit être une chaîne.");
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > 160) throw new GoalError("DECISION_RECORD_ID_INVALID", "La référence Decision dépasse 160 caractères.");
  return normalized;
}
function normalizeDecisionRefs(raw = {}) {
  const decisionRecordId = normalizeDecisionRecordId(raw.decisionRecordId);
  return [...new Set([...(decisionRecordId ? [decisionRecordId] : []), ...(raw.decisionRefs || []).map(String)])].slice(0, 30);
}

function createGoalStrategyEngine({
  registry = createGoalRegistry(), projectProvider = () => [], workspaceProvider = () => [],
  observability = null, metrics = null, now = () => new Date(), featureMode = "LIMITED",
} = {}) {
  const alignment = createGoalAlignmentService({ registry, projectProvider, workspaceProvider });
  const progress = createGoalProgressService({ now });
  const emit = (event, metadata = {}) => { try { observability?.(event, redactTelemetry(metadata)); } catch {} metrics?.record?.(event, 1); };

  function createGoal(input = {}) {
    const goal = alignment.validateLinks(registry.create({ ...input, userConfirmed: true, source: input.source || "explicit_user" }, { now: now(), requireExplicit: true }));
    emit("goal_created", { goalId: goal.goalId, status: goal.status, profileScope: goal.profileScope, milestoneCount: goal.milestones.length });
    return goal;
  }
  function proposeGoal(input = {}) {
    const candidate = Object.freeze({ candidateId: id("goal-candidate"), title: clean(input.title, 300), outcomeDefinition: clean(input.outcomeDefinition, 1600), profileScope: clean(input.profileScope, 80) || "arnaud", status: "PENDING_CONFIRMATION", source: clean(input.source, 100) || "inference", createdAt: now().toISOString() });
    registry.addCandidate(candidate); emit("goal_candidate_created", { candidateId: candidate.candidateId, profileScope: candidate.profileScope }); return candidate;
  }
  function confirmCandidate(candidateId, overrides = {}) {
    const candidate = registry.getCandidate(candidateId); if (!candidate) throw new GoalError("GOAL_CANDIDATE_NOT_FOUND", "Candidat introuvable.");
    const goal = createGoal({ ...candidate, ...overrides, goalId: overrides.goalId, userConfirmed: true, source: "explicit_user_confirmation" });
    registry.removeCandidate(candidateId); return goal;
  }
  function updateGoal(goalId, changes = {}, { userConfirmed = false } = {}) {
    const strategic = ["title", "outcomeDefinition", "status", "targetDate", "linkedProjectIds", "linkedWorkspaceIds", "successCriteria", "strategyRef"];
    if (strategic.some((key) => Object.hasOwn(changes, key)) && !userConfirmed) throw new GoalError("GOAL_UPDATE_CONFIRMATION_REQUIRED", "Cette modification stratégique requiert une confirmation.");
    const goal = alignment.validateLinks(registry.update(goalId, (current) => ({ ...current, ...changes, userConfirmed: true })));
    emit("goal_updated", { goalId, status: goal.status, version: goal.version }); return goal;
  }
  function transition(goalId, status, options = {}) {
    const current = registry.get(goalId); if (!GOAL_STATUSES.includes(status) || !TRANSITIONS[current.status]?.has(status)) throw new GoalError("GOAL_TRANSITION_INVALID", `Transition ${current.status} → ${status} interdite.`);
    if (!options.userConfirmed) throw new GoalError("GOAL_TRANSITION_CONFIRMATION_REQUIRED", "Le changement de statut requiert une confirmation explicite.");
    if (status === "ACHIEVED") { const assessment = progress.assess(current, options.evidence || {}); const candidate = progress.achievementCandidate(current, assessment, { userConfirmed: true }); if (!candidate.canTransition) throw new GoalError("GOAL_ACHIEVEMENT_EVIDENCE_REQUIRED", "Les critères ou jalons ne prouvent pas encore l’atteinte de l’objectif."); }
    return updateGoal(goalId, { status }, { userConfirmed: true });
  }
  function addMilestone(goalId, raw, { userConfirmed = false } = {}) {
    if (!userConfirmed) throw new GoalError("MILESTONE_CONFIRMATION_REQUIRED", "Le jalon doit être confirmé.");
    const goal = registry.get(goalId); const milestone = normalizeMilestone(raw, goalId); if (!milestone.title) throw new GoalError("MILESTONE_TITLE_REQUIRED", "Le titre du jalon est requis.");
    const updated = updateGoal(goalId, { milestones: [...goal.milestones, milestone] }, { userConfirmed: true }); emit("milestone_created", { goalId, milestoneId: milestone.milestoneId }); return updated.milestones.find((item) => item.milestoneId === milestone.milestoneId);
  }
  function updateMilestone(goalId, milestoneId, changes = {}, { userConfirmed = false, evidenceRefs = [] } = {}) {
    const goal = registry.get(goalId); const index = goal.milestones.findIndex((item) => item.milestoneId === milestoneId); if (index < 0) throw new GoalError("MILESTONE_NOT_FOUND", "Jalon introuvable.");
    if (changes.status === "ACHIEVED" && !userConfirmed && !(evidenceRefs || []).length) throw new GoalError("MILESTONE_EVIDENCE_REQUIRED", "Un jalon ne peut pas être atteint sans preuve ou confirmation.");
    const milestones = [...goal.milestones]; milestones[index] = normalizeMilestone({ ...milestones[index], ...changes, evidenceRefs: [...milestones[index].evidenceRefs, ...evidenceRefs] }, goalId);
    updateGoal(goalId, { milestones }, { userConfirmed: true }); emit("milestone_updated", { goalId, milestoneId, status: milestones[index].status }); return milestones[index];
  }
  function setSuccessCriteria(goalId, criteria, { userConfirmed = false } = {}) { if (!userConfirmed) throw new GoalError("GOAL_CRITERIA_CONFIRMATION_REQUIRED", "Les critères doivent être confirmés."); return updateGoal(goalId, { successCriteria: criteria.map(normalizeCriterion) }, { userConfirmed: true }); }
  function versionStrategy(goalId, raw = {}, { userConfirmed = false } = {}) {
    if (!userConfirmed) throw new GoalError("STRATEGY_CONFIRMATION_REQUIRED", "La stratégie doit être confirmée.");
    const decisionRefs = normalizeDecisionRefs(raw); registry.get(goalId); const prior = registry.strategyHistory(goalId); const version = prior.length + 1;
    if (prior.length) { const active = prior.at(-1); if (active.status === "ACTIVE") registry.putStrategy({ ...active, strategyId: id("strategy-history"), status: "SUPERSEDED", supersededAt: now().toISOString() }); }
    const strategy = Object.freeze({ strategyId: id("strategy"), goalId, title: clean(raw.title, 300), description: clean(raw.description, 2000), principles: (raw.principles || []).map((item) => clean(item, 500)).filter(Boolean).slice(0, 20), chosenApproach: clean(raw.chosenApproach, 2000), alternativesRejected: clone(raw.alternativesRejected || []).slice(0, 20), decisionRefs, assumptions: clone(raw.assumptions || []).slice(0, 30), constraints: clone(raw.constraints || []).slice(0, 30), risks: clone(raw.risks || []).slice(0, 30), reviewAt: raw.reviewAt || null, version, status: "ACTIVE", createdAt: now().toISOString() });
    registry.putStrategy(strategy); updateGoal(goalId, { strategyRef: strategy.strategyId }, { userConfirmed: true }); emit("strategy_version_created", { goalId, strategyId: strategy.strategyId, version }); return strategy;
  }
  function relation(fromGoalId, toGoalId, type, { userConfirmed = false } = {}) {
    if (!userConfirmed) throw new GoalError("GOAL_RELATION_CONFIRMATION_REQUIRED", "La relation doit être confirmée."); if (!RELATION_TYPES.includes(type)) throw new GoalError("GOAL_RELATION_INVALID", "Relation invalide.");
    registry.get(fromGoalId); registry.get(toGoalId); if (fromGoalId === toGoalId) throw new GoalError("GOAL_RELATION_SELF", "Un objectif ne peut pas dépendre de lui-même.");
    const candidate = { relationId: id("goal-relation"), fromGoalId, toGoalId, type, createdAt: now().toISOString() };
    if (type === "DEPENDS_ON") { const edges = [...registry.relationList(), candidate].filter((item) => item.type === "DEPENDS_ON"); const visit = (node, seen = new Set()) => { if (seen.has(node)) return true; const next = new Set(seen).add(node); return edges.filter((edge) => edge.fromGoalId === node).some((edge) => visit(edge.toGoalId, next)); }; if (visit(fromGoalId)) throw new GoalError("GOAL_DEPENDENCY_CYCLE", "Cycle de dépendance refusé."); }
    return registry.putRelation(candidate);
  }
  function evaluateAlignment(subject, scope = {}, evidence = []) { const goals = registry.list({ ...scope }).filter((goal) => goal.status === "ACTIVE"); const result = alignment.strategicSignal(subject, goals, evidence); emit("goal_alignment_evaluated", { alignmentCount: result.alignments.length, knownCount: result.alignments.filter((item) => item.alignment !== "UNKNOWN").length }); return result; }
  function assessProgress(goalId, evidence = {}) { const goal = registry.get(goalId); const assessment = progress.assess(goal, evidence); emit("goal_progress_evaluated", { goalId, method: assessment.progress.method, trajectory: assessment.trajectory }); return assessment; }
  function reviewGoal(goalId, input = {}) { const goal = registry.get(goalId); const assessment = assessProgress(goalId, input.evidence || {}); const review = Object.freeze({ reviewId: id("goal-review"), goalId, reviewedAt: now().toISOString(), progress: assessment.progress, trajectory: assessment.trajectory, blockerRefs: assessment.blockers, nextMilestoneId: assessment.nextMilestone, strategyFit: ["FIT", "REVIEW_NEEDED", "UNKNOWN"].includes(input.strategyFit) ? input.strategyFit : "UNKNOWN", evidenceRefs: assessment.evidenceRefs, source: input.source || "manual_review" }); registry.putReview(review); emit("goal_review_completed", { goalId, reviewId: review.reviewId, trajectory: review.trajectory }); return review; }
  function relevantGoals({ query = "", projectId = null, workspaceId = null, profileScope = "arnaud", remote = true, limit = 5 } = {}) {
    const words = new Set(String(query).toLocaleLowerCase("fr").split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 3));
    return registry.list({ profileScope }).filter((goal) => goal.status === "ACTIVE" && (!remote || goal.sensitivity !== "LOCAL_ONLY"))
      .map((goal) => ({ goal, score: (projectId && goal.linkedProjectIds.includes(projectId) ? 5 : 0) + (workspaceId && goal.linkedWorkspaceIds.includes(workspaceId) ? 4 : 0) + [...words].filter((word) => `${goal.title} ${goal.outcomeDefinition}`.toLocaleLowerCase("fr").includes(word)).length }))
      .filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, limit)
      .map(({ goal }) => ({ goalId: goal.goalId, title: goal.title, activeMilestone: goal.milestones.find((item) => !["ACHIEVED", "SKIPPED"].includes(item.status))?.title || null, relevantConstraint: goal.constraints.find((item) => item.strength === "HARD")?.description || null, alignmentNeed: projectId && !goal.linkedProjectIds.includes(projectId) ? "UNKNOWN" : null, sensitivity: goal.sensitivity }));
  }
  function roadmap(goalId) { const goal = registry.get(goalId); return { goalId, outcome: goal.outcomeDefinition, milestones: goal.milestones.map((item) => ({ milestoneId: item.milestoneId, title: item.title, status: item.status, targetDate: item.targetDate })), derived: true, executionAuthority: false }; }
  function decisionCriterion(goalId) {
    const goal = registry.get(goalId);
    return Object.freeze({ criterionId: `goal-alignment:${goalId}`, label: `Alignement avec ${goal.title}`, type: "STRATEGIC_FIT", importance: "HIGH", direction: "MAXIMIZE", requiredEvidence: "VERIFIED", range: null });
  }
  function decisionConstraints(goalId) {
    registry.get(goalId);
    // Goal ne stocke actuellement que du texte, une force et des evidenceRefs :
    // aucun opérateur, critère ni expected V2 ne peut être inféré sans fabriquer une Hard Rule.
    return Object.freeze([]);
  }
  function planningContext(scope = {}) {
    const goals = registry.list(scope).filter((goal) => goal.status === "ACTIVE");
    return {
      candidateAllocations: goals.flatMap((goal) => goal.milestones
        .filter((milestone) => !["ACHIEVED", "SKIPPED"].includes(milestone.status))
        .map((milestone) => ({ goalId: goal.goalId, milestoneId: milestone.milestoneId, projectIds: milestone.linkedProjectIds.length ? milestone.linkedProjectIds : goal.linkedProjectIds, targetDate: milestone.targetDate, estimatedMinutes: null }))),
      ownsCalendarSlots: false,
      ownsPriorities: false,
    };
  }
  function briefContext(scope = {}, { weekly = false, limit = weekly ? 8 : 3 } = {}) {
    return registry.list(scope).filter((goal) => goal.status === "ACTIVE").slice(0, limit).map((goal) => {
      const assessment = progress.assess(goal);
      return { goalId: goal.goalId, title: goal.title, trajectory: assessment.trajectory, nextMilestoneId: assessment.nextMilestone, milestoneSummary: assessment.milestoneSummary, review: weekly ? registry.reviewHistory(goal.goalId).at(-1) || null : undefined };
    });
  }
  function health() { return { status: "ok", featureMode, goalCount: registry.list().length, candidateCount: registry.listCandidates().length, executionAuthority: false, priorityAuthority: false, planningAuthority: false }; }
  return { addMilestone, assessProgress, briefContext, confirmCandidate, createGoal, decisionConstraints, decisionCriterion, evaluateAlignment, health, planningContext, proposeGoal, registry, relation, relevantGoals, reviewGoal, roadmap, setSuccessCriteria, transition, updateGoal, updateMilestone, versionStrategy };
}

module.exports = { TRANSITIONS, createGoalStrategyEngine };
