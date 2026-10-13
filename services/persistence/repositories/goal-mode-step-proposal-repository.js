"use strict";

const {
  assertGoalModeStepProposalRecord,
} = require(
  "../../goals/goal-mode-step-proposal-store"
);

const {
  loadSqlite,
} = require(
  "../database"
);

const RECORD_TYPE =
  "GOAL_MODE_STEP_PROPOSAL";

const SQLITE_CAPABILITIES =
  Object.freeze({
    backend:
      "SQLITE",
    atomicCreate:
      true,
  });

const JSON_CAPABILITIES =
  Object.freeze({
    backend:
      "JSON_FALLBACK",
    atomicCreate:
      false,
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

function parseRow(
  row
) {
  if (!row) {
    return null;
  }

  let record;

  try {
    record =
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
      fail(
        "GOAL_MODE_STEP_PERSISTENCE_CORRUPT",
        "Proposition Goal Mode persistée illisible."
      ),
      { cause }
    );
  }

  assertGoalModeStepProposalRecord(
    record
  );

  return clone(
    record
  );
}

function createSqliteRepository(
  wrapper
) {
  const db =
    wrapper.database;

  const getStatement =
    db.prepare(`
      SELECT
        payload_json
      FROM goal_strategy_records
      WHERE record_type=?
        AND record_id=?
        AND sequence=1
      LIMIT 1
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

  function get(
    stepId
  ) {
    return parseRow(
      getStatement.get(
        RECORD_TYPE,
        String(stepId)
      )
    );
  }

  function getForReservation(
    stepId,
    runId,
    reservationId
  ) {
    const record =
      get(stepId);

    if (!record) {
      return null;
    }

    if (
      record.runRef.runId !==
        String(runId) ||
      record.planningRef
        .reservationId !==
        String(
          reservationId
        )
    ) {
      fail(
        "GOAL_MODE_STEP_PERSISTENCE_IDENTITY_CONFLICT",
        "Identité de proposition durable conflictuelle."
      );
    }

    return record;
  }

  function save(
    record
  ) {
    assertGoalModeStepProposalRecord(
      record
    );

    db.exec(
      "BEGIN IMMEDIATE"
    );

    try {
      const current =
        get(
          record.stepId
        );

      if (current) {
        if (
          !same(
            current,
            record
          )
        ) {
          fail(
            "GOAL_MODE_STEP_PERSISTENCE_CONFLICT",
            "Une proposition différente existe déjà pour cette réservation."
          );
        }

        db.exec(
          "COMMIT"
        );

        return {
          created:
            false,
          record:
            current,
        };
      }

      insertStatement.run(
        RECORD_TYPE,
        record.stepId,
        record.runRef
          .runId,
        1,
        null,
        JSON.stringify(
          record
        ),
        record.createdAt,
        record.createdAt
      );

      db.exec(
        "COMMIT"
      );

      return {
        created:
          true,
        record:
          clone(
            record
          ),
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
    get,
    getForReservation,
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

  function get(
    stepId
  ) {
    const {
      rows: list,
    } = rows();

    const row =
      list.find(
        (item) =>
          item.recordType ===
            RECORD_TYPE &&
          item.recordId ===
            String(stepId) &&
          Number(
            item.sequence
          ) === 1
      ) || null;

    return parseRow(
      row
    );
  }

  function getForReservation(
    stepId,
    runId,
    reservationId
  ) {
    const record =
      get(stepId);

    if (!record) {
      return null;
    }

    if (
      record.runRef.runId !==
        String(runId) ||
      record.planningRef
        .reservationId !==
        String(
          reservationId
        )
    ) {
      fail(
        "GOAL_MODE_STEP_PERSISTENCE_IDENTITY_CONFLICT",
        "Identité de proposition durable conflictuelle."
      );
    }

    return record;
  }

  function save(
    record
  ) {
    assertGoalModeStepProposalRecord(
      record
    );

    const {
      state,
      rows: list,
    } = rows();

    const current =
      get(
        record.stepId
      );

    if (current) {
      if (
        !same(
          current,
          record
        )
      ) {
        fail(
          "GOAL_MODE_STEP_PERSISTENCE_CONFLICT",
          "Une proposition différente existe déjà pour cette réservation."
        );
      }

      return {
        created:
          false,
        record:
          current,
      };
    }

    list.push({
      recordType:
        RECORD_TYPE,
      recordId:
        record.stepId,
      parentId:
        record.runRef
          .runId,
      sequence: 1,
      profileScope:
        null,
      payload:
        clone(record),
      createdAt:
        record.createdAt,
      updatedAt:
        record.createdAt,
    });

    wrapper.save(
      state
    );

    return {
      created:
        true,
      record:
        clone(record),
    };
  }

  return Object.freeze({
    kind:
      "json-fallback",
    get,
    getForReservation,
    save,
  });
}

function createGoalModeStepProposalRepository(
  wrapper
) {
  if (!wrapper) {
    throw new TypeError(
      "GoalModeStepProposalRepository requiert un stockage."
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
      "Backend SQLite Goal Step valide requis."
    );
  }

  const base =
    sqlite
      ? createSqliteRepository(
          wrapper
        )
      : createFallbackRepository(
          wrapper
        );

  const capabilities =
    sqlite
      ? SQLITE_CAPABILITIES
      : JSON_CAPABILITIES;

  return Object.freeze({
    ...base,

    capabilities() {
      return capabilities;
    },
  });
}

module.exports = {
  RECORD_TYPE,
  createGoalModeStepProposalRepository,
};
