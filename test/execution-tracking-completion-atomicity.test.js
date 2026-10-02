"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  createPersonalDatabase,
} = require("../services/persistence/database");

const {
  createExecutionTrackingRepository,
} = require(
  "../services/persistence/repositories/" +
  "execution-tracking-repository"
);

const {
  createExecutionTrackingEngine,
} = require(
  "../services/tracking/execution-tracking-engine"
);

const BASE =
  new Date("2026-08-28T08:00:00Z");

function block(id) {
  return {
    blockId: `block-${id}`,
    actionId: id,
    title: `Action ${id}`,
    start: "2026-08-28T08:00:00Z",
    end: "2026-08-28T09:00:00Z",
    durationMinutes: 60,
    priorityScore: 80,
    status: "proposed",
  };
}

function plan(id) {
  return {
    planId: `plan-${id}`,
    planVersion: 1,
    generatedAt:
      "2026-08-28T06:00:00Z",
    plannedBlocks: [],
    proposedBlocks: [
      block(id),
    ],
  };
}

function engine(repository) {
  return createExecutionTrackingEngine({
    repository,

    proactiveEngine: {
      adapters: {
        local(items) {
          return items;
        },
      },

      async evaluate() {
        return {
          recommendations: [],
          notifications: [],
          ignored: [],
        };
      },
    },

    planningEngine: {
      async replanDay() {
        return {
          planId: "noop",
          proposedBlocks: [],
          plannedBlocks: [],
        };
      },
    },

    metrics: {
      record() {},
    },

    now: () => BASE,

    gracePeriods: {
      default: 15,
    },
  });
}

function fixture(label) {
  const directory = fs.mkdtempSync(
    path.join(
      os.tmpdir(),
      `noon-tracking-completion-${label}-`,
    ),
  );

  const database =
    createPersonalDatabase(
      path.join(
        directory,
        "tracking.sqlite",
      ),
    );

  assert.equal(
    database.kind,
    "sqlite",
    "SQLite natif requis pour cette régression.",
  );

  const repository =
    createExecutionTrackingRepository(
      database,
    );

  return {
    directory,
    database,
    repository,

    close() {
      database.close();

      fs.rmSync(
        directory,
        {
          recursive: true,
          force: true,
        },
      );
    },
  };
}

function faultingRepository(
  repository,
  boundary,
) {
  let fired = false;

  return new Proxy(
    repository,
    {
      get(target, property) {
        const value =
          Reflect.get(
            target,
            property,
            target,
          );

        if (
          typeof value !== "function"
        ) {
          return value;
        }

        if (
          property === "appendEvent"
        ) {
          return (...args) => {
            if (
              !fired &&
              boundary === "before-event"
            ) {
              fired = true;

              throw Object.assign(
                new Error(
                  "échec avant événement simulé",
                ),
                {
                  code:
                    "TEST_BEFORE_EVENT_FAILURE",
                },
              );
            }

            const result =
              value.apply(
                target,
                args,
              );

            if (
              !fired &&
              boundary === "after-event"
            ) {
              fired = true;

              throw Object.assign(
                new Error(
                  "échec après événement simulé",
                ),
                {
                  code:
                    "TEST_AFTER_EVENT_FAILURE",
                },
              );
            }

            return result;
          };
        }

        if (
          property === "recordDuration"
        ) {
          return (...args) => {
            if (
              !fired &&
              boundary ===
                "before-duration"
            ) {
              fired = true;

              throw Object.assign(
                new Error(
                  "échec avant durée simulé",
                ),
                {
                  code:
                    "TEST_BEFORE_DURATION_FAILURE",
                },
              );
            }

            const result =
              value.apply(
                target,
                args,
              );

            if (
              !fired &&
              boundary ===
                "after-duration"
            ) {
              fired = true;

              throw Object.assign(
                new Error(
                  "échec après durée simulé",
                ),
                {
                  code:
                    "TEST_AFTER_DURATION_FAILURE",
                },
              );
            }

            return result;
          };
        }

        return value.bind(target);
      },
    },
  );
}

