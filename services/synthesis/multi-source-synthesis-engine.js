"use strict";

const crypto = require("crypto");

const MODES = Object.freeze([
  "SUMMARY", "COMPARE", "TIMELINE", "CURRENT_STATE", "CONFLICT_ANALYSIS", "DECISION_HISTORY", "DIFF",
]);
const CONFLICT_TYPES = Object.freeze([
  "VALUE_CONFLICT", "VERSION_CONFLICT", "TEMPORAL_AMBIGUITY", "SOURCE_DISAGREEMENT", "STATUS_CONFLICT",
]);
const EXTERNAL_SOURCES = new Set(["email", "note", "file", "document"]);

function normalize(value) {
  return String(value || "").toLocaleLowerCase("fr").normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9._/-]+/g, " ").trim();
}

function hash(value, length = 24) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, length);
}

function timestamp(value) {
  const parsed = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function inferMode(query, requestedMode) {
  if (MODES.includes(requestedMode)) return requestedMode;
  const text = normalize(query);
  if (/\b(diff|difference|ajoute|supprime|modifie|change entre)\b/.test(text)) return "DIFF";
  if (/\b(compare|comparatif|versus| vs )\b/.test(` ${text} `)) return "COMPARE";
  if (/\b(chronologie|timeline|evolution|historique)\b/.test(text)) return "TIMELINE";
  if (/\b(decision|decide|garde|a partir de maintenant)\b/.test(text) && /\b(histoire|historique|tout|evolution)\b/.test(text)) return "DECISION_HISTORY";
  if (/\b(contradictions?|desaccords?|conflits?)\b/.test(text)) return "CONFLICT_ANALYSIS";
  if (/\b(actuel|actuelle|maintenant|configure|active|derniere version)\b/.test(text)) return "CURRENT_STATE";
  return "SUMMARY";
}

function queryAuthority(sourceType, query) {
  const text = normalize(query);
  if (/\b(config(?:uration)?|configuree?|implemente|code|technique|active?)\b/.test(text)) {
    return { file: 1, document: 0.95, project: 0.9, memory: 0.7, conversation: 0.62 }[sourceType] || 0.58;
  }
  if (/\b(demande|dit|parle|decision|historique|initialement)\b/.test(text)) {
    return { conversation: 1, memory: 0.9, email: 0.82, document: 0.75, file: 0.68 }[sourceType] || 0.6;
  }
  if (/\b(agenda|calendrier|prevu|aujourd hui|rendez vous)\b/.test(text)) {
    return { calendar: 1, reminder: 0.9, email: 0.68, conversation: 0.55 }[sourceType] || 0.52;
  }
  return { project: 0.95, file: 0.9, document: 0.9, memory: 0.88,
    conversation: 0.72, note: 0.72, email: 0.7, calendar: 0.65, reminder: 0.65 }[sourceType] || 0.5;
}

function evidenceStatus(result) {
  const status = normalize(result.provenance?.status || "current");
  if (["historical", "superseded", "archived"].includes(status)) return "historical";
  if (["candidate", "pending_review", "proposed", "draft"].includes(status)) return "proposed";
  if (["confirmed", "approved", "final", "current", "active"].includes(status)) return "current";
  return "unknown";
}

async function normalizeEvidence(pack, options, permissionValidator) {
  const startedAt = Date.now();
  const maxSources = Math.max(1, Math.min(40, Number(options.maxSources) || 20));
  const maxCharacters = Math.max(1000, Math.min(80_000, (Number(options.maxEvidenceTokens) || 6000) * 4));
  const results = options.purpose === "remote_model" ? pack.remoteResults || pack.results || [] : pack.results || [];
  const candidateCount = Math.max(1, Math.min(maxSources, results.length));
  const perEvidenceBudget = Math.max(200, Math.floor(maxCharacters / candidateCount));
  const evidence = [];
  let usedCharacters = 0;
  for (const result of results) {
    if (evidence.length >= maxSources) break;
    if (options.profileScope && result.profileScope !== options.profileScope) continue;
    if (options.projectScope && result.projectId && result.projectId !== options.projectScope) continue;
    if (options.purpose === "remote_model" && (result.localOnly || !result.allowedForRemoteModel)) continue;
    if (permissionValidator && !await permissionValidator(result, options)) continue;
    const remaining = maxCharacters - usedCharacters;
    if (remaining <= 0) break;
    const content = String(result.snippet || "").replace(/\s+/g, " ").trim().slice(0, Math.min(1600, perEvidenceBudget, remaining));
    if (!content) continue;
    usedCharacters += content.length;
    evidence.push({
      evidenceId: result.resultId || `evidence_${hash(`${result.sourceType}:${result.sourceId}:${content}`)}`,
      sourceType: result.sourceType,
      sourceId: result.sourceId,
      content,
      timestamp: result.timestamp || null,
      sourceAuthority: queryAuthority(result.sourceType, pack.query),
      searchScore: Number(result.score) || 0,
      status: evidenceStatus(result),
      rawStatus: result.provenance?.status || "current",
      version: result.provenance?.version || null,
      locator: result.locator || null,
      confidence: result.confidence || "low",
      projectScope: result.projectId || null,
      profileScope: result.profileScope || "arnaud",
      localOnly: result.localOnly === true,
      allowedForRemoteModel: result.allowedForRemoteModel !== false && result.localOnly !== true,
      derivedFrom: result.derivedFrom || result.provenance?.derivedFrom || null,
      contentFingerprint: result.contentFingerprint || hash(content, 40),
      untrustedContent: EXTERNAL_SOURCES.has(result.sourceType),
      provenance: result.provenance || { sourceType: result.sourceType, sourceId: result.sourceId },
    });
  }
  return { evidence, durationMs: Date.now() - startedAt, truncated: evidence.length < results.length || usedCharacters >= maxCharacters };
}

function canonicalSubject(value) {
  const text = normalize(value);
  if (/primary.?voice|voix principale|identite vocale/.test(text)) return "primary_voice";
  return text.replace(/\b(la|le|les|un|une|valeur|config|configuration)\b/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "statement";
}

function extractAtomicClaim(evidence, sentence, index) {
  const clean = String(sentence).trim();
  if (!clean) return null;
  let subject = ""; let value = ""; let predicate = "value";
  const assignment = clean.match(/^\s*([A-Za-zÀ-ÿ0-9_. -]{2,100})\s*(?:=|:|\best\b|\bdevient\b)\s*([^.;]{1,220})/i);
  if (assignment) {
    subject = canonicalSubject(assignment[1]); value = assignment[2].trim();
  } else if (/\b(voix|voice)\b/i.test(clean) && /\b(marin|cedar)\b/i.test(clean)) {
    subject = "primary_voice";
    value = clean.match(/\b(marin|cedar)\b/i)[1].toLowerCase();
  } else if (/\b(on garde|decision finale|a partir de maintenant|est annule|annule)\b/i.test(normalize(clean))) {
    subject = canonicalSubject(evidence.provenance?.label || evidence.sourceId);
    value = clean; predicate = "decision";
  } else {
    subject = canonicalSubject(evidence.provenance?.label || evidence.sourceId);
    value = clean; predicate = "states";
  }
  const proposed = evidence.status === "proposed" || /\b(propose|essai|essaie|pourrait|brouillon)\b/i.test(normalize(clean));
  return {
    claimId: `claim_${hash(`${evidence.evidenceId}:${index}:${subject}:${predicate}:${normalize(value)}`)}`,
    subject, predicate, value: value.slice(0, 500), normalizedValue: normalize(value),
    evidenceIds: [evidence.evidenceId], citationIds: [], effectiveAt: evidence.timestamp,
    confidence: evidence.confidence, status: proposed ? "proposed" : evidence.status,
    type: "direct", directness: assignment ? "explicit" : "stated",
    sourceAuthority: evidence.sourceAuthority,
    independentRoots: [evidence.derivedFrom || evidence.evidenceId],
    sourceTypes: [evidence.sourceType],
  };
}

function extractClaims(evidence) {
  const startedAt = Date.now();
  const claims = [];
  for (const item of evidence) {
    const sentences = item.content.split(/(?<=[.!?])\s+|\n+/).filter(Boolean).slice(0, 5);
    sentences.forEach((sentence, index) => {
      const claim = extractAtomicClaim(item, sentence, index);
      if (claim) claims.push(claim);
    });
  }
  return { claims, durationMs: Date.now() - startedAt };
}

function deduplicateClaims(claims) {
  const groups = new Map();
  for (const claim of claims) {
    const key = `${claim.subject}:${claim.predicate}:${claim.normalizedValue}`;
    const existing = groups.get(key);
    if (!existing) { groups.set(key, { ...claim }); continue; }
    existing.evidenceIds.push(...claim.evidenceIds);
    existing.independentRoots = [...new Set([...existing.independentRoots, ...claim.independentRoots])];
    existing.sourceTypes = [...new Set([...existing.sourceTypes, ...claim.sourceTypes])];
    existing.sourceAuthority = Math.max(existing.sourceAuthority, claim.sourceAuthority);
    if ((timestamp(claim.effectiveAt) || 0) > (timestamp(existing.effectiveAt) || 0)) existing.effectiveAt = claim.effectiveAt;
    if (existing.status !== "current" && claim.status === "current") existing.status = "current";
  }
  return [...groups.values()];
}

function citationMap(evidence) {
  const citations = [];
  const byEvidence = new Map();
  for (const item of evidence) {
    if (!item.locator) continue;
    const citation = {
      citationId: `citation_${hash(`${item.sourceType}:${item.sourceId}:${JSON.stringify(item.locator)}`)}`,
      evidenceId: item.evidenceId, sourceType: item.sourceType, sourceId: item.sourceId,
      label: item.provenance?.label || item.sourceId, locator: item.locator, timestamp: item.timestamp,
    };
    citations.push(citation); byEvidence.set(item.evidenceId, citation.citationId);
  }
  return { citations, byEvidence };
}

function isEvolution(group) {
  if (group.some((claim) => ["historical", "superseded"].includes(claim.status))) return true;
  const dates = group.map((claim) => timestamp(claim.effectiveAt));
  if (dates.every(Number.isFinite) && new Set(dates).size === dates.length) {
    const technicalCurrent = group.filter((claim) => claim.status === "current" &&
      claim.sourceTypes.some((source) => ["file", "document", "project"].includes(source)));
    return technicalCurrent.length <= 1;
  }
  return false;
}

function detectClaimConflicts(claims) {
  const startedAt = Date.now();
  const groups = new Map();
  for (const claim of claims.filter((item) => item.predicate !== "states")) {
    const key = `${claim.subject}:${claim.predicate}`;
    const values = groups.get(key) || []; values.push(claim); groups.set(key, values);
  }
  const conflicts = [];
  for (const [key, group] of groups) {
    if (new Set(group.map((claim) => claim.normalizedValue)).size < 2) continue;
    const statuses = new Set(group.map((claim) => claim.status));
    let type = "VALUE_CONFLICT"; let severity = "high"; let likelyResolution = null;
    if (statuses.has("proposed") && statuses.has("current")) {
      type = "STATUS_CONFLICT"; severity = "low";
      likelyResolution = group.find((claim) => claim.status === "current")?.claimId || null;
    } else if (isEvolution(group)) {
      continue;
    } else if (group.some((claim) => claim.version) && new Set(group.map((claim) => claim.version)).size > 1) {
      type = "VERSION_CONFLICT";
    } else if (group.every((claim) => claim.status === "current") &&
      group.every((claim) => claim.sourceTypes.some((source) => ["file", "document", "project"].includes(source)))) {
      type = "VALUE_CONFLICT";
    } else if (group.some((claim) => !timestamp(claim.effectiveAt))) {
      type = "TEMPORAL_AMBIGUITY";
    } else if (new Set(group.flatMap((claim) => claim.independentRoots)).size > 1) {
      type = "SOURCE_DISAGREEMENT";
    }
    conflicts.push({
      conflictId: `conflict_${hash(`${key}:${group.map((claim) => claim.claimId).join(":")}`)}`,
      subject: group[0].subject, claims: group.map((claim) => claim.claimId), type,
      severity, likelyResolution, confidence: severity === "low" ? "medium" : "high",
    });
  }
  return { conflicts, durationMs: Date.now() - startedAt };
}

function buildTimeline(claims) {
  return claims.filter((claim) => claim.effectiveAt).sort((a, b) => timestamp(a.effectiveAt) - timestamp(b.effectiveAt))
    .map((claim) => ({ date: claim.effectiveAt, event: claim.value, claimId: claim.claimId, evidenceIds: claim.evidenceIds }));
}

function confidenceFor(claims, conflicts) {
  if (!claims.length) return "low";
  if (conflicts.some((conflict) => conflict.severity === "high")) return "low";
  const independent = new Set(claims.flatMap((claim) => claim.independentRoots)).size;
  const authority = Math.max(...claims.map((claim) => claim.sourceAuthority));
  return independent >= 2 && authority >= 0.8 ? "high" : authority >= 0.65 ? "medium" : "low";
}

function selectCurrentState(claims, conflicts) {
  const unresolved = new Set(conflicts.filter((conflict) => !conflict.likelyResolution).flatMap((conflict) => conflict.claims));
  const candidates = claims.filter((claim) => claim.status === "current" && !unresolved.has(claim.claimId));
  if (!candidates.length) return null;
  const best = [...candidates].sort((a, b) => b.sourceAuthority - a.sourceAuthority ||
    (timestamp(b.effectiveAt) || 0) - (timestamp(a.effectiveAt) || 0))[0];
  return { value: best.value, subject: best.subject, effectiveAt: best.effectiveAt,
    confidence: confidenceFor([best], []), supportingEvidence: best.evidenceIds, claimId: best.claimId };
}

function buildDiff(claims) {
  const sorted = [...claims].sort((a, b) => (timestamp(a.effectiveAt) || 0) - (timestamp(b.effectiveAt) || 0));
  if (sorted.length < 2) return { added: [], removed: [], changed: [], unchangedSummary: [] };
  const first = sorted[0]; const last = sorted[sorted.length - 1];
  return { added: [], removed: [], changed: first.normalizedValue === last.normalizedValue ? [] : [{ subject: last.subject,
    from: first.value, to: last.value, evidenceIds: [...first.evidenceIds, ...last.evidenceIds] }],
    unchangedSummary: first.normalizedValue === last.normalizedValue ? [last.value] : [] };
}

function buildAnswer({ mode, claims, conflicts, currentState, timeline, limitations }) {
  if (!claims.length) return "Je n’ai pas trouvé assez de preuves pour produire une synthèse fiable.";
  const lines = [];
  if (currentState && ["CURRENT_STATE", "SUMMARY", "DECISION_HISTORY"].includes(mode)) lines.push(`État actuel : ${currentState.value}`);
  const keyClaims = claims.filter((claim) => claim.status !== "proposed").slice(0, 5);
  if (keyClaims.length) lines.push(`Points essentiels : ${keyClaims.map((claim) => claim.value).join(" · ")}`);
  if (["TIMELINE", "DECISION_HISTORY"].includes(mode) && timeline.length) lines.push(`Évolution : ${timeline.map((item) => `${item.date} — ${item.event}`).join(" → ")}`);
  if (conflicts.length) lines.push(`Contradictions : ${conflicts.length} désaccord(s) non masqué(s).`);
  else lines.push("Contradiction active : aucune détectée dans les preuves disponibles.");
  if (limitations.length) lines.push(`Limites : ${limitations.join(" ")}`);
  return lines.join("\n\n");
}

function createMultiSourceSynthesisEngine({ metrics = null, audit = null, permissionValidator = null,
  inferenceBuilder = null, policyVersion = "synthesis-v1", cacheTtlMs = 30_000 } = {}) {
  const cache = new Map(); const evidenceRegistry = new Map();
  function metric(name, value = 1, dimensions = {}) { metrics?.record?.(name, value, dimensions); }

  async function synthesize(pack = {}, options = {}) {
    const startedAt = Date.now();
    const mode = inferMode(pack.query, options.mode);
    metric("synthesis_started", 1, { mode });
    audit?.("synthesis.started", { mode, sourceCount: (pack.results || []).length });
    const normalized = await normalizeEvidence(pack, options, permissionValidator);
    const evidenceSetFingerprint = hash(JSON.stringify(normalized.evidence.map((item) =>
      [item.evidenceId, item.contentFingerprint, item.status, item.version, item.allowedForRemoteModel])));
    const cacheKey = hash(JSON.stringify({ query: pack.query, mode, evidenceSetFingerprint, policyVersion,
      purpose: options.purpose || "local", profileScope: options.profileScope, projectScope: options.projectScope }));
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return { ...structuredClone(cached.value), cacheHit: true };

    for (const evidence of normalized.evidence) evidenceRegistry.set(evidence.evidenceId, evidence);
    const extracted = extractClaims(normalized.evidence);
    let claims = deduplicateClaims(extracted.claims);
    if (inferenceBuilder) {
      const inferred = await inferenceBuilder({ query: pack.query, evidence: normalized.evidence, claims });
      for (const inference of inferred || []) {
        const basedOn = (inference.basedOn || []).filter((id) => evidenceRegistry.has(id));
        if (!basedOn.length) continue;
        claims.push({ claimId: `claim_${hash(`inference:${inference.statement}:${basedOn.join(":")}`)}`,
          subject: canonicalSubject(inference.subject || "inference"), predicate: inference.predicate || "inferred",
          value: String(inference.statement).slice(0, 500), normalizedValue: normalize(inference.statement),
          evidenceIds: basedOn, citationIds: [], effectiveAt: null, confidence: inference.confidence || "low",
          status: "unknown", type: "inference", directness: "inferred", sourceAuthority: 0,
          independentRoots: basedOn, basedOn });
      }
    }
    const mapped = citationMap(normalized.evidence);
    claims = claims.map((claim) => ({ ...claim,
      citationIds: claim.evidenceIds.map((id) => mapped.byEvidence.get(id)).filter(Boolean),
      directCitation: claim.type === "direct" }));
    const conflictsResult = detectClaimConflicts(claims.filter((claim) => claim.type === "direct"));
    const timeline = buildTimeline(claims.filter((claim) => claim.type === "direct"));
    const currentState = selectCurrentState(claims.filter((claim) => claim.type === "direct"), conflictsResult.conflicts);
    const coverage = Array.isArray(pack.sourceCoverage)
      ? pack.sourceCoverage
      : Array.isArray(pack.sourceCoverage?.attempts)
        ? pack.sourceCoverage.attempts.map((item) => ({ source: item.queryFingerprint, status: item.status === "OK" ? "ok" : "failed" }))
        : [];
    const failed = coverage.filter((source) => source.status !== "ok");
    const limitations = [];
    if (failed.length) limitations.push(`Synthèse partielle : ${failed.map((source) => `${source.source} (${source.status})`).join(", ")}.`);
    if (normalized.truncated) limitations.push("Le budget de preuves a limité le nombre de passages analysés.");
    if (!normalized.evidence.length) limitations.push("Aucune preuve autorisée et exploitable n’était disponible.");
    const confidence = confidenceFor(claims, conflictsResult.conflicts);
    const result = {
      synthesisId: `synthesis_${cacheKey}`,
      evidenceSetFingerprint, mode,
      answer: buildAnswer({ mode, claims, conflicts: conflictsResult.conflicts, currentState, timeline, limitations }),
      keyPoints: claims.filter((claim) => claim.status !== "proposed").slice(0, 8).map((claim) => ({
        text: claim.type === "inference" ? `J’en déduis que ${claim.value}` : claim.value,
        claimId: claim.claimId, citationIds: claim.citationIds, type: claim.type,
      })),
      claims, conflicts: conflictsResult.conflicts, timeline,
      citations: mapped.citations, sourceCoverage: coverage,
      sourcesUsed: [...new Set(normalized.evidence.map((item) => item.sourceType))],
      currentState, diff: mode === "DIFF" ? buildDiff(claims) : null,
      confidence, limitations,
      metrics: {
        evidenceNormalizationMs: normalized.durationMs,
        claimProcessingMs: extracted.durationMs,
        conflictDetectionMs: conflictsResult.durationMs,
        modelSynthesisMs: 0,
        totalMs: Date.now() - startedAt,
        rawEvidenceCharacters: (pack.results || []).reduce((sum, item) => sum + String(item.snippet || "").length, 0),
        compactEvidenceCharacters: normalized.evidence.reduce((sum, item) => sum + item.content.length, 0),
      },
      cacheHit: false,
    };
    metric("synthesis_completed", 1, { mode });
    metric("synthesis_sources_used", result.sourcesUsed.length, { mode });
    metric("synthesis_claims_count", claims.length, { mode });
    metric("synthesis_conflicts_count", result.conflicts.length, { mode });
    metric("synthesis_total_ms", result.metrics.totalMs, { mode });
    metric("synthesis_confidence_level", 1, { level: confidence });
    if (result.conflicts.length) metric("syntheses_with_conflicts", 1, { mode });
    audit?.("synthesis.completed", { mode, sourceCount: result.sourcesUsed.length, claimCount: claims.length,
      conflictCount: result.conflicts.length, confidence, durationMs: result.metrics.totalMs,
      evidenceSetFingerprint });
    cache.set(cacheKey, { expiresAt: Date.now() + cacheTtlMs, value: result });
    if (cache.size > 50) cache.delete(cache.keys().next().value);
    return result;
  }

  async function drillDown(evidenceId, options = {}) {
    const evidence = evidenceRegistry.get(String(evidenceId));
    if (!evidence) return null;
    if (permissionValidator && !await permissionValidator(evidence, options)) return null;
    if (options.purpose === "remote_model" && (evidence.localOnly || !evidence.allowedForRemoteModel)) return null;
    return structuredClone(evidence);
  }

  function invalidate() { cache.clear(); evidenceRegistry.clear(); }
  return { drillDown, inferMode, invalidate, modes: MODES, synthesize };
}

module.exports = {
  CONFLICT_TYPES, MODES, createMultiSourceSynthesisEngine, inferMode,
  normalizeEvidence, queryAuthority,
};
