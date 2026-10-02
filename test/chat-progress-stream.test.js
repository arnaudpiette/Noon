"use strict";

const assert =
  require("node:assert/strict");

const fs =
  require("node:fs");

const path =
  require("node:path");

const test =
  require("node:test");

const {
  toChatProgressEvent,
} = require(
  "../services/observability/chat-progress-event"
);

const ROOT =
  path.join(
    __dirname,
    ".."
  );

test(
  "le payload SSE Progress ne conserve que le contrat public",
  () => {
    const event =
      toChatProgressEvent({
        version: "1.0",
        executionId: "exec-1",
        sequence: 2,
        source: "orchestrator",
        state: "RUNNING",
        phase: "VALIDATION",
        progress: 42,
        currentStep: 1,
        totalSteps: 2,
        reasonCode: "CHECKING",

        prompt:
          "SECRET_PROMPT",

        output:
          "SECRET_OUTPUT",

        message:
          "SECRET_MESSAGE",

        args: {
          token:
            "SECRET_TOKEN",
        },
      });

    assert.deepEqual(
      Object.keys(event),
      [
        "version",
        "executionId",
        "sequence",
        "source",
        "state",
        "phase",
        "progress",
        "currentStep",
        "totalSteps",
        "reasonCode",
      ]
    );

    assert.doesNotMatch(
      JSON.stringify(event),
      /SECRET_/
    );
  }
);

test(
  "le serveur isole Progress avec AsyncLocalStorage",
  () => {
    const source =
      fs.readFileSync(
        path.join(
          ROOT,
          "server.js"
        ),
        "utf8"
      );

    assert.match(
      source,
      /new AsyncLocalStorage\(\)/
    );

    assert.match(
      source,
      /chatProgressRequestContext\.run/
    );

    assert.match(
      source,
      /event: progress/
    );
  }
);

test(
  "le renderer traite progress sans HTML dynamique",
  () => {
    const source =
      fs.readFileSync(
        path.join(
          ROOT,
          "public/app.js"
        ),
        "utf8"
      );

    assert.match(
      source,
      /eventName === "progress"/
    );

    assert.match(
      source,
      /updateChatProgress/
    );

    assert.match(
      source,
      /streamedParagraph\.textContent\s*=\s*streamedText/
    );

    assert.match(
      source,
      /element\.textContent\s*=\s*presentation\.label/
    );

    assert.doesNotMatch(
      source,
      /progressElement\.innerHTML/
    );
  }
);
