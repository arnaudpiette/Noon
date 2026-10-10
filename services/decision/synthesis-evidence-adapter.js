"use strict";

const crypto = require("node:crypto");

const {
  V2_EVIDENCE_STANCES,
  V2_LIMITS,
  V2_SCOPE_PURPOSES,
  normalizeDecisionRequestV2,
} = require("./decision-schema");

const ADAPTER_VERSION = "synthesis-evidence-v1";
const MAX_ID_LENGTH = 160;
const MAX_FINGERPRINT_LENGTH = 256;
const SYNTHESIS_MAX_SOURCES = 40;
const SYNTHESIS_CLAIMS_PER_SOURCE = 5;
// Local adapter bounds derived from the deterministic Synthesis extractor:
// 40 normalized sources and at most five sentence claims per source.
const MAX_SYNTHESIS_CLAIMS = SYNTHESIS_MAX_SOURCES * SYNTHESIS_CLAIMS_PER_SOURCE;
const MAX_ROOTS_PER_CLAIM = SYNTHESIS_MAX_SOURCES;
const MAX_SOURCE_COVERAGE = SYNTHESIS_MAX_SOURCES;
const MAX_CONFLICTS = MAX_SYNTHESIS_CLAIMS;
const MAX_CONFLICT_MEMBERS = MAX_SYNTHESIS_CLAIMS;
const MAX_MAPPINGS = V2_LIMITS.evidence;
const QUALITATIVE_VALUES = new Set([
  "POOR",
  "WEAK",
  "NEUTRAL",
  "GOOD",
  "EXCELLENT",
  "UNKNOWN",
]);
const SYNTHESIS_CONFLICT_TYPES = new Set([
  "VALUE_CONFLICT",
  "VERSION_CONFLICT",
  "TEMPORAL_AMBIGUITY",
  "SOURCE_DISAGREEMENT",
  "STATUS_CONFLICT",
]);
const SYNTHESIS_CONFLICT_SEVERITIES = new Set(["high", "low"]);

