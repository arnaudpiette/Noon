"use strict";

const crypto = require("crypto");

const SOURCE_TYPES = Object.freeze([
  "conversation", "memory", "project", "file", "note", "reminder", "email", "calendar", "document", "media",
]);
const SEARCH_INTENTS = Object.freeze([
  "EXACT_LOOKUP", "SEMANTIC_LOOKUP", "HISTORY_LOOKUP", "PROJECT_LOOKUP", "SOURCE_LOOKUP",
]);
const AUTHORITY = Object.freeze({
  project: 0.95, file: 0.9, document: 0.9, memory: 0.88,
  media: 0.86,
  conversation: 0.72, note: 0.72, email: 0.7, calendar: 0.65, reminder: 0.65,
});
const TOKEN_SYNONYMS = Object.freeze({
  accord: ["confirmation", "approbation", "validation"],
  confirmation: ["accord", "approbation", "validation"],
  voix: ["vocale", "voice", "speech"],
  priorité: ["priority", "priorities", "priorisation"],
  historique: ["conversation", "ancien", "avant"],
  fichier: ["file", "document", "code"],
});

function normalizeText(value) {
  return String(value || "").toLocaleLowerCase("fr").normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9._/-]+/g, " ").trim();
}
function tokens(value) { return [...new Set(normalizeText(value).match(/[a-z0-9_.$/-]{2,}/g) || [])]; }
function inferIntent(query, requestedIntent) {
  if (SEARCH_INTENTS.includes(requestedIntent)) return requestedIntent;
  const text = normalizeText(query);
  if (/\b(avant|ancien|historique|conversation|on avait|parle)\b/.test(text)) return "HISTORY_LOOKUP";
  if (/\b(projet|focus|repository|repo)\b/.test(text)) return "PROJECT_LOOKUP";
  if (/\b(email|mail|gmail|note|rappel|agenda|calendar|fichier|code|document)\b/.test(text)) return "SOURCE_LOOKUP";
  if (/^[a-z0-9_.$/-]{2,40}$/i.test(String(query).trim()) || /["“”]/.test(String(query))) return "EXACT_LOOKUP";
  return "SEMANTIC_LOOKUP";
}
function selectSources(query, intent, requested = []) {
  const allowed = new Set(SOURCE_TYPES);
  const explicit = [...new Set(requested.filter((source) => allowed.has(source)))];
  if (explicit.length) return { primary: explicit, expansion: [] };
  const text = normalizeText(query);
  const primary = [];
  if (/\b(email|mail|gmail|expediteur|sender|thread)\b/.test(text)) primary.push("email");
  if (/\b(note|notes)\b/.test(text)) primary.push("note");
  if (/\b(rappel|reminder)\b/.test(text)) primary.push("reminder");
  if (/\b(agenda|calendar|calendrier|rendez-vous|reunion)\b/.test(text)) primary.push("calendar");
  if (/\b(image|capture|screenshot|audio|transcription|media|média|pdf)\b/.test(text)) primary.push("media");
  if (/\b(fichier|file|code|fonction|classe|route|variable|document|pdf|docx)\b/.test(text) || intent === "PROJECT_LOOKUP") primary.push("project", "file");
  if (intent === "HISTORY_LOOKUP") primary.push("conversation", "memory");
  if (!primary.length) primary.push("conversation", "memory");
  const expansion = primary.some((source) => ["file", "project"].includes(source))
    ? ["conversation", "memory"] : ["project", "file"];
  return { primary: [...new Set(primary)], expansion: [...new Set(expansion.filter((source) => !primary.includes(source)))] };
}
function lexicalScore(query, result, intent, context = {}) {
  const normalizedQuery = normalizeText(query); const queryTokens = tokens(query);
  const expanded = new Set(queryTokens);
  for (const token of queryTokens) for (const synonym of TOKEN_SYNONYMS[token] || []) expanded.add(normalizeText(synonym));
  const title = normalizeText(result.title); const snippet = normalizeText(result.snippet);
  const haystack = `${title} ${snippet}`;
  let score = 0;
  if (title === normalizedQuery) score += 0.55;
  else if (title.includes(normalizedQuery) || snippet.includes(normalizedQuery)) score += 0.4;
  const matches = [...expanded].filter((token) => haystack.includes(token)).length;
  score += expanded.size ? 0.35 * matches / expanded.size : 0;
  score += 0.12 * (result.sourceAuthority ?? AUTHORITY[result.sourceType] ?? 0.5);
  if (context.projectId && result.projectId === context.projectId) score += 0.15;
  if (result.sourceType === "memory" && result.provenance?.status === "confirmed") score += 0.12;
  if (result.sourceType === "memory" && ["candidate", "pending_review", "historical"].includes(result.provenance?.status)) score -= 0.08;
  if (intent === "HISTORY_LOOKUP" && ["conversation", "memory"].includes(result.sourceType)) score += 0.08;
  if (intent === "EXACT_LOOKUP" && (title.includes(normalizedQuery) || snippet.includes(normalizedQuery))) score += 0.1;
  return clamp(score, 0, 1);
}
function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, value)); }
function normalizeResult(raw, sourceType) {
  if (!SOURCE_TYPES.includes(sourceType)) throw new Error(`Source de recherche invalide : ${sourceType}`);
  const sourceId = String(raw.sourceId || raw.id || "").slice(0, 500);
  const locator = raw.locator && typeof raw.locator === "object" ? raw.locator : null;
  return {
    resultId: raw.resultId || `search_${crypto.createHash("sha256").update(`${sourceType}:${sourceId}:${raw.timestamp || ""}`).digest("hex").slice(0, 24)}`,
    sourceType, sourceId, title: String(raw.title || sourceType).slice(0, 300),
    snippet: String(raw.snippet || "").replace(/\s+/g, " ").trim().slice(0, 1200),
    score: 0, confidence: "low", timestamp: raw.timestamp || null,
    projectId: raw.projectId || null, profileScope: raw.profileScope || "arnaud",
    canonicalKey: raw.canonicalKey || null,
    provenance: { sourceType, sourceId, label: String(raw.provenance?.label || raw.title || sourceType).slice(0, 300),
      status: raw.provenance?.status || "current", version: raw.provenance?.version || null },
    accessLevel: raw.accessLevel || "read", sensitivity: raw.sensitivity || "normal",
    localOnly: raw.localOnly === true, allowedForRemoteModel: raw.allowedForRemoteModel !== false && raw.localOnly !== true,
    locator, sourceAuthority: raw.sourceAuthority ?? AUTHORITY[sourceType] ?? 0.5,
    derivedFrom: raw.derivedFrom || raw.provenance?.derivedFrom || null,
    documentHierarchy: raw.documentHierarchy || null,
    contentFingerprint: raw.contentFingerprint || crypto.createHash("sha256").update(`${raw.title || ""}:${raw.snippet || ""}`).digest("hex"),
  };
}
function deduplicateResults(results) {
  const groups = new Map();
  for (const result of results) {
    const key = normalizeText(result.canonicalKey || `${result.title}:${result.snippet}`).slice(0, 220);
    const existing = groups.get(key);
    if (!existing) { groups.set(key, { ...result, supportingSources: [] }); continue; }
    const canonical = result.score > existing.score ? result : existing;
    const support = result.score > existing.score ? existing : result;
    groups.set(key, { ...canonical, supportingSources: [...(canonical.supportingSources || []), {
      sourceType: support.sourceType, sourceId: support.sourceId, locator: support.locator,
      timestamp: support.timestamp, provenance: support.provenance,
    }] });
  }
  return { results: [...groups.values()], dedupedCount: results.length - groups.size };
}
function detectConflicts(results) {
  const byTitle = new Map();
  for (const result of results) {
    const key = normalizeText(result.title); if (!key) continue;
    const values = byTitle.get(key) || []; values.push(result); byTitle.set(key, values);
  }
  return [...byTitle.entries()].filter(([, values]) => values.length > 1 && new Set(values.map((item) => normalizeText(item.snippet))).size > 1)
    .map(([topic, values]) => ({ topic, status: "unresolved", results: values.map((item) => item.resultId),
      currentCandidate: [...values].sort((a, b) => b.score - a.score || String(b.timestamp || "").localeCompare(String(a.timestamp || "")))[0].resultId }));
}

