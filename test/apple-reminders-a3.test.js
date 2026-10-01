"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  A3_REMINDER_DETAIL_SCRIPT,
  A3_REMINDER_METADATA_SCRIPT,
  listIncompleteReminders,
  listIncompleteRemindersForContext,
} = require("../services/connectors/apple-reminders");

function contextRunner({ metadata = "", details = {} } = {}) {
  const calls = [];
  return {
    calls,
    runner: (_command, args, _options, callback) => {
      calls.push(args);
      if (args[1] === A3_REMINDER_METADATA_SCRIPT) return callback(null, metadata);
      if (args[1] === A3_REMINDER_DETAIL_SCRIPT) return callback(null, details[args.at(-1)] || "");
      callback(null, "legacy\tHistorique\t");
    },
  };
}

test("A3 sélectionne et trie les métadonnées avant le quota et les détails", async () => {
  const fixture = contextRunner({
    metadata: [
      "late-initial\t2026-10-12T09:00:00.000Z",
      "future\t2026-11-01T09:00:00.000Z",
      "b-tie\t2026-10-11T09:00:00.000Z",
      "no-date\t",
      "a-tie\t2026-10-11T09:00:00.000Z",
      "urgent-after-five\t2026-10-09T09:00:00.000Z",
    ].join("\n"),
    details: Object.fromEntries(["late-initial", "b-tie", "no-date", "a-tie", "urgent-after-five"].map((id) => [id, `${id}\tTitre ${id}\t2026-10-11T09:00:00.000Z`])),
  });
  const reminders = await listIncompleteRemindersForContext({ limit: 5, now: new Date("2026-10-10T10:00:00.000Z") }, fixture.runner);
  assert.deepEqual(reminders.map((item) => item.id), ["urgent-after-five", "a-tie", "b-tie", "late-initial", "no-date"]);
  assert.equal(fixture.calls[0][1], A3_REMINDER_METADATA_SCRIPT);
  assert.equal(fixture.calls[0].at(-1), "14");
  assert.deepEqual(fixture.calls.slice(1).map((args) => args.at(-1)), ["urgent-after-five", "a-tie", "b-tie", "late-initial", "no-date"]);
  assert.equal(fixture.calls.some((args) => args.at(-1) === "future"), false);
  assert.match(A3_REMINDER_METADATA_SCRIPT, /dueValue > cutoffDate/);
});

test("A3 retourne vide sans lecture détaillée si aucune métadonnée n'est sélectionnée", async () => {
  const fixture = contextRunner();
  assert.deepEqual(await listIncompleteRemindersForContext({ limit: 5 }, fixture.runner), []);
  assert.equal(fixture.calls.length, 1);
});

test("A3 partage une échéance entre métadonnées et détails sans démarrer après expiration", async () => {
  let time = 0;
  const calls = [];
  const runner = (_command, args, options, callback) => {
    calls.push({ id: args.at(-1), script: args[1], timeout: options.timeout });
    if (args[1] === A3_REMINDER_METADATA_SCRIPT) {
      time = 4_900;
      return callback(null, "a\t2026-10-11T09:00:00.000Z\nb\t2026-10-12T09:00:00.000Z");
    }
    if (args.at(-1) === "a") time = 4_950;
    callback(null, `${args.at(-1)}\tTitre\t2026-10-11T09:00:00.000Z`);
  };
  await listIncompleteRemindersForContext({ limit: 2, now: new Date("2026-10-10T10:00:00.000Z"), timeoutMs: 5_000, clock: () => time }, runner);
  assert.deepEqual(calls.map((call) => call.timeout), [5_000, 100, 50]);

  time = 0; calls.length = 0;
  await assert.rejects(listIncompleteRemindersForContext({ timeoutMs: 5_000, clock: () => time }, (_command, args, _options, callback) => {
    calls.push(args);
    time = 5_001;
    callback(null, "late\t2026-10-11T09:00:00.000Z");
  }), (error) => error.code === "CONTEXT_SOURCE_TIMEOUT");
  assert.equal(calls.length, 1);
});

test("A3 demande l'arrêt du processus et ignore son résultat tardif", async () => {
  const controller = new AbortController();
  let callback;
  let killed = 0;
  const pending = listIncompleteRemindersForContext({ signal: controller.signal }, (_command, _args, _options, done) => {
    callback = done;
    return { kill: () => { killed += 1; } };
  });
  controller.abort(Object.assign(new Error("Authorized context source timeout"), { code: "CONTEXT_SOURCE_TIMEOUT" }));
  await assert.rejects(pending, (error) => error.code === "CONTEXT_SOURCE_TIMEOUT");
  assert.equal(killed, 1);
  callback(null, "late\t2026-10-11T09:00:00.000Z");
});

test("la lecture historique des rappels incomplets conserve son chemin distinct", async () => {
  const calls = [];
  const reminders = await listIncompleteReminders((_command, args, _options, callback) => {
    calls.push(args);
    callback(null, "legacy\tHistorique\t\n");
  });
  assert.equal(reminders.length, 1);
  assert.notEqual(calls[0][1], A3_REMINDER_METADATA_SCRIPT);
});
