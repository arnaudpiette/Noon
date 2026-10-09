"use strict";

const assert =
  require("node:assert/strict");

const fs =
  require("node:fs");

const path =
  require("node:path");

const test =
  require("node:test");

const ROOT =
  path.join(
    __dirname,
    ".."
  );

function source(file) {
  return fs.readFileSync(
    path.join(
      ROOT,
      file
    ),
    "utf8"
  );
}

test(
  "Native B3 utilise Sandbox mais le coordinateur benchmark conserve son runner historique",
  () => {
    const server =
      source(
        "server.js"
      );

    const coordinatorStart =
      server.indexOf(
        "const nativeDevCoordinator = createNativeDevCoordinator({"
      );

    const b3Start =
      server.indexOf(
        "const nativeDevB3Orchestrator = createNativeDevOrchestrator({"
      );

    const facadeStart =
      server.indexOf(
        "const nativeDevB3Facade ="
      );

    assert.ok(
      coordinatorStart >= 0
    );

    assert.ok(
      b3Start >
        coordinatorStart
    );

    assert.ok(
      facadeStart >
        b3Start
    );

    const coordinatorBlock =
      server.slice(
        coordinatorStart,
        b3Start
      );

    const b3Block =
      server.slice(
        b3Start,
        facadeStart
      );

    assert.doesNotMatch(
      coordinatorBlock,
      /sandboxDevValidationExecutor/
    );

    assert.match(
      b3Block,
      /validationRunner:\s*sandboxDevValidationExecutor/
    );
  }
);

test(
  "le spécialiste principal utilise Sandbox mais le benchmark reste exclu",
  () => {
    const server =
      source(
        "server.js"
      );

    const mainStart =
      server.indexOf(
        "const devDelegationRunner = createDevDelegationRunner({"
      );

    const benchmarkStart =
      server.indexOf(
        "const benchmarkDevDelegationRunner = createDevDelegationRunner({"
      );

    assert.ok(
      mainStart >= 0
    );

    assert.ok(
      benchmarkStart >
        mainStart
    );

    const mainBlock =
      server.slice(
        mainStart,
        benchmarkStart
      );

    const benchmarkBlock =
      server.slice(
        benchmarkStart,
        server.indexOf(
          "let benchmarkRuntime",
          benchmarkStart
        )
      );

    assert.match(
      mainBlock,
      /validationExecutor:\s*sandboxDevValidationExecutor/
    );

    assert.doesNotMatch(
      benchmarkBlock,
      /sandboxDevValidationExecutor/
    );
  }
);

test(
  "Native transmet le contexte canonique au validationRunner",
  () => {
    const value =
      source(
        "services/dev/native-dev-implementation-engine.js"
      );

    assert.match(
      value,
      /validationRunner\([\s\S]*?taskId,[\s\S]*?workspaceId:\s*contract\.workspaceId,[\s\S]*?sessionId:\s*contract\.sessionId,[\s\S]*?permissions:\s*contract\.permissions/
    );
  }
);

test(
  "le spécialiste transmet AbortSignal et contexte aux validations",
  () => {
    const value =
      source(
        "services/delegation/dev-delegation-runner.js"
      );

    const matches =
      value.match(
        /validationExecutor\([\s\S]*?controller\.signal,[\s\S]*?taskId:\s*contract\.taskId,[\s\S]*?workspaceId:\s*contract\.workspaceId,[\s\S]*?permissions:\s*contract\.permissions/g
      ) || [];

    assert.equal(
      matches.length,
      2
    );
  }
);

test(
  "DevTaskContract conserve seulement le sessionId amont sans en créer un",
  () => {
    const value =
      source(
        "services/delegation/dev-task-contract.js"
      );

    assert.match(
      value,
      /sessionId:\s*input\.sessionId\s*\?\s*String\(input\.sessionId\)\.slice\(0,\s*200\)\s*:\s*null/
    );
  }
);
