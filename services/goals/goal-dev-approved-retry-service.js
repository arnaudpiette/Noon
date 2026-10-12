"use strict";

const {
  assertGoalDevRetryExecutionTemplate,
} = require("./goal-dev-retry-execution-template");

const {
  OPERATION,
  SKILL_NAME,
} = require("./goal-dev-retry-permit-service");

const VERSION =
  "goal-dev-approved-retry-execution-v1";

function fail(code, message) {
  throw Object.assign(
    new Error(message),
    { code }
  );
}

function freeze(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Object.isFrozen(value)
  ) {
    return value;
  }

  for (const child of Object.values(value)) {
    freeze(child);
  }

  return Object.freeze(value);
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
      "GOAL_DEV_RETRY_APPROVED_BINDING_INVALID",
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
  return value == null
    ? null
    : requiredString(
        value,
        label,
        max
      );
}

function safeInteger(
  value,
  label,
  min = 1
) {
  if (
    !Number.isSafeInteger(value) ||
    value < min ||
    value >= Number.MAX_SAFE_INTEGER
  ) {
    fail(
      "GOAL_DEV_RETRY_APPROVED_BINDING_INVALID",
      `${label} invalide.`
    );
  }

  return value;
}

function iso(value) {
  const parsed =
    Date.parse(
      String(value || "")
    );

  if (!Number.isFinite(parsed)) {
    fail(
      "GOAL_DEV_RETRY_EXECUTION_TIME_INVALID",
      "Horodatage Retry Execution invalide."
    );
  }

  return new Date(parsed).toISOString();
}

function validateBinding(
  exactAction
) {
  if (
    !exactAction ||
    typeof exactAction !== "object" ||
    Array.isArray(exactAction) ||
    exactAction.skillName !== SKILL_NAME ||
    exactAction.operation !== OPERATION
  ) {
    fail(
      "GOAL_DEV_RETRY_APPROVED_BINDING_INVALID",
      "Action Retry approuvée invalide."
    );
  }

  const source =
    exactAction.normalizedArgs;

  if (
    !source ||
    typeof source !== "object" ||
    Array.isArray(source)
  ) {
    fail(
      "GOAL_DEV_RETRY_APPROVED_BINDING_INVALID",
      "Binding Retry approuvé invalide."
    );
  }

  const allowed =
    new Set([
      "version",
      "chainId",
      "chainRevision",
      "goalId",
      "workspaceId",
      "projectId",
      "rootTaskId",
      "parentTaskId",
      "taskId",
      "attemptIndex",
      "executionTemplateFingerprint",
    ]);

  for (const key of Object.keys(source)) {
    if (!allowed.has(key)) {
      fail(
        "GOAL_DEV_RETRY_APPROVED_BINDING_INVALID",
        `Binding Retry.${key} non autorisé.`
      );
    }
  }

  if (
    source.version !==
    "goal-dev-retry-permit-binding-v1"
  ) {
    fail(
      "GOAL_DEV_RETRY_APPROVED_BINDING_INVALID",
      "Version du binding Retry invalide."
    );
  }

  const binding = {
    version: source.version,

    chainId:
      requiredString(
        source.chainId,
        "chainId"
      ),

    chainRevision:
      safeInteger(
        source.chainRevision,
        "chainRevision"
      ),

    goalId:
      requiredString(
        source.goalId,
        "goalId"
      ),

    workspaceId:
      requiredString(
        source.workspaceId,
        "workspaceId"
      ),

    projectId:
      nullableString(
        source.projectId,
        "projectId"
      ),

    rootTaskId:
      requiredString(
        source.rootTaskId,
        "rootTaskId"
      ),

    parentTaskId:
      requiredString(
        source.parentTaskId,
        "parentTaskId"
      ),

    taskId:
      requiredString(
        source.taskId,
        "taskId"
      ),

    attemptIndex:
      safeInteger(
        source.attemptIndex,
        "attemptIndex",
        2
      ),

    executionTemplateFingerprint:
      requiredString(
        source.executionTemplateFingerprint,
        "executionTemplateFingerprint",
        100
      ),
  };

  if (
    binding.taskId ===
      binding.parentTaskId ||
    !/^sha256:[a-f0-9]{64}$/.test(
      binding.executionTemplateFingerprint
    ) ||
    exactAction.target !==
      binding.taskId
  ) {
    fail(
      "GOAL_DEV_RETRY_APPROVED_BINDING_INVALID",
      "Identité du binding Retry invalide."
    );
  }

  return freeze(binding);
}

