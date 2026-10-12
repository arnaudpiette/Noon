"use strict";

const {
  applyGoalModeUsage,
  createGoalModeRunState,
  transitionGoalModeRun,
} = require(
  "./goal-mode-run-state"
);

const {
  describeGoalModeRunRepository,
} = require(
  "../persistence/repositories/goal-mode-run-repository"
);

function fail(
  code,
  message
) {
  throw Object.assign(
    new Error(message),
    { code }
  );
}

function createGoalModeRunStore({
  repository,
  now =
    () =>
      new Date().toISOString(),
} = {}) {
  if (
    !repository ||
    typeof repository.latest !==
      "function" ||
    typeof repository.history !==
      "function" ||
    typeof repository.save !==
      "function"
  ) {
    throw new TypeError(
      "GoalModeRunRepository valide requis."
    );
  }

  function required(
    runId
  ) {
    const current =
      repository.latest(
        String(runId || "")
      );

    if (!current) {
      fail(
        "GOAL_MODE_RUN_NOT_FOUND",
        "Goal Run introuvable."
      );
    }

    return current;
  }

  function expectedRevision(
    value
  ) {
    if (
      !Number.isSafeInteger(
        value
      ) ||
      value < 1 ||
      value >=
        Number.MAX_SAFE_INTEGER
    ) {
      fail(
        "GOAL_MODE_RUN_REVISION_REQUIRED",
        "expectedRevision valide requis."
      );
    }

    return value;
  }

  function create(
    contract
  ) {
    const state =
      createGoalModeRunState({
        contract,

        createdAt:
          contract.admittedAt,
      });

    return repository.save(
      state,
      {
        expectedRevision: 0,
      }
    );
  }

  function get(
    runId
  ) {
    return required(
      runId
    );
  }

  function history(
    runId
  ) {
    return repository.history(
      String(runId || "")
    );
  }

  function transition(
    runId,
    nextStatus,
    input = {}
  ) {
    const revision =
      expectedRevision(
        input.expectedRevision
      );

    const current =
      required(
        runId
      );

    if (
      current.revision !==
        revision
    ) {
      fail(
        "GOAL_MODE_RUN_PERSISTENCE_CONFLICT",
        "Goal Run modifié concurremment."
      );
    }

    const next =
      transitionGoalModeRun(
        current.state,
        nextStatus,
        {
          reasonCode:
            input.reasonCode,

          transitionedAt:
            input.transitionedAt ||
            now(),
        }
      );

    return repository.save(
      next,
      {
        expectedRevision:
          revision,
      }
    );
  }

  function consume(
    runId,
    input = {}
  ) {
    const revision =
      expectedRevision(
        input.expectedRevision
      );

    const current =
      required(
        runId
      );

    if (
      current.revision !==
        revision
    ) {
      fail(
        "GOAL_MODE_RUN_PERSISTENCE_CONFLICT",
        "Goal Run modifié concurremment."
      );
    }

    const next =
      applyGoalModeUsage(
        current.state,
        {
          currentGoalVersion:
            input.currentGoalVersion,

          usageDelta:
            input.usageDelta,

          updatedAt:
            input.updatedAt ||
            now(),
        }
      );

    return repository.save(
      next,
      {
        expectedRevision:
          revision,
      }
    );
  }

  function persistenceCapabilities() {
    return describeGoalModeRunRepository(
      repository
    );
  }

  return Object.freeze({
    consume,
    create,
    get,
    history,
    persistenceCapabilities,
    transition,
  });
}

module.exports = {
  createGoalModeRunStore,
};
