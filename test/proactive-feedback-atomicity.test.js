"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createPersonalDatabase } = require("../services/persistence/database");
const {
  createPersonalIntelligenceRepository,
} = require("../services/persistence/repositories/personal-intelligence-repository");
const { createMetricsService } = require("../services/personal-intelligence/metrics-service");
const { createPriorityEngine } = require("../services/personal-intelligence/priority-engine");
const { createDeduplicationService } = require("../services/personal-intelligence/deduplication-service");
const { createProactiveEngine } = require("../services/proactive/proactive-engine");

const AT = new Date("2026-10-01T18:00:00.000Z");

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noon-proactive-feedback-atomic-"));
  const database = createPersonalDatabase(path.join(directory, "personal.sqlite"));

  return {
    directory,
    database,
    close() {
      database.close();
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

function faultingDatabase(database, failure) {
  return new Proxy(database, {
    get(target, property) {
      const value = Reflect.get(target, property, target);

      if (property === "exec") return target.exec.bind(target);

      if (property === "prepare") {
        return (sql) => {
          const metricInsert = /^INSERT INTO metrics_events/.test(sql);

          if (failure === "metric" && metricInsert) {
            return {
              run() {
                throw Object.assign(
                  new Error("échec métrique simulé"),
                  { code: "TEST_METRIC_FAILURE" },
                );
              },
            };
          }

          return target.prepare(sql);
        };
      }

      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function createRepository(ctx, database = ctx.database.database) {
  return createPersonalIntelligenceRepository({
    kind: "sqlite",
    database,
  });
}

function createEngine(repository) {
  return createProactiveEngine({
    priorityEngine: createPriorityEngine({ now: () => AT }),
    deduplicationService: createDeduplicationService(repository),
    repository,
    metrics: createMetricsService(repository),
    now: () => AT,
    hardRulesRegistry: {
      isProtectedCalendarTime: () => false,
    },
  });
}

function seed(repository, hash) {
  return repository.saveRecommendation({
    id: `recommendation-${hash}`,
    hash,
    score: 70,
    priorityLevel: "high",
    payload: {
      signalType: "project_blocker",
      title: "Fixture atomique",
    },
    firstDetectedAt: AT.toISOString(),
    presentationCount: 0,
    status: "ready",
  });
}

function feedbackCount(repository, hash) {
  return repository.listFeedbackEvents({ limit: 1000 })
    .filter((item) => item.recommendationHash === hash)
    .length;
}

function metricTotal(repository, metric) {
  const row = repository.aggregateMetrics(new Date(0).toISOString())
    .find((item) => item.metric === metric);

  return Number(row?.total) || 0;
}

test("feedback proactif persiste recommandation, feedback et métrique ensemble", () => {
  const ctx = fixture();

  try {
    const repository = createRepository(ctx);
    const engine = createEngine(repository);
    const hash = "atomic-success";

    seed(repository, hash);

    const result = engine.feedback(hash, "useful");

    assert.equal(result.status, "ready");
    assert.equal(repository.getRecommendationByHash(hash).userResponse, "useful");
    assert.equal(feedbackCount(repository, hash), 1);
    assert.equal(metricTotal(repository, "proactive_feedback_useful"), 1);
  } finally {
    ctx.close();
  }
});

test("échec métrique rollbacke recommandation et feedback puis laisse la connexion réutilisable", () => {
  const ctx = fixture();

  try {
    const goodRepository = createRepository(ctx);
    const hash = "atomic-metric-failure";

    seed(goodRepository, hash);

    const failingRepository = createRepository(
      ctx,
      faultingDatabase(ctx.database.database, "metric"),
    );
    const failingEngine = createEngine(failingRepository);

    assert.throws(
      () => failingEngine.feedback(hash, "useful"),
      { code: "TEST_METRIC_FAILURE" },
    );

    assert.equal(goodRepository.getRecommendationByHash(hash).userResponse, null);
    assert.equal(feedbackCount(goodRepository, hash), 0);
    assert.equal(metricTotal(goodRepository, "proactive_feedback_useful"), 0);

    const goodEngine = createEngine(goodRepository);
    goodEngine.feedback(hash, "useful");

    assert.equal(goodRepository.getRecommendationByHash(hash).userResponse, "useful");
    assert.equal(feedbackCount(goodRepository, hash), 1);
    assert.equal(metricTotal(goodRepository, "proactive_feedback_useful"), 1);
  } finally {
    ctx.close();
  }
});

test("feedback respecte commit et rollback d'une transaction appelante", () => {
  const ctx = fixture();

  try {
    const repository = createRepository(ctx);
    const engine = createEngine(repository);
    const db = ctx.database.database;

    const rollbackHash = "atomic-external-rollback";
    seed(repository, rollbackHash);

    db.exec("BEGIN IMMEDIATE");
    try {
      engine.feedback(rollbackHash, "useful");
      assert.equal(db.isTransaction, true);
      db.exec("ROLLBACK");
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      throw error;
    }

    assert.equal(repository.getRecommendationByHash(rollbackHash).userResponse, null);
    assert.equal(feedbackCount(repository, rollbackHash), 0);

    const commitHash = "atomic-external-commit";
    seed(repository, commitHash);

    db.exec("BEGIN IMMEDIATE");
    try {
      engine.feedback(commitHash, "useful");
      assert.equal(db.isTransaction, true);
      db.exec("COMMIT");
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      throw error;
    }

    assert.equal(repository.getRecommendationByHash(commitHash).userResponse, "useful");
    assert.equal(feedbackCount(repository, commitHash), 1);
  } finally {
    ctx.close();
  }
});

test("échec interne sous transaction externe rollbacke seulement le feedback et conserve la transaction appelante", () => {
  const ctx = fixture();

  try {
    const goodRepository = createRepository(ctx);
    const db = ctx.database.database;
    const hash = "atomic-external-failure";

    seed(goodRepository, hash);

    const failingRepository = createRepository(
      ctx,
      faultingDatabase(db, "metric"),
    );
    const failingEngine = createEngine(failingRepository);

    db.exec("BEGIN IMMEDIATE");

    try {
      assert.throws(
        () => failingEngine.feedback(hash, "useful"),
        { code: "TEST_METRIC_FAILURE" },
      );

      assert.equal(db.isTransaction, true);

      db.prepare(
        "UPDATE recommendations SET status=status WHERE hash=?",
      ).run(hash);

      db.exec("COMMIT");
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      throw error;
    }

    assert.equal(goodRepository.getRecommendationByHash(hash).userResponse, null);
    assert.equal(feedbackCount(goodRepository, hash), 0);
    assert.equal(metricTotal(goodRepository, "proactive_feedback_useful"), 0);
  } finally {
    ctx.close();
  }
});
