"use strict";

const crypto =
  require("node:crypto");
const fs =
  require("node:fs");
const path =
  require("node:path");
const {
  execFileSync,
} = require(
  "node:child_process"
);

const {
  isPathInsideRoots,
} = require(
  "../../lib/path-utils"
);

const {
  projectGoalDevExecution,
} = require(
  "./goal-dev-execution-contract"
);

const VERSION =
  "goal-mode-dev-projection-v1";

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
      "GOAL_MODE_DEV_PROJECTION_INVALID",
      `${label} invalide.`
    );
  }

  return value;
}

function exactObject(
  value,
  label,
  allowed
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
      "GOAL_MODE_DEV_PROJECTION_INVALID",
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
      !allowed.includes(key)
    ) {
      fail(
        "GOAL_MODE_DEV_PROJECTION_INVALID",
        `${label}.${String(key)} non autorisé.`
      );
    }
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

function deterministicTaskId(
  runId,
  stepId,
  proposalFingerprint
) {
  const digest =
    crypto
      .createHash("sha256")
      .update(
        [
          runId,
          stepId,
          proposalFingerprint,
        ].join("\0")
      )
      .digest("hex");

  return (
    "goal-mode-dev-" +
    digest
  );
}

function defaultRepositoryInspector({
  repositoryRoot,
  authorizedRoots,
} = {}) {
  let root;

  try {
    root =
      fs.realpathSync(
        path.resolve(
          requiredString(
            repositoryRoot,
            "repositoryRoot",
            2000
          )
        )
      );
  } catch {
    fail(
      "GOAL_MODE_DEV_REPOSITORY_UNAVAILABLE",
      "Le repository DEV est introuvable."
    );
  }

  if (
    !fs.statSync(root)
      .isDirectory()
  ) {
    fail(
      "GOAL_MODE_DEV_REPOSITORY_UNAVAILABLE",
      "Le repository DEV n'est pas un dossier."
    );
  }

  const roots =
    Array.isArray(
      authorizedRoots
    )
      ? authorizedRoots
          .map((item) => {
            try {
              return fs.realpathSync(
                path.resolve(
                  String(item)
                )
              );
            } catch {
              return null;
            }
          })
          .filter(Boolean)
      : [];

  if (
    !roots.length ||
    !isPathInsideRoots(
      root,
      roots
    )
  ) {
    fail(
      "GOAL_MODE_DEV_ROOT_NOT_AUTHORIZED",
      "Le repository n'est pas dans une racine read-write autorisée."
    );
  }

  let gitRoot;
  let branch;

  try {
    gitRoot =
      execFileSync(
        "git",
        [
          "rev-parse",
          "--show-toplevel",
        ],
        {
          cwd: root,
          encoding: "utf8",
          timeout: 15_000,
          stdio: [
            "ignore",
            "pipe",
            "pipe",
          ],
        }
      )
        .trim();

    branch =
      execFileSync(
        "git",
        [
          "branch",
          "--show-current",
        ],
        {
          cwd: root,
          encoding: "utf8",
          timeout: 15_000,
          stdio: [
            "ignore",
            "pipe",
            "pipe",
          ],
        }
      )
        .trim();
  } catch {
    fail(
      "GOAL_MODE_DEV_REPOSITORY_INVALID",
      "Le projet doit être un repository Git lisible."
    );
  }

  let canonicalGitRoot;

  try {
    canonicalGitRoot =
      fs.realpathSync(
        gitRoot
      );
  } catch {
    fail(
      "GOAL_MODE_DEV_REPOSITORY_INVALID",
      "La racine Git canonique est indisponible."
    );
  }

  if (
    canonicalGitRoot !==
      root
  ) {
    fail(
      "GOAL_MODE_DEV_REPOSITORY_SCOPE_MISMATCH",
      "La racine projet ne correspond pas à la racine Git."
    );
  }

  if (!branch) {
    fail(
      "GOAL_MODE_DEV_BRANCH_REQUIRED",
      "Une branche Git active est requise pour une projection autonome."
    );
  }

  return deepFreeze({
    repositoryRoot:
      root,
    branch:
      requiredString(
        branch,
        "branch",
        200
      ),
  });
}

