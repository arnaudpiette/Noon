"use strict";

const AGENT_EVALUATION_POLICY_VERSION =
  "agent-evaluation-v1";

const VERDICTS = Object.freeze({
  PASS: "PASS",
  PARTIAL: "PARTIAL",
  FAIL: "FAIL",
  INSUFFICIENT_EVIDENCE:
    "INSUFFICIENT_EVIDENCE",
});

const CONFIDENCE = Object.freeze({
  HIGH: "HIGH",
  MEDIUM: "MEDIUM",
  LOW: "LOW",
});

const EVIDENCE_STATUSES =
  new Set([
    "PASS",
    "WARNING",
    "FAIL",
    "UNKNOWN",
    "SKIPPED",
  ]);

const CRITERION_STATUSES =
  new Set([
    "PASS",
    "PARTIAL",
    "FAIL",
    "UNKNOWN",
  ]);

const AUTHORITIES =
  new Set([
    "DETERMINISTIC",
    "SYSTEM",
    "HUMAN",
    "AGENT",
  ]);

const TRUSTED_AUTHORITIES =
  new Set([
    "DETERMINISTIC",
    "SYSTEM",
    "HUMAN",
  ]);

const EXECUTION_STATUSES =
  new Set([
    "SUCCEEDED",
    "PARTIAL",
    "FAILED",
    "UNKNOWN_OUTCOME",
    "CANCELLED",
    "INTERRUPTED",
    "TIMEOUT",
  ]);

function clean(value, max = 120) {
  return String(value ?? "")
    .replace(/[\0\r\n]/g, " ")
    .trim()
    .slice(0, max);
}

function unique(values) {
  return [...new Set(values)];
}

function normalizeEvidence(item, index) {
  if (!item || typeof item !== "object") {
    throw new TypeError(
      `Evidence ${index} invalide.`
    );
  }

  const id = clean(item.id, 120);

  if (!id) {
    throw new TypeError(
      `Evidence ${index} sans id.`
    );
  }

  const status =
    clean(item.status, 40)
      .toUpperCase();

  if (!EVIDENCE_STATUSES.has(status)) {
    throw new TypeError(
      `Statut evidence invalide : ${status}`
    );
  }

  const authority =
    clean(
      item.authority ||
        "AGENT",
      40
    ).toUpperCase();

  if (!AUTHORITIES.has(authority)) {
    throw new TypeError(
      `Autorité evidence invalide : ${authority}`
    );
  }

  return {
    id,
    status,
    authority,
    critical:
      item.critical === true,
    reasonCode:
      clean(
        item.reasonCode,
        80
      ) || null,
  };
}

function normalizeCriterion(
  item,
  index
) {
  if (!item || typeof item !== "object") {
    throw new TypeError(
      `Critère ${index} invalide.`
    );
  }

  const id =
    clean(item.id, 120);

  if (!id) {
    throw new TypeError(
      `Critère ${index} sans id.`
    );
  }

  const status =
    clean(item.status, 40)
      .toUpperCase();

  if (!CRITERION_STATUSES.has(status)) {
    throw new TypeError(
      `Statut critère invalide : ${status}`
    );
  }

  return {
    id,
    status,
    required:
      item.required !== false,
    reasonCode:
      clean(
        item.reasonCode,
        80
      ) || null,
  };
}

