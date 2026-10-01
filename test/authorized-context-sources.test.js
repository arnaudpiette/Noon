"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createAuthorizedContextSources, SOURCE_STATUSES, SYSTEM_PERMISSION_STATUSES, sourceSelection } = require("../services/context/authorized-context-sources");

function adapter(items = [], { status = SOURCE_STATUSES.AVAILABLE, error = null } = {}) {
  let calls = 0;
  return {
    status: () => status,
    read: async () => { calls += 1; if (error) throw error; return items; },
    get calls() { return calls; },
  };
}

test("sélectionne les sources avant toute lecture", () => {
  assert.deepEqual(sourceSelection({ query: "continue mon portfolio", projectId: "portfolio", entityStatus: "RESOLVED" }).sort(), ["execution", "git"]);
  assert.deepEqual(sourceSelection({ query: "qu'est-ce que je fais aujourd'hui ?" }).sort(), ["calendar", "execution", "reminders"]);
  assert.deepEqual(sourceSelection({ query: "ai-je reçu une réponse par email ?" }), ["gmail"]);
  assert.deepEqual(sourceSelection({ query: "où en est le code de Noon ?" }).sort(), ["execution", "git"]);
  assert.deepEqual(sourceSelection({ query: "bonjour" }), []);
});

test("une intention email ne lit ni Git, ni fichiers, ni calendrier", async () => {
  const gmail = adapter([{ id: "mail-1", payload: { subject: "Réponse" }, localOnly: true }]);
  const git = adapter(); const files = adapter(); const calendar = adapter();
  const sources = createAuthorizedContextSources({ adapters: { gmail, git, files, calendar } });
  const result = await sources.collect({ query: "ai-je reçu une réponse par email ?" });
  assert.equal(gmail.calls, 1); assert.equal(git.calls, 0); assert.equal(files.calls, 0); assert.equal(calendar.calls, 0);
  assert.equal(result.diagnostics.gmail.status, SOURCE_STATUSES.AVAILABLE);
  assert.equal(result.diagnostics.git.status, SOURCE_STATUSES.SKIPPED_NOT_RELEVANT);
});

test("une source non autorisée ne lit jamais son adapter", async () => {
  const gmail = adapter([], { status: SOURCE_STATUSES.UNAUTHORIZED });
  const sources = createAuthorizedContextSources({ adapters: { gmail } });
  const result = await sources.collect({ query: "cherche mon email" });
  assert.equal(gmail.calls, 0);
  assert.equal(result.diagnostics.gmail.status, SOURCE_STATUSES.UNAUTHORIZED);
});

test("Notes A3 distingue TCC non pré-vérifié et politique Noon avant lecture", async () => {
  let noteReads = 0;
  const notes = {
    status: () => ({ status: SOURCE_STATUSES.AVAILABLE, systemPermission: SYSTEM_PERMISSION_STATUSES.TCC_UNVERIFIED }),
    read: async () => { noteReads += 1; return [{ id: "note-1", localOnly: true, payload: { title: "Fictive" } }]; },
  };
  const sources = createAuthorizedContextSources({ adapters: { notes } });
  const available = await sources.collect({ query: "mes notes" });
  assert.equal(noteReads, 1);
  assert.equal(available.diagnostics.notes.status, SOURCE_STATUSES.AVAILABLE);
  assert.equal(available.diagnostics.notes.systemPermission, "TCC_UNVERIFIED");

  let blockedReads = 0;
  const blocked = { status: () => SOURCE_STATUSES.UNAUTHORIZED, read: async () => { blockedReads += 1; return []; } };
  const denied = await createAuthorizedContextSources({ adapters: { notes: blocked } }).collect({ query: "mes notes" });
  assert.equal(blockedReads, 0);
  assert.equal(denied.diagnostics.notes.status, SOURCE_STATUSES.UNAUTHORIZED);
  assert.equal(denied.diagnostics.notes.systemPermission, null);
});

test("un refus macOS Notes est isolé après tentative sans transformer TCC inconnu en accord", async () => {
  let reminderReads = 0;
  const notes = {
    status: () => ({ status: SOURCE_STATUSES.AVAILABLE, systemPermission: SYSTEM_PERMISSION_STATUSES.TCC_UNVERIFIED }),
    read: async () => { throw Object.assign(new Error("refus macOS privé"), { status: 403, code: "APPLE_NOTES_PERMISSION_DENIED", stack: "stack privée" }); },
  };
  const reminders = { status: () => SOURCE_STATUSES.AVAILABLE, read: async () => { reminderReads += 1; return [{ id: "r1", localOnly: true, payload: { summary: "Fictif" } }]; } };
  const result = await createAuthorizedContextSources({ adapters: { notes, reminders } }).collect({ query: "mes notes et un rappel" });
  assert.equal(result.diagnostics.notes.status, SOURCE_STATUSES.UNAUTHORIZED);
  assert.equal(result.diagnostics.notes.reasonCode, "APPLE_NOTES_PERMISSION_DENIED");
  assert.equal(result.diagnostics.notes.systemPermission, "TCC_UNVERIFIED");
  assert.equal(reminderReads, 1);
  assert.equal(result.items.length, 1);
});

