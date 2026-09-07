"use strict";

const { GoalError, normalizeGoal } = require("./goal-schema");

function clone(value) { return value == null ? value : structuredClone(value); }

function createGoalRegistry({ repository = null } = {}) {
  const goals = new Map();
  const candidates = new Map();
  const versions = new Map();
  const relations = new Map();
  const strategies = new Map();
  const reviews = new Map();
  if (repository?.load) for (const goal of repository.load() || []) goals.set(goal.goalId, goal);

  function save(goal) { goals.set(goal.goalId, clone(goal)); repository?.save?.(clone(goal)); return clone(goal); }
  function get(goalId) { const goal = goals.get(String(goalId || "")); if (!goal) throw new GoalError("GOAL_NOT_FOUND", "Objectif introuvable."); return clone(goal); }
  function scoped(goal, scope = {}) {
    return (!scope.profileScope || goal.profileScope === scope.profileScope) &&
      (!scope.workspaceId || goal.linkedWorkspaceIds.includes(scope.workspaceId)) &&
      (!scope.projectId || goal.linkedProjectIds.includes(scope.projectId));
  }
  function list(scope = {}) { return [...goals.values()].filter((goal) => scoped(goal, scope)).map(clone); }
  function create(input, options = {}) { const goal = normalizeGoal(input, options); if (goals.has(goal.goalId)) throw new GoalError("GOAL_EXISTS", "Cet objectif existe déjà."); return save(goal); }
  function update(goalId, updater) {
    const current = get(goalId); const next = typeof updater === "function" ? updater(current) : { ...current, ...updater };
    const normalized = normalizeGoal({ ...next, goalId, createdAt: current.createdAt, updatedAt: new Date().toISOString(), version: current.version + 1, userConfirmed: true });
    const history = versions.get(goalId) || []; history.push(current); versions.set(goalId, history); return save(normalized);
  }
  function addCandidate(candidate) { candidates.set(candidate.candidateId, clone(candidate)); return clone(candidate); }
  function getCandidate(candidateId) { return clone(candidates.get(candidateId) || null); }
  function removeCandidate(candidateId) { return candidates.delete(candidateId); }
  function listCandidates(scope = {}) { return [...candidates.values()].filter((item) => !scope.profileScope || item.profileScope === scope.profileScope).map(clone); }
  function history(goalId) { return (versions.get(goalId) || []).map(clone); }
  function putStrategy(strategy) { const rows = strategies.get(strategy.goalId) || []; rows.push(clone(strategy)); strategies.set(strategy.goalId, rows); return clone(strategy); }
  function strategyHistory(goalId) { return (strategies.get(goalId) || []).map(clone); }
  function putRelation(relation) { relations.set(relation.relationId, clone(relation)); return clone(relation); }
  function relationList() { return [...relations.values()].map(clone); }
  function putReview(review) { const rows = reviews.get(review.goalId) || []; rows.push(clone(review)); reviews.set(review.goalId, rows); return clone(review); }
  function reviewHistory(goalId) { return (reviews.get(goalId) || []).map(clone); }
  return { addCandidate, create, get, getCandidate, history, list, listCandidates, putRelation, putReview, putStrategy, relationList, removeCandidate, reviewHistory, strategyHistory, update };
}

module.exports = { createGoalRegistry };