function createPersonalSearchEngine({ adapters = {}, metrics = null, audit = null, now = () => Date.now(),
  reliability = null, perSourceTimeoutMs = 2500, overallTimeoutMs = 6000, cacheTtlMs = 30_000, maxConcurrency = 3 } = {}) {
  const cache = new Map();
  function safeMetric(metric, value = 1, dimensions = {}) { metrics?.record?.(metric, value, dimensions); }
  async function versionOf(source) {
    try { return String(await adapters[source]?.version?.() || "dynamic"); } catch { return "unavailable"; }
  }
  async function runSource(source, request, deadline) {
    const componentId = source === "email" ? "gmail" : source === "calendar" ? "google-calendar" : ["file", "document"].includes(source) ? "filesystem" : null;
    const adapter = adapters[source];
    if (!adapter?.search) return { source, status: "unsupported", results: [], durationMs: 0 };
    if (adapter.isAuthorized && !await adapter.isAuthorized(request)) {
      if (componentId) try { reliability?.recordFailure(componentId, Object.assign(new Error("Authorization required"), { status: 401 })); } catch {}
      return { source, status: "unauthorized", reasonCode: "AUTH_REQUIRED", results: [], durationMs: 0 };
    }
    const startedAt = now();
    const remaining = Math.max(1, Math.min(perSourceTimeoutMs, deadline - now()));
    let timeoutId = null;
    try {
      const raw = await Promise.race([
        Promise.resolve(adapter.search(request)),
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => reject(Object.assign(new Error("Search timeout"), { code: "SEARCH_TIMEOUT" })), remaining);
        }),
      ]);
      clearTimeout(timeoutId);
      const results = (Array.isArray(raw) ? raw : raw?.results || []).slice(0, request.resultsPerSource).map((item) => normalizeResult(item, source));
      const durationMs = now() - startedAt; safeMetric(`${source}_search_ms`, durationMs);
      if (componentId) try { reliability?.recordSuccess(componentId, { latencyMs: durationMs, noData: results.length === 0 }); } catch {}
      return { source, status: "ok", results, durationMs };
    } catch (error) {
      clearTimeout(timeoutId);
      const durationMs = now() - startedAt; safeMetric(`${source}_search_ms`, durationMs);
      let normalized = null; if (componentId) try { normalized = reliability?.recordFailure(componentId, error, { latencyMs: durationMs }); } catch {}
      return { source, status: error.code === "SEARCH_TIMEOUT" ? "timeout" : "failed", reasonCode: normalized?.category || null, results: [], durationMs, errorCode: String(error.code || error.name || "ERROR").slice(0, 80) };
    }
  }
  async function runSources(sources, request, deadline) {
    const output = [];
    for (let index = 0; index < sources.length; index += maxConcurrency) {
      output.push(...await Promise.all(sources.slice(index, index + maxConcurrency).map((source) => runSource(source, request, deadline))));
      if (now() >= deadline) break;
    }
    return output;
  }
  async function search(input = {}) {
    const startedAt = now();
    const request = {
      query: String(input.query || "").trim().slice(0, 500),
      intent: inferIntent(input.query, input.intent),
      sourceScopes: Array.isArray(input.sourceScopes) ? input.sourceScopes : [],
      projectId: input.projectId || null,
      workspaceId: input.workspaceId || null,
      workspaceProjectIds: Array.isArray(input.workspaceProjectIds) ? input.workspaceProjectIds.map(String) : [],
      projectPath: input.projectPath || null,
      profileScope: String(input.profileScope || "arnaud").slice(0, 80),
      timeRange: input.timeRange || null,
      maxResults: clamp(Number(input.maxResults) || 10, 1, 30),
      resultsPerSource: clamp(Number(input.resultsPerSource) || 6, 1, 10),
      semantic: input.semantic !== false, exactTerms: Array.isArray(input.exactTerms) ? input.exactTerms.slice(0, 10) : [],
      privacyContext: input.privacyContext || {}, conversationId: input.conversationId || null,
      globalSearch: input.globalSearch === true,
    };
    if (!request.query) throw new TypeError("Requête de recherche vide.");
    const selection = selectSources(request.query, request.intent, request.sourceScopes);
    if (request.globalSearch) selection.expansion = SOURCE_TYPES.filter((source) => !selection.primary.includes(source));
    const versions = Object.fromEntries(await Promise.all([...selection.primary, ...selection.expansion]
      .map(async (source) => [source, await versionOf(source)])));
    const cacheKey = crypto.createHash("sha256").update(JSON.stringify({ request, versions })).digest("hex");
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > now()) return { ...structuredClone(cached.value), cacheHit: true };
    safeMetric("search_started", 1); audit?.("search.started", { intent: request.intent,
      profileScope: request.profileScope, sourceCount: selection.primary.length, queryFingerprint: cacheKey.slice(0, 16) });
    const deadline = startedAt + overallTimeoutMs;
    let attempts = await runSources(selection.primary, request, deadline);
    let rawResults = attempts.flatMap((attempt) => attempt.results);
    if (!rawResults.length && selection.expansion.length && now() < deadline) {
      const expanded = await runSources(selection.expansion, request, deadline);
      attempts = [...attempts, ...expanded]; rawResults = attempts.flatMap((attempt) => attempt.results);
    }
    const filtered = rawResults.filter((result) => result.profileScope === request.profileScope ||
      (request.profileScope === "projects" && String(result.profileScope).startsWith("project:")))
      .filter((result) => !request.workspaceId || request.globalSearch || !result.projectId || request.workspaceProjectIds.includes(result.projectId))
      .filter((result) => !request.projectId || request.globalSearch || !result.projectId || result.projectId === request.projectId)
      .map((result) => {
        const score = lexicalScore(request.query, result, request.intent, request);
        return { ...result, score: Number(score.toFixed(4)), confidence: score >= 0.72 ? "high" : score >= 0.45 ? "medium" : "low" };
      }).filter((result) => result.score >= 0.12)
      .sort((left, right) => right.score - left.score || right.sourceAuthority - left.sourceAuthority || String(right.timestamp || "").localeCompare(String(left.timestamp || "")));
    const deduped = deduplicateResults(filtered);
    const results = deduped.results.slice(0, request.maxResults);
    const citations = results.filter((result) => result.locator).map((result) => ({
      resultId: result.resultId,
      sourceType: result.sourceType, sourceId: result.sourceId, label: result.provenance.label,
      locator: result.locator, timestamp: result.timestamp,
    }));
    const pack = {
      query: request.query, intent: request.intent, results,
      remoteResults: results.filter((result) => result.allowedForRemoteModel), citations,
      unresolvedConflicts: detectConflicts(results),
      sourceCoverage: attempts.map(({ source, status, reasonCode, durationMs, results: values }) => ({ source, status, reasonCode: reasonCode || null, durationMs, resultCount: values.length })),
      sourcesAttempted: attempts.length, sourcesSucceeded: attempts.filter((item) => item.status === "ok").length,
      sourcesFailed: attempts.filter((item) => item.status !== "ok").length,
      dedupedCount: deduped.dedupedCount, resultCount: results.length,
      timeToFirstResultMs: results.length ? Math.min(...attempts.filter((item) => item.results.length).map((item) => item.durationMs)) : null,
      totalMs: now() - startedAt, status: results.length ? "found" : "no_result",
      message: results.length ? null : "Je n’ai rien trouvé dans les sources recherchées.", cacheHit: false,
    };
    pack.sourceCoverageSummary = reliability?.sourceCoverage?.(
      attempts.map((item) => item.source), attempts.map((item) => ({ ...item, resultCount: item.results.length }))
    ) || null;
    if (!results.length && pack.sourcesFailed > 0) {
      pack.status = "unavailable";
      pack.message = "Je n’ai pas pu vérifier toutes les sources demandées.";
    } else if (pack.sourcesFailed > 0) {
      pack.status = "partial";
      pack.message = "Résultats partiels : certaines sources n’ont pas pu être vérifiées.";
    }
    safeMetric("search_completed", 1); safeMetric("search_sources_attempted", pack.sourcesAttempted);
    safeMetric("search_sources_succeeded", pack.sourcesSucceeded); safeMetric("search_sources_failed", pack.sourcesFailed);
    safeMetric("search_results_count", pack.resultCount); safeMetric("search_deduped_count", pack.dedupedCount);
    safeMetric("search_total_ms", pack.totalMs);
    audit?.("search.completed", { intent: request.intent, sourceCount: pack.sourcesAttempted,
      succeeded: pack.sourcesSucceeded, failed: pack.sourcesFailed, resultCount: pack.resultCount,
      dedupedCount: pack.dedupedCount, durationMs: pack.totalMs, queryFingerprint: cacheKey.slice(0, 16) });
    cache.set(cacheKey, { expiresAt: now() + cacheTtlMs, value: pack });
    if (cache.size > 50) cache.delete(cache.keys().next().value);
    return pack;
  }
  function invalidate() { cache.clear(); }
  function toRemoteEvidence(pack = {}) {
    const remoteIds = new Set((pack.remoteResults || []).map((result) => result.resultId));
    return {
      intent: pack.intent,
      status: pack.status,
      message: pack.message,
      results: pack.remoteResults || [],
      citations: (pack.citations || []).filter((citation) => remoteIds.has(citation.resultId)),
      unresolvedConflicts: (pack.unresolvedConflicts || []).filter((conflict) =>
        conflict.results.every((resultId) => remoteIds.has(resultId))),
      sourceCoverage: pack.sourceCoverage || [],
      sourceCoverageSummary: pack.sourceCoverageSummary || null,
    };
  }
  return { invalidate, search, selectSources, toRemoteEvidence, sourceTypes: SOURCE_TYPES, intents: SEARCH_INTENTS };
}

module.exports = { AUTHORITY, SEARCH_INTENTS, SOURCE_TYPES, createPersonalSearchEngine,
  deduplicateResults, detectConflicts, inferIntent, lexicalScore, normalizeResult,
  normalizeText, selectSources, tokens };
