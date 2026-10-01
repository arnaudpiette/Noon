"use strict";

// A3 : cette façade ne possède ni données ni autorité d'action. Elle décide
// d'abord quelles lectures minimales sont utiles, puis appelle uniquement les
// adapters injectés par la composition applicative.

const SOURCE_STATUSES = Object.freeze({
  AVAILABLE: "AVAILABLE", UNAVAILABLE: "UNAVAILABLE", UNAUTHORIZED: "UNAUTHORIZED",
  NOT_CONFIGURED: "NOT_CONFIGURED", ERROR: "ERROR", SKIPPED_NOT_RELEVANT: "SKIPPED_NOT_RELEVANT",
});
const SYSTEM_PERMISSION_STATUSES = Object.freeze({
  TCC_UNVERIFIED: "TCC_UNVERIFIED",
});
const SOURCE_LIMITS = Object.freeze({ notes: 3, reminders: 5, calendar: 5, gmail: 3, files: 3, git: 1, execution: 4 });
const DEFAULT_SOURCE_TIMEOUT_MS = 5_000;

function normalize(value) {
  return String(value || "").toLocaleLowerCase("fr").normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}
function matches(text, expression) { return expression.test(normalize(text)); }
function sourceSelection({ query = "", intent = "", projectId = null, entityStatus = "NOT_FOUND" } = {}) {
  const text = normalize(query); const selected = new Set();
  const schedule = matches(text, /\b(agenda|calendrier|calendar|rendez vous|reunion|cet apres midi|aujourd hui|demain|hier|avant hier|apres demain|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|planning)\b/) || intent === "SCHEDULE";
  const email = matches(text, /\b(email|e mail|mail|gmail|recu|reponse)\b/) || intent === "EMAIL";
  const notes = matches(text, /\b(note|notes)\b/) || intent === "NOTES";
  const reminders = matches(text, /\b(rappel|reminder|tache|todo|a faire)\b/) || intent === "TASKS";
  const files = matches(text, /\b(fichier|file|document|pdf|docx)\b/) || intent === "FILES";
  const repository = matches(text, /\b(code|repo|repository|git|branche|commit)\b/) || intent === "REPOSITORY";
  const execution = matches(text, /\b(continue|ou en est|etat|bloque|bloquee|en attente|execution|action)\b/) || intent === "EXECUTION";
  if (schedule) { selected.add("calendar"); selected.add("reminders"); selected.add("execution"); }
  if (email) selected.add("gmail");
  if (notes) selected.add("notes");
  if (reminders) selected.add("reminders");
  if (files) selected.add("files");
  if (repository) { selected.add("git"); selected.add("execution"); }
  if (execution || projectId) { selected.add("execution"); if (projectId || repository) selected.add("git"); }
  // Une entité non résolue ne donne jamais licence à une recherche globale.
  if (entityStatus === "AMBIGUOUS" || entityStatus === "NOT_FOUND") {
    if (!files) selected.delete("files");
    if (!repository) selected.delete("git");
    if (entityStatus === "AMBIGUOUS" && !schedule && !email && !reminders) selected.delete("execution");
  }
  return [...selected];
}

function safeStatus(adapter, input) {
  try {
    const value = adapter?.status?.(input) || SOURCE_STATUSES.AVAILABLE;
    if (value && typeof value === "object") {
      return {
        status: Object.values(SOURCE_STATUSES).includes(value.status) ? value.status : SOURCE_STATUSES.ERROR,
        systemPermission: value.systemPermission === SYSTEM_PERMISSION_STATUSES.TCC_UNVERIFIED
          ? value.systemPermission : null,
      };
    }
    return { status: Object.values(SOURCE_STATUSES).includes(value) ? value : SOURCE_STATUSES.ERROR, systemPermission: null };
  } catch { return { status: SOURCE_STATUSES.ERROR, systemPermission: null }; }
}
function normalizeItem(sourceType, item, fallback = {}) {
  const payload = item?.payload && typeof item.payload === "object" ? item.payload : item || {};
  return {
    sourceType, sourceId: String(item?.sourceId || item?.id || fallback.id || "").slice(0, 160),
    entityId: item?.entityId || null, projectId: item?.projectId || fallback.projectId || null,
    timestamp: item?.timestamp || item?.dueAt || item?.updatedAt || null,
    relevance: Math.max(0, Math.min(1, Number(item?.relevance ?? fallback.relevance ?? 0.5))),
    privacyClass: item?.privacyClass || fallback.privacyClass || "PERSONAL",
    localOnly: item?.localOnly === true || fallback.localOnly === true,
    allowedForRemoteModel: item?.allowedForRemoteModel === true && item?.localOnly !== true,
    canonicalKey: String(item?.canonicalKey || payload.canonicalKey || payload.eventId || "").slice(0, 240) || null,
    payload,
  };
}

