"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");

const {
  createDevTaskContract,
} = require("../services/delegation/dev-task-contract");
const {
  repositoryPreflight,
} = require("../services/delegation/repository-preflight");
const {
  createNativeDevImplementationEngine,
} = require("../services/dev/native-dev-implementation-engine");
const {
  createNativeDevOrchestrator,
} = require("../services/dev/native-dev-orchestrator");
const {
  createNativeReviewValidationAgent,
} = require("../services/dev/agents/native-review-validation-agent");
const {
  adaptNativeDevResult,
} = require("../services/dev/native-dev-result-adapter");
const {
  createSkillRegistry,
} = require("../skills/registry");

function repository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noon-implementation-snapshot-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "fixture@example.test"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Fixture"], { cwd: root });
  fs.writeFileSync(path.join(root, "a.js"), "module.exports = 1;\n");
  execFileSync("git", ["add", "a.js"], { cwd: root });
  execFileSync("git", ["commit", "-qm", "fixture"], { cwd: root });
  return root;
}

function fixture(runValidation) {
  const root = repository();
  const contract = createDevTaskContract({
    taskId: "task-snapshot-fixture",
    sessionId: "session-snapshot-fixture",
    workspaceAuthorized: true,
    workspaceId: "workspace-snapshot-fixture",
    workspaceRoots: [root],
    repositoryRoot: root,
    objective: "Validation simulée",
  });
  const preflight = repositoryPreflight(contract);
  const calls = [];
  const recorded = [];
  const engine = createNativeDevImplementationEngine({
    transactionalExecutionEngine: {
      async execute({ steps, executeStep }) {
        return { status: "SUCCEEDED", result: await executeStep(steps[0]) };
      },
    },
    operationalSecurityPolicy: {
      evaluate: () => ({ outcome: "ALLOW", policyVersion: "fixture" }),
    },
    skillRegistry: {
      executeSkill: (_skillId, _args, context) => context.handlers.runValidation(),
    },
    reasoner: { reason: async () => ({}) },
    journal: {
      start() {},
      recordCommand: (_taskId, result) => recorded.push(result),
    },
    validationRunner: async (...args) => {
      calls.push(args);
      return runValidation(...args);
    },
  });

  async function validate({ ordinal = calls.length + 1, input = {}, signal = null } = {}) {
    const snapshots = [];
    const result = await engine.validate(
      contract,
      input.taskId === undefined ? contract.taskId : input.taskId,
      "node --test test/fixture.test.js",
      1,
      signal,
      {
        enabled: true,
        input: {
          taskId: input.taskId === undefined ? contract.taskId : input.taskId,
          workspaceId: input.workspaceId === undefined ? contract.workspaceId : input.workspaceId,
          sessionId: input.sessionId === undefined ? contract.sessionId : input.sessionId,
        },
        ordinal,
        record: (snapshot) => snapshots.push(snapshot),
      }
    );
    assert.equal(snapshots.length, 1);
    return { result, snapshot: snapshots[0] };
  }

  return { root, contract, preflight, calls, recorded, validate };
}

function validation(status, extra = {}) {
  return {
    command: "node --test test/fixture.test.js",
    status,
    exitCode: status === "PASS" ? 0 : 1,
    outputTail: "PRIVATE_OUTPUT",
    outputTruncated: false,
    cleanupConfirmed: true,
    ...extra,
  };
}

test("PASS et FAIL exécutés restent liés à leur propre état stable", async () => {
  let index = 0;
  const f = fixture(() => validation(index++ === 0 ? "PASS" : "FAIL"));
  const first = await f.validate();
  const second = await f.validate();

  assert.deepEqual(f.calls.map((call) => call[0]), [
    "node --test test/fixture.test.js",
    "node --test test/fixture.test.js",
  ]);
  assert.deepEqual(f.recorded.map((item) => item.status), ["PASS", "FAIL"]);
  assert.equal(first.snapshot.bindingState, "LINKED");
  assert.equal(second.snapshot.bindingState, "LINKED");
  assert.equal(first.snapshot.validationStatus, "PASS");
  assert.equal(second.snapshot.validationStatus, "FAIL");
  assert.equal(first.snapshot.snapshotCoverage, "GIT_VISIBLE_COMPLETE");
  assert.equal(first.snapshot.snapshotRef, second.snapshot.snapshotRef);
  assert.notEqual(first.snapshot.observationRef, second.snapshot.observationRef);
  assert.equal(JSON.stringify(first.snapshot).includes("PRIVATE_"), false);
  assert.equal(JSON.stringify(first.snapshot).includes(f.root), false);
  assert.equal(JSON.stringify(first.snapshot).includes("node --test"), false);
});

