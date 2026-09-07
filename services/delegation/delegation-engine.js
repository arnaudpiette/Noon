"use strict";

const crypto = require("node:crypto");

const STATES = Object.freeze(["PLANNED", "READY", "RUNNING", "COMPLETED", "FAILED", "CANCELLED", "SKIPPED", "STALE"]);
const MODES = Object.freeze(["NONE", "SINGLE", "PARALLEL", "SEQUENTIAL"]);
const REASON_CODES = Object.freeze({
  DELEGATE: ["SPECIALIZED_DOMAIN", "MULTI_DOMAIN_TASK", "PARALLELIZABLE", "HIGH_COMPLEXITY", "LARGE_EVIDENCE_SET", "ARTIFACT_PREPARATION"],
  DIRECT: ["SIMPLE_TASK", "LOW_EXPECTED_BENEFIT", "BUDGET_LIMIT", "PRIVACY_CONSTRAINT", "SPECIALIST_UNAVAILABLE", "MAX_DEPTH", "FEATURE_DISABLED"],
});

const DOMAIN_PATTERNS = Object.freeze({
  DEV: /\b(code|backend|frontend|api|architecture|bug|debug|test|régression|refactor|routeur|serveur|implementation|implémentation)\b/i,
  DA: /\b(maquette|design|ux|ui|direction artistique|identité visuelle|typographie|composition|écran|graphique)\b/i,
  RESEARCH: /\b(recherche|sources? (?:actuelles?|récentes?)|bonnes pratiques actuelles|état de l'art|veille|web)\b/i,
  DOCUMENT: /\b(rapport|présentation|pptx|pdf|docx|document|soutenance|structure|rédige|rédiger)\b/i,
  ANALYSIS: /\b(analyse stratégique|comparaison complexe|multi-source|diagnostic global|synthèse complexe)\b/i,
});
const COMPLEX_PATTERN = /\b(analyse en profondeur|audit complet|approfondi|exhaustif|cause racine|architecture complète|plusieurs|compare aussi|toute l'analyse|toute l’analyse)\b/i;
const SIMPLE_PATTERN = /^(?:c['’]est quoi|définis|explique(?:-moi)?|merci|bonjour|salut)\b/i;

function id(prefix) { return `${prefix}-${crypto.randomUUID()}`; }
function bounded(value, fallback, min, max) { const number = Number(value); return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.floor(number))) : fallback; }
function clean(value, max = 4000) { return String(value || "").replace(/[\0\r]+/g, " ").trim().slice(0, max); }
function asArray(value) { return Array.isArray(value) ? value : []; }

function validateSpecialistResult(value, expected) {
  if (!value || typeof value !== "object" || value.specialistId !== expected.specialistId || value.subtaskId !== expected.subtaskId || !STATES.includes(value.status) || typeof value.summary !== "string") {
    const error = new Error("Résultat spécialiste invalide."); error.code = "SPECIALIST_RESULT_INVALID"; throw error;
  }
  const findings = asArray(value.findings).slice(0, 50).map((finding, index) => ({
    findingId: clean(finding.findingId || `${value.specialistRunId}:finding:${index}`, 160),
    statement: clean(finding.statement || finding.summary, 2000),
    kind: ["FACT", "INFERENCE", "RECOMMENDATION"].includes(finding.kind) ? finding.kind : "INFERENCE",
    confidence: ["HIGH", "MEDIUM", "LOW", "UNKNOWN"].includes(finding.confidence) ? finding.confidence : "UNKNOWN",
    evidenceRefs: asArray(finding.evidenceRefs).map((item) => clean(item, 160)).filter(Boolean).slice(0, 20),
    supported: asArray(finding.evidenceRefs).length > 0 || finding.kind !== "FACT",
  }));
  return {
    specialistRunId: clean(value.specialistRunId, 160), specialistId: value.specialistId,
    subtaskId: value.subtaskId, status: value.status, summary: clean(value.summary, 4000), findings,
    recommendations: asArray(value.recommendations).slice(0, 30), evidenceRefs: asArray(value.evidenceRefs).slice(0, 50),
    assumptions: asArray(value.assumptions).slice(0, 20), uncertainties: asArray(value.uncertainties).slice(0, 20),
    proposedActions: asArray(value.proposedActions).map((item) => ({ ...item, authority: "UNTRUSTED_PROPOSAL" })).slice(0, 20),
    proposedToolRequests: asArray(value.proposedToolRequests).map((item) => ({
      toolRequestId: clean(item.toolRequestId || id("tool-request"), 160), skillId: clean(item.skillId, 120),
      operation: clean(item.operation, 120), purpose: clean(item.purpose, 1000), requestedInputs: item.requestedInputs && typeof item.requestedInputs === "object" ? item.requestedInputs : {},
      authority: "UNTRUSTED_PROPOSAL",
    })).slice(0, 20),
    artifactsSuggested: asArray(value.artifactsSuggested).slice(0, 20),
    metrics: value.metrics && typeof value.metrics === "object" ? value.metrics : {},
  };
}

function createDelegationEngine({ registry, capsuleBuilder, modelRouter, runSpecialist, observability = null, reliability = null, now = () => Date.now(), cacheTtlMs = 120_000 } = {}) {
  if (!registry?.get || !capsuleBuilder?.build || typeof modelRouter !== "function" || typeof runSpecialist !== "function") throw new TypeError("Dépendances DelegationEngine invalides.");
  const cache = new Map();

  function budgetFor(request) {
    const requestedDeep = /\b(très approfondi|analyse très approfondie|exhaustif)\b/i.test(request.query || "");
    return {
      maxSubtasks: bounded(request.maxSubtasks, requestedDeep ? 4 : 3, 1, 4), maxParallel: bounded(request.maxParallel, 2, 1, 2),
      maxDepth: 1, maxIterations: 1, maxModelCalls: bounded(request.maxModelCalls, requestedDeep ? 4 : 3, 1, 4),
      maxToolRequests: 0, maxInputTokens: bounded(request.maxInputTokens, requestedDeep ? 24000 : 12000, 1000, 32000),
      maxOutputTokens: bounded(request.maxOutputTokens, requestedDeep ? 8000 : 4000, 500, 12000),
      maxWallTimeMs: bounded(request.maxWallTimeMs, requestedDeep ? 120000 : 45000, 1000, 120000),
      maxCost: Math.max(0, Math.min(Number(request.maxCost) || (requestedDeep ? 0.2 : 0.08), 1)),
    };
  }

  function classify(request = {}, context = {}) {
    const text = clean(request.query);
    if (request.featureMode === "OFF") return { delegate: false, reasonCodes: ["FEATURE_DISABLED"], specialists: [] };
    if (Number(request.delegationDepth || 0) >= 1) return { delegate: false, reasonCodes: ["MAX_DEPTH"], specialists: [] };
    if (["ECO", "PROTECTION", "BLOCKED"].includes(String(request.budgetMode || "NORMAL").toUpperCase())) return { delegate: false, reasonCodes: ["BUDGET_LIMIT"], specialists: [] };
    if (request.allowRemote === false || context.metadata?.localOnly > 0 && !context.remoteModelContext) return { delegate: false, reasonCodes: ["PRIVACY_CONSTRAINT"], specialists: [] };
    if (!text || text.length < 220 && SIMPLE_PATTERN.test(text) && !COMPLEX_PATTERN.test(text)) return { delegate: false, reasonCodes: ["SIMPLE_TASK"], specialists: [] };
    const specialists = Object.entries(DOMAIN_PATTERNS).filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
    if (!COMPLEX_PATTERN.test(text) && specialists.length < 2 && Number(request.attachmentsCount || 0) < 3) return { delegate: false, reasonCodes: ["LOW_EXPECTED_BENEFIT"], specialists: [] };
    if (!specialists.length) specialists.push("ANALYSIS");
    const limited = specialists.filter((name) => registry.has(name)).slice(0, budgetFor(request).maxSubtasks);
    return { delegate: limited.length > 0, specialists: limited, reasonCodes: [limited.length > 1 ? "MULTI_DOMAIN_TASK" : "SPECIALIZED_DOMAIN", "HIGH_COMPLEXITY", ...(limited.length > 1 ? ["PARALLELIZABLE"] : []), ...(limited.includes("DOCUMENT") ? ["ARTIFACT_PREPARATION"] : [])] };
  }

  function shouldDelegate(request, context) { const started = now(); const decision = classify(request, context); observability?.("delegation_evaluated", { delegate: decision.delegate, reasonCodes: decision.reasonCodes, durationMs: now() - started }); return decision; }

  function planDelegation(request, context = {}) {
    const started = now(); const decision = shouldDelegate(request, context); const budget = budgetFor(request);
    if (!decision.delegate) return { delegationPlanId: id("delegation-plan"), parentTaskId: request.parentExecutionId || id("task"), mode: "NONE", subtasks: [], dependencies: [], budget, completionPolicy: "BEST_EFFORT", reasonCodes: decision.reasonCodes, state: "SKIPPED", planningMs: now() - started };
    const parentTaskId = request.parentExecutionId || id("task");
    const subtasks = decision.specialists.map((specialistId) => ({ subtaskId: id("subtask"), parentTaskId, specialistId, objective: clean(request.query, 2000), description: `${specialistId} analysis`, dependencies: [], inputRefs: asArray(request.evidenceRefs), expectedOutput: "SpecialistResult", budget: { maxModelCalls: 1, maxToolRequests: 0, maxInputTokens: Math.floor(budget.maxInputTokens / decision.specialists.length), maxOutputTokens: Math.floor(budget.maxOutputTokens / decision.specialists.length), maxWallTimeMs: budget.maxWallTimeMs }, priority: "NORMAL", state: "PLANNED" }));
    const document = subtasks.find((item) => item.specialistId === "DOCUMENT");
    const producers = subtasks.filter((item) => item.specialistId !== "DOCUMENT");
    if (document && producers.length) document.dependencies = producers.map((item) => item.subtaskId);
    const sequential = subtasks.some((item) => item.dependencies.length > 0);
    const mode = sequential ? "SEQUENTIAL" : subtasks.length > 1 ? "PARALLEL" : "SINGLE";
    const plan = { delegationPlanId: id("delegation-plan"), parentTaskId, parentExecutionId: request.parentExecutionId || null, parentConversationId: request.parentConversationId || null, parentWorkspaceId: request.parentWorkspaceId || null, profileScope: request.profileScope || "arnaud", mode, subtasks, dependencies: subtasks.flatMap((item) => item.dependencies.map((dependency) => ({ from: dependency, to: item.subtaskId }))), budget, completionPolicy: "BEST_EFFORT", reasonCodes: decision.reasonCodes, state: "PLANNED", delegationIteration: 1, planningMs: now() - started };
    observability?.("delegation_plan_created", { planId: plan.delegationPlanId, mode, subtaskCount: subtasks.length, reasonCodes: plan.reasonCodes, planningMs: plan.planningMs });
    return plan;
  }

  async function executeOne(subtask, request, context, results, plan) {
    if (request.signal?.aborted) return { specialistRunId: id("specialist-run"), specialistId: subtask.specialistId, subtaskId: subtask.subtaskId, status: "CANCELLED", summary: "Annulé.", findings: [], proposedToolRequests: [], metrics: {} };
    const failedDependency = subtask.dependencies.some((dependency) => results.find((item) => item.subtaskId === dependency)?.status !== "COMPLETED");
    if (failedDependency) return { specialistRunId: id("specialist-run"), specialistId: subtask.specialistId, subtaskId: subtask.subtaskId, status: "SKIPPED", summary: "Dépendance indisponible.", findings: [], proposedToolRequests: [], metrics: {} };
    const specialist = registry.get(subtask.specialistId); if (!specialist) return { specialistRunId: id("specialist-run"), specialistId: subtask.specialistId, subtaskId: subtask.subtaskId, status: "FAILED", summary: "Spécialiste indisponible.", findings: [], proposedToolRequests: [], metrics: {}, errorCode: "SPECIALIST_UNAVAILABLE" };
    const capsuleStarted = now();
    const capsule = capsuleBuilder.build({ specialist, subtask, request: { ...request, delegationDepth: 0 }, context, dependencyResults: results });
    observability?.("context_capsule_built", { specialistId: specialist.specialistId, durationMs: now() - capsuleStarted, factCount: capsule.relevantFacts.length, evidenceCount: capsule.evidenceRefs.length });
    const cacheKey = `${request.parentWorkspaceId || "none"}:${request.profileScope || "arnaud"}:${capsule.capsuleFingerprint}`;
    const cached = cache.get(cacheKey);
    if (cached && now() - cached.at <= cacheTtlMs) { observability?.("specialist_result_reused", { specialistId: specialist.specialistId, specialistRunId: cached.result.specialistRunId }); return { ...cached.result, subtaskId: subtask.subtaskId, reused: true }; }
    const route = modelRouter({ question: subtask.objective, profile: request.modelProfile || "balanced", budgetMode: request.budgetMode || "NORMAL", attachments: 0, requiredCapabilities: specialist.requiredCapabilities, context: { estimatedTokens: Math.ceil(JSON.stringify(capsule).length / 4), sourceCount: capsule.evidenceRefs.length } });
    const started = now(); observability?.("specialist_run_started", { specialistId: specialist.specialistId, subtaskId: subtask.subtaskId, model: route.model });
    try {
      let timeoutId;
      const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(Object.assign(new Error("Timeout spécialiste."), { code: "SPECIALIST_TIMEOUT" })), subtask.budget.maxWallTimeMs);
        timeoutId.unref?.();
      });
      const raw = await Promise.race([
        runSpecialist({ specialist, capsule, route, signal: request.signal, budget: subtask.budget }),
        timeout,
      ]).finally(() => clearTimeout(timeoutId));
      const result = validateSpecialistResult(raw, subtask);
      cache.set(cacheKey, { at: now(), result });
      observability?.("specialist_run_completed", { specialistId: specialist.specialistId, specialistRunId: result.specialistRunId, durationMs: now() - started, inputTokens: Number(result.metrics.inputTokens) || 0, outputTokens: Number(result.metrics.outputTokens) || 0, cost: Number(result.metrics.cost) || 0 });
      return result;
    } catch (error) {
      try { reliability?.recordFailure?.(`specialist-${specialist.specialistId.toLowerCase()}`, error, { latencyMs: now() - started }); } catch {}
      observability?.(request.signal?.aborted ? "specialist_run_cancelled" : "specialist_run_failed", { specialistId: specialist.specialistId, durationMs: now() - started, code: clean(error.code || error.name, 80) });
      return { specialistRunId: id("specialist-run"), specialistId: specialist.specialistId, subtaskId: subtask.subtaskId, status: request.signal?.aborted ? "CANCELLED" : "FAILED", summary: "Analyse spécialiste indisponible.", findings: [], recommendations: [], evidenceRefs: [], assumptions: [], uncertainties: [], proposedActions: [], proposedToolRequests: [], artifactsSuggested: [], metrics: {}, errorCode: clean(error.code || "SPECIALIST_FAILED", 80) };
    }
  }

  async function run(request = {}, context = {}) {
    const totalStarted = now(); const plan = planDelegation(request, context);
    if (plan.mode === "NONE" || request.featureMode === "SHADOW") { observability?.("delegation_skipped", { reasonCodes: plan.reasonCodes, shadow: request.featureMode === "SHADOW" }); return { status: "SKIPPED", plan, results: [], toolRequests: [], reasonCodes: plan.reasonCodes, metrics: { totalMs: now() - totalStarted } }; }
    if (request.featureMode === "LIMITED" && !(request.mode === "DEV" || /noon/i.test(request.parentWorkspaceId || ""))) return { status: "SKIPPED", plan, results: [], toolRequests: [], reasonCodes: ["FEATURE_DISABLED"], metrics: { totalMs: now() - totalStarted } };
    const results = [];
    const budgetExceeded = () => {
      const totals = results.reduce((summary, item) => ({
        modelCalls: summary.modelCalls + (Number(item.metrics?.modelCalls) || 0),
        tokens: summary.tokens + (Number(item.metrics?.inputTokens) || 0) + (Number(item.metrics?.outputTokens) || 0),
        cost: summary.cost + (Number(item.metrics?.cost) || 0),
      }), { modelCalls: 0, tokens: 0, cost: 0 });
      return totals.modelCalls >= plan.budget.maxModelCalls ||
        totals.tokens >= plan.budget.maxInputTokens + plan.budget.maxOutputTokens ||
        totals.cost >= plan.budget.maxCost || now() - totalStarted >= plan.budget.maxWallTimeMs;
    };
    const budgetSkipped = (subtask) => ({ specialistRunId: id("specialist-run"), specialistId: subtask.specialistId, subtaskId: subtask.subtaskId, status: "SKIPPED", summary: "Budget de délégation épuisé.", findings: [], proposedToolRequests: [], metrics: {}, errorCode: "BUDGET_EXHAUSTED" });
    const independent = plan.subtasks.filter((item) => item.dependencies.length === 0);
    for (let index = 0; index < independent.length; index += plan.budget.maxParallel) {
      const batch = independent.slice(index, index + plan.budget.maxParallel);
      if (budgetExceeded()) { results.push(...batch.map(budgetSkipped)); continue; }
      const completed = await Promise.all(batch.map((subtask) => executeOne(subtask, request, context, results, plan)));
      results.push(...completed);
    }
    for (const subtask of plan.subtasks.filter((item) => item.dependencies.length > 0)) results.push(budgetExceeded() ? budgetSkipped(subtask) : await executeOne(subtask, request, context, results, plan));
    const complete = results.filter((item) => item.status === "COMPLETED").length;
    const status = complete === results.length ? "COMPLETED" : complete > 0 ? "PARTIAL" : "PARTIAL";
    const toolRequests = results.flatMap((item) => item.proposedToolRequests || []).map((item) => ({ ...item, authority: "UNTRUSTED_PROPOSAL" }));
    return { status, plan: { ...plan, state: status }, results, toolRequests, reasonCodes: plan.reasonCodes, metrics: { totalMs: now() - totalStarted, specialistCount: results.length, modelCalls: results.reduce((sum, item) => sum + (Number(item.metrics?.modelCalls) || 0), 0), inputTokens: results.reduce((sum, item) => sum + (Number(item.metrics?.inputTokens) || 0), 0), outputTokens: results.reduce((sum, item) => sum + (Number(item.metrics?.outputTokens) || 0), 0), cost: results.reduce((sum, item) => sum + (Number(item.metrics?.cost) || 0), 0) } };
  }

  return { shouldDelegate, planDelegation, run, validateSpecialistResult, modes: MODES, states: STATES, reasonCodes: REASON_CODES, maxDepth: 1 };
}

module.exports = { MODES, REASON_CODES, STATES, createDelegationEngine, validateSpecialistResult };
