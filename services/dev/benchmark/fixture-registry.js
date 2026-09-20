"use strict";
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const BENCHMARK_FIXTURE_IDS = Object.freeze([
  "normalize-email",
  "slugify-title",
  "backend-user-update",
  "multifile-state-flow",
]);
const PACKAGED_FIXTURE_DIRECTORY = "dev-benchmark-fixtures";

function isPackagedModule() {
  return __dirname.split(path.sep).includes("app.asar");
}

function resolveBenchmarkFixtureRoot() {
  if (isPackagedModule()) {
    return path.join(process.resourcesPath, PACKAGED_FIXTURE_DIRECTORY);
  }
  return path.join(__dirname, "..", "..", "..", "resources", PACKAGED_FIXTURE_DIRECTORY);
}

function fixtureFiles(root) {
  const files = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw Object.assign(new Error("Lien symbolique interdit dans les fixtures benchmark."), { code: "BENCHMARK_FIXTURE_INVALID" });
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  }
  visit(root);
  return files;
}

function benchmarkFixtureTreeHash(root = resolveBenchmarkFixtureRoot()) {
  const canonicalRoot = fs.realpathSync(root);
  const hash = crypto.createHash("sha256");
  for (const file of fixtureFiles(canonicalRoot)) {
    hash.update(path.relative(canonicalRoot, file).split(path.sep).join("/"));
    hash.update("\0");
    hash.update(fs.readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function createBenchmarkFixtureRegistry() {
  const root = resolveBenchmarkFixtureRoot();
  const entries = BENCHMARK_FIXTURE_IDS.map((taskId) => {
    const fixture = path.join(root, taskId);
    try {
      if (!fs.statSync(fixture).isDirectory()) throw new Error("not a directory");
    } catch (cause) {
      throw Object.assign(new Error(`Fixture benchmark indisponible: ${taskId}`), {
        code: "BENCHMARK_FIXTURE_INVALID",
        taskId,
        cause,
      });
    }
    return [taskId, fixture];
  });
  return Object.freeze(Object.fromEntries(entries));
}
module.exports = {
  BENCHMARK_FIXTURE_IDS,
  PACKAGED_FIXTURE_DIRECTORY,
  benchmarkFixtureTreeHash,
  createBenchmarkFixtureRegistry,
  resolveBenchmarkFixtureRoot,
};
