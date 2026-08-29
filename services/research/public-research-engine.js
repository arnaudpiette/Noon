"use strict";

const crypto = require("node:crypto");
const { normalizeResearchRequest } = require("./research-schema");
const { sanitizePublicQuery } = require("./privacy-query-sanitizer");
const { createResearchPlanner } = require("./research-planner");
const { createSourceEvaluator } = require("./source-evaluator");
const { createResearchCache } = require("./research-cache");

function hash(value, size = 24) { return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, size); }
function normalizeKey(value) { return String(value || "").toLowerCase().replace(/^https?:\/\/(?:www\.)?/, "").replace(/[?#].*$/, "").replace(/\/$/, ""); }
function detectConflicts(results) {
  const groups = new Map();
  for (const item of results) { const key = String(item.title || "").toLowerCase().replace(/\W+/g, " ").trim(); if (!key) continue; const values = groups.get(key) || []; values.push(item); groups.set(key, values); }
  return [...groups.entries()].filter(([, values]) => values.length > 1 && new Set(values.map((item) => item.snippet)).size > 1).map(([topic, values]) => ({ conflictId: `public_conflict_${hash(topic)}`, topic, status: "UNRESOLVED", evidenceIds: values.map((item) => item.evidenceId) }));
}
function confidence(results, conflicts, completeness) {
  if (completeness === "INSUFFICIENT" || !results.length) return "LOW";
  const high = results.filter((item) => item.confidence === "HIGH").length;
  if (!conflicts.length && high >= Math.min(2, results.length)) return "HIGH";
  return conflicts.length > 1 || results.every((item) => item.confidence === "LOW") ? "LOW" : "MEDIUM";
}

function createPublicResearchEngine({ adapter, planner = createResearchPlanner(), evaluator = createSourceEvaluator(), cache = createResearchCache(), reliability = null, observability = null, now = () => Date.now() } = {}) {
  if (!adapter?.search) throw new TypeError("WebSearchAdapter requis.");
  const emit = (event, metadata) => { try { observability?.(event, metadata); } catch {} };
  async function research(input = {}) {
    const started = now(); const request = normalizeResearchRequest(input);
    emit("research_started", { researchId: request.researchId, mode: request.mode, scope: request.scope, freshness: request.freshnessRequirement });
    const cached = cache.get(request, adapter.provider || "provider");
    emit(cached.status === "HIT" ? "research_cache_hit" : cached.status === "STALE" ? "research_cache_stale" : "research_cache_miss", { researchId: request.researchId });
    if (cached.value) return { ...cached.value, researchId: request.researchId, cache: { status: "HIT", retrievedFresh: false } };
    if (input.signal?.aborted) {
      emit("research_cancelled", { researchId: request.researchId, queryCount: 0 });
      return cancelledPack(request, started, now);
    }
    const planningStarted = now(); const plan = planner.plan(request, { budgetMode: input.budgetMode }); const planningMs = now() - planningStarted;
    const attempts = []; const all = []; let searchCalls = 0; let modelCalls = 0; let tokenUsage = { inputTokens: 0, outputTokens: 0 };
    for (const subQuestion of plan.subQuestions) {
      if (input.signal?.aborted) {
        emit("research_cancelled", { researchId: request.researchId, queryCount: attempts.length });
        return cancelledPack(request, started, now, { attempts, results: all });
      }
      const sanitized = sanitizePublicQuery({ query: subQuestion, privateTerms: input.privateTerms, evidence: input.personalEvidence, userProvidedPublicTerms: request.userProvidedPublicTerms });
      emit("research_query_sanitized", { researchId: request.researchId, queryFingerprint: sanitized.queryFingerprint, sanitized: sanitized.sanitized, privateTermsRemoved: sanitized.privateTermsRemoved, localOnlyBlocked: sanitized.localOnlyBlocked, wordCount: sanitized.query.split(/\s+/).length });
      try {
        const result = await adapter.search({ ...request, query: sanitized.query, queryFingerprint: sanitized.queryFingerprint, signal: input.signal, modelProfile: input.modelProfile, budgetMode: input.budgetMode });
        attempts.push({ queryFingerprint: sanitized.queryFingerprint, status: "OK", resultCount: result.results.length, durationMs: result.durationMs });
        all.push(...result.results.map((item) => ({ ...item, queryProvenance: sanitized.provenance })));
        searchCalls += result.searchCalls || 0; modelCalls += result.modelCalls || 0;
        tokenUsage.inputTokens += result.usage?.input_tokens || 0; tokenUsage.outputTokens += result.usage?.output_tokens || 0;
        try { reliability?.recordSuccess?.("public-web-search", { latencyMs: result.durationMs, noData: result.results.length === 0 }); } catch {}
      } catch (error) {
        if (input.signal?.aborted || error.name === "AbortError") {
          emit("research_cancelled", { researchId: request.researchId, queryCount: attempts.length });
          return cancelledPack(request, started, now, { attempts, results: all });
        }
        attempts.push({ queryFingerprint: sanitized.queryFingerprint, status: "FAILED", resultCount: 0, errorCode: String(error.code || error.name || "ERROR").slice(0, 80) });
        try { reliability?.recordFailure?.("public-web-search", error); } catch {}
      }
      if (all.length >= plan.sourceBudget.maxSources) break;
    }
    const evaluationStarted = now(); const deduped = new Map();
    for (const raw of all) { const evaluated = evaluator.evaluate(raw, request); if (!evaluated.accepted) { emit("research_source_rejected", { researchId: request.researchId, sourceType: evaluated.sourceType, reason: evaluated.rejectionReason }); continue; } const key = normalizeKey(evaluated.url); const existing = deduped.get(key); if (!existing || (evaluated.snippet && !existing.snippet)) deduped.set(key, evaluated); }
    const results = [...deduped.values()].slice(0, plan.sourceBudget.maxSources).map((item) => ({ ...item, evidenceId: `public_evidence_${hash(`${item.resultId}:${item.provenance.sourceFingerprint}`)}`, sourceId: item.url, locator: { url: item.url, passageRef: item.snippet ? `fingerprint:${hash(item.snippet, 32)}` : null }, provenance: { ...item.provenance, label: item.title, status: "current" }, sourceScope: "PUBLIC", profileScope: "public", localOnly: false, allowedForRemoteModel: true, untrustedContent: true }));
    const citations = results.map((item) => ({ citationId: `public_citation_${hash(item.url)}`, evidenceId: item.evidenceId, sourceTitle: item.title, url: item.url, domain: item.sourceDomain, publishedAt: item.publishedAt || null, updatedAt: item.updatedAt || null, retrievedAt: item.retrievedAt, passageRef: item.snippet ? `fingerprint:${hash(item.snippet, 32)}` : null }));
    const conflicts = detectConflicts(results); const successful = attempts.filter((item) => item.status === "OK").length; const failed = attempts.length - successful;
    const completeness = results.length === 0 ? "INSUFFICIENT" : failed || results.some((item) => item.freshness.stale) ? "PARTIAL" : "COMPLETE_ENOUGH";
    const status = results.length === 0 && failed ? "FAILED" : failed ? "PARTIAL" : "COMPLETED";
    const pack = { evidencePackId: `public_pack_${hash(`${request.researchId}:${results.map((item) => item.resultId).join(":")}`)}`, researchId: request.researchId, scope: "PUBLIC", query: request.query, mode: request.mode, state: status, completeness, confidence: confidence(results, conflicts, completeness), results, remoteResults: results, evidence: results, citations, conflicts, freshness: { requirement: request.freshnessRequirement, freshSources: results.filter((item) => item.freshness.level === "FRESH").length, staleSources: results.filter((item) => item.freshness.stale).length, unknownDateSources: results.filter((item) => item.freshness.level === "UNKNOWN").length }, sourceCoverage: { queriesExecuted: attempts.length, sourcesFound: all.length, sourcesUsed: results.length, sourceTypes: [...new Set(results.map((item) => item.sourceType))], unresolvedQuestions: attempts.filter((item) => item.status !== "OK").map((item) => item.queryFingerprint), failedQueries: attempts.filter((item) => item.status === "FAILED").map((item) => item.queryFingerprint), attempts }, providerFailures: attempts.filter((item) => item.status === "FAILED"), retrievedAt: new Date(now()).toISOString(), budget: { ...plan.sourceBudget, usedQueries: attempts.length, usedSources: results.length, searchCalls, modelCalls, tokenUsage }, latency: { planningMs, searchMs: attempts.reduce((sum, item) => sum + (item.durationMs || 0), 0), retrievalMs: 0, evaluationMs: now() - evaluationStarted, synthesisMs: 0, totalMs: now() - started }, cache: { status: cached.status, retrievedFresh: true }, message: status === "FAILED" ? "Je ne peux pas vérifier l’information actuelle pour le moment." : completeness === "PARTIAL" ? "La recherche est partielle ; certaines sources ou dates restent indisponibles." : null };
    if (status === "FAILED") emit("research_partial", { researchId: request.researchId, reason: "provider_failure", failedQueries: failed });
    emit("research_completed", { researchId: request.researchId, status, queryCount: attempts.length, sourceCount: results.length, sourceTypes: pack.sourceCoverage.sourceTypes, freshSources: pack.freshness.freshSources, staleSources: pack.freshness.staleSources, unknownDateSources: pack.freshness.unknownDateSources, durationMs: pack.latency.totalMs, searchCalls, modelCalls });
    if (status !== "FAILED") cache.set(request, adapter.provider || "provider", pack);
    return pack;
  }
  return { cache, research };
}

function cancelledPack(request, started, now, partial = {}) { return { evidencePackId: `public_pack_${hash(request.researchId)}`, researchId: request.researchId, scope: "PUBLIC", query: request.query, mode: request.mode, state: "CANCELLED", completeness: partial.results?.length ? "PARTIAL" : "INSUFFICIENT", confidence: "LOW", results: partial.results || [], remoteResults: partial.results || [], evidence: partial.results || [], citations: [], conflicts: [], sourceCoverage: { queriesExecuted: partial.attempts?.length || 0, sourcesFound: partial.results?.length || 0, sourcesUsed: partial.results?.length || 0, sourceTypes: [], unresolvedQuestions: [], failedQueries: [] }, providerFailures: [], retrievedAt: new Date(now()).toISOString(), budget: {}, latency: { totalMs: now() - started }, cache: { status: "BYPASS", retrievedFresh: false }, message: "Recherche annulée." }; }

module.exports = { createPublicResearchEngine };
