"use strict";
const { readAppSource } = require("./helpers/app-source");
const { readServerSource } = require("./helpers/server-source");

const assert =
  require("node:assert/strict");

const test =
  require("node:test");

const {
  toChatProgressEvent,
} = require(
  "../services/observability/chat-progress-event"
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
    const source = readServerSource();

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
      readAppSource();

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
