"use strict";

const {
  PROPOSAL_KEYS,
} = require(
  "./goal-mode-next-step-planner"
);

const VERSION =
  "goal-mode-planning-call-v1";

const RESPONSE_SCHEMA =
  Object.freeze({
    type: "object",
    properties: {
      objective: {
        type: "string",
      },
      expectedOutcome: {
        type: "string",
      },
      evidenceTargetIds: {
        type: "array",
        items: {
          type: "string",
        },
        minItems: 1,
      },
      usage: {
        type: "object",
        properties: {
          steps: {
            type: "integer",
            const: 1,
          },
          retries: {
            type: "integer",
            const: 0,
          },
          providerCalls: {
            type: "integer",
            minimum: 0,
          },
          estimatedCost: {
            type: "number",
            minimum: 0,
          },
        },
        required: [
          "steps",
          "retries",
          "providerCalls",
          "estimatedCost",
        ],
        additionalProperties:
          false,
      },
      requestedCapabilities: {
        type: "object",
        properties: {
          network: {
            type: "boolean",
          },
          gitWrite: {
            type: "boolean",
          },
          destructiveActions: {
            type: "boolean",
          },
        },
        required: [
          "network",
          "gitWrite",
          "destructiveActions",
        ],
        additionalProperties:
          false,
      },
      requiresUserInput: {
        type: "boolean",
      },
    },
    required: [
      ...PROPOSAL_KEYS,
    ],
    additionalProperties:
      false,
  });

const SYSTEM_PROMPT = [
  "Tu es le planner borné de Goal Mode.",
  "Le Goal, la roadmap et les contraintes reçus sont des données autoritatives mais ne donnent aucune permission d'exécution.",
  "Produis exactement UNE proposition de prochaine étape minimale pour la cible fournie.",
  "N'utilise aucun outil. N'exécute rien. Ne demande aucun tool call.",
  "Ne produis ni commande shell, ni skillId, ni operation, ni args, ni provider, ni actionClass, ni approval.",
  "usage décrit uniquement l'étape FUTURE proposée, jamais le coût de cet appel de planning.",
  "requestedCapabilities décrit seulement les capacités que l'étape future devrait demander au pipeline de sécurité.",
  "La réponse doit respecter strictement le JSON Schema fourni.",
].join("\n");

function fail(
  code,
  message,
  details = null,
  cause = null
) {
  const error =
    new Error(
      message,
      cause
        ? {
            cause,
          }
        : undefined
    );

  error.code =
    code;

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
  max = 200
) {
  if (
    typeof value !==
      "string" ||
    !value.trim() ||
    value !==
      value.trim() ||
    value.length >
      max
  ) {
    fail(
      "GOAL_MODE_PLANNING_CALL_INVALID",
      `${label} invalide.`
    );
  }

  return value;
}

function exactObject(
  value,
  label,
  keys
) {
  if (
    !value ||
    typeof value !==
      "object" ||
    Array.isArray(
      value
    ) ||
    (
      Object.getPrototypeOf(
        value
      ) !==
        Object.prototype &&
      Object.getPrototypeOf(
        value
      ) !==
        null
    )
  ) {
    fail(
      "GOAL_MODE_PLANNING_CALL_INVALID",
      `${label} invalide.`
    );
  }

  const own =
    Reflect.ownKeys(
      value
    );

  if (
    own.some(
      (key) =>
        typeof key !==
          "string" ||
        !keys.includes(
          key
        )
    )
  ) {
    fail(
      "GOAL_MODE_PLANNING_CALL_INVALID",
      `${label} contient un champ non autorisé.`
    );
  }

  return value;
}

function finiteCost(
  value,
  label
) {
  if (
    typeof value !==
      "number" ||
    !Number.isFinite(
      value
    ) ||
    value < 0
  ) {
    fail(
      "GOAL_MODE_PLANNING_COST_UNAVAILABLE",
      `${label} indisponible.`
    );
  }

  return value;
}

function normalizeUsageEstimate(
  system,
  payload
) {
  const serialized =
    JSON.stringify(
      payload
    );

  return Object.freeze({
    inputTokens:
      Math.max(
        1,
        Math.ceil(
          (
            system.length +
            serialized.length
          ) / 4
        )
      ),

    outputTokens:
      1200,
  });
}

function privacyClassification(
  goal
) {
  if (
    goal.sensitivity ===
      "LOCAL_ONLY"
  ) {
    return "LOCAL_ONLY";
  }

  if (
    goal.sensitivity ===
      "PROTECTED"
  ) {
    return "HIGHLY_SENSITIVE";
  }

  return "PRIVATE";
}

