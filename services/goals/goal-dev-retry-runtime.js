"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  createGoalDevRetryChainRepository,
} = require("../persistence/repositories/goal-dev-retry-chain-repository");

const {
  createGoalDevRetryChainStore,
} = require("./goal-dev-retry-chain-store");

const {
  OPERATION,
  SKILL_NAME,
  createGoalDevRetryPermitService,
} = require("./goal-dev-retry-permit-service");

const {
  createGoalDevApprovedRetryService,
} = require("./goal-dev-approved-retry-service");

const VERSION = "goal-dev-retry-runtime-v1";

const RETRY_SKILL_POLICY = Object.freeze({
  level: "write",
  networkAccess: false,
  explicitOrderRequired: true,
});

function failure(code, message) {
  return Object.assign(new Error(message), { code });
}

function clean(value, max = 200) {
  return String(value ?? "")
    .replace(/[\0\r\n]+/g, " ")
    .trim()
    .slice(0, max);
}

function canonicalPath(value, label) {
  const source = clean(value, 4000);

  if (!source) {
    throw failure(
      "GOAL_DEV_RETRY_AUTHORITY_INVALID",
      `${label} requis.`
    );
  }

  const resolved = path.resolve(source);

  try {
    return fs.realpathSync.native(resolved);
  } catch {
    throw failure(
      "GOAL_DEV_RETRY_REPOSITORY_UNAVAILABLE",
      `${label} indisponible.`
    );
  }
}

function isInside(root, target) {
  const relative = path.relative(root, target);

  return (
    relative === "" ||
    (
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
    )
  );
}