test("une validation qui modifie le dépôt reste divergente", async () => {
  const f = fixture((_command, root) => {
    fs.writeFileSync(path.join(root, "a.js"), "module.exports = 2;\n");
    return validation("PASS");
  });
  const observed = await f.validate();

  assert.equal(observed.result.status, "PASS");
  assert.equal(observed.snapshot.validationStatus, "PASS");
  assert.equal(observed.snapshot.bindingState, "UNLINKED");
  assert.equal(observed.snapshot.reasonCode, "REPOSITORY_DIVERGED");
  assert.equal(f.calls.length, 1);
});

test("une lecture incomplète ou un snapshot absent ne produisent pas LINKED", async () => {
  const deleted = fixture((_command, root) => {
    fs.unlinkSync(path.join(root, "a.js"));
    return validation("PASS");
  });
  const missingFile = await deleted.validate();
  assert.equal(missingFile.snapshot.bindingState, "UNLINKED");
  assert.equal(missingFile.snapshot.reasonCode, "SNAPSHOT_INCOMPLETE");
  assert.equal(missingFile.snapshot.snapshotCoverage, "GIT_VISIBLE_PARTIAL");

  const unreadable = fixture((_command, root) => {
    fs.symlinkSync("missing-target", path.join(root, "broken-link"));
    return validation("PASS");
  });
  const brokenLink = await unreadable.validate();
  assert.equal(brokenLink.snapshot.bindingState, "UNLINKED");
  assert.equal(brokenLink.snapshot.reasonCode, "SNAPSHOT_INCOMPLETE");

  const unavailable = fixture((_command, root) => {
    fs.renameSync(path.join(root, ".git"), path.join(root, "hidden-git-metadata"));
    return validation("PASS");
  });
  const missingGit = await unavailable.validate();
  assert.equal(missingGit.snapshot.bindingState, "UNLINKED");
  assert.equal(missingGit.snapshot.reasonCode, "SNAPSHOT_UNAVAILABLE");
  assert.equal(missingGit.snapshot.snapshotCoverage, "UNAVAILABLE");
});

test("sortie absente, troncature, cleanup, timeout et annulation interdisent LINKED", async () => {
  const cases = [
    { result: undefined, reason: "VALIDATION_UNOBSERVED", status: "UNKNOWN" },
    { result: validation("PASS", { outputTruncated: true }), reason: "VALIDATION_INCOMPLETE", status: "PASS" },
    { result: validation("PASS", { cleanupConfirmed: false }), reason: "VALIDATION_INCOMPLETE", status: "PASS" },
    { result: validation("FAIL", { failureCategory: "TIMEOUT" }), reason: "VALIDATION_INTERRUPTED", status: "FAIL" },
    { result: validation("FAIL", { failureCategory: "CANCELLED" }), reason: "VALIDATION_INTERRUPTED", status: "FAIL" },
  ];

  for (const item of cases) {
    const f = fixture(() => item.result);
    const observed = await f.validate();
    assert.equal(observed.snapshot.bindingState, "UNLINKED");
    assert.equal(observed.snapshot.reasonCode, item.reason);
    assert.equal(observed.snapshot.validationStatus, item.status);
    assert.equal(f.calls.length, 1);
  }
});

