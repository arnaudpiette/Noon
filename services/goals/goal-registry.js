"use strict";

const {
  GoalError,
  normalizeGoal,
} = require("./goal-schema");

function clone(value) {
  return value == null
    ? value
    : structuredClone(value);
}

function createGoalRegistry({
  repository = null,
} = {}) {
  const goals = new Map();
  const candidates = new Map();
  const versions = new Map();
  const relations = new Map();
  const strategies = new Map();
  const reviews = new Map();

  const persistent =
    repository?.loadState?.();

  if (persistent) {
    for (
      const goal of
      persistent.goals || []
    ) {
      goals.set(
        goal.goalId,
        clone(goal)
      );
    }

    for (
      const candidate of
      persistent.candidates || []
    ) {
      candidates.set(
        candidate.candidateId,
        clone(candidate)
      );
    }

    for (
      const goal of
      persistent.versions || []
    ) {
      const history =
        versions.get(goal.goalId) ||
        [];

      history.push(clone(goal));

      versions.set(
        goal.goalId,
        history
      );
    }

    for (
      const relation of
      persistent.relations || []
    ) {
      relations.set(
        relation.relationId,
        clone(relation)
      );
    }

    for (
      const strategy of
      persistent.strategies || []
    ) {
      const history =
        strategies.get(
          strategy.goalId
        ) || [];

      history.push(
        clone(strategy)
      );

      strategies.set(
        strategy.goalId,
        history
      );
    }

    for (
      const review of
      persistent.reviews || []
    ) {
      const history =
        reviews.get(review.goalId) ||
        [];

      history.push(clone(review));

      reviews.set(
        review.goalId,
        history
      );
    }
  } else if (repository?.load) {
    for (
      const goal of
      repository.load() || []
    ) {
      goals.set(
        goal.goalId,
        clone(goal)
      );
    }
  }

  function persistGoal(goal) {
    const value = clone(goal);

    if (repository?.saveGoal) {
      repository.saveGoal(value);
    } else {
      repository?.save?.(value);
    }
  }

  function save(goal) {
    persistGoal(goal);

    goals.set(
      goal.goalId,
      clone(goal)
    );

    return clone(goal);
  }

  function get(goalId) {
    const goal = goals.get(
      String(goalId || "")
    );

    if (!goal) {
      throw new GoalError(
        "GOAL_NOT_FOUND",
        "Objectif introuvable."
      );
    }

    return clone(goal);
  }

  function scoped(goal, scope = {}) {
    return (
      (
        !scope.profileScope ||
        goal.profileScope ===
          scope.profileScope
      ) &&
      (
        !scope.workspaceId ||
        goal.linkedWorkspaceIds.includes(
          scope.workspaceId
        )
      ) &&
      (
        !scope.projectId ||
        goal.linkedProjectIds.includes(
          scope.projectId
        )
      )
    );
  }

  function list(scope = {}) {
    return [...goals.values()]
      .filter(
        (goal) =>
          scoped(goal, scope)
      )
      .map(clone);
  }

  function create(input, options = {}) {
    const goal = normalizeGoal(
      input,
      options
    );

    if (goals.has(goal.goalId)) {
      throw new GoalError(
        "GOAL_EXISTS",
        "Cet objectif existe déjà."
      );
    }

    return save(goal);
  }

  function update(goalId, updater) {
    const current = get(goalId);

    const next =
      typeof updater === "function"
        ? updater(current)
        : {
            ...current,
            ...updater,
          };

    const normalized =
      normalizeGoal({
        ...next,
        goalId,
        createdAt:
          current.createdAt,
        updatedAt:
          new Date().toISOString(),
        version:
          current.version + 1,
        userConfirmed: true,
      });

    const persist = () => {
      repository?.saveVersion?.(
        clone(current)
      );

      persistGoal(normalized);
    };

    if (repository?.transaction) {
      repository.transaction(
        persist
      );
    } else {
      persist();
    }

    const history =
      versions.get(goalId) || [];

    history.push(
      clone(current)
    );

    versions.set(
      goalId,
      history
    );

    goals.set(
      normalized.goalId,
      clone(normalized)
    );

    return clone(normalized);
  }

  function addCandidate(candidate) {
    repository?.saveCandidate?.(
      clone(candidate)
    );

    candidates.set(
      candidate.candidateId,
      clone(candidate)
    );

    return clone(candidate);
  }

  function getCandidate(candidateId) {
    return clone(
      candidates.get(candidateId) ||
      null
    );
  }

  function removeCandidate(candidateId) {
    if (!candidates.has(candidateId)) {
      return false;
    }

    repository?.removeCandidate?.(
      candidateId
    );

    return candidates.delete(
      candidateId
    );
  }

  function listCandidates(scope = {}) {
    return [...candidates.values()]
      .filter(
        (item) =>
          !scope.profileScope ||
          item.profileScope ===
            scope.profileScope
      )
      .map(clone);
  }

  function history(goalId) {
    return (
      versions.get(goalId) || []
    ).map(clone);
  }

  function putStrategy(strategy) {
    repository?.saveStrategy?.(
      clone(strategy)
    );

    const rows =
      strategies.get(
        strategy.goalId
      ) || [];

    rows.push(clone(strategy));

    strategies.set(
      strategy.goalId,
      rows
    );

    return clone(strategy);
  }

  function strategyHistory(goalId) {
    return (
      strategies.get(goalId) || []
    ).map(clone);
  }

  function putRelation(relation) {
    repository?.saveRelation?.(
      clone(relation)
    );

    relations.set(
      relation.relationId,
      clone(relation)
    );

    return clone(relation);
  }

  function relationList() {
    return [
      ...relations.values(),
    ].map(clone);
  }

  function putReview(review) {
    repository?.saveReview?.(
      clone(review)
    );

    const rows =
      reviews.get(review.goalId) ||
      [];

    rows.push(clone(review));

    reviews.set(
      review.goalId,
      rows
    );

    return clone(review);
  }

  function reviewHistory(goalId) {
    return (
      reviews.get(goalId) || []
    ).map(clone);
  }

  return {
    addCandidate,
    create,
    get,
    getCandidate,
    history,
    list,
    listCandidates,
    putRelation,
    putReview,
    putStrategy,
    relationList,
    removeCandidate,
    reviewHistory,
    strategyHistory,
    update,
  };
}

module.exports = {
  createGoalRegistry,
};