function digest(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

function id(prefix, value) {
  return `${prefix}_${digest(value).slice(0, 24)}`;
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function plainObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${field} invalide.`);
  }
  return value;
}

function exactObject(value, field, allowed) {
  plainObject(value, field);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new TypeError(`${field}.${key} inattendu.`);
    }
  }
  return value;
}

function identifier(value, field, max = MAX_ID_LENGTH) {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new TypeError(`${field} invalide.`);
  }
  return value;
}

function nullableIdentifier(value, field) {
  if (value == null) return null;
  return identifier(value, field);
}

function parseOptionalIso(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function sameScope(left, right) {
  return left.profileScope === right.profileScope
    && (left.workspaceId ?? null) === (right.workspaceId ?? null)
    && (left.projectId ?? null) === (right.projectId ?? null)
    && left.purpose === right.purpose;
}

function normalizeDeclaredSourceScope(raw) {
  exactObject(raw, "synthesis.scope", [
    "profileScope",
    "workspaceId",
    "projectId",
    "purpose",
  ]);
  const profileScope = identifier(raw.profileScope, "synthesis.scope.profileScope");
  const purpose = identifier(raw.purpose, "synthesis.scope.purpose", 80);

  if (!V2_SCOPE_PURPOSES.includes(purpose)) {
    throw new TypeError("synthesis.scope.purpose invalide.");
  }

  return {
    profileScope,
    workspaceId: nullableIdentifier(raw.workspaceId, "synthesis.scope.workspaceId"),
    projectId: nullableIdentifier(raw.projectId, "synthesis.scope.projectId"),
    purpose,
  };
}

function normalizeClaims(rawClaims) {
  if (!Array.isArray(rawClaims)) {
    throw new TypeError("synthesis.claims doit être un tableau.");
  }
  if (rawClaims.length > MAX_SYNTHESIS_CLAIMS) {
    throw new TypeError(`synthesis.claims dépasse la borne locale de ${MAX_SYNTHESIS_CLAIMS}.`);
  }

  const claims = new Map();
  for (const [index, raw] of rawClaims.entries()) {
    exactObject(raw, `synthesis.claims[${index}]`, [
      "claimId",
      "independentRoots",
      "effectiveAt",
      "status",
      "type",
      "value",
      "subject",
      "predicate",
      "normalizedValue",
      "evidenceIds",
      "citationIds",
      "confidence",
      "directness",
      "sourceAuthority",
      "sourceTypes",
      "basedOn",
      "directCitation",
      "verificationStatus",
    ]);

    const claimId = identifier(raw.claimId, `synthesis.claims[${index}].claimId`);
    if (claims.has(claimId)) {
      throw new TypeError(`synthesis.claims.${claimId} dupliqué.`);
    }
    if (!Array.isArray(raw.independentRoots) || raw.independentRoots.length === 0) {
      throw new TypeError(`synthesis.claims.${claimId}.independentRoots requis.`);
    }
    if (raw.independentRoots.length > MAX_ROOTS_PER_CLAIM) {
      throw new TypeError(`synthesis.claims.${claimId}.independentRoots dépasse la borne locale de ${MAX_ROOTS_PER_CLAIM}.`);
    }

    const roots = [...new Set(raw.independentRoots.map((root, rootIndex) =>
      identifier(root, `synthesis.claims.${claimId}.independentRoots[${rootIndex}]`)))];

    if (roots.length !== raw.independentRoots.length) {
      throw new TypeError(`synthesis.claims.${claimId}.independentRoots dupliqué.`);
    }

    claims.set(claimId, {
      claimId,
      roots: roots.sort(),
      observedAt: parseOptionalIso(raw.effectiveAt),
      status: typeof raw.status === "string" ? raw.status : "unknown",
    });
  }
  return claims;
}

function booleanAllowedForMapping(value, mapping, request) {
  return request.constraints.some((constraint) => {
    if (constraint.criterionId !== mapping.criterionId) return false;
    if (constraint.optionId !== mapping.optionId) return false;
    if (constraint.operator === "EQUALS") return constraint.expected === value;
    return constraint.operator === "IN"
      && Array.isArray(constraint.expected)
      && constraint.expected.includes(value);
  });
}

function normalizeMappingValue(value, mapping, request, field) {
  if (value === null) return null;
  if (typeof value === "string") {
    if (QUALITATIVE_VALUES.has(value)) return value;
    throw new TypeError(`${field} doit être une valeur qualitative admise ou null.`);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${field} doit être un nombre fini.`);
    const criterion = request.criteria.find((item) => item.criterionId === mapping.criterionId);
    const range = criterion?.range;
    if (!range || value < range.min || value > range.max) {
      throw new TypeError(`${field} exige une range numérique explicite et respectée.`);
    }
    return value;
  }
  if (typeof value === "boolean") {
    if (!booleanAllowedForMapping(value, mapping, request)) {
      throw new TypeError(`${field} booléen sans interprétation V2 explicite.`);
    }
    return value;
  }
  throw new TypeError(`${field} invalide.`);
}

function normalizeMappings(rawMappings, claims, request) {
  if (!Array.isArray(rawMappings) || rawMappings.length === 0 || rawMappings.length > MAX_MAPPINGS) {
    throw new TypeError(`mappings doit contenir entre 1 et ${MAX_MAPPINGS} éléments.`);
  }

  const optionIds = new Set(request.options.map((option) => option.optionId));
  const criterionIds = new Set(request.criteria.map((criterion) => criterion.criterionId));
  const seen = new Set();

  return rawMappings.map((raw, index) => {
    exactObject(raw, `mappings[${index}]`, [
      "claimId",
      "optionId",
      "criterionId",
      "stance",
      "value",
    ]);
    const claimId = identifier(raw.claimId, `mappings[${index}].claimId`);
    const optionId = identifier(raw.optionId, `mappings[${index}].optionId`);
    const criterionId = identifier(raw.criterionId, `mappings[${index}].criterionId`);
    const stance = identifier(raw.stance, `mappings[${index}].stance`, 40);

    if (!claims.has(claimId)) {
      throw new TypeError(`mappings[${index}].claimId inconnu.`);
    }
    if (!optionIds.has(optionId)) {
      throw new TypeError(`mappings[${index}].optionId absent de la requête Decision cible.`);
    }
    if (!criterionIds.has(criterionId)) {
      throw new TypeError(`mappings[${index}].criterionId absent de la requête Decision cible.`);
    }
    if (!V2_EVIDENCE_STANCES.includes(stance)) {
      throw new TypeError(`mappings[${index}].stance invalide.`);
    }

    const key = [claimId, optionId, criterionId].join("\u0000");
    if (seen.has(key)) {
      throw new TypeError(`mappings[${index}] dupliqué.`);
    }
    seen.add(key);

    const mapping = {
      claimId,
      optionId,
      criterionId,
      stance,
    };
    return {
      ...mapping,
      value: normalizeMappingValue(raw.value, mapping, request, `mappings[${index}].value`),
    };
  });
}