function numericBudget(
  value,
  label
) {
  if (
    typeof value !==
      "number" ||
    !Number.isFinite(value) ||
    value < 0
  ) {
    fail(
      "GOAL_MODE_DEV_ACCOUNTING_INVALID",
      `${label} invalide.`
    );
  }

  return value;
}

function integerBudget(
  value,
  label
) {
  if (
    !Number.isSafeInteger(
      value
    ) ||
    value < 0
  ) {
    fail(
      "GOAL_MODE_DEV_ACCOUNTING_INVALID",
      `${label} invalide.`
    );
  }

  return value;
}

function createGoalModeDevProjectionService({
  runStore,
  stepProposalStore,
  stepAdmissionService,
  goalStrategyEngine,
  workspaceEngine,
  devBudgetService,
  contractProjector =
    projectGoalDevExecution,
  repositoryInspector =
    defaultRepositoryInspector,
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
    typeof stepAdmissionService
      ?.admit !==
      "function" ||
    typeof goalStrategyEngine
      ?.registry?.get !==
      "function" ||
    typeof workspaceEngine
      ?.context !==
      "function" ||
    typeof devBudgetService
      ?.effectiveRemaining !==
      "function" ||
    typeof devBudgetService
      ?.taskProviderCalls !==
      "function" ||
    typeof contractProjector !==
      "function" ||
    typeof repositoryInspector !==
      "function" ||
    typeof now !==
      "function"
  ) {
    throw new TypeError(
      "Dépendances Goal Mode DEV Projection requises."
    );
  }

  function project(
    input = {}
  ) {
    const source =
      exactObject(
        input,
        "project",
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

    /*
     * 5.0D-3 reste la boundary d'admission canonique.
     * 4B ne duplique pas son raisonnement.
     */
    const admission =
      stepAdmissionService
        .admit({
          runId,
          stepId,
        });

    if (
      admission
        ?.decision ===
        "REQUIRE_USER_INPUT"
    ) {
      fail(
        "GOAL_MODE_DEV_USER_INPUT_REQUIRED",
        "La proposition exige une entrée utilisateur avant projection DEV."
      );
    }

    if (
      admission
        ?.decision !==
        "ADMIT"
    ) {
      fail(
        "GOAL_MODE_DEV_NOT_ADMITTED",
        "La proposition n'est pas admise vers DEV."
      );
    }

    const snapshot =
      runStore.get(
        runId
      );

    const state =
      snapshot?.state;

    if (
      !state ||
      state.status !==
        "RUNNING" ||
      snapshot.revision !==
        admission.runRef
          ?.runRevision ||
      state.contract
        ?.goalRef
        ?.goalId !==
        admission.runRef
          ?.goalId ||
      state.contract
        ?.goalRef
        ?.goalVersion !==
        admission.runRef
          ?.goalVersion
    ) {
      fail(
        "GOAL_MODE_DEV_SNAPSHOT_STALE",
        "Le Goal Run a changé après l'admission."
      );
    }

    const record =
      stepProposalStore.get(
        stepId
      );

    if (
      !record ||
      record.stepId !==
        admission.stepRef
          ?.stepId ||
      record.proposal
        ?.proposalId !==
        admission.stepRef
          ?.proposalId ||
      record.proposal
        ?.fingerprint !==
        admission.stepRef
          ?.proposalFingerprint ||
      record.planningRef
        ?.targetFingerprint !==
        admission.stepRef
          ?.targetFingerprint
    ) {
      fail(
        "GOAL_MODE_DEV_STEP_STALE",
        "La proposition durable ne correspond plus à l'admission."
      );
    }

    const goal =
      goalStrategyEngine
        .registry
        .get(
          admission.runRef
            .goalId
        );

    if (
      !goal ||
      goal.status !==
        "ACTIVE" ||
      goal.userConfirmed !==
        true ||
      goal.version !==
        admission.runRef
          .goalVersion
    ) {
      fail(
        "GOAL_MODE_DEV_GOAL_STALE",
        "Le Goal autoritatif a changé."
      );
    }

    const contract =
      state.contract;

    const workspaceId =
      contract.scope
        ?.workspaceId;

    const projectId =
      contract.scope
        ?.projectId;

    if (
      !workspaceId ||
      !projectId
    ) {
      fail(
        "GOAL_MODE_DEV_SCOPE_REQUIRED",
        "Une projection DEV autonome exige workspaceId et projectId explicites."
      );
    }

    if (
      contract.localOnly ===
        true
    ) {
      fail(
        "GOAL_MODE_DEV_REMOTE_REASONING_BLOCKED",
        "Native DEV distant n'est pas disponible pour un Goal Run local_only."
      );
    }

    const capabilities =
      record.proposal
        ?.requestedCapabilities;

    if (
      capabilities
        ?.gitWrite ===
        true ||
      capabilities
        ?.destructiveActions ===
        true
    ) {
      fail(
        "GOAL_MODE_DEV_CAPABILITY_UNSUPPORTED",
        "La projection Native DEV ne peut pas accorder Git write ni action destructive."
      );
    }

    /*
     * Native DEV actuel utilise le reasoner distant.
     * La capacité réseau doit donc avoir été demandée
     * dans la proposition. 4B ne l'accorde pas :
     * l'autorisation réelle reste à la tranche suivante.
     */
    if (
      capabilities
        ?.network !==
        true
    ) {
      fail(
        "GOAL_MODE_DEV_REMOTE_REASONING_REQUIRED",
        "La proposition DEV doit demander la capacité réseau pour le reasoner distant."
      );
    }

    const workspace =
      workspaceEngine
        .context(
          workspaceId
        );

    if (
      workspace
        ?.workspace
        ?.id !==
        workspaceId ||
      workspace
        ?.workspace
        ?.status !==
        "active" ||
      workspace
        ?.workspace
        ?.profileScope !==
        contract.scope
          .profileScope
    ) {
      fail(
        "GOAL_MODE_DEV_WORKSPACE_STALE",
        "Le workspace autoritatif n'est plus compatible avec le Goal Run."
      );
    }

    const projects =
      (
        Array.isArray(
          workspace.projects
        )
          ? workspace.projects
          : []
      )
        .filter(
          (project) =>
            String(
              project?.id ||
              ""
            ) ===
            projectId
        );

    if (
      projects.length !==
        1
    ) {
      fail(
        "GOAL_MODE_DEV_PROJECT_UNRESOLVED",
        "Le projet DEV autoritatif est absent ou ambigu."
      );
    }

    const project =
      projects[0];

    const roots =
      (
        Array.isArray(
          workspace.relevantRoots
        )
          ? workspace.relevantRoots
          : Array.isArray(
                workspace.roots
              )
            ? workspace.roots
            : []
      )
        .filter(
          (entry) =>
            entry?.mode ===
              "read-write"
        )
        .map(
          (entry) =>
            entry.path
        );

    const repository =
      repositoryInspector({
        repositoryRoot:
          project.rootPath,
        authorizedRoots:
          roots,
      });

    const usage =
      state.usage;

    const limits =
      contract.limits;

    const usedProviderCalls =
      integerBudget(
        usage.providerCalls,
        "usage.providerCalls"
      );

    const maximumProviderCalls =
      integerBudget(
        limits.maxProviderCalls,
        "limits.maxProviderCalls"
      );

    const proposedProviderCalls =
      integerBudget(
        record.proposal
          .usage
          .providerCalls,
        "proposal.usage.providerCalls"
      );

    const availableProviderCalls =
      Math.max(
        0,
        maximumProviderCalls -
          usedProviderCalls
      );

    if (
      proposedProviderCalls <
        1
    ) {
      fail(
        "GOAL_MODE_DEV_PROVIDER_BUDGET_REQUIRED",
        "Native DEV exige au moins un appel provider autorisé pour cette étape."
      );
    }

    if (
      proposedProviderCalls >
        availableProviderCalls
    ) {
      fail(
        "GOAL_MODE_DEV_PROVIDER_BUDGET_STALE",
        "La quota provider proposée n'est plus disponible dans le Goal Run."
      );
    }

    const usedCost =
      numericBudget(
        usage.estimatedCost,
        "usage.estimatedCost"
      );

    const maximumCost =
      numericBudget(
        limits.maxEstimatedCost,
        "limits.maxEstimatedCost"
      );

    const proposedCost =
      numericBudget(
        record.proposal
          .usage
          .estimatedCost,
        "proposal.usage.estimatedCost"
      );

    const availableCost =
      Math.max(
        0,
        maximumCost -
          usedCost
      );

    if (
      proposedCost <= 0
    ) {
      fail(
        "GOAL_MODE_DEV_COST_BUDGET_REQUIRED",
        "Native DEV distant exige un budget coût positif pour cette étape."
      );
    }

    if (
      proposedCost >
        availableCost +
          Number.EPSILON
    ) {
      fail(
        "GOAL_MODE_DEV_COST_BUDGET_STALE",
        "Le budget coût proposé n'est plus disponible dans le Goal Run."
      );
    }

    const observedAt =
      new Date(
        now()
      );

    if (
      !Number.isFinite(
        observedAt.getTime()
      )
    ) {
      fail(
        "GOAL_MODE_DEV_CLOCK_INVALID",
        "Horloge de projection invalide."
      );
    }

    const elapsedMs =
      Math.max(
        0,
        observedAt.getTime() -
          Date.parse(
            contract.admittedAt
          )
      );

    const remainingDuration =
      Math.max(
        0,
        limits.maxDuration -
          elapsedMs
      );

    /*
     * GoalDevExecutionContract borne Native DEV
     * à minimum 1 seconde. On refuse plutôt que
     * d'élargir silencieusement la durée globale.
     */
    if (
      remainingDuration <
        1_000
    ) {
      fail(
        "GOAL_MODE_DEV_TIME_BUDGET_BLOCKED",
        "Le temps restant du Goal Run est insuffisant pour une tâche DEV."
      );
    }

    const taskId =
      deterministicTaskId(
        runId,
        stepId,
        record.proposal
          .fingerprint
      );

    const priorProviderCalls =
      devBudgetService
        .taskProviderCalls(
          taskId
        );

    if (
      !Number.isSafeInteger(
        priorProviderCalls
      ) ||
      priorProviderCalls < 0
    ) {
      fail(
        "GOAL_MODE_DEV_LEDGER_INVALID",
        "Le ledger DEV ne peut pas établir le nombre d'appels de cette tâche."
      );
    }

    if (
      priorProviderCalls >
        0
    ) {
      fail(
        "GOAL_MODE_DEV_RECOVERY_REQUIRED",
        "Cette tâche DEV a déjà potentiellement commencé ; une récupération dédiée est requise."
      );
    }

    const request = {
      taskId,

      sessionId:
        `goal-mode:${runId}`,

      workspaceId,
      projectId,

      repositoryRoot:
        repository
          .repositoryRoot,

      branch:
        repository.branch,

      objective:
        record.proposal
          .objective,

      allowedPaths: [
        repository
          .repositoryRoot,
      ],

      constraints: [
        (
          "GOAL_MODE_EXPECTED_OUTCOME: " +
          record.proposal
            .expectedOutcome
        ),

        (
          "GOAL_MODE_EVIDENCE_TARGETS: " +
          record.proposal
            .evidenceTargetIds
            .join(",")
        ),
      ],

      validationCommands: [],

      requiredQuality:
        "HIGH",

      limits: {
        maxRetries:
          record.proposal
            .usage
            .retries,

        maxDuration:
          remainingDuration,

        maxEstimatedCost:
          proposedCost,

        /*
         * Quota de CETTE étape uniquement.
         * Jamais le plafond global brut du run.
         */
        maxProviderCalls:
          proposedProviderCalls,
      },

      permissions: {
        allowNetwork:
          true,
        allowGitWrite:
          false,
        allowDestructiveActions:
          false,
      },

      localOnly:
        false,
    };

    const devContract =
      contractProjector({
        goal,
        request,
        budgetService:
          devBudgetService,
      });

    if (
      devContract
        ?.capabilities
        ?.executionAuthority !==
        false ||
      devContract
        ?.capabilities
        ?.gitWriteAllowed !==
        false ||
      devContract
        ?.capabilities
        ?.destructiveActionsAllowed !==
        false ||
      devContract
        ?.devInput
        ?.taskId !==
        taskId ||
      devContract
        ?.devInput
        ?.repositoryRoot !==
        repository
          .repositoryRoot ||
      devContract
        ?.devInput
        ?.branch !==
        repository.branch ||
      devContract
        ?.devInput
        ?.maxProviderCalls !==
        proposedProviderCalls ||
      devContract
        ?.devInput
        ?.maxEstimatedCost >
        proposedCost +
          Number.EPSILON
    ) {
      fail(
        "GOAL_MODE_DEV_CONTRACT_INVALID",
        "Le contrat Goal→DEV a élargi ou modifié une borne critique."
      );
    }

    if (
      devContract
        .devInput
        .maxEstimatedCost <=
        0
    ) {
      fail(
        "GOAL_MODE_DEV_SECONDARY_BUDGET_BLOCKED",
        "Le budget DEV secondaire ne permet plus l'exécution de cette étape."
      );
    }

    return deepFreeze({
      version:
        VERSION,

      runRef: {
        runId,
        runRevision:
          snapshot.revision,
        goalId:
          admission.runRef
            .goalId,
        goalVersion:
          admission.runRef
            .goalVersion,
      },

      stepRef: {
        stepId,
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

      taskRef: {
        taskId,
        workspaceId,
        projectId,
        repositoryRoot:
          repository
            .repositoryRoot,
        branch:
          repository.branch,
      },

      accounting: {
        goalRunBefore: {
          providerCalls:
            usedProviderCalls,
          estimatedCost:
            usedCost,
        },

        globalAvailableBefore: {
          providerCalls:
            availableProviderCalls,
          estimatedCost:
            availableCost,
          duration:
            remainingDuration,
        },

        stepUpperBound: {
          providerCalls:
            proposedProviderCalls,
          estimatedCost:
            proposedCost,
          retries:
            record.proposal
              .usage
              .retries,
          steps:
            record.proposal
              .usage
              .steps,
        },

        devSecondaryCostCap:
          devContract
            .devInput
            .maxEstimatedCost,

        consumed:
          false,
      },

      authorization: {
        networkRequested:
          true,
        externalAuthorizationRequired:
          admission
            .capabilityAdmission
            ?.externalAuthorizationRequired ===
            true,
        approvalPrepared:
          false,
        capabilitiesGranted:
          false,
      },

      securityBoundary: {
        goalLevelActionRequestSynthesized:
          false,
        nativeDevOwnsOperationalActions:
          true,
        nativeOperationalSecurityRequired:
          true,
        transactionalExecutionRequired:
          true,
      },

      devContract,

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
    project,
  });
}

module.exports = {
  VERSION,
  createGoalModeDevProjectionService,
  defaultGoalModeDevRepositoryInspector:
    defaultRepositoryInspector,
  deterministicGoalModeDevTaskId:
    deterministicTaskId,
};
