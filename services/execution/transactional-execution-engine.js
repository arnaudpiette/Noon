"use strict";

const crypto = require("crypto");
const { sanitizeAuditDetails } = require("../security/redaction");

const EXECUTION_PLAN_VERSION = "transactional-execution-v1";
const EXECUTION_STATES = Object.freeze({
  PLANNED: "PLANNED", VALIDATING: "VALIDATING", AWAITING_APPROVAL: "AWAITING_APPROVAL",
  READY: "READY", RUNNING: "RUNNING", VERIFYING: "VERIFYING", SUCCEEDED: "SUCCEEDED",
  PARTIAL: "PARTIAL", FAILED: "FAILED", UNKNOWN_OUTCOME: "UNKNOWN_OUTCOME",
  INTERRUPTED: "INTERRUPTED", COMPENSATING: "COMPENSATING", COMPENSATED: "COMPENSATED",
  CANCELLED: "CANCELLED",
});
const STEP_STATES = Object.freeze({
  PENDING: "PENDING", READY: "READY", RUNNING: "RUNNING", APPLIED: "APPLIED",
  VERIFYING: "VERIFYING", SUCCEEDED: "SUCCEEDED", FAILED: "FAILED",
  UNKNOWN_OUTCOME: "UNKNOWN_OUTCOME", SKIPPED: "SKIPPED",
  SKIPPED_DEPENDENCY: "SKIPPED_DEPENDENCY", COMPENSATED: "COMPENSATED",
});
const VERIFICATION_LEVELS = Object.freeze({ NONE: "NONE", BASIC: "BASIC", STRONG: "STRONG" });
const FAILURE_POLICIES = Object.freeze({ STOP: "STOP", CONTINUE_INDEPENDENT: "CONTINUE_INDEPENDENT", RETURN_PARTIAL: "RETURN_PARTIAL", COMPENSATE: "COMPENSATE" });
const TERMINAL_EXECUTIONS = new Set(["SUCCEEDED", "PARTIAL", "FAILED", "UNKNOWN_OUTCOME", "INTERRUPTED", "COMPENSATED", "CANCELLED"]);
const MUTATING_CLASSES = new Set(["WRITE", "EXECUTE", "DESTRUCTIVE"]);
const TRANSITIONS = Object.freeze({
  PLANNED: ["VALIDATING", "CANCELLED", "INTERRUPTED"],
  VALIDATING: ["AWAITING_APPROVAL", "READY", "FAILED", "CANCELLED"],
  AWAITING_APPROVAL: ["READY", "FAILED", "CANCELLED", "INTERRUPTED"],
  READY: ["RUNNING", "CANCELLED", "FAILED"],
  RUNNING: ["VERIFYING", "PARTIAL", "FAILED", "UNKNOWN_OUTCOME", "INTERRUPTED", "COMPENSATING", "CANCELLED"],
  VERIFYING: ["SUCCEEDED", "PARTIAL", "FAILED", "UNKNOWN_OUTCOME", "COMPENSATING", "INTERRUPTED"],
  COMPENSATING: ["COMPENSATED", "PARTIAL", "FAILED", "INTERRUPTED"],
});

class ExecutionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ExecutionError";
    this.code = code;
    this.details = details;
  }
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function hash(value) { return crypto.createHash("sha256").update(stableStringify(value)).digest("hex"); }
function time(now) { return new Date(now()).toISOString(); }
function safeRef(value) {
  if (value == null) return null;
  const candidate = value.providerRef || value.id || value.messageId || value.eventId || value.artifactId || value.path || null;
  return candidate == null ? null : `ref_${hash(String(candidate)).slice(0, 24)}`;
}
function normalizeResult(value) {
  if (value && typeof value === "object" && Object.hasOwn(value, "ok")) {
    return { ok: value.ok === true, result: value.result ?? value.data ?? value, providerRef: value.providerRef || null, verificationHints: value.verificationHints || {}, changedTargets: Array.isArray(value.changedTargets) ? value.changedTargets : [], warnings: Array.isArray(value.warnings) ? value.warnings : [] };
  }
  return { ok: true, result: value, providerRef: value?.providerRef || value?.id || null, verificationHints: {}, changedTargets: [], warnings: [] };
}

