"use strict";

const path = require("node:path");

const {
  applyOperation,
  readText,
  validateOperation,
  resolveFile,
  rollbackOperation,
  runSafeCommand,
} = require("./native-repository-tools");

const {
  buildRepositoryContextManifest,
} = require("../delegation/repository-context-manifest");


const {
  contextManifestModeFromInput,
} = require("./benchmark/context-manifest-experiment");

const {
  ALLOWED_PHASES,
  safeError,
  normalizeReasoning,
  unique,
  CONTEXT_FALLBACK_MAX_FILES,
  LOCAL_DEPENDENCY_MAX_FILES,
  isBlockingValidationFailure,
  modelFiles,
} = require("./native-dev-implementation-helpers");
const { createNativeDevInspection } = require("./native-dev-implementation-inspection");
const { createNativeDevSkillExecution } = require("./native-dev-implementation-skills");

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

  // Inspection (native-dev-implementation-inspection.js) et exécution des skills
  // (native-dev-implementation-skills.js), construites avec les dépendances de ce moteur.
  const { inspect, inspectLocalDependencies } = createNativeDevInspection({ journal });
  const { authorize, executeSkill, validate } = createNativeDevSkillExecution({
    journal,
    operationalSecurityPolicy,
    skillRegistry,
    transactionalExecutionEngine,
    validationRunner,
  });


  async function applyEdits(
    contract,
    taskId,
    operations,
    snapshots,
    iteration,
    signal,
    deadline
  ) {
    const changed = [];

    const normalized =
      operations.map(
        (raw) => ({
          type:
            raw.type,

          path:
            String(
              raw.path || ""
            ),

          expectedHash:
            raw.expectedHash ??
            null,

          search:
            raw.search ??
            null,

          replacement:
            raw.replacement ??
            null,

          content:
            raw.content ??
            null,

          iteration,
        })
      );

    // DEV_CORE_PATCH_PREFLIGHT_V1
    // Tout le batch est vérifié avant la première écriture.
    const targets =
      new Set();

    const rollbackPlan =
      new Map();

    for (
      const operation of
      normalized
    ) {
      try {
        const target =
          resolveFile(
            contract,
            operation.path
          );

        if (
          targets.has(
            target.relative
          )
        ) {
          throw Object.assign(
            new Error(
              "Plusieurs opérations ciblent le même fichier."
            ),
            {
              code:
                "DUPLICATE_EDIT_TARGET",
            }
          );
        }

        targets.add(
          target.relative
        );

        const validation =
          validateOperation(
            contract,
            operation,
            snapshots
          );

        const sourceSnapshot =
          snapshots.get(
            target.relative
          );

        rollbackPlan.set(
          target.relative,
          {
            type:
              operation.type,

            path:
              target.relative,

            preHash:
              validation.preHash,

            postHash:
              validation.postHash,

            preContent:
              operation.type ===
                "MODIFY"
                ? sourceSnapshot
                    ?.content ??
                  null
                : null,

            iteration,
          }
        );

        const executionOperation =
          {
            ...operation,

            path:
              path.resolve(
                contract.repositoryRoot,
                operation.path
              ),
          };

        authorize(
          contract,
          {
            skillId:
              "noon_dev_apply_edit",

            operation:
              "update local file",

            args:
              executionOperation,
          },
          "WRITE",
          taskId
        );
      } catch (error) {
        journal.recordFileOperation(
          taskId,
          {
            ...operation,

            status:
              `PREFLIGHT_${
                safeError(
                  error
                ).code
              }`,
          }
        );

        throw error;
      }
    }

    const appliedEntries =
      [];

    // DEV_CORE_PATCH_COMPENSATION_V1
    // Les préimages restent uniquement en mémoire.
    // Elles ne sont jamais ajoutées aux args, journaux
    // ou données fournisseur.
    async function rollbackApplied(
      originalError
    ) {
      if (
        appliedEntries.length ===
          0
      ) {
        throw originalError;
      }

      let rollbackFailure =
        null;

      for (
        const entry of
        [...appliedEntries]
          .reverse()
      ) {
        const rollbackType =
          entry.type ===
            "CREATE"
            ? "DELETE"
            : "MODIFY";

        const rollbackArgs = {
          type:
            rollbackType,

          path:
            path.resolve(
              contract.repositoryRoot,
              entry.path
            ),

          expectedHash:
            entry.postHash,

          search:
            null,

          replacement:
            null,

          content:
            null,

          iteration,
        };

        const step = {
          skillId:
            "noon_dev_apply_edit",

          operation:
            "rollback local file",

          args:
            rollbackArgs,
        };

        try {
          const restored =
            await executeSkill(
              contract,
              taskId,
              step,
              "WRITE",
              {
                applyEdit:
                  () =>
                    rollbackOperation(
                      contract,
                      entry
                    ),
              }
            );

          journal.recordFileOperation(
            taskId,
            {
              type:
                entry.type,

              path:
                entry.path,

              status:
                "ROLLED_BACK",

              preHash:
                entry.postHash,

              postHash:
                restored.postHash,

              iteration,
            }
          );

          if (
            entry.type ===
              "CREATE"
          ) {
            snapshots.delete(
              entry.path
            );
          } else {
            snapshots.set(
              entry.path,
              readText(
                contract,
                entry.path
              )
            );
          }
        } catch (
          rollbackError
        ) {
          if (
            !rollbackFailure
          ) {
            rollbackFailure =
              rollbackError;
          }

          journal.recordFileOperation(
            taskId,
            {
              type:
                entry.type,

              path:
                entry.path,

              status:
                `ROLLBACK_${
                  safeError(
                    rollbackError
                  ).code
                }`,

              preHash:
                entry.postHash,

              postHash:
                null,

              iteration,
            }
          );
        }
      }

      if (
        rollbackFailure
      ) {
        throw Object.assign(
          new Error(
            "Le rollback DEV est incomplet car un fichier a changé après l'écriture Noon."
          ),
          {
            code:
              "PATCH_ROLLBACK_INCOMPLETE",

            cause:
              originalError,
          }
        );
      }

      throw originalError;
    }

    // DEV_CORE_PATCH_EXECUTION_GUARD_V1
    // L'annulation et le timeout sont revalidés
    // avant et après chaque écriture. Si Noon a
    // déjà écrit, la compensation V1 est utilisée.
    function ensureExecutionActive() {
      if (
        signal?.aborted
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
        Number.isFinite(
          Number(
            deadline
          )
        ) &&
        now() >=
          Number(
            deadline
          )
      ) {
        throw Object.assign(
          new Error(
            "Délai DEV dépassé."
          ),
          {
            code:
              "TIMEOUT",
          }
        );
      }
    }

    for (
      let index = 0;
      index <
        normalized.length;
      index += 1
    ) {
      const operation =
        normalized[
          index
        ];

      // Revalidation du reste du batch au plus près
      // de chaque écriture. Si un éditeur externe
      // change un futur fichier, on compense ce que
      // Noon a déjà appliqué.
      try {
        ensureExecutionActive();

        for (
          const pending of
          normalized.slice(
            index
          )
        ) {
          validateOperation(
            contract,
            pending,
            snapshots
          );
        }
      } catch (error) {
        await rollbackApplied(
          error
        );
      }

      const executionOperation =
        {
          ...operation,

          path:
            path.resolve(
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

            status:
              "APPLIED",

            preHash:
              applied.preHash,

            postHash:
              applied.postHash,
          }
        );

        changed.push(
          applied.path
        );

        const rollbackEntry =
          rollbackPlan.get(
            applied.path
          );

        if (
          rollbackEntry
        ) {
          appliedEntries.push(
            rollbackEntry
          );
        }

        if (
          applied.hash
        ) {
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

        await rollbackApplied(
          error
        );
      }

      try {
        ensureExecutionActive();
      } catch (error) {
        await rollbackApplied(
          error
        );
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
    // ON par défaut. OFF nécessite la capability
    // interne du benchmark, impossible à forger
    // par une requête JSON ordinaire.
    const contextManifestMode =
      contextManifestModeFromInput(
        input
      );

    const contextManifest =
      contextManifestMode === "ON"
        ? buildRepositoryContextManifest(
            contract,
            {
              agentsFiles:
                preflight.agentsFiles,
              packageInfo:
                preflight,
            }
          )
        : null;

    // CODE_CONTEXT_EVALUATION_TELEMETRY
    // Métadonnées seulement : aucun contenu source,
    // aucun hash et aucune nouvelle autorité.
    const contextEvaluation = {
      version: 1,

      manifest:
        contextManifest
          ? {
              mode: "ON",

              fileCount:
                contextManifest
                  .files
                  .length,

              scanned:
                contextManifest
                  .scanned,

              truncated:
                contextManifest
                  .truncated,

              excluded: {
                ...contextManifest
                  .excluded,
              },
            }
          : {
              mode: "OFF",
              fileCount: null,
              scanned: null,
              truncated: null,
              excluded: null,
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
    let validationOrdinal = 0;

    let priorFailure = null;
    let solved = false;
    let currentModel = null;
    let escalationCount = 0;

    const failureTelemetry = () => ({
      iterations: iterations.length,
      repairCycles: Math.max(0, iterations.length - 1),
      providerCalls: [...providerCalls],
      escalationCount,
      contextEvaluation: {
        ...contextEvaluation,
        execution: {
          iterations: iterations.length,
          repairCycles: Math.max(0, iterations.length - 1),
        },
      },
    });

    try {
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

      let inspection =
        inspect(
          contract,
          taskId,
          proposal.files,
          proposal.searchTerms,
          snapshots
        );

      const fallbackReadFiles =
        [];

      if (
        iteration === 1 &&
        contextManifest &&
        contextManifest
          .truncated === false &&
        contextManifest
          .files
          .length > 0 &&
        contextManifest
          .files
          .length <=
          CONTEXT_FALLBACK_MAX_FILES &&
        inspection.read.length === 0
      ) {
        const fallback =
          inspect(
            contract,
            taskId,
            contextManifest.files.map(
              (item) =>
                item.path
            ),
            [],
            snapshots
          );

        fallbackReadFiles.push(
          ...fallback.read
        );

        inspection = {
          read:
            unique([
              ...inspection.read,
              ...fallback.read,
            ]),

          searched:
            unique([
              ...inspection.searched,
              ...fallback.searched,
            ]),

          unavailable: [
            ...inspection.unavailable,
            ...fallback.unavailable,
          ],
        };
      }

      const dependencyClosure =
        inspectLocalDependencies(
          contract,
          taskId,
          snapshots,
          inspection.read
        );

      const dependencyReadFiles =
        dependencyClosure.read;

      inspection = {
        ...inspection,

        read:
          unique([
            ...inspection.read,
            ...dependencyReadFiles,
          ]),
      };

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

          ignoredOperationsCount:
            proposal.operations
              .length,
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

          fallbackReadFiles:
            fallbackReadFiles
              .map(String)
              .slice(
                0,
                CONTEXT_FALLBACK_MAX_FILES
              ),

          dependencyReadFiles:
            dependencyReadFiles
              .map(String)
              .slice(
                0,
                LOCAL_DEPENDENCY_MAX_FILES
              ),
        };
      }

      const repositoryKnownEmpty =
        phase === "PLAN" &&
        contextManifest &&
        contextManifest
          .truncated === false &&
        contextManifest
          .files
          .length === 0;

      const requiresExistingSource =
        !repositoryKnownEmpty &&
        (
          phase === "PLAN" ||
          !proposal.operations.length ||
          proposal.operations.some(
            (operation) =>
              operation?.type ===
                "MODIFY"
          )
        );

      if (
        snapshots.size === 0 &&
        requiresExistingSource
      ) {
        throw Object.assign(
          new Error(
            "Aucun contexte source lisible avant édition."
          ),
          {
            code:
              "SOURCE_CONTEXT_REQUIRED",
          }
        );
      }

      // DEV_CORE_PLAN_DISCOVERY_ONLY
      // Une opération proposée pendant PLAN n'est jamais exécutable.
      // PLAN sélectionne le contexte ; EDIT produit le premier patch
      // uniquement après inspection réelle du repository.
      let edits =
        proposal;

      if (
        phase === "PLAN" ||
        !edits.operations
          .length
      ) {
        edits =
          normalizeReasoning(
            await reasoner.reason({
              phase:
                phase === "PLAN"
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
        snapshots.size === 0 &&
        edits.operations.some(
          (operation) =>
            operation?.type ===
              "MODIFY"
        )
      ) {
        throw Object.assign(
          new Error(
            "Une modification exige une lecture préalable du code source."
          ),
          {
            code:
              "SOURCE_CONTEXT_REQUIRED",
          }
        );
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
          iteration,
          activeSignal,
          effectiveDeadline
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
      const validationSnapshots = [];

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
            activeSignal,
            {
              enabled: true,
              input: {
                taskId: input?.taskId === undefined ? taskId : input.taskId,
                workspaceId: input?.workspaceId === undefined
                  ? contract.workspaceId
                  : input.workspaceId,
                sessionId: input?.sessionId === undefined
                  ? contract.sessionId
                  : input.sessionId,
              },
              ordinal: ++validationOrdinal,
              record: (snapshot) => validationSnapshots.push(snapshot),
            }
          )
        );
      }

      iterations.push({
        iteration,
        changedFiles:
          changed,
        validations,
        validationSnapshots,
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
    } catch (error) {
      // Le coordinator doit pouvoir retourner les appels déjà observés sans
      // transformer une erreur d'exécution en succès ni inventer une métrique.
      throw Object.assign(error, {
        nativeDevTelemetry: failureTelemetry(),
      });
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
