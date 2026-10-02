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

function fixture() {
  const progressEngine =
    createUserProgressEngine({
      now:
        () =>
          Date.parse(
            "2026-10-02T08:30:00.000Z",
          ),
    });

  const adapter =
    createUserProgressAdapter({
      progressEngine,
    });

  return {
    progressEngine,
    adapter,
  };
}

test(
  "transactional projette exécution et succès",
  () => {
    const f = fixture();

    f.adapter.transactional(
      "execution_step_started",
      {
        executionId:
          "execution-tx",
        stepId: "step-1",
      },
    );

    f.adapter.transactional(
      "execution_completed",
      {
        executionId:
          "execution-tx",
      },
    );

    const events =
      f.progressEngine.list(
        "execution-tx",
      );

    assert.equal(
      events.length,
      2,
    );

    assert.equal(
      events[0].state,
      "RUNNING",
    );

    assert.equal(
      events[0].phase,
      "ACTION",
    );

    assert.equal(
      events[1].state,
      "SUCCEEDED",
    );

    assert.equal(
      events[1].progress,
      100,
    );
  },
);

test(
  "transactional projette approval et unknown outcome",
  () => {
    const f = fixture();

    f.adapter.transactional(
      "execution_awaiting_approval",
      {
        executionId:
          "execution-blocked",
      },
    );

    let event =
      f.progressEngine.latest(
        "execution-blocked",
      );

    assert.equal(
      event.state,
      "WAITING",
    );

    assert.equal(
      event.phase,
      "APPROVAL",
    );

    f.adapter.transactional(
      "execution_unknown_outcome",
      {
        executionId:
          "execution-blocked",
      },
    );

    event =
      f.progressEngine.latest(
        "execution-blocked",
      );

    assert.equal(
      event.state,
      "BLOCKED",
    );

    assert.equal(
      event.phase,
      "RECOVERY",
    );

    assert.equal(
      event.reasonCode,
      "UNKNOWN_OUTCOME",
    );
  },
);

test(
  "background job projette queue retry progression et succès",
  () => {
    const f = fixture();

    f.adapter.backgroundJob(
      "job_enqueued",
      {
        jobId: "job-1",
      },
    );

    f.adapter.backgroundJob(
      "job_retry_scheduled",
      {
        jobId: "job-1",
        code: "ETIMEDOUT",
      },
    );

    f.adapter.backgroundJob(
      "job_progress",
      {
        jobId: "job-1",
        progress: 50,
      },
    );

    f.adapter.backgroundJob(
      "job_succeeded",
      {
        jobId: "job-1",
      },
    );

    const events =
      f.progressEngine.list(
        "job-1",
      );

    assert.deepEqual(
      events.map(
        (event) =>
          event.state,
      ),
      [
        "PLANNED",
        "WAITING",
        "RUNNING",
        "SUCCEEDED",
      ],
    );

    assert.equal(
      events[1].reasonCode,
      "ETIMEDOUT",
    );

    assert.equal(
      events[2].progress,
      50,
    );
  },
);

test(
  "DEV Agent projette action validation et fin",
  () => {
    const f = fixture();

    f.adapter.devAgent(
      "action_started",
      {
        executionId:
          "dev-execution-1",
      },
    );

    f.adapter.devAgent(
      "validation_started",
      {
        executionId:
          "dev-execution-1",
      },
    );

    f.adapter.devAgent(
      "execution_completed",
      {
        executionId:
          "dev-execution-1",
      },
    );

    const events =
      f.progressEngine.list(
        "dev-execution-1",
      );

    assert.deepEqual(
      events.map(
        (event) =>
          event.phase,
      ),
      [
        "ACTION",
        "VALIDATION",
        "FINALIZE",
      ],
    );

    assert.equal(
      events.at(-1).state,
      "SUCCEEDED",
    );
  },
);

test(
  "DEV Agent conserve approval et annulation",
  () => {
    const f = fixture();

    f.adapter.devAgent(
      "approval_required",
      {
        executionId:
          "dev-approval",
      },
    );

    assert.equal(
      f.progressEngine.latest(
        "dev-approval",
      ).state,
      "WAITING",
    );

    f.adapter.devAgent(
      "execution_cancelled",
      {
        executionId:
          "dev-approval",
      },
    );

    assert.equal(
      f.progressEngine.latest(
        "dev-approval",
      ).state,
      "CANCELLED",
    );
  },
);

