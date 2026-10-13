"use strict";

const crypto =
  require("node:crypto");

const VERSION =
  "goal-mode-step-proposal-record-v1";

function fail(
  code,
  message
) {
  throw Object.assign(
    new Error(message),
    { code }
  );
}

function clone(
  value
) {
  return value == null
    ? value
    : structuredClone(value);
}

function canonical(
  value
) {
  if (
    value === undefined ||
    value === null
  ) {
    return value ?? null;
  }

  if (
    Array.isArray(value)
  ) {
    return value.map(
      canonical
    );
  }

  if (
    typeof value ===
      "object"
  ) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(
          (key) => [
            key,
            canonical(
              value[key]
            ),
          ]
        )
    );
  }

  return value;
}

function fingerprint(
  value
) {
  return (
    "sha256:" +
    crypto
      .createHash("sha256")
      .update(
        JSON.stringify(
          canonical(
            value
          )
        )
      )
      .digest("hex")
  );
}

function deepFreeze(
  value
) {
  if (
    !value ||
    typeof value !==
      "object" ||
    Object.isFrozen(value)
  ) {
    return value;
  }

  for (
    const child of
      Object.values(value)
  ) {
    deepFreeze(child);
  }

  return Object.freeze(value);
}

function requiredString(
  value,
  label,
  max = 240
) {
  if (
    typeof value !==
      "string" ||
    !value.trim() ||
    value !== value.trim() ||
    value.length > max
  ) {
    fail(
      "GOAL_MODE_STEP_INVALID",
      `${label} invalide.`
    );
  }

  return value;
}

function validIso(
  value,
  label
) {
  const parsed =
    Date.parse(
      value || ""
    );

  if (
    !Number.isFinite(
      parsed
    )
  ) {
    fail(
      "GOAL_MODE_STEP_INVALID",
      `${label} invalide.`
    );
  }

  return new Date(
    parsed
  ).toISOString();
}

function exactObject(
  value,
  label,
  keys
) {
  if (
    !value ||
    typeof value !==
      "object" ||
    Array.isArray(value) ||
    (
      Object.getPrototypeOf(value) !==
        Object.prototype &&
      Object.getPrototypeOf(value) !==
        null
    )
  ) {
    fail(
      "GOAL_MODE_STEP_INVALID",
      `${label} invalide.`
    );
  }

  const own =
    Reflect.ownKeys(
      value
    );

  if (
    own.length !==
      keys.length ||
    own.some(
      (key) =>
        typeof key !==
          "string" ||
        !keys.includes(
          key
        )
    )
  ) {
    fail(
      "GOAL_MODE_STEP_INVALID",
      `${label} contient des champs inattendus.`
    );
  }

  return value;
}

function deterministicStepId(
  runId,
  reservationId
) {
  const digest =
    crypto
      .createHash("sha256")
      .update(
        `${runId}\0${reservationId}`
      )
      .digest("hex");

  return `goal-step-${digest}`;
}

function assertAuthority(
  authority
) {
  exactObject(
    authority,
    "authority",
    [
      "executionAuthorized",
      "capabilitiesGranted",
      "securityPipelineBypassed",
    ]
  );

  if (
    authority.executionAuthorized !==
      false ||
    authority.capabilitiesGranted !==
      false ||
    authority.securityPipelineBypassed !==
      false
  ) {
    fail(
      "GOAL_MODE_STEP_AUTHORITY_INVALID",
      "Une proposition durable ne peut porter aucune autorité."
    );
  }
}

