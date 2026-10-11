"use strict";

const crypto =
  require("node:crypto");

const VERSION =
  "goal-dev-retry-execution-template-v1";

function failure(
  code,
  message
) {
  throw Object.assign(
    new Error(message),
    { code }
  );
}

function clean(
  value,
  max
) {
  const result =
    String(value ?? "")
      .replace(
        /[\0\r\n]+/g,
        " "
      )
      .trim();

  return typeof max ===
    "number"
    ? result.slice(0, max)
    : result;
}

function stringArray(
  value,
  {
    maxItems,
    maxLength,
  }
) {
  if (
    value == null
  ) {
    return [];
  }

  if (
    !Array.isArray(value)
  ) {
    failure(
      "GOAL_DEV_RETRY_TEMPLATE_INVALID",
      "Liste Retry Template invalide."
    );
  }

  return [
    ...new Set(
      value
        .map(
          (item) =>
            clean(
              item,
              maxLength
            )
        )
        .filter(Boolean)
    ),
  ].slice(
    0,
    maxItems
  );
}

function finiteOrNull(
  value,
  {
    min = 0,
    max =
      Number.POSITIVE_INFINITY,
  } = {}
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
    parsed < min ||
    parsed > max
  ) {
    failure(
      "GOAL_DEV_RETRY_TEMPLATE_LIMIT_INVALID",
      "Limite Retry Template invalide."
    );
  }

  return parsed;
}

function integerOrNull(
  value,
  options
) {
  const parsed =
    finiteOrNull(
      value,
      options
    );

  if (
    parsed !== null &&
    !Number.isInteger(parsed)
  ) {
    failure(
      "GOAL_DEV_RETRY_TEMPLATE_LIMIT_INVALID",
      "Limite entière Retry Template invalide."
    );
  }

  return parsed;
}

function canonical(
  value
) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
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

function stableStringify(
  value
) {
  return JSON.stringify(
    canonical(value)
  );
}