function rawState(
  database,
  itemId,
  eventKey,
) {
  const db = database.database;

  const item = db.prepare(`
    SELECT
      status,
      actual_start,
      actual_end,
      version
    FROM execution_items
    WHERE id=?
  `).get(itemId);

  const event = db.prepare(`
    SELECT event_key
    FROM execution_events
    WHERE event_key=?
  `).get(eventKey);

  const duration = db.prepare(`
    SELECT
      sample_count,
      total_estimated_minutes,
      total_actual_minutes
    FROM duration_statistics
    WHERE scope_key='project:general'
  `).get();

  return {
    item: item
      ? { ...item }
      : null,

    event: event
      ? { ...event }
      : null,

    duration: duration
      ? { ...duration }
      : null,
  };
}

function prepareCompletion(
  repository,
  label,
) {
  const normal =
    engine(repository);

  const [item] =
    normal.ingestPlan(
      plan(label),
    );

  normal.transition(
    item.executionItemId,
    {
      status: "in_progress",
      source:
        "explicit_user_confirmation",
      occurredAt:
        "2026-08-28T08:00:00Z",
      eventKey:
        `${label}:start`,
    },
  );

  const eventKey =
    `${label}:complete`;

  const evidence = {
    executionItemId:
      item.executionItemId,
    status: "completed",
    source:
      "explicit_user_confirmation",
    occurredAt:
      "2026-08-28T09:10:00Z",
    eventKey,
  };

  return {
    normal,
    item,
    eventKey,
    evidence,
  };
}

for (
  const boundary of [
    "before-event",
    "after-event",
    "before-duration",
    "after-duration",
  ]
) {
  test(
    `${boundary} rollbacke item, événement et durée puis le rejeu converge`,
    () => {
      const f =
        fixture(boundary);

      try {
        const prepared =
          prepareCompletion(
            f.repository,
            boundary,
          );

        const failing =
          engine(
            faultingRepository(
              f.repository,
              boundary,
            ),
          );

        assert.throws(
          () =>
            failing.synchronizeEvidence(
              prepared.evidence,
            ),
        );

        const failed =
          rawState(
            f.database,
            prepared.item.executionItemId,
            prepared.eventKey,
          );

        assert.equal(
          failed.item.status,
          "in_progress",
        );

        assert.equal(
          failed.item.actual_end,
          null,
        );

        assert.equal(
          failed.event,
          null,
        );

        assert.equal(
          failed.duration,
          null,
        );

        const replay =
          prepared.normal
            .synchronizeEvidence(
              prepared.evidence,
            );

        assert.equal(
          replay.idempotent,
          false,
        );

        const recovered =
          rawState(
            f.database,
            prepared.item.executionItemId,
            prepared.eventKey,
          );

        assert.equal(
          recovered.item.status,
          "completed",
        );

        assert.ok(
          recovered.event,
        );

        assert.deepEqual(
          recovered.duration,
          {
            sample_count: 1,
            total_estimated_minutes: 60,
            total_actual_minutes: 70,
          },
        );

        const duplicate =
          prepared.normal
            .synchronizeEvidence(
              prepared.evidence,
            );

        assert.equal(
          duplicate.idempotent,
          true,
        );

        const final =
          rawState(
            f.database,
            prepared.item.executionItemId,
            prepared.eventKey,
          );

        assert.equal(
          final.duration.sample_count,
          1,
        );

        assert.equal(
          final.duration
            .total_actual_minutes,
          70,
        );
      } finally {
        f.close();
      }
    },
  );
}

