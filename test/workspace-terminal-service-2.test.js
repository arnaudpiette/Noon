"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const {
  createSessionAndTerminal,
  fixture,
} = require("./helpers/workspace-terminal-service-fixtures");

test(
  "une validation plus ancienne ne remplace pas Problems d'une validation plus récente",
  (context) => {
    const data =
      fixture(context);

    const session =
      data.service.createSession({
        workspaceId:
          "workspace-test",
      });

    const olderTerminal =
      data.service.createTerminal({
        sessionId:
          session.id,
      });

    const newerTerminal =
      data.service.createTerminal({
        sessionId:
          session.id,
      });

    data.service.runCommand({
      sessionId:
        session.id,
      terminalId:
        olderTerminal.id,
      origin: "USER",
      command: "npm test",
    });

    const olderChild =
      data.children[0];

    data.service.runCommand({
      sessionId:
        session.id,
      terminalId:
        newerTerminal.id,
      origin: "USER",
      command:
        "npm run lint",
    });

    const newerChild =
      data.children[1];

    let current =
      data.service.getSession(
        session.id
      );

    assert.equal(
      current.problems.status,
      "RUNNING"
    );

    assert.equal(
      current.problems.terminalId,
      newerTerminal.id
    );

    assert.equal(
      current.problems.source,
      "lint"
    );

    olderChild.stderr.emit(
      "data",
      [
        "AssertionError [ERR_ASSERTION]: ancien problème",
        `    at TestContext.<anonymous> (${session.repositoryRoot}/test/old.test.js:19:7)`,
        "",
      ].join("\n")
    );

    olderChild.emit(
      "close",
      1,
      null
    );

    current =
      data.service.getSession(
        session.id
      );

    assert.equal(
      current.problems.status,
      "RUNNING"
    );

    assert.equal(
      current.problems.terminalId,
      newerTerminal.id
    );

    assert.equal(
      current.problems.source,
      "lint"
    );

    assert.equal(
      current.problems.counts.total,
      0
    );

    newerChild.stderr.emit(
      "data",
      [
        `${session.repositoryRoot}/src/new.js:12`,
        "SyntaxError: problème récent",
        "",
      ].join("\n")
    );

    newerChild.emit(
      "close",
      1,
      null
    );

    current =
      data.service.getSession(
        session.id
      );

    assert.equal(
      current.problems.status,
      "READY"
    );

    assert.equal(
      current.problems.terminalId,
      newerTerminal.id
    );

    assert.equal(
      current.problems.source,
      "lint"
    );

    assert.equal(
      current.problems.counts.total,
      1
    );

    assert.equal(
      current.problems.problems[0]
        .file,
      "src/new.js"
    );

    assert.doesNotMatch(
      JSON.stringify(
        current.problems
      ),
      /old\.test\.js/
    );
  }
);

// TERMINAL COMPLETION #5.4D

test(
  "Terminal #5.4D propose les vrais scripts package.json sans lancer de process",
  (context) => {
    const data =
      fixture(context);

    fs.writeFileSync(
      path.join(
        data.root,
        "package.json"
      ),
      JSON.stringify({
        scripts: {
          dev: "vite",
          build: "vite build",
          lint: "eslint .",
          test: "node --test",
        },
      })
    );

    const session =
      data.service.createSession({
        workspaceId:
          "workspace-test",
      });

    const result =
      data.service.getCompletions({
        sessionId:
          session.id,
        query:
          "npm run d",
      });

    assert.deepEqual(
      result.completions,
      [
        "npm run dev",
      ]
    );

    assert.equal(
      data.spawnCalls.length,
      0
    );
  }
);

test(
  "Terminal #5.4D complète fichiers et dossiers uniquement dans le repositoryRoot",
  (context) => {
    const data =
      fixture(context);

    fs.mkdirSync(
      path.join(
        data.root,
        "src",
        "components"
      ),
      {
        recursive: true,
      }
    );

    fs.writeFileSync(
      path.join(
        data.root,
        "src",
        "index.js"
      ),
      "module.exports = {};\n"
    );

    const session =
      data.service.createSession({
        workspaceId:
          "workspace-test",
      });

    const result =
      data.service.getCompletions({
        sessionId:
          session.id,
        query:
          "src/",
      });

    assert.ok(
      result.completions.includes(
        "src/components/"
      )
    );

    assert.ok(
      result.completions.includes(
        "src/index.js"
      )
    );

    const cdResult =
      data.service.getCompletions({
        sessionId:
          session.id,
        query:
          "cd s",
      });

    assert.ok(
      cdResult.completions.includes(
        "cd src/"
      )
    );

    assert.equal(
      data.spawnCalls.length,
      0
    );
  }
);

