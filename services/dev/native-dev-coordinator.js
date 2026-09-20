"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const { createDevTaskContract } = require("../delegation/dev-task-contract");
const { changedSince, reviewDiff } = require("../delegation/dev-delegation-runner");
const { repositoryPreflight, snapshotRepository } = require("../delegation/repository-preflight");
const { CONTENT_SECRET, applyOperation, readText, resolveFile, runSafeCommand, searchRepository } = require("./native-repository-tools");

const FINAL_STATES = new Set(["PASS", "PARTIAL", "FAIL", "CANCELLED", "TIMEOUT"]);
const ALLOWED_PHASES = new Set(["PLAN", "EDIT", "DIAGNOSE", "REPAIR"]);

function safeError(error, fallback = "TASK_FAILURE") {
  return { code: String(error?.code || fallback).slice(0, 80), message: String(error?.message || "Échec de la tâche DEV.").slice(0, 240) };
}
function normalizeReasoning(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Object.assign(new Error("Réponse DEV mal formée."), { code: "MALFORMED_PROVIDER_RESPONSE" });
  const files = Array.isArray(value.files) ? value.files.map(String).slice(0, 30) : [];
  const searchTerms = Array.isArray(value.searchTerms) ? value.searchTerms.map(String).filter(Boolean).slice(0, 12) : [];
  const operations = Array.isArray(value.operations) ? value.operations.slice(0, 20) : [];
  const validationCommands = Array.isArray(value.validationCommands) ? value.validationCommands.map(String).slice(0, 12) : [];
  const providerMetrics = value.providerMetrics && typeof value.providerMetrics === "object" ? {
    provider: String(value.providerMetrics.provider || "unknown").slice(0, 40), model: String(value.providerMetrics.model || "unknown").slice(0, 100),
    latencyMs: Math.max(0, Number(value.providerMetrics.latencyMs) || 0), usage: value.providerMetrics.usage && typeof value.providerMetrics.usage === "object" ? value.providerMetrics.usage : null,
    estimatedCost: value.providerMetrics.estimatedCost != null && Number.isFinite(Number(value.providerMetrics.estimatedCost)) ? Number(value.providerMetrics.estimatedCost) : null,
    actualCost: value.providerMetrics.actualCost != null && Number.isFinite(Number(value.providerMetrics.actualCost)) ? Number(value.providerMetrics.actualCost) : null,
    routeReasonCodes: Array.isArray(value.providerMetrics.routeReasonCodes) ? value.providerMetrics.routeReasonCodes.map(String).slice(0, 20) : [],
    reservationId: value.providerMetrics.reservationId ? String(value.providerMetrics.reservationId).slice(0, 160) : null,
    budgetBefore: value.providerMetrics.budgetBefore || null, budgetAfter: value.providerMetrics.budgetAfter || null,
  } : null;
  return { summary: String(value.summary || "").slice(0, 2000), files, searchTerms, operations, validationCommands, providerMetrics };
}
function workspaceInput(workspaceEngine, input) {
  if (input.workspaceAuthorized === true && Array.isArray(input.workspaceRoots) && input.workspaceRoots.length) return input;
  const workspace = workspaceEngine.context(input.workspaceId);
  const roots = (workspace.relevantRoots || workspace.roots || []).filter((item) => item.mode === "read-write").map((item) => item.path);
  return { ...input, workspaceAuthorized: roots.length > 0, workspaceRoots: roots };
}
function unique(items) { return [...new Set(items.filter(Boolean))]; }
function isBlockingValidationFailure(result = {}) {
  if (result.status === "PASS") return false;
  // Une commande optionnelle proposée par le modèle reste une donnée non fiable :
  // son refus par l'allowlist prouve que la sécurité fonctionne, pas que le patch est faux.
  return result.failureCategory !== "COMMAND_NOT_ALLOWLISTED";
}