function requireAtomicPersistence(
  chainStore
) {
  const value =
    chainStore
      .persistenceCapabilities();

  if (
    value?.backend !== "SQLITE" ||
    value?.atomicRevisionCas !== true
  ) {
    fail(
      "GOAL_DEV_RETRY_ATOMIC_PERSISTENCE_REQUIRED",
      "L'exécution Retry exige un CAS SQLite atomique."
    );
  }
}

function preconditions(
  current
) {
  const chain =
    current?.chain;

  const attempts =
    Array.isArray(chain?.attempts)
      ? chain.attempts
      : [];

  const last =
    attempts.at(-1) || null;

  return {
    chainId:
      chain?.chainId || null,

    chainRevision:
      Number.isSafeInteger(
        current?.revision
      )
        ? current.revision
        : null,

    executionTemplateFingerprint:
      chain?.executionTemplate
        ?.fingerprint ||
      null,

    parentTaskId:
      last?.taskId ||
      null,
  };
}

function assertCurrent(
  current,
  binding
) {
  const state =
    preconditions(current);

  if (
    state.chainId !==
      binding.chainId ||
    state.chainRevision !==
      binding.chainRevision ||
    state.executionTemplateFingerprint !==
      binding.executionTemplateFingerprint ||
    state.parentTaskId !==
      binding.parentTaskId
  ) {
    fail(
      "GOAL_DEV_RETRY_APPROVED_BINDING_STALE",
      "Le binding Retry approuvé est devenu obsolète."
    );
  }

  if (
    current.chain?.goalRef?.goalId !==
      binding.goalId ||
    current.chain?.goalRef?.workspaceId !==
      binding.workspaceId ||
    (
      current.chain?.goalRef?.projectId ??
      null
    ) !== binding.projectId ||
    current.chain?.rootTaskId !==
      binding.rootTaskId
  ) {
    fail(
      "GOAL_DEV_RETRY_APPROVED_BINDING_STALE",
      "Les références de la Retry Chain ont changé."
    );
  }

  assertGoalDevRetryExecutionTemplate(
    current.chain.executionTemplate
  );

  return current;
}

function assertCandidate(
  candidate,
  binding
) {
  if (
    !candidate ||
    candidate.chainId !==
      binding.chainId ||
    candidate.rootTaskId !==
      binding.rootTaskId ||
    candidate.parentTaskId !==
      binding.parentTaskId ||
    candidate.taskId !==
      binding.taskId ||
    candidate.attemptIndex !==
      binding.attemptIndex ||
    candidate.executionTemplateFingerprint !==
      binding.executionTemplateFingerprint ||
    candidate.candidateOnly !== true ||
    candidate.retryAuthorized !== false ||
    candidate.executionAuthorized !== false
  ) {
    fail(
      "GOAL_DEV_RETRY_APPROVED_BINDING_STALE",
      "Le candidat Retry ne correspond plus à l'approbation."
    );
  }

  return candidate;
}

function observedCost(
  value
) {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0
  )
    ? value
    : null;
}

function terminalProjection(
  executionResult
) {
  const devResult =
    executionResult?.devResult;

  if (
    !devResult ||
    typeof devResult !== "object" ||
    Array.isArray(devResult)
  ) {
    fail(
      "GOAL_DEV_RETRY_EXECUTION_RESULT_INVALID",
      "Résultat DEV terminal invalide."
    );
  }

  const finalVerdict =
    typeof devResult.finalVerdict ===
      "string"
      ? devResult
          .finalVerdict
          .trim()
          .slice(0, 40)
      : "";

  if (!finalVerdict) {
    fail(
      "GOAL_DEV_RETRY_EXECUTION_RESULT_INVALID",
      "Verdict DEV terminal requis."
    );
  }

  const failureCategory =
    typeof devResult.failureCategory ===
      "string" &&
    devResult.failureCategory.trim()
      ? devResult
          .failureCategory
          .trim()
          .slice(0, 120)
      : null;

  return freeze({
    finalVerdict,
    failureCategory,

    continuationState:
      finalVerdict.toUpperCase() ===
        "PASS"
        ? "STOP"
        : "REVIEW",

    estimatedCost:
      observedCost(
        devResult.estimatedCost
      ),

    actualCost:
      observedCost(
        devResult.actualCost
      ),
  });
}

