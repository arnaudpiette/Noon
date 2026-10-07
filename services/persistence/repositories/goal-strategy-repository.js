"use strict";

function clone(value) {
  return value == null
    ? value
    : structuredClone(value);
}

function parsePayload(value) {
  try {
    const parsed = JSON.parse(value);

    if (
      parsed == null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      throw new Error("payload invalide");
    }

    return parsed;
  } catch (cause) {
    throw Object.assign(
      new Error(
        "Enregistrement Goal persistant illisible."
      ),
      {
        code: "GOAL_PERSISTENCE_CORRUPT",
        cause,
      }
    );
  }
}

function iso(value) {
  const parsed = Date.parse(value || "");

  return Number.isFinite(parsed)
    ? new Date(parsed).toISOString()
    : new Date().toISOString();
}

function createSqliteRepository(wrapper) {
  const db = wrapper.database;

  const upsert = db.prepare(`
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
    ON CONFLICT(record_type, record_id, sequence)
    DO UPDATE SET
      parent_id=excluded.parent_id,
      profile_scope=excluded.profile_scope,
      payload_json=excluded.payload_json,
      updated_at=excluded.updated_at
  `);

  const remove = db.prepare(`
    DELETE FROM goal_strategy_records
    WHERE record_type=?
      AND record_id=?
  `);

  const selectAll = db.prepare(`
    SELECT
      record_type,
      record_id,
      parent_id,
      sequence,
      profile_scope,
      payload_json,
      created_at,
      updated_at
    FROM goal_strategy_records
    ORDER BY
      record_type,
      parent_id,
      sequence,
      created_at,
      record_id
  `);

  function transaction(operation) {
    db.exec("BEGIN IMMEDIATE");

    try {
      const result = operation();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {}

      throw error;
    }
  }

  function persist({
    type,
    recordId,
    parentId = null,
    sequence = 0,
    profileScope = null,
    payload,
    createdAt = null,
    updatedAt = null,
  }) {
    const value = clone(payload);
    const created = iso(
      createdAt ||
      value?.createdAt ||
      value?.reviewedAt
    );

    const updated = iso(
      updatedAt ||
      value?.updatedAt ||
      value?.reviewedAt ||
      created
    );

    upsert.run(
      String(type),
      String(recordId),
      parentId == null
        ? null
        : String(parentId),
      Math.max(
        0,
        Number(sequence) || 0
      ),
      profileScope == null
        ? null
        : String(profileScope),
      JSON.stringify(value),
      created,
      updated
    );

    return value;
  }

  function loadState() {
    const state = {
      goals: [],
      candidates: [],
      versions: [],
      relations: [],
      strategies: [],
      reviews: [],
    };

    for (const row of selectAll.all()) {
      const value = parsePayload(
        row.payload_json
      );

      switch (row.record_type) {
        case "GOAL":
          state.goals.push(value);
          break;

        case "CANDIDATE":
          state.candidates.push(value);
          break;

        case "GOAL_VERSION":
          state.versions.push(value);
          break;

        case "RELATION":
          state.relations.push(value);
          break;

        case "STRATEGY":
          state.strategies.push(value);
          break;

        case "REVIEW":
          state.reviews.push(value);
          break;

        default:
          break;
      }
    }

    return state;
  }

  function saveGoal(goal) {
    return persist({
      type: "GOAL",
      recordId: goal.goalId,
      profileScope: goal.profileScope,
      payload: goal,
      createdAt: goal.createdAt,
      updatedAt: goal.updatedAt,
    });
  }

  function saveVersion(goal) {
    return persist({
      type: "GOAL_VERSION",
      recordId: goal.goalId,
      parentId: goal.goalId,
      sequence: goal.version,
      profileScope: goal.profileScope,
      payload: goal,
      createdAt: goal.createdAt,
      updatedAt: goal.updatedAt,
    });
  }

  function saveCandidate(candidate) {
    return persist({
      type: "CANDIDATE",
      recordId: candidate.candidateId,
      profileScope: candidate.profileScope,
      payload: candidate,
      createdAt: candidate.createdAt,
      updatedAt: candidate.createdAt,
    });
  }

  function removeCandidate(candidateId) {
    remove.run(
      "CANDIDATE",
      String(candidateId)
    );

    return true;
  }

  function saveRelation(relation) {
    return persist({
      type: "RELATION",
      recordId: relation.relationId,
      parentId: relation.fromGoalId,
      payload: relation,
      createdAt: relation.createdAt,
      updatedAt: relation.createdAt,
    });
  }

  function saveStrategy(strategy) {
    return persist({
      type: "STRATEGY",
      recordId: strategy.strategyId,
      parentId: strategy.goalId,
      sequence: strategy.version,
      payload: strategy,
      createdAt: strategy.createdAt,
      updatedAt:
        strategy.supersededAt ||
        strategy.createdAt,
    });
  }

  function saveReview(review) {
    return persist({
      type: "REVIEW",
      recordId: review.reviewId,
      parentId: review.goalId,
      payload: review,
      createdAt: review.reviewedAt,
      updatedAt: review.reviewedAt,
    });
  }

  return {
    kind: "sqlite",
    loadState,
    removeCandidate,
    saveCandidate,
    saveGoal,
    saveRelation,
    saveReview,
    saveStrategy,
    saveVersion,
    transaction,
  };
}

