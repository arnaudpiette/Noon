"use strict";

const crypto =
  require("node:crypto");

const {
  GoalError,
} = require("./goal-schema");

const VERSION =
  "goal-mode-run-contract-v1";

const GLOBAL_LIMIT_KEYS =
  Object.freeze([
    "maxSteps",
    "maxRetries",
    "maxProviderCalls",
    "maxDuration",
    "maxEstimatedCost",
  ]);

const CAPABILITY_CEILING_KEYS =
  Object.freeze([
    "network",
    "gitWrite",
    "destructiveActions",
  ]);

function fail(
  code,
  message
) {
  throw new GoalError(
    code,
    message
  );
}

function object(
  value,
  label,
  allowedKeys = null
) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    fail(
      "GOAL_MODE_CONTRACT_INVALID",
      `${label} invalide.`
    );
  }

  if (allowedKeys) {
    for (
      const key of
        Object.keys(value)
    ) {
      if (
        !allowedKeys.includes(key)
      ) {
        fail(
          "GOAL_MODE_CONTRACT_INVALID",
          `${label}.${key} non autorisé.`
        );
      }
    }
  }

  return value;
}

function identifier(
  value,
  label
) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value !== value.trim() ||
    value.length > 200
  ) {
    fail(
      "GOAL_MODE_REFERENCE_INVALID",
      `${label} invalide.`
    );
  }

  return value;
}

function safeInteger(
  value,
  label,
  {
    min = 0,
  } = {}
) {
  if (
    !Number.isSafeInteger(value) ||
    value < min
  ) {
    fail(
      "GOAL_MODE_LIMIT_INVALID",
      `${label} invalide.`
    );
  }

  return value;
}

function finiteCost(
  value,
  label
) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0
  ) {
    fail(
      "GOAL_MODE_LIMIT_INVALID",
      `${label} invalide.`
    );
  }

  return value;
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

function canonicalize(
  value
) {
  if (
    value === undefined ||
    value === null
  ) {
    return null;
  }

  if (
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (
    typeof value === "number"
  ) {
    return Number.isFinite(value)
      ? value
      : null;
  }

  if (
    Array.isArray(value)
  ) {
    return value.map(
      canonicalize
    );
  }

  if (
    typeof value === "object"
  ) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter(
          (key) =>
            value[key] !==
              undefined
        )
        .map(
          (key) => [
            key,
            canonicalize(
              value[key]
            ),
          ]
        )
    );
  }

  return String(value);
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
          canonicalize(
            value
          )
        )
      )
      .digest("hex")
  );
}

function normalizeGoal(
  goal
) {
  object(
    goal,
    "goal"
  );

  if (
    goal.status !==
      "ACTIVE" ||
    goal.userConfirmed !==
      true
  ) {
    fail(
      "GOAL_MODE_GOAL_NOT_ACTIVE",
      "Goal Mode exige un objectif ACTIVE explicitement confirmé."
    );
  }

  const successCriteria =
    Array.isArray(
      goal.successCriteria
    )
      ? goal.successCriteria
      : [];

  if (
    successCriteria.length ===
      0
  ) {
    fail(
      "GOAL_MODE_SUCCESS_CRITERIA_REQUIRED",
      "Goal Mode exige au moins un critère de succès explicite."
    );
  }

  for (
    const criterion of
      successCriteria
  ) {
    if (
      !criterion ||
      typeof criterion !==
        "object" ||
      Array.isArray(
        criterion
      ) ||
      !String(
        criterion.criterionId ||
        ""
      ).trim()
    ) {
      fail(
        "GOAL_MODE_SUCCESS_CRITERIA_INVALID",
        "Chaque critère de succès doit avoir un criterionId."
      );
    }
  }

  return goal;
}

function normalizeLimits(
  raw
) {
  const limits =
    object(
      raw,
      "request.limits",
      GLOBAL_LIMIT_KEYS
    );

  for (
    const required of
      GLOBAL_LIMIT_KEYS
  ) {
    if (
      limits[required] ===
        undefined ||
      limits[required] ===
        null
    ) {
      fail(
        "GOAL_MODE_LIMIT_REQUIRED",
        `${required} requis pour une autonomie bornée.`
      );
    }
  }

  return Object.freeze({
    /*
     * Ces compteurs couvrent le Goal Run ENTIER.
     *
     * Ils ne remplacent jamais :
     * - le maxSteps interne de TransactionalExecutionEngine ;
     * - les maxIterations/maxDuration/coût d'une tâche Goal DEV ;
     * - les limites d'une GoalDevRetryChain.
     *
     * Les sous-moteurs restent autoritatifs sur leurs propres budgets.
     */
    maxSteps:
      safeInteger(
        limits.maxSteps,
        "maxSteps",
        {
          min: 1,
        }
      ),

    maxRetries:
      safeInteger(
        limits.maxRetries,
        "maxRetries"
      ),

    maxProviderCalls:
      safeInteger(
        limits.maxProviderCalls,
        "maxProviderCalls"
      ),

    maxDuration:
      safeInteger(
        limits.maxDuration,
        "maxDuration",
        {
          min: 1_000,
        }
      ),

    maxEstimatedCost:
      finiteCost(
        limits.maxEstimatedCost,
        "maxEstimatedCost"
      ),
  });
}

