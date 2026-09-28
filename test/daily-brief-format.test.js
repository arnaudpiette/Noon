"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  MORNING_BRIEF_SYSTEM_PROMPT,
} = require("../lib/morning-brief");

const {
  deterministicBrief,
  buildDailyProposals,
} = require("../services/daily-brief/daily-brief-engine");

test("le prompt Daily Brief impose les sections ChatGPT et les règles de vérité", () => {
  for (const section of [
    "☀️ Bonjour Arnaud",
    "📅 Aujourd’hui",
    "🎯 Tes priorités",
    "🕳️ Créneaux disponibles",
    "⏰ À ne pas oublier",
    "📌 Projets",
    "✉️ À surveiller",
    "💡 Noon te propose",
    "📆 Demain",
    "🎨 Veille créative",
  ]) {
    assert.match(MORNING_BRIEF_SYSTEM_PROMPT, new RegExp(section));
  }

  assert.match(MORNING_BRIEF_SYSTEM_PROMPT, /N’invente aucun fait/);
  assert.match(MORNING_BRIEF_SYSTEM_PROMPT, /ne présente aucun horaire comme un créneau libre confirmé/i);
  assert.match(MORNING_BRIEF_SYSTEM_PROMPT, /12h30–13h30/);
});

test("le fallback propose seulement un créneau Calendar confirmé", () => {
  const brief = deterministicBrief({
    date: "2026-09-28",
    priorities: [{ title: "Avancer Noon", reasons: ["projet prioritaire"] }],
    calendar: [],
    reminders: [],
    projects: [],
    emails: [],
    tomorrow: [],
    creative: [],
    sourceStatus: { "google-calendar": "ready" },
    dailyPlan: { calendarAvailability: "confirmed" },
    scheduledBlocks: [{
      status: "proposed",
      title: "Avancer Noon",
      start: "2026-09-28T08:00:00Z",
      end: "2026-09-28T09:00:00Z",
    }],
  });

  assert.match(brief, /☀️ Bonjour Arnaud/);
  assert.match(brief, /🕳️ Créneaux disponibles/);
  assert.match(brief, /💡 Noon te propose/);
  assert.match(brief, /Avancer Noon/);
});

test("le fallback refuse de présenter un créneau théorique comme libre", () => {
  const brief = deterministicBrief({
    date: "2026-09-28",
    priorities: [{ title: "Avancer Noon", reasons: ["projet prioritaire"] }],
    calendar: [],
    reminders: [],
    projects: [],
    emails: [],
    tomorrow: [],
    creative: [],
    sourceStatus: { "google-calendar": "unavailable" },
    dailyPlan: { calendarAvailability: "theoretical" },
    scheduledBlocks: [{
      status: "proposed",
      title: "Avancer Noon",
      start: "2026-09-28T08:00:00Z",
      end: "2026-09-28T09:00:00Z",
    }],
  });

  assert.match(brief, /Je ne peux pas confirmer/);
  assert.doesNotMatch(brief, /08:00:00Z → 2026-09-28T09:00:00Z · Avancer Noon/);
});


test("les propositions utilisent d'abord les créneaux confirmés puis les priorités", () => {
  const proposals = buildDailyProposals({
    dailyPlan: { calendarAvailability: "confirmed" },
    scheduledBlocks: [{
      status: "proposed",
      actionId: "a1",
      title: "Avancer Noon",
      start: "2026-09-28T08:00:00Z",
      end: "2026-09-28T09:00:00Z",
      validationRequired: true,
    }],
    priorities: [
      { id: "a1", title: "Avancer Noon", reasons: ["projet prioritaire"] },
      { id: "a2", title: "Préparer la soutenance", reasons: ["échéance proche"] },
    ],
  });

  assert.equal(proposals.length, 2);
  assert.equal(proposals[0].type, "scheduled_action");
  assert.equal(proposals[0].confirmedSlot, true);
  assert.equal(proposals[0].actionId, "a1");
  assert.equal(proposals[1].type, "priority_action");
  assert.equal(proposals[1].actionId, "a2");
});

test("les propositions n'inventent aucun horaire si Calendar n'est pas confirmé", () => {
  const proposals = buildDailyProposals({
    dailyPlan: { calendarAvailability: "theoretical" },
    scheduledBlocks: [{
      status: "proposed",
      actionId: "a1",
      title: "Avancer Noon",
      start: "2026-09-28T08:00:00Z",
      end: "2026-09-28T09:00:00Z",
    }],
    priorities: [{
      id: "a1",
      title: "Avancer Noon",
      reasons: ["projet prioritaire"],
    }],
  });

  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].type, "priority_action");
  assert.equal(proposals[0].confirmedSlot, false);
  assert.equal(proposals[0].start, null);
  assert.equal(proposals[0].end, null);
});

test("les propositions sont bornées à trois actions", () => {
  const proposals = buildDailyProposals({
    priorities: [
      { id: "1", title: "A" },
      { id: "2", title: "B" },
      { id: "3", title: "C" },
      { id: "4", title: "D" },
    ],
  });

  assert.deepEqual(
    proposals.map((item) => item.title),
    ["A", "B", "C"]
  );
});