test(
  "completion réussie participe à une transaction externe et suit son rollback",
  () => {
    const f = fixture("outer-rollback");

    try {
      const prepared = prepareCompletion(
        f.repository,
        "outer-rollback",
      );

      const db = f.database.database;

      db.exec("BEGIN IMMEDIATE");

      try {
        const result =
          prepared.normal.synchronizeEvidence(
            prepared.evidence,
          );

        assert.equal(
          result.idempotent,
          false,
        );

        assert.equal(
          db.isTransaction,
          true,
        );

        const inside =
          rawState(
            f.database,
            prepared.item.executionItemId,
            prepared.eventKey,
          );

        assert.equal(
          inside.item.status,
          "completed",
        );

        assert.ok(
          inside.event,
        );

        assert.equal(
          inside.duration.sample_count,
          1,
        );

        db.exec("ROLLBACK");
      } catch (error) {
        if (db.isTransaction) {
          db.exec("ROLLBACK");
        }

        throw error;
      }

      const rolledBack =
        rawState(
          f.database,
          prepared.item.executionItemId,
          prepared.eventKey,
        );

      assert.equal(
        rolledBack.item.status,
        "in_progress",
      );

      assert.equal(
        rolledBack.item.actual_end,
        null,
      );

      assert.equal(
        rolledBack.event,
        null,
      );

      assert.equal(
        rolledBack.duration,
        null,
      );

      const replay =
        prepared.normal.synchronizeEvidence(
          prepared.evidence,
        );

      assert.equal(
        replay.idempotent,
        false,
      );

      const final =
        rawState(
          f.database,
          prepared.item.executionItemId,
          prepared.eventKey,
        );

      assert.equal(
        final.item.status,
        "completed",
      );

      assert.ok(
        final.event,
      );

      assert.equal(
        final.duration.sample_count,
        1,
      );
    } finally {
      f.close();
    }
  },
);

test(
  "échec interne sous transaction externe rollbacke son savepoint sans tuer le caller",
  () => {
    const f = fixture(
      "outer-savepoint-failure",
    );

    try {
      const prepared =
        prepareCompletion(
          f.repository,
          "outer-savepoint-failure",
        );

      const db =
        f.database.database;

      const failing =
        engine(
          faultingRepository(
            f.repository,
            "after-event",
          ),
        );

      db.exec("BEGIN IMMEDIATE");

      try {
        assert.throws(
          () =>
            failing.synchronizeEvidence(
              prepared.evidence,
            ),
          {
            code:
              "TEST_AFTER_EVENT_FAILURE",
          },
        );

        assert.equal(
          db.isTransaction,
          true,
        );

        const afterFailure =
          rawState(
            f.database,
            prepared.item.executionItemId,
            prepared.eventKey,
          );

        assert.equal(
          afterFailure.item.status,
          "in_progress",
        );

        assert.equal(
          afterFailure.item.actual_end,
          null,
        );

        assert.equal(
          afterFailure.event,
          null,
        );

        assert.equal(
          afterFailure.duration,
          null,
        );

        /*
         * La transaction appelante reste valide :
         * elle peut décider de commit sans conserver
         * les écritures partielles de l'opération échouée.
         */
        db.exec("COMMIT");
      } catch (error) {
        if (db.isTransaction) {
          db.exec("ROLLBACK");
        }

        throw error;
      }

      const committed =
        rawState(
          f.database,
          prepared.item.executionItemId,
          prepared.eventKey,
        );

      assert.equal(
        committed.item.status,
        "in_progress",
      );

      assert.equal(
        committed.event,
        null,
      );

      assert.equal(
        committed.duration,
        null,
      );

      const replay =
        prepared.normal.synchronizeEvidence(
          prepared.evidence,
        );

      assert.equal(
        replay.idempotent,
        false,
      );

      const final =
        rawState(
          f.database,
          prepared.item.executionItemId,
          prepared.eventKey,
        );

      assert.equal(
        final.item.status,
        "completed",
      );

      assert.ok(
        final.event,
      );

      assert.equal(
        final.duration.sample_count,
        1,
      );
    } finally {
      f.close();
    }
  },
);
