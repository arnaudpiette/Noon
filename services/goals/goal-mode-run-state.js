"use strict";

const {
  VERSION: CONTRACT_VERSION,
  assessGoalModeBudget,
} = require(
  "./goal-mode-run-contract"
);

const VERSION =
  "goal-mode-run-state-v1";

const STATUSES =
  Object.freeze([
    "READY",
    "RUNNING",
    "WAITING_APPROVAL",
    "PAUSED",
    "BLOCKED",
    "SUCCEEDED",
    "FAILED",
    "CANCELLED",
  ]);

const TERMINAL_STATUSES =
  new Set([
    "SUCCEEDED",
    "FAILED",
    "CANCELLED",
  ]);

const TRANSITIONS =
  Object.freeze({
    READY:
      new Set([
        "RUNNING",
        "CANCELLED",
      ]),

    RUNNING:
      new Set([
        "WAITING_APPROVAL",
        "PAUSED",
        "BLOCKED",
        "SUCCEEDED",
        "FAILED",
        "CANCELLED",
      ]),

    WAITING_APPROVAL:
      new Set([
        "RUNNING",
        "PAUSED",
        "BLOCKED",
        "CANCELLED",
      ]),

    PAUSED:
      new Set([
        "RUNNING",
        "BLOCKED",
        "CANCELLED",
      ]),

    BLOCKED:
      new Set([
        "RUNNING",
        "CANCELLED",
      ]),

    SUCCEEDED:
      new Set(),

    FAILED:
      new Set(),

    CANCELLED:
      new Set(),
  });

function fail(
  code,
  message,
  details = null
) {
  throw Object.assign(
    new Error(message),
    {
      code,
      ...(details === null
        ? {}
        : { details }),
    }
  );
}

function clone(
  value
) {
  return value == null
    ? value
    : structuredClone(value);
}

function deepFreeze(
  value
) {
  if (
    !value ||
    typeof value !== "object" ||
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
    typeof value === "object"
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

function same(
  left,
  right
) {
  return JSON.stringify(
    canonical(left)
  ) ===
    JSON.stringify(
      canonical(right)
    );
}

function requiredString(
  value,
  label,
  max = 200
) {
  if (
    typeof value !== "string" ||
    !value ||
    value !== value.trim() ||
    value.length > max
  ) {
    fail(
      "GOAL_MODE_RUN_STATE_INVALID",
      `${label} invalide.`
    );
  }

  return value;
}

function nullableString(
  value,
  label,
  max = 200
) {
  if (
    value === undefined ||
    value === null
  ) {
    return null;
  }

  return requiredString(
    value,
    label,
    max
  );
}

function iso(
  value,
  label
) {
  const parsed =
    Date.parse(
      String(value || "")
    );

  if (
    !Number.isFinite(parsed)
  ) {
    fail(
      "GOAL_MODE_RUN_TIME_INVALID",
      `${label} invalide.`
    );
  }

  return new Date(
    parsed
  ).toISOString();
}

function finite(
  value,
  label
) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0
  ) {
    fail(
      "GOAL_MODE_RUN_USAGE_INVALID",
      `${label} invalide.`
    );
  }

  return value;
}

function integer(
  value,
  label
) {
  if (
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    fail(
      "GOAL_MODE_RUN_USAGE_INVALID",
      `${label} invalide.`
    );
  }

  return value;
}

function assertContract(
  contract
) {
  if (
    !contract ||
    typeof contract !== "object" ||
    Array.isArray(contract) ||
    contract.version !==
      CONTRACT_VERSION
  ) {
    fail(
      "GOAL_MODE_RUN_CONTRACT_INVALID",
      "Contrat Goal Mode invalide."
    );
  }

  requiredString(
    contract.runId,
    "contract.runId"
  );

  requiredString(
    contract.goalRef?.goalId,
    "contract.goalRef.goalId"
  );

  if (
    !Number.isSafeInteger(
      contract.goalRef
        ?.goalVersion
    ) ||
    contract.goalRef
      .goalVersion < 1
  ) {
    fail(
      "GOAL_MODE_RUN_CONTRACT_INVALID",
      "contract.goalRef.goalVersion invalide."
    );
  }

  iso(
    contract.admittedAt,
    "contract.admittedAt"
  );

  if (
    contract.authority
      ?.executionAuthorized !==
        false ||
    contract.authority
      ?.capabilitiesGranted !==
        false ||
    contract.authority
      ?.securityPipelineBypassed !==
        false
  ) {
    fail(
      "GOAL_MODE_RUN_AUTHORITY_INVALID",
      "Le contrat Goal Mode ne peut porter aucune autorité d'exécution."
    );
  }

  return true;
}