function assertRecord(
  record
) {
  exactObject(
    record,
    "stepRecord",
    [
      "version",
      "stepId",
      "runRef",
      "planningRef",
      "selection",
      "proposal",
      "providerCall",
      "createdAt",
      "authority",
    ]
  );

  if (
    record.version !==
      VERSION
  ) {
    fail(
      "GOAL_MODE_STEP_VERSION_INVALID",
      "Version de proposition durable incompatible."
    );
  }

  const runRef =
    exactObject(
      record.runRef,
      "runRef",
      [
        "runId",
        "goalId",
        "goalVersion",
      ]
    );

  requiredString(
    runRef.runId,
    "runRef.runId"
  );

  requiredString(
    runRef.goalId,
    "runRef.goalId"
  );

  if (
    !Number.isSafeInteger(
      runRef.goalVersion
    ) ||
    runRef.goalVersion < 1
  ) {
    fail(
      "GOAL_MODE_STEP_INVALID",
      "runRef.goalVersion invalide."
    );
  }

  const planningRef =
    exactObject(
      record.planningRef,
      "planningRef",
      [
        "reservationId",
        "planningRunRevision",
        "proposalRunRevision",
        "targetKind",
        "targetId",
        "targetFingerprint",
      ]
    );

  requiredString(
    planningRef.reservationId,
    "planningRef.reservationId"
  );

  if (
    !Number.isSafeInteger(
      planningRef.planningRunRevision
    ) ||
    planningRef.planningRunRevision < 1 ||
    !Number.isSafeInteger(
      planningRef.proposalRunRevision
    ) ||
    planningRef.proposalRunRevision < 1 ||
    planningRef.proposalRunRevision <=
      planningRef.planningRunRevision
  ) {
    fail(
      "GOAL_MODE_STEP_INVALID",
      "Révisions de planning/proposition invalides."
    );
  }

  if (
    ![
      "MILESTONE",
      "SUCCESS_CRITERION",
    ].includes(
      planningRef.targetKind
    )
  ) {
    fail(
      "GOAL_MODE_STEP_INVALID",
      "planningRef.targetKind invalide."
    );
  }

  requiredString(
    planningRef.targetId,
    "planningRef.targetId"
  );

  if (
    !/^sha256:[a-f0-9]{64}$/.test(
      planningRef.targetFingerprint
    )
  ) {
    fail(
      "GOAL_MODE_STEP_INVALID",
      "planningRef.targetFingerprint invalide."
    );
  }

  const expectedStepId =
    deterministicStepId(
      runRef.runId,
      planningRef.reservationId
    );

  if (
    record.stepId !==
      expectedStepId
  ) {
    fail(
      "GOAL_MODE_STEP_IDENTITY_INVALID",
      "stepId ne correspond pas à la réservation de planning."
    );
  }

  const selection =
    record.selection;

  if (
    !selection ||
    typeof selection !==
      "object" ||
    selection.decision !==
      "PLAN" ||
    selection.proposalRequired !==
      true ||
    selection.runRef
      ?.runId !==
      runRef.runId ||
    selection.runRef
      ?.goalId !==
      runRef.goalId ||
    selection.runRef
      ?.goalVersion !==
      runRef.goalVersion ||
    selection.runRef
      ?.runRevision !==
      planningRef.proposalRunRevision ||
    selection.target
      ?.kind !==
      planningRef.targetKind ||
    selection.target
      ?.targetId !==
      planningRef.targetId ||
    selection.targetFingerprint !==
      planningRef.targetFingerprint ||
    selection.authority
      ?.executionAuthorized !==
      false ||
    selection.authority
      ?.capabilitiesGranted !==
      false
  ) {
    fail(
      "GOAL_MODE_STEP_SELECTION_INVALID",
      "Sélection durable incohérente."
    );
  }

  if (
    selection.targetFingerprint !==
      fingerprint(
        selection.target
      )
  ) {
    fail(
      "GOAL_MODE_STEP_SELECTION_INVALID",
      "Fingerprint de cible durable invalide."
    );
  }

  const proposal =
    record.proposal;

  if (
    !proposal ||
    typeof proposal !==
      "object" ||
    proposal.version !==
      "goal-mode-step-proposal-v1" ||
    proposal.binding
      ?.runId !==
      runRef.runId ||
    proposal.binding
      ?.goalId !==
      runRef.goalId ||
    proposal.binding
      ?.goalVersion !==
      runRef.goalVersion ||
    proposal.binding
      ?.runRevision !==
      planningRef.proposalRunRevision ||
    proposal.binding
      ?.targetKind !==
      planningRef.targetKind ||
    proposal.binding
      ?.targetId !==
      planningRef.targetId ||
    proposal.binding
      ?.targetFingerprint !==
      planningRef.targetFingerprint ||
    proposal.authority
      ?.proposalOnly !==
      true ||
    proposal.authority
      ?.executionAuthorized !==
      false ||
    proposal.authority
      ?.capabilitiesGranted !==
      false ||
    proposal.authorization
      ?.executionAuthorized !==
      false ||
    !/^sha256:[a-f0-9]{64}$/.test(
      proposal.fingerprint ||
        ""
    )
  ) {
    fail(
      "GOAL_MODE_STEP_PROPOSAL_INVALID",
      "Proposition 5.0C durable incohérente."
    );
  }

  const {
    fingerprint:
      proposalFingerprint,
    ...proposalPayload
  } = proposal;

  if (
    proposalFingerprint !==
      fingerprint(
        proposalPayload
      )
  ) {
    fail(
      "GOAL_MODE_STEP_PROPOSAL_INVALID",
      "Fingerprint de proposition durable invalide."
    );
  }

  const providerCall =
    exactObject(
      record.providerCall,
      "providerCall",
      [
        "reservationId",
        "provider",
        "model",
        "providerCalls",
        "reservedCost",
        "observedCost",
      ]
    );

  if (
    providerCall.reservationId !==
      planningRef.reservationId ||
    providerCall.providerCalls !==
      1 ||
    typeof providerCall.reservedCost !==
      "number" ||
    !Number.isFinite(
      providerCall.reservedCost
    ) ||
    providerCall.reservedCost < 0 ||
    typeof providerCall.observedCost !==
      "number" ||
    !Number.isFinite(
      providerCall.observedCost
    ) ||
    providerCall.observedCost < 0
  ) {
    fail(
      "GOAL_MODE_STEP_PROVIDER_CALL_INVALID",
      "Accounting provider durable invalide."
    );
  }

  requiredString(
    providerCall.provider,
    "providerCall.provider",
    80
  );

  requiredString(
    providerCall.model,
    "providerCall.model",
    160
  );

  validIso(
    record.createdAt,
    "createdAt"
  );

  assertAuthority(
    record.authority
  );

  return true;
}