function normalizeCapabilityCeilings(
  raw,
  {
    localOnly,
  }
) {
  const source =
    raw === undefined
      ? {}
      : object(
          raw,
          "request.capabilityCeilings",
          CAPABILITY_CEILING_KEYS
        );

  const normalized =
    Object.freeze({
      network:
        source.network ===
          true,

      gitWrite:
        source.gitWrite ===
          true,

      destructiveActions:
        source.destructiveActions ===
          true,
    });

  if (
    localOnly &&
    normalized.network
  ) {
    fail(
      "GOAL_MODE_LOCAL_ONLY_NETWORK_CONFLICT",
      "Un Goal Mode local_only ne peut pas autoriser la demande de capacité réseau."
    );
  }

  return normalized;
}

function normalizeScope(
  goal,
  request
) {
  const workspaceId =
    request.workspaceId ==
      null
      ? null
      : identifier(
          request.workspaceId,
          "workspaceId"
        );

  const projectId =
    request.projectId ==
      null
      ? null
      : identifier(
          request.projectId,
          "projectId"
        );

  const linkedWorkspaces =
    Array.isArray(
      goal.linkedWorkspaceIds
    )
      ? goal.linkedWorkspaceIds
          .map(String)
      : [];

  if (
    workspaceId &&
    linkedWorkspaces.length &&
    !linkedWorkspaces.includes(
      workspaceId
    )
  ) {
    fail(
      "GOAL_MODE_WORKSPACE_MISMATCH",
      "Le workspace Goal Mode n'est pas lié à cet objectif."
    );
  }

  const linkedProjects =
    Array.isArray(
      goal.linkedProjectIds
    )
      ? goal.linkedProjectIds
          .map(String)
      : [];

  if (
    projectId &&
    linkedProjects.length &&
    !linkedProjects.includes(
      projectId
    )
  ) {
    fail(
      "GOAL_MODE_PROJECT_MISMATCH",
      "Le projet Goal Mode n'est pas lié à cet objectif."
    );
  }

  return Object.freeze({
    profileScope:
      String(
        goal.profileScope ||
        "arnaud"
      ).slice(
        0,
        80
      ),

    workspaceId,
    projectId,
  });
}

