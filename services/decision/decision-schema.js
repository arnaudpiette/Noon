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

const V2_CRITERION_TYPES = Object.freeze([...CRITERION_TYPES.slice(0, 1), "LATENCY", ...CRITERION_TYPES.slice(1)]);
const V2_DIRECTIONS = Object.freeze(["MINIMIZE", "MAXIMIZE", "MATCH"]);
const V2_REQUIRED_EVIDENCE = Object.freeze(["NONE", "VERIFIED"]);
const V2_SCOPE_PURPOSES = Object.freeze(["LOCAL_ANALYSIS", "REMOTE_MODEL_CONTEXT"]);
const V2_EVIDENCE_STANCES = Object.freeze(["SUPPORTS", "OPPOSES", "NEUTRAL"]);
const V2_EVIDENCE_KINDS = Object.freeze(["DETERMINISTIC_CHECK", "SYSTEM_OBSERVATION", "HUMAN_CONFIRMATION", "SOURCE_PASSAGE", "LLM_ASSERTION", "INFERENCE"]);
const V2_AUTHORITIES = Object.freeze(["DETERMINISTIC", "SYSTEM", "HUMAN", "EXTERNAL_SOURCE", "AGENT"]);
const V2_VERIFICATION_STATUSES = Object.freeze(["VERIFIED", "PARTIALLY_VERIFIED", "UNVERIFIED", "FAILED"]);
const V2_FRESHNESS = Object.freeze(["LIVE", "RECENT", "CURRENT", "EVERGREEN", "HISTORICAL"]);
const V2_CONSTRAINT_OPERATORS = Object.freeze(["MAX", "MIN", "EQUALS", "IN"]);
const V2_CONSTRAINT_STRENGTHS = Object.freeze(["HARD", "SOFT"]);
const V2_VERIFICATION_TYPES = Object.freeze(["DETERMINISTIC_CHECK", "READ_AUTHORIZED_SOURCE", "ASK_USER", "REFRESH_SOURCE"]);
const V2_BUDGET_STATES = Object.freeze(["AVAILABLE", "CONSTRAINED", "EXHAUSTED", "UNKNOWN"]);
const V2_VERDICTS = Object.freeze(["DECIDED", "NEEDS_MORE_EVIDENCE", "INSUFFICIENT_EVIDENCE", "CONFLICT"]);
const V2_LIMITS = Object.freeze({ id: 160, contextVersion: 120, question: 4000, options: 20, criteria: 30, constraints: 30, evidence: 100, verificationProposals: 30, dependencyDepth: 12 });

class DecisionSchemaError extends TypeError {
  constructor(code, message) { super(message); this.name = "DecisionSchemaError"; this.code = code; }
}

function invalid(code, path, detail) { throw new DecisionSchemaError(code, `${path}: ${detail}`); }
function strictObject(value, path, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) invalid("DECISION_V2_TYPE_INVALID", path, "objet attendu");
  for (const key of Object.keys(value)) if (!allowed.includes(key)) invalid("DECISION_V2_FIELD_UNKNOWN", `${path}.${key}`, "champ inconnu");
  return value;
}
function strictString(value, path, { max, optional = false, nullable = false } = {}) {
  if (value === null && nullable) return null;
  if (value === undefined && optional) return undefined;
  if (typeof value !== "string" || !value.trim()) invalid("DECISION_V2_STRING_INVALID", path, "chaîne non vide attendue");
  const result = value.trim();
  if (max && result.length > max) invalid("DECISION_V2_BOUND_EXCEEDED", path, `maximum ${max} caractères`);
  return result;
}
function strictEnum(value, allowed, path, optional = false) {
  if (value === undefined && optional) return undefined;
  if (!allowed.includes(value)) invalid("DECISION_V2_ENUM_INVALID", path, "valeur enum invalide");
  return value;
}
function strictBoolean(value, path, optional = false) {
  if (value === undefined && optional) return undefined;
  if (typeof value !== "boolean") invalid("DECISION_V2_TYPE_INVALID", path, "booléen attendu");
  return value;
}
function strictNumber(value, path, { optional = false, nullable = false, min = -Infinity, max = Infinity, integer = false } = {}) {
  if (value === null && nullable) return null;
  if (value === undefined && optional) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || (integer && !Number.isInteger(value)) || value < min || value > max) invalid("DECISION_V2_NUMBER_INVALID", path, "nombre fini hors contrat");
  return value;
}
function strictArray(value, path, { optional = false, min = 0, max } = {}) {
  if (value === undefined && optional) return [];
  if (!Array.isArray(value)) invalid("DECISION_V2_TYPE_INVALID", path, "tableau attendu");
  if (value.length < min || (max !== undefined && value.length > max)) invalid("DECISION_V2_BOUND_EXCEEDED", path, `taille attendue ${min}..${max}`);
  return value;
}
function strictDate(value, path, optional = false) {
  if (value == null && optional) return null;
  const result = strictString(value, path);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(result) || !Number.isFinite(Date.parse(result))) invalid("DECISION_V2_DATE_INVALID", path, "date ISO-8601 invalide");
  return result;
}
function strictScalar(value, path, nullable = false) {
  if (value === null && nullable) return null;
  if (["string", "boolean"].includes(typeof value)) return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  invalid("DECISION_V2_TYPE_INVALID", path, "valeur scalaire attendue");
}
function unique(items, key, path) {
  const seen = new Set();
  for (const item of items) { if (seen.has(item[key])) invalid("DECISION_V2_ID_DUPLICATE", `${path}.${item[key]}`, "identifiant dupliqué"); seen.add(item[key]); }
  return seen;
}
function assertReference(value, ids, path) { if (!ids.has(value)) invalid("DECISION_V2_REFERENCE_INVALID", path, "référence inexistante"); }
function sortBy(items, ...keys) { return [...items].sort((a, b) => keys.map((key) => String(a[key] ?? "").localeCompare(String(b[key] ?? ""))).find(Boolean) || 0); }
function deepFreeze(value) { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); } return value; }
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

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
  if (raw?.schemaVersion === 2) invalid("DECISION_V2_EXPLICIT_NORMALIZER_REQUIRED", "schemaVersion", "utiliser normalizeDecisionRequestV2");
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

