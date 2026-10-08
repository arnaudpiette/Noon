"use strict";

const assert =
  require("node:assert/strict");

const test =
  require("node:test");

const {
  AGENT_EVALUATION_POLICY_VERSION,
  createAgentEvaluationEngine,
} = require(
  "../services/evaluation/agent-evaluation-engine"
);

function engine() {
  return createAgentEvaluationEngine();
}

test(
  "PASS exige des preuves fiables et les critères satisfaits",
  () => {
    const result =
      engine().evaluate({
        executionId: "exec-pass",
        executionStatus:
          "SUCCEEDED",
        requiredEvidenceIds: [
          "tests",
          "build",
        ],
        evidence: [
          {
            id: "tests",
            status: "PASS",
            authority:
              "DETERMINISTIC",
            critical: true,
          },
          {
            id: "build",
            status: "PASS",
            authority:
              "DETERMINISTIC",
            critical: true,
          },
        ],
        criteria: [
          {
            id: "requested-change",
            status: "PASS",
            required: true,
          },
        ],
      });

    assert.equal(
      result.verdict,
      "PASS"
    );

    assert.equal(
      result.confidence,
      "HIGH"
    );

    assert.equal(
      result
        .evaluationPolicyVersion,
      AGENT_EVALUATION_POLICY_VERSION
    );
  }
);

test(
  "un FAIL déterministe critique interdit toujours PASS",
  () => {
    const result =
      engine().evaluate({
        taskId: "task-fail",
        executionStatus:
          "SUCCEEDED",
        requiredEvidenceIds: [
          "tests",
        ],
        evidence: [
          {
            id: "tests",
            status: "FAIL",
            authority:
              "DETERMINISTIC",
            critical: true,
          },
          {
            id: "agent-claim",
            status: "PASS",
            authority: "AGENT",
          },
        ],
      });

    assert.equal(
      result.verdict,
      "FAIL"
    );

    assert.ok(
      result.reasonCodes.includes(
        "CRITICAL_EVIDENCE_FAILED"
      )
    );
  }
);

test(
  "le succès déclaré par l'agent ne satisfait jamais une preuve requise",
  () => {
    const result =
      engine().evaluate({
        taskId:
          "task-agent-claim",
        executionStatus:
          "SUCCEEDED",
        requiredEvidenceIds: [
          "tests",
        ],
        evidence: [
          {
            id: "tests",
            status: "PASS",
            authority: "AGENT",
          },
        ],
      });

    assert.equal(
      result.verdict,
      "INSUFFICIENT_EVIDENCE"
    );

    assert.equal(
      result
        .evidenceSummary
        .requiredSatisfied,
      0
    );
  }
);

test(
  "une preuve obligatoire absente produit INSUFFICIENT_EVIDENCE",
  () => {
    const result =
      engine().evaluate({
        taskId:
          "task-missing",
        executionStatus:
          "SUCCEEDED",
        requiredEvidenceIds: [
          "tests",
          "build",
        ],
        evidence: [
          {
            id: "tests",
            status: "PASS",
            authority:
              "DETERMINISTIC",
          },
        ],
      });

    assert.equal(
      result.verdict,
      "INSUFFICIENT_EVIDENCE"
    );

    assert.ok(
      result.reasonCodes.includes(
        "REQUIRED_EVIDENCE_MISSING"
      )
    );
  }
);

test(
  "UNKNOWN_OUTCOME ne devient jamais un succès",
  () => {
    const result =
      engine().evaluate({
        taskId:
          "task-unknown",
        executionStatus:
          "UNKNOWN_OUTCOME",
        evidence: [
          {
            id: "provider",
            status: "PASS",
            authority: "SYSTEM",
          },
        ],
      });

    assert.equal(
      result.verdict,
      "INSUFFICIENT_EVIDENCE"
    );

    assert.ok(
      result.reasonCodes.includes(
        "EXECUTION_OUTCOME_UNKNOWN"
      )
    );
  }
);