test(
  "événement inconnu ou sans id ignoré",
  () => {
    const f = fixture();

    assert.equal(
      f.adapter.transactional(
        "unrelated_event",
        {
          executionId:
            "execution-ignore",
        },
      ).ignored,
      true,
    );

    assert.equal(
      f.adapter.devAgent(
        "execution_completed",
        {},
      ).ignored,
      true,
    );

    assert.equal(
      f.progressEngine.list(
        "execution-ignore",
      ).length,
      0,
    );
  },
);

test(
  "aucun contenu brut n'est projeté",
  () => {
    const captured = [];

    const adapter =
      createUserProgressAdapter({
        progressEngine: {
          publish(event) {
            captured.push(event);

            return {
              emitted: true,
              event,
            };
          },
        },
      });

    adapter.transactional(
      "execution_step_started",
      {
        executionId:
          "execution-private",
        stepId: "step-1",

        rawPrompt:
          "SECRET_PROMPT",

        output:
          "SECRET_OUTPUT",

        args: {
          password:
            "SECRET_PASSWORD",
        },

        message:
          "SECRET_MESSAGE",
      },
    );

    const serialized =
      JSON.stringify(captured);

    assert.doesNotMatch(
      serialized,
      /SECRET_/,
    );

    assert.deepEqual(
      Object.keys(
        captured[0],
      ).sort(),
      [
        "currentStep",
        "executionId",
        "phase",
        "progress",
        "source",
        "state",
        "stepId",
        "totalSteps",
      ].sort(),
    );
  },
);

test(
  "une erreur de projection n'interrompt jamais le moteur métier",
  () => {
    const adapter =
      createUserProgressAdapter({
        progressEngine: {
          publish() {
            const error =
              new Error(
                "invalid event",
              );

            error.code =
              "PROGRESS_TEST_ERROR";

            throw error;
          },
        },
      });

    const result =
      adapter.devAgent(
        "execution_completed",
        {
          executionId:
            "dev-safe",
        },
      );

    assert.equal(
      result.ignored,
      true,
    );

    assert.equal(
      result.reason,
      "PROGRESS_EVENT_REJECTED",
    );

    assert.equal(
      result.errorCode,
      "PROGRESS_TEST_ERROR",
    );
  },
);


test(
  "une compensation terminée ne devient jamais un succès global",
  () => {
    const f = fixture();

    f.adapter.transactional(
      "execution_compensation_completed",
      {
        executionId:
          "execution-compensation",
        stepId: "step-1",
      },
    );

    const event =
      f.progressEngine.latest(
        "execution-compensation",
      );

    assert.equal(
      event.state,
      "RUNNING",
    );

    assert.equal(
      event.phase,
      "RECOVERY",
    );
  },
);

test(
  "un résultat transactionnel PARTIAL devient terminal sans faux succès",
  () => {
    const f = fixture();

    f.adapter.transactional(
      "execution_partial",
      {
        executionId:
          "execution-partial",
      },
    );

    const event =
      f.progressEngine.latest(
        "execution-partial",
      );

    assert.equal(
      event.state,
      "FAILED",
    );

    assert.equal(
      event.reasonCode,
      "PARTIAL_RESULT",
    );
  },
);

test(
  "l'approval réelle du DEV loop reste WAITING malgré execution_failed",
  () => {
    const f = fixture();

    f.adapter.devAgent(
      "execution_failed",
      {
        executionId:
          "dev-real-approval",
        phase: "STOP",
        reason:
          "APPROVAL_REQUIRED",
      },
    );

    const event =
      f.progressEngine.latest(
        "dev-real-approval",
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
  "execution_started du DEV loop reste une phase PLAN",
  () => {
    const f = fixture();

    f.adapter.devAgent(
      "execution_started",
      {
        executionId:
          "dev-plan",
        phase: "PLAN",
      },
    );

    assert.equal(
      f.progressEngine.latest(
        "dev-plan",
      ).phase,
      "PLAN",
    );
  },
);

test(
  "job_failed UNKNOWN_OUTCOME devient BLOCKED RECOVERY",
  () => {
    const f = fixture();

    f.adapter.backgroundJob(
      "job_failed",
      {
        jobId:
          "job-unknown",
        code:
          "UNKNOWN_OUTCOME",
      },
    );

    const event =
      f.progressEngine.latest(
        "job-unknown",
      );

    assert.equal(
      event.state,
      "BLOCKED",
    );

    assert.equal(
      event.phase,
      "RECOVERY",
    );
  },
);
