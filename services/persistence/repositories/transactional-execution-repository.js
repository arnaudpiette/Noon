"use strict";

const crypto = require("node:crypto");

// Journal minimal : aucune donnée métier ni argument brut n'est persisté.
function createTransactionalExecutionRepository(wrapper) {
  if (!wrapper) throw new TypeError("Stockage d'exécution requis.");

  if (wrapper.kind === "sqlite") {
    const db = wrapper.database;
    const executionColumns = [
      "execution_id", "intent_id", "plan_version", "plan_fingerprint",
      "action_fingerprint", "policy_version", "approval_id", "state",
      "failure_policy", "atomicity", "workspace_id", "project_id",
      "profile_scope", "session_id", "conversation_id", "reason_code",
      "safe_result_json", "requested_at", "created_at", "started_at",
      "completed_at", "updated_at",
    ];
    const stepColumns = [
      "execution_id", "step_id", "skill_id", "operation", "args_fingerprint",
      "idempotency_key", "dependencies_json", "action_class", "state",
      "verification_level", "verification_state", "result_ref",
      "provider_ref_hash", "reason_code", "attempt_count", "started_at",
      "applied_at", "verified_at", "completed_at", "updated_at",
    ];
    const saveExecutionStatement = db.prepare(`INSERT INTO transactional_executions(${executionColumns.join(",")})
      VALUES(${executionColumns.map(() => "?").join(",")})
      ON CONFLICT(execution_id) DO UPDATE SET state=excluded.state,
      reason_code=excluded.reason_code,safe_result_json=excluded.safe_result_json,
      started_at=excluded.started_at,completed_at=excluded.completed_at,
      updated_at=excluded.updated_at`);
    const saveStepStatement = db.prepare(`INSERT INTO transactional_execution_steps(${stepColumns.join(",")})
      VALUES(${stepColumns.map(() => "?").join(",")})
      ON CONFLICT(execution_id,step_id) DO UPDATE SET state=excluded.state,
      verification_state=excluded.verification_state,result_ref=excluded.result_ref,
      provider_ref_hash=excluded.provider_ref_hash,reason_code=excluded.reason_code,
      attempt_count=excluded.attempt_count,started_at=excluded.started_at,
      applied_at=excluded.applied_at,verified_at=excluded.verified_at,
      completed_at=excluded.completed_at,updated_at=excluded.updated_at`);
    return {
      saveExecution(record) {
        saveExecutionStatement.run(...executionColumns.map((key) => record[key] ?? null));
        return record;
      },
      saveStep(record) {
        saveStepStatement.run(...stepColumns.map((key) => record[key] ?? null));
        return record;
      },
      getExecution(id) {
        return db.prepare("SELECT * FROM transactional_executions WHERE execution_id=?").get(id) || null;
      },
      getSteps(id) {
        return db.prepare("SELECT * FROM transactional_execution_steps WHERE execution_id=? ORDER BY rowid").all(id);
      },
      findStepByIdempotencyKey(key) {
        return db.prepare("SELECT * FROM transactional_execution_steps WHERE idempotency_key=?").get(key) || null;
      },
      listRecoverable() {
        return db.prepare("SELECT * FROM transactional_executions WHERE state IN ('RUNNING','VERIFYING','COMPENSATING') ORDER BY updated_at").all();
      },
        transaction(callback) {
          const ownsTransaction = db.isTransaction !== true;
          const savepoint = ownsTransaction
            ? null
            : `transactional_execution_${crypto.randomUUID().replaceAll("-", "")}`;

          if (ownsTransaction) db.exec("BEGIN IMMEDIATE");
          else db.exec(`SAVEPOINT ${savepoint}`);

          try {
            const result = callback();

            if (ownsTransaction) db.exec("COMMIT");
            else db.exec(`RELEASE SAVEPOINT ${savepoint}`);

            return result;
          } catch (error) {
            if (ownsTransaction) {
              try { db.exec("ROLLBACK"); } catch {}
            } else {
              try { db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`); } catch {}
              try { db.exec(`RELEASE SAVEPOINT ${savepoint}`); } catch {}
            }

            throw error;
          }
        },
    };
  }

  function mutate(callback) {
    const state = wrapper.load();
    state.transactional_executions ||= [];
    state.transactional_execution_steps ||= [];
    const result = callback(state);
    wrapper.save(state);
    return result;
  }
  return {
    saveExecution(record) {
      return mutate((state) => {
        state.transactional_executions = state.transactional_executions.filter((item) => item.execution_id !== record.execution_id);
        state.transactional_executions.push(record);
        return record;
      });
    },
    saveStep(record) {
      return mutate((state) => {
        state.transactional_execution_steps = state.transactional_execution_steps.filter((item) => item.execution_id !== record.execution_id || item.step_id !== record.step_id);
        state.transactional_execution_steps.push(record);
        return record;
      });
    },
    getExecution(id) { return (wrapper.load().transactional_executions || []).find((item) => item.execution_id === id) || null; },
    getSteps(id) { return (wrapper.load().transactional_execution_steps || []).filter((item) => item.execution_id === id); },
    findStepByIdempotencyKey(key) { return (wrapper.load().transactional_execution_steps || []).find((item) => item.idempotency_key === key) || null; },
    listRecoverable() { return (wrapper.load().transactional_executions || []).filter((item) => ["RUNNING", "VERIFYING", "COMPENSATING"].includes(item.state)); },
    transaction(callback) { return callback(); },
  };
}

module.exports = { createTransactionalExecutionRepository };