function createFallbackRepository(wrapper) {
  function data() {
    return wrapper.load();
  }

  function records(state) {
    if (
      !Array.isArray(
        state.goal_strategy_records
      )
    ) {
      state.goal_strategy_records = [];
    }

    return state.goal_strategy_records;
  }

  function saveRecord({
    type,
    recordId,
    parentId = null,
    sequence = 0,
    profileScope = null,
    payload,
  }) {
    const state = data();
    const list = records(state);

    const index = list.findIndex(
      (item) =>
        item.recordType === type &&
        item.recordId ===
          String(recordId) &&
        Number(item.sequence || 0) ===
          Number(sequence || 0)
    );

    const now = new Date().toISOString();

    const value = {
      recordType: type,
      recordId: String(recordId),
      parentId:
        parentId == null
          ? null
          : String(parentId),
      sequence:
        Math.max(
          0,
          Number(sequence) || 0
        ),
      profileScope:
        profileScope == null
          ? null
          : String(profileScope),
      payload: clone(payload),
      createdAt:
        index >= 0
          ? list[index].createdAt
          : now,
      updatedAt: now,
    };

    if (index >= 0) {
      list[index] = value;
    } else {
      list.push(value);
    }

    wrapper.save(state);

    return clone(payload);
  }

  function loadState() {
    const state = {
      goals: [],
      candidates: [],
      versions: [],
      relations: [],
      strategies: [],
      reviews: [],
    };

    for (const row of records(data())) {
      const value = clone(
        row.payload
      );

      switch (row.recordType) {
        case "GOAL":
          state.goals.push(value);
          break;

        case "CANDIDATE":
          state.candidates.push(value);
          break;

        case "GOAL_VERSION":
          state.versions.push(value);
          break;

        case "RELATION":
          state.relations.push(value);
          break;

        case "STRATEGY":
          state.strategies.push(value);
          break;

        case "REVIEW":
          state.reviews.push(value);
          break;

        default:
          break;
      }
    }

    return state;
  }

  function removeCandidate(candidateId) {
    const state = data();

    state.goal_strategy_records =
      records(state).filter(
        (item) =>
          !(
            item.recordType ===
              "CANDIDATE" &&
            item.recordId ===
              String(candidateId)
          )
      );

    wrapper.save(state);

    return true;
  }

  return {
    kind: "json-fallback",

    loadState,

    removeCandidate,

    saveGoal: (goal) =>
      saveRecord({
        type: "GOAL",
        recordId: goal.goalId,
        profileScope:
          goal.profileScope,
        payload: goal,
      }),

    saveVersion: (goal) =>
      saveRecord({
        type: "GOAL_VERSION",
        recordId: goal.goalId,
        parentId: goal.goalId,
        sequence: goal.version,
        profileScope:
          goal.profileScope,
        payload: goal,
      }),

    saveCandidate: (candidate) =>
      saveRecord({
        type: "CANDIDATE",
        recordId:
          candidate.candidateId,
        profileScope:
          candidate.profileScope,
        payload: candidate,
      }),

    saveRelation: (relation) =>
      saveRecord({
        type: "RELATION",
        recordId:
          relation.relationId,
        parentId:
          relation.fromGoalId,
        payload: relation,
      }),

    saveStrategy: (strategy) =>
      saveRecord({
        type: "STRATEGY",
        recordId:
          strategy.strategyId,
        parentId:
          strategy.goalId,
        sequence:
          strategy.version,
        payload: strategy,
      }),

    saveReview: (review) =>
      saveRecord({
        type: "REVIEW",
        recordId:
          review.reviewId,
        parentId:
          review.goalId,
        payload: review,
      }),

    transaction(operation) {
      return operation();
    },
  };
}

function createGoalStrategyRepository(
  wrapper
) {
  if (!wrapper) {
    throw new TypeError(
      "GoalStrategyRepository requiert un stockage."
    );
  }

  return wrapper.kind === "sqlite"
    ? createSqliteRepository(wrapper)
    : createFallbackRepository(wrapper);
}

module.exports = {
  createGoalStrategyRepository,
};