function normalizeScopeV2(raw, path) {
  strictObject(raw, path, ["profileScope", "workspaceId", "projectId", "purpose"]);
  return { profileScope: strictString(raw.profileScope, `${path}.profileScope`, { max: V2_LIMITS.id }),
    workspaceId: raw.workspaceId === undefined ? undefined : strictString(raw.workspaceId, `${path}.workspaceId`, { max: V2_LIMITS.id, nullable: true }),
    projectId: raw.projectId === undefined ? undefined : strictString(raw.projectId, `${path}.projectId`, { max: V2_LIMITS.id, nullable: true }),
    purpose: strictEnum(raw.purpose, V2_SCOPE_PURPOSES, `${path}.purpose`) };
}
function normalizeOptionV2(raw, index) {
  const path = `options[${index}]`; strictObject(raw, path, ["optionId", "label", "description", "source", "assumptions", "values"]);
  const assumptions = strictArray(raw.assumptions, `${path}.assumptions`, { optional: true, max: 20 }).map((value, i) => strictString(value, `${path}.assumptions[${i}]`, { max: 500 }));
  const values = raw.values === undefined ? {} : strictObject(raw.values, `${path}.values`, Object.keys(raw.values));
  return { optionId: strictString(raw.optionId, `${path}.optionId`, { max: V2_LIMITS.id }), label: strictString(raw.label, `${path}.label`, { max: 180 }),
    description: raw.description === undefined ? undefined : strictString(raw.description, `${path}.description`, { max: 1200 }),
    source: strictEnum(raw.source, OPTION_SOURCES, `${path}.source`), assumptions,
    values: Object.fromEntries(Object.keys(values).sort().map((key) => [strictString(key, `${path}.values key`, { max: V2_LIMITS.id }), values[key] === "UNKNOWN" ? "UNKNOWN" : strictScalar(values[key], `${path}.values.${key}`)])) };
}
function normalizeCriterionV2(raw, index) {
  const path = `criteria[${index}]`; strictObject(raw, path, ["criterionId", "label", "type", "importance", "direction", "requiredEvidence", "range"]);
  let range = null;
  if (raw.range !== undefined && raw.range !== null) { strictObject(raw.range, `${path}.range`, ["min", "max"]); range = { min: strictNumber(raw.range.min, `${path}.range.min`), max: strictNumber(raw.range.max, `${path}.range.max`) }; if (range.min > range.max) invalid("DECISION_V2_RANGE_INVALID", `${path}.range`, "min supérieur à max"); }
  return { criterionId: strictString(raw.criterionId, `${path}.criterionId`, { max: V2_LIMITS.id }), label: strictString(raw.label, `${path}.label`, { max: 180 }),
    type: strictEnum(raw.type, V2_CRITERION_TYPES, `${path}.type`), importance: strictEnum(raw.importance, IMPORTANCE, `${path}.importance`),
    direction: strictEnum(raw.direction, V2_DIRECTIONS, `${path}.direction`), requiredEvidence: strictEnum(raw.requiredEvidence, V2_REQUIRED_EVIDENCE, `${path}.requiredEvidence`), range };
}
function normalizeConstraintV2(raw, index) {
  const path = `constraints[${index}]`; strictObject(raw, path, ["constraintId", "optionId", "criterionId", "operator", "expected", "strength", "evidenceRequirement"]);
  const expected = Array.isArray(raw.expected) ? strictArray(raw.expected, `${path}.expected`, { min: 1, max: 100 }).map((v, i) => strictScalar(v, `${path}.expected[${i}]`)) : strictScalar(raw.expected, `${path}.expected`);
  return { constraintId: strictString(raw.constraintId, `${path}.constraintId`, { max: V2_LIMITS.id }), optionId: raw.optionId == null ? null : strictString(raw.optionId, `${path}.optionId`, { max: V2_LIMITS.id }),
    criterionId: strictString(raw.criterionId, `${path}.criterionId`, { max: V2_LIMITS.id }), operator: strictEnum(raw.operator, V2_CONSTRAINT_OPERATORS, `${path}.operator`), expected,
    strength: strictEnum(raw.strength, V2_CONSTRAINT_STRENGTHS, `${path}.strength`), evidenceRequirement: strictEnum(raw.evidenceRequirement, ["VERIFIED"], `${path}.evidenceRequirement`) };
}
function normalizeProvenanceV2(raw, path) {
  strictObject(raw, path, ["producer", "sourceType", "sourceRef", "locatorRef", "method", "rootEvidenceId"]);
  return { producer: strictString(raw.producer, `${path}.producer`, { max: 120 }), sourceType: strictString(raw.sourceType, `${path}.sourceType`, { max: 80 }),
    sourceRef: raw.sourceRef === undefined ? undefined : strictString(raw.sourceRef, `${path}.sourceRef`, { max: 1000, nullable: true }),
    locatorRef: raw.locatorRef === undefined ? undefined : strictString(raw.locatorRef, `${path}.locatorRef`, { max: 1000, nullable: true }),
    method: strictString(raw.method, `${path}.method`, { max: 120 }), rootEvidenceId: raw.rootEvidenceId === undefined ? undefined : strictString(raw.rootEvidenceId, `${path}.rootEvidenceId`, { max: V2_LIMITS.id, nullable: true }) };
}
function normalizeEvidenceV2(raw, index) {
  const path = `evidence[${index}]`; strictObject(raw, path, ["evidenceId", "claimId", "optionId", "criterionId", "stance", "value", "kind", "authority", "verificationStatus", "critical", "provenance", "scope", "observedAt", "validUntil", "freshnessRequirement", "claimFingerprint", "independenceKey", "derivedFromEvidenceIds", "localOnly", "allowedForRemoteModel", "untrustedContent"]);
  return { evidenceId: strictString(raw.evidenceId, `${path}.evidenceId`, { max: V2_LIMITS.id }), claimId: strictString(raw.claimId, `${path}.claimId`, { max: V2_LIMITS.id }),
    optionId: strictString(raw.optionId, `${path}.optionId`, { max: V2_LIMITS.id }), criterionId: strictString(raw.criterionId, `${path}.criterionId`, { max: V2_LIMITS.id }),
    stance: strictEnum(raw.stance, V2_EVIDENCE_STANCES, `${path}.stance`), value: raw.value === undefined ? undefined : strictScalar(raw.value, `${path}.value`, true),
    kind: strictEnum(raw.kind, V2_EVIDENCE_KINDS, `${path}.kind`), authority: strictEnum(raw.authority, V2_AUTHORITIES, `${path}.authority`),
    verificationStatus: strictEnum(raw.verificationStatus, V2_VERIFICATION_STATUSES, `${path}.verificationStatus`), critical: raw.critical === undefined ? undefined : strictBoolean(raw.critical, `${path}.critical`),
    provenance: normalizeProvenanceV2(raw.provenance, `${path}.provenance`), scope: normalizeScopeV2(raw.scope, `${path}.scope`),
    observedAt: raw.observedAt === undefined ? undefined : strictDate(raw.observedAt, `${path}.observedAt`, true), validUntil: raw.validUntil === undefined ? undefined : strictDate(raw.validUntil, `${path}.validUntil`, true),
    freshnessRequirement: raw.freshnessRequirement === undefined ? undefined : strictEnum(raw.freshnessRequirement, V2_FRESHNESS, `${path}.freshnessRequirement`),
    claimFingerprint: strictString(raw.claimFingerprint, `${path}.claimFingerprint`, { max: 256 }), independenceKey: strictString(raw.independenceKey, `${path}.independenceKey`, { max: 256 }),
    derivedFromEvidenceIds: strictArray(raw.derivedFromEvidenceIds, `${path}.derivedFromEvidenceIds`, { optional: true, max: 20 }).map((v, i) => strictString(v, `${path}.derivedFromEvidenceIds[${i}]`, { max: V2_LIMITS.id })),
    localOnly: raw.localOnly === undefined ? undefined : strictBoolean(raw.localOnly, `${path}.localOnly`), allowedForRemoteModel: raw.allowedForRemoteModel === undefined ? undefined : strictBoolean(raw.allowedForRemoteModel, `${path}.allowedForRemoteModel`),
    untrustedContent: raw.untrustedContent === undefined ? undefined : strictBoolean(raw.untrustedContent, `${path}.untrustedContent`) };
}
function normalizeVerificationV2(raw, index, pathPrefix = "verificationProposals") {
  const path = `${pathPrefix}[${index}]`; strictObject(raw, path, ["verificationId", "resolvesClaimIds", "type", "requiredAuthority", "priority", "estimatedCost", "estimatedLatencyMs", "estimatedModelCalls", "estimatedToolRequests", "proposedOnly", "authorizationState"]);
  let estimatedCost;
  if (raw.estimatedCost !== undefined) { strictObject(raw.estimatedCost, `${path}.estimatedCost`, ["currency", "amount"]); estimatedCost = { currency: strictEnum(raw.estimatedCost.currency, ["USD"], `${path}.estimatedCost.currency`), amount: strictNumber(raw.estimatedCost.amount, `${path}.estimatedCost.amount`, { nullable: true, min: 0 }) }; }
  return { verificationId: strictString(raw.verificationId, `${path}.verificationId`, { max: V2_LIMITS.id }),
    resolvesClaimIds: strictArray(raw.resolvesClaimIds, `${path}.resolvesClaimIds`, { min: 1, max: 20 }).map((v, i) => strictString(v, `${path}.resolvesClaimIds[${i}]`, { max: V2_LIMITS.id })).sort(),
    type: strictEnum(raw.type, V2_VERIFICATION_TYPES, `${path}.type`), requiredAuthority: strictEnum(raw.requiredAuthority, V2_AUTHORITIES.slice(0, 3), `${path}.requiredAuthority`),
    priority: strictEnum(raw.priority, IMPORTANCE, `${path}.priority`), estimatedCost,
    estimatedLatencyMs: raw.estimatedLatencyMs === undefined ? undefined : strictNumber(raw.estimatedLatencyMs, `${path}.estimatedLatencyMs`, { nullable: true, min: 0 }),
    estimatedModelCalls: raw.estimatedModelCalls === undefined ? undefined : strictNumber(raw.estimatedModelCalls, `${path}.estimatedModelCalls`, { min: 0, integer: true }),
    estimatedToolRequests: raw.estimatedToolRequests === undefined ? undefined : strictNumber(raw.estimatedToolRequests, `${path}.estimatedToolRequests`, { min: 0, integer: true }),
    proposedOnly: raw.proposedOnly === true ? true : invalid("DECISION_V2_AUTHORITY_INVALID", `${path}.proposedOnly`, "true requis"),
    authorizationState: strictEnum(raw.authorizationState, ["NOT_REQUESTED"], `${path}.authorizationState`) };
}
function normalizeBudgetV2(raw) {
  const path = "budget"; strictObject(raw, path, ["authorityRef", "state", "remainingCost", "remainingModelCalls", "remainingToolRequests", "remainingWallTimeMs"]);
  return { authorityRef: strictString(raw.authorityRef, `${path}.authorityRef`, { max: V2_LIMITS.id }), state: strictEnum(raw.state, V2_BUDGET_STATES, `${path}.state`),
    remainingCost: raw.remainingCost === undefined ? undefined : strictNumber(raw.remainingCost, `${path}.remainingCost`, { nullable: true, min: 0 }),
    remainingModelCalls: raw.remainingModelCalls === undefined ? undefined : strictNumber(raw.remainingModelCalls, `${path}.remainingModelCalls`, { nullable: true, min: 0, integer: true }),
    remainingToolRequests: raw.remainingToolRequests === undefined ? undefined : strictNumber(raw.remainingToolRequests, `${path}.remainingToolRequests`, { nullable: true, min: 0, integer: true }),
    remainingWallTimeMs: raw.remainingWallTimeMs === undefined ? undefined : strictNumber(raw.remainingWallTimeMs, `${path}.remainingWallTimeMs`, { nullable: true, min: 0 }) };
}