function deduplicateItems(items) {
  const kept = new Map();
  for (const item of items) {
    // Cross-source deduplication is deliberately conservative: only an
    // explicit canonical identity can merge two independently read records.
    const key = item.canonicalKey ? `canonical:${item.canonicalKey}` : null;
    if (!key) { kept.set(`source:${item.sourceType}:${item.sourceId}`, item); continue; }
    const existing = kept.get(key);
    if (!existing || item.relevance > existing.relevance || (item.relevance === existing.relevance && String(item.timestamp || "") > String(existing.timestamp || ""))) {
      kept.set(key, item);
    }
  }
  return [...kept.values()];
}

function createAuthorizedContextSources({ adapters = {}, now = () => new Date(), observability = null, sourceTimeoutMs = DEFAULT_SOURCE_TIMEOUT_MS, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout } = {}) {
  async function collect(input = {}) {
    const selected = sourceSelection(input);
    const diagnostics = Object.fromEntries(Object.keys(SOURCE_LIMITS).map((source) => [source, {
      selected: selected.includes(source), status: selected.includes(source) ? null : SOURCE_STATUSES.SKIPPED_NOT_RELEVANT, reasonCode: null, systemPermission: null, count: 0, truncated: false, durationMs: 0,
    }]));
    const reads = selected.map(async (source) => {
      const adapter = adapters[source]; const diagnostic = diagnostics[source];
      if (!adapter) { diagnostic.status = SOURCE_STATUSES.UNAVAILABLE; return []; }
      const status = safeStatus(adapter, input);
      diagnostic.systemPermission = status.systemPermission;
      if (status.status !== SOURCE_STATUSES.AVAILABLE) { diagnostic.status = status.status; return []; }
      const startedAt = performance.now();
      const effectiveTimeoutMs = sourceTimeoutMs;
      try {
        const controller = new AbortController();
        let timeoutId = null;
        const raw = await Promise.race([
          Promise.resolve(adapter.read({ ...input, source, limit: SOURCE_LIMITS[source], now: now(), signal: controller.signal, timeoutMs: effectiveTimeoutMs })),
          new Promise((_, reject) => {
            timeoutId = setTimeoutFn(() => {
              const error = Object.assign(new Error("Authorized context source timeout"), { code: "CONTEXT_SOURCE_TIMEOUT" });
              controller.abort(error);
              reject(error);
            }, effectiveTimeoutMs);
          }),
        ]).finally(() => clearTimeoutFn(timeoutId));
        const values = Array.isArray(raw?.items) ? raw.items : Array.isArray(raw) ? raw : [];
        diagnostic.status = SOURCE_STATUSES.AVAILABLE;
        diagnostic.truncated = raw?.truncated === true || values.length > SOURCE_LIMITS[source];
        diagnostic.count = Math.min(values.length, SOURCE_LIMITS[source]);
        diagnostic.durationMs = Math.round(performance.now() - startedAt);
        return values.slice(0, SOURCE_LIMITS[source]).map((item) => normalizeItem(source, item, { projectId: input.projectId }))
          .filter((item) => !input.projectId || !item.projectId || item.projectId === input.projectId);
      } catch (error) {
        diagnostic.status = error?.status === 401 || error?.status === 403 ? SOURCE_STATUSES.UNAUTHORIZED : SOURCE_STATUSES.ERROR;
        diagnostic.reasonCode = error?.code || "CONTEXT_SOURCE_ERROR";
        diagnostic.durationMs = Math.round(performance.now() - startedAt);
        return [];
      } finally {
        observability?.("context.source", { source, selected: true, status: diagnostic.status, count: diagnostic.count, truncated: diagnostic.truncated, durationMs: diagnostic.durationMs });
      }
    });
    const collected = (await Promise.all(reads)).flat().sort((a, b) => b.relevance - a.relevance || String(b.timestamp || "").localeCompare(String(a.timestamp || "")));
    const items = deduplicateItems(collected);
    return { items, diagnostics, selectedSources: selected, deduplicatedCount: collected.length - items.length };
  }
  return { collect, select: sourceSelection, limits: SOURCE_LIMITS, statuses: SOURCE_STATUSES };
}

module.exports = { DEFAULT_SOURCE_TIMEOUT_MS, SOURCE_LIMITS, SOURCE_STATUSES, SYSTEM_PERMISSION_STATUSES, createAuthorizedContextSources, deduplicateItems, normalizeItem, sourceSelection };
