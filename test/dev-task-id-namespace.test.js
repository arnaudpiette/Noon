"use strict";
const { readServerSource } = require("./helpers/server-source");

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  RESERVED_GOAL_MODE_DEV_TASK_PREFIX,
  assertDevTaskIdNotReserved,
  isReservedGoalModeDevTaskId,
} = require("../services/dev/dev-task-id-namespace");
const {
  deterministicGoalModeDevTaskId,
} = require("../services/goals/goal-mode-dev-projection-service");

const ROOT = path.join(__dirname, "..");

test("espace réservé : les taskId Goal Mode réels sont réservés", () => {
  const taskId = deterministicGoalModeDevTaskId("run-1", "step-1", `sha256:${"a".repeat(64)}`);
  assert.equal(taskId.startsWith(RESERVED_GOAL_MODE_DEV_TASK_PREFIX), true);
  assert.equal(isReservedGoalModeDevTaskId(taskId), true);
  assert.throws(() => assertDevTaskIdNotReserved(taskId), {
    code: "DEV_TASK_ID_RESERVED", statusCode: 400,
  });
});

test("espace réservé : variantes de casse, espaces, NFKC, invisibles et tirets refusées", () => {
  for (const value of [
    "goal-mode-dev-x",
    "  goal-mode-dev-x\n",
    "GOAL-MODE-DEV-X",
    "Goal-Mode-Dev-x",
    "ｇｏａｌ－ｍｏｄｅ－ｄｅｖ－x", // pleine chasse (NFKC)
    "goal‐mode‐dev‐x", // trait d'union Unicode
    "goal‑mode‑dev‑x", // trait d'union insécable
    "goal–mode—dev−x", // tirets demi/cadratin, signe moins
    "goal﹣mode－dev-x",
    "goal-mode-dev​-x", // espace sans chasse
    "go­al-mode-dev-x", // trait d'union conditionnel
    "﻿goal-mode-dev-x", // BOM
    "goal-mode-dev -x", // espace insécable
    "ⓖoal-mode-dev-x", // lettre cerclée (NFKC → g)
  ]) {
    assert.equal(isReservedGoalModeDevTaskId(value), true, JSON.stringify(value));
    assert.throws(() => assertDevTaskIdNotReserved(value), { code: "DEV_TASK_ID_RESERVED" },
      JSON.stringify(value));
  }
});

test("espace réservé : identifiants ordinaires acceptés", () => {
  for (const value of [
    undefined, null, "", "task-1", "dev-ui-123e4567", "goal_dev_task_abc",
    "goal-mode-dev", "goal-mode-devx", "goal_mode_dev_x", "my-goal-mode-dev-x",
    "goal-mode-development", 42,
  ]) {
    assert.equal(isReservedGoalModeDevTaskId(value), false, JSON.stringify(value));
    assert.equal(assertDevTaskIdNotReserved(value), value);
  }
});

function sourceFiles(directory) {
  const output = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (["node_modules", ".git", "dist", "out", "build"].includes(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...sourceFiles(absolute));
    else if (entry.name.endsWith(".js")) output.push(absolute);
  }
  return output;
}

