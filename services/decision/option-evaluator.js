"use strict";

const WEIGHTS = Object.freeze({ LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 });
const ASSESSMENTS = Object.freeze({ POOR: 0, WEAK: 1, NEUTRAL: 2, GOOD: 3, EXCELLENT: 4 });

function qualitative(value) {
  const normalized = String(value || "").toUpperCase();
  return Object.hasOwn(ASSESSMENTS, normalized) ? normalized : "UNKNOWN";
}
function meetsConstraint(value, constraint = {}) {
  if (value === undefined || value === null) return null;
  if (constraint.operator === "MAX") return Number(value) <= Number(constraint.value);
  if (constraint.operator === "MIN") return Number(value) >= Number(constraint.value);
  if (constraint.operator === "EQUALS") return value === constraint.value;
  if (constraint.operator === "IN") return Array.isArray(constraint.value) && constraint.value.includes(value);
  return null;
}
function assessmentFor(value, criterion) {
  if (value === undefined || value === null || value === "UNKNOWN") return { assessment: "UNKNOWN", normalizedValue: null };
  if (typeof value === "number" && criterion.range && Number.isFinite(criterion.range.min) && Number.isFinite(criterion.range.max)) {
    const span = criterion.range.max - criterion.range.min || 1;
    const ratio = Math.max(0, Math.min(1, (value - criterion.range.min) / span));
    const directed = criterion.direction === "MINIMIZE" ? 1 - ratio : ratio;
    return { assessment: directed >= .8 ? "EXCELLENT" : directed >= .6 ? "GOOD" : directed >= .4 ? "NEUTRAL" : directed >= .2 ? "WEAK" : "POOR", normalizedValue: value };
  }
  const assessment = qualitative(value);
  return { assessment, normalizedValue: typeof value === "number" ? value : null };
}
function evaluateOption(option, criteria, evidenceById = new Map()) {
  const evaluations = []; const blockers = []; let weighted = 0; let knownWeight = 0;
  for (const criterion of criteria) {
    const value = option.values?.[criterion.criterionId] ?? option.values?.[criterion.type] ?? option.values?.[criterion.label];
    const hard = criterion.hardConstraint ? meetsConstraint(value, criterion.constraint || {}) : true;
    if (hard === false) blockers.push({ criterionId: criterion.criterionId, reasonCode: "HARD_CONSTRAINT_VIOLATED" });
    const assessed = assessmentFor(value, criterion); const weight = WEIGHTS[criterion.importance] || 2;
    if (assessed.assessment !== "UNKNOWN") { weighted += ASSESSMENTS[assessed.assessment] * weight; knownWeight += weight; }
    const evidenceRefs = option.evidenceRefs.filter((ref) => evidenceById.has(ref));
    evaluations.push({ optionId: option.optionId, criterionId: criterion.criterionId, ...assessed,
      evidenceRefs, confidence: evidenceRefs.length ? "HIGH" : assessed.assessment === "UNKNOWN" ? "UNKNOWN" : "LOW",
      evidenceStatus: evidenceRefs.length ? "EVIDENCE" : assessed.assessment === "UNKNOWN" ? "MISSING" : "ASSUMPTION",
      explanation: assessed.assessment === "UNKNOWN" ? "Information manquante." : evidenceRefs.length ? "Évaluation appuyée par une preuve référencée." : "Hypothèse non vérifiée." });
  }
  return { option: { ...option, status: blockers.length ? "INFEASIBLE" : evaluations.some((item) => item.assessment === "UNKNOWN") ? "UNKNOWN" : option.status === "CONDITIONAL" ? "CONDITIONAL" : "FEASIBLE" },
    evaluations, blockers, comparisonIndex: knownWeight ? Math.round(weighted / knownWeight) : null, evidenceCoverage: evaluations.length ? evaluations.filter((item) => item.evidenceStatus === "EVIDENCE").length / evaluations.length : 0 };
}

function meetsConstraintV2(value, constraint = {}) {
  return meetsConstraint(value, {
    operator: constraint.operator,
    value: constraint.expected,
  });
}

function evaluateOptionV2(
  option,
  criteria,
  eligibleEvidence = []
) {
  const evaluations = [];
  let weighted = 0;
  let knownWeight = 0;

  for (const criterion of criteria) {
    const evidence = eligibleEvidence
      .filter(
        (item) =>
          item.optionId === option.optionId &&
          item.criterionId === criterion.criterionId
      )
      .sort((a, b) =>
        a.evidenceId.localeCompare(b.evidenceId)
      );

    const observed = evidence.find(
      (item) =>
        item.value !== undefined &&
        item.value !== null
    );

    const rawValue =
      option.values?.[criterion.criterionId];

    const value =
      observed?.value !== undefined &&
      observed?.value !== null
        ? observed.value
        : rawValue;

    const assessed = assessmentFor(
      value,
      criterion
    );

    const weight =
      WEIGHTS[criterion.importance] || 2;

    if (assessed.assessment !== "UNKNOWN") {
      weighted +=
        ASSESSMENTS[assessed.assessment] *
        weight;
      knownWeight += weight;
    }

    evaluations.push({
      optionId: option.optionId,
      criterionId: criterion.criterionId,
      ...assessed,
      evidenceIds: evidence.map(
        (item) => item.evidenceId
      ),
      evidenceRootCount: evidence.length,
      hasEligibleEvidence:
        evidence.length > 0,
    });
  }

  const supportScore = knownWeight
    ? Number(
        (weighted / knownWeight).toFixed(6)
      )
    : null;

  const evidenceCoverage = criteria.length
    ? evaluations.filter(
        (item) => item.hasEligibleEvidence
      ).length / criteria.length
    : 0;

  return {
    optionId: option.optionId,
    supportScore,
    evidenceCoverage,
    evaluations,
  };
}

module.exports = { ASSESSMENTS, WEIGHTS, assessmentFor, evaluateOption, evaluateOptionV2, meetsConstraint, meetsConstraintV2 };
