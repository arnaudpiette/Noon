"use strict";

const {
  assessGoalModeBudget,
  assessGoalModeCapabilityCeiling,
} = require(
  "./goal-mode-run-contract"
);

const {
  assertGoalModeStepProposalRecord,
} = require(
  "./goal-mode-step-proposal-store"
);

const VERSION =
  "goal-mode-step-admission-v1";

const DECISIONS =
  Object.freeze({
    ADMIT:
      "ADMIT",
    REQUIRE_USER_INPUT:
      "REQUIRE_USER_INPUT",
  });

function fail(
  code,
  message,
  details = null
) {
  const error =
    Object.assign(
      new Error(message),
      { code }
    );

  if (
    details !==
      null
  ) {
    error.details =
      details;
  }

  throw error;
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
    value !==
      value.trim() ||
    value.length > max
  ) {
    fail(
      "GOAL_MODE_STEP_ADMISSION_INVALID",
      `${label} invalide.`
    );
  }

  return value;
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
      "GOAL_MODE_STEP_ADMISSION_INVALID",
      `${label} invalide.`
    );
  }

  const own =
    Reflect.ownKeys(
      value
    );

  if (
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
      "GOAL_MODE_STEP_ADMISSION_INVALID",
      `${label} contient un champ non autorisé.`
    );
  }

  return value;
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

function assertCanonicalTarget(
  record,
  selection
) {
  if (
    selection?.decision !==
      "PLAN" ||
    selection
      .proposalRequired !==
      true ||
    selection.runRef
      ?.runId !==
      record.runRef
        .runId ||
    selection.runRef
      ?.goalId !==
      record.runRef
        .goalId ||
    selection.runRef
      ?.goalVersion !==
      record.runRef
        .goalVersion ||
    selection.runRef
      ?.runRevision !==
      record.planningRef
        .proposalRunRevision ||
    selection.target
      ?.kind !==
      record.planningRef
        .targetKind ||
    selection.target
      ?.targetId !==
      record.planningRef
        .targetId ||
    selection
      .targetFingerprint !==
      record.planningRef
        .targetFingerprint
  ) {
    fail(
      "GOAL_MODE_STEP_ADMISSION_TARGET_STALE",
      "La cible durable ne correspond plus à la cible canonique du Goal Run."
    );
  }
}

function requestedCapabilityNames(
  proposal
) {
  return Object.freeze(
    [
      "network",
      "gitWrite",
      "destructiveActions",
    ].filter(
      (key) =>
        proposal
          .requestedCapabilities
          ?.[key] ===
        true
    )
  );
}

