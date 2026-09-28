"use strict";

const crypto = require("crypto");

const TASK_DOMAINS = new Set(["GENERAL", "DEV", "RESEARCH", "ARTIFACT"]);
const QUALITY_LEVELS = new Set(["LOW", "NORMAL", "HIGH", "CRITICAL"]);

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function integerOrNull(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function normalizeSample(input = {}) {
  const provider = String(input.provider || "").trim();
  const model = String(input.model || "").trim();

  if (!provider) throw new TypeError("Provider requis.");
  if (!model) throw new TypeError("Modèle requis.");

  return {
    id: input.id || crypto.randomUUID(),
    taskDomain: TASK_DOMAINS.has(input.taskDomain) ? input.taskDomain : "GENERAL",
    requiredQuality: QUALITY_LEVELS.has(input.requiredQuality)
      ? input.requiredQuality
      : "NORMAL",
    provider,
    model,
    success: typeof input.success === "boolean" ? input.success : null,
    failureCategory: input.failureCategory ? String(input.failureCategory).slice(0, 80) : null,
    latencyMs: finiteOrNull(input.latencyMs),
    inputTokens: integerOrNull(input.inputTokens),
    outputTokens: integerOrNull(input.outputTokens),
    actualCost: finiteOrNull(input.actualCost),
    firstPassSuccess:
      typeof input.firstPassSuccess === "boolean" ? input.firstPassSuccess : null,
    fallbackUsed: input.fallbackUsed === true,
    escalationUsed: input.escalationUsed === true,
    createdAt: input.createdAt || new Date().toISOString(),
  };
}

function rowToSample(row) {
  if (!row) return null;
  return {
    id: row.id,
    taskDomain: row.task_domain,
    requiredQuality: row.required_quality,
    provider: row.provider,
    model: row.model,
    success: row.success == null ? null : Boolean(row.success),
    failureCategory: row.failure_category,
    latencyMs: row.latency_ms == null ? null : Number(row.latency_ms),
    inputTokens: row.input_tokens == null ? null : Number(row.input_tokens),
    outputTokens: row.output_tokens == null ? null : Number(row.output_tokens),
    actualCost: row.actual_cost == null ? null : Number(row.actual_cost),
    firstPassSuccess:
      row.first_pass_success == null ? null : Boolean(row.first_pass_success),
    fallbackUsed: Boolean(row.fallback_used),
    escalationUsed: Boolean(row.escalation_used),
    createdAt: row.created_at,
  };
}

function createSqliteRepository(wrapper) {
  const db = wrapper.database;

  function record(input) {
    const sample = normalizeSample(input);

    db.prepare(`INSERT INTO model_performance_samples(
      id,task_domain,required_quality,provider,model,success,failure_category,
      latency_ms,input_tokens,output_tokens,actual_cost,first_pass_success,
      fallback_used,escalation_used,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      sample.id,
      sample.taskDomain,
      sample.requiredQuality,
      sample.provider,
      sample.model,
      sample.success == null ? null : Number(sample.success),
      sample.failureCategory,
      sample.latencyMs,
      sample.inputTokens,
      sample.outputTokens,
      sample.actualCost,
      sample.firstPassSuccess == null ? null : Number(sample.firstPassSuccess),
      Number(sample.fallbackUsed),
      Number(sample.escalationUsed),
      sample.createdAt
    );

    return sample;
  }

  function list(filters = {}) {
    const clauses = [];
    const values = [];

    if (filters.taskDomain) {
      clauses.push("task_domain=?");
      values.push(filters.taskDomain);
    }

    if (filters.requiredQuality) {
      clauses.push("required_quality=?");
      values.push(filters.requiredQuality);
    }

    if (filters.provider) {
      clauses.push("provider=?");
      values.push(filters.provider);
    }

    if (filters.model) {
      clauses.push("model=?");
      values.push(filters.model);
    }

    if (filters.since) {
      clauses.push("created_at>=?");
      values.push(filters.since);
    }

    return db.prepare(`SELECT * FROM model_performance_samples
      ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
      ORDER BY created_at DESC
      LIMIT ?`)
      .all(...values, Math.min(5000, Number(filters.limit) || 500))
      .map(rowToSample);
  }

  return {
    kind: "sqlite",
    record,
    list,
  };
}

function createFallbackRepository(wrapper) {
  const load = () => wrapper.load();
  const save = (state) => wrapper.save(state);

  function record(input) {
    const sample = normalizeSample(input);
    const state = load();
    state.model_performance_samples ||= [];
    state.model_performance_samples.push(sample);
    save(state);
    return sample;
  }

  function list(filters = {}) {
    return (load().model_performance_samples || [])
      .filter((item) =>
        (!filters.taskDomain || item.taskDomain === filters.taskDomain) &&
        (!filters.requiredQuality || item.requiredQuality === filters.requiredQuality) &&
        (!filters.provider || item.provider === filters.provider) &&
        (!filters.model || item.model === filters.model) &&
        (!filters.since || item.createdAt >= filters.since)
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, Math.min(5000, Number(filters.limit) || 500));
  }

  return {
    kind: "json-fallback",
    record,
    list,
  };
}

function createModelPerformanceRepository(wrapper) {
  if (!wrapper) throw new TypeError("Database wrapper requis.");
  return wrapper.kind === "sqlite"
    ? createSqliteRepository(wrapper)
    : createFallbackRepository(wrapper);
}

module.exports = {
  createModelPerformanceRepository,
  normalizeSample,
};
