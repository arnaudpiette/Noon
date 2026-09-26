"use strict";

const assert =
  require("node:assert/strict");

const test =
  require("node:test");

const {
  MAX_PROBLEMS,
  inferDevProblemSource,
  normalizeProblemPath,
  parseDevProblems,
} = require(
  "../services/dev/dev-problems-service"
);

const ROOT =
  "/workspace/noon";

test(
  "classe la source selon la validation",
  () => {
    assert.equal(
      inferDevProblemSource(
        "npm test"
      ),
      "test"
    );

    assert.equal(
      inferDevProblemSource(
        "npm run lint"
      ),
      "lint"
    );

    assert.equal(
      inferDevProblemSource(
        "npm run typecheck"
      ),
      "typecheck"
    );

    assert.equal(
      inferDevProblemSource(
        "npm run build"
      ),
      "build"
    );

    assert.equal(
      inferDevProblemSource(
        "git diff --check"
      ),
      "validation"
    );
  }
);

test(
  "normalise uniquement les chemins internes au repository",
  () => {
    assert.equal(
      normalizeProblemPath(
        `${ROOT}/public/app.js`,
        ROOT
      ),
      "public/app.js"
    );

    assert.equal(
      normalizeProblemPath(
        "test/example.test.js",
        ROOT
      ),
      "test/example.test.js"
    );

    assert.equal(
      normalizeProblemPath(
        "../secret.txt",
        ROOT
      ),
      null
    );

    assert.equal(
      normalizeProblemPath(
        "/tmp/outside.js",
        ROOT
      ),
      null
    );
  }
);

test(
  "parse une erreur node --check",
  () => {
    const result =
      parseDevProblems({
        command:
          "npm run lint",
        repositoryRoot:
          ROOT,
        exitCode: 1,
        stderr: [
          `${ROOT}/public/app.js:63`,
          "const value = ;",
          "              ^",
          "",
          "SyntaxError: Unexpected token ';'",
        ].join("\n"),
      });

    assert.equal(
      result.status,
      "READY"
    );

    assert.equal(
      result.counts.error,
      1
    );

    assert.deepEqual(
      {
        source:
          result.problems[0]
            .source,
        file:
          result.problems[0]
            .file,
        line:
          result.problems[0]
            .line,
        column:
          result.problems[0]
            .column,
        code:
          result.problems[0]
            .code,
      },
      {
        source: "lint",
        file:
          "public/app.js",
        line: 63,
        column: 1,
        code:
          "SYNTAX_ERROR",
      }
    );

    assert.match(
      result.problems[0]
        .message,
      /Unexpected token/
    );
  }
);

test(
  "parse une erreur node:test TAP",
  () => {
    const result =
      parseDevProblems({
        command:
          "npm test",
        repositoryRoot:
          ROOT,
        exitCode: 1,
        stdout: [
          "not ok 12 - validation",
          `location: '${ROOT}/test/example.test.js:42:3'`,
          "failureType: 'testCodeFailure'",
          "error: 'Expected true but received false'",
          "code: 'ERR_ASSERTION'",
        ].join("\n"),
      });

    assert.equal(
      result.problems.length,
      1
    );

    assert.equal(
      result.problems[0]
        .source,
      "test"
    );

    assert.equal(
      result.problems[0]
        .file,
      "test/example.test.js"
    );

    assert.equal(
      result.problems[0]
        .line,
      42
    );

    assert.equal(
      result.problems[0]
        .column,
      3
    );

    assert.equal(
      result.problems[0]
        .code,
      "ERR_ASSERTION"
    );

    assert.match(
      result.problems[0]
        .message,
      /Expected true/
    );
  }
);

