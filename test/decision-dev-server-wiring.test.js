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
  "4.4E server câble explicitement DEV Evidence sur la route Decision existante",
  () => {
    assert.match(
      SERVER,
      /createDevDecisionConsumer/
    );

    assert.match(
      SERVER,
      /nativeDevFacade:\s*nativeDevB3Facade/
    );

    assert.match(
      SERVER,
      /decisionSupportEngine/
    );

    assert.match(
      SERVER,
      /body\.devEvidence !== undefined/
    );

    assert.match(
      SERVER,
      /devDecisionConsumer\.compare/
    );

    assert.match(
      SERVER,
      /decisionRequest:\s*body\.decision/
    );

    assert.match(
      SERVER,
      /devEvidence:\s*body\.devEvidence/
    );
  }
);

test(
  "4.4E conserve le chemin Decision historique sans projection DEV automatique",
  () => {
    const routeStart =
      SERVER.indexOf(
        'req.url === "/api/decision/compare"'
      );

    assert.notEqual(
      routeStart,
      -1
    );

    const routeEnd =
      SERVER.indexOf(
        'req.url === "/api/decision/record"',
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
      /if \(body\.devEvidence !== undefined\)/
    );

    assert.match(
      route,
      /else \{[\s\S]*decisionSupportEngine\.compare/
    );

    assert.doesNotMatch(
      route,
      /attestedEvidenceIds:\s*body/
    );
  }
);