function planningBinding(
  selection
) {
  return Object.freeze({
    runId:
      selection.runRef
        .runId,

    runRevision:
      selection.runRef
        .runRevision,

    goalId:
      selection.runRef
        .goalId,

    goalVersion:
      selection.runRef
        .goalVersion,

    targetKind:
      selection.target
        .kind,

    targetId:
      selection.target
        .targetId,

    targetFingerprint:
      selection
        .targetFingerprint,
  });
}

function assertSameTarget(
  initial,
  current
) {
  if (
    current?.decision !==
      "PLAN" ||
    current
      .targetFingerprint !==
      initial
        .targetFingerprint ||
    current.target?.kind !==
      initial.target?.kind ||
    current.target
      ?.targetId !==
      initial.target?.targetId
  ) {
    fail(
      "GOAL_MODE_PLANNING_TARGET_CHANGED",
      "La cible Goal Mode a changé pendant le planning."
    );
  }
}

function routeCost(
  route,
  estimateCost,
  provider,
  usage
) {
  if (
    route?.estimatedCost
      ?.status ===
      "available"
  ) {
    return finiteCost(
      route.estimatedCost
        .total,
      "route.estimatedCost"
    );
  }

  const estimate =
    estimateCost(
      provider,
      route.model,
      usage
    );

  if (
    estimate?.status !==
      "available"
  ) {
    fail(
      "GOAL_MODE_PLANNING_COST_UNAVAILABLE",
      "Impossible de réserver un coût de planning fiable."
    );
  }

  return finiteCost(
    estimate.total,
    "estimatedCost"
  );
}

function canonicalObservedUsage(
  response
) {
  const usage =
    response?.usage;

  if (
    !usage ||
    typeof usage !==
      "object" ||
    Array.isArray(usage) ||
    (
      Object.getPrototypeOf(
        usage
      ) !==
        Object.prototype &&
      Object.getPrototypeOf(
        usage
      ) !==
        null
    )
  ) {
    return null;
  }

  const keys = [
    "inputTokens",
    "cachedInputTokens",
    "outputTokens",
    "totalTokens",
  ];

  const own =
    Reflect.ownKeys(
      usage
    );

  if (
    own.length !==
      keys.length ||
    own.some(
      (key) =>
        typeof key !==
          "string" ||
        !keys.includes(
          key
        )
    )
  ) {
    return null;
  }

  for (
    const key of keys
  ) {
    if (
      !Number.isSafeInteger(
        usage[key]
      ) ||
      usage[key] < 0
    ) {
      return null;
    }
  }

  if (
    usage.cachedInputTokens >
      usage.inputTokens ||
    usage.totalTokens <
      usage.inputTokens +
        usage.outputTokens ||
    usage.totalTokens === 0
  ) {
    return null;
  }

  return usage;
}

function actualCost(
  response,
  route,
  estimateCost,
  provider
) {
  const usage =
    canonicalObservedUsage(
      response
    );

  if (!usage) {
    return null;
  }

  /*
   * Accounting against the provider/model
   * actually dispatched by this boundary.
   * Never trust response-provided routing
   * identity for cost attribution.
   */
  const estimate =
    estimateCost(
      provider,
      route.model,
      usage
    );

  if (
    estimate?.status !==
      "available"
  ) {
    return null;
  }

  const total =
    Number(
      estimate.total
    );

  return Number.isFinite(
    total
  ) &&
    total >= 0
    ? total
    : null;
}

function safeTrack(
  trackUsage,
  response
) {
  try {
    trackUsage?.(
      response
    );
  } catch {
    /*
     * Observability is not an
     * authority boundary.
     */
  }
}

function currentPlanningRecord(
  snapshot,
  reservationId
) {
  const records =
    snapshot?.state
      ?.planningReservations;

  if (
    !Array.isArray(
      records
    ) ||
    records.length === 0
  ) {
    fail(
      "GOAL_MODE_PLANNING_RESERVATION_MISSING",
      "Réservation de planning introuvable."
    );
  }

  const record =
    records.at(-1);

  if (
    record?.reservationId !==
      reservationId
  ) {
    fail(
      "GOAL_MODE_PLANNING_RESERVATION_MISMATCH",
      "La réservation active ne correspond plus à l'appel de planning."
    );
  }

  return record;
}

