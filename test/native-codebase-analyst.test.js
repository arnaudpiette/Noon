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
  createNativeCodebaseAnalyst,
} =
  require("../services/dev/agents/native-codebase-analyst");

function repository() {
  const root =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "noon-b3-analyst-"
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
        test: "node --test",
        lint: "eslint .",
      },
    })
  );

  fs.writeFileSync(
    path.join(
      root,
      "index.js"
    ),
    "module.exports = true;\n"
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
  "B3 Native Codebase Analyst produit contrat preflight commandes et deadline",
  async () => {
    const root =
      repository();

    let clock = 1000;

    const analyst =
      createNativeCodebaseAnalyst({
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

        now: () =>
          clock++,
      });

    const result =
      await analyst.analyzeTask({
        taskId:
          "task-analysis",
        workspaceId:
          "workspace-1",
        repositoryRoot:
          root,
        objective:
          "Analyser le dépôt",
        validationCommands: [
          "npm test",
        ],
        maxDuration:
          10_000,
      });

    assert.equal(
      result.role,
      "CODEBASE_ANALYST"
    );

    assert.equal(
      result.contract.taskId,
      "task-analysis"
    );

    const canonicalRoot =
      fs.realpathSync(root);

    assert.equal(
      result.contract.repositoryRoot,
      canonicalRoot
    );

    assert.equal(
      result.preflight.repositoryRoot,
      canonicalRoot
    );

    assert.deepEqual(
      result.defaultCommands,
      ["npm test"]
    );

    assert.ok(
      result.deadline >
        1000
    );
  }
);

test(
  "B3 Native Codebase Analyst dérive les validations package si aucune n'est fournie",
  async () => {
    const root =
      repository();

    const analyst =
      createNativeCodebaseAnalyst({
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
      });

    const result =
      await analyst.analyzeTask({
        workspaceId:
          "workspace-1",
        repositoryRoot:
          root,
        objective:
          "Analyser",
      });

    assert.ok(
      result.defaultCommands.includes(
        "npm test"
      )
    );

    assert.ok(
      result.defaultCommands.includes(
        "npm run lint"
      )
    );
  }
);

test(
  "B3 Native Codebase Analyst refuse un workspace hors périmètre",
  async () => {
    const root =
      repository();

    const outside =
      fs.mkdtempSync(
        path.join(
          os.tmpdir(),
          "noon-b3-outside-"
        )
      );

    const analyst =
      createNativeCodebaseAnalyst({
        workspaceEngine: {
          context: () => ({
            roots: [
              {
                path: outside,
                mode:
                  "read-write",
              },
            ],
          }),
        },
      });

    await assert.rejects(
      () =>
        analyst.analyzeTask({
          workspaceId:
            "workspace-1",
          repositoryRoot:
            root,
          objective:
            "Analyser",
        }),
      (error) =>
        error.code ===
        "PERMISSION_DENIED"
    );
  }
);
