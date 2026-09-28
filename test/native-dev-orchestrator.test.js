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
