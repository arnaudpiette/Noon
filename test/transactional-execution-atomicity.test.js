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
  createTransactionalExecutionRepository,
} = require("../services/persistence/repositories/transactional-execution-repository");

const {
  createTransactionalExecutionEngine,
} = require("../services/execution/transactional-execution-engine");

const STAMP = "2026-10-01T20:00:00.000Z";

function fixture() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "noon-transaction-execution-atomic-"),
  );

  const database = createPersonalDatabase(
    path.join(directory, "personal.sqlite"),
  );

  return {
    directory,
    database,
    close() {
      database.close();
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

function repository(ctx, db = ctx.database.database) {
  return createTransactionalExecutionRepository({
    kind: "sqlite",
    database: db,
  });
}

function execution(id, state = "RUNNING") {
  return {
    execution_id: id,
    intent_id: `intent-${id}`,
    plan_version: "1",
    plan_fingerprint: `plan-${id}`,
    action_fingerprint: `action-${id}`,
    policy_version: "1",
    approval_id: null,
    state,
    failure_policy: "STOP_ON_FAILURE",
    atomicity: "BEST_EFFORT",
    workspace_id: null,
    project_id: null,
    profile_scope: "arnaud",
    session_id: null,
    conversation_id: null,
    reason_code: null,
    safe_result_json: "{}",
    requested_at: STAMP,
    created_at: STAMP,
    started_at: STAMP,
    completed_at: null,
    updated_at: STAMP,
  };
}

function step(executionId, stepId, state) {
  return {
    execution_id: executionId,
    step_id: stepId,
    skill_id: "fixture_skill",
    operation: "fixture",
    args_fingerprint: `args-${stepId}`,
    idempotency_key: `${executionId}:${stepId}`,
    dependencies_json: "[]",
    action_class: "WRITE",
    state,
    verification_level: "BASIC",
    verification_state: null,
    result_ref: null,
    provider_ref_hash: null,
    reason_code: null,
    attempt_count: 1,
    started_at: STAMP,
    applied_at: state === "APPLIED" ? STAMP : null,
    verified_at: null,
    completed_at: null,
    updated_at: STAMP,
  };
}

function faultingDatabase(database) {
  return new Proxy(database, {
    get(target, property) {
      const value = Reflect.get(target, property, target);

      if (property === "exec") {
        return target.exec.bind(target);
      }

      if (property === "prepare") {
        return (sql) => {
          const statement = target.prepare(sql);

          const executionWrite =
            /^INSERT INTO transactional_executions/.test(sql.trim());

          if (!executionWrite) return statement;

          return new Proxy(statement, {
            get(statementTarget, statementProperty) {
              const statementValue = Reflect.get(
                statementTarget,
                statementProperty,
                statementTarget,
              );

              if (statementProperty === "run") {
                return () => {
                  throw Object.assign(
                    new Error("échec journal execution simulé"),
                    { code: "TEST_EXECUTION_WRITE_FAILURE" },
                  );
                };
              }

              return typeof statementValue === "function"
                ? statementValue.bind(statementTarget)
                : statementValue;
            },
          });
        };
      }

      return typeof value === "function"
        ? value.bind(target)
        : value;
    },
  });
}

function engine(repo) {
  const skillRegistry = new Proxy({}, {
    get(_target, property) {
      if (["list", "values", "entries"].includes(String(property))) {
        return () => [];
      }

      if (["has", "hasSkill"].includes(String(property))) {
        return () => true;
      }

      return () => ({
        skillId: "fixture_skill",
        operation: "fixture",
        actionClass: "WRITE",
        verificationLevel: "BASIC",
      });
    },
  });

  return createTransactionalExecutionEngine({
    repository: repo,
    skillRegistry,
    now: () => Date.parse(STAMP),
  });
}

test("transaction participe à une transaction SQLite appelante", () => {
  const ctx = fixture();

  try {
    const repo = repository(ctx);
    const db = ctx.database.database;

    db.exec("BEGIN IMMEDIATE");

    try {
      repo.transaction(() => {
        repo.saveExecution(execution("outer-rollback"));
      });

      assert.equal(db.isTransaction, true);
      assert.ok(repo.getExecution("outer-rollback"));

      db.exec("ROLLBACK");
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      throw error;
    }

    assert.equal(repo.getExecution("outer-rollback"), null);
  } finally {
    ctx.close();
  }
});

test("recovery committe execution et steps ensemble", () => {
  const ctx = fixture();

  try {
    const repo = repository(ctx);

    repo.saveExecution(execution("recover-success"));
    repo.saveStep(step("recover-success", "running", "RUNNING"));
    repo.saveStep(step("recover-success", "applied", "APPLIED"));

    const recovered = engine(repo).recoverInterrupted();

    assert.deepEqual(recovered, ["recover-success"]);
    assert.equal(
      repo.getExecution("recover-success").state,
      "INTERRUPTED",
    );

    assert.deepEqual(
      repo.getSteps("recover-success").map((item) => item.state),
      ["UNKNOWN_OUTCOME", "UNKNOWN_OUTCOME"],
    );
  } finally {
    ctx.close();
  }
});

test("échec execution rollbacke les steps du recovery", () => {
  const ctx = fixture();

  try {
    const good = repository(ctx);

    good.saveExecution(execution("recover-failure"));
    good.saveStep(step("recover-failure", "running", "RUNNING"));
    good.saveStep(step("recover-failure", "applied", "APPLIED"));

    const failing = repository(
      ctx,
      faultingDatabase(ctx.database.database),
    );

    assert.throws(
      () => engine(failing).recoverInterrupted(),
      { code: "TEST_EXECUTION_WRITE_FAILURE" },
    );

    assert.equal(
      good.getExecution("recover-failure").state,
      "RUNNING",
    );

    assert.deepEqual(
      good.getSteps("recover-failure").map((item) => item.state),
      ["RUNNING", "APPLIED"],
    );

    assert.equal(
      ctx.database.database.isTransaction,
      false,
    );

    const current =
      good.getExecution("recover-failure");

    good.saveExecution({
      ...current,
      reason_code: "CONNECTION_REUSABLE",
      updated_at: STAMP,
    });

    assert.equal(
      good.getExecution("recover-failure").reason_code,
      "CONNECTION_REUSABLE",
    );
  } finally {
    ctx.close();
  }
});

test("échec interne sous transaction externe préserve la transaction appelante", () => {
  const ctx = fixture();

  try {
    const good = repository(ctx);
    const db = ctx.database.database;

    good.saveExecution(execution("outer-failure"));
    good.saveStep(step("outer-failure", "running", "RUNNING"));

    const failing = repository(
      ctx,
      faultingDatabase(db),
    );

    db.exec("BEGIN IMMEDIATE");

    try {
      assert.throws(
        () => engine(failing).recoverInterrupted(),
        { code: "TEST_EXECUTION_WRITE_FAILURE" },
      );

      assert.equal(db.isTransaction, true);

      const current =
        good.getExecution("outer-failure");

      good.saveExecution({
        ...current,
        reason_code: "OUTER_TX_ALIVE",
        updated_at: STAMP,
      });

      db.exec("COMMIT");
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      throw error;
    }

    assert.equal(
      good.getExecution("outer-failure").state,
      "RUNNING",
    );

    assert.equal(
      good.getExecution("outer-failure").reason_code,
      "OUTER_TX_ALIVE",
    );

    assert.equal(
      good.getSteps("outer-failure")[0].state,
      "RUNNING",
    );
  } finally {
    ctx.close();
  }
});
