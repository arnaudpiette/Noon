"use strict";

const {
  assertGoalDevRetryExecutionTemplate,
} = require(
  "../../goals/goal-dev-retry-execution-template"
);

const {
  loadSqlite,
} = require(
  "../database"
);

const RECORD_TYPE =
  "GOAL_DEV_RETRY_CHAIN";

const CHAIN_VERSION =
  "goal-dev-retry-chain-v1";

const repositoryCapabilities =
  new WeakMap();

const UNKNOWN_CAPABILITIES =
  Object.freeze({
    backend: "UNKNOWN",
    atomicRevisionCas: false,
  });

const SQLITE_CAPABILITIES =
  Object.freeze({
    backend: "SQLITE",
    atomicRevisionCas: true,
  });

const JSON_CAPABILITIES =
  Object.freeze({
    backend: "JSON_FALLBACK",
    atomicRevisionCas: false,
  });

function describeGoalDevRetryChainRepository(
  repository
) {
  return repositoryCapabilities.get(
    repository
  ) || UNKNOWN_CAPABILITIES;
}

function failure(
  code,
  message
) {
  return Object.assign(
    new Error(message),
    { code }
  );
}

function clone(
  value
) {
  return value == null
    ? value
    : structuredClone(value);
}

function canonical(
  value
) {
  if (
    value === null ||
    value === undefined
  ) {
    return value ?? null;
  }

  if (
    Array.isArray(value)
  ) {
    return value.map(
      canonical
    );
  }

  if (
    typeof value ===
      "object"
  ) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(
          (key) => [
            key,
            canonical(
              value[key]
            ),
          ]
        )
    );
  }

  return value;
}

function same(
  left,
  right
) {
  return JSON.stringify(
    canonical(left)
  ) ===
    JSON.stringify(
      canonical(right)
    );
}

function validIso(
  value
) {
  return Number.isFinite(
    Date.parse(
      value || ""
    )
  );
}

function assertAuthority(
  chain
) {
  const authority =
    chain.authority || {};

  for (
    const key of [
      "retryAuthorized",
      "executionAuthorized",
      "approvalGranted",
      "securityBypassed",
    ]
  ) {
    if (
      authority[key] !==
      false
    ) {
      throw failure(
        "GOAL_DEV_RETRY_PERSISTENCE_AUTHORITY_INVALID",
        `Autorité Retry Chain interdite : ${key}.`
      );
    }
  }
}

