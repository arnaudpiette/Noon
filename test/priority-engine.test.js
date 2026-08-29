"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  PRIORITY_SCORING_VERSION,
  createPriorityEngine,
  normalizePriorityAction,
  rankActions,
  scoreRecommendation,
} = require("../services/personal-intelligence/priority-engine");
const { prioritizeActions } = require("../lib/morning-brief");

const NOW = new Date("2026-08-28T08:00:00.000Z");
const base = { impact: 0.5, urgency: 0.4, confidence: 0.8, projectPriority: 50 };

test("une échéance imminente et un fort impact produisent une priorité très haute", () => {
  const result = scoreRecommendation({ ...base, impact: 1, urgency: 0.9, deadline: "2026-08-28T12:00:00.000Z" }, undefined, NOW);
  assert.ok(result.score >= 70);
  assert.equal(result.urgencyLevel, "urgente");
});

test("un fort impact lointain reste important sans devenir urgent", () => {
  const result = scoreRecommendation({ ...base, impact: 1, urgency: 0.2, deadline: "2026-10-28T12:00:00.000Z" }, undefined, NOW);
  assert.equal(result.urgencyLevel, "importante");
  assert.equal(result.overdue, false);
});

test("une petite urgence proche reste sous une action critique à fort impact", () => {
  const lowImpact = scoreRecommendation({ ...base, impact: 0.1, urgency: 0.2, deadline: "2026-08-28T10:00:00.000Z" }, undefined, NOW);
  const critical = scoreRecommendation({ ...base, impact: 1, urgency: 1, projectPriority: 100, blockingRisk: 1 }, undefined, NOW);
  assert.ok(critical.score > lowImpact.score);
});

test("une action en retard est signalée sans obtenir automatiquement 100", () => {
  const result = scoreRecommendation({ ...base, impact: 0.2, urgency: 0.2, deadline: "2026-08-27T08:00:00.000Z" }, undefined, NOW);
  assert.equal(result.overdue, true);
  assert.ok(result.score < 100);
});

test("une action sans échéance peut monter si elle débloque le travail", () => {
  const blocked = scoreRecommendation({ ...base, impact: 0.8, blockingRisk: 1 }, undefined, NOW);
  const passive = scoreRecommendation({ ...base, impact: 0.8, blockingRisk: 0 }, undefined, NOW);
  assert.ok(blocked.score > passive.score);
});

test("la priorité stratégique départage deux tâches identiques", () => {
  const strategic = scoreRecommendation({ ...base, projectPriority: 100 }, undefined, NOW);
  const secondary = scoreRecommendation({ ...base, projectPriority: 0 }, undefined, NOW);
  assert.ok(strategic.score > secondary.score);
  assert.equal(normalizePriorityAction({ projectPriority: 0 }).projectPriority, 0);
});

test("le créneau affecte la compatibilité sans modifier l'impact fondamental", () => {
  const short = scoreRecommendation({ ...base, estimatedDurationMinutes: 20, availableSlotMinutes: 30 }, undefined, NOW);
  const long = scoreRecommendation({ ...base, estimatedDurationMinutes: 120, availableSlotMinutes: 30 }, undefined, NOW);
  assert.equal(short.scheduleFit.fits, true);
  assert.equal(long.scheduleFit.fits, false);
  assert.equal(short.factors.impact, long.factors.impact);
});

test("une note peu fiable ne devient pas une urgence certaine", () => {
  const result = scoreRecommendation({ ...base, sourceType: "note", confidence: 0.1, urgency: 0.2 }, undefined, NOW);
  assert.notEqual(result.urgencyLevel, "urgente");
  assert.equal(result.factors.confidence, 0.1);
});

test("la répétition pénalise, mais une nouvelle échéance critique peut refaire monter l'action", () => {
  const repeated = scoreRecommendation({ ...base, repetition: 1, deadline: "2026-09-28T08:00:00.000Z" }, undefined, NOW);
  const resurfaced = scoreRecommendation({ ...base, repetition: 1, urgency: 1, impact: 1, deadline: "2026-08-28T09:00:00.000Z" }, undefined, NOW);
  assert.ok(resurfaced.score > repeated.score);
});

test("les informations sans action sont exclues du classement", () => {
  const ranked = rankActions([{ id: "info", title: "Information", type: "information", impact: 1 }, { id: "todo", title: "Action", impact: 0.5 }], { now: NOW });
  assert.deepEqual(ranked.map((item) => item.id), ["todo"]);
});

test("le brief matinal consomme exactement le classement central", () => {
  const actions = [
    ...Array.from({ length: 5 }, (_, index) => ({ id: `reminder-${index}`, title: `Rappel ${index}`, sourceType: "reminder", impact: 0.4 + index / 10 })),
    ...Array.from({ length: 3 }, (_, index) => ({ id: `note-${index}`, title: `Note ${index}`, sourceType: "note", impact: 0.3, confidence: 0.4 })),
    ...Array.from({ length: 2 }, (_, index) => ({ id: `project-${index}`, title: `Projet ${index}`, sourceType: "project", projectPriority: 70 + index * 20 })),
    { id: "deadline-1", title: "Échéance proche", sourceType: "task", deadline: "2026-08-29T08:00:00.000Z", impact: 0.8 },
    { id: "deadline-2", title: "Échéance lointaine", sourceType: "task", deadline: "2026-09-29T08:00:00.000Z", impact: 0.6 },
  ];
  const projection = (items) => items.map(({ id, score, priorityLevel, scoringVersion }) => ({ id, score, priorityLevel, scoringVersion }));
  assert.deepEqual(projection(prioritizeActions(actions, 12)), projection(rankActions(actions, { limit: 12 })));
  const source = fs.readFileSync(path.join(__dirname, "../lib/morning-brief.js"), "utf8");
  assert.doesNotMatch(source, /urgency\s*\*\s*0\.45|impact\s*\*\s*0\.35/);
});

test("les traces de score excluent le titre et le contenu privés", () => {
  const events = [];
  const engine = createPriorityEngine({ now: () => NOW, debug: (event, metadata) => events.push({ event, metadata }) });
  engine.score({ id: "safe-id", title: "TITRE_SECRET", content: "CONTENU_SECRET" });
  const trace = JSON.stringify(events);
  assert.doesNotMatch(trace, /TITRE_SECRET|CONTENU_SECRET/);
  assert.match(trace, /safe-id/);
});

test("chaque résultat expose la version déterministe du score", () => {
  assert.equal(PRIORITY_SCORING_VERSION, 1);
  assert.equal(scoreRecommendation(base, undefined, NOW).scoringVersion, 1);
});
