"use strict";

const assert =
  require("node:assert/strict");
const fs =
  require("node:fs");
const path =
  require("node:path");
const test =
  require("node:test");

const serverPath =
  path.join(
    __dirname,
    "..",
    "server.js"
  );

function source() {
  return fs.readFileSync(
    serverPath,
    "utf8"
  );
}

test(
  "B3 server construit le pipeline multi-agents et sa façade",
  () => {
    const value =
      source();

    assert.match(
      value,
      /createNativeDevOrchestrator/
    );

    assert.match(
      value,
      /createNativeDevOrchestratorFacade/
    );

    assert.match(
      value,
      /const nativeDevB3Orchestrator\s*=\s*createNativeDevOrchestrator/
    );

    assert.match(
      value,
      /const nativeDevB3Facade\s*=\s*createNativeDevOrchestratorFacade/
    );
  }
);

test(
  "B3 les trois routes Native DEV utilisent exclusivement la façade B3",
  () => {
    const value =
      source();

    const start =
      value.indexOf(
        'if (requestPath === "/api/dev/native/tasks"'
      );

    const end =
      value.indexOf(
        'if (req.method === "GET" && req.url.startsWith("/api/features"))',
        start
      );

    assert.ok(
      start >= 0
    );

    assert.ok(
      end > start
    );

    const routes =
      value.slice(
        start,
        end
      );

    assert.match(
      routes,
      /nativeDevB3Facade\.runTask/
    );

    assert.match(
      routes,
      /nativeDevB3Facade\.getTaskStatus/
    );

    assert.match(
      routes,
      /nativeDevB3Facade\.cancelTask/
    );

    assert.doesNotMatch(
      routes,
      /nativeDevCoordinator\.(?:runTask|getTaskStatus|cancelTask)/
    );
  }
);

test(
  "B3 le benchmark conserve explicitement le NativeDevCoordinator historique",
  () => {
    const value =
      source();

    const start =
      value.indexOf(
        "benchmarkRuntime = createBenchmarkRuntime"
      );

    assert.ok(
      start >= 0
    );

    const benchmark =
      value.slice(
        start,
        start + 1200
      );

    assert.match(
      benchmark,
      /\bnativeDevCoordinator\b/
    );

    assert.doesNotMatch(
      benchmark,
      /\bnativeDevB3Facade\b/
    );

    assert.doesNotMatch(
      benchmark,
      /\bnativeDevB3Orchestrator\b/
    );
  }
);
