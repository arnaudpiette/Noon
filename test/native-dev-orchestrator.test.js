"use strict";

const assert =
  require("node:assert/strict");
const fs =
  require("node:fs");
const os =
  require("node:os");
const path =
  require("node:path");
const {
  execFileSync,
} =
  require("node:child_process");
const test =
  require("node:test");

const {
  createTransactionalExecutionEngine,
} =
  require("../services/execution/transactional-execution-engine");

const {
  createSkillRegistry,
} =
  require("../skills/registry");

const {
  createDevTaskJournal,
} =
  require("../services/dev/dev-task-journal");

const {
  createNativeDevOrchestrator,
} =
  require("../services/dev/native-dev-orchestrator");

const {
  createNativeReviewValidationAgent,
} =
  require("../services/dev/agents/native-review-validation-agent");

const {
  createDevTaskContract,
} =
  require("../services/delegation/dev-task-contract");

const {
  repositoryPreflight,
} =
  require("../services/delegation/repository-preflight");

const {
  adaptNativeDevResult,
} =
  require("../services/dev/native-dev-result-adapter");

function memoryRepository() {
  const executions =
    new Map();
  const steps =
    new Map();

  return {
    saveExecution(value) {
      executions.set(
        value.execution_id,
        structuredClone(value)
      );
    },

    saveStep(value) {
      steps.set(
        `${value.execution_id}:${value.step_id}`,
        structuredClone(value)
      );
    },

    getExecution(id) {
      return structuredClone(
        executions.get(id) ||
          null
      );
    },

    getSteps(id) {
      return [
        ...steps.values(),
      ]
        .filter(
          (item) =>
            item.execution_id ===
            id
        )
        .map(
          (item) =>
            structuredClone(item)
        );
    },

    findStepByIdempotencyKey(
      key
    ) {
      return (
        [
          ...steps.values(),
        ].find(
          (item) =>
            item.idempotency_key ===
            key
        ) || null
      );
    },

    listRecoverable() {
      return [];
    },

    transaction(callback) {
      return callback();
    },
  };
}

function repository() {
  const root =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "noon-b3-native-orchestrator-"
      )
    );

  execFileSync(
    "git",
    ["init", "-q"],
    { cwd: root }
  );

  execFileSync(
    "git",
    [
      "config",
      "user.email",
      "fixture@example.test",
    ],
    { cwd: root }
  );

  execFileSync(
    "git",
    [
      "config",
      "user.name",
      "Fixture",
    ],
    { cwd: root }
  );

  fs.writeFileSync(
    path.join(
      root,
      "package.json"
    ),
    JSON.stringify({
      scripts: {
        test:
          "node --test test/email.test.js",
      },
    })
  );

  fs.mkdirSync(
    path.join(
      root,
      "lib"
    ),
    {
      recursive: true,
    }
  );

  fs.mkdirSync(
    path.join(
      root,
      "test"
    ),
    {
      recursive: true,
    }
  );

  fs.writeFileSync(
    path.join(
      root,
      "lib/email.js"
    ),
    [
      "function normalizeEmail(value) {",
      "  return value;",
      "}",
      "",
      "module.exports = { normalizeEmail };",
      "",
    ].join("\n")
  );

  fs.writeFileSync(
    path.join(
      root,
      "test/email.test.js"
    ),
    [
      '"use strict";',
      "",
      "const assert = require('node:assert/strict');",
      "const test = require('node:test');",
      "const { normalizeEmail } = require('../lib/email');",
      "",
      "test('normalize', () => {",
      "  assert.equal(",
      "    normalizeEmail(' User@Example.TEST '),",
      "    'user@example.test'",
      "  );",
      "});",
      "",
    ].join("\n")
  );

  execFileSync(
    "git",
    ["add", "."],
    { cwd: root }
  );

  execFileSync(
    "git",
    [
      "commit",
      "-qm",
      "fixture",
    ],
    { cwd: root }
  );

  return root;
}

async function reviewedFixture({
  mutateDuringValidation = null,
  validation = null,
  input = {},
} = {}) {
  const root = repository();
  const contract = createDevTaskContract({
    taskId: "task-terminal-snapshot",
    sessionId: "session-terminal-snapshot",
    workspaceAuthorized: true,
    workspaceId: "workspace-terminal-snapshot",
    workspaceRoots: [root],
    repositoryRoot: root,
    objective: "Fixture de review",
  });
  const preflight = repositoryPreflight(contract);
  const journal = createDevTaskJournal({
    directory: fs.mkdtempSync(path.join(os.tmpdir(), "noon-b3-review-journal-")),
  });
  const reviewAgent = createNativeReviewValidationAgent({
    journal,
    implementationEngine: {
      async validate(_contract, _taskId, command) {
        mutateDuringValidation?.(root, command);
        return validation?.(command) || {
          command,
          status: "PASS",
          exitCode: 0,
          outputTruncated: false,
          cleanupConfirmed: true,
        };
      },
    },
  });
  const baseline = await reviewAgent.baselineTask({
    analysis: { contract, preflight },
  });
  const review = await reviewAgent.reviewTask({
    taskId: contract.taskId,
    workspaceId: contract.workspaceId,
    sessionId: contract.sessionId,
    analysis: { contract, preflight },
    implementation: {
      solved: true,
      touched: [],
      iterations: [],
      validations: [],
    },
    baseline,
    ...input,
  });

  return { root, contract, preflight, review };
}