function assertChain(
  chain
) {
  if (
    !chain ||
    typeof chain !==
      "object" ||
    Array.isArray(chain)
  ) {
    throw failure(
      "GOAL_DEV_RETRY_PERSISTENCE_INVALID",
      "Retry Chain invalide."
    );
  }

  if (
    chain.version !==
      CHAIN_VERSION
  ) {
    throw failure(
      "GOAL_DEV_RETRY_PERSISTENCE_VERSION_INVALID",
      "Version Retry Chain invalide."
    );
  }

  if (
    !String(
      chain.chainId || ""
    ).trim() ||
    !String(
      chain.rootTaskId || ""
    ).trim() ||
    !String(
      chain.goalRef
        ?.goalId || ""
    ).trim() ||
    !String(
      chain.goalRef
        ?.workspaceId || ""
    ).trim()
  ) {
    throw failure(
      "GOAL_DEV_RETRY_PERSISTENCE_REFERENCE_INVALID",
      "Identité Retry Chain incomplète."
    );
  }

  if (
    !["OPEN", "STOPPED"]
      .includes(
        chain.state
      )
  ) {
    throw failure(
      "GOAL_DEV_RETRY_PERSISTENCE_STATE_INVALID",
      "État Retry Chain invalide."
    );
  }

  if (
    !validIso(
      chain.createdAt
    ) ||
    !validIso(
      chain.updatedAt
    )
  ) {
    throw failure(
      "GOAL_DEV_RETRY_PERSISTENCE_TIME_INVALID",
      "Horodatage Retry Chain invalide."
    );
  }

  const limits =
    chain.limits || {};

  if (
    !Number.isInteger(
      limits.maxRetries
    ) ||
    limits.maxRetries < 0 ||
    !Number.isInteger(
      limits.maxAttempts
    ) ||
    limits.maxAttempts !==
      limits.maxRetries + 1 ||
    !Number.isFinite(
      Number(
        limits.maxDuration
      )
    ) ||
    Number(
      limits.maxDuration
    ) <= 0 ||
    !Number.isFinite(
      Number(
        limits.maxEstimatedCost
      )
    ) ||
    Number(
      limits.maxEstimatedCost
    ) < 0
  ) {
    throw failure(
      "GOAL_DEV_RETRY_PERSISTENCE_LIMIT_INVALID",
      "Limites Retry Chain invalides."
    );
  }

  if (
    !Array.isArray(
      chain.attempts
    ) ||
    chain.attempts.length < 1 ||
    chain.attempts.length >
      limits.maxAttempts
  ) {
    throw failure(
      "GOAL_DEV_RETRY_PERSISTENCE_ATTEMPTS_INVALID",
      "Tentatives Retry Chain invalides."
    );
  }

  const seen =
    new Set();

  let recordedCount = 0;
  let expectedKnown = true;
  let expectedCost = 0;

  for (
    let index = 0;
    index <
      chain.attempts.length;
    index += 1
  ) {
    const attempt =
      chain.attempts[index];

    const taskId =
      String(
        attempt?.taskId || ""
      ).trim();

    if (
      attempt?.attemptIndex !==
        index + 1 ||
      !taskId ||
      seen.has(taskId)
    ) {
      throw failure(
        "GOAL_DEV_RETRY_PERSISTENCE_ATTEMPT_IDENTITY_INVALID",
        "Identité de tentative Retry Chain invalide."
      );
    }

    seen.add(taskId);

    if (
      index === 0
    ) {
      if (
        attempt.parentTaskId !==
          null
      ) {
        throw failure(
          "GOAL_DEV_RETRY_PERSISTENCE_PARENT_INVALID",
          "La tentative racine ne peut avoir de parent."
        );
      }
    } else if (
      attempt.parentTaskId !==
        chain.attempts[
          index - 1
        ].taskId
    ) {
      throw failure(
        "GOAL_DEV_RETRY_PERSISTENCE_PARENT_INVALID",
        "Chaînage parentTaskId invalide."
      );
    }

    if (
      ![
        "PLANNED",
        "RECORDED",
      ].includes(
        attempt.state
      )
    ) {
      throw failure(
        "GOAL_DEV_RETRY_PERSISTENCE_ATTEMPT_STATE_INVALID",
        "État de tentative invalide."
      );
    }

    if (
      attempt.state ===
        "PLANNED" &&
      index !==
        chain.attempts.length -
          1
    ) {
      throw failure(
        "GOAL_DEV_RETRY_PERSISTENCE_PENDING_ORDER_INVALID",
        "Seule la dernière tentative peut rester PLANNED."
      );
    }

    if (
      attempt.state ===
        "RECORDED"
    ) {
      recordedCount += 1;

      if (
        !validIso(
          attempt.recordedAt
        )
      ) {
        throw failure(
          "GOAL_DEV_RETRY_PERSISTENCE_ATTEMPT_TIME_INVALID",
          "Tentative enregistrée sans horodatage valide."
        );
      }

      if (
        attempt.accountedCost ===
          null ||
        !Number.isFinite(
          Number(
            attempt.accountedCost
          )
        ) ||
        Number(
          attempt.accountedCost
        ) < 0
      ) {
        expectedKnown = false;
      } else {
        expectedCost +=
          Number(
            attempt.accountedCost
          );
      }
    }
  }

  const accounting =
    chain.accounting || {};

  if (
    accounting.attemptsRecorded !==
      recordedCount ||
    accounting.retriesUsed !==
      Math.max(
        0,
        recordedCount - 1
      )
  ) {
    throw failure(
      "GOAL_DEV_RETRY_PERSISTENCE_ACCOUNTING_INVALID",
      "Compteurs Retry Chain incohérents."
    );
  }

  if (
    accounting.costKnown !==
      expectedKnown
  ) {
    throw failure(
      "GOAL_DEV_RETRY_PERSISTENCE_COST_STATE_INVALID",
      "État du coût Retry Chain incohérent."
    );
  }

  if (
    !Number.isFinite(
      Number(
        accounting.accountedCost
      )
    ) ||
    Number(
      accounting.accountedCost
    ) < 0 ||
    Math.abs(
      Number(
        accounting.accountedCost
      ) -
      expectedCost
    ) > 1e-9
  ) {
    throw failure(
      "GOAL_DEV_RETRY_PERSISTENCE_COST_INVALID",
      "Coût cumulé Retry Chain incohérent."
    );
  }

  if (
    chain.state ===
      "STOPPED" &&
    chain.attempts[
      chain.attempts.length - 1
    ]?.continuationState !==
      "STOP"
  ) {
    throw failure(
      "GOAL_DEV_RETRY_PERSISTENCE_STOP_INVALID",
      "Une chaîne STOPPED doit provenir d'une continuation STOP."
    );
  }

  assertGoalDevRetryExecutionTemplate(
    chain.executionTemplate
  );

  assertAuthority(
    chain
  );

  return true;
}

