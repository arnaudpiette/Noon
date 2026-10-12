"use strict";

const {
  appendGoalDevRetryCandidate,
  assessGoalDevRetry,
  createGoalDevRetryChain,
  markGoalDevRetryExecutionUncertain,
  projectGoalDevRetryCandidate,
  recordGoalDevRetryAttempt,
} = require(
  "./goal-dev-retry-chain"
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

function createGoalDevRetryChainStore({
  repository,
  now =
    () =>
      new Date().toISOString(),
  idFactory,
} = {}) {
  if (
    typeof repository
      ?.latest !==
      "function" ||
    typeof repository
      ?.save !==
      "function"
  ) {
    throw new TypeError(
      "GoalDevRetryChainRepository valide requis."
    );
  }

  function required(
    chainId
  ) {
    const record =
      repository.latest(
        chainId
      );

    if (!record) {
      throw failure(
        "GOAL_DEV_RETRY_CHAIN_NOT_FOUND",
        "Retry Chain introuvable."
      );
    }

    return record;
  }

  function create(
    input = {}
  ) {
    const chain =
      createGoalDevRetryChain({
        ...input,

        createdAt:
          input.createdAt ||
          now(),

        ...(idFactory
          ? { idFactory }
          : {}),
      });

    return repository.save(
      chain,
      {
        expectedRevision: 0,
      }
    );
  }

  function get(
    chainId
  ) {
    return required(
      chainId
    );
  }

  function history(
    chainId
  ) {
    required(chainId);

    return repository
      .history(chainId);
  }

  function recordAttempt(
    chainId,
    input = {}
  ) {
    const current =
      required(chainId);

    const next =
      recordGoalDevRetryAttempt(
        current.chain,
        {
          ...input,

          recordedAt:
            input.recordedAt ||
            now(),
        }
      );

    return repository.save(
      next,
      {
        expectedRevision:
          current.revision,
      }
    );
  }

  function markExecutionUncertain(
    chainId,
    input = {}
  ) {
    const expectedRevision =
      input.expectedRevision;

    if (
      !Number.isSafeInteger(
        expectedRevision
      ) ||
      expectedRevision < 1 ||
      expectedRevision >=
        Number.MAX_SAFE_INTEGER
    ) {
      throw failure(
        "GOAL_DEV_RETRY_PERSISTENCE_REVISION_REQUIRED",
        "expectedRevision valide requis."
      );
    }

    const current =
      required(chainId);

    if (
      current.revision !==
      expectedRevision
    ) {
      throw failure(
        "GOAL_DEV_RETRY_PERSISTENCE_CONFLICT",
        "Retry Chain modifiée concurremment."
      );
    }

    const next =
      markGoalDevRetryExecutionUncertain(
        current.chain,
        {
          taskId:
            input.taskId,

          attemptIndex:
            input.attemptIndex,

          uncertainAt:
            input.uncertainAt ||
            now(),
        }
      );

    /*
     * Aucun retry automatique sur conflit.
     * La révision approuvée est transmise
     * inchangée au repository canonique.
     */
    return repository.save(
      next,
      {
        expectedRevision,
      }
    );
  }

  function assess(
    chainId,
    input = {}
  ) {
    const current =
      required(chainId);

    return assessGoalDevRetry(
      current.chain,
      {
        ...input,

        now:
          input.now ||
          now(),
      }
    );
  }

  function projectCandidate(
    chainId,
    input = {}
  ) {
    const current =
      required(chainId);

    return projectGoalDevRetryCandidate(
      current.chain,
      {
        ...input,

        now:
          input.now ||
          now(),

        ...(idFactory &&
        !input.idFactory
          ? { idFactory }
          : {}),
      }
    );
  }

  function appendCandidate(
    chainId,
    candidate,
    input = {}
  ) {
    const expectedRevision =
      input.expectedRevision;

    if (
      !Number.isSafeInteger(
        expectedRevision
      ) ||
      expectedRevision < 1 ||
      expectedRevision >=
        Number.MAX_SAFE_INTEGER
    ) {
      throw failure(
        "GOAL_DEV_RETRY_PERSISTENCE_REVISION_REQUIRED",
        "expectedRevision valide requis."
      );
    }

    const current =
      required(chainId);

    if (
      current.revision !==
      expectedRevision
    ) {
      throw failure(
        "GOAL_DEV_RETRY_PERSISTENCE_CONFLICT",
        "Retry Chain modifiée concurremment."
      );
    }

    const observedAt =
      now();

    const updatedAt =
      input.updatedAt ||
      observedAt;

    const assessment =
      assessGoalDevRetry(
        current.chain,
        { now: observedAt }
      );

    if (!assessment.eligible) {
      throw failure(
        "GOAL_DEV_RETRY_NOT_ELIGIBLE",
        assessment.reasonCode
      );
    }

    const next =
      appendGoalDevRetryCandidate(
        current.chain,
        candidate,
        {
          updatedAt:
            updatedAt,
        }
      );

    return repository.save(
      next,
      {
        expectedRevision:
          expectedRevision,
      }
    );
  }

  return Object.freeze({
    appendCandidate,
    assess,
    create,
    get,
    history,
    markExecutionUncertain,
    projectCandidate,
    recordAttempt,
  });
}

module.exports = {
  createGoalDevRetryChainStore,
};
