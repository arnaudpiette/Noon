"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { copySnapshot } = require("../services/dev/dev-benchmark-service");
const {
  BENCHMARK_FIXTURE_IDS,
  benchmarkFixtureTreeHash,
  createBenchmarkFixtureRegistry,
  resolveBenchmarkFixtureRoot,
} = require("../services/dev/benchmark/fixture-registry");

const EXPECTED_FILES = Object.freeze({
  "normalize-email": ["package.json", "src/email.js", "test/email.test.js"],
  "slugify-title": ["package.json", "src/slug.js", "test/slug.test.js"],
  "backend-user-update": ["package.json", "src/controller.js", "src/service.js", "test/users.test.js"],
  "multifile-state-flow": ["package.json", "src/controller.js", "src/service.js", "src/store.js", "test/state.test.js"],
});

test("le resolver de développement pointe vers la source canonique de production", () => {
  const root = fs.realpathSync(resolveBenchmarkFixtureRoot());
  assert.equal(root, fs.realpathSync(path.join(__dirname, "..", "resources", "dev-benchmark-fixtures")));
});

test("le registre contient exactement les quatre fixtures v1", () => {
  assert.deepEqual(Object.keys(createBenchmarkFixtureRegistry()), [...BENCHMARK_FIXTURE_IDS]);
  assert.equal(BENCHMARK_FIXTURE_IDS.length, 4);
});

test("chaque fixture contient tous ses fichiers requis", () => {
  const registry = createBenchmarkFixtureRegistry();
  for (const [taskId, relativeFiles] of Object.entries(EXPECTED_FILES)) {
    for (const relative of relativeFiles) assert.ok(fs.statSync(path.join(registry[taskId], relative)).isFile(), `${taskId}/${relative}`);
  }
});

test("le hash déterministe valide tout l’arbre canonique", () => {
  const first = benchmarkFixtureTreeHash();
  const second = benchmarkFixtureTreeHash();
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, second);
});

test("un appelant ne peut pas substituer une racine arbitraire", () => {
  const arbitrary = fs.mkdtempSync(path.join(os.tmpdir(), "noon-fixture-root-"));
  const registry = createBenchmarkFixtureRegistry({ root: arbitrary });
  assert.notEqual(fs.realpathSync(registry["normalize-email"]), fs.realpathSync(arbitrary));
  fs.rmSync(arbitrary, { recursive: true, force: true });
});

test("la source canonique reste hors des workspaces participants", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "noon-fixture-workspace-"));
  const source = fs.realpathSync(resolveBenchmarkFixtureRoot());
  const isolated = fs.realpathSync(workspace);
  assert.notEqual(source, isolated);
  assert.equal(source.startsWith(`${isolated}${path.sep}`), false);
  fs.rmSync(workspace, { recursive: true, force: true });
});

test("la création d’un snapshot ne modifie pas la fixture source", () => {
  const fixture = createBenchmarkFixtureRegistry()["normalize-email"];
  const before = benchmarkFixtureTreeHash();
  const snapshot = copySnapshot(fixture, "noon-fixture-snapshot-");
  fs.appendFileSync(path.join(snapshot, "src", "email.js"), "\n// snapshot only\n");
  assert.equal(benchmarkFixtureTreeHash(), before);
  assert.notEqual(fs.readFileSync(path.join(snapshot, "src", "email.js"), "utf8"), fs.readFileSync(path.join(fixture, "src", "email.js"), "utf8"));
  fs.rmSync(snapshot, { recursive: true, force: true });
});
