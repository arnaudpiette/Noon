"use strict";

const {
  projectAgentEvaluationEvidence,
} = require(
  "../decision/agent-evaluation-evidence-adapter"
);

function clean(value, max = 120) {
  return String(value ?? "")
    .replace(/[\0\r\n]/g, " ")
    .trim()
    .slice(0, max);
}

function normalizeEvidenceStatus(value) {
  const status = clean(value, 40).toUpperCase();

  if (["PASS", "PASSED", "SUCCESS", "SUCCEEDED", "COMPLETED"].includes(status)) {
    return "PASS";
  }

  if (["FAIL", "FAILED", "ERROR", "DENIED"].includes(status)) {
    return "FAIL";
  }

  if (["WARNING", "WARN"].includes(status)) {
    return "WARNING";
  }

  if (["SKIPPED"].includes(status)) {
    return "SKIPPED";
  }

  return "UNKNOWN";
}

function normalizeExecutionStatus(result = {}) {
  const raw = clean(
    result.finalVerdict ||
      result.status,
    60
  ).toUpperCase();

  if (
    [
      "PASS",
      "SUCCESS",
      "SUCCEEDED",
      "COMPLETED",
      "COMPLETE",
    ].includes(raw)
  ) {
    return "SUCCEEDED";
  }

  if (raw === "PARTIAL") {
    return "PARTIAL";
  }

  if (
    [
      "FAIL",
      "FAILED",
      "ERROR",
    ].includes(raw)
  ) {
    return "FAILED";
  }

  if (raw === "TIMEOUT") {
    return "TIMEOUT";
  }

  if (raw === "CANCELLED") {
    return "CANCELLED";
  }

  if (raw === "INTERRUPTED") {
    return "INTERRUPTED";
  }

  if (raw === "UNKNOWN_OUTCOME") {
    return "UNKNOWN_OUTCOME";
  }

  return "";
}

function awaitingApproval(result = {}) {
  if (
    result.__approvalRequired === true ||
    result.approvalRequired === true
  ) {
    return true;
  }

  const status = clean(
    result.status,
    80
  ).toUpperCase();

  return (
    status.includes("APPROVAL") ||
    status.includes("AWAITING") ||
    status === "PENDING"
  );
}

function toolEvidence(result = {}) {
  if (!Array.isArray(result.toolCalls)) {
    return [];
  }

  return result.toolCalls
    .filter(
      (item) =>
        item &&
        typeof item === "object"
    )
    .map((item, index) => ({
      id: clean(
        `tool:${
          item.callId ||
          item.call_id ||
          index + 1
        }`,
        120
      ),

      status:
        normalizeEvidenceStatus(
          item.status
        ),

      authority: "SYSTEM",
      critical: true,

      reasonCode:
        clean(
          item.reasonCode ||
          item.failureCategory,
          80
        ) || null,
    }));
}

function validationEvidence(result = {}) {
  if (!Array.isArray(result.validations)) {
    return [];
  }

  return result.validations.map(
    (item, index) => ({
      id: clean(
        `validation:${
          item?.id ||
          item?.command ||
          index + 1
        }`,
        120
      ),

      status:
        normalizeEvidenceStatus(
          item?.status
        ),

      authority:
        "DETERMINISTIC",

      critical: true,

      reasonCode:
        clean(
          item?.reasonCode,
          80
        ) || null,
    })
  );
}

function repositoryEvidence(result = {}) {
  const evidence = [];

  if (
    result.diffReview &&
    typeof result.diffReview ===
      "object" &&
    typeof result.diffReview.valid ===
      "boolean"
  ) {
    evidence.push({
      id: "diff-review",
      status:
        result.diffReview.valid
          ? "PASS"
          : "FAIL",
      authority:
        "DETERMINISTIC",
      critical: true,
      reasonCode:
        result.diffReview.valid
          ? null
          : "DIFF_REVIEW_FAILED",
    });
  }

  if (
    result
      .preExistingChangesPreserved ===
    false
  ) {
    evidence.push({
      id:
        "pre-existing-changes-preserved",
      status: "FAIL",
      authority:
        "DETERMINISTIC",
      critical: true,
      reasonCode:
        "PRE_EXISTING_CHANGES_NOT_PRESERVED",
    });
  }

  return evidence;
}

function buildRuntimeEvidence(result = {}) {
  return [
    ...toolEvidence(result),
    ...validationEvidence(result),
    ...repositoryEvidence(result),
  ];
}