function validateEvidenceGraph(evidence, evidenceIds) {
  const graph = new Map(evidence.map((item) => [item.evidenceId, item.derivedFromEvidenceIds]));
  for (const item of evidence) {
    for (const dependencyId of item.derivedFromEvidenceIds) {
      if (!evidenceIds.has(dependencyId)) invalid("DECISION_EVIDENCE_DEPENDENCY_INVALID", `evidence.${item.evidenceId}.derivedFromEvidenceIds`, "référence inexistante");
      if (dependencyId === item.evidenceId) invalid("DECISION_EVIDENCE_DEPENDENCY_INVALID", `evidence.${item.evidenceId}`, "auto-référence");
    }
    if (item.provenance.rootEvidenceId != null) assertReference(item.provenance.rootEvidenceId, evidenceIds, `evidence.${item.evidenceId}.provenance.rootEvidenceId`);
  }
  function visit(idValue, path = new Set()) {
    if (path.has(idValue)) invalid("DECISION_EVIDENCE_DEPENDENCY_INVALID", `evidence.${idValue}`, "cycle détecté");
    if (path.size > V2_LIMITS.dependencyDepth) invalid("DECISION_EVIDENCE_DEPENDENCY_INVALID", `evidence.${idValue}`, "profondeur supérieure à 12");
    const next = new Set(path); next.add(idValue);
    for (const dependencyId of graph.get(idValue) || []) visit(dependencyId, next);
  }
  for (const idValue of evidenceIds) visit(idValue);
}