function createRecord({
  runSnapshot,
  planningReservation,
  planningResult,
  createdAt,
} = {}) {
  const state =
    runSnapshot?.state;

  if (
    !state ||
    !Number.isSafeInteger(
      runSnapshot?.revision
    ) ||
    runSnapshot.revision < 1
  ) {
    fail(
      "GOAL_MODE_STEP_RUN_INVALID",
      "Snapshot Goal Run valide requis."
    );
  }

  const reservation =
    planningReservation;

  if (
    !reservation ||
    reservation.status !==
      "RECONCILED" ||
    reservation.observedProviderCalls !==
      1 ||
    typeof reservation.observedCost !==
      "number" ||
    !Number.isFinite(
      reservation.observedCost
    )
  ) {
    fail(
      "GOAL_MODE_STEP_PLANNING_NOT_RECONCILED",
      "Réservation de planning réconciliée requise."
    );
  }

  const result =
    planningResult;

  if (
    !result ||
    result.status !==
      "PROPOSED" ||
    !result.selection ||
    !result.proposal ||
    !result.providerCall
  ) {
    fail(
      "GOAL_MODE_STEP_RESULT_INVALID",
      "Résultat 5.0D-1 PROPOSED requis."
    );
  }

  const binding =
    reservation.binding;

  if (
    binding.runId !==
      state.runId ||
    binding.goalId !==
      state.contract
        .goalRef.goalId ||
    binding.goalVersion !==
      state.contract
        .goalRef.goalVersion ||
    result.providerCall
      .reservationId !==
      reservation.reservationId ||
    result.selection
      .targetFingerprint !==
      binding.targetFingerprint ||
    result.selection.target
      ?.kind !==
      binding.targetKind ||
    result.selection.target
      ?.targetId !==
      binding.targetId ||
    result.proposal.binding
      ?.runRevision !==
      runSnapshot.revision
  ) {
    fail(
      "GOAL_MODE_STEP_BINDING_INVALID",
      "Résultat 5.0D-1 non lié au snapshot/réservation canoniques."
    );
  }

  const at =
    validIso(
      createdAt,
      "createdAt"
    );

  if (
    Date.parse(at) <
      Date.parse(
        reservation.closedAt
      )
  ) {
    fail(
      "GOAL_MODE_STEP_TIME_INVALID",
      "La proposition durable ne peut précéder la réconciliation du planning."
    );
  }

  const record =
    {
      version:
        VERSION,

      stepId:
        deterministicStepId(
          state.runId,
          reservation
            .reservationId
        ),

      runRef: {
        runId:
          state.runId,
        goalId:
          state.contract
            .goalRef.goalId,
        goalVersion:
          state.contract
            .goalRef.goalVersion,
      },

      planningRef: {
        reservationId:
          reservation
            .reservationId,
        planningRunRevision:
          binding.runRevision,
        proposalRunRevision:
          runSnapshot.revision,
        targetKind:
          binding.targetKind,
        targetId:
          binding.targetId,
        targetFingerprint:
          binding.targetFingerprint,
      },

      selection:
        clone(
          result.selection
        ),

      proposal:
        clone(
          result.proposal
        ),

      providerCall: {
        reservationId:
          reservation
            .reservationId,
        provider:
          result.providerCall
            .provider,
        model:
          result.providerCall
            .model,
        providerCalls: 1,
        reservedCost:
          reservation
            .reservedCost,
        observedCost:
          reservation
            .observedCost,
      },

      createdAt:
        at,

      authority: {
        executionAuthorized:
          false,
        capabilitiesGranted:
          false,
        securityPipelineBypassed:
          false,
      },
    };

  assertRecord(
    record
  );

  return deepFreeze(
    record
  );
}