function shouldEvaluate(result = {}) {
  if (
    !result ||
    typeof result !== "object"
  ) {
    return false;
  }

  if (awaitingApproval(result)) {
    return false;
  }

  if (
    result.agentEvaluation ||
    result.metadata?.agentEvaluation
  ) {
    return false;
  }

  return Boolean(
    result.executionId ||
    result.taskId
  ) && (
    Array.isArray(result.toolCalls) ||
    Array.isArray(result.validations) ||
    Boolean(result.diffReview) ||
    Boolean(result.finalVerdict)
  );
}

function attachAgentEvaluation(
  result,
  {
    engine,
    observability = null,
    decisionEvidenceContext = null,
    decisionEvidenceAdapter =
      projectAgentEvaluationEvidence,
  }
) {
  if (!shouldEvaluate(result)) {
    return result;
  }

  const executionId =
    clean(
      result.executionId ||
        result.taskId,
      160
    );

  const evidence =
    buildRuntimeEvidence(result);

  const requiredEvidenceIds =
    evidence
      .filter(
        (item) =>
          item.critical === true
      )
      .map(
        (item) => item.id
      );

  const evaluation =
    engine.evaluate({
      executionId,
      executionStatus:
        normalizeExecutionStatus(
          result
        ),
      evidence,
      requiredEvidenceIds,
    });

  try {
    observability?.(
      "evaluated",
      {
        executionId,
        verdict:
          evaluation.verdict,
        confidence:
          evaluation.confidence,
        reasonCodes:
          evaluation.reasonCodes,
        evidenceSummary:
          evaluation.evidenceSummary,
        criteriaSummary:
          evaluation.criteriaSummary,
      }
    );
  } catch {}

  let decisionEvidence = null;

  if (decisionEvidenceContext) {
    if (
      typeof decisionEvidenceAdapter !==
      "function"
    ) {
      throw new TypeError(
        "DecisionEvidenceAdapter valide requis."
      );
    }

    const safeEvaluationContext = {
      executionId:
        evaluation.executionId,
      evaluationPolicyVersion:
        evaluation
          .evaluationPolicyVersion,
      verdict:
        evaluation.verdict,
      confidence:
        evaluation.confidence,
    };

    const resolvedContext =
      typeof decisionEvidenceContext ===
      "function"
        ? decisionEvidenceContext(
            safeEvaluationContext
          )
        : decisionEvidenceContext;

    if (resolvedContext) {
      decisionEvidence =
        decisionEvidenceAdapter({
          evaluation,
          evidence,
          context:
            resolvedContext,
        });
    }
  }

  return {
    ...result,

    metadata: {
      ...(result.metadata || {}),
      agentEvaluation:
        evaluation,

      ...(decisionEvidence
        ? {
            decisionEvidence,
          }
        : {}),
    },
  };
}

function createAgentEvaluationRuntime({
  orchestrator,
  engine,
  observability = null,
  decisionEvidenceContext = null,
  decisionEvidenceAdapter =
    projectAgentEvaluationEvidence,
} = {}) {
  if (
    !orchestrator ||
    typeof orchestrator.run !==
      "function" ||
    typeof orchestrator.resume !==
      "function"
  ) {
    throw new TypeError(
      "NoonOrchestrator valide requis."
    );
  }

  if (
    !engine ||
    typeof engine.evaluate !==
      "function"
  ) {
    throw new TypeError(
      "AgentEvaluationEngine valide requis."
    );
  }

  if (
    decisionEvidenceContext &&
    typeof decisionEvidenceAdapter !==
      "function"
  ) {
    throw new TypeError(
      "DecisionEvidenceAdapter valide requis."
    );
  }

  async function run(input) {
    const result =
      await orchestrator.run(input);

    return attachAgentEvaluation(
      result,
      {
        engine,
        observability,
        decisionEvidenceContext,
        decisionEvidenceAdapter,
      }
    );
  }

  async function resume(input) {
    const result =
      await orchestrator.resume(input);

    return attachAgentEvaluation(
      result,
      {
        engine,
        observability,
        decisionEvidenceContext,
        decisionEvidenceAdapter,
      }
    );
  }

  return {
    run,
    resume,

    pendingExecutions:
      (...args) =>
        orchestrator
          .pendingExecutions(
            ...args
          ),
  };
}

module.exports = {
  attachAgentEvaluation,
  buildRuntimeEvidence,
  createAgentEvaluationRuntime,
  normalizeExecutionStatus,
  normalizeEvidenceStatus,
  shouldEvaluate,
};
