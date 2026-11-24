"use strict";

// V3-L7 — lectures déterministes sorties de ask-ai.js : chaque branche annonce son activité,
// ne lance jamais d'exception vers askAI (elle répond toujours) et utilise seulement le
// connecteur et la session fournis.
const assert = require("node:assert/strict");
const test = require("node:test");
const { handleDeterministicCalendarRead, handleDeterministicRecentEmailRead } = require("../services/orchestration/ask-ai-deterministic-reads");
const { readServerSource } = require("./helpers/server-source");

function activityRecorder() {
  const activity = [];
  return { activity, setSessionActivity: (...args) => activity.push(args) };
}

test("emails récents : connecteur en échec → réponse sans exception, activité de la bonne session", async () => {
  const { activity, setSessionActivity } = activityRecorder();
  const gmailConnector = { searchGmailMessages: async () => { throw Object.assign(new Error("Google non connecté"), { status: 401 }); }, getGmailMessage: async () => ({}) };
  const result = await handleDeterministicRecentEmailRead({ gmailConnector, sessionId: "session-1", setSessionActivity });
  assert.equal(typeof result, "object");
  assert.equal(typeof result.status, "string");
  assert.equal(typeof result.answer, "string");
  assert.ok(activity.length >= 1);
  assert.ok(activity.every(([sessionId]) => sessionId === "session-1"));
});

test("emails récents : boîte vide → réponse terminée, aucun message lu", async () => {
  const { setSessionActivity } = activityRecorder();
  let read = 0;
  const gmailConnector = { searchGmailMessages: async () => ({ messages: [] }), getGmailMessage: async () => { read++; return {}; } };
  const result = await handleDeterministicRecentEmailRead({ gmailConnector, sessionId: "s", setSessionActivity });
  assert.equal(read, 0);
  assert.equal(typeof result.answer, "string");
});

test("agenda : connecteur en échec → réponse sans exception, activité de la bonne session", async () => {
  const { activity, setSessionActivity } = activityRecorder();
  const fail = async () => { throw Object.assign(new Error("Google non connecté"), { status: 401 }); };
  const calendarConnector = new Proxy({ connected: true }, { get: (target, key) => (key in target ? target[key] : fail) });
  const result = await handleDeterministicCalendarRead({ calendarConnector, calendarNormalized: "qu'est-ce que j'ai demain", sessionId: "session-2", setSessionActivity });
  assert.equal(typeof result, "object");
  assert.equal(typeof result.answer, "string");
  assert.ok(activity.every(([sessionId]) => sessionId === "session-2"));
});

test("askAI renvoie ces branches à la même place, avec leurs seules dépendances", () => {
  const source = readServerSource();
  assert.match(source, /if \(deterministicCalendarRead\) \{\n\s+return handleDeterministicCalendarRead\(\{ calendarConnector, calendarNormalized, sessionId, setSessionActivity \}\);\n\s+\}/);
  assert.match(source, /if \(deterministicRecentEmailRead\) \{\n\s+return handleDeterministicRecentEmailRead\(\{ gmailConnector, sessionId, setSessionActivity \}\);\n\s+\}/);
});
