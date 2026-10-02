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

function nextLocalDateKey(at) {
  const [year, month, day] = localDateKey(at, TIME_ZONE).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

function normalizeReminder(reminder = {}) {
  return {
    id: reminder.id || null,
    title: String(reminder.title || reminder.name || "Rappel").slice(0, 240),
    dueAt: reminder.dueAt || reminder.dueDate || reminder.due || null,
    completed: reminder.completed === true,
    priority: reminder.priority ?? null,
  };
}

function normalizeNote(note = {}) {
  return {
    id: note.id || null,
    title: String(note.title || "Note").slice(0, 240),
    content: String(note.content || note.body || "").slice(0, 1500),
    updatedAt: note.updatedAt || note.modifiedAt || null,
  };
}

function buildDailyProposals({
  priorities = [],
  scheduledBlocks = [],
  dailyPlan = null,
} = {}) {
  const proposals = [];
  const seenActions = new Set();
  const calendarConfirmed = dailyPlan?.calendarAvailability === "confirmed";

  if (calendarConfirmed) {
    for (const block of scheduledBlocks) {
      if (block.status !== "proposed") continue;
      if (!block.title) continue;

      proposals.push({
        type: "scheduled_action",
        actionId: block.actionId || null,
        title: String(block.title).slice(0, 300),
        start: block.start || null,
        end: block.end || null,
        confirmedSlot: true,
        validationRequired: block.validationRequired !== false,
        reason: block.reason || null,
      });

      if (block.actionId) seenActions.add(String(block.actionId));
      if (proposals.length >= 3) return proposals;
    }
  }

  for (const priority of priorities) {
    if (proposals.length >= 3) break;

    const actionId = priority.id || priority.actionId || null;
    if (actionId && seenActions.has(String(actionId))) continue;

    proposals.push({
      type: "priority_action",
      actionId,
      title: String(priority.title || "Action prioritaire").slice(0, 300),
      start: null,
      end: null,
      confirmedSlot: false,
      validationRequired: false,
      reason: priority.reasons?.[0] || priority.priorityLevel || null,
    });

    if (actionId) seenActions.add(String(actionId));
  }

  return proposals;
}

function deterministicBrief(structured) {
  const lines = ["☀️ Bonjour Arnaud"];
  const priorities = Array.isArray(structured.priorities) ? structured.priorities : [];
  const calendar = Array.isArray(structured.calendar) ? structured.calendar : [];
  const scheduledBlocks = Array.isArray(structured.scheduledBlocks) ? structured.scheduledBlocks : [];
  const reminders = Array.isArray(structured.reminders) ? structured.reminders : [];
  const projects = Array.isArray(structured.projects) ? structured.projects : [];
  const emails = Array.isArray(structured.emails) ? structured.emails : [];
  const tomorrow = Array.isArray(structured.tomorrow) ? structured.tomorrow : [];
  const creative = Array.isArray(structured.creative) ? structured.creative : [];
  const calendarConfirmed = structured.dailyPlan?.calendarAvailability === "confirmed";
  const calendarSource = structured.sourceStatus?.["google-calendar"] || structured.sourceStatus?.calendar || null;

  if (calendar.length) {
    lines.push("", "📅 Aujourd’hui");
    calendar.slice(0, 8).forEach((item) => {
      const timing = [item.start, item.end].filter(Boolean).join(" → ");
      lines.push(`- ${item.title || "Événement"}${timing ? ` · ${timing}` : ""}`);
    });
  } else if (calendarSource && !["ready", "ok"].includes(calendarSource)) {
    lines.push("", "📅 Aujourd’hui", "Je ne peux pas confirmer ton agenda aujourd’hui : Calendar n’est pas disponible.");
  }

  if (priorities.length) {
    lines.push("", "🎯 Tes priorités");
    priorities.slice(0, 3).forEach((item, index) => {
      lines.push(`${index + 1}. ${item.title} — ${item.reasons?.[0] || item.priorityLevel || "à traiter"}.`);
    });
  }

  const proposed = scheduledBlocks
    .filter((item) => item.status === "proposed")
    .slice(0, 3);

  if (calendarConfirmed && proposed.length) {
    lines.push("", "🕳️ Créneaux disponibles");
    proposed.forEach((item) => {
      lines.push(`- ${item.start} → ${item.end} · ${item.title} (proposition à valider)`);
    });
  } else if (proposed.length && !calendarConfirmed) {
    lines.push("", "🕳️ Créneaux disponibles", "Je ne peux pas confirmer tes créneaux aujourd’hui : la disponibilité Calendar n’est pas confirmée.");
  }

  const today = structured.date;
  const relevantReminders = reminders.filter((item) => {
    if (!item.dueAt) return false;
    const due = new Date(item.dueAt);
    if (!Number.isFinite(due.getTime())) return false;
    return due <= new Date(`${today}T23:59:59.999Z`) || localDateKey(due, TIME_ZONE) === today;
  }).slice(0, 5);

  if (relevantReminders.length) {
    lines.push("", "⏰ À ne pas oublier");
    relevantReminders.forEach((item) => lines.push(`- ${item.title}${item.dueAt ? ` · ${item.dueAt}` : ""}`));
  }

  const usefulProjects = projects.filter((item) =>
    item.nextAction || item.blockers?.length || item.title || item.project
  ).slice(0, 3);

  if (usefulProjects.length) {
    lines.push("", "📌 Projets");
    usefulProjects.forEach((item) => {
      const name = item.project || item.title || item.id || "Projet";
      const next = item.nextAction ? ` → ${item.nextAction}` : "";
      const blocker = item.blockers?.length ? ` · Bloqué par : ${item.blockers.join(", ")}` : "";
      lines.push(`- ${name}${next}${blocker}`);
    });
  }

  if (emails.length) {
    lines.push("", "✉️ À surveiller");
    emails.slice(0, 3).forEach((item) => {
      const sender = item.from ? `${item.from} · ` : "";
      lines.push(`- ${sender}${item.subject || "Message"}${item.snippet ? ` — ${item.snippet}` : ""}`);
    });
  }

  const structuredProposals = Array.isArray(structured.proposals)
    ? structured.proposals
    : buildDailyProposals({
        priorities,
        scheduledBlocks,
        dailyPlan: structured.dailyPlan,
      });

  if (structuredProposals.length) {
    lines.push("", "💡 Noon te propose");
    structuredProposals.slice(0, 3).forEach((proposal) => {
      if (proposal.confirmedSlot && proposal.start && proposal.end) {
        lines.push(`- ${proposal.start} → ${proposal.end} · ${proposal.title}`);
      } else {
        lines.push(`- ${proposal.title}`);
      }
    });
  }

  if (tomorrow.length) {
    lines.push("", "📆 Demain");
    tomorrow.slice(0, 5).forEach((item) => {
      const timing = item.start ? ` · ${item.start}` : "";
      lines.push(`- ${item.title || item.summary || "Événement"}${timing}`);
    });
  }

  if (creative.length) {
    lines.push("", "🎨 Veille créative");
    creative.slice(0, 3).forEach((item) => lines.push(`- ${item.title || item}`));
  }

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
  subjectScope = "arnaud",
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
      status: generating ? "generating" : current ? (current.metadata?.degraded || current.sources?.some((source) => !["ready", "ok"].includes(source.status)) ? "partial" : "ready") : failed ? "failed" : "missing",
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
        metrics.sources_ok = (collected.sources || []).filter((source) => ["ok", "ready"].includes(source.status)).length;
        metrics.sources_failed = (collected.sources || []).filter((source) => !["ok", "ready"].includes(source.status)).length;

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
            at, channel: "brief", subjectScope, focusActive: false, remoteModel: false,
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
        const tomorrowDate = nextLocalDateKey(at);
        const tomorrow = (collected.calendarEvents || []).filter((event) => {
          const start = new Date(event.start?.dateTime || event.start?.date || event.start || 0);
          return Number.isFinite(start.getTime()) && localDateKey(start, TIME_ZONE) === tomorrowDate;
        }).map((event) => ({
          id: event.id || null,
          title: String(event.summary || event.title || "Événement").slice(0, 240),
          start: event.start?.dateTime || event.start?.date || event.start || null,
          end: event.end?.dateTime || event.end?.date || event.end || null,
        }));
        const proposals = buildDailyProposals({
          priorities,
          scheduledBlocks,
          dailyPlan,
        });

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
          proposals,
          dailyPlan,
          emails: (collected.emails || []).map((message) => ({
            id: message.id || null,
            subject: String(message.subject || "Message").slice(0, 240),
            from: String(message.from || "").slice(0, 200),
            snippet: String(message.snippet || "").slice(0, 500),
          })),
          reminders: (collected.reminders || []).map(normalizeReminder).filter((item) => !item.completed),
          notes: (collected.notes || []).map(normalizeNote),
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
            degraded: (collected.sources || []).some((source) => !["ready", "ok"].includes(source.status)),
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

module.exports = {
  TIME_ZONE,
  createDailyBriefEngine,
  deduplicateDailyActions,
  deterministicBrief,
  nextLocalDateKey,
  normalizeReminder,
  normalizeNote,
  buildDailyProposals,
};
