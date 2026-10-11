"use strict";

const {
  attachAgentEvaluation,
} = require(
  "../evaluation/agent-evaluation-runtime"
);

const {
  deriveGoalDevContinuation,
} = require(
  "./goal-dev-continuation-policy"
);

function failure(
  code,
  message
) {
  return Object.assign(
    new Error(message),
    { code }
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

function createGoalDevEvaluatedExecutionService({
  goalExecutionService,
  evaluationEngineProvider,
  evaluationAttacher =
    attachAgentEvaluation,
  continuationPolicy =
    deriveGoalDevContinuation,
  observability = null,
} = {}) {
  if (
    typeof goalExecutionService
      ?.run !==
    "function"
  ) {
    throw new TypeError(
      "GoalDevExecutionService valide requis."
    );
  }

  if (
    typeof evaluationEngineProvider !==
      "function"
  ) {
    throw new TypeError(
      "EvaluationEngineProvider requis."
    );
  }

  if (
    typeof evaluationAttacher !==
      "function"
  ) {
    throw new TypeError(
      "AgentEvaluationAttacher valide requis."
    );
  }

  if (
    typeof continuationPolicy !==
      "function"
  ) {
    throw new TypeError(
      "GoalDevContinuationPolicy valide requise."
    );
  }

  function emit(
    event,
    metadata
  ) {
    try {
      observability?.(
        event,
        metadata
      );
    } catch {}
  }

  async function run(
    input = {}
  ) {
    /*
     * 4.5C reste l'unique endroit
     * qui déclenche Native DEV.
     */
    const baseResult =
      await goalExecutionService
        .run(input);

    const engine =
      evaluationEngineProvider();

    if (
      !engine ||
      typeof engine.evaluate !==
        "function"
    ) {
      throw failure(
        "GOAL_DEV_EVALUATION_UNAVAILABLE",
        "AgentEvaluationEngine indisponible."
      );
    }

    /*
     * Evaluation locale et déterministe
     * du résultat déjà produit.
     *
     * Aucun second runTask ici.
     */
    const evaluatedDevResult =
      evaluationAttacher(
        baseResult.devResult,
        {
          engine,

          observability:
            (
              event,
              metadata
            ) =>
              emit(
                `agent_evaluation_${event}`,
                metadata
              ),
        }
      );

    const evaluation =
      evaluatedDevResult
        ?.metadata
        ?.agentEvaluation;

    if (!evaluation) {
      throw failure(
        "GOAL_DEV_EVALUATION_UNAVAILABLE",
        "Le résultat DEV n'a pas pu être évalué."
      );
    }

    const continuation =
      continuationPolicy({
        devResult:
          evaluatedDevResult,
        evaluation,
      });

    emit(
      "goal_dev_evaluated",
      {
        goalId:
          baseResult
            ?.goalRef
            ?.goalId ||
          null,

        taskId:
          evaluatedDevResult
            ?.taskId ||
          null,

        evaluationVerdict:
          evaluation.verdict,

        continuationState:
          continuation.state,

        retryAuthorized:
          continuation
            .retryAuthorized,
      }
    );

    return deepFreeze({
      ...baseResult,

      version:
        "goal-dev-execution-result-v2",

      devResult:
        evaluatedDevResult,

      continuation,
    });
  }

  return Object.freeze({
    run,
  });
}

module.exports = {
  createGoalDevEvaluatedExecutionService,
};
