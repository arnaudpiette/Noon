#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { selectModelRoute } = require("../lib/noon-intelligence");
const { createVoiceIdentity } = require("../services/voice/voice-identity");
const { compareWithBaseline, createBaseline, createNoonEvaluationEngine } = require("../services/evaluation/noon-evaluation-engine");
const { CORE_SCENARIOS } = require("../test/evals/scenarios/core-scenarios");
const { createConfigRegistry } = require("../services/config/config-registry");
const { createRuntimeConfigService } = require("../services/config/runtime-config-service");
const { createFeatureFlagRegistry } = require("../services/config/feature-flag-registry");
const { createFeatureFlagService } = require("../services/config/feature-flag-service");

const projectRoot = path.resolve(__dirname, "..");
const baselinePath = path.join(projectRoot, "test", "evals", "baseline", "noon-baseline.json");
const reportPath = path.join(projectRoot, ".noon-evals", "latest.json");
const args = process.argv.slice(2);
const valuesFor = (flag) => args.filter((item) => item.startsWith(`${flag}=`)).flatMap((item) => item.slice(flag.length + 1).split(",")).filter(Boolean);
const filters = { ids: valuesFor("--id"), categories: valuesFor("--category"), tags: valuesFor("--tag") };
const updateBaseline = args.includes("--update-baseline");
const accepted = args.includes("--accept-baseline");

const adapters = {
  contract: async (input) => structuredClone(input.actual),
  routing: async (input) => selectModelRoute(input),
  voice: async () => ({ voice: createVoiceIdentity().resolve({ pipeline: "tts" }).voice, identityStable: true }),
};

function gitSha() {
  try { return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: projectRoot, encoding: "utf8" }).trim(); }
  catch { return null; }
}

function printSummary(report, comparison) {
  console.log(`Noon Evaluation Engine · ${report.scenarioCount} scénario(s)`);
  console.log(`PASS ${report.counts.PASS} · WARNING ${report.counts.WARNING} · FAIL ${report.counts.FAIL} · ERROR ${report.counts.ERROR} · SKIPPED ${report.counts.SKIPPED}`);
  console.log(`Gate: ${comparison.releaseGate} · ${report.duration.totalMs} ms · baseline ${comparison.baselineId || "absente"}`);
  if (comparison.regressions.length) console.log(`Régressions: ${comparison.regressions.map((item) => item.scenarioId).join(", ")}`);
}

(async () => {
  if (updateBaseline && !accepted) throw new Error("La mise à jour exige --update-baseline --accept-baseline.");
  const report = await createNoonEvaluationEngine({ adapters }).run(CORE_SCENARIOS, filters);
  const evaluationConfig = createRuntimeConfigService({ registry: createConfigRegistry() });
  const evaluationFlags = createFeatureFlagService({ registry: createFeatureFlagRegistry(), runtimeConfig: evaluationConfig });
  report.configSnapshot = evaluationConfig.snapshot({ test: true });
  report.featureFlagSnapshot = evaluationFlags.snapshot({});
  const baseline = fs.existsSync(baselinePath) ? JSON.parse(fs.readFileSync(baselinePath, "utf8")) : null;
  const comparison = compareWithBaseline(report, baseline, CORE_SCENARIOS);
  const machineReport = { ...report, comparison };
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(machineReport, null, 2)}\n`);
  if (updateBaseline) {
    fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
    const next = createBaseline(report, { baselineId: `baseline-${new Date().toISOString().slice(0, 10)}`, gitSha: gitSha() });
    fs.writeFileSync(baselinePath, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`Baseline mise à jour explicitement : ${baselinePath}`);
  }
  printSummary(report, comparison);
  process.exitCode = comparison.releaseGate === "BLOCKED" ? 1 : 0;
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