function normalizeUsage(
  usage = {}
) {
  return Object.freeze({
    steps:
      integer(
        usage.steps ?? 0,
        "usage.steps"
      ),

    retries:
      integer(
        usage.retries ?? 0,
        "usage.retries"
      ),

    providerCalls:
      integer(
        usage.providerCalls ?? 0,
        "usage.providerCalls"
      ),

    estimatedCost:
      finite(
        usage.estimatedCost ?? 0,
        "usage.estimatedCost"
      ),
  });
}

function assertUsageWithinContract(
  usage,
  contract
) {
  if (
    usage.steps >
      contract.limits.maxSteps ||
    usage.retries >
      contract.limits.maxRetries ||
    usage.providerCalls >
      contract.limits
        .maxProviderCalls ||
    usage.estimatedCost >
      contract.limits
        .maxEstimatedCost
  ) {
    fail(
      "GOAL_MODE_RUN_USAGE_EXCEEDS_CONTRACT",
      "L'accounting Goal Run dépasse le contrat."
    );
  }
}

function createGoalModeRunState({
  contract,
  createdAt = null,
} = {}) {
  assertContract(
    contract
  );

  const created =
    iso(
      createdAt ||
        contract.admittedAt,
      "createdAt"
    );

  const usage =
    normalizeUsage();

  return deepFreeze({
    version:
      VERSION,

    runId:
      contract.runId,

    contract:
      clone(contract),

    status:
      "READY",

    reasonCode:
      null,

    createdAt:
      created,

    updatedAt:
      created,

    startedAt:
      null,

    completedAt:
      null,

    usage,

    /*
     * 5.0B ne stocke encore aucun approval,
     * aucune action et aucun résultat d'étape.
     *
     * Ces références seront ajoutées par
     * les tranches d'orchestration/recovery.
     */
    currentStepRef:
      null,
  });
}

function assertGoalModeRunState(
  state
) {
  if (
    !state ||
    typeof state !== "object" ||
    Array.isArray(state) ||
    state.version !== VERSION
  ) {
    fail(
      "GOAL_MODE_RUN_STATE_INVALID",
      "Goal Run State invalide."
    );
  }

  assertContract(
    state.contract
  );

  const runId =
    requiredString(
      state.runId,
      "runId"
    );

  if (
    state.contract.runId !==
      runId
  ) {
    fail(
      "GOAL_MODE_RUN_IDENTITY_MISMATCH",
      "runId divergent entre état et contrat."
    );
  }

  if (
    !STATUSES.includes(
      state.status
    )
  ) {
    fail(
      "GOAL_MODE_RUN_STATUS_INVALID",
      "Statut Goal Run invalide."
    );
  }

  const createdAt =
    iso(
      state.createdAt,
      "createdAt"
    );

  const updatedAt =
    iso(
      state.updatedAt,
      "updatedAt"
    );

  if (
    Date.parse(updatedAt) <
      Date.parse(createdAt)
  ) {
    fail(
      "GOAL_MODE_RUN_TIME_REWIND",
      "updatedAt ne peut précéder createdAt."
    );
  }

  const startedAt =
    state.startedAt == null
      ? null
      : iso(
          state.startedAt,
          "startedAt"
        );

  const completedAt =
    state.completedAt == null
      ? null
      : iso(
          state.completedAt,
          "completedAt"
        );

  if (
    state.status === "READY" &&
    startedAt !== null
  ) {
    fail(
      "GOAL_MODE_RUN_START_INVALID",
      "Un Goal Run READY ne peut être démarré."
    );
  }

  if (
    state.status !== "READY" &&
    state.status !== "CANCELLED" &&
    startedAt === null
  ) {
    fail(
      "GOAL_MODE_RUN_START_INVALID",
      "Un Goal Run actif ou terminé doit avoir startedAt."
    );
  }

  const terminal =
    TERMINAL_STATUSES.has(
      state.status
    );

  if (
    terminal !==
      (completedAt !== null)
  ) {
    fail(
      "GOAL_MODE_RUN_COMPLETION_INVALID",
      "completedAt incohérent avec le statut terminal."
    );
  }

  if (
    startedAt &&
    Date.parse(startedAt) <
      Date.parse(createdAt)
  ) {
    fail(
      "GOAL_MODE_RUN_TIME_REWIND",
      "startedAt ne peut précéder createdAt."
    );
  }

  if (
    completedAt &&
    startedAt &&
    Date.parse(completedAt) <
      Date.parse(startedAt)
  ) {
    fail(
      "GOAL_MODE_RUN_TIME_REWIND",
      "completedAt ne peut précéder startedAt."
    );
  }

  nullableString(
    state.reasonCode,
    "reasonCode",
    120
  );

  if (
    state.currentStepRef !==
      null
  ) {
    fail(
      "GOAL_MODE_RUN_STEP_REF_UNSUPPORTED",
      "5.0B ne persiste encore aucune référence d'étape."
    );
  }

  if (
    !state.usage ||
    typeof state.usage !==
      "object" ||
    Array.isArray(
      state.usage
    ) ||
    [
      "steps",
      "retries",
      "providerCalls",
      "estimatedCost",
    ].some(
      (key) =>
        !Object.hasOwn(
          state.usage,
          key
        ) ||
        state.usage[key] ==
          null
    )
  ) {
    fail(
      "GOAL_MODE_RUN_USAGE_INVALID",
      "L'accounting Goal Run doit être complet."
    );
  }

  const usage =
    normalizeUsage(
      state.usage
    );

  assertUsageWithinContract(
    usage,
    state.contract
  );

  return true;
}

