"use strict";
const { readServerSource } = require("./helpers/server-source");
const { readAppSource } = require("./helpers/app-source");

// V3-L2d — journal local d'usage du Brief : à l'heure, ouvert, série, rétention, câblage.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createBriefUsageLog, isOnTime, parisDate } = require("../services/daily-brief/brief-usage-log");

const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", ...parts), "utf8");
function setup(startIso) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "noon-brief-usage-"));
  const clock = { now: new Date(startIso) };
  const log = createBriefUsageLog({ filePath: path.join(dir, "brief-usage-log.json"), now: () => clock.now });
  return { dir, clock, log, file: path.join(dir, "brief-usage-log.json") };
}

test("isOnTime : jour même, au plus 15 minutes après l'heure prévue (heure de Paris)", () => {
  assert.equal(isOnTime({ date: "2026-11-23", scheduledTime: "07:00", generatedAt: "2026-11-23T06:14:00Z" }), true); // 07:14 Paris
  assert.equal(isOnTime({ date: "2026-11-23", scheduledTime: "07:00", generatedAt: "2026-11-23T06:16:00Z" }), false);
  assert.equal(isOnTime({ date: "2026-11-23", scheduledTime: "07:00", generatedAt: "2026-11-22T23:30:00Z" }), true); // 00:30 Paris le 23
  assert.equal(isOnTime({ date: "2026-11-23", scheduledTime: "07:00", generatedAt: "2026-11-24T06:00:00Z" }), false);
  assert.equal(isOnTime({ date: "2026-11-23", generatedAt: "2026-11-23T06:00:00Z" }), false);
  assert.equal(parisDate(new Date("2026-11-22T23:30:00Z")), "2026-11-23");
});

test("génération, échec puis ouverture : une ligne par jour, sans contenu, première génération conservée", () => {
  const { clock, log, file } = setup("2026-11-23T05:50:00Z");
  log.recordFailure({ code: "NETWORK down!", scheduledTime: "07:00" });
  assert.equal(log.summary({ days: 1 }).failed, 1);
  log.recordGenerated({ date: "2026-11-23", generatedAt: "2026-11-23T06:05:00Z", trigger: "scheduled", scheduledTime: "07:00" });
  log.recordGenerated({ date: "2026-11-23", generatedAt: "2026-11-23T09:00:00Z", trigger: "manual", scheduledTime: "07:00" });
  clock.now = new Date("2026-11-23T07:30:00Z");
  assert.ok(log.recordOpened({ date: "2026-11-23" }));
  log.recordOpened({ date: "2026-11-23" });
  assert.equal(log.recordOpened({ date: "2026-11-22" }), null, "une date passée ne compte pas");
  const today = log.summary({ days: 1 }).rows[0];
  assert.deepEqual(today, { date: "2026-11-23", scheduledTime: "07:00", generatedAt: "2026-11-23T06:05:00.000Z", trigger: "scheduled", onTime: true, failureCode: null, openedAt: "2026-11-23T07:30:00.000Z", opens: 2 });
  const stored = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(stored.days["2026-11-23"].regenerations, 1);
  assert.equal(stored.days["2026-11-23"].failure, undefined);
  assert.equal((fs.statSync(file).mode & 0o777).toString(8), "600");
});

test("bilan sur 14 jours et série d'ouvertures (aujourd'hui non ouvert ne rompt pas la série)", () => {
  const { clock, log } = setup("2026-11-10T08:00:00Z");
  for (let day = 10; day <= 22; day += 1) {
    clock.now = new Date(`2026-11-${day}T08:00:00Z`);
    log.recordGenerated({ date: `2026-11-${day}`, generatedAt: `2026-11-${day}T${day === 15 ? "09" : "06"}:00:00Z`, trigger: "scheduled", scheduledTime: "07:00" });
    if (day !== 12) log.recordOpened({ date: `2026-11-${day}` });
  }
  clock.now = new Date("2026-11-23T05:00:00Z");
  const usage = log.summary({ days: 14 });
  assert.equal(usage.days, 14);
  assert.equal(usage.rows[0].date, "2026-11-10");
  assert.equal(usage.rows.at(-1).date, "2026-11-23");
  assert.equal(usage.generated, 13);
  assert.equal(usage.onTime, 12);
  assert.equal(usage.opened, 12);
  assert.equal(usage.openedStreak, 10, "du 13 au 22, le 23 pas encore ouvert");
});

test("fichier abîmé lu comme vide ; jours de plus de 120 jours supprimés", () => {
  const { clock, log, file } = setup("2026-01-01T08:00:00Z");
  fs.writeFileSync(file, "{pas du json");
  assert.equal(log.summary({ days: 3 }).generated, 0);
  log.recordGenerated({ date: "2026-01-01", generatedAt: "2026-01-01T06:00:00Z", scheduledTime: "07:00" });
  clock.now = new Date("2026-06-01T08:00:00Z");
  log.recordGenerated({ date: "2026-06-01", generatedAt: "2026-06-01T05:00:00Z", scheduledTime: "07:00" });
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(file, "utf8")).days), ["2026-06-01"]);
});

test("câblage : génération journalisée, ouverture protégée par l'en-tête, Electron marque le déclencheur planifié", () => {
  const server = readServerSource();
  assert.match(server, /briefUsageLog\.recordGenerated\(\{ date: brief\.date/);
  assert.match(server, /briefUsageLog\.recordFailure\(/);
  assert.match(server, /requestPath === "\/daily-brief\/opened"[\s\S]{0,120}x-noon-request/);
  assert.match(server, /requestPath === "\/daily-brief\/usage"/);
  assert.match(read("electron", "main.js"), /JSON\.stringify\(\{ force, trigger: "scheduled" \}\)/);
  assert.match(readAppSource(), /fetch\("\/daily-brief\/opened"/);
});
