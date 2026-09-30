"use strict";

const { createConnector, providerFetch } = require("./base-connector");
const { BLUEBERRY_COLOR_ID, isNoonManagedEvent } = require("../../lib/morning-brief");
function createCalendarConnector(deps) {
  const base = createConnector({ id: "google-calendar", credentialId: "google", remoteCapability: "REMOTE_GOOGLE_CALENDAR", displayName: "Google Calendar",
    capabilities: ["events", "availability", "conflicts", "changes_with_approval"],
    readCapabilities: ["events", "availability"], writeCapabilities: ["create", "update", "delete"],
    scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
  }, deps);
  const token = async () => {
    base.assertRemoteAvailable();
    return deps.getGoogleAccessToken ? deps.getGoogleAccessToken() : deps.tokenStore.get("google")?.access_token;
  };
  async function listCalendarEvents({ timeMin = new Date().toISOString(), timeMax, calendarId = "primary", maxResults = 50 } = {}) {
    const limit = maxResults;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new TypeError("Limite Calendar invalide.");
    const params = new URLSearchParams({ timeMin, singleEvents: "true", orderBy: "startTime", maxResults: String(limit) });
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
  async function createManagedEvent() {
    throw Object.assign(new Error("Écriture Calendar réelle non activée : pipeline canonique requis."), { code: "REMOTE_WRITE_NOT_ENABLED" });
  }
  async function updateManagedEvent() {
    throw Object.assign(new Error("Déplacement Calendar réel non activé : pipeline canonique requis."), { code: "REMOTE_WRITE_NOT_ENABLED" });
  }
  async function deleteManagedEvent() {
    throw Object.assign(new Error("Suppression Calendar réelle non activée : pipeline canonique requis."), { code: "REMOTE_WRITE_NOT_ENABLED" });
  }
  return Object.assign(base, { listCalendarEvents, getCalendarEvent: listCalendarEvents,
    findAvailableSlots: listCalendarEvents, detectCalendarConflicts, prepareCalendarEvent,
    previewCalendarChange, applyCalendarChangeWithApproval, listCalendars, getColors,
    resolveBlueberryColorId, findManagedEvent, createManagedEvent, updateManagedEvent, deleteManagedEvent });
}
module.exports = { createCalendarConnector };