function createAgentEvaluationEngine() {
  function evaluate(input = {}) {
    const executionId =
      clean(
        input.executionId ||
          input.taskId,
        160
      );

    if (!executionId) {
      throw new TypeError(
        "executionId ou taskId requis."
      );
    }

    const executionStatus =
      clean(
        input.executionStatus,
        40
      ).toUpperCase();

    if (
      executionStatus &&
      !EXECUTION_STATUSES.has(
        executionStatus
      )
    ) {
      throw new TypeError(
        `Statut execution invalide : ${executionStatus}`
      );
    }

    const evidence =
      (input.evidence || [])
        .map(normalizeEvidence);

    const criteria =
      (input.criteria || [])
        .map(normalizeCriterion);

    const requiredEvidenceIds =
      unique(
        (
          input.requiredEvidenceIds ||
          []
        )
          .map((value) =>
            clean(value, 120)
          )
          .filter(Boolean)
      );

    const evidenceById =
      new Map(
        evidence.map(
          (item) => [
            item.id,
            item,
          ]
        )
      );

    const reasonCodes = [];

    const fail = (code) => {
      reasonCodes.push(code);
    };

    /*
     * L'état réel de l'exécution est
     * supérieur à toute déclaration
     * de succès de l'agent.
     */
    if (
      executionStatus ===
        "FAILED" ||
      executionStatus ===
        "TIMEOUT"
    ) {
      fail(
        executionStatus ===
          "TIMEOUT"
          ? "EXECUTION_TIMEOUT"
          : "EXECUTION_FAILED"
      );
    }

    const criticalFailures =
      evidence.filter(
        (item) =>
          item.critical &&
          item.status ===
            "FAIL" &&
          TRUSTED_AUTHORITIES.has(
            item.authority
          )
      );

    if (criticalFailures.length) {
      fail(
        "CRITICAL_EVIDENCE_FAILED"
      );
    }

    const failedRequiredCriteria =
      criteria.filter(
        (item) =>
          item.required &&
          item.status === "FAIL"
      );

    if (
      failedRequiredCriteria.length
    ) {
      fail(
        "REQUIRED_CRITERION_FAILED"
      );
    }

    if (reasonCodes.length) {
      return {
        evaluationPolicyVersion:
          AGENT_EVALUATION_POLICY_VERSION,
        executionId,
        verdict:
          VERDICTS.FAIL,
        confidence:
          CONFIDENCE.HIGH,
        reasonCodes:
          unique(reasonCodes),
        evidenceSummary:
          summarizeEvidence(
            evidence,
            requiredEvidenceIds
          ),
        criteriaSummary:
          summarizeCriteria(
            criteria
          ),
      };
    }

    /*
     * Une preuve obligatoire ne peut
     * être satisfaite que par une
     * autorité indépendante de l'agent.
     */
    const missingRequiredEvidence =
      requiredEvidenceIds.filter(
        (id) => {
          const item =
            evidenceById.get(id);

          return (
            !item ||
            item.status !==
              "PASS" ||
            !TRUSTED_AUTHORITIES.has(
              item.authority
            )
          );
        }
      );

    const unknownRequiredCriteria =
      criteria.filter(
        (item) =>
          item.required &&
          item.status ===
            "UNKNOWN"
      );

    if (
      executionStatus ===
        "UNKNOWN_OUTCOME" ||
      missingRequiredEvidence.length ||
      unknownRequiredCriteria.length ||
      (
        evidence.length === 0 &&
        criteria.length === 0
      )
    ) {
      if (
        executionStatus ===
        "UNKNOWN_OUTCOME"
      ) {
        fail(
          "EXECUTION_OUTCOME_UNKNOWN"
        );
      }

      if (
        missingRequiredEvidence.length
      ) {
        fail(
          "REQUIRED_EVIDENCE_MISSING"
        );
      }

      if (
        unknownRequiredCriteria.length
      ) {
        fail(
          "REQUIRED_CRITERION_UNKNOWN"
        );
      }

      if (
        evidence.length === 0 &&
        criteria.length === 0
      ) {
        fail(
          "NO_EVIDENCE"
        );
      }

      return {
        evaluationPolicyVersion:
          AGENT_EVALUATION_POLICY_VERSION,
        executionId,
        verdict:
          VERDICTS
            .INSUFFICIENT_EVIDENCE,
        confidence:
          CONFIDENCE.LOW,
        reasonCodes:
          unique(reasonCodes),
        evidenceSummary:
          summarizeEvidence(
            evidence,
            requiredEvidenceIds
          ),
        criteriaSummary:
          summarizeCriteria(
            criteria
          ),
      };
    }

    const partial =
      [
        "PARTIAL",
        "CANCELLED",
        "INTERRUPTED",
      ].includes(
        executionStatus
      ) ||
      evidence.some(
        (item) =>
          item.status ===
            "WARNING" ||
          item.status ===
            "FAIL" ||
          item.status ===
            "UNKNOWN" ||
          item.status ===
            "SKIPPED"
      ) ||
      criteria.some(
        (item) =>
          item.status ===
            "PARTIAL"
      );

    if (partial) {
      return {
        evaluationPolicyVersion:
          AGENT_EVALUATION_POLICY_VERSION,
        executionId,
        verdict:
          VERDICTS.PARTIAL,
        confidence:
          CONFIDENCE.MEDIUM,
        reasonCodes: [
          "PARTIAL_EVIDENCE",
        ],
        evidenceSummary:
          summarizeEvidence(
            evidence,
            requiredEvidenceIds
          ),
        criteriaSummary:
          summarizeCriteria(
            criteria
          ),
      };
    }

    return {
      evaluationPolicyVersion:
        AGENT_EVALUATION_POLICY_VERSION,
      executionId,
      verdict:
        VERDICTS.PASS,
      confidence:
        CONFIDENCE.HIGH,
      reasonCodes: [],
      evidenceSummary:
        summarizeEvidence(
          evidence,
          requiredEvidenceIds
        ),
      criteriaSummary:
        summarizeCriteria(
          criteria
        ),
    };
  }

  return {
    evaluate,
  };
}

function summarizeEvidence(
  evidence,
  requiredEvidenceIds
) {
  const trusted =
    evidence.filter(
      (item) =>
        TRUSTED_AUTHORITIES.has(
          item.authority
        )
    );

  const trustedPassIds =
    new Set(
      trusted
        .filter(
          (item) =>
            item.status ===
            "PASS"
        )
        .map(
          (item) => item.id
        )
    );

  return {
    total:
      evidence.length,
    trusted:
      trusted.length,
    agentProvided:
      evidence.filter(
        (item) =>
          item.authority ===
          "AGENT"
      ).length,
    pass:
      evidence.filter(
        (item) =>
          item.status ===
          "PASS"
      ).length,
    warning:
      evidence.filter(
        (item) =>
          item.status ===
          "WARNING"
      ).length,
    fail:
      evidence.filter(
        (item) =>
          item.status ===
          "FAIL"
      ).length,
    unknown:
      evidence.filter(
        (item) =>
          [
            "UNKNOWN",
            "SKIPPED",
          ].includes(
            item.status
          )
      ).length,
    required:
      requiredEvidenceIds.length,
    requiredSatisfied:
      requiredEvidenceIds.filter(
        (id) =>
          trustedPassIds.has(id)
      ).length,
  };
}

function summarizeCriteria(
  criteria
) {
  return {
    total:
      criteria.length,
    required:
      criteria.filter(
        (item) =>
          item.required
      ).length,
    pass:
      criteria.filter(
        (item) =>
          item.status ===
          "PASS"
      ).length,
    partial:
      criteria.filter(
        (item) =>
          item.status ===
          "PARTIAL"
      ).length,
    fail:
      criteria.filter(
        (item) =>
          item.status ===
          "FAIL"
      ).length,
    unknown:
      criteria.filter(
        (item) =>
          item.status ===
          "UNKNOWN"
      ).length,
  };
}

module.exports = {
  AGENT_EVALUATION_POLICY_VERSION,
  CONFIDENCE,
  VERDICTS,
  createAgentEvaluationEngine,
};