function createGoalModeStepAdmissionService({
  runStore,
  stepProposalStore,
  nextStepPlanner,
  goalStrategyEngine,
  now =
    () =>
      new Date(),
} = {}) {
  if (
    typeof runStore?.get !==
      "function" ||
    typeof stepProposalStore
      ?.get !==
      "function" ||
    typeof nextStepPlanner
      ?.select !==
      "function" ||
    typeof goalStrategyEngine
      ?.registry?.get !==
      "function" ||
    typeof now !==
      "function"
  ) {
    throw new TypeError(
      "Dépendances Goal Mode Step Admission requises."
    );
  }

  function admit(
    input = {}
  ) {
    const source =
      exactObject(
        input,
        "admit",
        [
          "runId",
          "stepId",
        ]
      );

    const runId =
      requiredString(
        source.runId,
        "runId"
      );

    const stepId =
      requiredString(
        source.stepId,
        "stepId"
      );

    let snapshot;

    try {
      snapshot =
        runStore.get(
          runId
        );
    } catch (error) {
      if (
        error?.code ===
          "GOAL_MODE_RUN_NOT_FOUND"
      ) {
        fail(
          "GOAL_MODE_STEP_ADMISSION_RUN_MISSING",
          "Goal Run introuvable."
        );
      }

      throw error;
    }

    if (
      !snapshot ||
      !snapshot.state
    ) {
      fail(
        "GOAL_MODE_STEP_ADMISSION_RUN_MISSING",
        "Goal Run introuvable."
      );
    }

    if (
      snapshot.state.status !==
        "RUNNING"
    ) {
      fail(
        "GOAL_MODE_STEP_ADMISSION_RUN_NOT_RUNNING",
        "L'admission d'une étape exige un Goal Run RUNNING."
      );
    }

    const record =
      stepProposalStore.get(
        stepId
      );

    if (!record) {
      fail(
        "GOAL_MODE_STEP_ADMISSION_STEP_MISSING",
        "Proposition durable introuvable."
      );
    }

    assertGoalModeStepProposalRecord(
      record
    );

    if (
      record.runRef.runId !==
        runId ||
      record.runRef.goalId !==
        snapshot.state
          .contract
          .goalRef
          .goalId ||
      record.runRef.goalVersion !==
        snapshot.state
          .contract
          .goalRef
          .goalVersion
    ) {
      fail(
        "GOAL_MODE_STEP_ADMISSION_BINDING_INVALID",
        "La proposition durable n'appartient pas à ce Goal Run."
      );
    }

    /*
     * 5.0D-3 n'admet qu'une proposition produite
     * sur la révision EXACTEMENT courante.
     * Toute évolution du run impose une tranche
     * de reconciliation/recovery dédiée.
     */
    if (
      record.planningRef
        .proposalRunRevision !==
      snapshot.revision
    ) {
      fail(
        "GOAL_MODE_STEP_ADMISSION_SNAPSHOT_STALE",
        "Le Goal Run a évolué depuis la proposition durable."
      );
    }

    const goal =
      goalStrategyEngine
        .registry
        .get(
          record.runRef
            .goalId
        );

    if (
      !goal ||
      goal.status !==
        "ACTIVE" ||
      goal.userConfirmed !==
        true ||
      goal.version !==
        record.runRef
          .goalVersion
    ) {
      fail(
        "GOAL_MODE_STEP_ADMISSION_GOAL_STALE",
        "Le Goal autoritatif a changé ou n'est plus ACTIVE."
      );
    }

    /*
     * 5.0C refait ici ses vérifications
     * autoritatives : fingerprints du Goal,
     * roadmap, dépendances et cible.
     */
    const canonicalSelection =
      nextStepPlanner
        .select({
          runId,
        });

    assertCanonicalTarget(
      record,
      canonicalSelection
    );

    const observedAt =
      new Date(
        now()
      );

    if (
      !Number.isFinite(
        observedAt.getTime()
      ) ||
      observedAt.getTime() <
        Date.parse(
          snapshot.state
            .updatedAt
        )
    ) {
      fail(
        "GOAL_MODE_STEP_ADMISSION_CLOCK_INVALID",
        "Horloge d'admission invalide."
      );
    }

    /*
     * Recheck du budget FUTUR de l'étape.
     * Aucun compteur n'est consommé ici.
     */
    const budget =
      assessGoalModeBudget({
        contract:
          snapshot.state
            .contract,

        currentUsage:
          snapshot.state
            .usage,

        proposedUsage:
          record.proposal
            .usage,

        currentGoalVersion:
          goal.version,

        now:
          () =>
            observedAt,
      });

    if (
      budget.allowed !==
        true
    ) {
      fail(
        "GOAL_MODE_STEP_ADMISSION_BUDGET_BLOCKED",
        "La proposition durable ne tient plus dans le budget du Goal Run.",
        {
          assessment:
            budget,
        }
      );
    }

    /*
     * Recheck de la ceiling.
     * allowedToRequest signifie seulement
     * "peut être transmis au futur pipeline".
     * Cela n'accorde JAMAIS la capacité.
     */
    const capability =
      assessGoalModeCapabilityCeiling({
        contract:
          snapshot.state
            .contract,

        requestedCapabilities:
          record.proposal
            .requestedCapabilities,
      });

    if (
      capability
        .allowedToRequest !==
        true
    ) {
      fail(
        "GOAL_MODE_STEP_ADMISSION_CAPABILITY_DENIED",
        "La proposition durable demande une capacité hors ceiling.",
        {
          assessment:
            capability,
        }
      );
    }

    const requestedCapabilities =
      requestedCapabilityNames(
        record.proposal
      );

    const requiresUserInput =
      record.proposal
        .requiresUserInput ===
      true;

    const decision =
      requiresUserInput
        ? DECISIONS
            .REQUIRE_USER_INPUT
        : DECISIONS
            .ADMIT;

    return deepFreeze({
      version:
        VERSION,

      decision,

      runRef: {
        runId:
          record.runRef
            .runId,
        runRevision:
          snapshot.revision,
        goalId:
          record.runRef
            .goalId,
        goalVersion:
          record.runRef
            .goalVersion,
      },

      stepRef: {
        stepId:
          record.stepId,
        proposalId:
          record.proposal
            .proposalId,
        proposalFingerprint:
          record.proposal
            .fingerprint,
        targetKind:
          record.planningRef
            .targetKind,
        targetId:
          record.planningRef
            .targetId,
        targetFingerprint:
          record.planningRef
            .targetFingerprint,
      },

      budget: {
        decision:
          budget.decision,
        projected:
          budget.projected,
        remaining:
          budget.remaining,
        consumed:
          false,
      },

      capabilityAdmission: {
        requested:
          requestedCapabilities,
        allowedToRequest:
          true,
        externalAuthorizationRequired:
          capability
            .requiresExternalAuthorization ===
            true,
        capabilitiesGranted:
          false,
      },

      userInput: {
        required:
          requiresUserInput,
        approvalPrepared:
          false,
      },

      /*
       * Cette tranche n'a PAS assez
       * d'information pour construire une
       * ActionRequest OperationalSecurityPolicy.
       *
       * Une projection exacte devra fournir
       * skillId + operation + args + target
       * avant Permission/Approval.
       */
      nextBoundary: {
        exactActionProjectionRequired:
          true,
        operationalSecurityEvaluationRequired:
          true,
        interventionPermissionEvaluationRequired:
          true,
        approvalMayBeRequired:
          true,
      },

      authority: {
        executionAuthorized:
          false,
        capabilitiesGranted:
          false,
        approvalGranted:
          false,
        securityPipelineBypassed:
          false,
      },
    });
  }

  return Object.freeze({
    admit,
  });
}

module.exports = {
  DECISIONS,
  VERSION,
  createGoalModeStepAdmissionService,
};
