"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");

const {
  createPersonalDatabase,
  SCHEMA_VERSION,
} = require("../services/persistence/database");

const {
  createModelPerformanceRepository,
  normalizeSample,
} = require("../services/persistence/repositories/model-performance-repository");

test("le schéma courant est enregistré à l'initialisation SQLite", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "noon-model-performance-schema-"));
  const wrapper = createPersonalDatabase(path.join(dir, "test.sqlite"));

  try {
    const migration = wrapper.database.prepare("SELECT version, name FROM schema_migrations WHERE name=?").get("personal-intelligence-base");
    assert.equal(migration.version, SCHEMA_VERSION);
    assert.equal(migration.name, "personal-intelligence-base");
  } finally {
    wrapper.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("normalise un sample sans contenu utilisateur", () => {
  const sample = normalizeSample({
    taskDomain: "DEV",
    requiredQuality: "HIGH",
    provider: "openai",
    model: "gpt-5.6-sol",
    success: true,
    latencyMs: 1234,
    inputTokens: 100,
    outputTokens: 50,
    actualCost: 0.02,
    firstPassSuccess: true,
  });

  assert.equal(sample.taskDomain, "DEV");
  assert.equal(sample.requiredQuality, "HIGH");
  assert.equal(sample.success, true);
  assert.equal(sample.firstPassSuccess, true);
  assert.equal(sample.fallbackUsed, false);
  assert.equal(sample.escalationUsed, false);
  assert.equal("prompt" in sample, false);
  assert.equal("content" in sample, false);
});

test("SQLite persiste et filtre les performances modèle", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "noon-model-performance-"));
  const wrapper = createPersonalDatabase(path.join(dir, "test.sqlite"));
  const repository = createModelPerformanceRepository(wrapper);

  repository.record({
    taskDomain: "GENERAL",
    requiredQuality: "LOW",
    provider: "openai",
    model: "gpt-5.6-luna",
    success: true,
    latencyMs: 500,
  });

  repository.record({
    taskDomain: "DEV",
    requiredQuality: "HIGH",
    provider: "openai",
    model: "gpt-5.6-sol",
    success: false,
    failureCategory: "QUALITY_FAILURE",
    latencyMs: 1200,
    fallbackUsed: true,
  });

  const results = repository.list({
    taskDomain: "DEV",
    model: "gpt-5.6-sol",
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].success, false);
  assert.equal(results[0].failureCategory, "QUALITY_FAILURE");
  assert.equal(results[0].fallbackUsed, true);

  wrapper.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("fallback JSON conserve les samples", () => {
  const state = {
    model_performance_samples: [],
  };

  const wrapper = {
    kind: "json-fallback",
    load: () => structuredClone(state),
    save(next) {
      Object.keys(state).forEach((key) => delete state[key]);
      Object.assign(state, structuredClone(next));
    },
  };

  const repository = createModelPerformanceRepository(wrapper);

  repository.record({
    taskDomain: "RESEARCH",
    provider: "google_ai",
    model: "gemini-3.8-flash",
    success: true,
    actualCost: 0.01,
  });

  const results = repository.list({ provider: "google_ai" });

  assert.equal(results.length, 1);
  assert.equal(results[0].model, "gemini-3.8-flash");
  assert.equal(results[0].actualCost, 0.01);
});