function buildRequest({
  binding,
  template,
  repositoryRoot,
}) {
  const source =
    template.request;

  const limits = {};

  for (
    const key of [
      "maxIterations",
      "maxDuration",
      "maxEstimatedCost",
    ]
  ) {
    if (
      source[key] !== null &&
      source[key] !== undefined
    ) {
      limits[key] =
        source[key];
    }
  }

  const permissions = {
    allowGitWrite: false,
    allowDestructiveActions:
      false,
  };

  if (
    source.localOnly === true ||
    source.allowNetwork === false
  ) {
    permissions.allowNetwork =
      false;
  }

  return {
    taskId:
      binding.taskId,

    sessionId:
      `goal-retry:${binding.chainId}:${binding.attemptIndex}`,

    workspaceId:
      binding.workspaceId,

    projectId:
      binding.projectId,

    repositoryRoot,

    ...(source.branch
      ? {
          branch:
            source.branch,
        }
      : {}),

    objective:
      source.objective,

    allowedPaths:
      structuredClone(
        source.allowedPaths || []
      ),

    forbiddenPaths:
      structuredClone(
        source.forbiddenPaths || []
      ),

    constraints:
      structuredClone(
        source.constraints || []
      ),

    validationCommands:
      structuredClone(
        source.validationCommands || []
      ),

    requiredQuality:
      source.requiredQuality,

    limits,
    permissions,

    localOnly:
      source.localOnly === true,
  };
}