test(
  "Terminal #5.4D exclut métadonnées, dépendances et fichiers sensibles",
  (context) => {
    const data =
      fixture(context);

    fs.mkdirSync(
      path.join(
        data.root,
        ".git"
      )
    );

    fs.mkdirSync(
      path.join(
        data.root,
        "node_modules"
      )
    );

    fs.writeFileSync(
      path.join(
        data.root,
        ".env"
      ),
      "SECRET=value\n"
    );

    fs.writeFileSync(
      path.join(
        data.root,
        "token.pem"
      ),
      "secret\n"
    );

    fs.mkdirSync(
      path.join(
        data.root,
        "src"
      )
    );

    const session =
      data.service.createSession({
        workspaceId:
          "workspace-test",
      });

    const result =
      data.service.getCompletions({
        sessionId:
          session.id,
        query:
          "./",
      });

    const serialized =
      JSON.stringify(
        result.completions
      );

    assert.doesNotMatch(
      serialized,
      /\.git/
    );

    assert.doesNotMatch(
      serialized,
      /node_modules/
    );

    assert.doesNotMatch(
      serialized,
      /\.env/
    );

    assert.doesNotMatch(
      serialized,
      /token\.pem/
    );

    assert.match(
      serialized,
      /src\//
    );
  }
);

test(
  "Terminal #5.4D refuse traversée parent et symlink sortant du repo",
  (context) => {
    const data =
      fixture(context);

    fs.mkdirSync(
      path.join(
        data.foreignRoot,
        "private"
      )
    );

    fs.symlinkSync(
      data.foreignRoot,
      path.join(
        data.root,
        "escape"
      )
    );

    fs.mkdirSync(
      path.join(
        data.root,
        "safe"
      )
    );

    const session =
      data.service.createSession({
        workspaceId:
          "workspace-test",
      });

    const traversal =
      data.service.getCompletions({
        sessionId:
          session.id,
        query:
          "cd ../",
      });

    assert.deepEqual(
      traversal.completions,
      []
    );

    const rootResult =
      data.service.getCompletions({
        sessionId:
          session.id,
        query:
          "./",
      });

    assert.ok(
      rootResult.completions.includes(
        "./safe/"
      )
    );

    assert.equal(
      rootResult.completions.some(
        (item) =>
          item.includes("escape")
      ),
      false
    );

    assert.equal(
      data.spawnCalls.length,
      0
    );
  }
);

/* NATIVE_UI_SERVER_AUTH_REGRESSIONS */

test("autorisation Native : commande terminée, exacte et à usage unique", (t) => {
  const f = fixture(t);
  const { session, terminal } = createSessionAndTerminal(f);

  const claim = (command = "npm test") =>
    f.service.claimAuthorizedValidation({
      sessionId: session.id,
      command,
    });

  assert.equal(claim(), false);

  f.service.runCommand({
    sessionId: session.id,
    terminalId: terminal.id,
    origin: "USER",
    command: "npm test",
  });

  assert.equal(claim(), false);

  f.children.at(-1).emit("close", 0, null);

  assert.equal(claim("npm run build"), false);
  assert.equal(claim(), true);
  assert.equal(claim(), false);
});

test("autorisation Native : FAIL légitime, signal refusé", (t) => {
  const f = fixture(t);
  const { session, terminal } = createSessionAndTerminal(f);

  const claim = () =>
    f.service.claimAuthorizedValidation({
      sessionId: session.id,
      command: "npm test",
    });

  f.service.runCommand({
    sessionId: session.id,
    terminalId: terminal.id,
    origin: "USER",
    command: "npm test",
  });

  f.children.at(-1).emit("close", 1, null);
  assert.equal(claim(), true);

  f.service.runCommand({
    sessionId: session.id,
    terminalId: terminal.id,
    origin: "USER",
    command: "npm test",
  });

  f.children.at(-1).emit("close", null, "SIGTERM");
  assert.equal(claim(), false);
});