function fingerprint(
  value
) {
  return (
    "sha256:" +
    crypto
      .createHash("sha256")
      .update(
        stableStringify(value)
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

/*
 * Ce template est construit uniquement
 * depuis le contrat DEV déjà projeté et
 * borné par Goal 4.5B.
 *
 * Il ne doit jamais capturer :
 * - taskId
 * - sessionId
 * - workspaceAuthorized
 * - workspaceRoots
 * - repositoryRoot
 * - permissions
 * - projectInstructions
 * - enforceTaskBudget
 * - benchmark
 *
 * Ces champs devront être recréés ou
 * revalidés par les autorités existantes
 * à chaque future tentative.
 */
function normalizedRequest(
  devInput = {}
) {
  if (
    !devInput ||
    typeof devInput !==
      "object" ||
    Array.isArray(devInput)
  ) {
    failure(
      "GOAL_DEV_RETRY_TEMPLATE_INPUT_REQUIRED",
      "Contrat DEV projeté requis."
    );
  }

  const objective =
    clean(
      devInput.objective,
      8000
    );

  if (!objective) {
    failure(
      "GOAL_DEV_RETRY_TEMPLATE_OBJECTIVE_REQUIRED",
      "Objectif DEV requis."
    );
  }

  const requiredQuality =
    clean(
      devInput.requiredQuality ||
        devInput.quality ||
        "NORMAL",
      20
    ).toUpperCase();

  if (
    ![
      "LOW",
      "NORMAL",
      "HIGH",
      "CRITICAL",
    ].includes(
      requiredQuality
    )
  ) {
    failure(
      "GOAL_DEV_RETRY_TEMPLATE_QUALITY_INVALID",
      "Qualité DEV invalide."
    );
  }

  const request = {
    objective,

    requiredQuality,

    branch:
      clean(
        devInput.branch,
        200
      ) || null,

    allowedPaths:
      stringArray(
        devInput.allowedPaths,
        {
          maxItems: 100,
          maxLength: 2000,
        }
      ),

    forbiddenPaths:
      stringArray(
        devInput.forbiddenPaths,
        {
          maxItems: 100,
          maxLength: 2000,
        }
      ),

    constraints:
      stringArray(
        devInput.constraints,
        {
          maxItems: 100,
          maxLength: 2000,
        }
      ),

    validationCommands:
      stringArray(
        devInput.validationCommands,
        {
          maxItems: 12,
          maxLength: 2000,
        }
      ),

    maxIterations:
      integerOrNull(
        devInput.maxIterations,
        {
          min: 1,
          max: 10,
        }
      ),

    maxDuration:
      finiteOrNull(
        devInput.maxDuration,
        {
          min: 1000,
          max:
            30 * 60_000,
        }
      ),

    maxEstimatedCost:
      finiteOrNull(
        devInput.maxEstimatedCost,
        {
          min: 0,
        }
      ),

    localOnly:
      devInput.localOnly ===
      true,
  };

  /*
   * Certains adaptateurs Goal connaissent
   * explicitement allowNetwork.
   *
   * On ne le conserve que comme réduction :
   * false peut survivre ; true ne devient
   * jamais une autorité réseau persistée.
   */
  if (
    devInput.allowNetwork ===
      false
  ) {
    request.allowNetwork =
      false;
  }

  return request;
}

function createGoalDevRetryExecutionTemplate(
  devInput
) {
  const request =
    normalizedRequest(
      devInput
    );

  const content = {
    version: VERSION,

    request,

    authority: {
      retryAuthorized: false,
      executionAuthorized:
        false,
      approvalGranted: false,
      securityBypassed: false,
    },
  };

  return deepFreeze({
    ...content,

    fingerprint:
      fingerprint(content),
  });
}

function assertGoalDevRetryExecutionTemplate(
  template
) {
  if (
    !template ||
    typeof template !==
      "object" ||
    Array.isArray(template)
  ) {
    failure(
      "GOAL_DEV_RETRY_TEMPLATE_INVALID",
      "Retry Execution Template invalide."
    );
  }

  if (
    template.version !==
      VERSION
  ) {
    failure(
      "GOAL_DEV_RETRY_TEMPLATE_VERSION_INVALID",
      "Version Retry Execution Template invalide."
    );
  }

  const rebuilt =
    createGoalDevRetryExecutionTemplate(
      template.request
    );

  if (
    rebuilt.fingerprint !==
      template.fingerprint
  ) {
    failure(
      "GOAL_DEV_RETRY_TEMPLATE_FINGERPRINT_INVALID",
      "Empreinte Retry Execution Template invalide."
    );
  }

  const authority =
    template.authority ||
    {};

  for (
    const field of [
      "retryAuthorized",
      "executionAuthorized",
      "approvalGranted",
      "securityBypassed",
    ]
  ) {
    if (
      authority[field] !==
      false
    ) {
      failure(
        "GOAL_DEV_RETRY_TEMPLATE_AUTHORITY_INVALID",
        `Autorité Retry Template interdite : ${field}.`
      );
    }
  }

  /*
   * Défense supplémentaire contre
   * l'introduction future de champs
   * d'autorité dans request.
   */
  for (
    const forbidden of [
      "taskId",
      "sessionId",
      "workspaceAuthorized",
      "workspaceRoots",
      "repositoryRoot",
      "permissions",
      "projectInstructions",
      "enforceTaskBudget",
      "benchmark",
    ]
  ) {
    if (
      Object.prototype
        .hasOwnProperty
        .call(
          template.request ||
            {},
          forbidden
        )
    ) {
      failure(
        "GOAL_DEV_RETRY_TEMPLATE_FORBIDDEN_FIELD",
        `Champ interdit dans Retry Template : ${forbidden}.`
      );
    }
  }

  return true;
}

module.exports = {
  VERSION,
  assertGoalDevRetryExecutionTemplate,
  createGoalDevRetryExecutionTemplate,
  fingerprint,
  stableStringify,
};