test("une incohérence tâche, workspace ou session refuse la liaison", async () => {
  for (const input of [
    { taskId: "another-task" },
    { workspaceId: "another-workspace" },
    { sessionId: "another-session" },
  ]) {
    const f = fixture(() => validation("PASS"));
    const observed = await f.validate({ input });
    assert.equal(observed.snapshot.bindingState, "UNLINKED");
    assert.equal(observed.snapshot.reasonCode, "IDENTITY_MISMATCH");
    assert.equal(observed.snapshot.validationStatus, "PASS");
  }
});

test("la review distingue les observations historiques du snapshot terminal", async () => {
  const f = fixture(() => validation("PASS"));
  const first = await f.validate();
  fs.writeFileSync(path.join(f.root, "a.js"), "module.exports = 3;\n");
  const second = await f.validate();
  const implementation = {
    solved: true,
    touched: ["a.js"],
    iterations: [{
      iteration: 1,
      changedFiles: ["a.js"],
      validations: [first.result, second.result],
      validationSnapshots: [first.snapshot, second.snapshot],
    }],
    validations: [first.result, second.result],
  };
  let terminalCalls = 0;
  const reviewAgent = createNativeReviewValidationAgent({
    journal: { start() {}, transition() {}, finish() {} },
    implementationEngine: {
      async validate(_contract, _taskId, command) {
        terminalCalls += 1;
        assert.equal(command, "git diff --check");
        return validation("PASS", { command });
      },
    },
  });
  const review = await reviewAgent.reviewTask({
    taskId: f.contract.taskId,
    workspaceId: f.contract.workspaceId,
    sessionId: f.contract.sessionId,
    analysis: { contract: f.contract, preflight: f.preflight },
    implementation,
    baseline: [],
  });
  const adapted = adaptNativeDevResult({
    taskId: f.contract.taskId,
    finalVerdict: review.finalVerdict,
    analysis: { contract: f.contract, preflight: f.preflight },
    implementation,
    review,
  });

  assert.equal(terminalCalls, 1);
  assert.equal(f.calls.length, 2);
  assert.equal(review.finalVerdict, "PASS");
  assert.equal(review.validationSnapshot.bindingState, "LINKED");
  assert.equal(review.implementationValidationSnapshots.length, 2);
  assert.deepEqual(adapted.implementationValidationSnapshots.map((item) => item.terminalSnapshotMatch), [
    "DIFFERENT",
    "MATCH",
  ]);
  assert.deepEqual(adapted.implementationValidationSnapshots.map((item) => item.bindingState), [
    "LINKED",
    "LINKED",
  ]);
  assert.notEqual(first.snapshot.snapshotRef, second.snapshot.snapshotRef);
  const projected = JSON.stringify(adapted.implementationValidationSnapshots);
  for (const privateValue of [f.root, f.contract.taskId, f.contract.workspaceId, f.contract.sessionId, "PRIVATE_", "node --test", "a.js"]) {
    assert.equal(projected.includes(privateValue), false);
  }
});

test("l'adaptateur vérifie une copie canonique, refuse la forge et ne lie pas les anciens tests", async () => {
  const f = fixture(() => validation("PASS"));
  const observed = await f.validate();
  const base = {
    taskId: f.contract.taskId,
    finalVerdict: "PASS",
    analysis: { contract: f.contract, preflight: f.preflight },
    implementation: { iterations: [], providerCalls: [] },
  };
  const copied = structuredClone(observed.snapshot);
  const transferred = adaptNativeDevResult({
    ...base,
    review: {
      implementationValidationSnapshots: [copied],
    },
  });
  assert.equal(transferred.implementationValidationSnapshots.length, 1);
  assert.equal(transferred.implementationValidationSnapshots[0].bindingState, "LINKED");
  assert.equal(transferred.implementationValidationSnapshots[0].terminalSnapshotMatch, "UNKNOWN");

  const tamperedPayload = structuredClone(copied);
  tamperedPayload.validationStatus = "FAIL";

  const rejectedTamperedPayload = adaptNativeDevResult({
    ...base,
    review: {
      implementationValidationSnapshots: [tamperedPayload],
    },
  });

  assert.deepEqual(
    rejectedTamperedPayload.implementationValidationSnapshots,
    []
  );

  const tamperedTag = structuredClone(copied);
  tamperedTag.provenanceTag =
    `${tamperedTag.provenanceTag[0] === "0" ? "1" : "0"}${tamperedTag.provenanceTag.slice(1)}`;

  const rejectedTamperedTag = adaptNativeDevResult({
    ...base,
    review: {
      implementationValidationSnapshots: [tamperedTag],
    },
  });

  assert.deepEqual(
    rejectedTamperedTag.implementationValidationSnapshots,
    []
  );

  const forged = adaptNativeDevResult({
    ...base,
    review: {
      implementationValidationSnapshots: [{
        ...copied,
        validationStatus: "FAIL",
        output: "PRIVATE_OUTPUT",
      }],
    },
  });
  assert.deepEqual(forged.implementationValidationSnapshots, []);

  const oldResult = adaptNativeDevResult({
    ...base,
    implementation: {
      iterations: [{ iteration: 1, validations: [validation("PASS")] }],
      providerCalls: [],
    },
  });
  assert.deepEqual(oldResult.implementationValidationSnapshots, []);
});