function createGoalModeRunContract({
  goal,
  request,
  now =
    () =>
      new Date(),
  idFactory =
    () =>
      `goal-run-${crypto.randomUUID()}`,
} = {}) {
  const normalizedGoal =
    normalizeGoal(
      goal
    );

  const source =
    object(
      request,
      "request",
      [
        "userConfirmed",
        "workspaceId",
        "projectId",
        "limits",
        "capabilityCeilings",
        "localOnly",
      ]
    );

  if (
    source.userConfirmed !==
      true
  ) {
    fail(
      "GOAL_MODE_RUN_CONFIRMATION_REQUIRED",
      "Le lancement autonome Goal Mode exige une confirmation explicite."
    );
  }

  const runId =
    identifier(
      idFactory(),
      "runId"
    );

  const admittedAt =
    new Date(
      now()
    ).toISOString();

  const localOnly =
    source.localOnly ===
      true ||
    normalizedGoal
      .sensitivity ===
      "LOCAL_ONLY";

  const limits =
    normalizeLimits(
      source.limits
    );

  const capabilityCeilings =
    normalizeCapabilityCeilings(
      source.capabilityCeilings,
      {
        localOnly,
      }
    );

  const successCriteriaProjection =
    normalizedGoal
      .successCriteria
      .map(
        (criterion) => ({
          criterionId:
            String(
              criterion.criterionId
            ),

          type:
            criterion.type ||
            null,

          targetValue:
            criterion.targetValue ??
            null,
        })
      );

  const constraintProjection =
    Array.isArray(
      normalizedGoal
        .constraints
    )
      ? normalizedGoal
          .constraints
          .map(
            (constraint) => ({
              constraintId:
                constraint.constraintId ||
                null,

              strength:
                constraint.strength ||
                null,

              description:
                constraint.description ||
                "",
            })
          )
      : [];

  return deepFreeze({
    version:
      VERSION,

    runId,

    /*
     * Aucun état mutable ici.
     * READY/RUNNING/PAUSED/... appartiendront
     * au Goal Run State de 5.0B.
     */
    goalRef: {
      goalId:
        identifier(
          normalizedGoal.goalId,
          "goal.goalId"
        ),

      goalVersion:
        safeInteger(
          normalizedGoal.version,
          "goal.version",
          {
            min: 1,
          }
        ),
    },

    scope:
      normalizeScope(
        normalizedGoal,
        source
      ),

    objectiveFingerprint:
      fingerprint({
        outcomeDefinition:
          normalizedGoal
            .outcomeDefinition,
      }),

    successCriteria: {
      criterionIds:
        Object.freeze(
          successCriteriaProjection
            .map(
              (criterion) =>
                criterion
                  .criterionId
            )
        ),

      fingerprint:
        fingerprint(
          successCriteriaProjection
        ),
    },

    constraints: {
      fingerprint:
        fingerprint(
          constraintProjection
        ),
    },

    /*
     * Budget GLOBAL de la boucle Goal Mode.
     * Chaque moteur appelé conserve EN PLUS
     * ses propres limites et ses propres refus.
     */
    limits,

    /*
     * Plafond de capacités que Goal Mode
     * pourra DEMANDER.
     *
     * Ce contrat n'accorde aucune capacité :
     * OperationalSecurityPolicy,
     * InterventionPermissionEngine et
     * ApprovalEngine restent autoritatifs.
     */
    capabilityCeilings,

    localOnly,

    authority: {
      executionAuthorized:
        false,

      capabilitiesGranted:
        false,

      securityPipelineBypassed:
        false,
    },

    admittedAt,
  });
}

function normalizeUsage(
  value,
  label
) {
  const source =
    value === undefined
      ? {}
      : object(
          value,
          label,
          [
            "steps",
            "retries",
            "providerCalls",
            "estimatedCost",
          ]
        );

  return Object.freeze({
    steps:
      source.steps ===
        undefined
        ? 0
        : safeInteger(
            source.steps,
            `${label}.steps`
          ),

    retries:
      source.retries ===
        undefined
        ? 0
        : safeInteger(
            source.retries,
            `${label}.retries`
          ),

    providerCalls:
      source.providerCalls ===
        undefined
        ? 0
        : safeInteger(
            source.providerCalls,
            `${label}.providerCalls`
          ),

    estimatedCost:
      source.estimatedCost ===
        undefined
        ? 0
        : finiteCost(
            source.estimatedCost,
            `${label}.estimatedCost`
          ),
  });
}

function remaining(
  maximum,
  used
) {
  return Math.max(
    0,
    maximum - used
  );
}

function budgetAssessment({
  decision,
  reasonCode,
  contract,
  current,
  proposed,
  elapsedMs,
} = {}) {
  const projected = {
    steps:
      current.steps +
      proposed.steps,

    retries:
      current.retries +
      proposed.retries,

    providerCalls:
      current.providerCalls +
      proposed.providerCalls,

    estimatedCost:
      current.estimatedCost +
      proposed.estimatedCost,
  };

  const usedForRemaining =
    decision === "PROCEED"
      ? projected
      : current;

  return deepFreeze({
    decision,

    allowed:
      decision ===
        "PROCEED",

    reasonCode,

    elapsedMs,

    projected,

    remaining: {
      steps:
        remaining(
          contract.limits
            .maxSteps,
          usedForRemaining
            .steps
        ),

      retries:
        remaining(
          contract.limits
            .maxRetries,
          usedForRemaining
            .retries
        ),

      providerCalls:
        remaining(
          contract.limits
            .maxProviderCalls,
          usedForRemaining
            .providerCalls
        ),

      estimatedCost:
        remaining(
          contract.limits
            .maxEstimatedCost,
          usedForRemaining
            .estimatedCost
        ),

      duration:
        remaining(
          contract.limits
            .maxDuration,
          elapsedMs
        ),
    },
  });
}

