"use strict";

const crypto = require("crypto");
const { localDateKey, isDueToday } = require("../../lib/creative-brief");

const TIME_ZONE = "Europe/Paris";

function elapsed(startedAt, now) {
  return Math.max(0, now() - startedAt);
}

function normalizedActionKey(action) {
  const title = String(action.title || "").toLocaleLowerCase("fr").normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  return `${title}:${String(action.dueAt || action.deadline || "").slice(0, 10)}`;
}

function deduplicateDailyActions(actions = []) {
  const selected = new Map();
  for (const action of actions) {
    const key = normalizedActionKey(action) || String(action.id || "");
    const previous = selected.get(key);
    if (!previous || Number(action.confidence || 0) > Number(previous.confidence || 0)) selected.set(key, action);
  }
  return [...selected.values()];
}

function deterministicBrief(structured) {
  const lines = [
    "Bonjour Arnaud.",
    structured.summary || "Voici l’essentiel disponible pour organiser ta journée.",
  ];
  if (structured.priorities.length) {
    lines.push("", "ACTIONS PRIORITAIRES");
    structured.priorities.slice(0, 3).forEach((item, index) => {
      lines.push(`${index + 1}. ${item.title} — ${item.reasons?.[0] || item.priorityLevel || "à traiter"}.`);
    });
  }
  if (structured.calendar.length) lines.push("", "TON AGENDA", `${structured.calendar.length} rendez-vous ou blocs ont été identifiés.`);
  if (structured.scheduledBlocks.length) {
    lines.push("", "CRÉNEAUX PROPOSÉS");
    structured.scheduledBlocks.filter((item) => item.status === "proposed").slice(0, 3)
      .forEach((item) => lines.push(`- ${item.title} : ${item.start} → ${item.end} (validation requise).`));
  }
  if (structured.emails.length) lines.push("", "EMAILS / MESSAGES", `${structured.emails.length} message(s) pertinent(s) à vérifier.`);
  if (structured.projects.length) lines.push("", "PROJETS À SURVEILLER", `${structured.projects.length} projet(s) actif(s) remontent aujourd’hui.`);
  if (structured.creative.length) lines.push("", "VEILLE CRÉATIVE", ...structured.creative.slice(0, 3).map((item) => `- ${item.title || item}`));
  if (structured.tomorrow.length) lines.push("", "À ANTICIPER POUR DEMAIN", ...structured.tomorrow.slice(0, 3).map((item) => `- ${item.title || item.summary || item}`));
  return lines.join("\n");
}

