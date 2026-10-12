"use strict";

const crypto =
  require("node:crypto");

const {
  assertGoalDevRetryExecutionTemplate,
} = require(
  "./goal-dev-retry-execution-template"
);

const VERSION =
  "goal-dev-retry-chain-v1";

const STATES =
  Object.freeze({
    OPEN: "OPEN",
    STOPPED: "STOPPED",
  });

const ATTEMPT_STATES =
  Object.freeze({
    PLANNED: "PLANNED",
    RECORDED: "RECORDED",
  });


const EXECUTION_BOUNDARY_STATES =
  Object.freeze({
    PREPARED: "PREPARED",
    MAY_HAVE_STARTED:
      "MAY_HAVE_STARTED",
  });

const CONTINUATIONS =
  new Set([
    "STOP",
    "REVIEW",
    "RETRY_CANDIDATE",
  ]);

const DEFAULTS =
  Object.freeze({
    maxRetries: 0,
  });

const HARD_LIMITS =
  Object.freeze({
    maxRetries: 9,
    maxDuration:
      24 * 60 * 60_000,
    maxEstimatedCost: 100,
  });

function fail(
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

function finite(
  value,
  {
    label,
    min = 0,
    max = Number.POSITIVE_INFINITY,
    required = false,
  }
) {
  if (
    value === undefined ||
    value === null
  ) {
    if (required) {
      fail(
        "GOAL_DEV_RETRY_LIMIT_REQUIRED",
        `${label} requis.`
      );
    }

    return null;
  }

  const parsed =
    Number(value);

  if (
    !Number.isFinite(parsed) ||
    parsed < min ||
    parsed > max
  ) {
    fail(
      "GOAL_DEV_RETRY_LIMIT_INVALID",
      `${label} invalide.`
    );
  }

  return parsed;
}

function integer(
  value,
  options
) {
  const parsed =
    finite(
      value,
      options
    );

  if (
    parsed !== null &&
    !Number.isInteger(parsed)
  ) {
    fail(
      "GOAL_DEV_RETRY_LIMIT_INVALID",
      `${options.label} doit être entier.`
    );
  }

  return parsed;
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

function clone(
  value
) {
  return structuredClone(value);
}

function timestamp(
  value
) {
  const parsed =
    Date.parse(value || "");

  if (
    !Number.isFinite(parsed)
  ) {
    fail(
      "GOAL_DEV_RETRY_TIME_INVALID",
      "Horodatage Retry Chain invalide."
    );
  }

  return new Date(
    parsed
  ).toISOString();
}

function normalizeGoalRef(
  value = {}
) {
  const goalId =
    clean(
      value.goalId
    );

  const workspaceId =
    clean(
      value.workspaceId
    );

  if (
    !goalId ||
    !workspaceId
  ) {
    fail(
      "GOAL_DEV_RETRY_REFERENCE_REQUIRED",
      "goalId et workspaceId requis."
    );
  }

  return {
    goalId,

    goalVersion:
      Math.max(
        1,
        Number(
          value.goalVersion ||
          value.version ||
          1
        ) || 1
      ),

    workspaceId,

    projectId:
      clean(
        value.projectId
      ) || null,
  };
}

function normalizeLimits(
  value = {}
) {
  const maxRetries =
    integer(
      value.maxRetries ??
        DEFAULTS.maxRetries,
      {
        label: "maxRetries",
        min: 0,
        max:
          HARD_LIMITS.maxRetries,
        required: true,
      }
    );

  /*
   * Un retry autonome ne pourra être
   * étudié que si durée ET coût ont
   * été explicitement bornés.
   */
  const maxDuration =
    finite(
      value.maxDuration,
      {
        label: "maxDuration",
        min: 1_000,
        max:
          HARD_LIMITS.maxDuration,
        required: true,
      }
    );

  const maxEstimatedCost =
    finite(
      value.maxEstimatedCost,
      {
        label:
          "maxEstimatedCost",
        min: 0,
        max:
          HARD_LIMITS
            .maxEstimatedCost,
        required: true,
      }
    );

  return {
    maxRetries,

    /*
     * tentative initiale incluse
     */
    maxAttempts:
      maxRetries + 1,

    maxDuration,
    maxEstimatedCost,
  };
}

function makeId(
  prefix,
  idFactory
) {
  const suffix =
    clean(
      idFactory()
    );

  if (!suffix) {
    fail(
      "GOAL_DEV_RETRY_ID_INVALID",
      "Générateur d'identifiant invalide."
    );
  }

  return `${prefix}_${suffix}`;
}

function createGoalDevRetryChain({
  chainId = null,
  goalRef,
  rootTaskId,
  executionTemplate,
  limits,
  createdAt =
    new Date().toISOString(),
  idFactory =
    () => crypto.randomUUID(),
} = {}) {
  const root =
    clean(rootTaskId);

  if (!root) {
    fail(
      "GOAL_DEV_RETRY_ROOT_TASK_REQUIRED",
      "rootTaskId requis."
    );
  }

  const normalizedGoal =
    normalizeGoalRef(
      goalRef
    );

  assertGoalDevRetryExecutionTemplate(
    executionTemplate
  );

  const normalizedTemplate =
    structuredClone(
      executionTemplate
    );

  const normalizedLimits =
    normalizeLimits(
      limits
    );

  const created =
    timestamp(
      createdAt
    );

  const id =
    chainId
      ? clean(chainId)
      : makeId(
          "goal_dev_chain",
          idFactory
        );

  if (!id) {
    fail(
      "GOAL_DEV_RETRY_CHAIN_ID_REQUIRED",
      "chainId requis."
    );
  }

  return deepFreeze({
    version: VERSION,

    chainId: id,

    goalRef:
      normalizedGoal,

    rootTaskId: root,

    executionTemplate:
      normalizedTemplate,

    state:
      STATES.OPEN,

    createdAt:
      created,

    updatedAt:
      created,

    limits:
      normalizedLimits,

    accounting: {
      attemptsRecorded: 0,
      retriesUsed: 0,

      accountedCost: 0,
      costKnown: true,
    },

    attempts: [
      {
        attemptIndex: 1,
        taskId: root,
        parentTaskId: null,
        state:
          ATTEMPT_STATES.PLANNED,

        executionBoundary:
          EXECUTION_BOUNDARY_STATES.PREPARED,

        executionUncertainAt: null,
        executionUncertaintyReasonCode: null,
        finalVerdict: null,
        failureCategory: null,
        continuationState:
          null,

        estimatedCost: null,
        actualCost: null,
        accountedCost: null,

        recordedAt: null,
      },
    ],

    authority: {
      retryAuthorized: false,
      executionAuthorized:
        false,
      approvalGranted: false,
      securityBypassed: false,
    },
  });
}

function conservativeCost({
  estimatedCost,
  actualCost,
}) {
  const estimated =
    finite(
      estimatedCost,
      {
        label: "estimatedCost",
        min: 0,
      }
    );

  const actual =
    finite(
      actualCost,
      {
        label: "actualCost",
        min: 0,
      }
    );

  if (
    actual !== null
  ) {
    return {
      estimatedCost:
        estimated,
      actualCost:
        actual,
      accountedCost:
        actual,
      costKnown: true,
      costSource:
        "ACTUAL",
    };
  }

  if (
    estimated !== null
  ) {
    return {
      estimatedCost:
        estimated,
      actualCost: null,
      accountedCost:
        estimated,
      costKnown: true,
      costSource:
        "ESTIMATED_CONSERVATIVE",
    };
  }

  return {
    estimatedCost: null,
    actualCost: null,
    accountedCost: null,
    costKnown: false,
    costSource: "UNKNOWN",
  };
}

function recordGoalDevRetryAttempt(
  chain,
  {
    taskId,
    finalVerdict,
    failureCategory = null,
    continuationState,
    estimatedCost = null,
    actualCost = null,
    recordedAt =
      new Date().toISOString(),
  } = {}
) {
  const next =
    clone(chain);

  if (
    next.version !== VERSION
  ) {
    fail(
      "GOAL_DEV_RETRY_CHAIN_VERSION_UNSUPPORTED",
      "Version Retry Chain non supportée."
    );
  }

  if (
    next.state !==
      STATES.OPEN
  ) {
    fail(
      "GOAL_DEV_RETRY_CHAIN_CLOSED",
      "Retry Chain fermée."
    );
  }

  const id =
    clean(taskId);

  const continuation =
    clean(
      continuationState,
      40
    ).toUpperCase();

  if (
    !CONTINUATIONS.has(
      continuation
    )
  ) {
    fail(
      "GOAL_DEV_RETRY_CONTINUATION_INVALID",
      "Continuation Goal invalide."
    );
  }

  const attempt =
    next.attempts.find(
      (item) =>
        item.taskId === id
    );

  if (!attempt) {
    fail(
      "GOAL_DEV_RETRY_ATTEMPT_NOT_FOUND",
      "Tentative Retry Chain introuvable."
    );
  }

  if (
    attempt.state !==
      ATTEMPT_STATES.PLANNED
  ) {
    fail(
      "GOAL_DEV_RETRY_ATTEMPT_ALREADY_RECORDED",
      "Cette tentative est déjà enregistrée."
    );
  }

  /*
   * Une seule tentative peut être
   * ouverte à la fois.
   */
  const latest =
    next.attempts[
      next.attempts.length - 1
    ];

  if (
    latest.taskId !== id
  ) {
    fail(
      "GOAL_DEV_RETRY_ATTEMPT_NOT_CURRENT",
      "Seule la tentative courante peut être enregistrée."
    );
  }

  const cost =
    conservativeCost({
      estimatedCost,
      actualCost,
    });

  attempt.state =
    ATTEMPT_STATES.RECORDED;

  attempt.finalVerdict =
    clean(
      finalVerdict,
      40
    ).toUpperCase() ||
    "UNKNOWN";

  attempt.failureCategory =
    clean(
      failureCategory,
      100
    ) || null;

  attempt.continuationState =
    continuation;

  attempt.estimatedCost =
    cost.estimatedCost;

  attempt.actualCost =
    cost.actualCost;

  attempt.accountedCost =
    cost.accountedCost;

  attempt.costSource =
    cost.costSource;

  attempt.recordedAt =
    timestamp(
      recordedAt
    );

  next.accounting
    .attemptsRecorded += 1;

  next.accounting
    .retriesUsed =
    Math.max(
      0,
      next.accounting
        .attemptsRecorded - 1
    );

  if (
    cost.costKnown
  ) {
    next.accounting
      .accountedCost +=
      cost.accountedCost;
  } else {
    next.accounting
      .costKnown = false;
  }

  if (
    continuation === "STOP"
  ) {
    next.state =
      STATES.STOPPED;
  }

  next.updatedAt =
    attempt.recordedAt;

  return deepFreeze(next);
}

function assessGoalDevRetry(
  chain,
  {
    now =
      new Date().toISOString(),
  } = {}
) {
  if (
    chain?.version !== VERSION
  ) {
    fail(
      "GOAL_DEV_RETRY_CHAIN_VERSION_UNSUPPORTED",
      "Version Retry Chain non supportée."
    );
  }

  const currentTime =
    Date.parse(
      timestamp(now)
    );

  const started =
    Date.parse(
      chain.createdAt
    );

  const elapsedMs =
    Math.max(
      0,
      currentTime - started
    );

  const last =
    chain.attempts[
      chain.attempts.length - 1
    ];

  const retriesRemaining =
    Math.max(
      0,
      chain.limits
        .maxRetries -
      chain.accounting
        .retriesUsed
    );

  const durationRemaining =
    Math.max(
      0,
      chain.limits
        .maxDuration -
      elapsedMs
    );

  const costRemaining =
    chain.accounting
      .costKnown
      ? Math.max(
          0,
          chain.limits
            .maxEstimatedCost -
          chain.accounting
            .accountedCost
        )
      : null;

  let eligible = true;
  let reasonCode =
    "GOAL_DEV_RETRY_ELIGIBLE";

  if (
    chain.state !==
      STATES.OPEN
  ) {
    eligible = false;
    reasonCode =
      "GOAL_DEV_RETRY_CHAIN_STOPPED";
  } else if (
    !last ||
    last.state !==
      ATTEMPT_STATES.RECORDED
  ) {
    eligible = false;
    reasonCode =
      "GOAL_DEV_RETRY_ATTEMPT_PENDING";
  } else if (
    last.continuationState !==
      "RETRY_CANDIDATE"
  ) {
    eligible = false;
    reasonCode =
      "GOAL_DEV_RETRY_NOT_CANDIDATE";
  } else if (
    retriesRemaining <= 0
  ) {
    eligible = false;
    reasonCode =
      "GOAL_DEV_RETRY_LIMIT_EXHAUSTED";
  } else if (
    durationRemaining <= 0
  ) {
    eligible = false;
    reasonCode =
      "GOAL_DEV_RETRY_DURATION_EXHAUSTED";
  } else if (
    !chain.accounting
      .costKnown
  ) {
    eligible = false;
    reasonCode =
      "GOAL_DEV_RETRY_COST_UNKNOWN";
  } else if (
    costRemaining <= 0
  ) {
    eligible = false;
    reasonCode =
      "GOAL_DEV_RETRY_COST_EXHAUSTED";
  }

  return deepFreeze({
    version:
      "goal-dev-retry-assessment-v1",

    chainId:
      chain.chainId,

    eligible,
    reasonCode,

    nextAttemptIndex:
      eligible
        ? chain.attempts.length + 1
        : null,

    remaining: {
      retries:
        retriesRemaining,
      durationMs:
        durationRemaining,
      estimatedCost:
        costRemaining,
    },

    /*
     * Assessment != autorisation.
     */
    retryAuthorized: false,
    executionAuthorized:
      false,
  });
}

function projectGoalDevRetryCandidate(
  chain,
  {
    now =
      new Date().toISOString(),
    taskId = null,
    idFactory =
      () => crypto.randomUUID(),
  } = {}
) {
  const assessment =
    assessGoalDevRetry(
      chain,
      { now }
    );

  if (
    !assessment.eligible
  ) {
    fail(
      "GOAL_DEV_RETRY_NOT_ELIGIBLE",
      assessment.reasonCode
    );
  }

  const previous =
    chain.attempts[
      chain.attempts.length - 1
    ];

  const nextTaskId =
    taskId
      ? clean(taskId)
      : makeId(
          "goal_dev_task",
          idFactory
        );

  if (
    chain.attempts.some(
      (item) =>
        item.taskId ===
        nextTaskId
    )
  ) {
    fail(
      "GOAL_DEV_RETRY_TASK_ID_REUSED",
      "Chaque tentative doit posséder un taskId distinct."
    );
  }

  return deepFreeze({
    version:
      "goal-dev-retry-candidate-v1",

    chainId:
      chain.chainId,

    rootTaskId:
      chain.rootTaskId,

    executionTemplateFingerprint:
      chain.executionTemplate
        .fingerprint,

    parentTaskId:
      previous.taskId,

    attemptIndex:
      assessment
        .nextAttemptIndex,

    taskId:
      nextTaskId,

    remaining:
      assessment.remaining,

    /*
     * Aucun effet, aucun permit,
     * aucune approbation.
     */
    candidateOnly: true,
    retryAuthorized: false,
    executionAuthorized:
      false,
    approvalGranted: false,
    securityBypassed: false,
  });
}

function markGoalDevRetryExecutionUncertain(
  chain,
  {
    taskId,
    attemptIndex,
    uncertainAt =
      new Date().toISOString(),
  } = {}
) {
  const next =
    clone(chain);

  if (
    next.state !==
    STATES.OPEN
  ) {
    fail(
      "GOAL_DEV_RETRY_CHAIN_CLOSED",
      "Retry Chain fermée."
    );
  }

  const normalizedTaskId =
    String(taskId || "")
      .trim();

  if (!normalizedTaskId) {
    fail(
      "GOAL_DEV_RETRY_TASK_ID_REQUIRED",
      "taskId retry requis."
    );
  }

  if (
    !Number.isSafeInteger(
      attemptIndex
    ) ||
    attemptIndex < 1
  ) {
    fail(
      "GOAL_DEV_RETRY_ATTEMPT_INDEX_INVALID",
      "attemptIndex retry invalide."
    );
  }

  const latest =
    next.attempts[
      next.attempts.length - 1
    ];

  if (
    !latest ||
    latest.taskId !==
      normalizedTaskId ||
    latest.attemptIndex !==
      attemptIndex
  ) {
    fail(
      "GOAL_DEV_RETRY_ATTEMPT_IDENTITY_MISMATCH",
      "Identité de tentative Retry divergente."
    );
  }

  if (
    latest.state !==
    ATTEMPT_STATES.PLANNED
  ) {
    fail(
      "GOAL_DEV_RETRY_ATTEMPT_NOT_PLANNED",
      "Seule une tentative PLANNED peut franchir la frontière d'exécution."
    );
  }

  if (
    latest.executionBoundary ===
    EXECUTION_BOUNDARY_STATES
      .MAY_HAVE_STARTED
  ) {
    fail(
      "GOAL_DEV_RETRY_EXECUTION_ALREADY_UNCERTAIN",
      "La tentative porte déjà une issue d'exécution incertaine."
    );
  }

  if (
    latest.executionBoundary != null &&
    latest.executionBoundary !==
      EXECUTION_BOUNDARY_STATES
        .PREPARED
  ) {
    fail(
      "GOAL_DEV_RETRY_EXECUTION_BOUNDARY_INVALID",
      "Frontière d'exécution Retry invalide."
    );
  }

  const at =
    timestamp(
      uncertainAt
    );

  latest.executionBoundary =
    EXECUTION_BOUNDARY_STATES
      .MAY_HAVE_STARTED;

  latest.executionUncertainAt =
    at;

  latest.executionUncertaintyReasonCode =
    "EXECUTION_MAY_HAVE_STARTED";

  /*
   * Aucun coût n'est inventé.
   *
   * null reste null.
   * L'accounting RECORDED reste inchangé.
   */
  next.updatedAt =
    at;

  return deepFreeze(next);
}

function appendGoalDevRetryCandidate(
  chain,
  candidate,
  {
    updatedAt =
      new Date().toISOString(),
  } = {}
) {
  const next =
    clone(chain);

  if (
    candidate?.chainId !==
      next.chainId ||
    candidate
      ?.executionTemplateFingerprint !==
      next.executionTemplate
        ?.fingerprint ||
    candidate?.candidateOnly !==
      true ||
    candidate?.retryAuthorized !==
      false ||
    candidate?.executionAuthorized !==
      false
  ) {
    fail(
      "GOAL_DEV_RETRY_CANDIDATE_INVALID",
      "Candidat retry invalide."
    );
  }

  if (
    next.attempts.some(
      (item) =>
        item.taskId ===
        candidate.taskId
    )
  ) {
    fail(
      "GOAL_DEV_RETRY_TASK_ID_REUSED",
      "taskId retry déjà utilisé."
    );
  }

  if (
    candidate.attemptIndex !==
      next.attempts.length + 1
  ) {
    fail(
      "GOAL_DEV_RETRY_ATTEMPT_SEQUENCE_INVALID",
      "Séquence de tentative invalide."
    );
  }

  next.attempts.push({
    attemptIndex:
      candidate.attemptIndex,

    taskId:
      candidate.taskId,

    parentTaskId:
      candidate.parentTaskId,

    state:
      ATTEMPT_STATES.PLANNED,

    executionBoundary:
      EXECUTION_BOUNDARY_STATES.PREPARED,

    executionUncertainAt: null,
    executionUncertaintyReasonCode: null,
    finalVerdict: null,
    failureCategory: null,
    continuationState: null,

    estimatedCost: null,
    actualCost: null,
    accountedCost: null,

    recordedAt: null,
  });

  next.updatedAt =
    timestamp(updatedAt);

  return deepFreeze(next);
}

module.exports = {
  ATTEMPT_STATES,
  EXECUTION_BOUNDARY_STATES,
  HARD_LIMITS,
  STATES,
  VERSION,
  appendGoalDevRetryCandidate,
  markGoalDevRetryExecutionUncertain,
  assessGoalDevRetry,
  createGoalDevRetryChain,
  projectGoalDevRetryCandidate,
  recordGoalDevRetryAttempt,
};
