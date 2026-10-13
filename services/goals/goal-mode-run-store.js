"use strict";

const crypto = require("node:crypto");

const {
  applyGoalModeUsage,
  createGoalModeRunState,
  markGoalModePlanningMayHaveStarted,
  markGoalModePlanningUnknown,
  reconcileGoalModePlanning,
  reserveGoalModePlanning,
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
  planningIdFactory = () => `goal-planning-${crypto.randomUUID()}`,
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

  if (typeof planningIdFactory !== "function") {
    throw new TypeError("planningIdFactory invalide.");
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

  function planningCurrent(runId, input) {
    if (typeof runId !== "string" || !runId.trim() || runId !== runId.trim() || runId.length > 200) {
      fail("GOAL_MODE_PLANNING_BINDING_INVALID", "runId de planning invalide.");
    }
    const revision = expectedRevision(input?.expectedRevision);
    const capabilities = persistenceCapabilities();
    if (capabilities.backend !== "SQLITE" || capabilities.atomicRevisionCas !== true) {
      fail("GOAL_MODE_PLANNING_ATOMIC_BACKEND_REQUIRED", "Backend atomique requis pour le planning.");
    }
    const current = required(runId);
    if (current.revision !== revision) {
      fail("GOAL_MODE_RUN_PERSISTENCE_CONFLICT", "Goal Run modifié concurremment.");
    }
    return current;
  }

  function reservePlanning(runId, input = {}) {
    const current = planningCurrent(runId, input);
    if (input?.binding?.runRevision !== current.revision) {
      fail("GOAL_MODE_PLANNING_BINDING_INVALID", "Révision de cible incohérente.");
    }
    const next = reserveGoalModePlanning(current.state, {
      reservationId: planningIdFactory(),
      binding: input.binding,
      reservedProviderCalls: input.reservedProviderCalls,
      reservedCost: input.reservedCost,
      reservedAt: now(),
    });
    return repository.save(next, { expectedRevision: current.revision });
  }

  function markPlanningMayHaveStarted(runId, input = {}) {
    const current = planningCurrent(runId, input);
    const next = markGoalModePlanningMayHaveStarted(current.state, {
      reservationId: input.reservationId,
      markedAt: now(),
    });
    return repository.save(next, { expectedRevision: current.revision });
  }

  function reconcilePlanning(runId, input = {}) {
    const current = planningCurrent(runId, input);
    const next = reconcileGoalModePlanning(current.state, {
      reservationId: input.reservationId,
      observedProviderCalls: input.observedProviderCalls,
      observedCost: input.observedCost,
      observationComplete: input.observationComplete,
      reconciledAt: now(),
    });
    return repository.save(next, { expectedRevision: current.revision });
  }

  function markPlanningUnknown(runId, input = {}) {
    const current = planningCurrent(runId, input);
    const next = markGoalModePlanningUnknown(current.state, {
      reservationId: input.reservationId,
      observedProviderCalls: input.observedProviderCalls,
      observedCost: input.observedCost,
      reasonCode: input.reasonCode,
      markedAt: now(),
    });
    return repository.save(next, { expectedRevision: current.revision });
  }

  return Object.freeze({
    consume,
    create,
    get,
    history,
    markPlanningMayHaveStarted,
    markPlanningUnknown,
    persistenceCapabilities,
    reconcilePlanning,
    reservePlanning,
    transition,
  });
}

module.exports = {
  createGoalModeRunStore,
};