function createDailyBriefEngine({
  store,
  collect,
  contextBuilder,
  priorityEngine,
  proactiveEngine = null,
  compose,
  schedule = null,
  prepareDrafts = null,
  settingsProvider = () => ({}),
  projectProvider = () => [],
  creativeProvider = () => [],
  trackingProvider = () => ({ carryOver: [], blockers: [], deferred: [] }),
  reviewProvider = () => null,
  audit = null,
  observability = null,
  now = () => Date.now(),
} = {}) {
  if (!store?.load || !store?.markReady) throw new TypeError("Stockage Daily Brief requis.");
  if (typeof collect !== "function") throw new TypeError("Collecteur Daily Brief requis.");
  if (!contextBuilder?.buildContext) throw new TypeError("Context Builder requis.");
  if (!priorityEngine?.rank) throw new TypeError("Priority Engine requis.");

  const activeRuns = new Map();

  function getCurrent({ at = new Date(), catchUp = false, enabled = true, time = "07:00" } = {}) {
    let state = store.load();
    const date = localDateKey(at, TIME_ZONE);
    const current = (state.briefs || []).find((brief) => brief.date === date) || null;
    const lastAttempt = Date.parse(state.lastAttemptAt || "");
    const retryAllowed = !Number.isFinite(lastAttempt) || at.getTime() - lastAttempt >= 15 * 60 * 1000;
    const due = enabled && !current && isDueToday({ now: at, time });
    if (catchUp && due && retryAllowed && !activeRuns.has(date)) {
      void generate({ at }).catch(() => {}); // The store retains the failure; polling respects the retry delay.
    }
    state = store.load();
    const generating = activeRuns.has(date);
    const attemptedToday = Number.isFinite(lastAttempt) && localDateKey(new Date(lastAttempt), TIME_ZONE) === date;
    const failed = attemptedToday && ["error", "generating"].includes(state.status) && !generating;
    return {
      ...state, date, timeZone: TIME_ZONE, current,
      previous: (state.briefs || []).find((brief) => brief.date < date) || null,
      historical: (state.briefs || []).filter((brief) => brief.date !== date),
      status: generating ? "generating" : current ? (current.metadata?.degraded ? "partial" : "ready") : failed ? "failed" : "missing",
      generationActive: generating,
      catchUpAllowed: due && retryAllowed,
      error: failed ? state.error || "La génération précédente a été interrompue." : null,
    };
  }

  function getHistorical(date) {
    return (store.load().briefs || []).find((brief) => brief.date === date) || null;
  }

  async function generate({ force = false, at = new Date() } = {}) {
    const date = localDateKey(at, TIME_ZONE);
    const briefId = `brief_${date}`;
    const existing = store.load();
    if (activeRuns.has(date)) return activeRuns.get(date);
    const current = (existing.briefs || []).find((brief) => brief.date === date);
    if (!force && current) return current;

    const activeRun = Promise.resolve().then(async () => {
      const totalStarted = now();
      const executionId = `exec_${crypto.randomUUID()}`;
      observability?.startExecution({ executionId, channel: "background", intent: "brief", mode: "daily" });
      const metrics = {
        brief_collect_ms: 0, brief_action_extract_ms: 0, brief_priority_ms: 0,
        brief_schedule_ms: 0, brief_generation_ms: 0, brief_total_ms: 0,
        modelCalls: 0, models: [], inputTokens: 0, outputTokens: 0,
      };
      store.markGenerating(at);
      try {
        let started = now();
        const collected = await collect(at, settingsProvider());
        metrics.brief_collect_ms = elapsed(started, now);
        started = now();
        const tracking = await Promise.resolve(trackingProvider({ at, date })).catch(() => ({ carryOver: [], blockers: [], deferred: [] }));
        const reviewLearning = await Promise.resolve(reviewProvider({ at, date })).catch(() => null);
        const extractedActions = [
          ...(Array.isArray(collected.actions) ? collected.actions : []),
          ...(tracking.carryOver || []).map((item) => ({
            id: item.actionId, title: "Action reportée à réévaluer", sourceType: "execution_tracking",
            sourceId: item.actionId, dueAt: item.dueAt,
            estimatedDurationMinutes: item.remainingDurationMinutes,
            importance: item.priorityScore ? item.priorityScore / 100 : 0.5,
            confidence: item.confidence, status: item.status,
          })),
        ];
        const sourceActions = deduplicateDailyActions(extractedActions);
        metrics.brief_action_extract_ms = elapsed(started, now);
        metrics.actions_extracted = extractedActions.length;
        metrics.actions_deduplicated = extractedActions.length - sourceActions.length;
        metrics.sources_ok = (collected.sources || []).filter((source) => source.status === "ok").length;
        metrics.sources_failed = (collected.sources || []).filter((source) => source.status !== "ok").length;

        started = now();
        let priorities;
        if (proactiveEngine?.evaluate) {
          const proactiveSignals = sourceActions.map((action) => proactiveEngine.adapters.normalize(
            ["calendar", "reminders", "notes", "gmail", "projects", "memory", "daily_brief", "local"].includes(action.sourceType)
              ? action.sourceType : "daily_brief",
            action,
            { now: at, stale: action.sourceStale === true }
          ));
          const proactive = await proactiveEngine.evaluate(proactiveSignals, {
            at, channel: "brief", focusActive: false, remoteModel: false,
          });
          priorities = proactive.recommendations.slice(0, 20).map((item) => ({
            ...item, sourceId: item.sourceReference, source: item.sourceType,
            deadline: item.dueAt, reasons: item.reasons,
          }));
          metrics.proactive_recommendations = priorities.length;
        } else {
          priorities = priorityEngine.rank(sourceActions, { limit: 20, now: at });
        }
        metrics.brief_priority_ms = elapsed(started, now);
        metrics.actions_prioritized = priorities.length;

        started = now();
        const [scheduleResult, drafts] = await Promise.all([
          typeof schedule === "function" ? schedule(priorities, collected, settingsProvider(), at) : (collected.scheduledBlocks || []),
          typeof prepareDrafts === "function" ? prepareDrafts(priorities, collected, settingsProvider()) : (collected.drafts || []),
        ]);
        const dailyPlan = Array.isArray(scheduleResult) ? null : scheduleResult?.plan || null;
        const scheduledBlocks = Array.isArray(scheduleResult) ? scheduleResult : scheduleResult?.blocks || [];
        metrics.brief_schedule_ms = elapsed(started, now);

        const projects = projectProvider() || [];
        const creative = await Promise.resolve(creativeProvider({ date, at })).catch((error) => {
          audit?.("daily-brief.source-error", { briefId, source: "creative", code: String(error.code || error.name || "ERROR") });
          return [];
        });
        const personalContext = contextBuilder.buildContext({
          query: "Préparer le brief quotidien et identifier les priorités utiles.",
          purpose: "daily_brief", channel: "background", intent: "brief",
          includeConversation: false,
        });
        observability?.recordContext(executionId, {
          contextBuildMs: personalContext.metadata?.durationMs || 0,
          contextEstimatedTokens: personalContext.metadata?.estimatedTokens || 0,
          memoryRetrievalMs: personalContext.metadata?.memoryRetrievalMs || 0,
          contextCacheHits: personalContext.metadata?.cacheHits || 0,
          contextCacheMisses: personalContext.metadata?.cacheMisses || 0,
          contextCacheHitRate: personalContext.metadata?.cacheHitRate || 0,
          contextCacheEntries: personalContext.metadata?.cacheEntries || 0,
          contextCacheMemoryBytesEstimate: personalContext.metadata?.cacheMemoryBytesEstimate || 0,
          contextTokensBefore: personalContext.metadata?.tokensBefore || 0,
          contextTokensAfter: personalContext.metadata?.tokensAfter || 0,
          contextTokensSaved: personalContext.metadata?.tokensSaved || 0,
          contextFingerprint: personalContext.metadata?.contextFingerprint || null,
        });
        const tomorrowBoundary = new Date(at.getTime() + 48 * 60 * 60 * 1000);
        const tomorrow = (collected.calendarEvents || []).filter((event) => {
          const start = new Date(event.start?.dateTime || event.start || 0);
          return start > new Date(at.getTime() + 18 * 60 * 60 * 1000) && start <= tomorrowBoundary;
        }).map((event) => ({
          id: event.id || null,
          title: String(event.summary || event.title || "Événement").slice(0, 240),
          start: event.start?.dateTime || event.start?.date || event.start || null,
          end: event.end?.dateTime || event.end?.date || event.end || null,
        }));
        const structured = {
          id: briefId, date, summary: priorities.length
            ? `${priorities.length} action(s) utile(s) ont été classées ; les trois premières structurent la journée.`
            : "Aucune action prioritaire certaine n’a été détectée.",
          priorities: priorities.slice(0, 3), laterActions: priorities.slice(3, 8),
          calendar: (collected.calendarEvents || []).map((event) => ({
            id: event.id || null,
            title: String(event.summary || event.title || "Événement").slice(0, 240),
            start: event.start?.dateTime || event.start?.date || event.start || null,
            end: event.end?.dateTime || event.end?.date || event.end || null,
            status: event.status || null,
          })),
          scheduledBlocks: scheduledBlocks || [],
          dailyPlan,
          emails: (collected.emails || []).map((message) => ({
            id: message.id || null,
            subject: String(message.subject || "Message").slice(0, 240),
            from: String(message.from || "").slice(0, 200),
            snippet: String(message.snippet || "").slice(0, 500),
          })),
          projects: (projects || []).slice(0, 20),
          creative: Array.isArray(creative) ? creative : [], tomorrow,
          executionTracking: {
            carryOverCount: (tracking.carryOver || []).length,
            blockerCount: (tracking.blockers || []).length,
            deferredCount: (tracking.deferred || []).length,
          },
          reviewLearning: reviewLearning ? {
            reviewType: reviewLearning.reviewType,
            summary: reviewLearning.summary,
            coverageStatus: reviewLearning.coverageStatus,
            planningHints: reviewLearning.planningHints,
            insights: (reviewLearning.insights || []).slice(0, 3),
          } : null,
          drafts: drafts || [], sourceStatus: Object.fromEntries((collected.sources || []).map((source) => [source.id, source.status])),
          sources: collected.sources || [],
          metadata: {
            occurrenceKey: collected.occurrenceKey || `daily-brief:${date}:${TIME_ZONE}`,
            actionIds: priorities.map((item) => item.id), priorityVersion: priorityEngine.scoringVersion,
            actionTrace: priorities.map((item) => ({ sourceIds: [item.sourceId || item.id].filter(Boolean), actionId: item.id, score: item.score })),
            context: personalContext.metadata, generatedAt: new Date(now()).toISOString(),
          },
        };
        metrics.calendar_items = structured.calendar.length;
        metrics.emails_items = structured.emails.length;
        metrics.project_items = structured.projects.length;
        metrics.reminders_items = (collected.reminders || []).length;
        metrics.notes_items = (collected.notes || []).length;
        metrics.slots_proposed = structured.scheduledBlocks.filter((item) => item.status === "proposed").length;
        metrics.events_created = structured.scheduledBlocks.filter((item) => item.status === "created").length;

        let content;
        let generation = null;
        started = now();
        try {
          if (typeof compose !== "function") throw new Error("Composition distante indisponible.");
          generation = await compose({ structured, personalContext });
          content = String(generation?.content || "").trim();
          if (!content) throw new Error("Le Daily Brief généré est vide.");
          metrics.modelCalls = Number(generation.modelCalls) || 1;
          metrics.models = generation.models || [];
          metrics.inputTokens = Number(generation.inputTokens) || 0;
          metrics.outputTokens = Number(generation.outputTokens) || 0;
          metrics.brief_cost_estimate = generation.costEstimate || { status: "unavailable", total: null };
          if (generation.routing) {
            metrics.routing = generation.routing;
            observability?.recordRouting(executionId, {
              selectedModel: generation.routing.model,
              selectedProfile: generation.routing.selectedProfile,
              routingPolicyVersion: generation.routing.routingPolicyVersion,
              routingScore: generation.routing.score,
              reasonCodes: generation.routing.reasonCodes,
              routingMs: generation.routing.routingMs,
              signals: generation.routing.signals,
            });
          }
        } catch (error) {
          content = deterministicBrief(structured);
          structured.metadata.degraded = true;
          structured.metadata.generationError = String(error.code || error.name || "GENERATION_ERROR").slice(0, 100);
          audit?.("daily-brief.degraded", { briefId, code: structured.metadata.generationError });
        }
        metrics.brief_generation_ms = elapsed(started, now);
        metrics.brief_total_ms = elapsed(totalStarted, now);
        structured.metadata.generatedAt = new Date(now()).toISOString();
        const brief = {
          ...structured, content, title: `Brief Noon — ${date}`,
          generatedAt: structured.metadata.generatedAt,
          webSources: generation?.sources || [], topics: generation?.topics || [], metrics,
        };
        store.markReady(brief, new Date(now()));
        observability?.completeExecution(executionId, {
          status: "completed", dailyBrief: metrics,
          wallClockTotalMs: metrics.brief_total_ms,
          technicalExecutionMs: metrics.brief_total_ms,
        });
        audit?.("daily-brief.ready", { briefId, date, degraded: structured.metadata.degraded === true, metrics });
        return brief;
      } catch (error) {
        store.markError(error);
        observability?.failExecution(executionId, error, {
          wallClockTotalMs: elapsed(totalStarted, now),
          technicalExecutionMs: elapsed(totalStarted, now),
        });
        audit?.("daily-brief.failed", { briefId, code: String(error.code || error.name || "ERROR").slice(0, 100) });
        throw error;
      } finally {
        activeRuns.delete(date);
      }
    });
    activeRuns.set(date, activeRun);
    return activeRun;
  }

  return { generate, getCurrent, getHistorical };
}

module.exports = { TIME_ZONE, createDailyBriefEngine, deduplicateDailyActions, deterministicBrief };
