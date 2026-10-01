"use strict";

const { createConnector, providerFetch } = require("./base-connector");
const { BLUEBERRY_COLOR_ID, isNoonManagedEvent } = require("../../lib/morning-brief");
const COMPLETE_PAGE_SIZE = 250;
const COMPLETE_MAX_PAGES = 20;
const COMPLETE_MAX_ITEMS = 1000;
const COMPLETE_TIMEOUT_MS = 30_000;

function localDateParts(date, timeZone) {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date).map(({ type, value }) => [type, value]));
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day), hour: Number(values.hour), minute: Number(values.minute) };
}

function zonedMidnight(date, timeZone = "Europe/Paris") {
  const { year, month, day } = localDateParts(date, timeZone);
  const desired = Date.UTC(year, month - 1, day);
  let instant = desired;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = localDateParts(new Date(instant), timeZone);
    const offset = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute) - instant;
    const next = desired - offset;
    if (next === instant) break;
    instant = next;
  }
  return new Date(instant);
}

function localDayRange(date, timeZone = "Europe/Paris") {
  const start = zonedMidnight(date, timeZone);
  const nextLocalDay = new Date(start.getTime() + 36 * 60 * 60 * 1000);
  const end = zonedMidnight(nextLocalDay, timeZone);
  return { timeMin: start.toISOString(), timeMax: end.toISOString() };
}

function localDateRange(date, days = 1, timeZone = "Europe/Paris") {
  if (!Number.isInteger(days) || days < 1) throw new TypeError("Durée Calendar invalide.");
  const { year, month, day } = localDateParts(date, timeZone);
  const start = zonedMidnight(new Date(Date.UTC(year, month - 1, day, 12)), timeZone);
  const end = zonedMidnight(new Date(Date.UTC(year, month - 1, day + days, 12)), timeZone);
  return { timeMin: start.toISOString(), timeMax: end.toISOString() };
}

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
  async function listCompleteCalendarEvents({ timeMin = new Date().toISOString(), timeMax, calendarId = "primary", maxPages = COMPLETE_MAX_PAGES, maxItems = COMPLETE_MAX_ITEMS, timeoutMs = COMPLETE_TIMEOUT_MS } = {}) {
    if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > COMPLETE_MAX_PAGES) throw new TypeError("Nombre de pages Calendar invalide.");
    if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > COMPLETE_MAX_ITEMS) throw new TypeError("Volume Calendar invalide.");
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > COMPLETE_TIMEOUT_MS) throw new TypeError("Durée Calendar invalide.");
    const startedAt = Date.now(); const items = []; const seenTokens = new Set(); let pageToken = null; let pages = 0;
    while (pages < maxPages && items.length < maxItems) {
      const params = new URLSearchParams({ timeMin, singleEvents: "true", orderBy: "startTime", maxResults: String(Math.min(COMPLETE_PAGE_SIZE, maxItems - items.length)) });
      if (timeMax) params.set("timeMax", timeMax);
      if (pageToken) params.set("pageToken", pageToken);
      let data;
      try {
        const remaining = timeoutMs - (Date.now() - startedAt);
        if (remaining <= 0) return { items, complete: false, pages, reasonCode: "TIME_LIMIT" };
        // Reliability retries own their backoff and cannot share this deadline. A complete
        // calendar read therefore uses one bounded attempt per page.
        data = await base.run(async () => providerFetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`, { token: await token(), timeoutMs: remaining }), { idempotent: true, maxRetries: 0 });
      } catch (error) { return { items, complete: false, pages, reasonCode: Date.now() - startedAt >= timeoutMs ? "TIME_LIMIT" : "READ_ERROR" }; }
      pages += 1; items.push(...(Array.isArray(data.items) ? data.items : []));
      const nextToken = data.nextPageToken;
      if (!nextToken) return { items, complete: true, pages, reasonCode: null };
      if (seenTokens.has(nextToken)) return { items, complete: false, pages, reasonCode: "REPEATED_PAGE_TOKEN" };
      seenTokens.add(nextToken); pageToken = nextToken;
    }
    return { items, complete: false, pages, reasonCode: pages >= maxPages ? "PAGE_LIMIT" : "VOLUME_LIMIT" };
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
  return Object.assign(base, { listCalendarEvents, listCompleteCalendarEvents, getCalendarEvent: listCalendarEvents,
    findAvailableSlots: listCalendarEvents, detectCalendarConflicts, prepareCalendarEvent,
    previewCalendarChange, applyCalendarChangeWithApproval, listCalendars, getColors,
    resolveBlueberryColorId, findManagedEvent, createManagedEvent, updateManagedEvent, deleteManagedEvent });
}
module.exports = { createCalendarConnector, localDateRange, localDayRange };
