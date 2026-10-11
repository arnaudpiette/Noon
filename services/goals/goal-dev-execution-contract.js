"use strict";

const {
  GoalError,
} = require("./goal-schema");

const VERSION =
  "goal-dev-execution-v1";

const LIMITS =
  Object.freeze({
    maxIterations: 10,
    defaultIterations: 3,
    maxDuration: 30 * 60_000,
    defaultDuration: 10 * 60_000,
  });

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
  allowed
) {
  if (
    value == null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    fail(
      "GOAL_DEV_CONTRACT_INVALID",
      `${label} invalide.`
    );
  }

  for (
    const key of
      Object.keys(value)
  ) {
    if (
      !allowed.includes(key)
    ) {
      fail(
        "GOAL_DEV_CONTRACT_INVALID",
        `${label}.${key} non autorisé.`
      );
    }
  }

  return value;
}

function identifier(
  value,
  label
) {
  const normalized =
    String(value ?? "")
      .trim()
      .slice(0, 200);

  if (!normalized) {
    fail(
      "GOAL_DEV_REFERENCE_REQUIRED",
      `${label} requis.`
    );
  }

  return normalized;
}

function positiveInteger(
  value,
  label,
  {
    min = 1,
    max,
    fallback,
  }
) {
  if (
    value === undefined ||
    value === null
  ) {
    return fallback;
  }

  const parsed =
    Number(value);

  if (
    !Number.isInteger(parsed) ||
    parsed < min
  ) {
    fail(
      "GOAL_DEV_LIMIT_INVALID",
      `${label} invalide.`
    );
  }

  return Math.min(
    parsed,
    max
  );
}

function duration(
  value
) {
  if (
    value === undefined ||
    value === null
  ) {
    return LIMITS
      .defaultDuration;
  }

  const parsed =
    Number(value);

  if (
    !Number.isFinite(parsed) ||
    parsed <= 0
  ) {
    fail(
      "GOAL_DEV_LIMIT_INVALID",
      "maxDuration invalide."
    );
  }

  return Math.max(
    1_000,
    Math.min(
      parsed,
      LIMITS.maxDuration
    )
  );
}

function cost(
  value
) {
  if (
    value === undefined ||
    value === null
  ) {
    return null;
  }

  const parsed =
    Number(value);

  if (
    !Number.isFinite(parsed) ||
    parsed < 0
  ) {
    fail(
      "GOAL_DEV_LIMIT_INVALID",
      "maxEstimatedCost invalide."
    );
  }

  return parsed;
}

function strings(
  value,
  max
) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [
    ...new Set(
      value
        .map(
          (item) =>
            String(item ?? "")
              .trim()
        )
        .filter(Boolean)
    ),
  ].slice(0, max);
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