function conflictType(value) {
  return SYNTHESIS_CONFLICT_TYPES.has(value) ? value : "UNKNOWN";
}

function conflictSeverity(value) {
  return SYNTHESIS_CONFLICT_SEVERITIES.has(value) ? value : "UNKNOWN";
}

function validateConflictBounds(rawConflicts) {
  if (rawConflicts == null) return;
  if (!Array.isArray(rawConflicts)) {
    throw new TypeError("synthesis.conflicts doit être un tableau.");
  }
  if (rawConflicts.length > MAX_CONFLICTS) {
    throw new TypeError(`synthesis.conflicts dépasse la borne locale de ${MAX_CONFLICTS}.`);
  }

  for (const [index, raw] of rawConflicts.entries()) {
    exactObject(raw, `synthesis.conflicts[${index}]`, [
      "conflictId",
      "claims",
      "type",
      "severity",
      "subject",
      "likelyResolution",
      "confidence",
    ]);
    const conflictId = identifier(raw.conflictId, `synthesis.conflicts[${index}].conflictId`);
    if (!Array.isArray(raw.claims) || raw.claims.length < 2) {
      throw new TypeError(`synthesis.conflicts.${conflictId}.claims invalide.`);
    }
    if (raw.claims.length > MAX_CONFLICT_MEMBERS) {
      throw new TypeError(`synthesis.conflicts.${conflictId}.claims dépasse la borne locale de ${MAX_CONFLICT_MEMBERS}.`);
    }
  }
}

function normalizeConflicts(rawConflicts, selectedClaimIds, claimRefs, sourceSynthesisRef) {
  if (rawConflicts == null) return [];
  validateConflictBounds(rawConflicts);

  const conflicts = [];
  const seen = new Set();
  for (const [index, raw] of rawConflicts.entries()) {
    exactObject(raw, `synthesis.conflicts[${index}]`, [
      "conflictId",
      "claims",
      "type",
      "severity",
      "subject",
      "likelyResolution",
      "confidence",
    ]);
    const conflictId = identifier(raw.conflictId, `synthesis.conflicts[${index}].conflictId`);
    if (seen.has(conflictId)) {
      throw new TypeError(`synthesis.conflicts.${conflictId} dupliqué.`);
    }
    seen.add(conflictId);

    const claimIds = [...new Set(raw.claims.map((claimId, claimIndex) =>
      identifier(claimId, `synthesis.conflicts.${conflictId}.claims[${claimIndex}]`)))];
    if (claimIds.length !== raw.claims.length) {
      throw new TypeError(`synthesis.conflicts.${conflictId}.claims dupliqué.`);
    }

    const selected = claimIds.filter((claimId) => selectedClaimIds.has(claimId));
    if (selected.length === 0) continue;
    if (selected.length !== claimIds.length) {
      throw new TypeError(`synthesis.conflicts.${conflictId} sélectionné partiellement.`);
    }

    const projectedClaimIds = [...new Set(claimIds.flatMap((claimId) => claimRefs.get(claimId) || []))].sort();
    conflicts.push({
      conflictRef: id("synthesis_conflict", { sourceSynthesisRef, conflictId }),
      claimIds: projectedClaimIds,
      type: conflictType(raw.type),
      severity: conflictSeverity(raw.severity),
      unresolved: true,
    });
  }
  return conflicts.sort((left, right) => left.conflictRef.localeCompare(right.conflictRef));
}