function immutableProjection(
  chain
) {
  return {
    version:
      chain.version,

    chainId:
      chain.chainId,

    goalRef:
      chain.goalRef,

    rootTaskId:
      chain.rootTaskId,

    executionTemplate:
      chain.executionTemplate,

    createdAt:
      chain.createdAt,

    limits:
      chain.limits,

    authority:
      chain.authority,
  };
}

function assertForward(
  previous,
  next
) {
  if (
    !same(
      immutableProjection(
        previous
      ),
      immutableProjection(
        next
      )
    )
  ) {
    throw failure(
      "GOAL_DEV_RETRY_PERSISTENCE_IMMUTABLE_CHANGED",
      "Identité ou limites Retry Chain modifiées."
    );
  }

  if (
    Date.parse(
      next.updatedAt
    ) <
    Date.parse(
      previous.updatedAt
    )
  ) {
    throw failure(
      "GOAL_DEV_RETRY_PERSISTENCE_TIME_REWIND",
      "updatedAt ne peut reculer."
    );
  }

  if (
    previous.state ===
      "STOPPED" &&
    next.state !==
      "STOPPED"
  ) {
    throw failure(
      "GOAL_DEV_RETRY_PERSISTENCE_REOPEN_DENIED",
      "Une Retry Chain arrêtée ne peut être rouverte."
    );
  }

  if (
    next.attempts.length <
      previous.attempts.length ||
    next.attempts.length >
      previous.attempts.length +
        1
  ) {
    throw failure(
      "GOAL_DEV_RETRY_PERSISTENCE_REWIND",
      "Historique des tentatives invalide."
    );
  }

  for (
    let index = 0;
    index <
      previous.attempts.length;
    index += 1
  ) {
    const before =
      previous.attempts[index];

    const after =
      next.attempts[index];

    if (
      before.attemptIndex !==
        after.attemptIndex ||
      before.taskId !==
        after.taskId ||
      before.parentTaskId !==
        after.parentTaskId
    ) {
      throw failure(
        "GOAL_DEV_RETRY_PERSISTENCE_ATTEMPT_MUTATED",
        "Identité d'une tentative historique modifiée."
      );
    }

    if (
      before.state ===
        "RECORDED"
    ) {
      if (
        !same(
          before,
          after
        )
      ) {
        throw failure(
          "GOAL_DEV_RETRY_PERSISTENCE_HISTORY_MUTATED",
          "Une tentative enregistrée est immuable."
        );
      }

      continue;
    }

    if (
      before.state ===
        "PLANNED" &&
      ![
        "PLANNED",
        "RECORDED",
      ].includes(
        after.state
      )
    ) {
      throw failure(
        "GOAL_DEV_RETRY_PERSISTENCE_ATTEMPT_TRANSITION_INVALID",
        "Transition de tentative invalide."
      );
    }

    const allowedExecutionBoundaryTransition =
      before.state ===
        "PLANNED" &&
      after.state ===
        "PLANNED" &&
      before.executionBoundary ===
        "PREPARED" &&
      after.executionBoundary ===
        "MAY_HAVE_STARTED" &&
      before.executionUncertainAt == null &&
      typeof after.executionUncertainAt ===
        "string" &&
      before.executionUncertaintyReasonCode ==
        null &&
      after.executionUncertaintyReasonCode ===
        "EXECUTION_MAY_HAVE_STARTED" &&
      same(
        {
          ...before,
          executionBoundary:
            after.executionBoundary,
          executionUncertainAt:
            after.executionUncertainAt,
          executionUncertaintyReasonCode:
            after.executionUncertaintyReasonCode,
        },
        after
      );

    if (
      before.state ===
        "PLANNED" &&
      after.state ===
        "PLANNED" &&
      !same(
        before,
        after
      ) &&
      !allowedExecutionBoundaryTransition
    ) {
      throw failure(
        "GOAL_DEV_RETRY_PERSISTENCE_PLANNED_MUTATED",
        "Une tentative PLANNED ne peut être réécrite."
      );
    }
  }

  if (
    next.attempts.length ===
      previous.attempts.length +
        1
  ) {
    const previousLast =
      next.attempts[
        previous.attempts.length -
          1
      ];

    const appended =
      next.attempts[
        next.attempts.length - 1
      ];

    if (
      previousLast.state !==
        "RECORDED" ||
      appended.state !==
        "PLANNED" ||
      appended.parentTaskId !==
        previousLast.taskId
    ) {
      throw failure(
        "GOAL_DEV_RETRY_PERSISTENCE_APPEND_INVALID",
        "Nouvelle tentative Retry Chain invalide."
      );
    }
  }

  if (
    next.accounting
      .attemptsRecorded <
      previous.accounting
        .attemptsRecorded ||
    next.accounting
      .retriesUsed <
      previous.accounting
        .retriesUsed ||
    next.accounting
      .accountedCost + 1e-9 <
      previous.accounting
        .accountedCost
  ) {
    throw failure(
      "GOAL_DEV_RETRY_PERSISTENCE_ACCOUNTING_REWIND",
      "Les compteurs Retry Chain ne peuvent diminuer."
    );
  }

  if (
    previous.accounting
      .costKnown === false &&
    next.accounting
      .costKnown === true
  ) {
    throw failure(
      "GOAL_DEV_RETRY_PERSISTENCE_COST_REWIND",
      "Un coût inconnu ne peut redevenir certain sans réconciliation dédiée."
    );
  }

  return true;
}