test("autorisation Native : expiration et origine NOON refusées", (t) => {
  let clock = Date.parse("2026-10-06T08:00:00.000Z");
  const f = fixture(t, { now: () => clock });
  const { session, terminal } = createSessionAndTerminal(f);

  const claim = () =>
    f.service.claimAuthorizedValidation({
      sessionId: session.id,
      command: "npm test",
    });

  f.service.runCommand({
    sessionId: session.id,
    terminalId: terminal.id,
    origin: "USER",
    command: "npm test",
  });

  f.children.at(-1).emit("close", 0, null);

  clock += 31 * 60_000;
  assert.equal(claim(), false);

  const noon = f.service.createTerminal({
    sessionId: session.id,
    owner: "NOON",
  });

  f.service.runCommand({
    sessionId: session.id,
    terminalId: noon.id,
    origin: "NOON",
    command: "npm test",
  });

  f.children.at(-1).emit("close", 0, null);
  assert.equal(claim(), false);
});

test("Problems remplace le FAIL USER par la validation Native équivalente PASS", (t) => {
  let clock = Date.parse("2026-10-07T08:00:00.000Z");
  const f = fixture(t, { now: () => clock });
  const { session, terminal } = createSessionAndTerminal(f);

  f.service.runCommand({ sessionId: session.id, terminalId: terminal.id, origin: "USER", command: "npm test" });
  f.children.at(-1).stderr.emit("data", "test at test/add.test.js:10:1\nAssertionError [ERR_ASSERTION]: -1 !== 5");
  f.children.at(-1).emit("close", 1, null);
  assert.equal(f.service.getSession(session.id).problems.status, "READY");

  clock += 1_000;
  const result = f.service.applyNativeValidationResult({
    sessionId: session.id,
    workspaceId: "workspace-test",
    command: "npm test",
    validation: { command: "npm test", status: "PASS", exitCode: 0, outputTail: "1..1\nok 1 - add", outputTruncated: false },
    taskId: "native-1",
    startedAt: "2026-10-07T08:00:00.500Z",
    completedAt: new Date(clock).toISOString(),
    finalVerdict: "PASS",
  });

  assert.deepEqual(result, { applied: true, status: "EMPTY" });
  assert.equal(f.service.getSession(session.id).problems.counts.total, 0);
});

test("Problems Native actualise un échec prouvé sans fabriquer un succès", (t) => {
  const f = fixture(t);
  const { session } = createSessionAndTerminal(f);
  const result = f.service.applyNativeValidationResult({
    sessionId: session.id,
    workspaceId: "workspace-test",
    command: "npm test",
    validation: { command: "npm test", status: "FAIL", exitCode: 1, outputTail: "test at test/add.test.js:10:1\nAssertionError [ERR_ASSERTION]: still broken", outputTruncated: false },
    taskId: "native-fail",
    startedAt: "2026-10-07T07:59:00.000Z",
    completedAt: "2026-10-07T08:00:00.000Z",
    finalVerdict: "FAIL",
  });

  assert.deepEqual(result, { applied: true, status: "READY" });
  assert.equal(f.service.getSession(session.id).problems.counts.error, 1);
});

test("Problems conserve les diagnostics non couverts et ignore les résultats Native tardifs", (t) => {
  let clock = Date.parse("2026-10-07T08:00:00.000Z");
  const f = fixture(t, { now: () => clock });
  const { session, terminal } = createSessionAndTerminal(f);

  f.service.runCommand({ sessionId: session.id, terminalId: terminal.id, origin: "USER", command: "npm test" });
  f.children.at(-1).emit("close", 0, null);
  clock += 1_000;
  const late = f.service.applyNativeValidationResult({ sessionId: session.id, workspaceId: "workspace-test", command: "npm test", validation: { command: "npm test", status: "FAIL", exitCode: 1, outputTail: "test at test/add.test.js:10:1\nAssertionError [ERR_ASSERTION]: old", outputTruncated: false }, startedAt: "2026-10-07T07:59:00.000Z", completedAt: "2026-10-07T07:59:59.000Z", finalVerdict: "FAIL" });
  assert.equal(late.reason, "NATIVE_VALIDATION_STALE");

  const other = f.service.applyNativeValidationResult({ sessionId: session.id, workspaceId: "workspace-other", command: "npm test", validation: { command: "npm test", status: "PASS", exitCode: 0, outputTail: "1..1", outputTruncated: false }, startedAt: new Date(clock).toISOString(), completedAt: new Date(clock + 1_000).toISOString(), finalVerdict: "PASS" });
  assert.equal(other.reason, "NATIVE_VALIDATION_CONTEXT_INVALID");

  f.service.runCommand({ sessionId: session.id, terminalId: terminal.id, origin: "USER", command: "npm run lint" });
  f.children.at(-1).stderr.emit("data", "src/new.js:1:1 error lint issue");
  f.children.at(-1).emit("close", 1, null);
  const uncovered = f.service.applyNativeValidationResult({ sessionId: session.id, workspaceId: "workspace-test", command: "npm test", validation: { command: "npm test", status: "PASS", exitCode: 0, outputTail: "1..1", outputTruncated: false }, startedAt: new Date(clock).toISOString(), completedAt: new Date(clock + 2_000).toISOString(), finalVerdict: "PASS" });
  assert.equal(uncovered.reason, "NATIVE_VALIDATION_NOT_COVERED");
  assert.equal(f.service.getSession(session.id).problems.command, "npm run lint");
});