test(
  "parse un bloc node:test TAP YAML comme un seul Problem",
  () => {
    const result =
      parseDevProblems({
        command:
          "node --test test/example.test.js",
        repositoryRoot:
          ROOT,
        exitCode: 1,
        stdout: [
          "not ok 1 - validation",
          `location: '${ROOT}/test/example.test.js:3:1'`,
          "failureType: 'testCodeFailure'",
          "error: |-",
          "  Expected values to be strictly equal:",
          "  1 !== 2",
          "code: 'ERR_ASSERTION'",
          "stack: |-",
          `  helper (${ROOT}/test/example.test.js:2:26)`,
          `  TestContext.<anonymous> (${ROOT}/test/example.test.js:3:17)`,
        ].join("\n"),
      });

    assert.equal(
      result.problems.length,
      1
    );

    assert.deepEqual(
      {
        source:
          result.problems[0]
            .source,
        file:
          result.problems[0]
            .file,
        line:
          result.problems[0]
            .line,
        column:
          result.problems[0]
            .column,
        message:
          result.problems[0]
            .message,
      },
      {
        source: "test",
        file:
          "test/example.test.js",
        line: 3,
        column: 1,
        message:
          "Expected values to be strictly equal:",
      }
    );
  }
);

test(
  "parse une stack Node interne au projet",
  () => {
    const result =
      parseDevProblems({
        command:
          "node --test test/example.test.js",
        repositoryRoot:
          ROOT,
        exitCode: 1,
        stderr: [
          "AssertionError [ERR_ASSERTION]: boom",
          `    at TestContext.<anonymous> (${ROOT}/test/example.test.js:19:7)`,
          "    at node:internal/test_runner/test:1000:1",
        ].join("\n"),
      });

    assert.equal(
      result.problems.length,
      1
    );

    assert.equal(
      result.problems[0]
        .file,
      "test/example.test.js"
    );

    assert.equal(
      result.problems[0]
        .line,
      19
    );

    assert.equal(
      result.problems[0]
        .column,
      7
    );

    assert.equal(
      result.problems[0]
        .code,
      "ERR_ASSERTION"
    );
  }
);

test(
  "parse un diagnostic TypeScript",
  () => {
    const result =
      parseDevProblems({
        command:
          "npm run typecheck",
        repositoryRoot:
          ROOT,
        exitCode: 2,
        stdout:
          "src/example.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'.",
      });

    assert.equal(
      result.problems.length,
      1
    );

    assert.deepEqual(
      {
        source:
          result.problems[0]
            .source,
        severity:
          result.problems[0]
            .severity,
        file:
          result.problems[0]
            .file,
        line:
          result.problems[0]
            .line,
        column:
          result.problems[0]
            .column,
        code:
          result.problems[0]
            .code,
      },
      {
        source:
          "typecheck",
        severity:
          "error",
        file:
          "src/example.ts",
        line: 12,
        column: 5,
        code:
          "TS2322",
      }
    );
  }
);

test(
  "parse le format ESLint stylish",
  () => {
    const result =
      parseDevProblems({
        command:
          "npm run lint",
        repositoryRoot:
          ROOT,
        exitCode: 1,
        stdout: [
          `${ROOT}/src/example.js`,
          "  8:11  warning  Value is never used  no-unused-vars",
        ].join("\n"),
      });

    assert.equal(
      result.problems.length,
      1
    );

    assert.equal(
      result.problems[0]
        .severity,
      "warning"
    );

    assert.equal(
      result.problems[0]
        .file,
      "src/example.js"
    );

    assert.equal(
      result.problems[0]
        .code,
      "no-unused-vars"
    );
  }
);

test(
  "ignore les diagnostics hors repository",
  () => {
    const result =
      parseDevProblems({
        command:
          "npm test",
        repositoryRoot:
          ROOT,
        exitCode: 1,
        stderr: [
          "AssertionError: externe",
          "    at fn (/tmp/external.js:4:2)",
        ].join("\n"),
      });

    assert.equal(
      result.problems.length,
      0
    );

    assert.equal(
      result.status,
      "UNRESOLVED"
    );
  }
);