function createGoalModeStepProposalStore({
  repository,
  now =
    () =>
      new Date(),
} = {}) {
  if (
    typeof repository?.get !==
      "function" ||
    typeof repository
      ?.getForReservation !==
      "function" ||
    typeof repository
      ?.save !==
      "function" ||
    typeof repository
      ?.capabilities !==
      "function" ||
    typeof now !==
      "function"
  ) {
    throw new TypeError(
      "GoalModeStepProposalRepository valide requis."
    );
  }

  function get(
    stepId
  ) {
    return repository.get(
      requiredString(
        stepId,
        "stepId"
      )
    );
  }

  function getForReservation(
    runId,
    reservationId
  ) {
    const stepId =
      deterministicStepId(
        requiredString(
          runId,
          "runId"
        ),
        requiredString(
          reservationId,
          "reservationId"
        )
      );

    return repository
      .getForReservation(
        stepId,
        runId,
        reservationId
      );
  }

  function saveFromPlanning({
    runSnapshot,
    planningReservation,
    planningResult,
  } = {}) {
    const capabilities =
      repository.capabilities();

    if (
      capabilities.backend !==
        "SQLITE" ||
      capabilities.atomicCreate !==
        true
    ) {
      fail(
        "GOAL_MODE_STEP_ATOMIC_BACKEND_REQUIRED",
        "Backend SQLite atomique requis pour persister une proposition Goal Mode."
      );
    }

    const record =
      createRecord({
        runSnapshot,
        planningReservation,
        planningResult,
        createdAt:
          now(),
      });

    return repository.save(
      record
    );
  }

  function capabilities() {
    return repository
      .capabilities();
  }

  return Object.freeze({
    capabilities,
    get,
    getForReservation,
    saveFromPlanning,
  });
}

module.exports = {
  VERSION,
  assertGoalModeStepProposalRecord:
    assertRecord,
  createGoalModeStepProposalRecord:
    createRecord,
  createGoalModeStepProposalStore,
  deterministicGoalModeStepId:
    deterministicStepId,
};
