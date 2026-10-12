"use strict";

const {
  assertGoalModeRunForward,
  assertGoalModeRunState,
} = require(
  "../../goals/goal-mode-run-state"
);

const {
  loadSqlite,
} = require(
  "../database"
);

const RECORD_TYPE =
  "GOAL_MODE_RUN_STATE";

const repositoryCapabilities =
  new WeakMap();

const UNKNOWN_CAPABILITIES =
  Object.freeze({
    backend:
      "UNKNOWN",
    atomicRevisionCas:
      false,
  });

const SQLITE_CAPABILITIES =
  Object.freeze({
    backend:
      "SQLITE",
    atomicRevisionCas:
      true,
  });

const JSON_CAPABILITIES =
  Object.freeze({
    backend:
      "JSON_FALLBACK",
    atomicRevisionCas:
      false,
  });

function describeGoalModeRunRepository(
  repository
) {
  return repositoryCapabilities.get(
    repository
  ) || UNKNOWN_CAPABILITIES;
}

function fail(
  code,
  message
) {
  throw Object.assign(
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
    value === undefined ||
    value === null
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
    typeof value === "object"
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

function parseRow(
  row
) {
  if (!row) {
    return null;
  }

  let state;

  try {
    state =
      row.payload_json !==
        undefined
        ? JSON.parse(
            row.payload_json
          )
        : clone(
            row.payload
          );
  } catch (cause) {
    throw Object.assign(
      fail(
        "GOAL_MODE_RUN_PERSISTENCE_CORRUPT",
        "Goal Run persisté illisible."
      ),
      { cause }
    );
  }

  assertGoalModeRunState(
    state
  );

  return {
    revision:
      Number(
        row.sequence
      ),

    state:
      clone(state),
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
    runId
  ) {
    return parseRow(
      latestStatement.get(
        RECORD_TYPE,
        String(runId)
      )
    );
  }

  function history(
    runId
  ) {
    return historyStatement
      .all(
        RECORD_TYPE,
        String(runId)
      )
      .map(
        parseRow
      );
  }

  function save(
    state,
    {
      expectedRevision,
    } = {}
  ) {
    assertGoalModeRunState(
      state
    );

    if (
      !Number.isInteger(
        expectedRevision
      ) ||
      expectedRevision < 0
    ) {
      fail(
        "GOAL_MODE_RUN_REVISION_REQUIRED",
        "expectedRevision valide requis."
      );
    }

    db.exec(
      "BEGIN IMMEDIATE"
    );

    try {
      const current =
        latest(
          state.runId
        );

      const currentRevision =
        current?.revision || 0;

      if (
        currentRevision !==
          expectedRevision
      ) {
        fail(
          "GOAL_MODE_RUN_PERSISTENCE_CONFLICT",
          "Goal Run modifié concurremment."
        );
      }

      if (
        current &&
        same(
          current.state,
          state
        )
      ) {
        db.exec(
          "COMMIT"
        );

        return {
          revision:
            current.revision,

          created:
            false,

          state:
            clone(
              current.state
            ),
        };
      }

      if (current) {
        assertGoalModeRunForward(
          current.state,
          state
        );
      } else if (
        expectedRevision !== 0
      ) {
        fail(
          "GOAL_MODE_RUN_PERSISTENCE_CONFLICT",
          "Révision initiale Goal Run invalide."
        );
      }

      const revision =
        currentRevision + 1;

      insertStatement.run(
        RECORD_TYPE,
        state.runId,
        state.contract
          .goalRef
          .goalId,
        revision,
        state.contract
          .scope
          .profileScope ||
          null,
        JSON.stringify(
          state
        ),
        state.createdAt,
        state.updatedAt
      );

      db.exec(
        "COMMIT"
      );

      return {
        revision,

        created:
          true,

        state:
          clone(state),
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
    kind:
      "sqlite",

    history,
    latest,
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
    runId
  ) {
    const {
      rows: list,
    } = rows();

    const candidate =
      list
        .filter(
          (row) =>
            row.recordType ===
              RECORD_TYPE &&
            row.recordId ===
              String(runId)
        )
        .sort(
          (left, right) =>
            Number(
              right.sequence
            ) -
            Number(
              left.sequence
            )
        )[0] ||
      null;

    return parseRow(
      candidate
    );
  }

  function history(
    runId
  ) {
    const {
      rows: list,
    } = rows();

    return list
      .filter(
        (row) =>
          row.recordType ===
            RECORD_TYPE &&
          row.recordId ===
            String(runId)
      )
      .sort(
        (left, right) =>
          Number(
            left.sequence
          ) -
          Number(
            right.sequence
          )
      )
      .map(
        parseRow
      );
  }

  function save(
    runState,
    {
      expectedRevision,
    } = {}
  ) {
    assertGoalModeRunState(
      runState
    );

    if (
      !Number.isInteger(
        expectedRevision
      ) ||
      expectedRevision < 0
    ) {
      fail(
        "GOAL_MODE_RUN_REVISION_REQUIRED",
        "expectedRevision valide requis."
      );
    }

    const {
      state,
      rows: list,
    } = rows();

    const current =
      latest(
        runState.runId
      );

    const currentRevision =
      current?.revision || 0;

    if (
      currentRevision !==
        expectedRevision
    ) {
      fail(
        "GOAL_MODE_RUN_PERSISTENCE_CONFLICT",
        "Goal Run modifié concurremment."
      );
    }

    if (
      current &&
      same(
        current.state,
        runState
      )
    ) {
      return {
        revision:
          current.revision,

        created:
          false,

        state:
          clone(
            current.state
          ),
      };
    }

    if (current) {
      assertGoalModeRunForward(
        current.state,
        runState
      );
    } else if (
      expectedRevision !== 0
    ) {
      fail(
        "GOAL_MODE_RUN_PERSISTENCE_CONFLICT",
        "Révision initiale Goal Run invalide."
      );
    }

    const revision =
      currentRevision + 1;

    list.push({
      recordType:
        RECORD_TYPE,

      recordId:
        runState.runId,

      parentId:
        runState.contract
          .goalRef
          .goalId,

      sequence:
        revision,

      profileScope:
        runState.contract
          .scope
          .profileScope ||
        null,

      payload:
        clone(
          runState
        ),

      createdAt:
        runState.createdAt,

      updatedAt:
        runState.updatedAt,
    });

    wrapper.save(
      state
    );

    return {
      revision,

      created:
        true,

      state:
        clone(
          runState
        ),
    };
  }

  return Object.freeze({
    kind:
      "json-fallback",

    history,
    latest,
    save,
  });
}

function createGoalModeRunRepository(
  wrapper
) {
  if (!wrapper) {
    throw new TypeError(
      "GoalModeRunRepository requiert un stockage."
    );
  }

  const sqlite =
    wrapper.kind ===
      "sqlite";

  const DatabaseSync =
    sqlite
      ? loadSqlite()
          ?.DatabaseSync
      : null;

  if (
    sqlite &&
    (
      !DatabaseSync ||
      !(
        wrapper.database instanceof
          DatabaseSync
      )
    )
  ) {
    throw new TypeError(
      "Backend SQLite Goal Run valide requis."
    );
  }

  const repository =
    sqlite
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
  RECORD_TYPE,
  createGoalModeRunRepository,
  describeGoalModeRunRepository,
};