function transitionGoalModeRun(
  state,
  nextStatus,
  {
    reasonCode = null,
    transitionedAt =
      new Date().toISOString(),
  } = {}
) {
  assertGoalModeRunState(
    state
  );

  if (
    !STATUSES.includes(
      nextStatus
    )
  ) {
    fail(
      "GOAL_MODE_RUN_STATUS_INVALID",
      "Statut Goal Run cible invalide."
    );
  }

  if (
    nextStatus ===
      state.status
  ) {
    fail(
      "GOAL_MODE_RUN_TRANSITION_INVALID",
      "Une transition doit changer le statut."
    );
  }

  if (
    !TRANSITIONS[
      state.status
    ]?.has(
      nextStatus
    )
  ) {
    fail(
      "GOAL_MODE_RUN_TRANSITION_INVALID",
      `Transition ${state.status} → ${nextStatus} interdite.`
    );
  }

  const at =
    iso(
      transitionedAt,
      "transitionedAt"
    );

  if (
    Date.parse(at) <
      Date.parse(
        state.updatedAt
      )
  ) {
    fail(
      "GOAL_MODE_RUN_TIME_REWIND",
      "Une transition ne peut remonter le temps."
    );
  }

  const next =
    clone(state);

  next.status =
    nextStatus;

  next.reasonCode =
    nullableString(
      reasonCode,
      "reasonCode",
      120
    );

  next.updatedAt =
    at;

  if (
    nextStatus ===
      "RUNNING" &&
    next.startedAt ===
      null
  ) {
    next.startedAt =
      at;
  }

  if (
    nextStatus ===
      "CANCELLED" &&
    next.startedAt ===
      null
  ) {
    /*
     * Annulation avant le premier démarrage :
     * l'état reste cohérent sans inventer
     * une exécution qui n'a jamais commencé.
     */
    next.completedAt =
      at;
  } else if (
    TERMINAL_STATUSES.has(
      nextStatus
    )
  ) {
    next.completedAt =
      at;
  }

  assertGoalModeRunState(
    next
  );

  return deepFreeze(
    next
  );
}

