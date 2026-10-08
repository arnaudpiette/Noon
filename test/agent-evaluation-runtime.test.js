"use strict";

const assert =
  require("node:assert/strict");

const test =
  require("node:test");

const {
  createAgentEvaluationEngine,
} = require(
  "../services/evaluation/agent-evaluation-engine"
);

const {
  attachAgentEvaluation,
  createAgentEvaluationRuntime,
} = require(
  "../services/evaluation/agent-evaluation-runtime"
);

function engine() {
  return createAgentEvaluationEngine();
}

test(
  "un résultat conversationnel sans preuve agentique reste inchangé",
  () => {
    const result = {
      executionId: "exec-chat",
      status: "completed",
      text: "Bonjour",
    };

    assert.deepEqual(
      attachAgentEvaluation(
        result,
        { engine: engine() }
      ),
      result
    );
  }
);

test(
  "un tool call réussi devient une preuve système PASS",
  () => {
    const result =
      attachAgentEvaluation(
        {
          executionId:
            "exec-tool-pass",
          status: "completed",
          toolCalls: [
            {
              name: "write_file",
              callId: "call-1",
              status: "succeeded",
            },
          ],
        },
        { engine: engine() }
      );

    assert.equal(
      result.metadata
        .agentEvaluation
        .verdict,
      "PASS"
    );

    assert.equal(
      result.metadata
        .agentEvaluation
        .evidenceSummary
        .requiredSatisfied,
      1
    );
  }
);

test(
  "un tool call en échec interdit PASS",
  () => {
    const result =
      attachAgentEvaluation(
        {
          executionId:
            "exec-tool-fail",
          status: "failed",
          toolCalls: [
            {
              name: "write_file",
              callId: "call-1",
              status: "failed",
            },
          ],
        },
        { engine: engine() }
      );

    assert.equal(
      result.metadata
        .agentEvaluation
        .verdict,
      "FAIL"
    );
  }
);

test(
  "un résultat en attente d'approbation n'est pas évalué",
  () => {
    const result = {
      executionId:
        "exec-approval",
      status:
        "approval_required",
      __approvalRequired: true,
      toolCalls: [],
    };

    const evaluated =
      attachAgentEvaluation(
        result,
        { engine: engine() }
      );

    assert.equal(
      evaluated.metadata,
      undefined
    );
  }
);

test(
  "un résultat DEV PASS exige ses validations et son diff",
  () => {
    const result =
      attachAgentEvaluation(
        {
          taskId: "dev-pass",
          finalVerdict: "PASS",
          validations: [
            {
              command:
                "npm test",
              status: "PASS",
            },
            {
              command:
                "git diff --check",
              status: "PASS",
            },
          ],
          diffReview: {
            valid: true,
            issues: [],
          },
          preExistingChangesPreserved:
            true,
        },
        { engine: engine() }
      );

    assert.equal(
      result.metadata
        .agentEvaluation
        .verdict,
      "PASS"
    );
  }
);

test(
  "un résultat DEV annoncé PASS mais avec validation rouge devient FAIL",
  () => {
    const result =
      attachAgentEvaluation(
        {
          taskId:
            "dev-invalid-pass",
          finalVerdict: "PASS",
          validations: [
            {
              command:
                "npm test",
              status: "FAIL",
              reasonCode:
                "VALIDATION_FAILURE",
            },
          ],
          diffReview: {
            valid: true,
          },
        },
        { engine: engine() }
      );

    assert.equal(
      result.metadata
        .agentEvaluation
        .verdict,
      "FAIL"
    );
  }
);

test(
  "un finalVerdict sans preuve indépendante ne peut pas produire PASS",
  () => {
    const result =
      attachAgentEvaluation(
        {
          taskId:
            "dev-claim-only",
          finalVerdict: "PASS",
        },
        { engine: engine() }
      );

    assert.equal(
      result.metadata
        .agentEvaluation
        .verdict,
      "INSUFFICIENT_EVIDENCE"
    );
  }
);

test(
  "run et resume passent tous deux par le même évaluateur",
  async () => {
    const calls = [];

    const orchestrator = {
      async run() {
        calls.push("run");

        return {
          executionId:
            "exec-run",
          status: "completed",
          toolCalls: [
            {
              callId: "r1",
              status:
                "succeeded",
            },
          ],
        };
      },

      async resume() {
        calls.push("resume");

        return {
          executionId:
            "exec-resume",
          status: "completed",
          toolCalls: [
            {
              callId: "r2",
              status:
                "succeeded",
            },
          ],
        };
      },

      pendingExecutions() {
        return ["pending-1"];
      },
    };

    const runtime =
      createAgentEvaluationRuntime({
        orchestrator,
        engine: engine(),
      });

    const runResult =
      await runtime.run({});

    const resumeResult =
      await runtime.resume({});

    assert.equal(
      runResult.metadata
        .agentEvaluation
        .verdict,
      "PASS"
    );

    assert.equal(
      resumeResult.metadata
        .agentEvaluation
        .verdict,
      "PASS"
    );

    assert.deepEqual(
      runtime.pendingExecutions(),
      ["pending-1"]
    );

    assert.deepEqual(
      calls,
      ["run", "resume"]
    );
  }
);

test(
  "l'observabilité ne reçoit que des métadonnées bornées",
  () => {
    const events = [];

    attachAgentEvaluation(
      {
        executionId:
          "exec-private",
        status: "completed",
        toolCalls: [
          {
            callId: "x",
            status:
              "succeeded",
            rawContent:
              "SECRET CONTENT",
          },
        ],
        text:
          "PRIVATE RESPONSE",
      },
      {
        engine: engine(),

        observability(
          event,
          metadata
        ) {
          events.push({
            event,
            metadata,
          });
        },
      }
    );

    const serialized =
      JSON.stringify(events);

    assert.equal(
      events[0].event,
      "evaluated"
    );

    assert.equal(
      serialized.includes(
        "SECRET CONTENT"
      ),
      false
    );

    assert.equal(
      serialized.includes(
        "PRIVATE RESPONSE"
      ),
      false
    );
  }
);