function projectGoalDevExecution({
  goal,
  request,
  budgetService = null,
} = {}) {
  object(
    goal,
    "goal",
    [
      "goalId",
      "title",
      "description",
      "status",
      "horizon",
      "category",
      "outcomeDefinition",
      "successCriteria",
      "milestones",
      "linkedProjectIds",
      "linkedWorkspaceIds",
      "strategyRef",
      "constraints",
      "progress",
      "confidence",
      "targetDate",
      "reviewCadence",
      "importance",
      "profileScope",
      "sensitivity",
      "createdAt",
      "updatedAt",
      "source",
      "userConfirmed",
      "version",
      "qualityWarnings",
    ]
  );

  object(
    request,
    "request",
    [
      "taskId",
      "sessionId",
      "workspaceId",
      "projectId",
      "repositoryRoot",
      "objective",
      "allowedPaths",
      "forbiddenPaths",
      "constraints",
      "validationCommands",
      "requiredQuality",
      "limits",
      "permissions",
      "localOnly",
    ]
  );

  if (
    goal.status !==
      "ACTIVE" ||
    goal.userConfirmed !==
      true
  ) {
    fail(
      "GOAL_DEV_GOAL_NOT_ACTIVE",
      "Seul un objectif ACTIVE explicitement confirmé peut être projeté vers DEV."
    );
  }

  const taskId =
    identifier(
      request.taskId,
      "taskId"
    );

  const workspaceId =
    identifier(
      request.workspaceId,
      "workspaceId"
    );

  const projectId =
    request.projectId == null
      ? null
      : identifier(
          request.projectId,
          "projectId"
        );

  const repositoryRoot =
    identifier(
      request.repositoryRoot,
      "repositoryRoot"
    );

  const objective =
    String(
      request.objective ?? ""
    )
      .trim()
      .slice(0, 8000);

  if (!objective) {
    fail(
      "GOAL_DEV_OBJECTIVE_REQUIRED",
      "Une tâche DEV explicite est requise ; Goal ne fabrique pas encore lui-même une tâche."
    );
  }

  const linkedWorkspaces =
    strings(
      goal.linkedWorkspaceIds,
      50
    );

  if (
    linkedWorkspaces.length &&
    !linkedWorkspaces.includes(
      workspaceId
    )
  ) {
    fail(
      "GOAL_DEV_WORKSPACE_MISMATCH",
      "Le workspace DEV n'est pas lié à cet objectif."
    );
  }

  const linkedProjects =
    strings(
      goal.linkedProjectIds,
      50
    );

  if (
    linkedProjects.length &&
    (
      !projectId ||
      !linkedProjects.includes(
        projectId
      )
    )
  ) {
    fail(
      "GOAL_DEV_PROJECT_MISMATCH",
      "Le projet DEV n'est pas lié à cet objectif."
    );
  }

  const limits =
    object(
      request.limits || {},
      "request.limits",
      [
        "maxIterations",
        "maxRetries",
        "maxDuration",
        "maxEstimatedCost",
        "maxSteps",
        "maxProviderCalls",
        "maxShellCommands",
      ]
    );

  const unsupportedLimits =
    [
      "maxSteps",
      "maxProviderCalls",
      "maxShellCommands",
    ].filter(
      (key) =>
        limits[key] !==
          undefined &&
        limits[key] !== null
    );

  if (
    unsupportedLimits.length
  ) {
    fail(
      "GOAL_DEV_LIMIT_UNSUPPORTED",
      `Limite Goal non encore imposable par Native DEV : ${unsupportedLimits.join(", ")}.`
    );
  }

  let maxIterations =
    positiveInteger(
      limits.maxIterations,
      "maxIterations",
      {
        min: 1,
        max:
          LIMITS.maxIterations,
        fallback:
          LIMITS
            .defaultIterations,
      }
    );

  if (
    limits.maxRetries !==
      undefined &&
    limits.maxRetries !==
      null
  ) {
    const maxRetries =
      positiveInteger(
        limits.maxRetries,
        "maxRetries",
        {
          min: 0,
          max:
            LIMITS.maxIterations -
            1,
          fallback: 0,
        }
      );

    maxIterations =
      Math.min(
        maxIterations,
        maxRetries + 1
      );
  }

  const maxDuration =
    duration(
      limits.maxDuration
    );

  const requestedCost =
    cost(
      limits
        .maxEstimatedCost
    );

  let budgetRemaining =
    null;

  if (budgetService !== null) {
    if (
      typeof budgetService
        ?.effectiveRemaining !==
        "function"
    ) {
      fail(
        "GOAL_DEV_BUDGET_INVALID",
        "DevCostBudgetService invalide."
      );
    }

    const remaining =
      budgetService
        .effectiveRemaining(
          taskId,
          requestedCost
        );

    if (
      Number.isFinite(
        Number(remaining)
      )
    ) {
      budgetRemaining =
        Math.max(
          0,
          Number(remaining)
        );
    }
  }

  const maxEstimatedCost =
    budgetRemaining === null
      ? requestedCost
      : requestedCost === null
        ? budgetRemaining
        : Math.min(
            requestedCost,
            budgetRemaining
          );

  const permissions =
    object(
      request.permissions ||
        {},
      "request.permissions",
      [
        "allowNetwork",
        "allowGitWrite",
        "allowDestructiveActions",
      ]
    );

  if (
    permissions.allowGitWrite ===
      true
  ) {
    fail(
      "GOAL_DEV_CAPABILITY_UNSUPPORTED",
      "Goal Mode ne peut pas accorder de permission Git."
    );
  }

  if (
    permissions
      .allowDestructiveActions ===
      true
  ) {
    fail(
      "GOAL_DEV_CAPABILITY_UNSUPPORTED",
      "Goal Mode ne peut pas autoriser d'action destructive."
    );
  }

  const networkAllowed =
    permissions.allowNetwork !==
      false &&
    goal.sensitivity !==
      "LOCAL_ONLY" &&
    request.localOnly !==
      true;

  const goalConstraints =
    Array.isArray(
      goal.constraints
    )
      ? goal.constraints
          .map((item) => {
            const description =
              String(
                item?.description ||
                  ""
              )
                .trim()
                .slice(0, 800);

            if (!description) {
              return null;
            }

            const strength =
              item?.strength ===
                "HARD"
                ? "HARD"
                : "SOFT";

            return (
              `GOAL_CONSTRAINT_${strength}: ` +
              description
            );
          })
          .filter(Boolean)
      : [];

  const taskConstraints =
    strings(
      request.constraints,
      100
    );

  const devInput = {
    taskId,

    sessionId:
      request.sessionId == null
        ? null
        : String(
            request.sessionId
          ).slice(0, 200),

    workspaceId,
    repositoryRoot,
    objective,

    allowedPaths:
      Array.isArray(
        request.allowedPaths
      )
        ? [
            ...request
              .allowedPaths,
          ]
        : undefined,

    forbiddenPaths:
      Array.isArray(
        request.forbiddenPaths
      )
        ? [
            ...request
              .forbiddenPaths,
          ]
        : undefined,

    constraints:
      [
        ...goalConstraints,
        ...taskConstraints,
      ].slice(0, 100),

    validationCommands:
      strings(
        request
          .validationCommands,
        12
      ),

    requiredQuality:
      request.requiredQuality,

    maxIterations,
    maxDuration,
    maxEstimatedCost,

    /*
     * Interne uniquement.
     * La future route Goal ne devra jamais
     * accepter ce champ depuis le client.
     */
    enforceTaskBudget: true,

    localOnly:
      !networkAllowed,

    /*
     * Goal ne crée aucune capacité.
     * Le Permission/Security Engine garde
     * l'autorité réelle.
     */
    permissions: [
      "READ_WRITE_WORKSPACE",
      "TERMINAL_SAFE",
    ],
  };

  return deepFreeze({
    version: VERSION,

    goalRef: {
      goalId:
        String(goal.goalId),
      version:
        Number(goal.version) ||
        1,
      workspaceId,
      projectId,
    },

    limits: {
      maxIterations,
      maxRetries:
        maxIterations - 1,
      maxDuration,
      maxEstimatedCost,
      budgetRemaining,

      unsupported:
        [],
    },

    capabilities: {
      networkAllowed,
      gitWriteAllowed:
        false,
      destructiveActionsAllowed:
        false,

      executionAuthority:
        false,
    },

    devInput,
  });
}

module.exports = {
  LIMITS,
  VERSION,
  projectGoalDevExecution,
};