test("une panne connector est isolée et les autres lectures survivent", async () => {
  const calendar = adapter([], { error: new Error("indisponible") });
  const reminders = adapter([{ id: "r1", payload: { summary: "Rappel" }, localOnly: true }]);
  const execution = adapter([{ id: "e1", payload: { pendingActions: 1 }, allowedForRemoteModel: true }]);
  const sources = createAuthorizedContextSources({ adapters: { calendar, reminders, execution } });
  const result = await sources.collect({ query: "que fais-je aujourd'hui ?" });
  assert.equal(result.diagnostics.calendar.status, SOURCE_STATUSES.ERROR);
  assert.equal(result.diagnostics.reminders.status, SOURCE_STATUSES.AVAILABLE);
  assert.equal(result.items.length, 2);
});

test("les quotas, le ranking et le scope projet restent bornés", async () => {
  const git = adapter(Array.from({ length: 4 }, (_, index) => ({ id: `git-${index}`, projectId: "portfolio", relevance: index / 10, payload: { branch: "main" }, allowedForRemoteModel: true })));
  const execution = adapter([{ id: "other", projectId: "autre", payload: { pendingActions: 1 } }, { id: "portfolio", projectId: "portfolio", relevance: 1, payload: { pendingActions: 2 } }]);
  const sources = createAuthorizedContextSources({ adapters: { git, execution } });
  const result = await sources.collect({ query: "où en est le code", projectId: "portfolio", entityStatus: "RESOLVED" });
  assert.equal(result.diagnostics.git.count, 1);
  assert.equal(result.items[0].sourceId, "portfolio");
  assert.ok(result.items.every((item) => !item.projectId || item.projectId === "portfolio"));
});

test("une entité ambiguë ne déclenche pas les lectures projet", async () => {
  const git = adapter(); const execution = adapter();
  const sources = createAuthorizedContextSources({ adapters: { git, execution } });
  const result = await sources.collect({ query: "continue le site", entityStatus: "AMBIGUOUS" });
  assert.equal(git.calls, 0); assert.equal(execution.calls, 0);
  assert.equal(result.diagnostics.git.status, SOURCE_STATUSES.SKIPPED_NOT_RELEVANT);
});

test("une source lente expire sans empêcher les autres sources sélectionnées", async () => {
  const calendar = { status: () => SOURCE_STATUSES.AVAILABLE, read: () => new Promise(() => {}) };
  const reminders = adapter([{ id: "r1", payload: { summary: "Rappel" }, localOnly: true }]);
  const execution = adapter([]);
  const sources = createAuthorizedContextSources({ adapters: { calendar, reminders, execution }, sourceTimeoutMs: 10 });
  const result = await sources.collect({ query: "que fais-je demain ?" });
  assert.equal(result.diagnostics.calendar.status, SOURCE_STATUSES.ERROR);
  assert.equal(reminders.calls, 1);
  assert.equal(result.items.length, 1);
});

test("l'adapter Rappels A3 reçoit son quota sans réutiliser la lecture historique", async () => {
  let request;
  const reminders = { status: () => SOURCE_STATUSES.AVAILABLE, read: async (input) => { request = input; return []; } };
  const sources = createAuthorizedContextSources({ adapters: { reminders } });
  await sources.collect({ query: "une tâche" });
  assert.equal(request.limit, 5);
});

test("Notes A3 reçoit cinq secondes, annule à l'expiration et ignore le résultat tardif", async () => {
  const timers = [];
  let resolveNotes;
  let notesSignal;
  let reminderCalls = 0;
  const notes = {
    status: () => SOURCE_STATUSES.AVAILABLE,
    read: ({ signal, timeoutMs }) => {
      notesSignal = signal;
      assert.equal(timeoutMs, 5_000);
      return new Promise((resolve) => { resolveNotes = resolve; });
    },
  };
  const reminders = {
    status: () => SOURCE_STATUSES.AVAILABLE,
    read: async () => {
      reminderCalls += 1;
      return [{ id: "r1", payload: { summary: "Rappel" }, localOnly: true }];
    },
  };
  const sources = createAuthorizedContextSources({
    adapters: { notes, reminders },
    setTimeoutFn: (callback, ms) => {
      const timer = { callback, ms, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeoutFn: (timer) => { timer.cleared = true; },
  });
  const pending = sources.collect({ query: "mes notes et une tâche" });
  await Promise.resolve();
  const notesTimer = timers.find((timer) => timer.ms === 5_000 && !timer.cleared);
  assert.ok(notesTimer);
  notesTimer.callback();
  const result = await pending;
  assert.equal(notesSignal.aborted, true);
  assert.equal(result.diagnostics.notes.status, SOURCE_STATUSES.ERROR);
  assert.equal(result.diagnostics.notes.reasonCode, "CONTEXT_SOURCE_TIMEOUT");
  assert.equal(reminderCalls, 1);
  assert.equal(result.items.length, 1);
  resolveNotes([{ id: "late-note", payload: { title: "Tardive" }, localOnly: true }]);
  await Promise.resolve();
  assert.equal(result.items.length, 1);
  assert.ok(timers.every((timer) => timer.cleared));
});

test("déduplique uniquement les éléments portant une identité canonique explicite", async () => {
  const calendar = adapter([{ id: "calendar-1", canonicalKey: "event:42", relevance: 0.8, payload: { title: "Réunion", eventId: "event:42" }, localOnly: true }]);
  const reminders = adapter([{ id: "reminder-1", canonicalKey: "event:42", relevance: 0.9, payload: { summary: "Réunion", eventId: "event:42" }, localOnly: true }]);
  const execution = adapter([]);
  const sources = createAuthorizedContextSources({ adapters: { calendar, reminders, execution } });
  const result = await sources.collect({ query: "agenda demain" });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].sourceId, "reminder-1");
  assert.equal(result.deduplicatedCount, 1);
});