function createGoalDevRetryRuntime({
  database,
  approvalEngine,
  operationalSecurityPolicy,
  interventionPermissionEngine,
  goalDevExecutionService,
  workspaceEngine,
  projectProvider,
  profileScopeProvider = () => "arnaud",
  now = () => new Date().toISOString(),
  observability = null,
} = {}) {
  if (!database) {
    throw new TypeError("Base personnelle requise.");
  }

  if (
    typeof approvalEngine?.prepareAction !== "function" ||
    typeof approvalEngine?.resumeApprovedAction !== "function" ||
    typeof approvalEngine?.getPreparedGoalDevRetryExactAction !== "function"
  ) {
    throw new TypeError("ApprovalEngine canonique requis.");
  }

  if (
    typeof operationalSecurityPolicy?.createActionRequest !== "function" ||
    typeof operationalSecurityPolicy?.evaluate !== "function"
  ) {
    throw new TypeError("OperationalSecurityPolicy requise.");
  }

  if (
    typeof interventionPermissionEngine?.evaluate !== "function"
  ) {
    throw new TypeError("InterventionPermissionEngine requis.");
  }

  if (typeof goalDevExecutionService?.run !== "function") {
    throw new TypeError("Goal DEV Execution Service requis.");
  }

  if (typeof workspaceEngine?.context !== "function") {
    throw new TypeError("WorkspaceEngine requis.");
  }

  if (typeof projectProvider !== "function") {
    throw new TypeError("Project provider autoritatif requis.");
  }

  if (typeof profileScopeProvider !== "function") {
    throw new TypeError("Profile scope provider requis.");
  }

  const repository =
    createGoalDevRetryChainRepository(database);

  const chainStore =
    createGoalDevRetryChainStore({
      repository,
      now,
    });

  function emit(event, metadata = {}) {
    try {
      observability?.(event, metadata);
    } catch {
      // La télémétrie ne modifie jamais une décision de sécurité.
    }
  }

  function workspaceAuthority(
    binding,
    { requireWrite = false } = {}
  ) {
    const workspaceId = clean(binding?.workspaceId, 200);

    if (!workspaceId) {
      throw failure(
        "GOAL_DEV_RETRY_WORKSPACE_INVALID",
        "workspaceId Retry invalide."
      );
    }

    let context;
    try {
      context = workspaceEngine.context(workspaceId);
    } catch {
      throw failure(
        "GOAL_DEV_RETRY_WORKSPACE_UNAVAILABLE",
        "Workspace Retry indisponible."
      );
    }

    const profileScope =
      clean(context?.workspace?.profileScope, 160);

    const expectedProfileScope =
      clean(profileScopeProvider(), 160);

    if (
      !profileScope ||
      !expectedProfileScope ||
      profileScope !== expectedProfileScope
    ) {
      throw failure(
        "GOAL_DEV_RETRY_PROFILE_MISMATCH",
        "Le profil du workspace ne correspond plus au Retry approuvé."
      );
    }

    const linkedProjects =
      Array.isArray(context?.projects)
        ? context.projects
        : [];

    let projectId =
      clean(binding?.projectId, 200) || null;

    if (projectId) {
      if (
        !linkedProjects.some(
          (project) => String(project?.id) === projectId
        )
      ) {
        throw failure(
          "GOAL_DEV_RETRY_PROJECT_MISMATCH",
          "Le projet Retry n'est plus lié au workspace."
        );
      }
    } else {
      if (linkedProjects.length !== 1) {
        throw failure(
          "GOAL_DEV_RETRY_PROJECT_UNRESOLVED",
          "Le projet Retry ne peut pas être résolu sans ambiguïté."
        );
      }

      projectId =
        clean(linkedProjects[0]?.id, 200);

      if (!projectId) {
        throw failure(
          "GOAL_DEV_RETRY_PROJECT_UNRESOLVED",
          "Projet Retry invalide."
        );
      }
    }

    const registeredProjects = projectProvider();

    if (!Array.isArray(registeredProjects)) {
      throw failure(
        "GOAL_DEV_RETRY_PROJECT_UNAVAILABLE",
        "Registre projet autoritatif indisponible."
      );
    }

    const project =
      registeredProjects.find(
        (candidate) => String(candidate?.id) === projectId
      );

    if (!project) {
      throw failure(
        "GOAL_DEV_RETRY_PROJECT_UNAVAILABLE",
        "Projet Retry absent du registre autoritatif."
      );
    }

    const repositoryRoot =
      canonicalPath(project.rootPath, "repositoryRoot");

    const rootsSource =
      context.relevantRoots ||
      context.roots ||
      [];

    const workspaceRoots =
      rootsSource
        .filter(
          (root) =>
            !requireWrite ||
            root?.mode === "read-write"
        )
        .map((root) => {
          try {
            return canonicalPath(root?.path, "workspaceRoot");
          } catch {
            return null;
          }
        })
        .filter(Boolean);

    if (
      requireWrite &&
      !workspaceRoots.some(
        (root) => isInside(root, repositoryRoot)
      )
    ) {
      throw failure(
        "GOAL_DEV_RETRY_WRITE_PERMISSION_REQUIRED",
        "Le repository Retry n'est plus couvert par un root read-write autorisé."
      );
    }

    return Object.freeze({
      workspaceId,
      projectId,
      profileScope,
      repositoryRoot,
    });
  }

  async function resolvePermission({ binding } = {}) {
    try {
      workspaceAuthority(
        binding,
        { requireWrite: true }
      );

      return Object.freeze({
        allowed: true,
        code: "AUTHORIZED_GOAL_DEV_RETRY",
      });
    } catch (error) {
      return Object.freeze({
        allowed: false,
        code:
          clean(error?.code, 160) ||
          "GOAL_DEV_RETRY_PERMISSION_DENIED",
      });
    }
  }

  function securityActionRequest({
    binding,
    chain,
  }) {
    const authority =
      workspaceAuthority(
        binding,
        { requireWrite: false }
      );

    return operationalSecurityPolicy.createActionRequest(
      {
        origin: "explicit_user_chat",
        actor: "user",
        skillId: SKILL_NAME,
        operation: OPERATION,
        args: binding,
        workspaceId: authority.workspaceId,
        projectId: authority.projectId,
        profileScope: authority.profileScope,
        sourceProfileScope: authority.profileScope,
        explicitOrder: true,
        localOnly:
          chain?.executionTemplate?.request?.localOnly === true,
        reversibility: "UNKNOWN",

        preconditions: {
          chainId: binding.chainId,
          chainRevision: binding.chainRevision,
          executionTemplateFingerprint:
            binding.executionTemplateFingerprint,
          parentTaskId: binding.parentTaskId,
        },

        preconditionsValid: true,
      },
      RETRY_SKILL_POLICY
    );
  }

  const permitService =
    createGoalDevRetryPermitService({
      chainStore,
      securityPolicy: operationalSecurityPolicy,
      interventionPermissionEngine,
      approvalEngine,
      permissionResolver: resolvePermission,
      profileScopeProvider,
      now,
    });

  const approvedRetryService =
    createGoalDevApprovedRetryService({
      chainStore,
      approvalEngine,

      /*
       * Le serveur injecte ici le pipeline Goal DEV évalué existant.
       * Il garde l'unique passage Native DEV de 4.5C/4.5D.
       */
      goalDevExecutionService,

      executionContextResolver:
        async ({ binding }) => {
          const authority =
            workspaceAuthority(
              binding,
              { requireWrite: true }
            );

          return Object.freeze({
            repositoryRoot: authority.repositoryRoot,
          });
        },

      permissionRecheck:
        async ({ binding }) =>
          (
            await resolvePermission({ binding })
          ).allowed === true,

      securityRecheck:
        async ({ binding, current }) => {
          try {
            const actionRequest =
              securityActionRequest({
                binding,
                chain: current?.chain,
              });

            const securityDecision =
              operationalSecurityPolicy.evaluate({
                actionRequest,

                /*
                 * La permission write est revalidée
                 * séparément par permissionRecheck
                 * juste avant execute().
                 */
                currentPermissions: {
                  allowed: true,
                  code:
                    "GOAL_DEV_RETRY_SECURITY_RECHECK",
                },

                skillPolicy:
                  RETRY_SKILL_POLICY,
              });

            return ![
              "DENY",
              "UNAVAILABLE",
            ].includes(
              securityDecision?.outcome
            );
          } catch {
            return false;
          }
        },

      now,
    });

  emit(
    "runtime_ready",
    {
      persistence:
        chainStore.persistenceCapabilities(),
    }
  );

  return Object.freeze({
    version: VERSION,
    chainStore,
    permitService,
    approvedRetryService,

    persistenceCapabilities:
      () =>
        chainStore.persistenceCapabilities(),
  });
}

module.exports = {
  VERSION,
  createGoalDevRetryRuntime,
};