function createNativeDevCoordinator({
  workspaceEngine, transactionalExecutionEngine, operationalSecurityPolicy, skillRegistry, reasoner, journal,
  featureMode = () => "OFF", qualityEscalationMode = () => "OFF", sameTierRepairAttempts = () => 2, observability = null, now = () => Date.now(), validationRunner = runSafeCommand,
} = {}) {
  if (!workspaceEngine?.context) throw new TypeError("WorkspaceEngine requis.");
  if (!transactionalExecutionEngine?.execute) throw new TypeError("TransactionalExecutionEngine requis.");
  if (!operationalSecurityPolicy?.evaluate) throw new TypeError("OperationalSecurityPolicy requise.");
  if (!skillRegistry?.executeSkill) throw new TypeError("SkillRegistry requis.");
  if (!reasoner?.reason) throw new TypeError("Reasoner DEV requis.");
  if (!journal?.start) throw new TypeError("Journal DEV requis.");
  const controllers = new Map(); const results = new Map();
  const emit = (event, metadata = {}) => { try { observability?.(event, metadata); } catch {} };

  function authorize(contract, step, actionClass, taskId = null) {
    const actionRequest = {
      origin: "explicit_user_chat", skillId: step.skillId, operation: actionClass === "WRITE" ? "update local file" : "read validate local repository",
      args: { path: contract.repositoryRoot }, workspaceId: contract.workspaceId, explicitOrder: true, actionClass,
      target: { scope: "LOCAL", scopeName: "workspace", targetType: actionClass === "WRITE" ? "file" : "repository", targetCount: 1 },
    };
    const benchmarkScope = contract.benchmark ? { authorizedRoots: [contract.repositoryRoot], authorizedWriteRoots: [contract.repositoryRoot] } : {};
    const scopeTelemetry = contract.benchmark ? { benchmark: true, sessionId: contract.benchmark.id, runId: taskId, workspaceRoot: contract.repositoryRoot } : null;
    const decision = operationalSecurityPolicy.evaluate({ actionRequest, skillPolicy: { level: actionClass === "WRITE" ? "write" : "read" }, currentPermissions: { allowed: true, code: actionClass === "WRITE" ? "READ_WRITE_WORKSPACE" : "TERMINAL_SAFE" }, ...(scopeTelemetry ? { scopeTelemetry } : {}), ...benchmarkScope });
    if (!["ALLOW", "ALLOW_WITH_CONSTRAINTS"].includes(decision.outcome)) throw Object.assign(new Error("Action DEV refusée par la politique de sécurité."), { code: "PERMISSION_FAILURE" });
    return { actionRequest, decision };
  }

  async function executeSkill(contract, taskId, step, actionClass, handlers) {
    const { actionRequest, decision } = authorize(contract, step, actionClass, taskId);
    const executionId = `${taskId}-${step.skillId}-${crypto.randomUUID()}`;
    const outcome = await transactionalExecutionEngine.execute({
      executionId, workspaceId: contract.workspaceId, profileScope: "arnaud", actionRequest, policyDecision: decision,
      steps: [{ ...step, stepId: "step-1", actionClass, verificationLevel: "BASIC" }],
      executeStep: (planned) => skillRegistry.executeSkill(planned.skillId, planned.args, {
        explicitOrder: true, confirmed: true, allowedRoots: contract.allowedPaths, allowedWriteRoots: contract.allowedPaths,
        sessionId: taskId, handlers,
      }),
      revalidate: () => authorize(contract, step, actionClass, taskId).decision,
      checkPreconditions: () => ({ valid: true }),
    });
    if (outcome.status !== "SUCCEEDED") throw Object.assign(new Error("Étape transactionnelle DEV incomplète."), { code: `TRANSACTION_${outcome.status}` });
    return outcome.result;
  }

  async function validate(contract, taskId, command, iteration, signal) {
    const step = { skillId: "noon_dev_run_validation", operation: "validate repository", args: { command, iteration } };
    const result = await executeSkill(contract, taskId, step, "READ", { runValidation: async () => validationRunner(command, contract.repositoryRoot, Math.min(contract.maxDuration, 120_000), signal) });
    journal.recordCommand(taskId, result, iteration); return result;
  }

  function inspect(contract, taskId, requestedFiles, searchTerms, snapshots) {
    const searched = searchTerms.length ? searchRepository(contract, searchTerms) : [];
    for (const file of unique([...requestedFiles, ...searched]).slice(0, 40)) {
      try {
        const item = readText(contract, file);
        snapshots.set(item.relative, item); journal.recordRead(taskId, item.relative, item.hash);
      } catch (error) {
        if (!["FILE_UNAVAILABLE", "BINARY_FILE_DENIED"].includes(error.code)) throw error;
      }
    }
    return searched;
  }

  function modelFiles(snapshots) {
    return [...snapshots.values()].map((item) => CONTENT_SECRET.test(item.content)
      ? { path: item.relative, hash: item.hash, content: null, omitted: "SENSITIVE_CONTENT" }
      : { path: item.relative, hash: item.hash, content: item.content.slice(0, 80_000), omitted: item.content.length > 80_000 ? "TRUNCATED" : null });
  }

  async function applyEdits(contract, taskId, operations, snapshots, iteration) {
    const changed = [];
    for (const raw of operations) {
      const operation = { type: raw.type, path: String(raw.path || ""), expectedHash: raw.expectedHash ?? null, search: raw.search ?? null, replacement: raw.replacement ?? null, content: raw.content ?? null, iteration };
      resolveFile(contract, operation.path);
      const executionOperation = { ...operation, path: path.resolve(contract.repositoryRoot, operation.path) };
      const step = { skillId: "noon_dev_apply_edit", operation: "update local file", args: executionOperation };
      try {
        const applied = await executeSkill(contract, taskId, step, "WRITE", { applyEdit: (args) => applyOperation(contract, args, snapshots) });
        journal.recordFileOperation(taskId, { ...operation, status: "APPLIED", preHash: applied.preHash, postHash: applied.postHash });
        changed.push(applied.path);
        if (applied.hash) snapshots.set(applied.path, readText(contract, applied.path));
      } catch (error) {
        journal.recordFileOperation(taskId, { ...operation, status: safeError(error).code }); throw error;
      }
    }
    return changed;
  }

  async function runTask(input = {}) {
    const started = now(); let contract; let preflight; let taskId = input.taskId || null; let controller; let backendReached = false;
    try {
      const mode = String(typeof featureMode === "function" ? featureMode(input) : featureMode);
      if (mode !== "LIMITED") throw Object.assign(new Error("Noon Dev Core est désactivé."), { code: "FEATURE_DISABLED" });
      contract = createDevTaskContract(workspaceInput(workspaceEngine, input)); taskId = contract.taskId;
      controller = new AbortController(); controllers.set(taskId, controller);
      if (input.signal) input.signal.addEventListener("abort", () => controller.abort(), { once: true });
      preflight = repositoryPreflight(contract, { now }); journal.start(contract, preflight);
      const deadline = started + contract.maxDuration; const snapshots = new Map(); const iterations = []; const touched = new Set(); const providerCalls = [];
      const defaultCommands = unique(contract.validationCommands.length ? contract.validationCommands : Object.values(preflight.commands).filter(Boolean));
      journal.transition(taskId, "BASELINE");
      const baseline = [];
      for (const command of defaultCommands) baseline.push(await validate(contract, taskId, command, 0, controller.signal));
      let priorFailure = null; let solved = false;
      let currentModel = null; let escalationCount = 0;
      for (let iteration = 1; iteration <= contract.maxIterations; iteration += 1) {
        if (controller.signal.aborted) throw Object.assign(new Error("Tâche annulée."), { code: "CANCELLED" });
        if (now() >= deadline) throw Object.assign(new Error("Délai DEV dépassé."), { code: "TIMEOUT" });
        const phase = iteration === 1 ? "PLAN" : "REPAIR"; journal.transition(taskId, phase, { iteration });
        if (!ALLOWED_PHASES.has(phase)) throw new Error("DEV_PHASE_INVALID");
        const repairLimit = Math.max(0, Number(typeof sameTierRepairAttempts === "function" ? sameTierRepairAttempts(input) : sameTierRepairAttempts) || 0);
        const escalationEnabled = String(typeof qualityEscalationMode === "function" ? qualityEscalationMode(input) : qualityEscalationMode) === "LIMITED";
        const qualityEscalation = escalationEnabled && priorFailure?.intellectual === true && iteration > repairLimit
          ? { requested: true, fromModel: currentModel, evidence: priorFailure.failureCategory }
          : null;
        if (qualityEscalation) escalationCount += 1;
        backendReached = true;
        const proposal = normalizeReasoning(await reasoner.reason({ phase, contract, preflight: { branch: preflight.branch, language: preflight.language, framework: preflight.framework, dirtyFiles: preflight.snapshot.files }, files: modelFiles(snapshots), previousFailure: priorFailure, qualityEscalation, signal: controller.signal }));
        if (proposal.providerMetrics) { providerCalls.push(proposal.providerMetrics); currentModel = proposal.providerMetrics.model || currentModel; }
        const searched = inspect(contract, taskId, proposal.files, proposal.searchTerms, snapshots);
        let edits = proposal;
        if (!edits.operations.length) {
          edits = normalizeReasoning(await reasoner.reason({ phase: iteration === 1 ? "EDIT" : "REPAIR", contract, preflight: { branch: preflight.branch, language: preflight.language, framework: preflight.framework, dirtyFiles: preflight.snapshot.files }, files: modelFiles(snapshots), searchResults: searched, previousFailure: priorFailure, qualityEscalation, signal: controller.signal }));
          if (edits.providerMetrics) { providerCalls.push(edits.providerMetrics); currentModel = edits.providerMetrics.model || currentModel; }
        }
        if (!edits.operations.length) throw Object.assign(new Error("Aucun patch ciblé proposé."), { code: "TASK_FAILURE" });
        const changed = await applyEdits(contract, taskId, edits.operations, snapshots, iteration); changed.forEach((file) => touched.add(file));
        const commands = unique([...edits.validationCommands, ...proposal.validationCommands, ...defaultCommands]); const validations = [];
        journal.transition(taskId, "VALIDATING", { iteration });
        for (const command of commands) validations.push(await validate(contract, taskId, command, iteration, controller.signal));
        iterations.push({ iteration, changedFiles: changed, validations });
        const failed = validations.find(isBlockingValidationFailure);
        if (!failed) { solved = true; break; }
        priorFailure = { command: failed.command, status: failed.status, failureCategory: "VALIDATION_FAILURE", validationCategory: failed.failureCategory, intellectual: true, outputTail: String(failed.outputTail || "").slice(-4000) };
      }
      journal.transition(taskId, "REVIEW");
      const after = snapshotRepository(contract.repositoryRoot); const changedFiles = changedSince(preflight.snapshot, after);
      const review = reviewDiff(contract, changedFiles);
      if (preflight.snapshot.head !== after.head) { review.valid = false; review.issues.push({ code: "GIT_LOCAL_MUTATION" }); }
      const untouchedPreserved = preflight.snapshot.files.filter((file) => !touched.has(file)).every((file) => after.files.includes(file) && preflight.snapshot.fingerprints[file] === after.fingerprints[file]);
      if (!untouchedPreserved) { review.valid = false; review.issues.push({ code: "PRE_EXISTING_CHANGE_LOST" }); }
      const diffCheck = await validate(contract, taskId, "git diff --check", iterations.length, controller.signal);
      const failureCategory = !solved ? "MAX_ITERATIONS" : !review.valid ? review.issues[0]?.code || "VALIDATION_FAILURE" : diffCheck.status !== "PASS" ? "VALIDATION_FAILURE" : null;
      const preExistingFailure = baseline.some((item) => item.status !== "PASS");
      const lastValidations = iterations.at(-1)?.validations || [];
      const unresolvedPreExistingFailure = baseline.some((item) => item.status !== "PASS" && lastValidations.find((candidate) => candidate.command === item.command)?.status !== "PASS");
      const finalVerdict = failureCategory ? (changedFiles.length ? "PARTIAL" : "FAIL") : unresolvedPreExistingFailure ? "PARTIAL" : "PASS";
      journal.finish(taskId, finalVerdict, failureCategory);
      const estimatedCosts = providerCalls.map((item) => item.estimatedCost).filter(Number.isFinite); const actualCosts = providerCalls.map((item) => item.actualCost).filter(Number.isFinite);
      const result = { taskId, executionMode: "NATIVE_NOON", status: finalVerdict, finalVerdict, failureCategory, preflight: { branch: preflight.branch, language: preflight.language, framework: preflight.framework }, baseline, preExistingFailure, unresolvedPreExistingFailure, preExistingChanges: preflight.snapshot.files, preExistingChangesPreserved: untouchedPreserved, changedFiles, iterations, validations: lastValidations, diffReview: review, codexUsed: false, metrics: { taskDomain: "DEV", requiredQuality: contract.requiredQuality, duration: now() - started, iterations: iterations.length, fileCount: changedFiles.length, commandCount: baseline.length + iterations.reduce((sum, item) => sum + item.validations.length, 0) + 1, providerCalls, modelCallCount: providerCalls.length, backendReached, estimatedCost: estimatedCosts.length ? estimatedCosts.reduce((sum, value) => sum + value, 0) : null, actualCost: actualCosts.length ? actualCosts.reduce((sum, value) => sum + value, 0) : null, retryCount: 0, fallbackCount: 0, escalationCount, secondOpinionCount: 0, specialistDelegationCount: 0, success: finalVerdict === "PASS", finalVerdict, failureCategory } };
      results.set(taskId, result); emit("native_dev.completed", result.metrics); return result;
    } catch (error) {
      const failure = safeError(error); const finalVerdict = ["CANCELLED", "TIMEOUT"].includes(failure.code) ? failure.code : "FAIL";
      if (taskId && journal.load(taskId)) journal.finish(taskId, finalVerdict, failure.code);
      const result = { taskId, executionMode: "NATIVE_NOON", status: finalVerdict, finalVerdict, failureCategory: failure.code, error: failure, codexUsed: false, metrics: { taskDomain: "DEV", duration: now() - started, backendReached, success: false, failureCategory: failure.code } };
      if (taskId) results.set(taskId, result); emit("native_dev.failed", result.metrics); return result;
    } finally { if (taskId) controllers.delete(taskId); }
  }

  function cancelTask(taskId) { const controller = controllers.get(String(taskId)); if (!controller) return { cancelled: false, reason: "NOT_RUNNING" }; controller.abort(); return { cancelled: true, taskId: String(taskId) }; }
  function getTaskStatus(taskId) { return results.get(String(taskId)) || journal.load(String(taskId)) || null; }
  function recoverInterrupted() { return journal.interrupted().map((record) => ({ taskId: record.taskId, status: "INTERRUPTED", finalVerdict: "PARTIAL", failureCategory: "PROCESS_RESTARTED", requiresUserDecision: true })); }
  return { runTask, cancelTask, getTaskStatus, recoverInterrupted };
}

module.exports = { createNativeDevCoordinator, isBlockingValidationFailure, normalizeReasoning };