function createGoalModePlanningCallService({
  runStore,
  nextStepPlanner,
  goalStrategyEngine,
  selectModelRoute,
  estimateCost,
  authorizePrivacy,
  providerAdapter,
  trackUsage = null,
  now =
    () =>
      new Date(),
} = {}) {
  if (
    typeof runStore?.get !==
      "function" ||
    typeof runStore
      ?.reservePlanning !==
      "function" ||
    typeof runStore
      ?.markPlanningMayHaveStarted !==
      "function" ||
    typeof runStore
      ?.reconcilePlanning !==
      "function" ||
    typeof runStore
      ?.markPlanningUnknown !==
      "function" ||
    typeof nextStepPlanner
      ?.select !==
      "function" ||
    typeof nextStepPlanner
      ?.validate !==
      "function" ||
    typeof goalStrategyEngine
      ?.registry?.get !==
      "function" ||
    typeof selectModelRoute !==
      "function" ||
    typeof estimateCost !==
      "function" ||
    typeof authorizePrivacy !==
      "function" ||
    typeof providerAdapter
      ?.execute !==
      "function" ||
    typeof providerAdapter
      ?.provider !==
      "string" ||
    typeof now !==
      "function"
  ) {
    throw new TypeError(
      "Dépendances Goal Mode Planning Call requises."
    );
  }

  function goalFor(
    selection
  ) {
    const goal =
      goalStrategyEngine
        .registry
        .get(
          selection.runRef
            .goalId
        );

    if (
      !goal ||
      typeof goal !==
        "object" ||
      goal.goalId !==
        selection.runRef
          .goalId ||
      goal.version !==
        selection.runRef
          .goalVersion ||
      goal.status !==
        "ACTIVE"
    ) {
      fail(
        "GOAL_MODE_PLANNING_GOAL_STALE",
        "Goal autoritatif indisponible ou modifié."
      );
    }

    return goal;
  }

  function contextPayload({
    snapshot,
    selection,
    goal,
  }) {
    const constraints =
      Array.isArray(
        goal.constraints
      )
        ? goal.constraints.map(
            (constraint) => ({
              constraintId:
                constraint
                  .constraintId,
              description:
                constraint
                  .description,
              strength:
                constraint.strength,
            })
          )
        : [];

    return Object.freeze({
      run: {
        runId:
          snapshot.state
            .runId,
        goalId:
          goal.goalId,
        goalVersion:
          goal.version,
        scope:
          snapshot.state
            .contract.scope,
        localOnly:
          snapshot.state
            .contract.localOnly,
      },

      goal: {
        title:
          goal.title,
        outcomeDefinition:
          goal.outcomeDefinition,
        constraints,
      },

      target:
        selection.target,

      capabilityCeilings:
        snapshot.state
          .contract
          .capabilityCeilings,

      globalBudget: {
        limits:
          snapshot.state
            .contract.limits,
        usage:
          snapshot.state
            .usage,
      },
    });
  }

  function markUnknownBestEffort({
    runId,
    reservationId,
    reasonCode,
    observedProviderCalls =
      null,
    observedCost =
      null,
  }) {
    try {
      const current =
        runStore.get(
          runId
        );

      const record =
        currentPlanningRecord(
          current,
          reservationId
        );

      if (
        ![
          "PREPARED",
          "MAY_HAVE_STARTED",
        ].includes(
          record.status
        )
      ) {
        return current;
      }

      return runStore
        .markPlanningUnknown(
          runId,
          {
            expectedRevision:
              current.revision,
            reservationId,
            observedProviderCalls,
            observedCost,
            reasonCode,
          }
        );
    } catch {
      /*
       * PREPARED/MAY_HAVE_STARTED
       * already remains blocking if
       * recovery persistence itself
       * is uncertain.
       */
      return null;
    }
  }

  async function planOnce(
    input = {}
  ) {
    const source =
      exactObject(
        input,
        "planOnce",
        [
          "runId",
          "signal",
        ]
      );

    const runId =
      requiredString(
        source.runId,
        "runId"
      );

    const initialSelection =
      nextStepPlanner
        .select({
          runId,
        });

    if (
      initialSelection
        .decision !==
      "PLAN"
    ) {
      return Object.freeze({
        version:
          VERSION,
        status:
          initialSelection
            .decision,
        selection:
          initialSelection,
        proposal:
          null,
        providerCall:
          null,
        authority:
          Object.freeze({
            executionAuthorized:
              false,
            capabilitiesGranted:
              false,
          }),
      });
    }

    const initialSnapshot =
      runStore.get(
        runId
      );

    if (
      initialSnapshot
        .revision !==
      initialSelection
        .runRef
        .runRevision
    ) {
      fail(
        "GOAL_MODE_PLANNING_SELECTION_STALE",
        "Le Goal Run a changé avant la réservation."
      );
    }

    const goal =
      goalFor(
        initialSelection
      );

    if (
      initialSnapshot
        .state
        .contract
        .localOnly ===
        true
    ) {
      fail(
        "GOAL_MODE_PLANNING_LOCAL_ONLY",
        "Goal Mode local_only interdit l'appel distant de planning."
      );
    }

    const payload =
      contextPayload({
        snapshot:
          initialSnapshot,
        selection:
          initialSelection,
        goal,
      });

    const estimatedUsage =
      normalizeUsageEstimate(
        SYSTEM_PROMPT,
        payload
      );

    const remainingCost =
      Math.max(
        0,
        initialSnapshot
          .state
          .contract
          .limits
          .maxEstimatedCost -
        initialSnapshot
          .state
          .usage
          .estimatedCost
      );

    const route =
      selectModelRoute({
        question:
          `${goal.outcomeDefinition}\n${initialSelection.target.title}`,
        taskDomain:
          "GOAL_PLANNING",
        requiredQuality:
          "NORMAL",
        maxEstimatedCost:
          remainingCost,
        estimatedUsage,
        requiredCapabilities: [
          "STRUCTURED_OUTPUT",
        ],
        eligibleProviders: [
          providerAdapter
            .provider,
        ],
        workspaceId:
          initialSnapshot
            .state
            .contract
            .scope
            .workspaceId,
      });

    if (
      !route ||
      typeof route !==
        "object" ||
      typeof route.model !==
        "string" ||
      !route.model
    ) {
      fail(
        "GOAL_MODE_PLANNING_ROUTE_INVALID",
        "Route modèle Goal Mode invalide."
      );
    }

    const provider =
      route.provider ||
      providerAdapter
        .provider;

    if (
      provider !==
      providerAdapter
        .provider
    ) {
      fail(
        "GOAL_MODE_PLANNING_PROVIDER_MISMATCH",
        "Le provider routé n'est pas celui de l'adapter borné."
      );
    }

    const reservedCost =
      routeCost(
        route,
        estimateCost,
        provider,
        estimatedUsage
      );

    const classification =
      privacyClassification(
        goal
      );

    const privacyDecisionToken =
      authorizePrivacy(
        [
          {
            source:
              "goal_mode_planning",
            classification,
            localOnly:
              classification ===
                "LOCAL_ONLY",
            content:
              payload,
          },
        ],
        {
          localOnly:
            initialSnapshot
              .state
              .contract
              .localOnly ===
              true,
        }
      );

    const reserved =
      runStore
        .reservePlanning(
          runId,
          {
            expectedRevision:
              initialSelection
                .runRef
                .runRevision,
            binding:
              planningBinding(
                initialSelection
              ),
            reservedProviderCalls:
              1,
            reservedCost,
          }
        );

    const reservation =
      currentPlanningRecord(
        reserved,
        reserved.state
          .planningReservations
          .at(-1)
          .reservationId
      );

    /*
     * Recheck canonical Goal + target
     * immediately before crossing the
     * provider boundary.
     */
    const dispatchSelection =
      nextStepPlanner
        .select({
          runId,
        });

    try {
      assertSameTarget(
        initialSelection,
        dispatchSelection
      );
    } catch (error) {
      markUnknownBestEffort({
        runId,
        reservationId:
          reservation
            .reservationId,
        reasonCode:
          "CANCELLED",
      });

      throw error;
    }

    const started =
      runStore
        .markPlanningMayHaveStarted(
          runId,
          {
            expectedRevision:
              reserved.revision,
            reservationId:
              reservation
                .reservationId,
          }
        );

    let response;

    try {
      response =
        await providerAdapter
          .execute(
            {
              model:
                route.model,
              store:
                false,
              reasoning:
                route.effort
                  ? {
                      effort:
                        route.effort,
                    }
                  : undefined,
              text: {
                verbosity:
                  route.verbosity ||
                  "low",
                format: {
                  type:
                    "json_schema",
                  name:
                    "goal_mode_next_step_proposal",
                  strict:
                    true,
                  schema:
                    RESPONSE_SCHEMA,
                },
              },
              input: [
                {
                  role:
                    "system",
                  content:
                    SYSTEM_PROMPT,
                },
                {
                  role:
                    "user",
                  content:
                    JSON.stringify(
                      payload
                    ),
                },
              ],
              routingMetadata: {
                taskDomain:
                  "GOAL_PLANNING",
                requiredQuality:
                  "NORMAL",
                maxEstimatedCost:
                  remainingCost,
              },
            },
            {
              signal:
                source.signal,
              privacyDecisionToken,
            }
          );
    } catch (error) {
      const reasonCode =
        error?.code ===
          "TIMEOUT"
          ? "TIMEOUT"
          : error?.name ===
              "AbortError"
            ? "CANCELLED"
            : "OUTCOME_UNCERTAIN";

      markUnknownBestEffort({
        runId,
        reservationId:
          reservation
            .reservationId,
        reasonCode,
      });

      fail(
        "GOAL_MODE_PLANNING_CALL_UNKNOWN",
        "L'issue de l'appel de planning est incertaine.",
        {
          reasonCode,
        },
        error
      );
    }

    safeTrack(
      trackUsage,
      response
    );

    const observedCost =
      actualCost(
        response,
        route,
        estimateCost,
        provider
      );

    if (
      observedCost ===
        null
    ) {
      markUnknownBestEffort({
        runId,
        reservationId:
          reservation
            .reservationId,
        reasonCode:
          "USAGE_INCOMPLETE",
        observedProviderCalls:
          1,
        observedCost:
          null,
      });

      fail(
        "GOAL_MODE_PLANNING_USAGE_UNKNOWN",
        "Le coût réel de l'appel de planning n'est pas déterminable."
      );
    }

    let reconciled;

    try {
      const latest =
        runStore.get(
          runId
        );

      currentPlanningRecord(
        latest,
        reservation
          .reservationId
      );

      reconciled =
        runStore
          .reconcilePlanning(
            runId,
            {
              expectedRevision:
                latest.revision,
              reservationId:
                reservation
                  .reservationId,
              observedProviderCalls:
                1,
              observedCost,
              observationComplete:
                true,
            }
          );
    } catch (error) {
      markUnknownBestEffort({
        runId,
        reservationId:
          reservation
            .reservationId,
        reasonCode:
          "PERSISTENCE_UNCERTAIN",
        observedProviderCalls:
          1,
        observedCost,
      });

      fail(
        "GOAL_MODE_PLANNING_PERSISTENCE_UNCERTAIN",
        "Impossible de confirmer atomiquement l'accounting du planning.",
        null,
        error
      );
    }

    const reconciledRecord =
      currentPlanningRecord(
        reconciled,
        reservation
          .reservationId
      );

    if (
      response?.provider !==
        provider
    ) {
      fail(
        "GOAL_MODE_PLANNING_RESPONSE_INVALID",
        "Le provider observé ne correspond pas au provider dispatché."
      );
    }

    if (
      reconciledRecord
        .observedProviderCalls >
        reconciledRecord
          .reservedProviderCalls ||
      reconciledRecord
        .observedCost >
        reconciledRecord
          .reservedCost
    ) {
      fail(
        "GOAL_MODE_PLANNING_RESERVATION_EXCEEDED",
        "L'usage réel du planning dépasse sa réservation."
      );
    }

    if (
      Array.isArray(
        response?.toolCalls
      ) &&
      response
        .toolCalls
        .length > 0
    ) {
      fail(
        "GOAL_MODE_PLANNING_RESPONSE_INVALID",
        "Un appel de planning sans outil a retourné un tool call."
      );
    }

    if (
      typeof response?.text !==
      "string"
    ) {
      fail(
        "GOAL_MODE_PLANNING_RESPONSE_INVALID",
        "Réponse structurée du planner absente."
      );
    }

    let candidate;

    try {
      candidate =
        JSON.parse(
          response.text
        );
    } catch (error) {
      fail(
        "GOAL_MODE_PLANNING_RESPONSE_INVALID",
        "JSON de planning invalide.",
        null,
        error
      );
    }

    const finalSelection =
      nextStepPlanner
        .select({
          runId,
        });

    assertSameTarget(
      initialSelection,
      finalSelection
    );

    const proposal =
      nextStepPlanner
        .validate({
          runId,
          selection:
            finalSelection,
          proposal:
            candidate,
        });

    return Object.freeze({
      version:
        VERSION,
      status:
        "PROPOSED",
      selection:
        finalSelection,
      proposal,
      providerCall:
        Object.freeze({
          reservationId:
            reservation
              .reservationId,
          provider:
            response.provider ||
            provider,
          model:
            response.model ||
            route.model,
          providerCalls:
            1,
          reservedCost,
          observedCost,
          usage:
            response.usage ||
            null,
        }),
      authority:
        Object.freeze({
          executionAuthorized:
            false,
          capabilitiesGranted:
            false,
          securityPipelineBypassed:
            false,
        }),
    });
  }

  return Object.freeze({
    planOnce,
  });
}

module.exports = {
  RESPONSE_SCHEMA,
  SYSTEM_PROMPT,
  VERSION,
  createGoalModePlanningCallService,
};
