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
  createDevTaskContract,
} =
  require("../services/delegation/dev-task-contract");

const {
  repositoryPreflight,
} =
  require("../services/delegation/repository-preflight");

const {
  createNativeReviewValidationAgent,
} =
  require("../services/dev/agents/native-review-validation-agent");

function repository() {
  const root =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "noon-b3-review-"
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
    path.join(root, "a.js"),
    "module.exports = 1;\n"
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

function fixture({
  validationStatus = "PASS",
} = {}) {
  const root =
    repository();

  const contract =
    createDevTaskContract({
      taskId: "task-review",
      workspaceAuthorized:
        true,
      workspaceId: "w",
      workspaceRoots: [
        root,
      ],
      repositoryRoot:
        root,
      objective:
        "Modifier a.js",
      validationCommands: [
        "npm test",
      ],
    });

  const preflight =
    repositoryPreflight(
      contract
    );

  const events = [];

  const journal = {
    start:
      (...args) =>
        events.push([
          "start",
          ...args,
        ]),

    transition:
      (...args) =>
        events.push([
          "transition",
          ...args,
        ]),

    finish:
      (...args) =>
        events.push([
          "finish",
          ...args,
        ]),
  };

  const validations = [];

  const implementationEngine = {
    async validate(
      _contract,
      _taskId,
      command,
      iteration
    ) {
      const status =
        command === "git diff --check"
          ? "PASS"
          : validationStatus;

      const result = {
        command,
        iteration,
        status,
      };

      validations.push(
        result
      );

      return result;
    },
  };

  const agent =
    createNativeReviewValidationAgent({
      implementationEngine,
      journal,
    });

  return {
    root,
    contract,
    preflight,
    agent,
    events,
    validations,
  };
}

test(
  "B3 Review Agent exécute la baseline avant implémentation",
  async () => {
    const f =
      fixture();

    const baseline =
      await f.agent
        .baselineTask({
          analysis: {
            contract:
              f.contract,
            preflight:
              f.preflight,
            defaultCommands: [
              "npm test",
            ],
          },
        });

    assert.equal(
      baseline.length,
      1
    );

    assert.equal(
      baseline[0].command,
      "npm test"
    );

    assert.equal(
      f.events[0][0],
      "start"
    );

    assert.equal(
      f.events[1][0],
      "transition"
    );

    assert.equal(
      f.events[1][2],
      "BASELINE"
    );
  }
);

test(
  "B3 Review Agent valide le diff final et produit PASS",
  async () => {
    const f =
      fixture();

    const baseline =
      await f.agent
        .baselineTask({
          analysis: {
            contract:
              f.contract,
            preflight:
              f.preflight,
            defaultCommands: [
              "npm test",
            ],
          },
        });

    fs.writeFileSync(
      path.join(
        f.root,
        "a.js"
      ),
      "module.exports = 2;\n"
    );

    const result =
      await f.agent
        .reviewTask({
          analysis: {
            contract:
              f.contract,
            preflight:
              f.preflight,
          },

          baseline,

          implementation: {
            solved: true,
            touched: [
              "a.js",
            ],
            iterations: [
              {
                iteration: 1,
              },
            ],
            validations: [
              {
                command:
                  "npm test",
                status:
                  "PASS",
              },
            ],
          },
        });

    assert.equal(
      result.role,
      "REVIEW_VALIDATION_AGENT"
    );

    assert.equal(
      result.finalVerdict,
      "PASS"
    );

    assert.equal(
      result.failureCategory,
      null
    );

    assert.deepEqual(
      result.changedFiles,
      ["a.js"]
    );

    assert.equal(
      result.diffCheck.command,
      "git diff --check"
    );
  }
);

test(
  "B3 Review Agent conserve PARTIAL si une baseline rouge reste non résolue",
  async () => {
    const f =
      fixture({
        validationStatus:
          "FAIL",
      });

    const baseline =
      await f.agent
        .baselineTask({
          analysis: {
            contract:
              f.contract,
            preflight:
              f.preflight,
            defaultCommands: [
              "npm test",
            ],
          },
        });

    const result =
      await f.agent
        .reviewTask({
          analysis: {
            contract:
              f.contract,
            preflight:
              f.preflight,
          },

          baseline,

          implementation: {
            solved: true,
            touched: [],
            iterations: [],
            validations: [
              {
                command:
                  "npm test",
                status:
                  "FAIL",
              },
            ],
          },
        });

    assert.equal(
      result.finalVerdict,
      "PARTIAL"
    );

    assert.equal(
      result.preExistingFailure,
      true
    );

    assert.equal(
      result.unresolvedPreExistingFailure,
      true
    );
  }
);