test("Problems ne laisse pas un résultat Native écraser une validation USER plus récente en cours", (t) => {
  let clock = Date.parse("2026-10-07T08:00:00.000Z");
  const f = fixture(t, { now: () => clock });
  const { session, terminal } = createSessionAndTerminal(f);

  f.service.runCommand({ sessionId: session.id, terminalId: terminal.id, origin: "USER", command: "npm test" });
  f.children.at(-1).emit("close", 1, null);
  clock += 1_000;
  f.service.runCommand({ sessionId: session.id, terminalId: terminal.id, origin: "USER", command: "npm test" });

  const stale = f.service.applyNativeValidationResult({
    sessionId: session.id,
    workspaceId: "workspace-test",
    command: "npm test",
    validation: { command: "npm test", status: "PASS", exitCode: 0, outputTail: "1..1", outputTruncated: false },
    startedAt: "2026-10-07T08:00:00.500Z",
    completedAt: "2026-10-07T08:00:02.000Z",
    finalVerdict: "PASS",
  });

  assert.equal(stale.reason, "NATIVE_VALIDATION_STALE");
  assert.equal(f.service.getSession(session.id).problems.status, "RUNNING");
});

test("Problems refuse de vider sans sortie Native et signale une sortie tronquée", (t) => {
  let clock = Date.parse("2026-10-07T08:00:00.000Z");
  const f = fixture(t, { now: () => clock });
  const { session, terminal } = createSessionAndTerminal(f);

  f.service.runCommand({
    sessionId: session.id,
    terminalId: terminal.id,
    origin: "USER",
    command: "npm test",
  });

  f.children.at(-1).stdout.emit(
    "data",
    [
      "not ok 1 - addition",
      `location: '${session.repositoryRoot}/test/add.test.js:10:1'`,
      "failureType: 'testCodeFailure'",
      "error: 'Expected -1 to equal 5'",
      "code: 'ERR_ASSERTION'",
      "",
    ].join("\n")
  );

  f.children.at(-1).emit("close", 1, null);

  assert.equal(
    f.service.getSession(session.id).problems.counts.error,
    1
  );

  const missing = f.service.applyNativeValidationResult({
    sessionId: session.id,
    workspaceId: "workspace-test",
    command: "npm test",
    validation: {
      command: "npm test",
      status: "PASS",
      exitCode: 0,
      outputTail: "",
      outputTruncated: false,
    },
    startedAt: "2026-10-07T08:00:00.500Z",
    completedAt: "2026-10-07T08:00:01.000Z",
    finalVerdict: "PASS",
  });

  assert.equal(
    missing.reason,
    "NATIVE_VALIDATION_PROOF_MISSING"
  );

  assert.equal(
    f.service.getSession(session.id).problems.counts.error,
    1
  );

  const uninterpretable =
    f.service.applyNativeValidationResult({
      sessionId: session.id,
      workspaceId: "workspace-test",
      command: "npm test",
      validation: {
        command: "npm test",
        status: "PASS",
        exitCode: 0,
        outputTail: "validation complete",
        outputTruncated: false,
      },
      startedAt: "2026-10-07T08:00:01.500Z",
      completedAt: "2026-10-07T08:00:02.000Z",
      finalVerdict: "PASS",
    });

  assert.deepEqual(
    uninterpretable,
    {
      applied: true,
      status: "UNRESOLVED",
    }
  );

  const truncated =
    f.service.applyNativeValidationResult({
      sessionId: session.id,
      workspaceId: "workspace-test",
      command: "npm test",
      validation: {
        command: "npm test",
        status: "PASS",
        exitCode: 0,
        outputTail: "partial output",
        outputTruncated: true,
      },
      startedAt: "2026-10-07T08:00:02.500Z",
      completedAt: "2026-10-07T08:00:03.000Z",
      finalVerdict: "PASS",
    });

  assert.deepEqual(
    truncated,
    {
      applied: true,
      status: "UNRESOLVED",
    }
  );

  assert.equal(
    f.service.getSession(session.id).problems.status,
    "UNRESOLVED"
  );
});