test("inventaire : tout appel runTask de production est audité", () => {
  // Tout nouvel appelant doit être ajouté ici après vérification qu'il
  // applique la règle d'espace réservé (ou qu'il n'est pas une entrée).
  const audited = new Map([
    ["services/dev/dev-http-routes.js", "POST /api/dev/native/tasks : assertDevTaskIdNotReserved(body.taskId)"],
    ["services/goals/goal-dev-execution-service.js", "dev-run + Retry approuvé : assertDevTaskIdNotReserved"],
    ["services/dev/native-dev-ui-execution-service.js", "UI : taskId serveur + refus réservé"],
    ["services/dev/benchmark/native-noon-benchmark-participant.js", "benchmark : refus réservé"],
    ["services/dev/native-dev-orchestrator-facade.js", "interne : façade → orchestrateur"],
    ["services/goals/goal-mode-dev-dispatch-service.js", "Goal Mode : réservation + CAS (non câblé)"],
    ["services/goals/goal-mode-dev-runtime.js", "Goal Mode B1 : adaptateur joignable seulement par le dispatch (réservation, approbation exacte, CAS)"],
  ]);
  const found = new Set();
  const files = [
    path.join(ROOT, "server.js"),
    ...["services", "lib", "electron", "public", "scripts"]
      .map((item) => path.join(ROOT, item))
      .filter((item) => fs.existsSync(item))
      .flatMap(sourceFiles),
  ];
  for (const file of files) {
    if (/\.\s*runTask\s*\(/.test(fs.readFileSync(file, "utf8"))) {
      found.add(path.relative(ROOT, file).split(path.sep).join("/"));
    }
  }
  assert.deepEqual([...found].sort(), [...audited.keys()].sort());
});

test("câblage : la route Native DEV refuse l'espace réservé avant runTask", () => {
  const source = readServerSource();
  const start = source.indexOf('requestPath === "/api/dev/native/tasks" && req.method === "POST"');
  assert.notEqual(start, -1);
  const block = source.slice(start, source.indexOf("nativeDevB3Facade.runTask(", start));
  assert.match(block, /assertDevTaskIdNotReserved\(body\.taskId\)/);
  // Importé par server.js ou, depuis la tranche 21 de V3-L7, par la composition des routes.
  assert.match(source, /require\("(\.\/services|\.\.)\/dev\/dev-task-id-namespace"\)/);
});

test("4C-1D inventaire : tout appel cancelTask / getTaskStatus / projectDecisionEvidence est audité", () => {
  const audited = new Map([
    ["services/dev/dev-http-routes.js", "GET /api/dev/native/tasks/:id et /cancel : refus de l'espace réservé"],
    ["services/dev/native-dev-ui-execution-service.js", "UI get/cancel : refus de l'espace réservé"],
    ["services/decision/dev-decision-consumer.js", "preuves de décision : refus de l'espace réservé"],
    ["services/dev/benchmark/native-noon-benchmark-participant.js", "benchmark Native : refus de l'espace réservé"],
    ["services/dev/native-dev-orchestrator-facade.js", "interne : façade → orchestrateur"],
    ["services/goals/goal-mode-dev-dispatch-service.js", "Goal Mode : cancelExecution / executionStatus"],
    ["services/goals/goal-mode-dev-runtime.js", "Goal Mode B1 : adaptateur du dispatch (taskId issus de la réservation)"],
    ["services/delegation/dev-delegation-runner.js", "hors Native DEV : délégation Codex"],
    ["services/delegation/claude-code-specialist-agent.js", "hors Native DEV : sélecteur d'exécutant (V3-L5b), relaie l'annulation à l'exécutant de la mission"],
    ["services/dev/benchmark/codex-benchmark-participant.js", "hors Native DEV : benchmark Codex"],
  ]);
  const found = new Set();
  const files = [
    path.join(ROOT, "server.js"),
    ...["services", "lib", "electron", "public", "scripts"]
      .map((item) => path.join(ROOT, item))
      .filter((item) => fs.existsSync(item))
      .flatMap(sourceFiles),
  ];
  for (const file of files) {
    if (/\.\s*(cancelTask|getTaskStatus|projectDecisionEvidence)\s*\(/.test(fs.readFileSync(file, "utf8"))) {
      found.add(path.relative(ROOT, file).split(path.sep).join("/"));
    }
  }
  assert.deepEqual([...found].sort(), [...audited.keys()].sort());
});

test("4C-1D câblage : statut, arrêt et budget refusent l'espace réservé avant tout accès", () => {
  const source = readServerSource();
  const block = (marker, until) => {
    const start = source.indexOf(marker);
    assert.notEqual(start, -1, marker);
    const end = source.indexOf(until, start);
    assert.notEqual(end, -1, until);
    return source.slice(start, end);
  };
  assert.match(block('requestPath.startsWith("/api/dev/native/tasks/") && req.method === "GET"',
    "nativeDevB3Facade.getTaskStatus("), /isReservedGoalModeDevTaskId\(taskId\)\) return sendReservedDevTaskId/);
  assert.match(block('requestPath.endsWith("/cancel") && req.method === "POST"',
    "nativeDevB3Facade.cancelTask("), /isReservedGoalModeDevTaskId\(taskId\)\) return sendReservedDevTaskId/);
  assert.match(block('requestPath === "/api/dev/budget" && req.method === "GET"',
    "devCostBudgetService.snapshot("), /isReservedGoalModeDevTaskId\(taskId\)\) return sendReservedDevTaskId/);
  assert.match(source, /function sendReservedDevTaskId\(res\)[\s\S]{0,200}DEV_TASK_ID_RESERVED/);
});
