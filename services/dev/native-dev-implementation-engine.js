"use strict";

const crypto = require("node:crypto");
const path = require("node:path");

const {
  CONTENT_SECRET,
  applyOperation,
  readText,
  resolveFile,
  runSafeCommand,
  searchRepository,
} = require("./native-repository-tools");

const {
  buildRepositoryContextManifest,
} = require("../delegation/repository-context-manifest");

const ALLOWED_PHASES = new Set([
  "PLAN",
  "EDIT",
  "DIAGNOSE",
  "REPAIR",
]);

function safeError(error, fallback = "TASK_FAILURE") {
  return {
    code: String(error?.code || fallback).slice(0, 80),
    message: String(
      error?.message ||
        "Échec de la tâche DEV."
    ).slice(0, 240),
  };
}

function normalizeReasoning(value = {}) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw Object.assign(
      new Error(
        "Réponse DEV mal formée."
      ),
      {
        code:
          "MALFORMED_PROVIDER_RESPONSE",
      }
    );
  }

  const files =
    Array.isArray(value.files)
      ? value.files
          .map(String)
          .slice(0, 30)
      : [];

  const searchTerms =
    Array.isArray(
      value.searchTerms
    )
      ? value.searchTerms
          .map(String)
          .filter(Boolean)
          .slice(0, 12)
      : [];

  const operations =
    Array.isArray(
      value.operations
    )
      ? value.operations.slice(
          0,
          20
        )
      : [];

  const validationCommands =
    Array.isArray(
      value.validationCommands
    )
      ? value.validationCommands
          .map(String)
          .slice(0, 12)
      : [];

  const providerMetrics =
    value.providerMetrics &&
    typeof value.providerMetrics ===
      "object"
      ? {
          provider: String(
            value.providerMetrics
              .provider ||
              "unknown"
          ).slice(0, 40),

          model: String(
            value.providerMetrics
              .model ||
              "unknown"
          ).slice(0, 100),

          latencyMs: Math.max(
            0,
            Number(
              value.providerMetrics
                .latencyMs
            ) || 0
          ),

          usage:
            value.providerMetrics
              .usage &&
            typeof value
              .providerMetrics
              .usage === "object"
              ? value
                  .providerMetrics
                  .usage
              : null,

          estimatedCost:
            value.providerMetrics
                .estimatedCost !=
              null &&
            Number.isFinite(
              Number(
                value
                  .providerMetrics
                  .estimatedCost
              )
            )
              ? Number(
                  value
                    .providerMetrics
                    .estimatedCost
                )
              : null,

          actualCost:
            value.providerMetrics
                .actualCost != null &&
            Number.isFinite(
              Number(
                value
                  .providerMetrics
                  .actualCost
              )
            )
              ? Number(
                  value
                    .providerMetrics
                    .actualCost
                )
              : null,

          routeReasonCodes:
            Array.isArray(
              value
                .providerMetrics
                .routeReasonCodes
            )
              ? value
                  .providerMetrics
                  .routeReasonCodes
                  .map(String)
                  .slice(0, 20)
              : [],

          reservationId:
            value.providerMetrics
              .reservationId
              ? String(
                  value
                    .providerMetrics
                    .reservationId
                ).slice(0, 160)
              : null,

          budgetBefore:
            value.providerMetrics
              .budgetBefore ||
            null,

          budgetAfter:
            value.providerMetrics
              .budgetAfter ||
            null,
        }
      : null;

  return {
    summary: String(
      value.summary || ""
    ).slice(0, 2000),
    files,
    searchTerms,
    operations,
    validationCommands,
    providerMetrics,
  };
}

function unique(items) {
  return [
    ...new Set(
      items.filter(Boolean)
    ),
  ];
}

function isBlockingValidationFailure(
  result = {}
) {
  if (
    result.status === "PASS"
  ) {
    return false;
  }

  // Une commande optionnelle proposée par le modèle reste
  // une donnée non fiable : son refus par l'allowlist
  // prouve que la sécurité fonctionne, pas que le patch est faux.
  return (
    result.failureCategory !==
    "COMMAND_NOT_ALLOWLISTED"
  );
}

