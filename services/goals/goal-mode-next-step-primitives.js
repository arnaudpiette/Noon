"use strict";

// V3-L7 — constantes et primitives du planificateur de prochaine étape Goal Mode (version,
// statuts de jalons, clés de proposition, erreurs, gel profond, forme canonique, empreinte,
// contrôles de chaînes et d'objets stricts, instantané de run), sorties telles quelles de
// goal-mode-next-step-planner.js. Fonctions pures et constantes ; le planificateur réexporte
// les mêmes valeurs.

const crypto =
  require("node:crypto");

const {
  assertGoalModeRunState,
} = require(
  "./goal-mode-run-state"
);

const VERSION =
  "goal-mode-next-step-planner-v1";

const actionableMilestoneStatuses =
  new Set([
    "NOT_STARTED",
    "IN_PROGRESS",
    "DELAYED",
  ]);

const terminalMilestoneStatuses =
  new Set([
    "ACHIEVED",
    "SKIPPED",
  ]);

/*
 * Exposés pour inspection seulement. Ces copies ne partagent jamais
 * les ensembles opérationnels utilisés par le planner.
 */
const ACTIONABLE_MILESTONE_STATUSES =
  Object.freeze([
    ...actionableMilestoneStatuses,
  ]);

const TERMINAL_MILESTONE_STATUSES =
  Object.freeze([
    ...terminalMilestoneStatuses,
  ]);

const PROPOSAL_KEYS =
  Object.freeze([
    "objective",
    "expectedOutcome",
    "evidenceTargetIds",
    "usage",
    "requestedCapabilities",
    "requiresUserInput",
  ]);

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

function requiredString(
  value,
  label,
  max = 1200
) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value !== value.trim() ||
    value.length > max
  ) {
    fail(
      "GOAL_MODE_NEXT_STEP_INVALID",
      `${label} invalide.`
    );
  }

  return value;
}

function strictObject(
  value,
  label,
  allowedKeys
) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (
      Object.getPrototypeOf(value) !==
        Object.prototype &&
      Object.getPrototypeOf(value) !==
        null
    )
  ) {
    fail(
      "GOAL_MODE_NEXT_STEP_INVALID",
      `${label} invalide.`
    );
  }

  for (
    const key of
    Reflect.ownKeys(value)
  ) {
    if (
      typeof key !==
        "string" ||
      !allowedKeys.includes(
        key
      )
    ) {
      fail(
        "GOAL_MODE_NEXT_STEP_FIELD_FORBIDDEN",
        `${label}.${key} non autorisé.`
      );
    }
  }

  return value;
}

function assertRunSnapshot(
  runSnapshot,
  runId
) {
  if (
    !runSnapshot ||
    typeof runSnapshot !==
      "object" ||
    Array.isArray(
      runSnapshot
    )
  ) {
    fail(
      "GOAL_MODE_NEXT_STEP_RUN_INVALID",
      "Snapshot Goal Run requis."
    );
  }

  if (
    !Number.isSafeInteger(
      runSnapshot.revision
    ) ||
    runSnapshot.revision < 1
  ) {
    fail(
      "GOAL_MODE_NEXT_STEP_RUN_REVISION_INVALID",
      "Révision Goal Run valide requise."
    );
  }

  try {
    assertGoalModeRunState(
      runSnapshot.state
    );
  } catch (error) {
    if (
      error?.code ===
        "GOAL_MODE_RUN_USAGE_INVALID"
    ) {
      fail(
        "GOAL_MODE_NEXT_STEP_USAGE_UNKNOWN",
        "Accounting Goal Run incomplet."
      );
    }

    throw error;
  }

  const usage =
    runSnapshot.state.usage;

  if (
    !usage ||
    typeof usage !== "object" ||
    Array.isArray(usage) ||
    [
      "steps",
      "retries",
      "providerCalls",
    ].some(
      (key) =>
        !Number.isSafeInteger(
          usage[key]
        ) ||
        usage[key] < 0
    ) ||
    typeof usage.estimatedCost !==
      "number" ||
    !Number.isFinite(
      usage.estimatedCost
    ) ||
    usage.estimatedCost < 0
  ) {
    fail(
      "GOAL_MODE_NEXT_STEP_USAGE_UNKNOWN",
      "Accounting Goal Run incomplet."
    );
  }

  if (
    runSnapshot.state.runId !==
    runId
  ) {
    fail(
      "GOAL_MODE_NEXT_STEP_RUN_INVALID",
      "Le Goal Run chargé ne correspond pas au runId demandé."
    );
  }

  if (
    runSnapshot.state.status !==
      "RUNNING"
  ) {
    fail(
      "GOAL_MODE_NEXT_STEP_RUN_NOT_RUNNING",
      "Le planning Goal Mode exige un run RUNNING."
    );
  }

  return runSnapshot;
}

module.exports = {
  VERSION,
  actionableMilestoneStatuses,
  terminalMilestoneStatuses,
  ACTIONABLE_MILESTONE_STATUSES,
  TERMINAL_MILESTONE_STATUSES,
  PROPOSAL_KEYS,
  fail,
  deepFreeze,
  clone,
  canonical,
  fingerprint,
  requiredString,
  strictObject,
  assertRunSnapshot,
};
