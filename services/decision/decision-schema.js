"use strict";

const crypto = require("node:crypto");

const DECISION_TYPES = Object.freeze(["CHOOSE", "COMPARE", "RANK", "TRADEOFF", "GO_NO_GO", "WHAT_IF", "REVIEW_DECISION"]);
const OPTION_SOURCES = Object.freeze(["USER_PROVIDED", "DISCOVERED", "CURRENT_STATE", "SYNTHESIZED"]);
const OPTION_STATES = Object.freeze(["FEASIBLE", "INFEASIBLE", "UNKNOWN", "CONDITIONAL"]);
const CRITERION_TYPES = Object.freeze(["COST", "TIME", "QUALITY", "RISK", "REVERSIBILITY", "COMPLEXITY", "MAINTENANCE", "PRIVACY", "SECURITY", "PERFORMANCE", "LEARNING_VALUE", "STRATEGIC_FIT", "USER_DEFINED"]);
const CRITERION_SOURCES = Object.freeze(["explicit_user", "hard_rule", "workspace", "project", "memory_confirmed", "inferred", "default"]);
const IMPORTANCE = Object.freeze(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
const CONFIDENCE = Object.freeze(["UNKNOWN", "LOW", "MEDIUM", "HIGH"]);
const OUTPUT_MODES = Object.freeze(["QUICK", "BALANCED", "DETAILED", "TABLE", "COMPARE_ONLY"]);

function id(prefix) { return `${prefix}_${crypto.randomUUID()}`; }
function list(value, max = 50) { return Array.isArray(value) ? value.filter(Boolean).slice(0, max) : []; }
function enumValue(value, allowed, fallback) { return allowed.includes(value) ? value : fallback; }
function normalizeOption(raw = {}, index = 0) {
  if (!raw.label) throw new TypeError(`Libellé manquant pour l'option ${index + 1}.`);
  return Object.freeze({ optionId: String(raw.optionId || id("option")), label: String(raw.label).trim().slice(0, 180),
    description: String(raw.description || "").trim().slice(0, 1200), status: enumValue(raw.status, OPTION_STATES, "UNKNOWN"),
    source: enumValue(raw.source, OPTION_SOURCES, "USER_PROVIDED"), assumptions: list(raw.assumptions, 20).map(String),
    evidenceRefs: list(raw.evidenceRefs, 50).map(String), values: structuredClone(raw.values || {}), metadata: structuredClone(raw.metadata || {}) });
}
function normalizeCriterion(raw = {}, index = 0) {
  if (!raw.label) throw new TypeError(`Libellé manquant pour le critère ${index + 1}.`);
  const source = enumValue(raw.source, CRITERION_SOURCES, "default");
  return Object.freeze({ criterionId: String(raw.criterionId || id("criterion")), label: String(raw.label).trim().slice(0, 180),
    description: String(raw.description || "").trim().slice(0, 800), type: enumValue(raw.type, CRITERION_TYPES, "USER_DEFINED"),
    importance: enumValue(raw.importance, IMPORTANCE, source === "explicit_user" ? "HIGH" : "MEDIUM"),
    direction: ["MINIMIZE", "MAXIMIZE", "MATCH"].includes(raw.direction) ? raw.direction : "MAXIMIZE",
    hardConstraint: raw.hardConstraint === true, constraint: raw.constraint ? structuredClone(raw.constraint) : null,
    range: raw.range ? structuredClone(raw.range) : null,
    source, confidence: enumValue(raw.confidence, CONFIDENCE, source === "explicit_user" ? "HIGH" : "MEDIUM") });
}
function normalizeDecisionRequest(raw = {}) {
  const options = list(raw.options, 20).map(normalizeOption);
  if (options.length < 2) throw Object.assign(new Error("Au moins deux options sont nécessaires."), { code: "DECISION_OPTIONS_INSUFFICIENT" });
  const explicitCriteria = list(raw.explicitCriteria || raw.criteria, 30).map(normalizeCriterion);
  return Object.freeze({ decisionId: String(raw.decisionId || id("decision")), question: String(raw.question || "").trim().slice(0, 4000),
    decisionType: enumValue(raw.decisionType, DECISION_TYPES, "COMPARE"), options, explicitCriteria,
    constraints: list(raw.constraints, 30).map((item) => structuredClone(item)), preferencesRef: list(raw.preferencesRef, 30).map(String),
    evidenceRefs: list(raw.evidenceRefs, 100).map(String), evidence: list(raw.evidence, 100).map((item) => structuredClone(item)),
    workspaceId: raw.workspaceId ? String(raw.workspaceId) : null, projectId: raw.projectId ? String(raw.projectId) : null,
    profileScope: String(raw.profileScope || "arnaud"), timeHorizon: raw.timeHorizon || "UNKNOWN",
    reversibility: raw.reversibility || "UNKNOWN", riskTolerance: raw.riskTolerance || "UNKNOWN",
    outputMode: enumValue(raw.outputMode, OUTPUT_MODES, "BALANCED"), recommendationRequested: raw.recommendationRequested !== false,
    contextVersion: String(raw.contextVersion || "0") });
}

module.exports = { CONFIDENCE, CRITERION_SOURCES, CRITERION_TYPES, DECISION_TYPES, IMPORTANCE, OPTION_SOURCES, OPTION_STATES, OUTPUT_MODES, id, normalizeCriterion, normalizeDecisionRequest, normalizeOption };