function normalizeDecisionRequestV2(raw = {}) {
  strictObject(raw, "request", ["schemaVersion", "decisionId", "question", "decisionType", "evaluationAt", "scope", "options", "criteria", "constraints", "evidence", "verificationProposals", "budget", "recommendationRequested", "outputMode", "contextVersion"]);
  if (raw.schemaVersion !== 2) invalid("DECISION_V2_VERSION_INVALID", "schemaVersion", "2 requis");
  const options = sortBy(strictArray(raw.options, "options", { min: 2, max: V2_LIMITS.options }).map(normalizeOptionV2), "optionId");
  const criteria = sortBy(strictArray(raw.criteria, "criteria", { min: 1, max: V2_LIMITS.criteria }).map(normalizeCriterionV2), "criterionId");
  const constraints = sortBy(strictArray(raw.constraints, "constraints", { optional: true, max: V2_LIMITS.constraints }).map(normalizeConstraintV2), "constraintId");
  const evidence = sortBy(strictArray(raw.evidence, "evidence", { optional: true, max: V2_LIMITS.evidence }).map(normalizeEvidenceV2), "evidenceId");
  const verificationProposals = sortBy(strictArray(raw.verificationProposals, "verificationProposals", { optional: true, max: V2_LIMITS.verificationProposals }).map((item, i) => normalizeVerificationV2(item, i)), "verificationId");
  const optionIds = unique(options, "optionId", "options"), criterionIds = unique(criteria, "criterionId", "criteria");
  unique(constraints, "constraintId", "constraints"); const evidenceIds = unique(evidence, "evidenceId", "evidence"); unique(verificationProposals, "verificationId", "verificationProposals");
  for (const option of options) for (const criterionId of Object.keys(option.values)) assertReference(criterionId, criterionIds, `options.${option.optionId}.values.${criterionId}`);
  for (const constraint of constraints) { if (constraint.optionId != null) assertReference(constraint.optionId, optionIds, `constraints.${constraint.constraintId}.optionId`); assertReference(constraint.criterionId, criterionIds, `constraints.${constraint.constraintId}.criterionId`); }
  for (const item of evidence) { assertReference(item.optionId, optionIds, `evidence.${item.evidenceId}.optionId`); assertReference(item.criterionId, criterionIds, `evidence.${item.evidenceId}.criterionId`); }
  validateEvidenceGraph(evidence, evidenceIds);
  const claimIds = new Set(evidence.map((item) => item.claimId));
  for (const proposal of verificationProposals) for (const claimId of proposal.resolvesClaimIds) assertReference(claimId, claimIds, `verificationProposals.${proposal.verificationId}.resolvesClaimIds`);
  const normalized = { schemaVersion: 2, decisionId: strictString(raw.decisionId, "decisionId", { max: V2_LIMITS.id }),
    question: raw.question === undefined ? undefined : strictString(raw.question, "question", { max: V2_LIMITS.question }),
    decisionType: strictEnum(raw.decisionType, DECISION_TYPES, "decisionType"), evaluationAt: strictDate(raw.evaluationAt, "evaluationAt"), scope: normalizeScopeV2(raw.scope, "scope"),
    options, criteria, constraints, evidence, verificationProposals, budget: raw.budget === undefined ? undefined : normalizeBudgetV2(raw.budget),
    recommendationRequested: raw.recommendationRequested === undefined ? undefined : strictBoolean(raw.recommendationRequested, "recommendationRequested"),
    outputMode: raw.outputMode === undefined ? undefined : strictEnum(raw.outputMode, OUTPUT_MODES, "outputMode"), contextVersion: strictString(raw.contextVersion, "contextVersion", { max: V2_LIMITS.contextVersion }) };
  return deepFreeze(normalized);
}

