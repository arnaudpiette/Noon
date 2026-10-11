"use strict";

const VERSION =
  "goal-dev-retry-permit-request-v1";

const SKILL_NAME =
  "goal.dev.retry";

const OPERATION =
  "execute_goal_dev_retry";

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
  max = 200
) {
  return String(
    value ?? ""
  )
    .replace(
      /[\0\r\n]+/g,
      " "
    )
    .trim()
    .slice(0, max);
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

function iso(
  value
) {
  const parsed =
    Date.parse(
      String(value || "")
    );

  if (
    !Number.isFinite(parsed)
  ) {
    failure(
      "GOAL_DEV_RETRY_PERMIT_TIME_INVALID",
      "Horodatage Retry Permit invalide."
    );
  }

  return new Date(
    parsed
  ).toISOString();
}

function assertDependencies({
  chainStore,
  securityPolicy,
  interventionPermissionEngine,
  approvalEngine,
  permissionResolver,
}) {
  if (
    typeof chainStore?.get !==
      "function" ||
    typeof chainStore?.assess !==
      "function" ||
    typeof chainStore
      ?.projectCandidate !==
      "function"
  ) {
    throw new TypeError(
      "Retry Chain Store valide requis."
    );
  }

  if (
    typeof securityPolicy
      ?.createActionRequest !==
      "function" ||
    typeof securityPolicy
      ?.evaluate !==
      "function"
  ) {
    throw new TypeError(
      "OperationalSecurityPolicy valide requise."
    );
  }

  if (
    typeof interventionPermissionEngine
      ?.evaluate !==
      "function"
  ) {
    throw new TypeError(
      "InterventionPermissionEngine valide requis."
    );
  }

  if (
    typeof approvalEngine
      ?.prepareAction !==
      "function"
  ) {
    throw new TypeError(
      "ApprovalEngine canonique valide requis."
    );
  }

  if (
    typeof permissionResolver !==
      "function"
  ) {
    throw new TypeError(
      "Permission resolver autoritatif requis."
    );
  }
}

function validateCurrentRecord(
  current,
  chainId
) {
  if (
    !current ||
    !Number.isInteger(
      current.revision
    ) ||
    current.revision < 1 ||
    !current.chain
  ) {
    failure(
      "GOAL_DEV_RETRY_PERMIT_CHAIN_INVALID",
      "Retry Chain canonique invalide."
    );
  }

  if (
    current.chain.chainId !==
      chainId
  ) {
    failure(
      "GOAL_DEV_RETRY_PERMIT_CHAIN_MISMATCH",
      "Retry Chain divergente."
    );
  }

  const fingerprint =
    clean(
      current.chain
        ?.executionTemplate
        ?.fingerprint,
      100
    );

  if (!fingerprint) {
    failure(
      "GOAL_DEV_RETRY_PERMIT_TEMPLATE_REQUIRED",
      "Retry Execution Template canonique requis."
    );
  }

  return fingerprint;
}

function createGoalDevRetryPermitService({
  chainStore,
  securityPolicy,
  interventionPermissionEngine,
  approvalEngine,
  permissionResolver,

  profileScopeProvider =
    () => "arnaud",

  now =
    () =>
      new Date().toISOString(),
} = {}) {
  assertDependencies({
    chainStore,
    securityPolicy,
    interventionPermissionEngine,
    approvalEngine,
    permissionResolver,
  });

  async function prepare({
    chainId,
  } = {}) {
    const normalizedChainId =
      clean(
        chainId,
        200
      );

    if (!normalizedChainId) {
      failure(
        "GOAL_DEV_RETRY_PERMIT_CHAIN_REQUIRED",
        "chainId requis."
      );
    }

    /*
     * Une seule lecture canonique sert de
     * snapshot de préparation.
     *
     * La revision sera revalidée juste avant
     * l'exécution dans une tranche future.
     */
    const current =
      chainStore.get(
        normalizedChainId
      );

    const templateFingerprint =
      validateCurrentRecord(
        current,
        normalizedChainId
      );

    const chain =
      current.chain;

    const preparedAt =
      iso(
        now()
      );

    /*
     * L'éligibilité vient exclusivement de
     * la Retry Chain persistée.
     */
    const assessment =
      chainStore.assess(
        normalizedChainId,
        {
          now:
            preparedAt,
        }
      );

    if (
      assessment?.eligible !==
      true
    ) {
      failure(
        "GOAL_DEV_RETRY_NOT_ELIGIBLE",
        clean(
          assessment?.reasonCode,
          160
        ) ||
          "Retry non éligible."
      );
    }

    /*
     * Le taskId de la prochaine tentative
     * est produit côté serveur/store.
     * prepare() n'accepte volontairement
     * aucun taskId fourni par l'appelant.
     */
    const candidate =
      chainStore.projectCandidate(
        normalizedChainId,
        {
          now:
            preparedAt,
        }
      );

    if (
      !candidate ||
      candidate.chainId !==
        normalizedChainId ||
      candidate
        .executionTemplateFingerprint !==
        templateFingerprint ||
      candidate.candidateOnly !==
        true ||
      candidate.retryAuthorized !==
        false ||
      candidate.executionAuthorized !==
        false
    ) {
      failure(
        "GOAL_DEV_RETRY_PERMIT_CANDIDATE_INVALID",
        "Retry Candidate canonique invalide."
      );
    }

    if (
      !Number.isInteger(
        candidate.attemptIndex
      ) ||
      candidate.attemptIndex < 2 ||
      !clean(
        candidate.taskId,
        200
      ) ||
      !clean(
        candidate.parentTaskId,
        200
      )
    ) {
      failure(
        "GOAL_DEV_RETRY_PERMIT_CANDIDATE_INVALID",
        "Identité Retry Candidate invalide."
      );
    }

    /*
     * Binding minimal :
     * aucune instruction projet,
     * aucun objectif brut,
     * aucun chemin brut,
     * aucune permission.
     *
     * Le fingerprint du template suffit à
     * lier le permit au contrat immuable.
     */
    const binding =
      deepFreeze({
        version:
          "goal-dev-retry-permit-binding-v1",

        chainId:
          normalizedChainId,

        chainRevision:
          current.revision,

        goalId:
          clean(
            chain.goalRef
              ?.goalId,
            200
          ),

        workspaceId:
          clean(
            chain.goalRef
              ?.workspaceId,
            200
          ),

        projectId:
          clean(
            chain.goalRef
              ?.projectId,
            200
          ) || null,

        rootTaskId:
          clean(
            chain.rootTaskId,
            200
          ),

        parentTaskId:
          clean(
            candidate.parentTaskId,
            200
          ),

        taskId:
          clean(
            candidate.taskId,
            200
          ),

        attemptIndex:
          candidate.attemptIndex,

        executionTemplateFingerprint:
          templateFingerprint,
      });

    if (
      !binding.goalId ||
      !binding.workspaceId ||
      !binding.rootTaskId
    ) {
      failure(
        "GOAL_DEV_RETRY_PERMIT_REFERENCE_INVALID",
        "Références Retry Permit incomplètes."
      );
    }

    const profileScope =
      clean(
        profileScopeProvider(),
        160
      );

    if (!profileScope) {
      failure(
        "GOAL_DEV_RETRY_PERMIT_PROFILE_REQUIRED",
        "Profil autoritatif requis."
      );
    }

    /*
     * L'action reste locale mais elle est
     * mutante et volontairement classée
     * avec réversibilité UNKNOWN.
     *
     * OperationalSecurityPolicy doit donc
     * exiger une approbation plutôt que
     * permettre une exécution implicite.
     */
    const skillPolicy = {
      level: "write",
      networkAccess: false,
      explicitOrderRequired: true,
    };

    const actionRequest =
      securityPolicy
        .createActionRequest(
          {
            origin:
              "explicit_user_chat",

            actor:
              "user",

            skillId:
              SKILL_NAME,

            operation:
              OPERATION,

            args:
              binding,

            workspaceId:
              binding.workspaceId,

            projectId:
              binding.projectId,

            profileScope,
            sourceProfileScope:
              profileScope,

            explicitOrder: true,

            localOnly:
              chain.executionTemplate
                ?.request
                ?.localOnly ===
              true,

            reversibility:
              "UNKNOWN",

            preconditions: {
              chainId:
                binding.chainId,

              chainRevision:
                binding.chainRevision,

              executionTemplateFingerprint:
                binding
                  .executionTemplateFingerprint,

              parentTaskId:
                binding.parentTaskId,
            },

            preconditionsValid:
              true,
          },
          skillPolicy
        );

    /*
     * Resolver injecté depuis le serveur :
     * le JSON client ne peut pas produire
     * lui-même cette décision.
     */
    const currentPermissions =
      await permissionResolver({
        chain,
        chainRevision:
          current.revision,
        candidate,
        binding,
        actionRequest,
      });

    if (
      currentPermissions
        ?.allowed !==
      true
    ) {
      failure(
        "GOAL_DEV_RETRY_PERMISSION_DENIED",
        clean(
          currentPermissions
            ?.code,
          160
        ) ||
          "Permission Retry refusée."
      );
    }

    const securityDecision =
      securityPolicy.evaluate({
        actionRequest,
        currentPermissions,
        skillPolicy,
      });

    if (
      securityDecision?.outcome ===
        "DENY"
    ) {
      failure(
        "GOAL_DEV_RETRY_SECURITY_DENIED",
        "OperationalSecurityPolicy refuse le retry."
      );
    }

    if (
      securityDecision?.outcome ===
        "UNAVAILABLE"
    ) {
      failure(
        "GOAL_DEV_RETRY_SECURITY_UNAVAILABLE",
        "OperationalSecurityPolicy indisponible."
      );
    }

    const interventionDecision =
      interventionPermissionEngine
        .evaluate({
          actionRequest,
          securityDecision,

          profileScope,

          workspaceId:
            binding.workspaceId,
        });

    /*
     * Fail closed :
     * pour 4.6F un retry DOIT passer par
     * ApprovalEngine.
     *
     * Même si une policy future répondait
     * PROCEED, ce service refuserait de
     * créer une autorité directe.
     */
    if (
      interventionDecision
        ?.decision !==
      "CONFIRM"
    ) {
      failure(
        "GOAL_DEV_RETRY_APPROVAL_REQUIRED",
        `Retry Permit refuse une décision ${clean(
          interventionDecision
            ?.decision,
          40
        ) || "UNKNOWN"}.`
      );
    }

    const approval =
      approvalEngine
        .prepareAction({
          executionId:
            `goal-retry:${binding.chainId}:${binding.attemptIndex}:${binding.taskId}`,

          skillName:
            SKILL_NAME,

          operation:
            OPERATION,

          normalizedArgs:
            binding,

          target:
            binding.taskId,

          permissionLevel:
            "write",

          title:
            "Nouvelle tentative DEV",

          sanitizedSummary:
            `Autoriser la tentative DEV ${binding.attemptIndex} pour le Goal ${binding.goalId}.`,

          riskLevel:
            "high",

          strengthened:
            true,

          preconditions: {
            chainId:
              binding.chainId,

            chainRevision:
              binding.chainRevision,

            executionTemplateFingerprint:
              binding
                .executionTemplateFingerprint,

            parentTaskId:
              binding.parentTaskId,
          },

          contextRef: {
            policyVersion:
              clean(
                securityDecision
                  ?.policyVersion,
                200
              ) || null,

            securityDecisionId:
              clean(
                securityDecision
                  ?.decisionId,
                200
              ) || null,

            interventionPolicyVersion:
              clean(
                interventionDecision
                  ?.policyVersion,
                200
              ) || null,

            interventionActionFingerprint:
              clean(
                interventionDecision
                  ?.actionFingerprint,
                200
              ) || null,
          },
        });

    if (
      !approval?.approvalId ||
      approval.status !==
        "pending" ||
      !approval.resumeToken
    ) {
      failure(
        "GOAL_DEV_RETRY_APPROVAL_CREATION_FAILED",
        "ApprovalEngine n'a pas créé une approbation exploitable."
      );
    }

    /*
     * PENDING_APPROVAL n'est PAS
     * une autorisation d'exécution.
     */
    return deepFreeze({
      version:
        VERSION,

      permitState:
        "PENDING_APPROVAL",

      preparedAt,

      binding,

      approval: {
        approvalId:
          approval.approvalId,

        executionId:
          approval.executionId,

        status:
          approval.status,

        expiresAt:
          approval.expiresAt,

        payloadHash:
          approval.payloadHash,

        resumeToken:
          approval.resumeToken,
      },

      security: {
        outcome:
          securityDecision
            .outcome,

        policyVersion:
          securityDecision
            .policyVersion ||
          null,

        interventionDecision:
          interventionDecision
            .decision,

        interventionActionFingerprint:
          interventionDecision
            .actionFingerprint ||
          null,
      },

      authority: {
        retryAuthorized:
          false,

        executionAuthorized:
          false,

        approvalGranted:
          false,

        securityBypassed:
          false,
      },
    });
  }

  return Object.freeze({
    prepare,
  });
}

module.exports = {
  OPERATION,
  SKILL_NAME,
  VERSION,
  createGoalDevRetryPermitService,
};