function parseRow(
  row
) {
  if (!row) {
    return null;
  }

  let chain;

  try {
    chain =
      typeof row.payload_json ===
        "string"
        ? JSON.parse(
            row.payload_json
          )
        : clone(
            row.payload
          );
  } catch (cause) {
    throw Object.assign(
      failure(
        "GOAL_DEV_RETRY_PERSISTENCE_CORRUPT",
        "Retry Chain persistée illisible."
      ),
      { cause }
    );
  }

  assertChain(
    chain
  );

  return {
    revision:
      Number(
        row.sequence
      ),

    chain:
      clone(chain),
  };
}

function createSqliteRepository(
  wrapper
) {
  const db =
    wrapper.database;

  const latestStatement =
    db.prepare(`
      SELECT
        sequence,
        payload_json
      FROM goal_strategy_records
      WHERE record_type=?
        AND record_id=?
      ORDER BY sequence DESC
      LIMIT 1
    `);

  const historyStatement =
    db.prepare(`
      SELECT
        sequence,
        payload_json
      FROM goal_strategy_records
      WHERE record_type=?
        AND record_id=?
      ORDER BY sequence ASC
    `);

  const insertStatement =
    db.prepare(`
      INSERT INTO goal_strategy_records(
        record_type,
        record_id,
        parent_id,
        sequence,
        profile_scope,
        payload_json,
        created_at,
        updated_at
      )
      VALUES(?,?,?,?,?,?,?,?)
    `);

  function latest(
    chainId
  ) {
    return parseRow(
      latestStatement.get(
        RECORD_TYPE,
        String(chainId)
      )
    );
  }

  function history(
    chainId
  ) {
    return historyStatement
      .all(
        RECORD_TYPE,
        String(chainId)
      )
      .map(parseRow);
  }

  function save(
    chain,
    {
      expectedRevision,
    } = {}
  ) {
    assertChain(chain);

    if (
      !Number.isInteger(
        expectedRevision
      ) ||
      expectedRevision < 0
    ) {
      throw failure(
        "GOAL_DEV_RETRY_PERSISTENCE_REVISION_REQUIRED",
        "expectedRevision valide requis."
      );
    }

    db.exec(
      "BEGIN IMMEDIATE"
    );

    try {
      const current =
        latest(
          chain.chainId
        );

      const currentRevision =
        current?.revision || 0;

      if (
        currentRevision !==
          expectedRevision
      ) {
        throw failure(
          "GOAL_DEV_RETRY_PERSISTENCE_CONFLICT",
          "Retry Chain modifiée concurremment."
        );
      }

      if (
        current &&
        same(
          current.chain,
          chain
        )
      ) {
        db.exec("COMMIT");

        return {
          revision:
            current.revision,
          created: false,
          chain:
            clone(
              current.chain
            ),
        };
      }

      if (current) {
        assertForward(
          current.chain,
          chain
        );
      } else if (
        expectedRevision !== 0
      ) {
        throw failure(
          "GOAL_DEV_RETRY_PERSISTENCE_CONFLICT",
          "Révision initiale Retry Chain invalide."
        );
      }

      const revision =
        currentRevision + 1;

      insertStatement.run(
        RECORD_TYPE,
        chain.chainId,
        chain.goalRef.goalId,
        revision,
        null,
        JSON.stringify(
          chain
        ),
        chain.createdAt,
        chain.updatedAt
      );

      db.exec("COMMIT");

      return {
        revision,
        created: true,
        chain:
          clone(chain),
      };
    } catch (error) {
      try {
        db.exec(
          "ROLLBACK"
        );
      } catch {}

      throw error;
    }
  }

  return Object.freeze({
    kind: "sqlite",
    latest,
    history,
    save,
  });
}