function applyGoalModeUsage(
  state,
  {
    currentGoalVersion,
    usageDelta,
    updatedAt =
      new Date().toISOString(),
  } = {}
) {
  assertGoalModeRunState(
    state
  );

  if (
    state.status !==
      "RUNNING"
  ) {
    fail(
      "GOAL_MODE_RUN_NOT_RUNNING",
      "L'accounting ne peut évoluer que pendant RUNNING."
    );
  }

  const at =
    iso(
      updatedAt,
      "updatedAt"
    );

  if (
    Date.parse(at) <
      Date.parse(
        state.updatedAt
      )
  ) {
    fail(
      "GOAL_MODE_RUN_TIME_REWIND",
      "L'accounting ne peut remonter le temps."
    );
  }

  const delta =
    normalizeUsage(
      usageDelta
    );

  const assessment =
    assessGoalModeBudget({
      contract:
        state.contract,

      currentUsage:
        state.usage,

      proposedUsage:
        delta,

      currentGoalVersion,

      now:
        () =>
          new Date(at),
    });

  if (
    assessment.allowed !==
      true
  ) {
    fail(
      "GOAL_MODE_RUN_BUDGET_BLOCKED",
      assessment.reasonCode,
      {
        assessment,
      }
    );
  }

  const next =
    clone(state);

  next.usage =
    clone(
      assessment.projected
    );

  next.updatedAt =
    at;

  assertGoalModeRunState(
    next
  );

  return deepFreeze(
    next
  );
}

function immutableProjection(
  state
) {
  return {
    version:
      state.version,

    runId:
      state.runId,

    contract:
      state.contract,

    createdAt:
      state.createdAt,

    currentStepRef:
      state.currentStepRef,
  };
}

function assertGoalModeRunForward(
  previous,
  next
) {
  assertGoalModeRunState(
    previous
  );

  assertGoalModeRunState(
    next
  );

  if (
    !same(
      immutableProjection(
        previous
      ),
      immutableProjection(
        next
      )
    )
  ) {
    fail(
      "GOAL_MODE_RUN_IMMUTABLE_CHANGED",
      "Identité ou contrat Goal Run modifié."
    );
  }

  if (
    Date.parse(
      next.updatedAt
    ) <
    Date.parse(
      previous.updatedAt
    )
  ) {
    fail(
      "GOAL_MODE_RUN_TIME_REWIND",
      "updatedAt ne peut reculer."
    );
  }

  for (
    const key of [
      "steps",
      "retries",
      "providerCalls",
      "estimatedCost",
    ]
  ) {
    if (
      next.usage[key] <
        previous.usage[key]
    ) {
      fail(
        "GOAL_MODE_RUN_USAGE_REWIND",
        `usage.${key} ne peut diminuer.`
      );
    }
  }

  const statusChanged =
    previous.status !==
      next.status;

  const usageChanged =
    !same(
      previous.usage,
      next.usage
    );

  if (
    statusChanged
  ) {
    if (
      !TRANSITIONS[
        previous.status
      ]?.has(
        next.status
      )
    ) {
      fail(
        "GOAL_MODE_RUN_TRANSITION_INVALID",
        `Transition ${previous.status} → ${next.status} interdite.`
      );
    }

    if (
      usageChanged
    ) {
      fail(
        "GOAL_MODE_RUN_ATOMIC_MUTATION_MIXED",
        "Une révision de transition ne peut aussi modifier l'accounting."
      );
    }
  } else if (
    usageChanged
  ) {
    if (
      previous.status !==
        "RUNNING" ||
      next.status !==
        "RUNNING"
    ) {
      fail(
        "GOAL_MODE_RUN_USAGE_STATE_INVALID",
        "L'accounting ne peut évoluer que pendant RUNNING."
      );
    }

    if (
      previous.reasonCode !==
        next.reasonCode ||
      previous.startedAt !==
        next.startedAt ||
      previous.completedAt !==
        next.completedAt
    ) {
      fail(
        "GOAL_MODE_RUN_USAGE_MUTATION_INVALID",
        "Une révision d'accounting ne peut modifier l'état du run."
      );
    }
  } else {
    fail(
      "GOAL_MODE_RUN_NOOP_REVISION",
      "Une nouvelle révision Goal Run doit modifier état ou accounting."
    );
  }

  if (
    previous.startedAt !==
      null &&
    next.startedAt !==
      previous.startedAt
  ) {
    fail(
      "GOAL_MODE_RUN_START_MUTATED",
      "startedAt est immuable une fois défini."
    );
  }

  if (
    previous.completedAt !==
      null &&
    next.completedAt !==
      previous.completedAt
  ) {
    fail(
      "GOAL_MODE_RUN_COMPLETION_MUTATED",
      "completedAt est immuable une fois défini."
    );
  }

  return true;
}

module.exports = {
  STATUSES,
  TERMINAL_STATUSES,
  TRANSITIONS,
  VERSION,
  applyGoalModeUsage,
  assertGoalModeRunForward,
  assertGoalModeRunState,
  createGoalModeRunState,
  transitionGoalModeRun,
};
