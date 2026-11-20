"use strict";

const crypto = require("node:crypto");

const {
  applyGoalModeUsage,
  createGoalModeRunState,
  markGoalModeExecutionMayHaveStarted,
  markGoalModeExecutionUnknown,
  markGoalModePlanningMayHaveStarted,
  markGoalModePlanningUnknown,
  reconcileGoalModePlanning,
  reconcileGoalModeExecution,
  releaseGoalModeExecution,
  reserveGoalModeExecution,
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

const {
  VERSION: DEV_PROJECTION_VERSION,
  deterministicGoalModeDevTaskId,
} = require("./goal-mode-dev-projection-service");

function fail(
  code,
  message
) {
  throw Object.assign(
    new Error(message),
    { code }
  );
}

function exactProjectionCopy(projection) {
  const visiting = new WeakSet();
  const copies = new WeakMap();
  let count = 0;
  function copy(value, depth = 0) {
    if (value === null || value === undefined || typeof value === "string" ||
        typeof value === "boolean" ||
        (typeof value === "number" && Number.isFinite(value))) return value;
    if (typeof value !== "object" || depth > 40 || visiting.has(value)) {
      fail("GOAL_MODE_EXECUTION_PROJECTION_INVALID", "Projection DEV non bornée.");
    }
    if (copies.has(value)) return copies.get(value);
    if (++count > 10_000 || (Array.isArray(value) && value.length > 10_000) ||
        (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype &&
         Object.getPrototypeOf(value) !== null)) {
      fail("GOAL_MODE_EXECUTION_PROJECTION_INVALID", "Projection DEV non structurée.");
    }
    const result = Array.isArray(value)
      ? new Array(value.length)
      : Object.create(Object.getPrototypeOf(value));
    copies.set(value, result);
    visiting.add(value);
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string" || ["__proto__", "constructor", "prototype"].includes(key)) {
        fail("GOAL_MODE_EXECUTION_PROJECTION_INVALID", "Projection DEV non structurée.");
      }
      if (Array.isArray(value) && key === "length") continue;
      const property = Object.getOwnPropertyDescriptor(value, key);
      if (!property?.enumerable || !Object.hasOwn(property, "value")) {
        fail("GOAL_MODE_EXECUTION_PROJECTION_INVALID", "Projection DEV non structurée.");
      }
      Object.defineProperty(result, key, {
        value: copy(property.value, depth + 1), enumerable: true,
        writable: false, configurable: false,
      });
    }
    visiting.delete(value);
    return Object.freeze(result);
  }
  return copy(projection);
}

