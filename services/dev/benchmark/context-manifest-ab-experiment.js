"use strict";

const path = require("node:path");
const { benchmarkBudgetContext, fingerprint, runPlan, validateBoundPilotSession } = require("../dev-benchmark-service");

const EXPERIMENT = "CONTEXT_MANIFEST_AB_V1";
const TASK_ID = "multifile-state-flow";
const PARTICIPANT = "NATIVE_NOON";

function fault(message, code) { return Object.assign(new Error(message), { code }); }
function pendingRuns(repository, sessionId) { return repository.listSessionRuns(sessionId).map((run) => ({ id: run.id, state: run.state, version: run.version })); }
function same(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function purgeWorkspaceModules(workspace) {
  const root = `${path.resolve(workspace)}${path.sep}`;
  for (const key of Object.keys(require.cache)) if (key.startsWith(root)) delete require.cache[key];
}
function count(value) { return Array.isArray(value) ? value.length : null; }
function nonNegativeInteger(value) { return Number.isInteger(value) && value >= 0 ? value : null; }
function safeContextEvaluation(value) {
  if (!value || typeof value !== "object") return null;
  const manifest = value.manifest && typeof value.manifest === "object" ? value.manifest : null;
  const plan = value.plan && typeof value.plan === "object" ? value.plan : null;
  const inspection = value.inspection && typeof value.inspection === "object" ? value.inspection : null;
  return {
    version: nonNegativeInteger(value.version),
    manifest: manifest ? {
      mode: manifest.mode === "OFF" ? "OFF" : manifest.mode === "ON" ? "ON" : null,
      fileCount: nonNegativeInteger(manifest.fileCount), scanned: typeof manifest.scanned === "boolean" ? manifest.scanned : null,
      truncated: typeof manifest.truncated === "boolean" ? manifest.truncated : null,
    } : null,
    plan: plan ? { requestedFilesCount: count(plan.requestedFiles), searchTermsCount: count(plan.searchTerms) } : null,
    inspection: inspection ? { readFilesCount: count(inspection.readFiles), unavailableFilesCount: count(inspection.unavailableFiles) } : null,
  };
}
function publicVariant(mode, startFingerprint, durationMs, reported, validation) {
  return {
    mode, startFingerprint, durationMs,
    finalValid: validation.finalValid === true,
    visibleTests: validation.visibleTests ?? null,
    hiddenTests: validation.hiddenTests ?? null,
    failureCategory: ["HIDDEN_VALIDATION_FAILURE", "SCOPE_VIOLATION", "SECURITY_VIOLATION", "TEST_INTEGRITY_FAILURE", "VALIDATION_FAILURE"].includes(validation.failureCategory) ? validation.failureCategory : null,
    reasonCode: ["HIDDEN_VALIDATION_FAILED", "HIDDEN_VALIDATOR_EXCEPTION", "HIDDEN_VALIDATOR_UNAVAILABLE", "HIDDEN_VALIDATOR_INVALID_RESULT"].includes(validation.hiddenValidationReasonCode) ? validation.hiddenValidationReasonCode : null,
    reportedStatus: ["SUCCESS", "FAIL", "FAILED", "CANCELLED"].includes(reported.reportedStatus ?? reported.status) ? (reported.reportedStatus ?? reported.status) : null,
    iterations: nonNegativeInteger(reported.iterations), repairCycles: nonNegativeInteger(reported.repairCycles),
    inputTokens: nonNegativeInteger(reported.inputTokens), outputTokens: nonNegativeInteger(reported.outputTokens),
    estimatedCost: Number.isFinite(reported.estimatedCost) && reported.estimatedCost >= 0 ? reported.estimatedCost : null, calculatedActualCost: Number.isFinite(reported.calculatedActualCost) && reported.calculatedActualCost >= 0 ? reported.calculatedActualCost : null,
    provider: typeof reported.provider === "string" && /^[a-z0-9_-]{1,80}$/i.test(reported.provider) ? reported.provider : null, initialModel: typeof reported.initialModel === "string" && /^[a-z0-9._:-]{1,120}$/i.test(reported.initialModel) ? reported.initialModel : null, finalModel: typeof reported.finalModel === "string" && /^[a-z0-9._:-]{1,120}$/i.test(reported.finalModel) ? reported.finalModel : null,
    changedFilesCount: Number.isInteger(validation.changedFilesCount) ? validation.changedFilesCount : (reported.changedFilesCount ?? null),
    regressionCount: validation.regressionCount ?? 0, scopeViolations: validation.scopeViolations ?? 0, securityViolations: validation.securityViolations ?? 0,
    contextEvaluation: safeContextEvaluation(reported.contextEvaluation),
  };
}

function createContextManifestAbExperiment({ repository, armingRepository, runtimeAuthorization, templates, participant, validator, materializeWorkspace, now = () => Date.now() } = {}) {
  if (!repository?.getSession || !repository?.listSessionRuns) throw new TypeError("BenchmarkRepository requis.");
  if (!armingRepository?.getArmBySessionId) throw new TypeError("BenchmarkArmingRepository requis.");
  if (!runtimeAuthorization?.claimContextManifestAb || !runtimeAuthorization?.completeContextManifestAb) throw new TypeError("Autorisation runtime benchmark requise.");
  if (!participant?.execute && !participant?.run) throw new TypeError("Participant Native requis.");
  if (typeof validator !== "function" || typeof materializeWorkspace !== "function") throw new TypeError("Runtime benchmark incomplet.");

  async function run(sessionId) {
    const session = repository.getSession(String(sessionId || ""));
    if (!session || session.suite_version !== "benchmark-suite-v1" || session.state !== "READY") throw fault("Session benchmark READY requise.", "CONTEXT_MANIFEST_AB_SESSION_INVALID");
    const arm = armingRepository.getArmBySessionId(session.id);
    validateBoundPilotSession(arm, repository);
    const before = pendingRuns(repository, session.id);
    if (before.length !== 8 || before.some((run) => run.state !== "PENDING")) throw fault("Runs canoniques PENDING requis.", "CONTEXT_MANIFEST_AB_CANONICAL_RUNS_INVALID");
    const anchor = repository.listSessionRuns(session.id).find((run) => run.task_id === TASK_ID && run.participant === PARTICIPANT);
    const task = runPlan(session.suite_version).find((item) => item.task.taskId === TASK_ID && item.participant === PARTICIPANT)?.task;
    const fixture = templates?.[TASK_ID];
    if (!anchor || !task || !fixture) throw fault("Ancre benchmark multifile invalide.", "CONTEXT_MANIFEST_AB_ANCHOR_INVALID");
    const budget = benchmarkBudgetContext(session.id, armingRepository, repository);
    const workspace = runtimeAuthorization.current?.()?.workspacePath;
    if (!workspace) throw fault("Workspace benchmark autorisé requis.", "CONTEXT_MANIFEST_AB_AUTHORIZATION_INVALID");
    const claim = runtimeAuthorization.claimContextManifestAb({ sessionId: session.id, runId: anchor.id, executor: PARTICIPANT, workspacePath: workspace, fixturePath: fixture });
    if (!claim?.eligible || claim.claimed !== true) throw Object.assign(fault("Exécution benchmark non autorisée.", "BENCHMARK_EXECUTION_DENIED"), { reason: claim?.reason || "AUTHORIZATION_UNAVAILABLE" });

    const executeVariant = async (mode) => {
      materializeWorkspace(fixture, workspace);
      purgeWorkspaceModules(workspace);
      const startFingerprint = fingerprint(workspace);
      const fixtureFingerprint = fingerprint(fixture);
      if (startFingerprint !== fixtureFingerprint) throw fault("Snapshot benchmark divergent.", "CONTEXT_MANIFEST_AB_START_FINGERPRINT_MISMATCH");
      const started = now();
      const reported = await (participant.execute || participant.run)({ runId: anchor.id, benchmarkSessionId: session.id, benchmarkId: session.benchmark_id, benchmarkBudget: budget, contextManifestMode: mode, workspace, objective: task.objective, allowedPaths: ["src", "test"], forbiddenPaths: [".git", "node_modules"], task });
      const context = safeContextEvaluation(reported?.contextEvaluation);
      if (context?.manifest?.mode !== mode) throw fault("Télémétrie manifeste invalide.", "CONTEXT_MANIFEST_AB_MODE_UNVERIFIED");
      const validation = await validator({ task, fixtureBaseline: fixture, workspace, participantReportedResult: reported, hiddenValidatorId: task.taskId, allowedPaths: ["src", "test", "package.json"], forbiddenPaths: [".git", "node_modules"] });
      return publicVariant(mode, startFingerprint, Math.max(0, now() - started), reported || {}, validation || {});
    };

    const on = await executeVariant("ON");
    const off = await executeVariant("OFF");
    if (on.startFingerprint !== off.startFingerprint) throw fault("Fingerprints initiaux A/B différents.", "CONTEXT_MANIFEST_AB_START_FINGERPRINT_MISMATCH");
    const after = pendingRuns(repository, session.id);
    if (!same(before, after)) throw fault("Mutation des runs canoniques détectée.", "CONTEXT_MANIFEST_AB_CANONICAL_RUNS_MUTATED");
    runtimeAuthorization.completeContextManifestAb(session.id);
    return { experiment: EXPERIMENT, taskId: TASK_ID, sessionId: session.id, startFingerprint: on.startFingerprint, canonicalRunsMutated: false, variants: { ON: on, OFF: off } };
  }
  return { run };
}

module.exports = { EXPERIMENT, TASK_ID, createContextManifestAbExperiment, purgeWorkspaceModules, safeContextEvaluation };
