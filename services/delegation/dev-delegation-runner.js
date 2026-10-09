"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { isPathInsideRoots } = require("../../lib/path-utils");
const { sanitizeAuditDetails } = require("../security/redaction");
const { assertSpecialistAgentAdapter, normalizeSpecialistAgentResult } = require("./specialist-agent-adapter");
const { createDevTaskContract, PRIVATE_NAMES } = require("./dev-task-contract");
const { classifyDevCommand } = require("./dev-command-policy");
const { repositoryPreflight, snapshotRepository } = require("./repository-preflight");

const execFileAsync = promisify(execFile);
const TEST_WEAKENING = /\b(?:test|describe|it)\.(?:skip|only)\b|eslint-disable|@ts-ignore|--no-verify/i;
const SECRET_PATTERN = /(?:AIza[0-9A-Za-z_-]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|GOCSPX-[A-Za-z0-9_-]{10,}|ya29\.[A-Za-z0-9_-]{10,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/;
const DEBUG_PATTERN = /^\+.*(?:console\.log\(|\bdebugger\b|\bTODO\b|\bFIXME\b)/m;

async function executeValidation(command, cwd, timeout) {
  const decision = classifyDevCommand(command);
  if (!decision.allowed) return { command, status: "DENIED", reasonCode: decision.reasonCode, durationMs: 0 };
  const started = Date.now();
  try {
    await execFileAsync(decision.execution[0], decision.execution[1], { cwd, timeout, maxBuffer: 10 * 1024 * 1024, env: process.env });
    return { command, status: "PASS", durationMs: Date.now() - started };
  } catch (error) { return { command, status: "FAIL", reasonCode: error.killed ? "TIMEOUT" : "VALIDATION_FAILURE", durationMs: Date.now() - started }; }
}

function changedSince(before, after) {
  const pre = new Set(before.files); const files = [];
  for (const file of after.files) if (!pre.has(file) || before.fingerprints[file] !== after.fingerprints[file]) files.push(file);
  return [...new Set(files)].sort();
}
function preExistingPreserved(before, after) {
  return before.files.every((file) => after.files.includes(file) && before.fingerprints[file] === after.fingerprints[file]);
}
function fileAllowed(contract, relative) {
  const absolute = path.resolve(contract.repositoryRoot, relative);
  return !PRIVATE_NAMES.test(relative) && contract.allowedPaths.some((root) => isPathInsideRoots(absolute, [root])) && !contract.forbiddenPaths.some((root) => isPathInsideRoots(absolute, [root]));
}
function reviewDiff(contract, changedFiles) {
  const issues = [];
  for (const file of changedFiles) {
    if (!fileAllowed(contract, file)) issues.push({ code: "OUT_OF_SCOPE_CHANGE", file });
    if (PRIVATE_NAMES.test(file)) issues.push({ code: "PRIVATE_FILE_CHANGE", file });
  }
  let diff = "";
  try { diff = require("node:child_process").execFileSync("git", ["diff", "--no-ext-diff", "--", ...changedFiles], { cwd: contract.repositoryRoot, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }); } catch {}
  const added = diff.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++"));
  const removed = diff.split("\n").filter((line) => line.startsWith("-") && !line.startsWith("---"));
  for (const file of changedFiles.filter((item) => fs.existsSync(path.join(contract.repositoryRoot, item)))) {
    if (String(snapshotRepository(contract.repositoryRoot).status).includes(`?? ${file}`)) try { added.push(...fs.readFileSync(path.join(contract.repositoryRoot, file), "utf8").split("\n").map((line) => `+${line}`)); } catch {}
  }
  const addedText = added.join("\n");
  if (SECRET_PATTERN.test(addedText)) issues.push({ code: "SECRET_ADDED" });
  if (TEST_WEAKENING.test(addedText)) issues.push({ code: "TEST_INTEGRITY_FAILURE" });
  if (DEBUG_PATTERN.test(addedText)) issues.push({ code: "DEBUG_LEFTOVER" });
  if (/^\+.*catch\s*(?:\([^)]*\))?\s*\{\s*\}/m.test(addedText)) issues.push({ code: "SILENT_CATCH_ADDED" });
  const removedAssertions = removed.filter((line) => /\bassert(?:\.|\()/.test(line)).length;
  const addedAssertions = added.filter((line) => /\bassert(?:\.|\()/.test(line)).length;
  if (removedAssertions > addedAssertions) issues.push({ code: "ASSERTION_REMOVED" });
  if (changedFiles.some((file) => /(?:^|\/)test(?:s)?\//.test(file) && !fs.existsSync(path.join(contract.repositoryRoot, file)))) issues.push({ code: "TEST_DELETED" });
  if (changedFiles.some((file) => /(?:^|\/)(?:package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/.test(file))) issues.push({ code: "PACKAGE_CHANGE_REQUIRES_APPROVAL" });
  if (added.length + removed.length > 1000) issues.push({ code: "MASSIVE_CHANGE" });
  return { valid: issues.length === 0, issues };
}

function createDevDelegationRunner({ specialistAgent, workspaceEngine = null, privacyPolicy = null, operationalSecurityPolicy = null, observability = null, now = () => Date.now(), validationExecutor = executeValidation } = {}) {
  assertSpecialistAgentAdapter(specialistAgent);
  const controllers = new Map();
  const emit = (event, metadata) => { try { observability?.(event, sanitizeAuditDetails(metadata)); } catch {} };
  async function runDevTask(input = {}) {
    const started = now();
    let authorizedInput = input;
    if (workspaceEngine) {
      const workspace = workspaceEngine.context(input.workspaceId);
      const roots = (workspace.relevantRoots || workspace.roots || []).filter((item) => item.mode === "read-write").map((item) => item.path);
      authorizedInput = { ...input, workspaceAuthorized: roots.length > 0, workspaceRoots: roots };
    }
    const contract = createDevTaskContract(authorizedInput); const controller = new AbortController(); controllers.set(contract.taskId, controller);
    if (input.signal) input.signal.addEventListener("abort", () => controller.abort(), { once: true });
    const preflightStarted = now(); const preflight = repositoryPreflight(contract, { now }); const preflightDuration = now() - preflightStarted;
    if (privacyPolicy && input.privacyDecision?.decision !== "ALLOW") { controllers.delete(contract.taskId); return { taskId: contract.taskId, status: "FAILED", finalVerdict: "FAIL", failureCategory: "PERMISSION_DENIED" }; }
    const commands = contract.validationCommands.length ? contract.validationCommands : Object.values(preflight.commands).filter(Boolean);
    const benchmarkScope = input.benchmarkExecution ? { authorizedRoots: [contract.repositoryRoot], authorizedWriteRoots: [contract.repositoryRoot] } : {};
    const scopeTelemetry = input.benchmarkExecution ? { benchmark: true, sessionId: input.benchmarkExecution.sessionId, runId: input.benchmarkExecution.runId, workspaceRoot: contract.repositoryRoot } : null;
    if (operationalSecurityPolicy) for (const command of commands) {
      const decision = operationalSecurityPolicy.evaluate({ actionRequest: { origin: "explicit_user_chat", skillId: "terminal", operation: `read validate ${command}`, args: { path: contract.repositoryRoot }, workspaceId: contract.workspaceId, explicitOrder: true }, currentPermissions: { allowed: contract.permissions.includes("TERMINAL_SAFE"), code: "TERMINAL_SAFE" }, ...benchmarkScope, ...(scopeTelemetry ? { scopeTelemetry } : {}) });
      if (!["ALLOW", "ALLOW_WITH_CONSTRAINTS"].includes(decision.outcome)) { controllers.delete(contract.taskId); return { taskId: contract.taskId, status: "FAILED", finalVerdict: "FAIL", failureCategory: "PERMISSION_DENIED" }; }
    }
    const baseline = [];
    for (const command of commands) baseline.push(await validationExecutor(
      command,
      contract.repositoryRoot,
      Math.min(
        contract.maxDuration,
        120_000
      ),
      controller.signal,
      {
        taskId: contract.taskId,
        workspaceId:
          contract.workspaceId,
        sessionId:
          contract.sessionId,
        permissions:
          contract.permissions,
      }
    ));
    const agentStarted = now();
    const rawAgentResult = controller.signal.aborted
      ? { taskId: contract.taskId, agent: specialistAgent.id, status: "CANCELLED", summary: "Mission annulée.", failureCategory: "CANCELLED" }
      : await specialistAgent.executeTask(contract, { preflight, signal: controller.signal, benchmarkExecution: input.benchmarkExecution || null });
    let agentResult = normalizeSpecialistAgentResult(rawAgentResult, { taskId: contract.taskId, agent: specialistAgent.id });
    const agentDuration = now() - agentStarted;
    const postSnapshot = snapshotRepository(contract.repositoryRoot);
    const changedFiles = changedSince(preflight.snapshot, postSnapshot);
    const preserved = preExistingPreserved(preflight.snapshot, postSnapshot);
    agentResult = normalizeSpecialistAgentResult({ ...agentResult, changedFiles }, { taskId: contract.taskId, agent: specialistAgent.id });
    const review = reviewDiff(contract, changedFiles);
    if (preflight.snapshot.head !== postSnapshot.head) review.issues.push({ code: "GIT_LOCAL_MUTATION" });
    review.valid = review.issues.length === 0;
    const postStarted = now(); const validations = [];
    if (!["CANCELLED", "TIMEOUT"].includes(agentResult.status)) for (const command of [...commands, "git diff --check"].filter((item, index, all) => all.indexOf(item) === index)) validations.push(await validationExecutor(
      command,
      contract.repositoryRoot,
      Math.min(
        contract.maxDuration,
        120_000
      ),
      controller.signal,
      {
        taskId: contract.taskId,
        workspaceId:
          contract.workspaceId,
        sessionId:
          contract.sessionId,
        permissions:
          contract.permissions,
      }
    ));
    const postValidationDuration = now() - postStarted;
    let failureCategory = agentResult.failureCategory;
    if (!preserved || review.issues.some((item) => ["OUT_OF_SCOPE_CHANGE", "GIT_LOCAL_MUTATION"].includes(item.code))) failureCategory = "OUT_OF_SCOPE_CHANGE";
    else if (review.issues.length || validations.some((item) => item.status !== "PASS")) failureCategory = "VALIDATION_FAILURE";
    if ((agentResult.iterations > contract.maxIterations) || (contract.maxEstimatedCost !== null && agentResult.actualCost !== null && agentResult.actualCost > contract.maxEstimatedCost)) failureCategory = "BUDGET_EXCEEDED";
    const finalVerdict = agentResult.status === "SUCCESS"
      ? (!failureCategory && review.valid && preserved && validations.every((item) => item.status === "PASS") ? "PASS" : "FAIL")
      : changedFiles.length || agentResult.status === "CANCELLED" || agentResult.status === "TIMEOUT" ? "PARTIAL" : "FAIL";
    const result = {
      taskId: contract.taskId, agent: specialistAgent.id, status: agentResult.status, finalVerdict, failureCategory,
      summary: agentResult.summary, preflight, baseline, preExistingFailure: baseline.some((item) => item.status !== "PASS"), preExistingChanges: preflight.snapshot.files, preExistingChangesPreserved: preserved,
      changedFiles, validations, diffReview: review, permissions: contract.permissions,
      metrics: { taskDomain: "DEV", requiredQuality: contract.requiredQuality, duration: now() - started, agentDuration, orchestrationOverhead: Math.max(0, now() - started - agentDuration), preflightDuration, postValidationDuration, iterations: agentResult.iterations, commandCount: baseline.length + validations.length, estimatedCost: agentResult.estimatedCost, actualCost: agentResult.actualCost, backend: agentResult.backend, changedFilesCount: changedFiles.length, success: finalVerdict === "PASS", failureCategory },
    };
    emit("specialist_agent.completed", { taskId: contract.taskId, agent: specialistAgent.id, taskDomain: "DEV", requiredQuality: contract.requiredQuality, duration: result.metrics.duration, iterations: result.metrics.iterations, commandCount: result.metrics.commandCount, changedFilesCount: changedFiles.length, validationStatus: validations.every((item) => item.status === "PASS") ? "PASS" : "FAIL", estimatedCost: result.metrics.estimatedCost, actualCost: result.metrics.actualCost, success: result.metrics.success, failureCategory });
    controllers.delete(contract.taskId); return result;
  }
  async function cancelTask(taskId) { controllers.get(String(taskId))?.abort(); return specialistAgent.cancelTask(taskId); }
  async function recoverInterruptedTask(contractInput) { const contract = createDevTaskContract(contractInput); const snapshot = snapshotRepository(contract.repositoryRoot); return { taskId: contract.taskId, status: "INTERRUPTED", finalVerdict: "PARTIAL", failureCategory: "INTERRUPTED", changedFiles: snapshot.files, requiresUserDecision: true }; }
  return { runDevTask, cancelTask, recoverInterruptedTask, getTaskStatus: (taskId) => specialistAgent.getTaskStatus(taskId) };
}

module.exports = { createDevDelegationRunner, executeValidation, reviewDiff, changedSince, preExistingPreserved };