function validateSourceCoverage(rawCoverage) {
  if (rawCoverage == null) return false;
  if (!Array.isArray(rawCoverage)) {
    throw new TypeError("synthesis.sourceCoverage doit être un tableau.");
  }
  if (rawCoverage.length > MAX_SOURCE_COVERAGE) {
    throw new TypeError(`synthesis.sourceCoverage dépasse la borne locale de ${MAX_SOURCE_COVERAGE}.`);
  }
  for (const [index, item] of rawCoverage.entries()) {
    plainObject(item, `synthesis.sourceCoverage[${index}]`);
  }
}

function coverageUnknowns(rawCoverage) {
  validateSourceCoverage(rawCoverage);
  return rawCoverage?.some((item) => item.status !== "ok") || false;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function independenceKey(root, scope) {
  // `root` is the Synthesis-declared canonical provenance identity
  // (`derivedFrom || evidenceId`), not source content and not an attestation.
  return id("synthesis_root", {
    namespace: "multi-source-synthesis-v1",
    scope,
    root,
  });
}

function projectSynthesisEvidence({ synthesis, mappings, context } = {}) {
  exactObject(context, "context", ["decisionRequest"]);
  const request = normalizeDecisionRequestV2(context.decisionRequest);
  if (request.scope.purpose !== "LOCAL_ANALYSIS") {
    throw new TypeError("La projection Synthesis est limitée à LOCAL_ANALYSIS.");
  }

  exactObject(synthesis, "synthesis", [
    "synthesisId",
    "evidenceSetFingerprint",
    "mode",
    "answer",
    "keyPoints",
    "claims",
    "conflicts",
    "timeline",
    "citations",
    "sourceCoverage",
    "sourcesUsed",
    "currentState",
    "diff",
    "confidence",
    "limitations",
    "metrics",
    "cacheHit",
    "scope",
    "localOnly",
    "allowedForRemoteModel",
  ]);
  const synthesisId = identifier(synthesis.synthesisId, "synthesis.synthesisId");
  const evidenceSetFingerprint = identifier(
    synthesis.evidenceSetFingerprint,
    "synthesis.evidenceSetFingerprint",
    MAX_FINGERPRINT_LENGTH
  );
  const sourceSynthesisRef = id("synthesis", { synthesisId, evidenceSetFingerprint });

  let sourceScopeState = "UNKNOWN";
  if (hasOwn(synthesis, "scope")) {
    const sourceScope = normalizeDeclaredSourceScope(synthesis.scope);
    if (!sameScope(sourceScope, request.scope)) {
      throw new TypeError("synthesis.scope incompatible avec la requête Decision cible.");
    }
    sourceScopeState = "DECLARED_COMPATIBLE_UNVERIFIED";
  }
  if (hasOwn(synthesis, "localOnly") && typeof synthesis.localOnly !== "boolean") {
    throw new TypeError("synthesis.localOnly invalide.");
  }
  if (hasOwn(synthesis, "allowedForRemoteModel") && typeof synthesis.allowedForRemoteModel !== "boolean") {
    throw new TypeError("synthesis.allowedForRemoteModel invalide.");
  }

  validateSourceCoverage(synthesis.sourceCoverage);
  validateConflictBounds(synthesis.conflicts);
  const claims = normalizeClaims(synthesis.claims);
  const normalizedMappings = normalizeMappings(mappings, claims, request);
  const projectedEvidenceCount = normalizedMappings.reduce(
    (count, mapping) => count + claims.get(mapping.claimId).roots.length,
    0
  );
  if (projectedEvidenceCount > V2_LIMITS.evidence) {
    throw new TypeError(`La projection dépasse la borne V2 de ${V2_LIMITS.evidence} preuves.`);
  }
  const projectedClaimRefs = new Map();
  const evidence = [];
  const unknowns = [];

  for (const mapping of normalizedMappings) {
    const sourceClaim = claims.get(mapping.claimId);
    const projectedClaimId = id("decision_claim", {
      sourceSynthesisRef,
      sourceClaimId: mapping.claimId,
      optionId: mapping.optionId,
      criterionId: mapping.criterionId,
    });
    const claimRefs = projectedClaimRefs.get(mapping.claimId) || [];
    claimRefs.push(projectedClaimId);
    projectedClaimRefs.set(mapping.claimId, claimRefs);

    const claimFingerprint = id("synthesis_claim", {
      sourceSynthesisRef,
      sourceClaimId: mapping.claimId,
    });
    const status = sourceClaim.status.toUpperCase();
    if (!sourceClaim.observedAt) {
      unknowns.push({ claimId: projectedClaimId, reasonCode: "OBSERVED_AT_UNKNOWN" });
    }
    if (status !== "CURRENT") {
      unknowns.push({ claimId: projectedClaimId, reasonCode: "SOURCE_STATUS_UNATTESTED" });
    }

    for (const root of sourceClaim.roots) {
      evidence.push({
        evidenceId: id("decision_evidence", {
          sourceSynthesisRef,
          sourceClaimId: mapping.claimId,
          optionId: mapping.optionId,
          criterionId: mapping.criterionId,
          root,
        }),
        claimId: projectedClaimId,
        optionId: mapping.optionId,
        criterionId: mapping.criterionId,
        stance: mapping.stance,
        value: mapping.value,
        kind: "LLM_ASSERTION",
        authority: "AGENT",
        verificationStatus: "UNVERIFIED",
        critical: false,
        provenance: {
          producer: "multi-source-synthesis-adapter",
          sourceType: "multi_source_synthesis",
          sourceRef: `synthesis:${sourceSynthesisRef}`,
          locatorRef: `claim:${projectedClaimId}`,
          method: "metadata_only_claim_projection",
          rootEvidenceId: null,
        },
        scope: request.scope,
        observedAt: sourceClaim.observedAt,
        validUntil: null,
        freshnessRequirement: "HISTORICAL",
        claimFingerprint,
        independenceKey: independenceKey(root, request.scope),
        derivedFromEvidenceIds: [],
        localOnly: true,
        allowedForRemoteModel: false,
        untrustedContent: true,
      });
    }
  }

  if (sourceScopeState === "UNKNOWN") {
    for (const claimId of [...new Set([...projectedClaimRefs.values()].flat())]) {
      unknowns.push({ claimId, reasonCode: "SOURCE_SCOPE_UNKNOWN" });
    }
  }
  if (coverageUnknowns(synthesis.sourceCoverage)) {
    for (const claimId of [...new Set([...projectedClaimRefs.values()].flat())]) {
      unknowns.push({ claimId, reasonCode: "SOURCE_COVERAGE_INCOMPLETE" });
    }
  }

  const conflicts = normalizeConflicts(
    synthesis.conflicts,
    new Set(normalizedMappings.map((mapping) => mapping.claimId)),
    projectedClaimRefs,
    sourceSynthesisRef
  );

  const independentRoots = [...new Set(evidence.map((item) => item.independenceKey))].sort();
  const normalizedEvidence = evidence.sort((left, right) => left.evidenceId.localeCompare(right.evidenceId));
  const normalizedUnknowns = unknowns
    .filter((item, index, items) => items.findIndex((candidate) =>
      candidate.claimId === item.claimId && candidate.reasonCode === item.reasonCode) === index)
    .sort((left, right) => left.claimId.localeCompare(right.claimId)
      || left.reasonCode.localeCompare(right.reasonCode));

  return deepFreeze({
    adapterVersion: ADAPTER_VERSION,
    sourceSynthesisRef,
    sourceScopeState,
    evidence: normalizedEvidence,
    attestedEvidenceIds: [],
    conflicts,
    independentRoots,
    unknowns: normalizedUnknowns,
    privacyLimitations: [
      "FINGERPRINTS_ARE_REFERENCES_NOT_ANONYMIZATION",
      "SOURCE_SCOPE_AND_AUTHORIZATION_NOT_ATTESTED",
    ],
  });
}

module.exports = {
  ADAPTER_VERSION,
  projectSynthesisEvidence,
};
