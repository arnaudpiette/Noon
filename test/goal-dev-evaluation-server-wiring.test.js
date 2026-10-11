"use strict";

const assert =
  require("node:assert/strict");

const fs =
  require("node:fs");

const path =
  require("node:path");

const test =
  require("node:test");

const SERVER =
  fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "server.js"
    ),
    "utf8"
  );

test(
  "4.5D conserve 4.5C comme core et ajoute Evaluation en wrapper",
  () => {
    assert.match(
      SERVER,
      /createGoalDevExecutionService/
    );

    assert.match(
      SERVER,
      /createGoalDevEvaluatedExecutionService/
    );

    assert.match(
      SERVER,
      /const goalDevExecutionCoreService/
    );

    assert.match(
      SERVER,
      /goalExecutionService:\s*goalDevExecutionCoreService/
    );

    assert.match(
      SERVER,
      /evaluationEngineProvider:\s*\(\)\s*=>\s*agentEvaluationEngine/
    );
  }
);

test(
  "4.5D la route dev-run utilise uniquement le service évalué",
  () => {
    const routeStart =
      SERVER.indexOf(
        'if (req.method === "POST" && req.url.startsWith("/api/goals/"))'
      );

    const routeEnd =
      SERVER.indexOf(
        'req.url === "/api/decision/compare"',
        routeStart
      );

    assert.notEqual(
      routeStart,
      -1
    );

    assert.notEqual(
      routeEnd,
      -1
    );

    const route =
      SERVER.slice(
        routeStart,
        routeEnd
      );

    assert.equal(
      (
        route.match(
          /goalDevExecutionService\.run/g
        ) || []
      ).length,
      1
    );

    assert.doesNotMatch(
      route,
      /goalDevExecutionCoreService\.run/
    );
  }
);

test(
  "4.5D ne crée aucune nouvelle route retry ou continue",
  () => {
    assert.doesNotMatch(
      SERVER,
      /\/api\/goals\/(?:retry|continue)/
    );

    assert.doesNotMatch(
      SERVER,
      /action === "(?:retry|continue)"/
    );
  }
);