function createFallbackRepository(
  wrapper
) {
  function rows() {
    const state =
      wrapper.load();

    if (
      !Array.isArray(
        state.goal_strategy_records
      )
    ) {
      state.goal_strategy_records = [];
    }

    return {
      state,
      rows:
        state.goal_strategy_records,
    };
  }

  function latest(
    chainId
  ) {
    const { rows: list } =
      rows();

    const candidates =
      list
        .filter(
          (row) =>
            row.recordType ===
              RECORD_TYPE &&
            row.recordId ===
              String(chainId)
        )
        .sort(
          (a, b) =>
            Number(
              b.sequence
            ) -
            Number(
              a.sequence
            )
        );

    return parseRow(
      candidates[0] ||
        null
    );
  }

  function history(
    chainId
  ) {
    const { rows: list } =
      rows();

    return list
      .filter(
        (row) =>
          row.recordType ===
            RECORD_TYPE &&
          row.recordId ===
            String(chainId)
      )
      .sort(
        (a, b) =>
          Number(
            a.sequence
          ) -
          Number(
            b.sequence
          )
      )
      .map(parseRow);
  }

  function save(
    chain,
    {
      expectedRevision,
    } = {}
  ) {
    assertChain(chain);

    if (
      !Number.isInteger(
        expectedRevision
      ) ||
      expectedRevision < 0
    ) {
      throw failure(
        "GOAL_DEV_RETRY_PERSISTENCE_REVISION_REQUIRED",
        "expectedRevision valide requis."
      );
    }

    const {
      state,
      rows: list,
    } = rows();

    const current =
      latest(
        chain.chainId
      );

    const currentRevision =
      current?.revision || 0;

    if (
      currentRevision !==
        expectedRevision
    ) {
      throw failure(
        "GOAL_DEV_RETRY_PERSISTENCE_CONFLICT",
        "Retry Chain modifiée concurremment."
      );
    }

    if (
      current &&
      same(
        current.chain,
        chain
      )
    ) {
      return {
        revision:
          current.revision,
        created: false,
        chain:
          clone(
            current.chain
          ),
      };
    }

    if (current) {
      assertForward(
        current.chain,
        chain
      );
    }

    const revision =
      currentRevision + 1;

    list.push({
      recordType:
        RECORD_TYPE,

      recordId:
        chain.chainId,

      parentId:
        chain.goalRef.goalId,

      sequence:
        revision,

      profileScope: null,

      payload:
        clone(chain),

      createdAt:
        chain.createdAt,

      updatedAt:
        chain.updatedAt,
    });

    wrapper.save(state);

    return {
      revision,
      created: true,
      chain:
        clone(chain),
    };
  }

  return Object.freeze({
    kind:
      "json-fallback",
    latest,
    history,
    save,
  });
}

function createGoalDevRetryChainRepository(
  wrapper
) {
  if (!wrapper) {
    throw new TypeError(
      "GoalDevRetryChainRepository requiert un stockage."
    );
  }

  const sqlite =
    wrapper.kind === "sqlite";

  const DatabaseSync =
    sqlite
      ? loadSqlite()?.DatabaseSync
      : null;

  if (
    sqlite &&
    (!DatabaseSync ||
      !(wrapper.database instanceof DatabaseSync))
  ) {
    throw new TypeError(
      "Backend SQLite Retry Chain valide requis."
    );
  }

  const repository = sqlite
    ? createSqliteRepository(
        wrapper
      )
    : createFallbackRepository(
        wrapper
      );

  repositoryCapabilities.set(
    repository,
    sqlite
      ? SQLITE_CAPABILITIES
      : JSON_CAPABILITIES
  );

  return repository;
}

module.exports = {
  CHAIN_VERSION,
  RECORD_TYPE,
  assertChain,
  assertForward,
  createGoalDevRetryChainRepository,
  describeGoalDevRetryChainRepository,
};
