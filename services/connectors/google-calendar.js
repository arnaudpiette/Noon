"use strict";

const { createConnector, providerFetch } = require("./base-connector");
function createCalendarConnector(deps) {
  const base = createConnector({ id: "google-calendar", credentialId: "google", displayName: "Google Calendar",
    capabilities: ["events", "availability", "conflicts", "changes_with_approval"],
    readCapabilities: ["events", "availability"], writeCapabilities: ["create", "update", "delete"],
    scopes: ["https://www.googleapis.com/auth/calendar.readonly", "https://www.googleapis.com/auth/calendar.events"],
  }, deps);
  const token = () => deps.tokenStore.get("google")?.access_token;
  async function listCalendarEvents({ timeMin = new Date().toISOString(), timeMax, calendarId = "primary" } = {}) {
    const params = new URLSearchParams({ timeMin, singleEvents: "true", orderBy: "startTime", maxResults: "50" });
    if (timeMax) params.set("timeMax", timeMax);
    return providerFetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`, { token: token() });
  }
  function prepareCalendarEvent(event) {
    if (!event?.summary || !event?.start || !event?.end) throw new Error("Titre, début et fin obligatoires.");
    return { calendarId: event.calendarId || "primary", timezone: event.timezone || "Europe/Paris", ...event };
  }
  function detectCalendarConflicts(events) {
    return events.flatMap((event, index) => events.slice(index + 1).filter((other) =>
      new Date(event.start) < new Date(other.end) && new Date(other.start) < new Date(event.end)).map((other) => [event, other]));
  }
  function previewCalendarChange(event, action = "create") {
    const prepared = prepareCalendarEvent(event);
    return deps.approvals.requestApproval({ provider: "google-calendar", action: `${action}_event`,
      target: prepared.calendarId, payload: prepared, preview: prepared,
      strengthened: action === "delete", consequences: action === "delete" ? "Supprimera l’événement affiché." : "Modifiera le calendrier affiché." });
  }
  async function applyCalendarChangeWithApproval(event, action, approvalId) {
    const prepared = prepareCalendarEvent(event);
    deps.approvals.consumeApproval(approvalId, { provider: "google-calendar", action: `${action}_event`, target: prepared.calendarId, payload: prepared });
    if (deps.dryRun) return { dryRun: true, applied: false };
    throw new Error("Écriture Calendar réelle non activée dans cette version.");
  }
  return { ...base, listCalendarEvents, getCalendarEvent: listCalendarEvents,
    findAvailableSlots: listCalendarEvents, detectCalendarConflicts, prepareCalendarEvent,
    previewCalendarChange, applyCalendarChangeWithApproval };
}
module.exports = { createCalendarConnector };