test("la boucle Native DEV transmet une seule observation fonctionnelle par exécution", async () => {
  const root = repository();
  const calls = [];
  const skillRegistry = createSkillRegistry();
  const orchestrator = createNativeDevOrchestrator({
    workspaceEngine: {
      context: () => ({ roots: [{ path: root, mode: "read-write" }] }),
    },
    transactionalExecutionEngine: {
      async execute({ steps, executeStep }) {
        return { status: "SUCCEEDED", result: await executeStep(steps[0]) };
      },
    },
    operationalSecurityPolicy: {
      evaluate: () => ({ outcome: "ALLOW", policyVersion: "fixture" }),
    },
    skillRegistry,
    reasoner: {
      async reason({ phase, files }) {
        if (phase === "PLAN") {
          return { files: ["a.js"] };
        }
        return {
          operations: [{
            type: "MODIFY",
            path: "a.js",
            expectedHash: files[0].hash,
            search: "module.exports = 1;",
            replacement: "module.exports = 2;",
          }],
          validationCommands: ["node --test test/fixture.test.js"],
        };
      },
    },
    journal: {
      start() {},
      transition() {},
      finish() {},
      recordCommand(_taskId, result, iteration) {
        if (iteration === 1 && result.command === "node --test test/fixture.test.js") {
          fs.writeFileSync(path.join(root, "a.js"), "module.exports = 3;\n");
        }
      },
      recordRead() {},
      recordFileOperation() {},
    },
    validationRunner: async (command) => {
      calls.push(command);
      return validation("PASS", { command });
    },
  });
  const task = await orchestrator.runTask({
    taskId: "task-loop-fixture",
    sessionId: "session-loop-fixture",
    workspaceId: "workspace-loop-fixture",
    repositoryRoot: root,
    objective: "Modifier a.js",
    validationCommands: ["npm test"],
    maxIterations: 1,
  });
  const adapted = adaptNativeDevResult(task);

  assert.deepEqual(calls, [
    "npm test",
    "node --test test/fixture.test.js",
    "npm test",
    "git diff --check",
  ]);
  assert.equal(task.finalVerdict, "PASS");
  assert.equal(task.baseline[0].validationSnapshot, undefined);
  assert.deepEqual(task.implementation.iterations[0].validations.map((item) => item.status), ["PASS", "PASS"]);
  assert.equal(task.implementation.iterations[0].validationSnapshots.length, 2);
  assert.equal(task.review.implementationValidationSnapshots.length, 2);
  assert.equal(adapted.implementationValidationSnapshots[0].bindingState, "LINKED");
  assert.deepEqual(adapted.implementationValidationSnapshots.map((item) => item.terminalSnapshotMatch), [
    "DIFFERENT",
    "MATCH",
  ]);
  assert.equal(adapted.validationSnapshot.validationKind, "TERMINAL_REVIEW_VALIDATION");
  assert.equal(adapted.validationSnapshot.bindingState, "LINKED");
});