function fingerprintDecisionContextV2(raw) {
  const normalized = normalizeDecisionRequestV2(raw);
  return crypto.createHash("sha256").update(canonicalJson(normalized)).digest("hex");
}

function normalizeDecisionContract(raw = {}) {
  if (raw.schemaVersion === 2) return normalizeDecisionRequestV2(raw);
  if (raw.schemaVersion === undefined || raw.schemaVersion === 1) return normalizeDecisionRequest(raw);
  invalid("DECISION_SCHEMA_VERSION_UNSUPPORTED", "schemaVersion", "version non prise en charge");
}

function normalizeDecisionResultV2(raw = {}, request) {
  strictObject(raw, "result", ["schemaVersion", "engineVersion", "decisionId", "verdict", "recommendedOptionId", "reasonCodes", "rankedOptions", "constraints", "unknowns", "conflicts", "verificationProposals", "stopReason", "evidenceSummary", "supportScore", "evidenceCoverage", "recommendationIsAction", "actionAuthorized", "verificationAuthorized", "decisionContextFingerprint", "publicMetadata"]);
  if (raw.schemaVersion !== 2 || raw.engineVersion !== "decision-support-v2") invalid("DECISION_V2_VERSION_INVALID", "result", "versions V2 requises");
  const normalizedRequest = normalizeDecisionRequestV2(request);
  const optionIds = new Set(normalizedRequest.options.map((item) => item.optionId)), constraintIds = new Set(normalizedRequest.constraints.map((item) => item.constraintId)), evidenceIds = new Set(normalizedRequest.evidence.map((item) => item.evidenceId)), claimIds = new Set(normalizedRequest.evidence.map((item) => item.claimId)), criterionIds = new Set(normalizedRequest.criteria.map((item) => item.criterionId));
  const reasonCodes = strictArray(raw.reasonCodes, "result.reasonCodes", { max: 100 }).map((v, i) => strictString(v, `result.reasonCodes[${i}]`, { max: 160 })).sort();
  const rankedOptions = sortBy(strictArray(raw.rankedOptions, "result.rankedOptions", { max: V2_LIMITS.options }).map((item, i) => { const p = `result.rankedOptions[${i}]`; strictObject(item, p, ["optionId", "rank", "supportScore", "evidenceCoverage", "constraintState"]); const optionId = strictString(item.optionId, `${p}.optionId`, { max: V2_LIMITS.id }); assertReference(optionId, optionIds, `${p}.optionId`); return { optionId, rank: strictNumber(item.rank, `${p}.rank`, { min: 1, max: optionIds.size, integer: true }), supportScore: strictNumber(item.supportScore, `${p}.supportScore`, { nullable: true, min: 0, max: 4 }), evidenceCoverage: strictNumber(item.evidenceCoverage, `${p}.evidenceCoverage`, { min: 0, max: 1 }), constraintState: strictEnum(item.constraintState, ["SATISFIED", "VIOLATED", "UNKNOWN"], `${p}.constraintState`) }; }), "rank", "optionId");
  unique(rankedOptions, "optionId", "result.rankedOptions"); unique(rankedOptions, "rank", "result.rankedOptions ranks");
  const constraints = sortBy(strictArray(raw.constraints, "result.constraints", { max: V2_LIMITS.constraints * V2_LIMITS.options }).map((item, i) => { const p = `result.constraints[${i}]`; strictObject(item, p, ["constraintId", "optionId", "status", "reasonCodes"]); const constraintId = strictString(item.constraintId, `${p}.constraintId`, { max: V2_LIMITS.id }), optionId = strictString(item.optionId, `${p}.optionId`, { max: V2_LIMITS.id }); assertReference(constraintId, constraintIds, `${p}.constraintId`); assertReference(optionId, optionIds, `${p}.optionId`); return { constraintId, optionId, status: strictEnum(item.status, ["SATISFIED", "VIOLATED", "UNKNOWN"], `${p}.status`), reasonCodes: strictArray(item.reasonCodes, `${p}.reasonCodes`, { max: 30 }).map((v, j) => strictString(v, `${p}.reasonCodes[${j}]`, { max: 160 })).sort() }; }), "constraintId", "optionId");
  const unknowns = sortBy(strictArray(raw.unknowns, "result.unknowns", { max: 3000 }).map((item, i) => { const p = `result.unknowns[${i}]`; strictObject(item, p, ["unknownId", "claimId", "optionId", "criterionId", "reasonCode"]); const result = { unknownId: strictString(item.unknownId, `${p}.unknownId`, { max: V2_LIMITS.id }), claimId: strictString(item.claimId, `${p}.claimId`, { max: V2_LIMITS.id }), optionId: strictString(item.optionId, `${p}.optionId`, { max: V2_LIMITS.id }), criterionId: strictString(item.criterionId, `${p}.criterionId`, { max: V2_LIMITS.id }), reasonCode: strictString(item.reasonCode, `${p}.reasonCode`, { max: 160 }) }; assertReference(result.claimId, claimIds, `${p}.claimId`); assertReference(result.optionId, optionIds, `${p}.optionId`); assertReference(result.criterionId, criterionIds, `${p}.criterionId`); return result; }), "unknownId");
  const conflicts = sortBy(strictArray(raw.conflicts, "result.conflicts", { max: V2_LIMITS.evidence }).map((item, i) => { const p = `result.conflicts[${i}]`; strictObject(item, p, ["conflictId", "claimId", "type", "evidenceIds", "material"]); const claimId = strictString(item.claimId, `${p}.claimId`, { max: V2_LIMITS.id }); assertReference(claimId, claimIds, `${p}.claimId`); const ids = strictArray(item.evidenceIds, `${p}.evidenceIds`, { min: 2, max: 100 }).map((v, j) => { const idValue = strictString(v, `${p}.evidenceIds[${j}]`, { max: V2_LIMITS.id }); assertReference(idValue, evidenceIds, `${p}.evidenceIds[${j}]`); return idValue; }).sort(); return { conflictId: strictString(item.conflictId, `${p}.conflictId`, { max: V2_LIMITS.id }), claimId, type: strictString(item.type, `${p}.type`, { max: 160 }), evidenceIds: ids, material: strictBoolean(item.material, `${p}.material`) }; }), "conflictId");
  const verificationProposals = sortBy(strictArray(raw.verificationProposals, "result.verificationProposals", { max: V2_LIMITS.verificationProposals }).map((item, i) => normalizeVerificationV2(item, i, "result.verificationProposals")), "verificationId");
  unique(unknowns, "unknownId", "result.unknowns"); unique(conflicts, "conflictId", "result.conflicts"); unique(verificationProposals, "verificationId", "result.verificationProposals");
  for (const proposal of verificationProposals) for (const claimId of proposal.resolvesClaimIds) assertReference(claimId, claimIds, `result.verificationProposals.${proposal.verificationId}`);
  strictObject(raw.evidenceSummary, "result.evidenceSummary", ["eligible", "excluded", "stale", "duplicate", "dependent"]);
  const evidenceSummary = Object.fromEntries(["eligible", "excluded", "stale", "duplicate", "dependent"].map((key) => [key, strictNumber(raw.evidenceSummary[key], `result.evidenceSummary.${key}`, { min: 0, integer: true })]));
  strictObject(raw.supportScore, "result.supportScore", ["scale", "byOption", "calibratedProbability", "calibrationStatus"]); strictObject(raw.supportScore.byOption, "result.supportScore.byOption", [...optionIds]);
  const byOption = Object.fromEntries([...optionIds].sort().map((optionId) => [optionId, strictNumber(raw.supportScore.byOption[optionId], `result.supportScore.byOption.${optionId}`, { nullable: true, min: 0, max: 4 })]));
  strictObject(raw.evidenceCoverage, "result.evidenceCoverage", ["byOption", "criticalCellsComplete"]); strictObject(raw.evidenceCoverage.byOption, "result.evidenceCoverage.byOption", [...optionIds]);
  const coverage = Object.fromEntries([...optionIds].sort().map((optionId) => [optionId, strictNumber(raw.evidenceCoverage.byOption[optionId], `result.evidenceCoverage.byOption.${optionId}`, { min: 0, max: 1 })]));
  strictObject(raw.publicMetadata, "result.publicMetadata", Object.keys(raw.publicMetadata));
  for (const [key, value] of Object.entries(raw.publicMetadata)) strictScalar(value, `result.publicMetadata.${key}`, true);
  const recommendedOptionId = raw.recommendedOptionId === null ? null : strictString(raw.recommendedOptionId, "result.recommendedOptionId", { max: V2_LIMITS.id }); if (recommendedOptionId) assertReference(recommendedOptionId, optionIds, "result.recommendedOptionId");
  const decisionId = strictString(raw.decisionId, "result.decisionId", { max: V2_LIMITS.id }); if (decisionId !== normalizedRequest.decisionId) invalid("DECISION_V2_REFERENCE_INVALID", "result.decisionId", "décision incohérente");
  const decisionContextFingerprint = strictString(raw.decisionContextFingerprint, "result.decisionContextFingerprint", { max: 256 }); if (decisionContextFingerprint !== fingerprintDecisionContextV2(normalizedRequest)) invalid("DECISION_V2_REFERENCE_INVALID", "result.decisionContextFingerprint", "contexte incohérent");
  const normalized = { schemaVersion: 2, engineVersion: "decision-support-v2", decisionId, verdict: strictEnum(raw.verdict, V2_VERDICTS, "result.verdict"), recommendedOptionId, reasonCodes, rankedOptions, constraints, unknowns, conflicts, verificationProposals,
    stopReason: strictString(raw.stopReason, "result.stopReason", { max: 1000 }), evidenceSummary,
    supportScore: { scale: strictEnum(raw.supportScore.scale, ["ORDINAL_0_4_WEIGHTED"], "result.supportScore.scale"), byOption, calibratedProbability: raw.supportScore.calibratedProbability === null ? null : invalid("DECISION_V2_CALIBRATION_INVALID", "result.supportScore.calibratedProbability", "null requis"), calibrationStatus: strictEnum(raw.supportScore.calibrationStatus, ["NOT_CALIBRATED"], "result.supportScore.calibrationStatus") },
    evidenceCoverage: { byOption: coverage, criticalCellsComplete: strictBoolean(raw.evidenceCoverage.criticalCellsComplete, "result.evidenceCoverage.criticalCellsComplete") },
    recommendationIsAction: raw.recommendationIsAction === false ? false : invalid("DECISION_V2_AUTHORITY_INVALID", "result.recommendationIsAction", "false requis"), actionAuthorized: raw.actionAuthorized === false ? false : invalid("DECISION_V2_AUTHORITY_INVALID", "result.actionAuthorized", "false requis"), verificationAuthorized: raw.verificationAuthorized === false ? false : invalid("DECISION_V2_AUTHORITY_INVALID", "result.verificationAuthorized", "false requis"),
    decisionContextFingerprint, publicMetadata: { ...raw.publicMetadata } };
  return deepFreeze(normalized);
}

module.exports = { CONFIDENCE, CRITERION_SOURCES, CRITERION_TYPES, DECISION_TYPES, DecisionSchemaError, IMPORTANCE, OPTION_SOURCES, OPTION_STATES, OUTPUT_MODES,
  V2_AUTHORITIES, V2_BUDGET_STATES, V2_CONSTRAINT_OPERATORS, V2_CONSTRAINT_STRENGTHS, V2_CRITERION_TYPES, V2_EVIDENCE_KINDS, V2_EVIDENCE_STANCES, V2_FRESHNESS, V2_LIMITS, V2_REQUIRED_EVIDENCE, V2_SCOPE_PURPOSES, V2_VERDICTS, V2_VERIFICATION_STATUSES, V2_VERIFICATION_TYPES,
  fingerprintDecisionContextV2, id, normalizeCriterion, normalizeDecisionContract, normalizeDecisionRequest, normalizeDecisionRequestV2, normalizeDecisionResultV2, normalizeOption };