test(
  "B3 Native Dev Orchestrator exécute Analyst -> Baseline -> Implementation -> Review de bout en bout",
  async () => {
    const root =
      repository();

    const skillRegistry =
      createSkillRegistry();

    const transactionalExecutionEngine =
      createTransactionalExecutionEngine({
        repository:
          memoryRepository(),
        skillRegistry,
      });

    const journal =
      createDevTaskJournal({
        directory:
          fs.mkdtempSync(
            path.join(
              os.tmpdir(),
              "noon-b3-native-journal-"
            )
          ),
      });

    const phases = [];

    const reasoner = {
      async reason({
        phase,
        files,
      }) {
        phases.push(phase);

        if (
          phase === "PLAN"
        ) {
          return {
            files: [
              "lib/email.js",
            ],
          };
        }

        const file =
          files.find(
            (item) =>
              item.path ===
              "lib/email.js"
          );

        assert.ok(file);

        return {
          operations: [
            {
              type:
                "MODIFY",
              path:
                "lib/email.js",
              expectedHash:
                file.hash,
              search:
                "return value;",
              replacement:
                "return String(value).trim().toLowerCase();",
            },
          ],
        };
      },
    };

    const orchestrator =
      createNativeDevOrchestrator({
        workspaceEngine: {
          context: () => ({
            roots: [
              {
                path: root,
                mode:
                  "read-write",
              },
            ],
          }),
        },

        transactionalExecutionEngine,

        operationalSecurityPolicy: {
          evaluate: () => ({
            outcome:
              "ALLOW",
            policyVersion:
              "test",
          }),
        },

        skillRegistry,
        reasoner,
        journal,

        createTaskId:
          () =>
            "task-native-b3",
      });

    const result =
      await orchestrator.runTask({
        workspaceId:
          "workspace-b3",
        repositoryRoot:
          root,
        objective:
          "Corriger normalizeEmail",
        validationCommands: [
          "node --test test/email.test.js",
        ],
        maxIterations: 1,
      });

    assert.equal(
      result.taskId,
      "task-native-b3"
    );

    assert.equal(
      result.analysis.role,
      "CODEBASE_ANALYST"
    );

    assert.equal(
      result.baseline[0].status,
      "FAIL"
    );

    assert.equal(
      result.implementation.role,
      "IMPLEMENTATION_AGENT"
    );

    assert.equal(
      result.implementation.solved,
      true
    );

    assert.equal(
      result.review.role,
      "REVIEW_VALIDATION_AGENT"
    );

    assert.equal(
      result.review.finalVerdict,
      "PASS"
    );

    assert.equal(
      result.finalVerdict,
      "PASS"
    );

    assert.equal(
      result.status,
      "COMPLETED"
    );

    assert.deepEqual(
      phases,
      [
        "PLAN",
        "EDIT",
      ]
    );

    assert.match(
      fs.readFileSync(
        path.join(
          root,
          "lib/email.js"
        ),
        "utf8"
      ),
      /trim\(\)\.toLowerCase/
    );
  }
);

test(
  "la review lie uniquement son diff check terminal à un snapshot Git-visible stable",
  async () => {
    const fixture = await reviewedFixture();
    const binding = fixture.review.validationSnapshot;

    assert.equal(binding.bindingState, "LINKED");
    assert.equal(binding.validationStatus, "PASS");
    assert.equal(binding.snapshotCoverage, "GIT_VISIBLE_COMPLETE");
    assert.match(binding.snapshotRef, /^native_dev_snapshot_[a-f0-9]{32}$/);
    assert.match(binding.taskRef, /^native_dev_task_[a-f0-9]{32}$/);
    assert.equal(binding.sessionRef.includes("session-terminal-snapshot"), false);

    const adapted = adaptNativeDevResult({
      taskId: fixture.contract.taskId,
      finalVerdict: "PASS",
      analysis: { contract: fixture.contract, preflight: fixture.preflight },
      implementation: { iterations: [], providerCalls: [] },
      review: fixture.review,
    });
    assert.deepEqual(adapted.validationSnapshot, binding);
    const serialized = JSON.stringify(adapted.validationSnapshot);
    for (const raw of [
      fixture.root,
      fixture.contract.taskId,
      fixture.contract.workspaceId,
      fixture.contract.sessionId,
      "git diff --check",
    ]) {
      assert.equal(serialized.includes(raw), false);
    }
  }
);

test(
  "la review laisse non liée une validation qui fait dériver le dépôt",
  async () => {
    const fixture = await reviewedFixture({
      mutateDuringValidation(root, command) {
        if (command === "git diff --check") {
          fs.writeFileSync(path.join(root, "drift.txt"), "drift\n");
        }
      },
    });

    assert.equal(fixture.review.finalVerdict, "PASS");
    assert.equal(fixture.review.validationSnapshot.bindingState, "UNLINKED");
    assert.equal(fixture.review.validationSnapshot.reasonCode, "REPOSITORY_DIVERGED");
    assert.equal(fixture.review.validationSnapshot.validationStatus, "PASS");
    assert.equal(fixture.review.validationSnapshot.snapshotCoverage, "GIT_VISIBLE_COMPLETE");
  }
);

