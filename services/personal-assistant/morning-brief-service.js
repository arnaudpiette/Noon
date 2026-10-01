"use strict";

const { buildManagedEvent, dateKey, deduplicateActions, findFreeSlots, normalizeAction, occurrenceKey, prioritizeActions, sourceState } = require("../../lib/morning-brief");
const { localDateRange } = require("../connectors/google-calendar");

function importantText(value) { return /\b(urgent|important|échéance|deadline|avant le|répondre|réponse attendue|relance|soutenance|livrable|rendez-vous|rdv)\b/i.test(String(value || "")); }
function containsPromptInjection(value) { return /ignore (?:all |les )?(?:instructions? |règles? )?(?:previous|précédentes|et envoie)|system prompt|instruction système|révèle (?:les )?secrets|exfiltr/i.test(String(value || "")); }
function extractEmail(value) { return String(value || "").match(/<([^>\s]+@[^>\s]+)>|([\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/)?.slice(1).find(Boolean) || null; }
function dateRange(now = new Date(), days = 7) { return localDateRange(now, days, "Europe/Paris"); }

function createMorningBriefService(deps) {
  async function capture(id, connected, operation) {
    if (!connected) {
      let normalized = null; try { normalized = deps.reliability?.recordFailure(id, Object.assign(new Error("Authorization required"), { status: 401 })); } catch {}
      return { state: sourceState(id, "disconnected", { reasonCode: normalized?.category || "AUTH_REQUIRED" }), data: [] };
    }
    try { const data = await operation(); try { deps.reliability?.recordSuccess(id, { noData: Array.isArray(data) && data.length === 0 }); } catch {} return { state: sourceState(id, "ready", { count: Array.isArray(data) ? data.length : data?.items?.length || 0, reasonCode: Array.isArray(data) && data.length === 0 ? "NO_DATA" : "OK" }), data }; }
    catch (error) { let normalized = null; try { normalized = deps.reliability?.recordFailure(id, error); } catch {} return { state: sourceState(id, "unavailable", { reasonCode: normalized?.category || "INTERNAL_ERROR" }), data: [] }; }
  }

  async function collectSources(now = new Date(), settings = {}) {
    const range = dateRange(now);
    let calendarComplete = false;
    const [calendar, gmail, reminders, notes] = await Promise.all([
      capture("google-calendar", deps.calendar.connected, async () => {
        const calendarIds = Array.isArray(settings.busyCalendarIds) && settings.busyCalendarIds.length ? settings.busyCalendarIds : ["primary"];
        const lists = await Promise.all(calendarIds.map((calendarId) => deps.calendar.listCompleteCalendarEvents({ ...range, calendarId })));
        calendarComplete = lists.every((data) => data.complete === true);
        if (!calendarComplete) throw Object.assign(new Error("Agenda incomplet."), { code: "CALENDAR_INCOMPLETE" });
        return lists.flatMap((data) => data.items || []);
      }),
      capture("gmail", deps.gmail.connected, async () => {
        const search = await deps.gmail.searchGmailMessages("is:unread -category:promotions -category:social", { maxResults: 15 });
        const messages = await Promise.all((search.messages || []).slice(0, 15).map(({ id }) => deps.gmail.getGmailMessage(id).then(deps.normalizeGmailMessage)));
        return messages.map((message) => ({ ...message, content: String(message.content || "").slice(0, 2500), snippet: String(message.snippet || "").slice(0, 500) }));
      }),
      capture("apple-reminders", true, () => deps.reminders.listIncompleteReminders()),
      capture("apple-notes", true, () => deps.notes.listRecentNotes({ limit: 3, includeBody: true })),
    ]);
    const local = deps.localContext();
    const safeNotes = (notes.data || []).slice(0, 20).map((note) => ({ ...note, content: String(note.content || "").slice(0, 1500) }));
    const sources = [calendar.state, gmail.state, reminders.state, notes.state, sourceState("noon-memory", "ready"), sourceState("projects", "ready"), sourceState("github", "disconnected")];
    return { date: dateKey(now), occurrenceKey: occurrenceKey(now), sources, sourceCoverage: { expected: sources.map((item) => item.id), succeeded: sources.filter((item) => item.status === "ready").map((item) => item.id), failed: sources.filter((item) => !["ready", "disconnected"].includes(item.status)).map((item) => ({ componentId: item.id, reasonCode: item.reasonCode || item.status })), unavailable: sources.filter((item) => item.status === "disconnected").map((item) => ({ componentId: item.id, reasonCode: item.reasonCode || "AUTH_REQUIRED" })) }, calendarEvents: calendar.data, calendarComplete: calendarComplete && calendar.state.status === "ready", emails: gmail.data, reminders: reminders.data, notes: safeNotes, ...local };
  }

  function buildActionCandidates(context) {
    const actions = [];
    for (const message of context.emails || []) {
      const combined = `${message.subject || ""} ${message.snippet || ""} ${message.content || ""}`;
      if (!importantText(combined) || containsPromptInjection(combined)) continue;
      actions.push(normalizeAction({ sourceType: "Gmail", sourceId: message.id, title: `Répondre : ${message.subject}`, summary: message.snippet, dueAt: null, estimatedDurationMinutes: 25, urgency: /urgent|deadline|échéance/i.test(combined) ? 0.9 : 0.65, impact: 0.7, confidence: 0.82, requiresReply: true, suggestedAction: "Préparer puis relire une réponse avant envoi." }));
    }
    for (const reminder of context.reminders || []) {
      if (reminder.completed) continue;
      const overdue = reminder.dueAt && new Date(reminder.dueAt) < new Date();
      actions.push(normalizeAction({ sourceType: "Rappel", sourceId: reminder.id, title: reminder.title, dueAt: reminder.dueAt, estimatedDurationMinutes: 30, urgency: overdue ? 1 : reminder.dueAt ? 0.75 : 0.4, impact: 0.6, confidence: 0.88, suggestedAction: overdue ? "Traiter ce rappel en retard aujourd’hui." : "Planifier ce rappel dans un créneau disponible." }));
    }
    for (const note of context.notes || []) {
      const combined = `${note.title || ""} ${note.content || ""}`;
      if (containsPromptInjection(combined) || !/\b(todo|à faire|action|préparer|envoyer|appeler|relancer|terminer|livrer)\b/i.test(combined)) continue;
      actions.push(normalizeAction({ sourceType: "Note", sourceId: note.id, title: note.title, summary: note.content, estimatedDurationMinutes: 45, urgency: 0.4, impact: 0.55, confidence: 0.68, suggestedAction: "Transformer cette note en action vérifiable." }));
    }
    for (const project of context.projects || []) {
      if (!project.nextAction) continue;
      actions.push(normalizeAction({ sourceType: "Projet", sourceId: project.project, title: project.nextAction, project: project.project, estimatedDurationMinutes: 60, urgency: project.blockers?.length ? 0.7 : 0.45, impact: 0.75, confidence: 0.8, dependencies: project.blockers || [], suggestedAction: "Faire avancer la prochaine action enregistrée du projet." }));
    }
    return deduplicateActions(actions);
  }

  async function createDrafts(actions, context, settings) {
    if (!settings.createGmailDrafts || !deps.gmail.connected) return [];
    const drafts = [];
    for (const action of actions.filter((item) => item.sourceType === "Gmail" && item.requiresReply && item.confidence >= 0.8).slice(0, 3)) {
      const message = context.emails.find((item) => item.id === action.sourceId); const to = extractEmail(message?.from);
      if (!to) continue;
      try {
        const result = await deps.gmail.createGmailDraft({ to, subject: /^re:/i.test(message.subject) ? message.subject : `Re: ${message.subject}`, body: "Bonjour,\n\nJ’ai bien reçu votre message. Je reviens vers vous rapidement avec une réponse complète.\n\nBien à vous,\nArnaud" });
        drafts.push({ sourceId: action.sourceId, draftId: result.id, subject: message.subject, to, status: "created", reason: "Une réponse est explicitement attendue." });
      } catch (error) { drafts.push({ sourceId: action.sourceId, subject: message?.subject, status: "failed", error: String(error.message).slice(0, 180) }); }
    }
    return drafts;
  }

  async function schedulePriorities(actions, context, settings, now = new Date()) {
    if (!settings.enabled || !deps.calendar.connected) return [];
    if (context.calendarComplete === false) return actions.slice(0, 3).map((action) => ({ actionId: action.id, title: action.title, status: "not-scheduled", reason: "Agenda incomplet : disponibilité non confirmée." }));
    const scheduled = [];
    const busy = [...(context.calendarEvents || [])];
    // Le brief prépare des propositions, mais n'écrit jamais dans Calendar :
    // la création exige un ordre explicite dans le chat.
    const colorId = await deps.calendar.resolveBlueberryColorId().catch(() => "9");
    for (const action of actions.slice(0, 3)) {
      if (action.confidence < 0.75 || action.alreadyScheduled) continue;
      const partCount = Math.ceil(action.estimatedDurationMinutes / settings.maximumFocusMinutes);
      for (let partIndex = 0; partIndex < partCount; partIndex += 1) {
        const partDuration = Math.min(settings.maximumFocusMinutes, action.estimatedDurationMinutes - partIndex * settings.maximumFocusMinutes);
        const partAction = partCount === 1 ? action : { ...action, sourceId: `${action.sourceId || action.id}:part:${partIndex + 1}`, title: `${action.title} (${partIndex + 1}/${partCount})`, estimatedDurationMinutes: partDuration };
        let selected = null;
        for (let offset = 0; offset < 7 && !selected; offset += 1) {
          const day = new Date(now.getTime() + offset * 86_400_000);
          selected = findFreeSlots({ day, events: busy, settings, durationMinutes: partDuration, dueAt: action.dueAt, notBefore: offset === 0 ? now : null })[0] || null;
        }
        if (!selected) { scheduled.push({ actionId: action.id, title: partAction.title, status: "not-scheduled", reason: "Aucun créneau disponible avant l’échéance." }); break; }
        const payload = buildManagedEvent(partAction, selected, colorId);
        busy.push(payload);
        scheduled.push({ actionId: action.id, title: partAction.title, status: "proposed", start: selected.start, end: selected.end, priority: action.priority, origin: action.sourceType, reason: action.suggestedAction, validationRequired: true, preparedEvent: payload });
      }
    }
    return scheduled;
  }

  async function prepare(now = new Date(), settings) {
    const context = await collectSources(now, settings); const actions = buildActionCandidates(context);
    const rankedActions = prioritizeActions(actions, 20);
    const [scheduledBlocks, drafts] = await Promise.all([
      schedulePriorities(rankedActions, context, settings, now).catch((error) => [{ status: "failed", reason: String(error.message).slice(0, 180) }]),
      createDrafts(rankedActions, context, settings).catch((error) => [{ status: "failed", error: String(error.message).slice(0, 180) }]),
    ]);
    return { ...context, actions, priorities: rankedActions.slice(0, 3), scheduledBlocks, drafts };
  }

  return { buildActionCandidates, collectSources, createDrafts, prepare, schedulePriorities };
}

module.exports = { containsPromptInjection, createMorningBriefService, dateRange, extractEmail, importantText };
