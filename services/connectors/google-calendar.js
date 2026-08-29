"use strict";

const { createConnector, providerFetch } = require("./base-connector");
const { BLUEBERRY_COLOR_ID, isNoonManagedEvent } = require("../../lib/morning-brief");
function createCalendarConnector(deps) {
  const base = createConnector({ id: "google-calendar", credentialId: "google", displayName: "Google Calendar",
    capabilities: ["events", "availability", "conflicts", "changes_with_approval"],
    readCapabilities: ["events", "availability"], writeCapabilities: ["create", "update", "delete"],
    scopes: ["https://www.googleapis.com/auth/calendar.readonly", "https://www.googleapis.com/auth/calendar.events"],
  }, deps);
  const token = async () => deps.getGoogleAccessToken ? deps.getGoogleAccessToken() : deps.tokenStore.get("google")?.access_token;
  async function listCalendarEvents({ timeMin = new Date().toISOString(), timeMax, calendarId = "primary" } = {}) {
    const params = new URLSearchParams({ timeMin, singleEvents: "true", orderBy: "startTime", maxResults: "50" });
    if (timeMax) params.set("timeMax", timeMax);
    return base.run(async () => providerFetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`, { token: await token() }), { idempotent: true });
  }
  async function listCalendars() { return base.run(async () => providerFetch("https://www.googleapis.com/calendar/v3/users/me/calendarList", { token: await token() }), { idempotent: true }); }
  async function getColors() { return base.run(async () => providerFetch("https://www.googleapis.com/calendar/v3/colors", { token: await token() }), { idempotent: true }); }
  async function resolveBlueberryColorId() {
    const colors = await getColors();
    if (!colors?.event?.[BLUEBERRY_COLOR_ID]) throw new Error("La couleur Myrtille n’est pas disponible dans Google Calendar.");
    return BLUEBERRY_COLOR_ID;
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
  async function findManagedEvent(calendarId, planningKey) {
    const params = new URLSearchParams({ privateExtendedProperty: `planningKey=${planningKey}`, maxResults: "2", singleEvents: "true" });
    const data = await providerFetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`, { token: await token() });
    return (data.items || []).find(isNoonManagedEvent) || null;
  }
  async function createManagedEvent(calendarId, event) {
    if (!isNoonManagedEvent(event) || event.attendees || event.conferenceData) throw new Error("Événement automatique Noon invalide.");
    const key = event.extendedProperties.private.planningKey;
    const existing = await findManagedEvent(calendarId, key);
    if (existing) return { event: existing, created: false, idempotent: true };
    const created = await providerFetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=none`, {
      token: await token(), method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(event),
    });
    if (!isNoonManagedEvent(created)) throw new Error("Google Calendar n’a pas confirmé la signature Noon.");
    return { event: created, created: true, idempotent: false };
  }
  async function updateManagedEvent(calendarId, eventId, changes) {
    const current = await providerFetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, { token: await token() });
    if (!isNoonManagedEvent(current)) throw new Error("Noon ne peut modifier que ses propres blocs.");
    const payload = { ...current, ...changes, attendees: undefined, conferenceData: undefined, extendedProperties: current.extendedProperties };
    return providerFetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=none`, { token: await token(), method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  }
  async function deleteManagedEvent(calendarId, eventId) {
    const current = await providerFetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, { token: await token() });
    if (!isNoonManagedEvent(current)) throw new Error("Noon ne peut supprimer que ses propres blocs.");
    return providerFetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=none`, { token: await token(), method: "DELETE" });
  }
  return { ...base, listCalendarEvents, getCalendarEvent: listCalendarEvents,
    findAvailableSlots: listCalendarEvents, detectCalendarConflicts, prepareCalendarEvent,
    previewCalendarChange, applyCalendarChangeWithApproval, listCalendars, getColors,
    resolveBlueberryColorId, findManagedEvent, createManagedEvent, updateManagedEvent, deleteManagedEvent };
}
module.exports = { createCalendarConnector };
