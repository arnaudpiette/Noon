"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createPersonalDatabase, loadSqlite } = require("../services/persistence/database");
const { createPersonalIntelligenceRepository } = require("../services/persistence/repositories/personal-intelligence-repository");
const { createDeduplicationService } = require("../services/personal-intelligence/deduplication-service");
const { createPriorityEngine } = require("../services/personal-intelligence/priority-engine");
const { createProactiveEngine } = require("../services/proactive/proactive-engine");
const { createReviewLearningEngine } = require("../services/review/review-learning-engine");

const AT = new Date("2026-10-01T10:00:00.000Z");
const sqlite = loadSqlite();

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noon-review-learning-scope-"));
  const database = createPersonalDatabase(path.join(directory, "personal.sqlite"));
  return {
    directory,
    database,
    repository: createPersonalIntelligenceRepository(database),
    close() {
      database.close();
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

function proactive(repository) {
  return createProactiveEngine({
    priorityEngine: createPriorityEngine({ now: () => AT }),
    deduplicationService: createDeduplicationService(repository),
    repository,
    now: () => AT,
    hardRulesRegistry: { isProtectedCalendarTime: () => false },
  });
}

function signal(engine, id = "shared") {
  return engine.adapters.local([{
    id,
    title: `Action ${id}`,
    action: "Traiter l'action",
    importance: 1,
    impact: 1,
    urgency: 1,
    confidence: 1,
  }], { now: AT, local: true })[0];
}

function reviewEngine(repository) {
  const records = [];
  return createReviewLearningEngine({
    repository: {
      save(review) { records.push(review); return { review, idempotent: false }; },
      list: () => records,
    },
    trackingProvider: () => [],
    recommendationProvider: ({ start, end, subjectScope }) => repository.listRecommendations({
      start: start.toISOString(), end: end.toISOString(), subjectScope, limit: 5,
    }),
    feedbackProvider: ({ start, end, subjectScope }) => repository.listFeedbackEvents({
      start: start.toISOString(), end: end.toISOString(), subjectScope, limit: 5,
    }),
    now: () => AT,
  });
}

test("les recommandations et feedbacks de profils distincts restent séparés avant la limite des reviews", async () => {
  const ctx = fixture();
  try {
    const engine = proactive(ctx.repository);
    const shared = signal(engine);
    const arnaud = (await engine.evaluate([shared], { at: AT, subjectScope: "arnaud" })).recommendations[0];
    const alexandra = (await engine.evaluate([shared], { at: AT, subjectScope: "alexandra" })).recommendations[0];
    const unscoped = (await engine.evaluate([signal(engine, "unscoped")], { at: AT })).recommendations[0];

    assert.notEqual(arnaud.hash, alexandra.hash);
    assert.equal(ctx.repository.getRecommendationByHash(unscoped.hash).subjectScope, null);
    assert.equal(ctx.repository.listRecommendations({ subjectScope: "arnaud", limit: 5 }).length, 1);
    assert.equal(ctx.repository.listRecommendations({ subjectScope: "alexandra", limit: 5 }).length, 1);

    engine.feedback(arnaud.hash, "useful", { at: AT });
    engine.feedback(alexandra.hash, "not_useful", { at: AT });
    assert.deepEqual(ctx.repository.listFeedbackEvents({ subjectScope: "arnaud", limit: 5 })
      .map((item) => item.value), ["useful"]);
    assert.deepEqual(ctx.repository.listFeedbackEvents({ subjectScope: "alexandra", limit: 5 })
      .map((item) => item.value), ["not_useful"]);

    const reviews = reviewEngine(ctx.repository);
    const arnaudReview = reviews.generateDaily({ date: "2026-10-01", subjectScope: "arnaud" });
    const alexandraReview = reviews.generateDaily({ date: "2026-10-01", subjectScope: "alexandra" });
    assert.equal(arnaudReview.recommendationQuality.accepted, 1);
    assert.equal(arnaudReview.recommendationQuality.rejected, 0);
    assert.equal(alexandraReview.recommendationQuality.accepted, 0);
    assert.equal(alexandraReview.recommendationQuality.rejected, 1);

    for (let index = 0; index < 6; index += 1) {
      ctx.repository.saveRecommendation({
        hash: `alexandra-high-${index}`, score: 100 - index, priorityLevel: "high", status: "ready",
        subjectScope: "alexandra", payload: {}, firstDetectedAt: AT.toISOString(),
      });
    }
    assert.equal(ctx.repository.listRecommendations({ subjectScope: "arnaud", limit: 1 })[0].hash, arnaud.hash);
  } finally {
    ctx.close();
  }
});

test("les lignes historiques sans portée sont exclues d'une review ciblée et la migration reste idempotente", { skip: !sqlite?.DatabaseSync }, () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noon-review-learning-legacy-"));
  const filePath = path.join(directory, "legacy.sqlite");
  const legacy = new sqlite.DatabaseSync(filePath);
  try {
    legacy.exec(`
      CREATE TABLE recommendations (
        id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, inbox_item_id TEXT,
        score REAL NOT NULL, priority_level TEXT NOT NULL, payload_json TEXT NOT NULL,
        first_detected_at TEXT NOT NULL, last_presented_at TEXT, presentation_count INTEGER NOT NULL DEFAULT 0,
        user_response TEXT, cooldown_until TEXT, reactivation_key TEXT, expires_at TEXT, status TEXT NOT NULL
      );
      CREATE TABLE feedback_events (
        id TEXT PRIMARY KEY, recommendation_hash TEXT, value TEXT NOT NULL,
        category TEXT, created_at TEXT NOT NULL, metadata_json TEXT NOT NULL DEFAULT '{}'
      );
    `);
    legacy.prepare("INSERT INTO recommendations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
      "legacy-recommendation", "legacy-hash", null, 99, "high", "{}", AT.toISOString(), null, 0,
      null, null, null, null, "ready",
    );
    legacy.prepare("INSERT INTO feedback_events VALUES(?,?,?,?,?,?)").run(
      "legacy-feedback", "legacy-hash", "useful", null, AT.toISOString(), "{}",
    );
  } finally {
    legacy.close();
  }

  let database = createPersonalDatabase(filePath);
  try {
    const repository = createPersonalIntelligenceRepository(database);
    assert.equal(database.database.prepare("SELECT subject_scope FROM recommendations WHERE hash='legacy-hash'").get().subject_scope, null);
    assert.equal(database.database.prepare("SELECT subject_scope FROM feedback_events WHERE id='legacy-feedback'").get().subject_scope, null);
    assert.equal(repository.listRecommendations({ subjectScope: "arnaud", limit: 5 }).length, 0);
    assert.equal(repository.listFeedbackEvents({ subjectScope: "arnaud", limit: 5 }).length, 0);
    assert.equal(repository.listRecommendations({ limit: 5 }).length, 1);
  } finally {
    database.close();
  }
  database = createPersonalDatabase(filePath);
  try {
    assert.equal(database.database.prepare("PRAGMA table_info(recommendations)").all().some((column) => column.name === "subject_scope"), true);
    assert.equal(database.database.prepare("PRAGMA table_info(feedback_events)").all().some((column) => column.name === "subject_scope"), true);
  } finally {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("les callbacks serveur de review transmettent le scope aux requêtes bornées", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const wiring = source.slice(source.indexOf("const reviewLearningEngine"), source.indexOf("const personalMigration"));
  assert.match(wiring, /recommendationProvider: \(\{ start, end, subjectScope \}\) => personalRepository\.listRecommendations\(\{\s*start: start\.toISOString\(\), end: end\.toISOString\(\), subjectScope, limit: 500,/);
  assert.match(wiring, /feedbackProvider: \(\{ start, end, subjectScope \}\) => personalRepository\.listFeedbackEvents\(\{\s*start: start\.toISOString\(\), end: end\.toISOString\(\), subjectScope, limit: 500,/);
});
