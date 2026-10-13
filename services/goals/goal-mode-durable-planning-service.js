"use strict";

function fail(
  code,
  message,
  cause = null
) {
  throw Object.assign(
    new Error(
      message,
      cause
        ? { cause }
        : undefined
    ),
    { code }
  );
}

function requiredString(
  value,
  label
) {
  if (
    typeof value !==
      "string" ||
    !value.trim() ||
    value !==
      value.trim() ||
    value.length > 200
  ) {
    fail(
      "GOAL_MODE_DURABLE_PLANNING_INVALID",
      `${label} invalide.`
    );
  }

  return value;
}

function latestReservation(
  snapshot
) {
  const records =
    snapshot?.state
      ?.planningReservations;

  if (
    !Array.isArray(
      records
    ) ||
    records.length === 0
  ) {
    return null;
  }

  return records.at(-1);
}

function recoveredResult(
  record
) {
  return Object.freeze({
    version:
      "goal-mode-durable-planning-v1",

    status:
      "PROPOSED",

    recovered:
      true,

    selection:
      record.selection,

    proposal:
      record.proposal,

    providerCall: {
      ...record.providerCall,
    },

    stepRecord:
      record,

    authority: {
      executionAuthorized:
        false,
      capabilitiesGranted:
        false,
      securityPipelineBypassed:
        false,
    },
  });
}

function createGoalModeDurablePlanningService({
  runStore,
  planningCallService,
  stepProposalStore,
} = {}) {
  if (
    typeof runStore?.get !==
      "function" ||
    typeof planningCallService
      ?.planOnce !==
      "function" ||
    typeof stepProposalStore
      ?.getForReservation !==
      "function" ||
    typeof stepProposalStore
      ?.saveFromPlanning !==
      "function" ||
    typeof stepProposalStore
      ?.capabilities !==
      "function"
  ) {
    throw new TypeError(
      "Dépendances Durable Goal Planning requises."
    );
  }

  const capabilities =
    stepProposalStore
      .capabilities();

  if (
    capabilities.backend !==
      "SQLITE" ||
    capabilities.atomicCreate !==
      true
  ) {
    throw new TypeError(
      "Durable Goal Planning exige un StepProposalStore SQLite atomique."
    );
  }

  function recoverIfPresent(
    runId,
    snapshot
  ) {
    const reservation =
      latestReservation(
        snapshot
      );

    if (!reservation) {
      return null;
    }

    if (
      [
        "PREPARED",
        "MAY_HAVE_STARTED",
        "UNKNOWN",
      ].includes(
        reservation.status
      )
    ) {
      return null;
    }

    if (
      reservation.status !==
        "RECONCILED"
    ) {
      fail(
        "GOAL_MODE_DURABLE_PLANNING_STATE_INVALID",
        "État de réservation de planning inattendu."
      );
    }

    const record =
      stepProposalStore
        .getForReservation(
          runId,
          reservation
            .reservationId
        );

    if (!record) {
      fail(
        "GOAL_MODE_STEP_RECOVERY_REQUIRED",
        "Un planning a été facturé/réconcilié sans proposition durable. Replanification automatique interdite."
      );
    }

    if (
      record.planningRef
        .proposalRunRevision !==
        snapshot.revision
    ) {
      fail(
        "GOAL_MODE_STEP_SNAPSHOT_ADVANCED",
        "Le Goal Run a évolué après la proposition durable ; cette tranche ne peut pas la rejouer automatiquement."
      );
    }

    return recoveredResult(
      record
    );
  }

  async function planOnce(
    input = {}
  ) {
    const runId =
      requiredString(
        input?.runId,
        "runId"
      );

    const before =
      runStore.get(
        runId
      );

    const recovered =
      recoverIfPresent(
        runId,
        before
      );

    if (recovered) {
      return recovered;
    }

    const result =
      await planningCallService
        .planOnce(
          input
        );

    if (
      result?.status !==
        "PROPOSED"
    ) {
      return Object.freeze({
        ...result,
        recovered:
          false,
        stepRecord:
          null,
      });
    }

    const after =
      runStore.get(
        runId
      );

    const reservation =
      latestReservation(
        after
      );

    if (
      !reservation ||
      reservation.status !==
        "RECONCILED" ||
      reservation
        .reservationId !==
        result.providerCall
          ?.reservationId
    ) {
      fail(
        "GOAL_MODE_STEP_PLANNING_RESULT_UNBOUND",
        "Le résultat 5.0D-1 n'est pas lié à une réservation réconciliée canonique."
      );
    }

    let persisted;

    try {
      persisted =
        stepProposalStore
          .saveFromPlanning({
            runSnapshot:
              after,
            planningReservation:
              reservation,
            planningResult:
              result,
          });
    } catch (error) {
      /*
       * Un crash/IO après COMMIT peut rendre
       * l'issue de l'appel save() incertaine.
       * Relire l'identité déterministe avant
       * de déclarer l'échec.
       */
      const recoveredAfterError =
        stepProposalStore
          .getForReservation(
            runId,
            reservation
              .reservationId
          );

      if (
        recoveredAfterError &&
        recoveredAfterError
          .proposal
          .fingerprint ===
          result.proposal
            .fingerprint
      ) {
        persisted = {
          created:
            false,
          record:
            recoveredAfterError,
        };
      } else {
        fail(
          "GOAL_MODE_STEP_PERSISTENCE_UNCERTAIN",
          "La proposition validée n'a pas pu être confirmée durablement. Toute replanification automatique est interdite.",
          error
        );
      }
    }

    return Object.freeze({
      version:
        "goal-mode-durable-planning-v1",

      status:
        "PROPOSED",

      recovered:
        persisted.created !==
          true,

      selection:
        persisted.record
          .selection,

      proposal:
        persisted.record
          .proposal,

      providerCall:
        persisted.record
          .providerCall,

      stepRecord:
        persisted.record,

      authority: {
        executionAuthorized:
          false,
        capabilitiesGranted:
          false,
        securityPipelineBypassed:
          false,
      },
    });
  }

  return Object.freeze({
    planOnce,
  });
}

module.exports = {
  createGoalModeDurablePlanningService,
};
