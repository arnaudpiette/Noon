"use strict";

const test =
  require("node:test");

const assert =
  require("node:assert/strict");

const {
  createUserProgressEngine,
} = require(
  "../services/observability/user-progress-engine"
);

const {
  createUserProgressAdapter,
} = require(
  "../services/observability/user-progress-adapter"
);

const {
  createOrchestratorProgressObservability,
} = require(
  "../services/observability/orchestrator-progress-observability"
);

function fixture() {
  const calls = [];

  const observability = {
    startExecution(value) {
      calls.push([
        "startExecution",
        value,
      ]);

      return "START";
    },

    recordContext(...args) {
      calls.push([
        "recordContext",
        ...args,
      ]);
    },

    recordRouting(...args) {
      calls.push([
        "recordRouting",
        ...args,
      ]);
    },

    recordTool(...args) {
      calls.push([
        "recordTool",
        ...args,
      ]);
    },

    recordApproval(...args) {
      calls.push([
        "recordApproval",
        ...args,
      ]);
    },

    completeExecution(...args) {
      calls.push([
        "completeExecution",
        ...args,
      ]);

      return "COMPLETE";
    },

    failExecution(...args) {
      calls.push([
        "failExecution",
        ...args,
      ]);

      return "FAILED";
    },

    recordModelCall() {
      return "MODEL";
    },
  };

  const progressEngine =
    createUserProgressEngine();

  const progressAdapter =
    createUserProgressAdapter({
      progressEngine,
    });

  const decorated =
    createOrchestratorProgressObservability({
      observability,
      progressAdapter,
    });

  return {
    calls,
    decorated,
    progressEngine,
  };
}

test(
  "conserve les méthodes techniques non décorées",
  () => {
    const f = fixture();

    assert.equal(
      f.decorated.recordModelCall(),
      "MODEL",
    );
  },
);

test(
  "projette contexte et routage sans casser NoonObservability",
  () => {
    const f = fixture();

    f.decorated.startExecution({
      executionId: "exec-1",
    });

    f.decorated.recordContext(
      "exec-1",
      {
        contextBuildMs: 10,
      },
    );

    f.decorated.recordRouting(
      "exec-1",
      {
        model: "test",
      },
    );

    const events =
      f.progressEngine.list(
        "exec-1",
      );

    assert.equal(
      events[0].state,
      "PLANNED",
    );

    assert.equal(
      events.at(-1).state,
      "RUNNING",
    );

    assert.equal(
      events.at(-1).phase,
      "PLAN",
    );

    assert.ok(
      f.calls.some(
        ([name]) =>
          name ===
          "recordContext",
      ),
    );
  },
);

test(
  "approval requise devient WAITING APPROVAL",
  () => {
    const f = fixture();

    f.decorated.recordApproval(
      "exec-approval",
      {
        approvalId: "a-1",
        status: "required",
      },
    );

    const event =
      f.progressEngine.latest(
        "exec-approval",
      );

    assert.equal(
      event.state,
      "WAITING",
    );

    assert.equal(
      event.phase,
      "APPROVAL",
    );
  },
);

test(
  "approval outil consommée reprend l'exécution sans faux succès",
  () => {
    const f = fixture();

    f.decorated.recordApproval(
      "exec-tool",
      {
        approvalId: "a-1",
        status: "consumed",
      },
    );

    const event =
      f.progressEngine.latest(
        "exec-tool",
      );

    assert.equal(
      event.state,
      "RUNNING",
    );

    assert.equal(
      event.phase,
      "ACTION",
    );
  },
);

test(
  "approval spécialiste consommée termine le workflow",
  () => {
    const f = fixture();

    f.decorated.recordApproval(
      "exec-proposal",
      {
        approvalId: "a-1",
        proposalId:
          "proposal-1",
        status: "consumed",
      },
    );

    const event =
      f.progressEngine.latest(
        "exec-proposal",
      );

    assert.equal(
      event.state,
      "SUCCEEDED",
    );

    assert.equal(
      event.progress,
      100,
    );
  },
);

test(
  "rejet d'une proposition spécialiste est un workflow terminé sans action",
  () => {
    const f = fixture();

    f.decorated.recordApproval(
      "exec-proposal-reject",
      {
        approvalId: "a-2",
        proposalId:
          "proposal-2",
        status: "rejected",
      },
    );

    assert.equal(
      f.progressEngine.latest(
        "exec-proposal-reject",
      ).state,
      "SUCCEEDED",
    );
  },
);

test(
  "approval stale reste BLOCKED et non completed",
  () => {
    const f = fixture();

    f.decorated.recordApproval(
      "exec-stale",
      {
        status: "stale",
      },
    );

    const event =
      f.progressEngine.latest(
        "exec-stale",
      );

    assert.equal(
      event.state,
      "BLOCKED",
    );

    assert.equal(
      event.reasonCode,
      "APPROVAL_STALE",
    );
  },
);

test(
  "completion et échec sont terminaux",
  () => {
    const f = fixture();

    assert.equal(
      f.decorated.completeExecution(
        "exec-ok",
        {
          status: "completed",
        },
      ),
      "COMPLETE",
    );

    assert.equal(
      f.progressEngine.latest(
        "exec-ok",
      ).state,
      "SUCCEEDED",
    );

    const error =
      Object.assign(
        new Error(
          "SECRET_ERROR_MESSAGE",
        ),
        {
          code:
            "MODEL_UNAVAILABLE",
        },
      );

    assert.equal(
      f.decorated.failExecution(
        "exec-fail",
        error,
        {},
      ),
      "FAILED",
    );

    const event =
      f.progressEngine.latest(
        "exec-fail",
      );

    assert.equal(
      event.state,
      "FAILED",
    );

    assert.equal(
      event.reasonCode,
      "MODEL_UNAVAILABLE",
    );

    assert.doesNotMatch(
      JSON.stringify(event),
      /SECRET_ERROR_MESSAGE/,
    );
  },
);