function createGoalModeRunStore({
  repository,
  planningIdFactory = () => `goal-planning-${crypto.randomUUID()}`,
  devProjectionService = null,
  devObservationReader = null,
  devTaskLedger = null,
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

  if (devProjectionService !== null && typeof devProjectionService?.project !== "function") {
    throw new TypeError("Goal Mode DEV Projection invalide.");
  }
  if (devObservationReader !== null && typeof devObservationReader?.read !== "function") {
    throw new TypeError("Lecteur d'observations DEV invalide.");
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

  function executionCurrent(runId, input) {
    if (typeof runId !== "string" || !runId.trim() ||
        runId !== runId.trim() || runId.length > 200) {
      fail("GOAL_MODE_EXECUTION_BINDING_INVALID", "runId DEV invalide.");
    }
    const revision = expectedRevision(input?.expectedRevision);
    const capabilities = persistenceCapabilities();
    if (capabilities.backend !== "SQLITE" || capabilities.atomicRevisionCas !== true) {
      fail("GOAL_MODE_EXECUTION_ATOMIC_BACKEND_REQUIRED", "Backend atomique requis pour DEV.");
    }
    const current = required(runId);
    if (current.revision !== revision) {
      fail("GOAL_MODE_RUN_PERSISTENCE_CONFLICT", "Goal Run modifié concurremment.");
    }
    return current;
  }

  function reserveExecutionInternal(runId, input, includeExactProjection) {
    const current = executionCurrent(runId, input);
    if (typeof input.stepId !== "string" || !input.stepId.trim() ||
        input.stepId !== input.stepId.trim() || input.stepId.length > 200) {
      fail("GOAL_MODE_EXECUTION_BINDING_INVALID", "stepId DEV invalide.");
    }
    if (!devProjectionService) {
      fail("GOAL_MODE_EXECUTION_PROJECTION_REQUIRED", "Projection DEV canonique requise.");
    }
    // Refus anticipé : une réservation non résolue bloque avant toute
    // reprojection du contrat privé. L'état reste l'autorité au moment du save.
    const pending = Array.isArray(current.state.executionReservations)
      ? current.state.executionReservations : [];
    if (pending.some((item) => item?.status === "UNKNOWN")) {
      fail("GOAL_MODE_EXECUTION_UNKNOWN_BLOCKED", "Issue DEV incertaine.");
    }
    if (pending.some((item) => ["PREPARED", "MAY_HAVE_STARTED"].includes(item?.status))) {
      fail("GOAL_MODE_EXECUTION_IN_FLIGHT", "Réservation DEV non résolue.");
    }
    // Reprojection interne : aucun binding fourni par l'appelant n'est utilisé.
    const projection = devProjectionService.project({ runId, stepId: input.stepId });
    const runRef = projection?.runRef;
    const stepRef = projection?.stepRef;
    const upper = projection?.accounting?.stepUpperBound;
    const taskId = projection?.taskRef?.taskId;
    if (projection?.version !== DEV_PROJECTION_VERSION ||
        projection?.authority?.executionAuthorized !== false ||
        projection?.authority?.capabilitiesGranted !== false ||
        projection?.authorization?.capabilitiesGranted !== false ||
        projection?.accounting?.consumed !== false ||
        runRef?.runId !== runId || runRef?.runRevision !== current.revision ||
        runRef?.goalId !== current.state.contract.goalRef.goalId ||
        runRef?.goalVersion !== current.state.contract.goalRef.goalVersion ||
        stepRef?.stepId !== input.stepId ||
        typeof stepRef?.proposalFingerprint !== "string" ||
        taskId !== deterministicGoalModeDevTaskId(
          runId, input.stepId, stepRef.proposalFingerprint
        ) ||
        upper?.steps !== 1 || upper?.retries !== 0 ||
        !Number.isSafeInteger(upper?.providerCalls) || upper.providerCalls < 1 ||
        typeof upper?.estimatedCost !== "number" ||
        !Number.isFinite(upper.estimatedCost) || upper.estimatedCost <= 0) {
      fail("GOAL_MODE_EXECUTION_PROJECTION_INVALID", "Projection DEV incohérente.");
    }
    const binding = {
      runId, runRevision: current.revision,
      goalId: runRef.goalId, goalVersion: runRef.goalVersion,
      stepId: stepRef.stepId,
      proposalFingerprint: stepRef.proposalFingerprint,
      taskId, targetKind: stepRef.targetKind,
      targetId: stepRef.targetId,
      targetFingerprint: stepRef.targetFingerprint,
    };
    const next = reserveGoalModeExecution(current.state, {
      binding,
      reservedProviderCalls: upper.providerCalls,
      reservedCost: upper.estimatedCost,
      reservedAt: now(),
    });
    // Préparer la copie avant l'écriture : un contrat non copiable ne laisse
    // pas de réservation PREPARED sans remise possible. Ne la livrer qu'après CAS.
    const exactProjection = includeExactProjection ? exactProjectionCopy(projection) : null;
    const snapshot = repository.save(next, { expectedRevision: current.revision });
    if (!includeExactProjection) return snapshot;
    const saved = snapshot?.state?.executionReservations?.at(-1);
    if (saved?.status !== "PREPARED" || saved?.binding?.runRevision !== current.revision ||
        !Number.isSafeInteger(snapshot?.revision)) {
      fail("GOAL_MODE_EXECUTION_PROJECTION_INVALID", "Réservation DEV remise incohérente.");
    }
    return Object.freeze({
      snapshot,
      exactProjection,
      reservationId: saved.reservationId,
      reservedRevision: snapshot.revision,
    });
  }

  function reserveExecution(runId, input = {}) {
    return reserveExecutionInternal(runId, input, false);
  }

  function reserveExecutionWithExactProjection(runId, input = {}) {
    return reserveExecutionInternal(runId, input, true);
  }

  function markExecutionMayHaveStarted(runId, input = {}) {
    const current = executionCurrent(runId, input);
    const next = markGoalModeExecutionMayHaveStarted(current.state, {
      reservationId: input.reservationId,
      markedAt: now(),
    });
    return repository.save(next, { expectedRevision: current.revision });
  }

  function readExecutionObservation(record, requiredComplete) {
    /*
     * Le lecteur est fourni par la composition serveur, jamais par la
     * requête de reconciliation. Il devra joindre un résultat terminal
     * Native DEV et les entrées du budget DEV de cette tâche. La forme
     * seule ne prouve pas la véracité d'un résultat ou un confinement OS.
     * Sans ce producteur (4C-2), RECONCILED reste indisponible.
     */
    if (!devObservationReader) {
      if (requiredComplete) {
        fail("GOAL_MODE_EXECUTION_OBSERVATION_REQUIRED", "Lecteur DEV canonique requis.");
      }
      return {};
    }
    const observed = devObservationReader.read(Object.freeze({
      runId: record.binding.runId,
      stepId: record.binding.stepId,
      taskId: record.binding.taskId,
      reservationId: record.reservationId,
    }));
    if (observed === null && !requiredComplete) {
      return {};
    }
    if (!observed || typeof observed !== "object" ||
        observed.runId !== record.binding.runId ||
        observed.stepId !== record.binding.stepId ||
        observed.taskId !== record.binding.taskId ||
        observed.reservationId !== record.reservationId ||
        (requiredComplete &&
         (observed.terminal !== true || observed.complete !== true ||
          observed.stepEngaged !== true))) {
      fail("GOAL_MODE_EXECUTION_OBSERVATION_INVALID", "Observation DEV non liée ou incomplète.");
    }
    return {
      observedSteps: observed.stepEngaged === true ? 1 :
        observed.stepEngaged === false ? 0 : null,
      observedRetries: observed.retries ?? null,
      observedProviderCalls: observed.providerCalls ?? null,
      observedActualCost: observed.actualCost ?? null,
      accountedCost: observed.accountedCost ?? null,
      accountingUnit: observed.accountingUnit ?? null,
    };
  }

  function reconcileExecution(runId, input = {}) {
    const current = executionCurrent(runId, input);
    const record = current.state.executionReservations?.at(-1);
    if (!record || record.reservationId !== input.reservationId ||
        record.status !== "MAY_HAVE_STARTED") {
      fail("GOAL_MODE_EXECUTION_TRANSITION_INVALID", "Réconciliation DEV indisponible.");
    }
    const observation = readExecutionObservation(record, true);
    const next = reconcileGoalModeExecution(current.state, {
      reservationId: input.reservationId,
      ...observation,
      observationComplete: true,
      reconciledAt: now(),
    });
    return repository.save(next, { expectedRevision: current.revision });
  }

  /*
   * Libération explicite (jamais automatique) d'une réservation PREPARED.
   * Exige : backend atomique, révision exacte (CAS), dernière réservation
   * PREPARED, et ledger DEV à 0 appel pour sa tâche. Sans ledger, refus.
   * Une réservation MAY_HAVE_STARTED ou UNKNOWN n'est jamais libérable.
   */
  function releaseExecution(runId, input = {}) {
    const current = executionCurrent(runId, input);
    const record = current.state.executionReservations?.at(-1);
    if (!record || record.reservationId !== input.reservationId ||
        record.status !== "PREPARED") {
      fail("GOAL_MODE_EXECUTION_TRANSITION_INVALID", "Libération DEV indisponible.");
    }
    if (typeof devTaskLedger?.taskProviderCalls !== "function") {
      fail("GOAL_MODE_EXECUTION_RELEASE_LEDGER_REQUIRED", "Ledger DEV canonique requis.");
    }
    let calls;
    try { calls = devTaskLedger.taskProviderCalls(record.binding.taskId); } catch { calls = null; }
    if (!Number.isSafeInteger(calls) || calls !== 0) {
      fail("GOAL_MODE_EXECUTION_RELEASE_LEDGER_ENGAGED",
        "Le ledger DEV ne prouve pas l'absence d'engagement de cette tâche.");
    }
    const next = releaseGoalModeExecution(current.state, {
      reservationId: input.reservationId,
      releasedAt: now(),
    });
    return repository.save(next, { expectedRevision: current.revision });
  }

  function markExecutionUnknown(runId, input = {}) {
    const current = executionCurrent(runId, input);
    const record = current.state.executionReservations?.at(-1);
    if (!record || record.reservationId !== input.reservationId ||
        !["PREPARED", "MAY_HAVE_STARTED"].includes(record.status)) {
      fail("GOAL_MODE_EXECUTION_TRANSITION_INVALID", "Issue DEV incertaine indisponible.");
    }
    const observation = readExecutionObservation(record, false);
    const next = markGoalModeExecutionUnknown(current.state, {
      reservationId: input.reservationId,
      reasonCode: input.reasonCode,
      ...observation,
      markedAt: now(),
    });
    return repository.save(next, { expectedRevision: current.revision });
  }

  return Object.freeze({
    consume,
    create,
    get,
    history,
    markExecutionMayHaveStarted,
    markExecutionUnknown,
    markPlanningMayHaveStarted,
    markPlanningUnknown,
    persistenceCapabilities,
    reconcilePlanning,
    reconcileExecution,
    releaseExecution,
    reserveExecution,
    reserveExecutionWithExactProjection,
    reservePlanning,
    transition,
  });
}

module.exports = {
  createGoalModeRunStore,
};
