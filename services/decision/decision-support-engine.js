"use strict";

const crypto = require("node:crypto");
const { normalizeDecisionRequest, normalizeCriterion } = require("./decision-schema");
const { evaluateOption } = require("./option-evaluator");
const { createDecisionHistoryService } = require("./decision-history-service");

const ENGINE_VERSION = "decision-support-v1";
const SOURCE_PRIORITY = Object.freeze({ hard_rule: 7, explicit_user: 6, workspace: 5, project: 4, memory_confirmed: 3, inferred: 2, default: 1 });
function stable(value) { if (Array.isArray(value)) return value.map(stable); if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])); return value; }
function fingerprint(value) { return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function resolveCriteria(request) {
  const selected = new Map();
  for (const raw of [...request.explicitCriteria, ...request.constraints.map((constraint) => ({ ...constraint, hardConstraint: true, source: constraint.source || "explicit_user" }))]) {
    const criterion = raw.criterionId ? raw : normalizeCriterion(raw);
    const key = criterion.type === "USER_DEFINED" ? criterion.label.toLocaleLowerCase("fr") : criterion.type;
    const current = selected.get(key);
    if (!current || SOURCE_PRIORITY[criterion.source] > SOURCE_PRIORITY[current.source]) selected.set(key, criterion);
  }
  return [...selected.values()];
}
function filterEvidence(request, { remote = false } = {}) {
  return request.evidence.filter((item) => {
    if (item.workspaceId && item.workspaceId !== request.workspaceId) return false;
    if (item.profileScope && item.profileScope !== request.profileScope) return false;
    if (remote && (item.localOnly === true || item.allowedForRemoteModel === false)) return false;
    return true;
  }).map((item) => ({ evidenceId: String(item.evidenceId), sourceType: item.sourceType || "unknown", confidence: item.confidence || "LOW",
    stale: item.stale === true, conflict: item.conflict === true, localOnly: item.localOnly === true, locator: item.locator || null }));
}
function keyTradeoffs(evaluated, criteria) {
  if (evaluated.length < 2) return [];
  const [left, right] = evaluated;
  return criteria.flatMap((criterion) => {
    const a = left.evaluations.find((item) => item.criterionId === criterion.criterionId);
    const b = right.evaluations.find((item) => item.criterionId === criterion.criterionId);
    if (!a || !b || a.assessment === b.assessment || a.assessment === "UNKNOWN" || b.assessment === "UNKNOWN") return [];
    return [{ criterionId: criterion.criterionId, optionA: left.option.optionId, assessmentA: a.assessment,
      optionB: right.option.optionId, assessmentB: b.assessment }];
  });
}
function recommendation(evaluated, request, uncertainty, tradeoffs = []) {
  const feasible = evaluated.filter((item) => item.option.status !== "INFEASIBLE");
  if (!feasible.length) return { type: "NO_FEASIBLE_OPTION", recommendedOptionId: null, reasonCodes: ["NO_FEASIBLE_OPTION"] };
  if (!request.recommendationRequested || request.outputMode === "COMPARE_ONLY") return { type: "COMPARE_ONLY", recommendedOptionId: null, reasonCodes: [] };
  if (uncertainty.state === "INSUFFICIENT") return { type: "INSUFFICIENT_EVIDENCE", recommendedOptionId: null, reasonCodes: ["INSUFFICIENT_EVIDENCE"] };
  const ranked = feasible.filter((item) => item.comparisonIndex !== null).sort((a, b) => b.comparisonIndex - a.comparisonIndex || a.option.label.localeCompare(b.option.label, "fr"));
  if (!ranked.length) return { type: "INSUFFICIENT_EVIDENCE", recommendedOptionId: null, reasonCodes: ["INSUFFICIENT_EVIDENCE"] };
  if (ranked.length > 1 && ranked[0].comparisonIndex === ranked[1].comparisonIndex) {
    const differentWinners = new Set(tradeoffs.flatMap((item) => {
      const order = { POOR: 0, WEAK: 1, NEUTRAL: 2, GOOD: 3, EXCELLENT: 4 };
      if (order[item.assessmentA] > order[item.assessmentB]) return [item.optionA];
      if (order[item.assessmentB] > order[item.assessmentA]) return [item.optionB];
      return [];
    }));
    return differentWinners.size > 1
      ? { type: "USER_VALUE_DEPENDENT", recommendedOptionId: null, reasonCodes: ["USER_PRIORITY_MATCH"] }
      : { type: "TIE", recommendedOptionId: null, reasonCodes: ["NO_CLEAR_ADVANTAGE"] };
  }
  const lowConfidence = ranked[0].evaluations.some((item) => ["LOW", "UNKNOWN"].includes(item.confidence));
  const type = lowConfidence || uncertainty.state === "PARTIAL" ? "CONDITIONAL_RECOMMENDATION" : "CLEAR_RECOMMENDATION";
  return { type, recommendedOptionId: ranked[0].option.optionId,
    reasonCodes: ["MEETS_ALL_HARD_CONSTRAINTS", lowConfidence ? "INSUFFICIENT_EVIDENCE" : "USER_PRIORITY_MATCH"] };
}

function createDecisionSupportEngine({ history = createDecisionHistoryService(), audit = null, now = () => new Date(), featureMode = "SHADOW", maxCache = 100 } = {}) {
  const cache = new Map(); const metrics = { decisions: 0, cacheHits: 0, searchRequests: 0, actionsExecuted: 0 };
  function compare(raw, options = {}) {
    const started = performance.now(); const request = normalizeDecisionRequest(raw);
    const criteriaStarted = performance.now(); const criteria = resolveCriteria(request); const criteriaResolutionMs = performance.now() - criteriaStarted;
    const evidence = filterEvidence(request, options); const evidenceById = new Map(evidence.map((item) => [item.evidenceId, item]));
    const contextFingerprint = fingerprint({ workspaceId: request.workspaceId, projectId: request.projectId, profileScope: request.profileScope,
      options: request.options, criteria, evidence, contextVersion: request.contextVersion, engine: ENGINE_VERSION });
    const cached = cache.get(contextFingerprint); if (cached) { metrics.cacheHits += 1; return structuredClone(cached); }
    const evaluationStarted = performance.now(); const evaluated = request.options.map((option) => evaluateOption(option, criteria, evidenceById));
    const unknowns = evaluated.flatMap((item) => item.evaluations.filter((entry) => entry.assessment === "UNKNOWN").map((entry) => ({ optionId: item.option.optionId, criterionId: entry.criterionId })));
    const importantUnknowns = unknowns.filter((unknown) => ["HIGH", "CRITICAL"].includes(criteria.find((item) => item.criterionId === unknown.criterionId)?.importance));
    const noOptionCanBeCompared = evaluated.every((item) =>
      item.evaluations.filter((entry) => ["HIGH", "CRITICAL"].includes(criteria.find((criterion) => criterion.criterionId === entry.criterionId)?.importance))
        .every((entry) => entry.assessment === "UNKNOWN")
    );
    const evidenceState = criteria.length === 0 || noOptionCanBeCompared ? "INSUFFICIENT" : unknowns.length ? "PARTIAL" : "SUFFICIENT";
    const uncertainty = { state: evidenceState, unknownCriteria: unknowns, staleEvidenceRefs: evidence.filter((item) => item.stale).map((item) => item.evidenceId),
      conflicts: evidence.filter((item) => item.conflict).map((item) => item.evidenceId) };
    const tradeoffs = keyTradeoffs(evaluated, criteria);
    const resolvedRecommendation = recommendation(evaluated, request, uncertainty, tradeoffs);
    const rankedOptions = [...evaluated].sort((a, b) => (b.comparisonIndex ?? -1) - (a.comparisonIndex ?? -1) || a.option.label.localeCompare(b.option.label, "fr"))
      .map((item, index) => ({ rank: item.comparisonIndex === null ? null : index + 1, optionId: item.option.optionId, label: item.option.label,
        status: item.option.status, comparisonBand: item.comparisonIndex === null ? "UNKNOWN" : item.comparisonIndex >= 3 ? "STRONG" : item.comparisonIndex >= 2 ? "BALANCED" : "WEAK",
        evidenceCoverage: item.evidenceCoverage }));
    const result = Object.freeze({ schemaVersion: 1, engineVersion: ENGINE_VERSION, decisionId: request.decisionId, decisionType: request.decisionType,
      status: uncertainty.staleEvidenceRefs.length ? "STALE" : "READY", recommendationType: resolvedRecommendation.type,
      recommendedOptionId: resolvedRecommendation.recommendedOptionId, reasonCodes: resolvedRecommendation.reasonCodes,
      rankedOptions, options: evaluated.map((item) => item.option), criteria, evaluations: evaluated.flatMap((item) => item.evaluations),
      keyTradeoffs: tradeoffs, uncertainties: uncertainty, assumptions: request.options.flatMap((item) => item.assumptions),
      risks: request.options.flatMap((option) => (option.metadata?.risks || []).slice(0, 20).map((risk, index) => ({
        riskId: risk.riskId || `${option.optionId}:risk:${index}`, optionId: option.optionId, category: risk.category || "OTHER",
        likelihood: ["LOW", "MEDIUM", "HIGH", "UNKNOWN"].includes(risk.likelihood) ? risk.likelihood : "UNKNOWN",
        impact: ["LOW", "MEDIUM", "HIGH", "UNKNOWN"].includes(risk.impact) ? risk.impact : "UNKNOWN",
        confidence: ["LOW", "MEDIUM", "HIGH", "UNKNOWN"].includes(risk.confidence) ? risk.confidence : "UNKNOWN",
        mitigation: risk.mitigation ? String(risk.mitigation).slice(0, 500) : null, evidenceRefs: (risk.evidenceRefs || []).filter((ref) => evidenceById.has(ref)),
      }))),
      blockers: evaluated.flatMap((item) => item.blockers.map((blocker) => ({ optionId: item.option.optionId, ...blocker }))),
      evidenceRefs: evidence.map((item) => item.evidenceId), citations: evidence.filter((item) => item.locator).map((item) => ({ evidenceId: item.evidenceId, locator: item.locator })),
      nextActions: evidenceState === "INSUFFICIENT" ? [{ type: "VERIFY_FACT", criterionId: importantUnknowns[0]?.criterionId || null, proposedOnly: true }] : [{ type: "USER_DECIDES", proposedOnly: true }],
      decisionContextFingerprint: contextFingerprint, workspaceId: request.workspaceId, projectId: request.projectId, profileScope: request.profileScope,
      recommendationIsAction: false, actionAuthorized: false, preferenceInferred: false, featureMode,
      metrics: { optionsCount: request.options.length, criteriaCount: criteria.length, evidenceCount: evidence.length, unknownCriteriaCount: unknowns.length,
        criteriaResolutionMs, evidenceResolutionMs: 0, evaluationMs: performance.now() - evaluationStarted, totalMs: performance.now() - started, modelCalls: 0, searchCalls: 0, estimatedCostUsd: 0 } });
    metrics.decisions += 1; audit?.("decision.recommendation-created", { decisionId: request.decisionId, workspaceRef: request.workspaceId ? fingerprint(request.workspaceId).slice(0, 12) : null,
      optionsCount: request.options.length, criteriaCount: criteria.length, evidenceCount: evidence.length, unknownCriteriaCount: unknowns.length, recommendationType: result.recommendationType });
    cache.set(contextFingerprint, result); while (cache.size > maxCache) cache.delete(cache.keys().next().value);
    return structuredClone(result);
  }
  function sensitivity(raw, scenarios = []) { return scenarios.slice(0, 12).map((scenario) => {
    const criteria = (raw.explicitCriteria || raw.criteria || []).map((criterion) => ({ ...criterion, importance: scenario.overrides?.[criterion.criterionId] || scenario.overrides?.[criterion.type] || criterion.importance }));
    const result = compare({ ...raw, explicitCriteria: criteria, contextVersion: `${raw.contextVersion || "0"}:${fingerprint(scenario.overrides || {}).slice(0, 8)}` });
    return { scenarioId: scenario.scenarioId, recommendationType: result.recommendationType, recommendedOptionId: result.recommendedOptionId, decisionId: result.decisionId };
  }); }
  function recordChoice(input) { const record = history.recordChoice(input); audit?.("decision.record-created", { decisionId: record.decisionId, recordId: record.decisionRecordId }); return record; }
  function render(result, { channel = "chat" } = {}) {
    const recommended = result.options.find((item) => item.optionId === result.recommendedOptionId);
    const downside = result.keyTradeoffs.find((item) => item.optionA === result.recommendedOptionId || item.optionB === result.recommendedOptionId);
    if (channel === "voice") return {
      recommendation: recommended?.label || result.recommendationType,
      reasons: result.reasonCodes.slice(0, 3),
      mainDownside: downside || null,
      uncertainty: result.uncertainties.state,
    };
    return result;
  }
  function health() { return { status: "ok", featureMode, cacheEntries: cache.size, ...metrics, executionAuthority: false, persistentPreferenceInference: false }; }
  return { compare, health, history, recordChoice, render, sensitivity };
}

module.exports = { ENGINE_VERSION, createDecisionSupportEngine, filterEvidence, fingerprint, resolveCriteria };