function assessGoalModeBudget({
  contract,
  currentUsage,
  proposedUsage,
  currentGoalVersion,
  now =
    () =>
      new Date(),
} = {}) {
  object(
    contract,
    "contract"
  );

  if (
    contract.version !==
      VERSION
  ) {
    fail(
      "GOAL_MODE_CONTRACT_VERSION_INVALID",
      "Version Goal Mode incompatible."
    );
  }

  const observedGoalVersion =
    safeInteger(
      currentGoalVersion,
      "currentGoalVersion",
      {
        min: 1,
      }
    );

  const current =
    normalizeUsage(
      currentUsage,
      "currentUsage"
    );

  const proposed =
    normalizeUsage(
      proposedUsage,
      "proposedUsage"
    );

  const observedAt =
    new Date(
      now()
    ).toISOString();

  const elapsedMs =
    Math.max(
      0,
      Date.parse(
        observedAt
      ) -
      Date.parse(
        contract.admittedAt
      )
    );

  const base = {
    contract,
    current,
    proposed,
    elapsedMs,
  };

  if (
    observedGoalVersion !==
      contract.goalRef
        .goalVersion
  ) {
    return budgetAssessment({
      ...base,
      decision:
        "STOP",

      reasonCode:
        "GOAL_STALE",
    });
  }

  if (
    elapsedMs >=
      contract.limits
        .maxDuration
  ) {
    return budgetAssessment({
      ...base,
      decision:
        "STOP",

      reasonCode:
        "TIME_LIMIT",
    });
  }

  const projected = {
    steps:
      current.steps +
      proposed.steps,

    retries:
      current.retries +
      proposed.retries,

    providerCalls:
      current.providerCalls +
      proposed.providerCalls,

    estimatedCost:
      current.estimatedCost +
      proposed.estimatedCost,
  };

  if (
    projected.steps >
      contract.limits
        .maxSteps
  ) {
    return budgetAssessment({
      ...base,
      decision:
        "STOP",

      reasonCode:
        "STEP_LIMIT",
    });
  }

  if (
    projected.retries >
      contract.limits
        .maxRetries
  ) {
    return budgetAssessment({
      ...base,
      decision:
        "STOP",

      reasonCode:
        "RETRY_LIMIT",
    });
  }

  if (
    projected.providerCalls >
      contract.limits
        .maxProviderCalls
  ) {
    return budgetAssessment({
      ...base,
      decision:
        "STOP",

      reasonCode:
        "PROVIDER_CALL_LIMIT",
    });
  }

  if (
    projected.estimatedCost >
      contract.limits
        .maxEstimatedCost
  ) {
    return budgetAssessment({
      ...base,
      decision:
        "STOP",

      reasonCode:
        "COST_LIMIT",
    });
  }

  return budgetAssessment({
    ...base,
    decision:
      "PROCEED",

    reasonCode:
      "WITHIN_LIMITS",
  });
}

function assessGoalModeCapabilityCeiling({
  contract,
  requestedCapabilities,
} = {}) {
  object(
    contract,
    "contract"
  );

  if (
    contract.version !==
      VERSION
  ) {
    fail(
      "GOAL_MODE_CONTRACT_VERSION_INVALID",
      "Version Goal Mode incompatible."
    );
  }

  const requested =
    object(
      requestedCapabilities,
      "requestedCapabilities",
      CAPABILITY_CEILING_KEYS
    );

  const keys =
    CAPABILITY_CEILING_KEYS
      .filter(
        (key) =>
          requested[key] ===
            true
      );

  const denied =
    keys.filter(
      (key) =>
        contract
          .capabilityCeilings[
            key
          ] !==
          true
    );

  if (
    denied.length
  ) {
    return deepFreeze({
      decision:
        "DENY",

      allowedToRequest:
        false,

      requiresExternalAuthorization:
        true,

      executionAuthorized:
        false,

      reasonCode:
        "GOAL_MODE_CAPABILITY_CEILING",

      denied:
        Object.freeze([
          ...denied,
        ]),
    });
  }

  return deepFreeze({
    decision:
      keys.length
        ? "REQUEST_AUTHORIZATION"
        : "NO_AUTHORIZATION_REQUIRED",

    allowedToRequest:
      true,

    requiresExternalAuthorization:
      keys.length > 0,

    /*
     * Même dans la ceiling, ce contrat
     * n'est jamais l'autorité d'exécution.
     */
    executionAuthorized:
      false,

    reasonCode:
      keys.length
        ? "SECURITY_PIPELINE_REQUIRED"
        : "NO_EXTERNAL_CAPABILITY_REQUEST",

    requested:
      Object.freeze([
        ...keys,
      ]),
  });
}

module.exports = {
  CAPABILITY_CEILING_KEYS,
  GLOBAL_LIMIT_KEYS,
  VERSION,
  assessGoalModeBudget,
  assessGoalModeCapabilityCeiling,
  createGoalModeRunContract,
};
