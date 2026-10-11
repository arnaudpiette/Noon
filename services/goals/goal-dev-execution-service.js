"use strict";

const {
  projectGoalDevExecution,
} = require(
  "./goal-dev-execution-contract"
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

function createGoalDevExecutionService({
  goalStrategyEngine,
  nativeDevFacade,
  workspaceEngine,
  projectRuleResolver,
  budgetService = null,
  contractProjector =
    projectGoalDevExecution,
  observability = null,
} = {}) {
  if (
    typeof goalStrategyEngine
      ?.registry?.get !==
    "function"
  ) {
    throw new TypeError(
      "GoalStrategyEngine valide requis."
    );
  }

  if (
    typeof nativeDevFacade
      ?.runTask !==
    "function"
  ) {
    throw new TypeError(
      "NativeDevFacade valide requise."
    );
  }

  if (
    typeof workspaceEngine
      ?.context !==
    "function"
  ) {
    throw new TypeError(
      "WorkspaceEngine valide requis."
    );
  }

  if (
    typeof projectRuleResolver
      ?.resolve !==
    "function"
  ) {
    throw new TypeError(
      "DevProjectRuleResolver valide requis."
    );
  }

  if (
    typeof contractProjector !==
    "function"
  ) {
    throw new TypeError(
      "GoalDevExecutionContract valide requis."
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

  async function run({
    goalId,
    request,
  } = {}) {
    const id =
      String(goalId ?? "")
        .trim();

    if (!id) {
      throw failure(
        "GOAL_DEV_GOAL_ID_REQUIRED",
        "goalId requis."
      );
    }

    const goal =
      goalStrategyEngine
        .registry
        .get(id);

    const contract =
      contractProjector({
        goal,
        request:
          request || {},
        budgetService,
      });

    /*
     * Les règles projet ne sont jamais fournies
     * par Goal ni par le client.
     *
     * Elles sont résolues depuis le workspace
     * autoritatif exactement avant l'appel DEV.
     */
    const workspaceContext =
      workspaceEngine.context(
        contract
          .goalRef
          .workspaceId
      );

    const projects =
      Array.isArray(
        workspaceContext
          ?.projects
      )
        ? workspaceContext.projects
        : [];

    if (
      projects.length !== 1 ||
      !workspaceContext
        ?.workspace
        ?.profileScope
    ) {
      throw failure(
        "GOAL_DEV_PROJECT_UNRESOLVED",
        "Projet DEV non résolu ou ambigu."
      );
    }

    const project =
      projects[0];

    if (
      contract.goalRef
        .projectId &&
      String(project.id) !==
        String(
          contract
            .goalRef
            .projectId
        )
    ) {
      throw failure(
        "GOAL_DEV_PROJECT_MISMATCH",
        "Le projet du workspace ne correspond pas au Goal."
      );
    }

    const ruleProjection =
      projectRuleResolver
        .resolve({
          projectId:
            project.id,

          ownerProfileScope:
            workspaceContext
              .workspace
              .profileScope,

          taskRestrictions:
            contract
              .devInput
              .constraints,
        });

    const projectInstructions =
      Array.isArray(
        ruleProjection
          ?.applied
      )
        ? ruleProjection
            .applied
            .map(
              (rule) =>
                String(
                  rule?.text ||
                    ""
                )
                  .trim()
            )
            .filter(Boolean)
            .slice(0, 20)
        : [];

    emit(
      "goal_dev_execution_started",
      {
        goalId:
          contract.goalRef
            .goalId,
        goalVersion:
          contract.goalRef
            .version,
        taskId:
          contract.devInput
            .taskId,
        workspaceId:
          contract.goalRef
            .workspaceId,
        projectId:
          project.id,
      }
    );

    const devResult =
      await nativeDevFacade
        .runTask({
          ...contract.devInput,

          projectInstructions,
        });

    const result =
      deepFreeze({
        version:
          "goal-dev-execution-result-v1",

        goalRef:
          contract.goalRef,

        contractVersion:
          contract.version,

        taskId:
          devResult
            ?.taskId ||
          contract
            .devInput
            .taskId,

        devResult,

        /*
         * 4.5C :
         * - aucune poursuite autonome ;
         * - aucun RETRY automatique ;
         * - aucune Evaluation appliquée ;
         * - aucun changement d'état Goal.
         */
        continuation: {
          automatic: false,
          retryScheduled:
            false,
          evaluationApplied:
            false,
          goalStateMutated:
            false,
        },

        /*
         * Le service lance une demande explicite,
         * mais n'accorde lui-même aucune permission.
         * L'autorité reste dans la chaîne Native DEV.
         */
        authority: {
          goalGrantsExecution:
            false,
          securityPipelineBypassed:
            false,
        },
      });

    emit(
      "goal_dev_execution_completed",
      {
        goalId:
          contract.goalRef
            .goalId,
        taskId:
          result.taskId,
        finalVerdict:
          String(
            devResult
              ?.finalVerdict ||
              ""
          )
            .slice(0, 40) ||
          null,
      }
    );

    return result;
  }

  return Object.freeze({
    run,
  });
}

module.exports = {
  createGoalDevExecutionService,
};