function createNativeDevImplementationEngine({
  transactionalExecutionEngine,
  operationalSecurityPolicy,
  skillRegistry,
  reasoner,
  journal,
  qualityEscalationMode = () =>
    "OFF",
  sameTierRepairAttempts = () =>
    2,
  now = () => Date.now(),
  validationRunner = runSafeCommand,
} = {}) {
  if (
    !transactionalExecutionEngine
      ?.execute
  ) {
    throw new TypeError(
      "TransactionalExecutionEngine requis."
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

  if (
    !skillRegistry?.executeSkill
  ) {
    throw new TypeError(
      "SkillRegistry requis."
    );
  }

  if (!reasoner?.reason) {
    throw new TypeError(
      "Reasoner DEV requis."
    );
  }

  if (!journal?.start) {
    throw new TypeError(
      "Journal DEV requis."
    );
  }

  function authorize(
    contract,
    step,
    actionClass,
    taskId = null
  ) {
    const actionRequest = {
      origin:
        "explicit_user_chat",
      skillId: step.skillId,
      operation:
        actionClass === "WRITE"
          ? "update local file"
          : "read validate local repository",
      args: {
        path:
          contract.repositoryRoot,
      },
      workspaceId:
        contract.workspaceId,
      explicitOrder: true,
      actionClass,
      target: {
        scope: "LOCAL",
        scopeName: "workspace",
        targetType:
          actionClass === "WRITE"
            ? "file"
            : "repository",
        targetCount: 1,
      },
    };

    const benchmarkScope =
      contract.benchmark
        ? {
            authorizedRoots: [
              contract.repositoryRoot,
            ],
            authorizedWriteRoots: [
              contract.repositoryRoot,
            ],
          }
        : {};

    const scopeTelemetry =
      contract.benchmark
        ? {
            benchmark: true,
            sessionId:
              contract.benchmark.id,
            runId: taskId,
            workspaceRoot:
              contract.repositoryRoot,
          }
        : null;

    const decision =
      operationalSecurityPolicy.evaluate(
        {
          actionRequest,
          skillPolicy: {
            level:
              actionClass ===
              "WRITE"
                ? "write"
                : "read",
          },
          currentPermissions: {
            allowed: true,
            code:
              actionClass ===
              "WRITE"
                ? "READ_WRITE_WORKSPACE"
                : "TERMINAL_SAFE",
          },
          ...(scopeTelemetry
            ? {
                scopeTelemetry,
              }
            : {}),
          ...benchmarkScope,
        }
      );

    if (
      ![
        "ALLOW",
        "ALLOW_WITH_CONSTRAINTS",
      ].includes(
        decision.outcome
      )
    ) {
      throw Object.assign(
        new Error(
          "Action DEV refusée par la politique de sécurité."
        ),
        {
          code:
            "PERMISSION_FAILURE",
        }
      );
    }

    return {
      actionRequest,
      decision,
    };
  }

  async function executeSkill(
    contract,
    taskId,
    step,
    actionClass,
    handlers
  ) {
    const {
      actionRequest,
      decision,
    } = authorize(
      contract,
      step,
      actionClass,
      taskId
    );

    const executionId =
      `${taskId}-${step.skillId}-${crypto.randomUUID()}`;

    const outcome =
      await transactionalExecutionEngine.execute(
        {
          executionId,
          workspaceId:
            contract.workspaceId,
          profileScope:
            "arnaud",
          actionRequest,
          policyDecision:
            decision,
          steps: [
            {
              ...step,
              stepId: "step-1",
              actionClass,
              verificationLevel:
                "BASIC",
            },
          ],

          executeStep:
            (
              planned
            ) =>
              skillRegistry.executeSkill(
                planned.skillId,
                planned.args,
                {
                  explicitOrder:
                    true,
                  confirmed: true,
                  allowedRoots:
                    contract.allowedPaths,
                  allowedWriteRoots:
                    contract.allowedPaths,
                  sessionId:
                    taskId,
                  handlers,
                }
              ),

          revalidate: () =>
            authorize(
              contract,
              step,
              actionClass,
              taskId
            ).decision,

          checkPreconditions:
            () => ({
              valid: true,
            }),
        }
      );

    if (
      outcome.status !==
      "SUCCEEDED"
    ) {
      throw Object.assign(
        new Error(
          "Étape transactionnelle DEV incomplète."
        ),
        {
          code:
            `TRANSACTION_${outcome.status}`,
        }
      );
    }

    return outcome.result;
  }

  async function validate(
    contract,
    taskId,
    command,
    iteration,
    signal
  ) {
    const step = {
      skillId:
        "noon_dev_run_validation",
      operation:
        "validate repository",
      args: {
        command,
        iteration,
      },
    };

    const result =
      await executeSkill(
        contract,
        taskId,
        step,
        "READ",
        {
          runValidation:
            async () =>
              validationRunner(
                command,
                contract.repositoryRoot,
                Math.min(
                  contract.maxDuration,
                  120_000
                ),
                signal
              ),
        }
      );

    journal.recordCommand(
      taskId,
      result,
      iteration
    );

    return result;
  }

  function inspect(
    contract,
    taskId,
    requestedFiles,
    searchTerms,
    snapshots
  ) {
    const searched =
      searchTerms.length
        ? searchRepository(
            contract,
            searchTerms
          )
        : [];

    const read = [];
    const unavailable = [];

    for (
      const file of unique([
        ...requestedFiles,
        ...searched,
      ]).slice(0, 40)
    ) {
      try {
        const item =
          readText(
            contract,
            file
          );

        snapshots.set(
          item.relative,
          item
        );

        journal.recordRead(
          taskId,
          item.relative,
          item.hash
        );

        read.push(
          item.relative
        );
      } catch (error) {
        // REPOSITORY_CONTEXT_UNAVAILABLE_NORMALIZATION
        const unavailableCode =
          ["ENOENT", "ENOTDIR"].includes(
            error?.code
          )
            ? "FILE_UNAVAILABLE"
            : error?.code;

        if (
          ![
            "FILE_UNAVAILABLE",
            "BINARY_FILE_DENIED",
          ].includes(
            unavailableCode
          )
        ) {
          throw error;
        }

        unavailable.push({
          path:
            String(file)
              .slice(0, 400),
          code:
            String(
              unavailableCode
            ).slice(0, 80),
        });
      }
    }

    return {
      read,
      searched,
      unavailable,
    };
  }

  function modelFiles(
    snapshots
  ) {
    return [
      ...snapshots.values(),
    ].map((item) =>
      CONTENT_SECRET.test(
        item.content
      )
        ? {
            path:
              item.relative,
            hash: item.hash,
            content: null,
            omitted:
              "SENSITIVE_CONTENT",
          }
        : {
            path:
              item.relative,
            hash: item.hash,
            content:
              item.content.slice(
                0,
                80_000
              ),
            omitted:
              item.content.length >
              80_000
                ? "TRUNCATED"
                : null,
          }
    );
  }

  async function applyEdits(
    contract,
    taskId,
    operations,
    snapshots,
    iteration
  ) {
    const changed = [];

    for (const raw of operations) {
      const operation = {
        type: raw.type,
        path: String(
          raw.path || ""
        ),
        expectedHash:
          raw.expectedHash ??
          null,
        search:
          raw.search ?? null,
        replacement:
          raw.replacement ??
          null,
        content:
          raw.content ?? null,
        iteration,
      };

      resolveFile(
        contract,
        operation.path
      );

      const executionOperation =
        {
          ...operation,
          path: path.resolve(
            contract.repositoryRoot,
            operation.path
          ),
        };

      const step = {
        skillId:
          "noon_dev_apply_edit",
        operation:
          "update local file",
        args:
          executionOperation,
      };

      try {
        const applied =
          await executeSkill(
            contract,
            taskId,
            step,
            "WRITE",
            {
              applyEdit:
                (args) =>
                  applyOperation(
                    contract,
                    args,
                    snapshots
                  ),
            }
          );

        journal.recordFileOperation(
          taskId,
          {
            ...operation,
            status: "APPLIED",
            preHash:
              applied.preHash,
            postHash:
              applied.postHash,
          }
        );

        changed.push(
          applied.path
        );

        if (applied.hash) {
          snapshots.set(
            applied.path,
            readText(
              contract,
              applied.path
            )
          );
        }
      } catch (error) {
        journal.recordFileOperation(
          taskId,
          {
            ...operation,
            status:
              safeError(
                error
              ).code,
          }
        );

        throw error;
      }
    }

    return changed;
  }

  async function runImplementation({
    contract,
    preflight,
    input = {},
    taskId =
      contract?.taskId,
    signal,
    defaultCommands = [],
    deadline,
    progress = {},
  } = {}) {
    if (!contract) {
      throw new TypeError(
        "DevTaskContract requis."
      );
    }

    if (!preflight) {
      throw new TypeError(
        "Preflight DEV requis."
      );
    }

    // REPOSITORY_CONTEXT_MANIFEST_EPHEMERAL
    // Construit après validation du contrat/preflight.
    // Il n'est ni ajouté au preflight partagé, ni persisté.
    const contextManifest =
      buildRepositoryContextManifest(
        contract,
        {
          agentsFiles:
            preflight.agentsFiles,
          packageInfo:
            preflight,
        }
      );

    // CODE_CONTEXT_EVALUATION_TELEMETRY
    // Métadonnées seulement : aucun contenu source,
    // aucun hash et aucune nouvelle autorité.
    const contextEvaluation = {
      version: 1,

      manifest: {
        fileCount:
          contextManifest.files.length,

        scanned:
          contextManifest.scanned,

        truncated:
          contextManifest.truncated,

        excluded: {
          ...contextManifest.excluded,
        },
      },

      plan: {
        requestedFiles: [],
        searchTerms: [],
      },

      inspection: {
        readFiles: [],
        unavailableFiles: [],
        searchResults: [],
      },
    };

    const activeSignal =
      signal ||
      new AbortController()
        .signal;

    const effectiveDeadline =
      Number.isFinite(
        Number(deadline)
      )
        ? Number(deadline)
        : now() +
          contract.maxDuration;

    const snapshots =
      new Map();

    const iterations = [];
    const touched =
      new Set();
    const providerCalls = [];

    let priorFailure = null;
    let solved = false;
    let currentModel = null;
    let escalationCount = 0;

    for (
      let iteration = 1;
      iteration <=
      contract.maxIterations;
      iteration += 1
    ) {
      if (
        activeSignal.aborted
      ) {
        throw Object.assign(
          new Error(
            "Tâche annulée."
          ),
          {
            code:
              "CANCELLED",
          }
        );
      }

      if (
        now() >=
        effectiveDeadline
      ) {
        throw Object.assign(
          new Error(
            "Délai DEV dépassé."
          ),
          {
            code: "TIMEOUT",
          }
        );
      }

      const phase =
        iteration === 1
          ? "PLAN"
          : "REPAIR";

      journal.transition(
        taskId,
        phase,
        {
          iteration,
        }
      );

      if (
        !ALLOWED_PHASES.has(
          phase
        )
      ) {
        throw new Error(
          "DEV_PHASE_INVALID"
        );
      }

      const repairLimit =
        Math.max(
          0,
          Number(
            typeof sameTierRepairAttempts ===
              "function"
              ? sameTierRepairAttempts(
                  input
                )
              : sameTierRepairAttempts
          ) || 0
        );

      const escalationEnabled =
        String(
          typeof qualityEscalationMode ===
            "function"
            ? qualityEscalationMode(
                input
              )
            : qualityEscalationMode
        ) === "LIMITED";

      const qualityEscalation =
        escalationEnabled &&
        priorFailure
          ?.intellectual === true &&
        iteration > repairLimit
          ? {
              requested: true,
              fromModel:
                currentModel,
              evidence:
                priorFailure
                  .failureCategory,
            }
          : null;

      if (
        qualityEscalation
      ) {
        escalationCount += 1;
      }

      progress.backendReached =
        true;

      const proposal =
        normalizeReasoning(
          await reasoner.reason({
            phase,
            contract,
            preflight: {
              branch:
                preflight.branch,
              language:
                preflight.language,
              framework:
                preflight.framework,
              dirtyFiles:
                preflight
                  .snapshot
                  .files,
              // REPOSITORY_CONTEXT_MANIFEST_PLAN_ONLY
              contextManifest:
                phase === "PLAN"
                  ? contextManifest
                  : undefined,
            },
            files:
              modelFiles(
                snapshots
              ),
            previousFailure:
              priorFailure,
            qualityEscalation,
            signal:
              activeSignal,
          })
        );

      if (
        proposal.providerMetrics
      ) {
        providerCalls.push(
          proposal.providerMetrics
        );

        currentModel =
          proposal
            .providerMetrics
            .model ||
          currentModel;
      }

      const inspection =
        inspect(
          contract,
          taskId,
          proposal.files,
          proposal.searchTerms,
          snapshots
        );

      if (iteration === 1) {
        contextEvaluation.plan = {
          requestedFiles:
            proposal.files
              .map(
                (value) =>
                  String(value)
                    .replace(
                      /[\r\n]/g,
                      " "
                    )
                    .slice(0, 400)
              )
              .slice(0, 30),

          searchTerms:
            proposal.searchTerms
              .map(
                (value) =>
                  String(value)
                    .replace(
                      /[\r\n]/g,
                      " "
                    )
                    .slice(0, 200)
              )
              .slice(0, 12),
        };

        contextEvaluation.inspection = {
          readFiles:
            inspection.read
              .map(String)
              .slice(0, 40),

          unavailableFiles:
            inspection.unavailable
              .map(
                (item) => ({
                  path:
                    String(
                      item?.path || ""
                    ).slice(0, 400),

                  code:
                    String(
                      item?.code || ""
                    ).slice(0, 80),
                })
              )
              .slice(0, 40),

          searchResults:
            inspection.searched
              .map(String)
              .slice(0, 80),
        };
      }

      let edits =
        proposal;

      if (
        !edits.operations
          .length
      ) {
        edits =
          normalizeReasoning(
            await reasoner.reason({
              phase:
                iteration === 1
                  ? "EDIT"
                  : "REPAIR",
              contract,
              preflight: {
                branch:
                  preflight.branch,
                language:
                  preflight.language,
                framework:
                  preflight.framework,
                dirtyFiles:
                  preflight
                    .snapshot
                    .files,
              },
              files:
                modelFiles(
                  snapshots
                ),
              searchResults:
                inspection
                  .searched,
              unavailableFiles:
                inspection
                  .unavailable,
              previousFailure:
                priorFailure,
              qualityEscalation,
              signal:
                activeSignal,
            })
          );

        if (
          edits.providerMetrics
        ) {
          providerCalls.push(
            edits.providerMetrics
          );

          currentModel =
            edits
              .providerMetrics
              .model ||
            currentModel;
        }
      }

      if (
        !edits.operations
          .length
      ) {
        throw Object.assign(
          new Error(
            "Aucun patch ciblé proposé."
          ),
          {
            code:
              "TASK_FAILURE",
          }
        );
      }

      const changed =
        await applyEdits(
          contract,
          taskId,
          edits.operations,
          snapshots,
          iteration
        );

      changed.forEach(
        (file) =>
          touched.add(file)
      );

      const commands =
        unique([
          ...edits.validationCommands,
          ...proposal
            .validationCommands,
          ...defaultCommands,
        ]);

      const validations = [];

      journal.transition(
        taskId,
        "VALIDATING",
        {
          iteration,
        }
      );

      for (
        const command of commands
      ) {
        validations.push(
          await validate(
            contract,
            taskId,
            command,
            iteration,
            activeSignal
          )
        );
      }

      iterations.push({
        iteration,
        changedFiles:
          changed,
        validations,
      });

      const failed =
        validations.find(
          isBlockingValidationFailure
        );

      if (!failed) {
        solved = true;
        break;
      }

      priorFailure = {
        command:
          failed.command,
        status: failed.status,
        failureCategory:
          "VALIDATION_FAILURE",
        validationCategory:
          failed.failureCategory,
        intellectual: true,
        outputTail: String(
          failed.outputTail || ""
        ).slice(-4000),
      };
    }

    return {
      solved,
      iterations,
      touched: [
        ...touched,
      ],
      providerCalls,
      escalationCount,

      contextEvaluation: {
        ...contextEvaluation,

        execution: {
          iterations:
            iterations.length,

          repairCycles:
            Math.max(
              0,
              iterations.length - 1
            ),
        },
      },

      lastValidations:
        iterations.at(-1)
          ?.validations || [],
    };
  }

  return Object.freeze({
    runImplementation,
    validate,
  });
}

module.exports = {
  createNativeDevImplementationEngine,
  isBlockingValidationFailure,
  normalizeReasoning,
};