function validateArgs(schema, args) {
  if (!schema || schema.type !== "object") return true;
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new ExecutionError("INVALID_ARGS", "Arguments d'étape invalides.");
  for (const key of schema.required || []) if (!Object.hasOwn(args, key)) throw new ExecutionError("INVALID_ARGS", `Argument obligatoire absent : ${key}.`);
  if (schema.additionalProperties === false) for (const key of Object.keys(args)) if (!Object.hasOwn(schema.properties || {}, key)) throw new ExecutionError("INVALID_ARGS", `Argument inconnu : ${key}.`);
  return true;
}

function validatePlan(plan, skillRegistry, maxSteps) {
  if (!plan || !Array.isArray(plan.steps) || plan.steps.length === 0) throw new ExecutionError("PLAN_EMPTY", "Le plan d'exécution est vide.");
  if (plan.steps.length > maxSteps) throw new ExecutionError("TOO_MANY_STEPS", "Le plan dépasse la limite d'étapes.");
  const ids = new Set();
  for (const step of plan.steps) {
    if (!step.stepId || ids.has(step.stepId)) throw new ExecutionError("DUPLICATE_STEP_ID", "Les identifiants d'étape doivent être uniques.");
    ids.add(step.stepId);
    const skill = skillRegistry?.getSkillByName?.(step.skillId);
    if (!skill) throw new ExecutionError("UNKNOWN_SKILL", `Skill inconnu : ${step.skillId}.`);
    validateArgs(skill.definition?.parameters, step.args);
  }
  const visiting = new Set(); const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) throw new ExecutionError("PLAN_CYCLE", "Le plan contient une dépendance cyclique.");
    if (visited.has(id)) return;
    visiting.add(id);
    const step = plan.steps.find((item) => item.stepId === id);
    for (const dependency of step.dependencies || []) {
      if (!ids.has(dependency)) throw new ExecutionError("UNKNOWN_DEPENDENCY", `Dépendance inconnue : ${dependency}.`);
      visit(dependency);
    }
    visiting.delete(id); visited.add(id);
  }
  for (const id of ids) visit(id);
  return true;
}

