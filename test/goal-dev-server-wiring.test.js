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
  "4.5C server câble Goal vers Native DEV via le service dédié",
  () => {
    assert.match(
      SERVER,
      /createGoalDevExecutionService/
    );

    assert.match(
      SERVER,
      /goalStrategyEngine/
    );

    assert.match(
      SERVER,
      /nativeDevFacade:\s*nativeDevB3Facade/
    );

    assert.match(
      SERVER,
      /projectRuleResolver:\s*devProjectRuleResolver/
    );

    assert.match(
      SERVER,
      /budgetService:\s*devCostBudgetService/
    );

    assert.match(
      SERVER,
      /action === "dev-run"/
    );

    assert.match(
      SERVER,
      /goalDevExecutionService\.run/
    );
  }
);

test(
  "4.5C exige une confirmation explicite avant le lancement DEV",
  () => {
    const routeStart =
      SERVER.indexOf(
        'if (req.method === "POST" && req.url.startsWith("/api/goals/"))'
      );

    assert.notEqual(
      routeStart,
      -1
    );

    const routeEnd =
      SERVER.indexOf(
        'req.url === "/api/decision/compare"',
        routeStart
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

    assert.match(
      route,
      /body\.userConfirmed !== true/
    );

    assert.match(
      route,
      /GOAL_DEV_EXECUTION_CONFIRMATION_REQUIRED/
    );

    assert.match(
      route,
      /goalId:\s*body\.goalId/
    );

    assert.match(
      route,
      /request:\s*body\.devTask \|\| \{\}/
    );
  }
);

test(
  "4.5C ne transforme aucune autre action Goal en lancement DEV automatique",
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
      /action === "create"[\s\S]{0,200}goalDevExecutionService\.run/
    );

    assert.doesNotMatch(
      route,
      /action === "update"[\s\S]{0,200}goalDevExecutionService\.run/
    );

    assert.doesNotMatch(
      route,
      /action === "transition"[\s\S]{0,200}goalDevExecutionService\.run/
    );
  }
);