test(
  "la review refuse les liaisons incomplètes ou d'identité divergente",
  async () => {
    const incomplete = await reviewedFixture({
      validation: (command) => ({
        command,
        status: "PASS",
        exitCode: 0,
        outputTruncated: true,
        cleanupConfirmed: false,
      }),
    });
    assert.equal(incomplete.review.validationSnapshot.bindingState, "UNLINKED");
    assert.equal(incomplete.review.validationSnapshot.reasonCode, "VALIDATION_INCOMPLETE");

    const cleanupUnconfirmed = await reviewedFixture({
      validation: (command) => ({
        command,
        status: "PASS",
        exitCode: 0,
        outputTruncated: false,
        cleanupConfirmed: false,
      }),
    });
    assert.equal(cleanupUnconfirmed.review.validationSnapshot.bindingState, "UNLINKED");
    assert.equal(cleanupUnconfirmed.review.validationSnapshot.reasonCode, "VALIDATION_INCOMPLETE");

    const snapshotIncomplete = await reviewedFixture({
      mutateDuringValidation(root, command) {
        if (command === "git diff --check") {
          fs.unlinkSync(path.join(root, "lib/email.js"));
        }
      },
    });
    assert.equal(snapshotIncomplete.review.validationSnapshot.bindingState, "UNLINKED");
    assert.equal(snapshotIncomplete.review.validationSnapshot.reasonCode, "SNAPSHOT_INCOMPLETE");
    assert.equal(snapshotIncomplete.review.validationSnapshot.snapshotCoverage, "GIT_VISIBLE_PARTIAL");

    const staged = await reviewedFixture({
      mutateDuringValidation(root, command) {
        if (command === "git diff --check") {
          fs.writeFileSync(path.join(root, "lib/email.js"), "module.exports = {};\n");
          execFileSync("git", ["add", "lib/email.js"], { cwd: root });
        }
      },
    });
    assert.equal(staged.review.validationSnapshot.bindingState, "UNLINKED");
    assert.equal(staged.review.validationSnapshot.reasonCode, "SNAPSHOT_INCOMPLETE");
    assert.equal(staged.review.validationSnapshot.snapshotCoverage, "GIT_VISIBLE_PARTIAL");

    const symlink = await reviewedFixture({
      mutateDuringValidation(root, command) {
        if (command === "git diff --check") {
          fs.symlinkSync("lib/email.js", path.join(root, "linked-email.js"));
        }
      },
    });
    assert.equal(symlink.review.validationSnapshot.bindingState, "UNLINKED");
    assert.equal(symlink.review.validationSnapshot.reasonCode, "SNAPSHOT_INCOMPLETE");
    assert.equal(symlink.review.validationSnapshot.snapshotCoverage, "GIT_VISIBLE_PARTIAL");

    const snapshotUnavailable = await reviewedFixture({
      mutateDuringValidation(root, command) {
        if (command === "git diff --check") {
          fs.renameSync(path.join(root, ".git"), path.join(root, "git-metadata-hidden"));
        }
      },
    });
    assert.equal(snapshotUnavailable.review.validationSnapshot.bindingState, "UNLINKED");
    assert.equal(snapshotUnavailable.review.validationSnapshot.reasonCode, "SNAPSHOT_UNAVAILABLE");
    assert.equal(snapshotUnavailable.review.validationSnapshot.snapshotCoverage, "UNAVAILABLE");

    const mismatched = await reviewedFixture({
      input: { workspaceId: "another-workspace" },
    });
    assert.equal(mismatched.review.validationSnapshot.bindingState, "UNLINKED");
    assert.equal(mismatched.review.validationSnapshot.reasonCode, "IDENTITY_MISMATCH");

    const taskMismatched = await reviewedFixture({
      input: { taskId: "another-task" },
    });
    assert.equal(taskMismatched.review.validationSnapshot.reasonCode, "IDENTITY_MISMATCH");

    const sessionMismatched = await reviewedFixture({
      input: { sessionId: "another-session" },
    });
    assert.equal(sessionMismatched.review.validationSnapshot.reasonCode, "IDENTITY_MISMATCH");

    const cancelled = adaptNativeDevResult({
      taskId: incomplete.contract.taskId,
      finalVerdict: "FAIL",
      failureCategory: "CANCELLED",
      analysis: { contract: incomplete.contract, preflight: incomplete.preflight },
      implementation: { iterations: [], providerCalls: [] },
      review: incomplete.review,
    });
    assert.equal(cancelled.finalVerdict, "CANCELLED");
    assert.equal(cancelled.validationSnapshot.bindingState, "UNLINKED");
    assert.equal(cancelled.validationSnapshot.reasonCode, "TERMINAL_INCOMPLETE");
  }
);
