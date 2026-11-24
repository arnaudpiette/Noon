"use strict";

// Shared setup for test/native-dev-core*.test.js (moved verbatim from test/native-dev-core.test.js, V3-L7).

const fs = require("node:fs");

const os = require("node:os");

const path = require("node:path");

const { execFileSync } = require("node:child_process");

const { createTransactionalExecutionEngine } = require("../../services/execution/transactional-execution-engine");

const { createSkillRegistry } = require("../../skills/registry");

const { createDevTaskJournal } = require("../../services/dev/dev-task-journal");

const { createNativeDevCoordinator } = require("../../services/dev/native-dev-coordinator");

const { isBlockingValidationFailure, normalizeReasoning } = require("../../services/dev/native-dev-coordinator");

const { createNativeDevReasoner, createNativeDevStructuredExecutor } = require("../../services/dev/native-dev-reasoner");

const { createDevCostBudgetService } = require("../../services/dev/dev-cost-budget-service");

const { applyOperation, digest, readText, runSafeCommand } = require("../../services/dev/native-repository-tools");

const { createDevTaskContract } = require("../../services/delegation/dev-task-contract");

const { createOperationalSecurityPolicy } = require("../../services/security/operational-security-policy");

function memoryRepository() {
  const executions = new Map(); const steps = new Map();
  return {
    saveExecution(value) { executions.set(value.execution_id, structuredClone(value)); }, saveStep(value) { steps.set(`${value.execution_id}:${value.step_id}`, structuredClone(value)); },
    getExecution(id) { return structuredClone(executions.get(id) || null); }, getSteps(id) { return [...steps.values()].filter((item) => item.execution_id === id).map((item) => structuredClone(item)); },
    findStepByIdempotencyKey(key) { return [...steps.values()].find((item) => item.idempotency_key === key) || null; }, listRecoverable() { return []; }, transaction(callback) { return callback(); },
  };
}

function repository(files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noon-native-dev-"));
  execFileSync("git", ["init", "-q"], { cwd: root }); execFileSync("git", ["config", "user.email", "fixture@example.test"], { cwd: root }); execFileSync("git", ["config", "user.name", "Fixture"], { cwd: root });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
  for (const [name, content] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); fs.writeFileSync(path.join(root, name), content); }
  execFileSync("git", ["add", "."], { cwd: root }); execFileSync("git", ["commit", "-qm", "fixture"], { cwd: root }); return root;
}

function fixture({ root, reason, validations = () => "PASS", mode = "LIMITED", maxIterations = 3, allowedPaths, securityPolicy = null, now = () => Date.now() } = {}) {
  const skillRegistry = createSkillRegistry();
  const transactionalExecutionEngine = createTransactionalExecutionEngine({ repository: memoryRepository(), skillRegistry });
  const journalDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "noon-dev-journal-"));
  const journal = createDevTaskJournal({ directory: journalDirectory });
  const calls = [];
  const coordinator = createNativeDevCoordinator({
    workspaceEngine: { context: () => ({ roots: [{ path: root, mode: "read-write" }] }) }, transactionalExecutionEngine,
    operationalSecurityPolicy: securityPolicy || { evaluate: () => ({ outcome: "ALLOW", policyVersion: "test" }) }, skillRegistry,
    reasoner: { async reason(input) { calls.push(input); return reason(input); } }, journal, featureMode: (input) => typeof mode === "function" ? mode(input) : mode,
    validationRunner: async (command) => { const status = validations(command, calls); return { command, status, exitCode: status === "PASS" ? 0 : 1, durationMs: 1, outputTail: status === "PASS" ? "" : "assertion failed", failureCategory: status === "PASS" ? null : "TEST_FAILURE" }; },
    now,
  });
  const run = (extra = {}) => coordinator.runTask({ workspaceId: "workspace-fixture", repositoryRoot: root, objective: "Corriger normalizeEmail", validationCommands: ["npm test"], maxIterations, allowedPaths, ...extra });
  return { coordinator, journal, journalDirectory, calls, run };
}

module.exports = {
  applyOperation,
  createDevCostBudgetService,
  createDevTaskContract,
  createDevTaskJournal,
  createNativeDevCoordinator,
  createNativeDevReasoner,
  createNativeDevStructuredExecutor,
  createOperationalSecurityPolicy,
  createSkillRegistry,
  createTransactionalExecutionEngine,
  digest,
  fixture,
  isBlockingValidationFailure,
  memoryRepository,
  normalizeReasoning,
  readText,
  repository,
  runSafeCommand,
};