function createTransactionalExecutionEngine({
  repository, skillRegistry, reliabilityEngine = null, observability = null,
  now = () => Date.now(), maxSteps = 20, maxWallTimeMs = 120_000,
} = {}) {
  if (!repository?.saveExecution || !repository?.saveStep) throw new TypeError("Journal transactionnel requis.");
  if (!skillRegistry?.getSkillByName) throw new TypeError("Skill Registry requis.");
  const inFlight = new Map(); const cancellations = new Set();
  const emit = (event, metadata = {}) => { try { observability?.(event, sanitizeAuditDetails(metadata)); } catch {} };

  function createPlan(request = {}) {
    const requestedAt = request.requestedAt || time(now);
    const rawSteps = request.steps || [request.step].filter(Boolean);
    const steps = rawSteps.map((step, index) => {
      const args = step.args && typeof step.args === "object" ? step.args : {};
      const argsFingerprint = hash(args);
      const stepId = String(step.stepId || `step-${index + 1}`);
      return Object.freeze({
        stepId, skillId: String(step.skillId), operation: String(step.operation || step.skillId), args,
        argsFingerprint, dependencies: Object.freeze([...(step.dependencies || [])]),
        preconditions: Object.freeze([...(step.preconditions || [])]),
        idempotencyKey: String(step.idempotencyKey || hash({ executionId: request.executionId, stepId, skillId: step.skillId, operation: step.operation || step.skillId, argsFingerprint })),
        expectedOutcome: step.expectedOutcome || null,
        verification: step.verification || null,
        verificationLevel: step.verificationLevel || (MUTATING_CLASSES.has(step.actionClass) ? VERIFICATION_LEVELS.BASIC : VERIFICATION_LEVELS.NONE),
        compensation: step.compensation || null,
        timeoutPolicy: step.timeoutPolicy || null, retryPolicy: step.retryPolicy || null,
        actionClass: step.actionClass || "READ", state: STEP_STATES.PENDING,
      });
    });
    const fingerprint = hash({ executionId: request.executionId, intentId: request.intentId || null, steps: steps.map((step) => ({ stepId: step.stepId, skillId: step.skillId, operation: step.operation, argsFingerprint: step.argsFingerprint, dependencies: step.dependencies, idempotencyKey: step.idempotencyKey, actionClass: step.actionClass })), failurePolicy: request.failurePolicy || FAILURE_POLICIES.STOP });
    const plan = Object.freeze({
      executionId: String(request.executionId || `execution_${crypto.randomUUID()}`), intentId: request.intentId || null,
      executionVersion: EXECUTION_PLAN_VERSION, steps: Object.freeze(steps), dependencies: Object.freeze(steps.flatMap((step) => step.dependencies.map((dependency) => [dependency, step.stepId]))),
      atomicity: request.atomicity || "best_effort", failurePolicy: request.failurePolicy || FAILURE_POLICIES.STOP,
      planFingerprint: fingerprint, createdAt: requestedAt,
    });
    validatePlan(plan, skillRegistry, maxSteps);
    return plan;
  }

  function executionRecord(request, plan) {
    const timestamp = time(now);
    return {
      execution_id: plan.executionId, intent_id: plan.intentId, plan_version: plan.executionVersion,
      plan_fingerprint: plan.planFingerprint, action_fingerprint: request.actionRequest?.actionFingerprint || null,
      policy_version: request.policyDecision?.policyVersion || null, approval_id: request.approvalRef?.approvalId || request.approvalRef?.id || null,
      state: EXECUTION_STATES.PLANNED, failure_policy: plan.failurePolicy, atomicity: plan.atomicity,
      workspace_id: request.workspaceId || null, project_id: request.projectId || null,
      profile_scope: request.profileScope || "arnaud", session_id: request.sessionId || null,
      conversation_id: request.conversationId || null, reason_code: null, safe_result_json: null,
      requested_at: request.requestedAt || timestamp, created_at: timestamp, started_at: null,
      completed_at: null, updated_at: timestamp,
    };
  }
  function stepRecord(plan, step) {
    return { execution_id: plan.executionId, step_id: step.stepId, skill_id: step.skillId, operation: step.operation, args_fingerprint: step.argsFingerprint, idempotency_key: step.idempotencyKey, dependencies_json: JSON.stringify(step.dependencies), action_class: step.actionClass, state: STEP_STATES.PENDING, verification_level: step.verificationLevel, verification_state: null, result_ref: null, provider_ref_hash: null, reason_code: null, attempt_count: 0, started_at: null, applied_at: null, verified_at: null, completed_at: null, updated_at: time(now) };
  }
  function transition(record, next, reasonCode = null) {
    if (record.state !== next && !(TRANSITIONS[record.state] || []).includes(next)) throw new ExecutionError("INVALID_STATE_TRANSITION", `Transition interdite : ${record.state} → ${next}.`);
    record.state = next; record.reason_code = reasonCode; record.updated_at = time(now);
    if (next === EXECUTION_STATES.RUNNING && !record.started_at) record.started_at = record.updated_at;
    if (TERMINAL_EXECUTIONS.has(next)) record.completed_at = record.updated_at;
    repository.saveExecution(record); return record;
  }
  function saveStep(record, patch = {}) { Object.assign(record, patch, { updated_at: time(now) }); repository.saveStep(record); return record; }

  async function verifyStep(step, envelope, context) {
    const started = now();
    if (step.verificationLevel === VERIFICATION_LEVELS.NONE) return { verified: true, level: "NONE", reasonCode: "NOT_REQUIRED", durationMs: now() - started };
    try {
      const result = typeof step.verification === "function"
        ? await step.verification(envelope, context)
        : { verified: envelope.ok === true, reasonCode: envelope.ok ? "PROVIDER_RESPONSE_ACCEPTED" : "PROVIDER_RESPONSE_INVALID" };
      return { verified: result === true || result?.verified === true, level: step.verificationLevel, reasonCode: result?.reasonCode || (result === true ? "VERIFIED" : "VERIFICATION_FAILED"), durationMs: now() - started };
    } catch (error) { return { verified: false, unknown: true, level: step.verificationLevel, reasonCode: String(error.code || "VERIFICATION_ERROR").slice(0, 80), durationMs: now() - started }; }
  }

  async function compensate(completed, request, record, result) {
    transition(record, EXECUTION_STATES.COMPENSATING);
    emit("execution_compensation_started", { executionId: record.execution_id, stepCount: completed.length });
    for (const item of [...completed].reverse()) {
      const compensation = item.step.compensation;
      if (!compensation?.autoSafe || compensation.targetCreatedByExecution !== true || typeof compensation.execute !== "function") continue;
      try {
        const allowed = await request.revalidate?.({ step: item.step, compensation: true, result: item.envelope });
        if (allowed === false || ["DENY", "UNAVAILABLE", "REQUIRE_APPROVAL"].includes(allowed?.outcome)) continue;
        await compensation.execute(item.envelope, request.context || {});
        saveStep(item.record, { state: STEP_STATES.COMPENSATED, completed_at: time(now) });
        result.compensatedSteps.push(item.step.stepId);
        emit("execution_compensation_completed", { executionId: record.execution_id, stepId: item.step.stepId });
      } catch (error) {
        result.pendingRecovery.push(item.step.stepId);
        emit("execution_compensation_failed", { executionId: record.execution_id, stepId: item.step.stepId, reasonCode: String(error.code || "COMPENSATION_FAILED").slice(0, 80) });
      }
    }
  }

  async function run(request, plan) {
    const totalStarted = now();
    let record = repository.getExecution(plan.executionId);
    if (record) {
      if (record.profile_scope !== (request.profileScope || "arnaud") || (record.workspace_id || null) !== (request.workspaceId || null)) throw new ExecutionError("EXECUTION_SCOPE_MISMATCH", "Cette exécution appartient à un autre profil ou workspace.");
      if (record.plan_fingerprint !== plan.planFingerprint) throw new ExecutionError("EXECUTION_PLAN_CHANGED", "Le plan associé à cette exécution a changé.");
      if (TERMINAL_EXECUTIONS.has(record.state)) {
        emit("execution_duplicate_suppressed", { executionId: plan.executionId, state: record.state });
        return { ...JSON.parse(record.safe_result_json || "{}"), status: record.state, executionId: plan.executionId, duplicate: true };
      }
      throw new ExecutionError("EXECUTION_ALREADY_ACTIVE", "Cette exécution est déjà active ou nécessite une récupération.");
    }
    record = executionRecord(request, plan);
    try {
      repository.transaction(() => { repository.saveExecution(record); for (const step of plan.steps) repository.saveStep(stepRecord(plan, step)); });
    } catch (error) { throw new ExecutionError("EXECUTION_JOURNAL_UNAVAILABLE", "Le journal critique ne peut pas être écrit.", { cause: error.code }); }
    emit("execution_created", { executionId: plan.executionId, stepCount: plan.steps.length, planVersion: plan.executionVersion });
    transition(record, EXECUTION_STATES.VALIDATING);
    const result = { status: null, executionId: plan.executionId, succeededSteps: [], failedSteps: [], compensatedSteps: [], skippedSteps: [], pendingRecovery: [], warnings: [], result: null, metrics: { validationMs: 0, policyRecheckMs: 0, toolExecutionMs: 0, verificationMs: 0, compensationMs: 0, totalExecutionMs: 0 } };
    const validationStarted = now();
    if (request.approvalRequired && !request.approvalRef?.valid) { transition(record, EXECUTION_STATES.AWAITING_APPROVAL, "APPROVAL_REQUIRED"); result.status = record.state; return result; }
    result.metrics.validationMs = now() - validationStarted;
    transition(record, EXECUTION_STATES.READY); transition(record, EXECUTION_STATES.RUNNING);
    emit("execution_started", { executionId: plan.executionId, stepCount: plan.steps.length });
    const completed = []; const stepRecords = new Map(repository.getSteps(plan.executionId).map((item) => [item.step_id, item]));
    for (const step of plan.steps) {
      if (now() - totalStarted > Math.min(maxWallTimeMs, request.overallDeadlineMs || maxWallTimeMs)) { result.failedSteps.push(step.stepId); saveStep(stepRecords.get(step.stepId), { state: STEP_STATES.FAILED, reason_code: "EXECUTION_DEADLINE" }); break; }
      if (cancellations.has(plan.executionId)) { saveStep(stepRecords.get(step.stepId), { state: STEP_STATES.SKIPPED, reason_code: "CANCELLED" }); result.skippedSteps.push(step.stepId); continue; }
      const dependencyFailed = step.dependencies.some((id) => !result.succeededSteps.includes(id));
      if (dependencyFailed) { saveStep(stepRecords.get(step.stepId), { state: STEP_STATES.SKIPPED_DEPENDENCY, reason_code: "FAILED_DEPENDENCY" }); result.skippedSteps.push(step.stepId); continue; }
      const stepRow = stepRecords.get(step.stepId);
      const hit = repository.findStepByIdempotencyKey(step.idempotencyKey);
      if (hit && hit.execution_id !== plan.executionId && hit.state === STEP_STATES.SUCCEEDED) {
        saveStep(stepRow, { state: STEP_STATES.SUCCEEDED, result_ref: hit.result_ref, verification_state: hit.verification_state, completed_at: time(now) });
        result.succeededSteps.push(step.stepId); emit("execution_idempotency_hit", { executionId: plan.executionId, stepId: step.stepId }); continue;
      }
      try {
        const policyStarted = now();
        const recheck = await request.revalidate?.({ step, executionId: plan.executionId, approvalRef: request.approvalRef });
        result.metrics.policyRecheckMs += now() - policyStarted;
        if (recheck === false || ["DENY", "UNAVAILABLE", "REQUIRE_APPROVAL"].includes(recheck?.outcome)) throw new ExecutionError("JUST_IN_TIME_AUTHORIZATION_FAILED", "L'action n'est plus autorisée au moment de l'exécution.");
        const preconditions = typeof request.checkPreconditions === "function" ? await request.checkPreconditions(step) : { valid: true };
        if (preconditions === false || preconditions?.valid === false) throw new ExecutionError("STALE_PRECONDITION", "Les préconditions de l'action ont changé.");
        saveStep(stepRow, { state: STEP_STATES.READY });
        saveStep(stepRow, { state: STEP_STATES.RUNNING, started_at: time(now), attempt_count: stepRow.attempt_count + 1 });
        emit("execution_step_started", { executionId: plan.executionId, stepId: step.stepId, skillId: step.skillId, actionClass: step.actionClass });
        const executeStarted = now();
        let raw;
        const operation = () => request.executeStep(step, { executionId: plan.executionId, idempotencyKey: step.idempotencyKey, cancellationRequested: () => cancellations.has(plan.executionId) });
        if (reliabilityEngine && request.componentId) {
          const safeRetry = step.actionClass === "READ" || request.idempotent === true;
          const wrapped = await reliabilityEngine.execute(request.componentId, operation, { idempotent: safeRetry, destructive: step.actionClass === "DESTRUCTIVE", unknownOutcome: MUTATING_CLASSES.has(step.actionClass) && !safeRetry, maxRetries: step.retryPolicy?.maxRetries, executionId: plan.executionId });
          raw = wrapped.data;
        } else raw = await operation();
        result.metrics.toolExecutionMs += now() - executeStarted;
        const envelope = normalizeResult(raw);
        if (!envelope.ok) throw new ExecutionError("TOOL_RESULT_INVALID", "Le skill n'a pas confirmé son résultat.");
        saveStep(stepRow, { state: STEP_STATES.APPLIED, applied_at: time(now), result_ref: safeRef(envelope.result), provider_ref_hash: envelope.providerRef ? hash(envelope.providerRef) : null });
        emit("execution_step_applied", { executionId: plan.executionId, stepId: step.stepId, resultRef: stepRow.result_ref });
        const verificationStarted = now();
        saveStep(stepRow, { state: STEP_STATES.VERIFYING });
        const verification = await verifyStep(step, envelope, { request, plan, step });
        result.metrics.verificationMs += now() - verificationStarted;
        emit("execution_verification_ms", { executionId: plan.executionId, stepId: step.stepId, value: verification.durationMs });
        if (!verification.verified) {
          saveStep(stepRow, { state: verification.unknown ? STEP_STATES.UNKNOWN_OUTCOME : STEP_STATES.FAILED, verification_state: verification.reasonCode, reason_code: verification.reasonCode });
          if (verification.unknown && MUTATING_CLASSES.has(step.actionClass)) { result.pendingRecovery.push(step.stepId); emit("execution_unknown_outcome", { executionId: plan.executionId, stepId: step.stepId }); }
          else emit("execution_verification_failed", { executionId: plan.executionId, stepId: step.stepId, reasonCode: verification.reasonCode });
          result.failedSteps.push(step.stepId); break;
        }
        saveStep(stepRow, { state: STEP_STATES.SUCCEEDED, verification_state: verification.reasonCode, verified_at: time(now), completed_at: time(now) });
        result.succeededSteps.push(step.stepId); result.result = envelope.result; completed.push({ step, record: stepRow, envelope });
        emit("execution_step_verified", { executionId: plan.executionId, stepId: step.stepId, verificationLevel: verification.level });
      } catch (error) {
        const unknown = error?.normalized?.category === "UNKNOWN_OUTCOME" || error.code === "UNKNOWN_OUTCOME";
        saveStep(stepRow, { state: unknown ? STEP_STATES.UNKNOWN_OUTCOME : STEP_STATES.FAILED, reason_code: String(error.code || "EXECUTION_FAILED").slice(0, 80), completed_at: time(now) });
        result.failedSteps.push(step.stepId);
        if (unknown) { result.pendingRecovery.push(step.stepId); emit("execution_unknown_outcome", { executionId: plan.executionId, stepId: step.stepId }); }
        emit("execution_step_failed", { executionId: plan.executionId, stepId: step.stepId, reasonCode: String(error.code || "EXECUTION_FAILED").slice(0, 80) });
        if (plan.failurePolicy === FAILURE_POLICIES.COMPENSATE) { const started = now(); await compensate(completed, request, record, result); result.metrics.compensationMs += now() - started; }
        if (![FAILURE_POLICIES.CONTINUE_INDEPENDENT, FAILURE_POLICIES.RETURN_PARTIAL].includes(plan.failurePolicy)) break;
      }
    }
    if (record.state === EXECUTION_STATES.RUNNING && result.failedSteps.length === 0 && result.skippedSteps.length === 0 && result.pendingRecovery.length === 0) {
      transition(record, EXECUTION_STATES.VERIFYING);
    }
    let finalState;
    if (cancellations.has(plan.executionId) && result.succeededSteps.length === 0) finalState = EXECUTION_STATES.CANCELLED;
    else if (record.state === EXECUTION_STATES.COMPENSATING && completed.length > 0 && result.compensatedSteps.length === completed.length) finalState = EXECUTION_STATES.COMPENSATED;
    else if (record.state === EXECUTION_STATES.COMPENSATING) finalState = EXECUTION_STATES.PARTIAL;
    else if (result.pendingRecovery.length) finalState = EXECUTION_STATES.UNKNOWN_OUTCOME;
    else if (result.failedSteps.length || result.skippedSteps.length) finalState = result.succeededSteps.length ? EXECUTION_STATES.PARTIAL : EXECUTION_STATES.FAILED;
    else finalState = EXECUTION_STATES.SUCCEEDED;
    if (record.state !== finalState) transition(record, finalState, result.failedSteps.length ? "STEP_FAILURE" : null);
    result.status = finalState; result.metrics.totalExecutionMs = now() - totalStarted;
    const safeResult = { status: result.status, executionId: result.executionId, succeededSteps: result.succeededSteps, failedSteps: result.failedSteps, compensatedSteps: result.compensatedSteps, skippedSteps: result.skippedSteps, pendingRecovery: result.pendingRecovery, metrics: result.metrics };
    record.safe_result_json = JSON.stringify(safeResult); repository.saveExecution(record);
    emit(finalState === "SUCCEEDED" ? "execution_completed" : finalState === "PARTIAL" ? "execution_partial" : "execution_interrupted", { executionId: plan.executionId, status: finalState, succeededCount: result.succeededSteps.length, failedCount: result.failedSteps.length, totalExecutionMs: result.metrics.totalExecutionMs });
    return result;
  }

  async function execute(request = {}) {
    const plan = request.plan || createPlan(request);
    if (inFlight.has(plan.executionId)) { emit("execution_duplicate_suppressed", { executionId: plan.executionId, state: "IN_FLIGHT" }); return inFlight.get(plan.executionId); }
    const promise = run(request, plan); inFlight.set(plan.executionId, promise);
    try { return await promise; } finally { inFlight.delete(plan.executionId); cancellations.delete(plan.executionId); }
  }
  async function executeSingleStep(request = {}) { return execute({ ...request, steps: [request.step] }); }
  function cancel(executionId) {
    const record = repository.getExecution(executionId);
    if (!record || TERMINAL_EXECUTIONS.has(record.state)) return { cancelled: false, reason: "TOO_LATE" };
    cancellations.add(executionId); return { cancelled: true, executionId };
  }
  function recoverInterrupted() {
    const recovered = [];
    for (const record of repository.listRecoverable()) {
      const steps = repository.getSteps(record.execution_id);
      for (const step of steps) if ([STEP_STATES.RUNNING, STEP_STATES.APPLIED, STEP_STATES.VERIFYING].includes(step.state)) repository.saveStep({ ...step, state: step.state === STEP_STATES.RUNNING ? STEP_STATES.UNKNOWN_OUTCOME : STEP_STATES.UNKNOWN_OUTCOME, reason_code: "PROCESS_RESTARTED", updated_at: time(now) });
      record.state = EXECUTION_STATES.INTERRUPTED; record.reason_code = "PROCESS_RESTARTED"; record.completed_at = time(now); record.updated_at = record.completed_at; repository.saveExecution(record);
      recovered.push(record.execution_id); emit("execution_recovered", { executionId: record.execution_id, state: "INTERRUPTED" }); emit("execution_resume_suppressed", { executionId: record.execution_id });
    }
    return recovered;
  }

  return { createPlan, validatePlan: (plan) => validatePlan(plan, skillRegistry, maxSteps), execute, executeSingleStep, cancel, recoverInterrupted, get: (id) => ({ execution: repository.getExecution(id), steps: repository.getSteps(id) }), states: EXECUTION_STATES, stepStates: STEP_STATES, verificationLevels: VERIFICATION_LEVELS, failurePolicies: FAILURE_POLICIES, version: () => EXECUTION_PLAN_VERSION };
}

module.exports = { EXECUTION_PLAN_VERSION, EXECUTION_STATES, STEP_STATES, VERIFICATION_LEVELS, FAILURE_POLICIES, ExecutionError, createTransactionalExecutionEngine, validatePlan };