test(
  "supprime ANSI et déduplique les diagnostics",
  () => {
    const line =
      `${ROOT}/src/a.js:10:2: error Duplicate problem`;

    const result =
      parseDevProblems({
        command:
          "npm run build",
        repositoryRoot:
          ROOT,
        exitCode: 1,
        output: [
          {
            type: "stdout",
            text:
              `\u001b[31m${line}\u001b[0m\n`,
          },
          {
            type: "stderr",
            text:
              `${line}\n`,
          },
        ],
      });

    assert.equal(
      result.problems.length,
      1
    );

    assert.equal(
      result.problems[0]
        .source,
      "build"
    );

    assert.equal(
      result.problems[0]
        .message,
      "Duplicate problem"
    );
  }
);

test(
  "borne le nombre de Problems",
  () => {
    const output =
      Array.from(
        {
          length:
            MAX_PROBLEMS + 25,
        },
        (_, index) =>
          `${ROOT}/src/file.js:${index + 1}:1: error failure ${index + 1}`
      ).join("\n");

    const result =
      parseDevProblems({
        command:
          "npm run build",
        repositoryRoot:
          ROOT,
        exitCode: 1,
        stdout:
          output,
      });

    assert.equal(
      result.problems.length,
      MAX_PROBLEMS
    );

    assert.equal(
      result.truncated,
      true
    );

    assert.equal(
      result.counts.total,
      MAX_PROBLEMS
    );
  }
);

test(
  "ne renvoie jamais la sortie brute dans le contrat public",
  () => {
    const result =
      parseDevProblems({
        command:
          "npm test",
        repositoryRoot:
          ROOT,
        exitCode: 0,
        stdout:
          "texte sans diagnostic",
      });

    assert.equal(
      result.status,
      "EMPTY"
    );

    assert.equal(
      Object.hasOwn(
        result,
        "stdout"
      ),
      false
    );

    assert.equal(
      Object.hasOwn(
        result,
        "stderr"
      ),
      false
    );

    assert.equal(
      Object.hasOwn(
        result,
        "output"
      ),
      false
    );
  }
);

test(
  "ignore les frames node:internal d'une stack Node",
  () => {
    assert.equal(
      normalizeProblemPath(
        "node:internal/test_runner/test",
        ROOT
      ),
      null
    );

    const result =
      parseDevProblems({
        command:
          "npm test",
        repositoryRoot:
          ROOT,
        exitCode: 1,
        stderr: [
          "AssertionError [ERR_ASSERTION]: boom",
          `    at TestContext.<anonymous> (${ROOT}/test/example.test.js:10:3)`,
          "    at async Test.run (node:internal/test_runner/test:1047:25)",
          "    at async Test.processPendingSubtests (node:internal/test_runner/test:744:7)",
        ].join("\n"),
      });

    assert.equal(
      result.problems.length,
      1
    );

    assert.equal(
      result.problems[0].file,
      "test/example.test.js"
    );

    assert.equal(
      result.problems[0].line,
      10
    );

    assert.equal(
      result.problems[0].column,
      3
    );

    assert.doesNotMatch(
      JSON.stringify(
        result.problems
      ),
      /node:internal/
    );
  }
);

test(
  "le plafond exact de Problems n'est pas marqué comme tronqué",
  () => {
    const output =
      Array.from(
        {
          length:
            MAX_PROBLEMS,
        },
        (_, index) =>
          `${ROOT}/src/exact.js:${index + 1}:1: error failure ${index + 1}`
      ).join("\n");

    const result =
      parseDevProblems({
        command:
          "npm run build",
        repositoryRoot:
          ROOT,
        exitCode: 1,
        stdout:
          output,
      });

    assert.equal(
      result.problems.length,
      MAX_PROBLEMS
    );

    assert.equal(
      result.truncated,
      false
    );

    assert.equal(
      result.counts.total,
      MAX_PROBLEMS
    );
  }
);
