// @ts-check
"use strict";

const crypto =
  require("node:crypto");

const fs =
  require("node:fs");

const path =
  require("node:path");

const {
  createDevProcessRunner,
  createSandboxExecutionContractV1,
} = require(
  "./dev-process-runner"
);

/** @type {Set<string | undefined>} */
const ALLOWED_OUTCOMES =
  new Set([
    "ALLOW",
    "ALLOW_WITH_CONSTRAINTS",
  ]);

/**
 * @param {unknown} value
 * @param {number} [max]
 */
function clean(
  value,
  max = 180
) {
  return String(value ?? "")
    .replace(/[\0\r\n]+/g, " ")
    .trim()
    .slice(0, max);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function canonicalDirectory(
  value
) {
  const resolved =
    fs.realpathSync(
      path.resolve(
        String(value || "")
      )
    );

  if (
    !fs
      .statSync(resolved)
      .isDirectory()
  ) {
    throw Object.assign(
      new Error(
        "Workspace DEV invalide."
      ),
      {
        code:
          "SANDBOX_WORKSPACE_INVALID",
      }
    );
  }

  return resolved;
}

/**
 * @param {{ relevantRoots?: Array<{ mode?: string, path?: string }>, roots?: Array<{ mode?: string, path?: string }> } | null | undefined} workspace
 * @returns {Array<string | null>}
 */
function writableWorkspaceRoots(
  workspace
) {
  return (
    workspace?.relevantRoots ||
    workspace?.roots ||
    []
  )
    .filter(
      (item) =>
        item?.mode ===
        "read-write"
    )
    .map((item) => {
      try {
        return canonicalDirectory(
          item.path
        );
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/**
 * @param {{ command: string, workspaceId: string, root: string, permissions: string[] }} input
 */
function policyRequest({
  command,
  workspaceId,
  root,
  permissions,
}) {
  return {
    actionRequest: {
      origin:
        "explicit_user_chat",

      skillId:
        "terminal",

      operation:
        `read validate ${command}`,

      args: {
        path: root,
      },

      workspaceId,

      explicitOrder: true,

      actionClass:
        "READ",

      target: {
        scope: "LOCAL",
        scopeName:
          "workspace",
        targetType:
          "repository",
        targetCount: 1,
      },
    },

    currentPermissions: {
      allowed:
        Array.isArray(
          permissions
        ) &&
        permissions.includes(
          "TERMINAL_SAFE"
        ),

      code:
        "TERMINAL_SAFE",
    },
  };
}

/**
 * Résultat d'exécution renvoyé par DevProcessRunner.run (champs lus ici).
 * @typedef {{
 *   status?: string,
 *   reasonCode?: string | null,
 *   exitCode?: number | null,
 *   signal?: string | null,
 *   durationMs?: number,
 *   outputTail?: string,
 *   outputTruncated?: boolean,
 *   cleanupConfirmed?: boolean,
 *   isolation?: unknown,
 * }} DevProcessOutcome
 */
/** @param {DevProcessOutcome | null | undefined} result */
function failureCategoryFor(
  result
) {
  switch (
    result?.status
  ) {
    case "CANCELLED":
      return "CANCELLED";

    case "TIMEOUT":
      return "TIMEOUT";

    case "CLEANUP_UNCONFIRMED":
      return "CLEANUP_UNCONFIRMED";

    case "FAIL":
      return /** @type {ReadonlyArray<string | null | undefined>} */ ([
        "PROCESS_EXIT_NON_ZERO",
        "SPAWN_FAILED",
      ]).includes(
        result.reasonCode
      )
        ? "TEST_FAILURE"
        : clean(
            result.reasonCode,
            120
          ) ||
            "TEST_FAILURE";

    default:
      return null;
  }
}

/**
 * @param {string} command
 * @param {DevProcessOutcome} result
 */
function validationResult(
  command,
  result
) {
  if (
    result.status === "PASS"
  ) {
    return {
      command,

      status: "PASS",

      exitCode:
        result.exitCode ?? 0,

      signal:
        result.signal || null,

      durationMs:
        result.durationMs,

      outputTail:
        result.outputTail || "",

      outputTruncated:
        result.outputTruncated ===
        true,

      failureCategory: null,

      reasonCode: null,

      cleanupConfirmed:
        result.cleanupConfirmed ===
        true,

      isolation:
        result.isolation,
    };
  }

  const category =
    failureCategoryFor(
      result
    );

  return {
    command,

    status: "FAIL",

    exitCode:
      result.exitCode ?? null,

    signal:
      result.signal || null,

    durationMs:
      result.durationMs,

    outputTail:
      result.outputTail || "",

    outputTruncated:
      result.outputTruncated ===
      true,

    failureCategory:
      category,

    reasonCode:
      category,

    cleanupConfirmed:
      result.cleanupConfirmed ===
      true,

    isolation:
      result.isolation,
  };
}

/**
 * @param {string} command
 * @param {string} code
 * @param {number} [durationMs]
 */
function deniedResult(
  command,
  code,
  durationMs = 0
) {
  return {
    command,

    status:
      code ===
      "COMMAND_NOT_ALLOWLISTED"
        ? "DENIED"
        : "FAIL",

    exitCode: null,

    signal: null,

    durationMs,

    outputTail: "",

    outputTruncated:
      false,

    failureCategory:
      code,

    reasonCode:
      code,

    cleanupConfirmed:
      true,
  };
}

/**
 * @typedef {{
 *   workspaceId?: string,
 *   taskId?: string,
 *   sessionId?: string,
 *   permissions?: string[],
 *   budgetDecisionId?: string,
 * }} ValidationContext
 */
/**
 * @typedef {(
 *   command: string,
 *   cwd: string,
 *   timeout?: number,
 *   signal?: AbortSignal | null,
 *   context?: ValidationContext,
 * ) => Promise<ReturnType<typeof deniedResult> | ReturnType<typeof validationResult>>} ValidationExecutor
 */
/**
 * workspaceEngine et operationalSecurityPolicy sont vérifiés à la construction (TypeError).
 * @param {{
 *   workspaceEngine?: { context: (workspaceId: string) => any },
 *   operationalSecurityPolicy?: {
 *     evaluate: (input: object) => { outcome?: string, decisionId?: string, policyVersion?: string, actionFingerprint?: string } | null | undefined,
 *   },
 *   observability?: ((event: string, metadata: unknown) => void) | null,
 *   now?: () => number,
 *   environment?: NodeJS.ProcessEnv,
 *   createContract?: typeof createSandboxExecutionContractV1,
 *   createRunner?: typeof createDevProcessRunner,
 *   createExecutionId?: () => string,
 *   isolatedWorkspaceResolver?: ((candidate: string) => string | null | undefined) | null,
 * }} [options]
 * @returns {ValidationExecutor}
 */
function createSandboxDevValidationExecutor({
  workspaceEngine,
  operationalSecurityPolicy,
  observability = null,
  now = () => Date.now(),
  environment = process.env,
  createContract =
    createSandboxExecutionContractV1,
  createRunner =
    createDevProcessRunner,
  createExecutionId =
    () =>
      `dev-validation-${crypto.randomUUID()}`,
  // V3-L5a : worktree d'une mission active → dépôt d'origine. L'autorisation (politique et
  // racines en écriture du workspace) est vérifiée sur ce dépôt d'origine ; la commande tourne
  // dans le worktree. Un chemin inconnu du résolveur n'obtient rien de plus.
  isolatedWorkspaceResolver = null,
} = {}) {
  /** @param {string} candidate */
  const authorityRootFor = (candidate) => {
    try {
      const source = isolatedWorkspaceResolver?.(candidate);
      return source ? canonicalDirectory(source) : candidate;
    } catch {
      return candidate;
    }
  };

  if (
    !workspaceEngine?.context
  ) {
    throw new TypeError(
      "WorkspaceEngine requis."
    );
  }

  if (
    !operationalSecurityPolicy
      ?.evaluate
  ) {
    throw new TypeError(
      "OperationalSecurityPolicy requise."
    );
  }

  return async function executeValidation(
    command,
    cwd,
    timeout = 120_000,
    signal = null,
    context = {}
  ) {
    const started =
      now();

    const workspaceId =
      clean(
        context.workspaceId,
        180
      );

    const taskId =
      clean(
        context.taskId,
        200
      );

    const sessionId =
      clean(
        context.sessionId,
        200
      );

    const executionScopeId =
      sessionId ||
      taskId;

    if (
      !workspaceId ||
      !taskId ||
      !executionScopeId
    ) {
      return deniedResult(
        command,
        "SANDBOX_CONTEXT_INVALID",
        now() - started
      );
    }

    let root;

    try {
      root =
        canonicalDirectory(
          cwd
        );
    } catch {
      return deniedResult(
        command,
        "SANDBOX_WORKSPACE_INVALID",
        now() - started
      );
    }

    const permissions =
      Array.isArray(
        context.permissions
      )
        ? context.permissions
        : [];

    const evaluatePolicy =
      () =>
        operationalSecurityPolicy.evaluate(
          policyRequest({
            command,
            workspaceId,
            root: authorityRootFor(root),
            permissions,
          })
        );

    let initialDecision;

    try {
      initialDecision =
        evaluatePolicy();
    } catch {
      return deniedResult(
        command,
        "SANDBOX_REVALIDATION_FAILED",
        now() - started
      );
    }

    if (
      !ALLOWED_OUTCOMES.has(
        initialDecision?.outcome
      )
    ) {
      return deniedResult(
        command,
        "PERMISSION_DENIED",
        now() - started
      );
    }

    let sandboxContract;

    try {
      sandboxContract =
        createContract(
          {
            executionId:
              createExecutionId(),

            workspaceId,

            workspaceSessionId:
              executionScopeId,

            canonicalWorkspaceRoot:
              root,

            command,

            limits: {
              wallTimeMs:
                Math.max(
                  1,
                  Math.min(
                    120_000,
                    Number(timeout) ||
                      120_000
                  )
                ),

              terminateGraceMs:
                2_000,

              stdoutBytes:
                2 *
                1024 *
                1024,

              stderrBytes:
                2 *
                1024 *
                1024,
            },

            requiredCapabilities: {
              filesystemContainment:
                false,

              networkDenied:
                false,

              descendantContainment:
                false,
            },

            authority: {
              policyDecisionId:
                clean(
                  initialDecision
                    ?.decisionId,
                  180
                ) || null,

              policyVersion:
                clean(
                  initialDecision
                    ?.policyVersion,
                  180
                ) || null,

              actionFingerprint:
                clean(
                  initialDecision
                    ?.actionFingerprint,
                  256
                ) || null,

              budgetDecisionId:
                clean(
                  context
                    .budgetDecisionId,
                  180
                ) || null,

              approvalId: null,
            },
          },
          {
            now,
            environment,
          }
        );
    } catch (error) {
      return deniedResult(
        command,
        clean(
          error?.code,
          120
        ) ||
          "SANDBOX_CONTRACT_INVALID",
        now() - started
      );
    }

    const runner =
      createRunner({
        now,
        environment,

        observability:
          observability
            ? (
                event,
                metadata
              ) =>
                observability(
                  event,
                  metadata
                )
            : null,

        async resolveContext({
          workspaceId:
            requestedWorkspaceId,
          workspaceSessionId,
          canonicalWorkspaceRoot,
        }) {
          if (
            requestedWorkspaceId !==
              workspaceId ||
            workspaceSessionId !==
              executionScopeId
          ) {
            throw Object.assign(
              new Error(
                "Contexte Sandbox obsolète."
              ),
              {
                code:
                  "SANDBOX_CONTEXT_STALE",
              }
            );
          }

          const workspace =
            workspaceEngine.context(
              workspaceId
            );

          const roots =
            writableWorkspaceRoots(
              workspace
            );

          const currentRoot =
            canonicalDirectory(
              canonicalWorkspaceRoot
            );

          if (
            !roots.includes(
              authorityRootFor(
                currentRoot
              )
            )
          ) {
            throw Object.assign(
              new Error(
                "Racine Workspace révoquée."
              ),
              {
                code:
                  "SANDBOX_CONTEXT_STALE",
              }
            );
          }

          return {
            workspaceId,

            workspaceSessionId:
              executionScopeId,

            canonicalWorkspaceRoot:
              currentRoot,
          };
        },

        async revalidate() {
          const currentDecision =
            evaluatePolicy();

          return {
            allowed:
              ALLOWED_OUTCOMES.has(
                currentDecision
                  ?.outcome
              ),

            policyVersion:
              currentDecision
                ?.policyVersion ||
              null,
          };
        },
      });

    try {
      const result =
        await runner.run(
          sandboxContract,
          {
            signal,
          }
        );

      return validationResult(
        command,
        result
      );
    } catch (error) {
      return deniedResult(
        command,
        clean(
          error?.code,
          120
        ) ||
          "SANDBOX_EXECUTION_FAILED",
        now() - started
      );
    }
  };
}

module.exports = {
  createSandboxDevValidationExecutor,
  deniedResult,
  failureCategoryFor,
  policyRequest,
  validationResult,
  writableWorkspaceRoots,
};