function createGoalDevApprovedRetryService({
  chainStore,
  approvalEngine,
  goalDevExecutionService,
  executionContextResolver,
  securityRecheck,
  permissionRecheck,
  now =
    () =>
      new Date().toISOString(),
} = {}) {
  if (
    typeof chainStore?.get !==
      "function" ||
    typeof chainStore?.projectCandidate !==
      "function" ||
    typeof chainStore?.appendCandidate !==
      "function" ||
    typeof chainStore?.markExecutionUncertain !==
      "function" ||
    typeof chainStore?.recordAttempt !==
      "function" ||
    typeof chainStore?.persistenceCapabilities !==
      "function"
  ) {
    throw new TypeError(
      "Retry Chain Store exécutable requis."
    );
  }

  if (
    typeof approvalEngine
      ?.getPreparedGoalDevRetryExactAction !==
      "function" ||
    typeof approvalEngine
      ?.resumeApprovedAction !==
      "function"
  ) {
    throw new TypeError(
      "ApprovalEngine Retry valide requis."
    );
  }

  if (
    typeof goalDevExecutionService
      ?.run !==
    "function"
  ) {
    throw new TypeError(
      "GoalDevExecutionService valide requis."
    );
  }

  for (
    const [
      name,
      dependency,
    ] of [
      [
        "executionContextResolver",
        executionContextResolver,
      ],
      [
        "securityRecheck",
        securityRecheck,
      ],
      [
        "permissionRecheck",
        permissionRecheck,
      ],
    ]
  ) {
    if (
      typeof dependency !==
      "function"
    ) {
      throw new TypeError(
        `${name} autoritatif requis.`
      );
    }
  }

  async function resume({
    approvalId,
    resumeToken,
    decision = "approve",
  } = {}) {
    if (
      ![
        "approve",
        "reject",
      ].includes(decision)
    ) {
      fail(
        "GOAL_DEV_RETRY_DECISION_INVALID",
        "Décision Retry invalide."
      );
    }

    const exactAction =
      approvalEngine
        .getPreparedGoalDevRetryExactAction({
          approvalId,
          resumeToken,
        });

    const binding =
      validateBinding(
        exactAction
      );

    if (
      decision ===
      "reject"
    ) {
      return approvalEngine
        .resumeApprovedAction({
          approvalId,
          resumeToken,
          decision,
          exactAction,
        });
    }

    requireAtomicPersistence(
      chainStore
    );

    let currentSnapshot =
      null;

    function authorizationCurrent() {
      if (!currentSnapshot) {
        currentSnapshot =
          chainStore.get(
            binding.chainId
          );
      }

      return currentSnapshot;
    }

    return approvalEngine
      .resumeApprovedAction({
        approvalId,
        resumeToken,
        decision,
        exactAction,

        recheckHardRules:
          async () => {
            try {
              return (
                await securityRecheck({
                  binding,
                  exactAction,
                  current:
                    authorizationCurrent(),
                })
              ) === true;
            } catch {
              return false;
            }
          },

        recheckPermission:
          async () => {
            try {
              return (
                await permissionRecheck({
                  binding,
                  exactAction,
                  current:
                    authorizationCurrent(),
                })
              ) === true;
            } catch {
              return false;
            }
          },

        recheckPreconditions:
          () => {
            try {
              return preconditions(
                chainStore.get(
                  binding.chainId
                )
              );
            } catch {
              return {
                chainId: null,
                chainRevision: null,
                executionTemplateFingerprint:
                  null,
                parentTaskId: null,
              };
            }
          },

        execute:
          async (
            normalizedArgs
          ) => {
            const approvedBinding =
              validateBinding({
                ...exactAction,
                normalizedArgs,
              });

            const current =
              assertCurrent(
                chainStore.get(
                  approvedBinding
                    .chainId
                ),
                approvedBinding
              );

            const executionContext =
              await executionContextResolver({
                binding:
                  approvedBinding,
                chain:
                  current.chain,
              });

            const repositoryRoot =
              typeof executionContext
                ?.repositoryRoot ===
                "string" &&
              executionContext
                .repositoryRoot ===
                executionContext
                  .repositoryRoot
                  .trim() &&
              executionContext
                .repositoryRoot
                .length > 0
                ? executionContext
                    .repositoryRoot
                : null;

            if (!repositoryRoot) {
              fail(
                "GOAL_DEV_RETRY_EXECUTION_CONTEXT_INVALID",
                "repositoryRoot autoritatif requis."
              );
            }

            const executionAt =
              iso(now());

            const candidate =
              assertCandidate(
                chainStore
                  .projectCandidate(
                    approvedBinding
                      .chainId,
                    {
                      now:
                        executionAt,
                      taskId:
                        approvedBinding
                          .taskId,
                    }
                  ),
                approvedBinding
              );

            const request =
              buildRequest({
                binding:
                  approvedBinding,
                template:
                  current.chain
                    .executionTemplate,
                repositoryRoot,
              });

            const appended =
              chainStore
                .appendCandidate(
                  approvedBinding
                    .chainId,
                  candidate,
                  {
                    expectedRevision:
                      approvedBinding
                        .chainRevision,

                    updatedAt:
                      executionAt,
                  }
                );

            const uncertain =
              chainStore
                .markExecutionUncertain(
                  approvedBinding
                    .chainId,
                  {
                    expectedRevision:
                      appended.revision,

                    taskId:
                      approvedBinding
                        .taskId,

                    attemptIndex:
                      approvedBinding
                        .attemptIndex,

                    uncertainAt:
                      iso(now()),
                  }
                );

            const executionResult =
              await goalDevExecutionService
                .run({
                  goalId:
                    approvedBinding
                      .goalId,

                  request,
                });

            if (
              executionResult?.taskId !==
              approvedBinding.taskId
            ) {
              fail(
                "GOAL_DEV_RETRY_EXECUTION_RESULT_INVALID",
                "Le résultat DEV ne correspond pas au taskId approuvé."
              );
            }

            const terminal =
              terminalProjection(
                executionResult
              );

            const recorded =
              chainStore
                .recordAttempt(
                  approvedBinding
                    .chainId,
                  {
                    expectedRevision:
                      uncertain.revision,

                    taskId:
                      approvedBinding
                        .taskId,

                    finalVerdict:
                      terminal
                        .finalVerdict,

                    failureCategory:
                      terminal
                        .failureCategory,

                    continuationState:
                      terminal
                        .continuationState,

                    estimatedCost:
                      terminal
                        .estimatedCost,

                    actualCost:
                      terminal
                        .actualCost,

                    recordedAt:
                      iso(now()),
                  }
                );

            return freeze({
              version: VERSION,

              chainId:
                approvedBinding
                  .chainId,

              taskId:
                approvedBinding
                  .taskId,

              attemptIndex:
                approvedBinding
                  .attemptIndex,

              finalVerdict:
                terminal
                  .finalVerdict,

              failureCategory:
                terminal
                  .failureCategory,

              continuationState:
                terminal
                  .continuationState,

              estimatedCost:
                terminal
                  .estimatedCost,

              actualCost:
                terminal
                  .actualCost,

              chainRevision:
                recorded.revision,

              authority: {
                approvalConsumedBy:
                  "ApprovalEngine",

                retrySelfAuthorized:
                  false,

                securityBypassed:
                  false,
              },
            });
          },
      });
  }

  return Object.freeze({
    resume,
  });
}

module.exports = {
  VERSION,
  createGoalDevApprovedRetryService,
};