test(
  "une exécution FAILED donne FAIL même si les validations semblent vertes",
  () => {
    const result =
      engine().evaluate({
        taskId:
          "task-execution-fail",
        executionStatus:
          "FAILED",
        evidence: [
          {
            id: "tests",
            status: "PASS",
            authority:
              "DETERMINISTIC",
          },
        ],
      });

    assert.equal(
      result.verdict,
      "FAIL"
    );

    assert.ok(
      result.reasonCodes.includes(
        "EXECUTION_FAILED"
      )
    );
  }
);

test(
  "un critère obligatoire en échec interdit PASS",
  () => {
    const result =
      engine().evaluate({
        taskId:
          "task-criterion-fail",
        executionStatus:
          "SUCCEEDED",
        evidence: [
          {
            id: "tests",
            status: "PASS",
            authority:
              "DETERMINISTIC",
          },
        ],
        criteria: [
          {
            id: "contract",
            status: "FAIL",
            required: true,
          },
        ],
      });

    assert.equal(
      result.verdict,
      "FAIL"
    );
  }
);

test(
  "un critère obligatoire inconnu donne une preuve insuffisante",
  () => {
    const result =
      engine().evaluate({
        taskId:
          "task-criterion-unknown",
        executionStatus:
          "SUCCEEDED",
        evidence: [
          {
            id: "tests",
            status: "PASS",
            authority:
              "DETERMINISTIC",
          },
        ],
        criteria: [
          {
            id: "business",
            status: "UNKNOWN",
            required: true,
          },
        ],
      });

    assert.equal(
      result.verdict,
      "INSUFFICIENT_EVIDENCE"
    );
  }
);

test(
  "warning ou résultat partiel produit PARTIAL sans inventer un échec critique",
  () => {
    const result =
      engine().evaluate({
        taskId:
          "task-partial",
        executionStatus:
          "PARTIAL",
        evidence: [
          {
            id: "tests",
            status: "PASS",
            authority:
              "DETERMINISTIC",
          },
          {
            id: "quality",
            status: "WARNING",
            authority: "SYSTEM",
          },
        ],
      });

    assert.equal(
      result.verdict,
      "PARTIAL"
    );

    assert.equal(
      result.confidence,
      "MEDIUM"
    );
  }
);

test(
  "aucune preuve ni critère ne peut produire PASS",
  () => {
    const result =
      engine().evaluate({
        taskId:
          "task-empty",
        executionStatus:
          "SUCCEEDED",
      });

    assert.equal(
      result.verdict,
      "INSUFFICIENT_EVIDENCE"
    );
  }
);

test(
  "la sortie reste bornée à des métadonnées et ne recopie aucun contenu brut",
  () => {
    const result =
      engine().evaluate({
        taskId:
          "task-privacy",
        executionStatus:
          "SUCCEEDED",
        evidence: [
          {
            id: "tests",
            status: "PASS",
            authority:
              "DETERMINISTIC",
            critical: true,
            reasonCode:
              "TESTS_OK",
            content:
              "SECRET RAW CONTENT",
            prompt:
              "PRIVATE PROMPT",
          },
        ],
      });

    const serialized =
      JSON.stringify(result);

    assert.equal(
      serialized.includes(
        "SECRET RAW CONTENT"
      ),
      false
    );

    assert.equal(
      serialized.includes(
        "PRIVATE PROMPT"
      ),
      false
    );
  }
);

test(
  "les statuts ou autorités inconnus sont refusés",
  () => {
    assert.throws(
      () =>
        engine().evaluate({
          taskId: "invalid-1",
          evidence: [
            {
              id: "x",
              status:
                "MAGIC_SUCCESS",
              authority:
                "DETERMINISTIC",
            },
          ],
        }),
      /Statut evidence invalide/
    );

    assert.throws(
      () =>
        engine().evaluate({
          taskId: "invalid-2",
          evidence: [
            {
              id: "x",
              status: "PASS",
              authority:
                "MODEL_SUPREME",
            },
          ],
        }),
      /Autorité evidence invalide/
    );
  }
);
