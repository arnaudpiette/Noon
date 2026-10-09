"use strict";

const crypto = require("node:crypto");
const {
  normalizeDecisionRequest,
  normalizeCriterion,
  normalizeDecisionRequestV2,
  normalizeDecisionResultV2,
  fingerprintDecisionContextV2,
} = require("./decision-schema");
const {
  ASSESSMENTS,
  evaluateOption,
  evaluateOptionV2,
  meetsConstraintV2,
} = require("./option-evaluator");
const { createDecisionHistoryService } = require("./decision-history-service");

const ENGINE_VERSION = "decision-support-v1";
const SOURCE_PRIORITY = Object.freeze({ hard_rule: 7, explicit_user: 6, workspace: 5, project: 4, memory_confirmed: 3, inferred: 2, default: 1 });
function stable(value) { if (Array.isArray(value)) return value.map(stable); if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])); return value; }
function fingerprint(value) { return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function resolveCriteria(request) {
  const selected = new Map();
  for (const raw of [...request.explicitCriteria, ...request.constraints.map((constraint) => ({ ...constraint, hardConstraint: true, source: constraint.source || "explicit_user" }))]) {
    const criterion = raw.criterionId ? raw : normalizeCriterion(raw);
    const key = criterion.type === "USER_DEFINED" ? criterion.label.toLocaleLowerCase("fr") : criterion.type;
    const current = selected.get(key);
    if (!current || SOURCE_PRIORITY[criterion.source] > SOURCE_PRIORITY[current.source]) selected.set(key, criterion);
  }
  return [...selected.values()];
}
function filterEvidence(request, { remote = false } = {}) {
  return request.evidence.filter((item) => {
    if (item.workspaceId && item.workspaceId !== request.workspaceId) return false;
    if (item.profileScope && item.profileScope !== request.profileScope) return false;
    if (remote && (item.localOnly === true || item.allowedForRemoteModel === false)) return false;
    return true;
  }).map((item) => ({ evidenceId: String(item.evidenceId), sourceType: item.sourceType || "unknown", confidence: item.confidence || "LOW",
    stale: item.stale === true, conflict: item.conflict === true, localOnly: item.localOnly === true, locator: item.locator || null }));
}
function keyTradeoffs(evaluated, criteria) {
  if (evaluated.length < 2) return [];
  const [left, right] = evaluated;
  return criteria.flatMap((criterion) => {
    const a = left.evaluations.find((item) => item.criterionId === criterion.criterionId);
    const b = right.evaluations.find((item) => item.criterionId === criterion.criterionId);
    if (!a || !b || a.assessment === b.assessment || a.assessment === "UNKNOWN" || b.assessment === "UNKNOWN") return [];
    return [{ criterionId: criterion.criterionId, optionA: left.option.optionId, assessmentA: a.assessment,
      optionB: right.option.optionId, assessmentB: b.assessment }];
  });
}
function recommendation(evaluated, request, uncertainty, tradeoffs = []) {
  const feasible = evaluated.filter((item) => item.option.status !== "INFEASIBLE");
  if (!feasible.length) return { type: "NO_FEASIBLE_OPTION", recommendedOptionId: null, reasonCodes: ["NO_FEASIBLE_OPTION"] };
  if (!request.recommendationRequested || request.outputMode === "COMPARE_ONLY") return { type: "COMPARE_ONLY", recommendedOptionId: null, reasonCodes: [] };
  if (uncertainty.state === "INSUFFICIENT") return { type: "INSUFFICIENT_EVIDENCE", recommendedOptionId: null, reasonCodes: ["INSUFFICIENT_EVIDENCE"] };
  const ranked = feasible.filter((item) => item.comparisonIndex !== null).sort((a, b) => b.comparisonIndex - a.comparisonIndex || a.option.label.localeCompare(b.option.label, "fr"));
  if (!ranked.length) return { type: "INSUFFICIENT_EVIDENCE", recommendedOptionId: null, reasonCodes: ["INSUFFICIENT_EVIDENCE"] };
  if (ranked.length > 1 && ranked[0].comparisonIndex === ranked[1].comparisonIndex) {
    const differentWinners = new Set(tradeoffs.flatMap((item) => {
      const order = { POOR: 0, WEAK: 1, NEUTRAL: 2, GOOD: 3, EXCELLENT: 4 };
      if (order[item.assessmentA] > order[item.assessmentB]) return [item.optionA];
      if (order[item.assessmentB] > order[item.assessmentA]) return [item.optionB];
      return [];
    }));
    return differentWinners.size > 1
      ? { type: "USER_VALUE_DEPENDENT", recommendedOptionId: null, reasonCodes: ["USER_PRIORITY_MATCH"] }
      : { type: "TIE", recommendedOptionId: null, reasonCodes: ["NO_CLEAR_ADVANTAGE"] };
  }
  const lowConfidence = ranked[0].evaluations.some((item) => ["LOW", "UNKNOWN"].includes(item.confidence));
  const type = lowConfidence || uncertainty.state === "PARTIAL" ? "CONDITIONAL_RECOMMENDATION" : "CLEAR_RECOMMENDATION";
  return { type, recommendedOptionId: ranked[0].option.optionId,
    reasonCodes: ["MEETS_ALL_HARD_CONSTRAINTS", lowConfidence ? "INSUFFICIENT_EVIDENCE" : "USER_PRIORITY_MATCH"] };
}


const V2_ENGINE_VERSION = "decision-support-v2";

const V2_ATTESTATION_AUTHORITIES =
  Object.freeze({
    DETERMINISTIC_CHECK:
      Object.freeze(["DETERMINISTIC"]),
    SYSTEM_OBSERVATION:
      Object.freeze(["SYSTEM"]),
    HUMAN_CONFIRMATION:
      Object.freeze(["HUMAN"]),
    SOURCE_PASSAGE:
      Object.freeze([
        "EXTERNAL_SOURCE",
        "SYSTEM",
        "HUMAN",
      ]),
  });

const V2_EVIDENCE_RANK =
  Object.freeze({
    DETERMINISTIC_CHECK: 5,
    HUMAN_CONFIRMATION: 4,
    SYSTEM_OBSERVATION: 3,
    SOURCE_PASSAGE: 2,
  });

function sameScope(left = {}, right = {}) {
  return (
    left.profileScope === right.profileScope &&
    (left.workspaceId ?? null) ===
      (right.workspaceId ?? null) &&
    (left.projectId ?? null) ===
      (right.projectId ?? null) &&
    left.purpose === right.purpose
  );
}

function evidenceAttested(
  item,
  options = {}
) {
  if (
    item.verificationStatus !== "VERIFIED"
  ) {
    return false;
  }

  if (
    item.authority === "AGENT" ||
    item.kind === "LLM_ASSERTION" ||
    item.kind === "INFERENCE"
  ) {
    return false;
  }

  const authorities =
    V2_ATTESTATION_AUTHORITIES[
      item.kind
    ];

  if (
    !authorities?.includes(item.authority)
  ) {
    return false;
  }

  if (
    !String(
      item.provenance?.producer || ""
    ).trim() ||
    !String(
      item.provenance?.method || ""
    ).trim()
  ) {
    return false;
  }

  const attestations =
    options.attestedEvidenceIds;

  if (attestations instanceof Set) {
    return attestations.has(
      item.evidenceId
    );
  }

  if (Array.isArray(attestations)) {
    return attestations.some(
      (evidenceId) =>
        String(evidenceId) ===
        item.evidenceId
    );
  }

  return false;
}

function evidenceEligibilityV2(
  item,
  request,
  options = {}
) {
  if (!sameScope(item.scope, request.scope)) {
    return {
      eligible: false,
      reasonCode: "EVIDENCE_SCOPE_MISMATCH",
      stale: false,
    };
  }

  if (
    options.remote === true &&
    (
      item.localOnly === true ||
      item.allowedForRemoteModel === false
    )
  ) {
    return {
      eligible: false,
      reasonCode: "EVIDENCE_PRIVACY_BLOCKED",
      stale: false,
    };
  }

  if (!evidenceAttested(item, options)) {
    return {
      eligible: false,
      reasonCode: "EVIDENCE_NOT_ATTESTED",
      stale: false,
    };
  }

  const evaluationAt =
    Date.parse(request.evaluationAt);

  const observedAt =
    item.observedAt == null
      ? null
      : Date.parse(item.observedAt);

  const validUntil =
    item.validUntil == null
      ? null
      : Date.parse(item.validUntil);

  if (
    observedAt !== null &&
    observedAt > evaluationAt
  ) {
    return {
      eligible: false,
      reasonCode: "EVIDENCE_FROM_FUTURE",
      stale: false,
    };
  }

  if (
    validUntil !== null &&
    validUntil < evaluationAt
  ) {
    return {
      eligible: false,
      reasonCode: "EVIDENCE_EXPIRED",
      stale: true,
    };
  }

  if (
    observedAt === null &&
    ![
      "EVERGREEN",
      "HISTORICAL",
    ].includes(item.freshnessRequirement)
  ) {
    return {
      eligible: false,
      reasonCode:
        "EVIDENCE_FRESHNESS_UNKNOWN",
      stale: false,
    };
  }

  return {
    eligible: true,
    reasonCode: null,
    stale: false,
  };
}

function applyEvidenceDependencyEligibilityV2(
  entries
) {
  let current = entries.map(
    (entry) => ({
      ...entry,
    })
  );

  let changed = true;

  while (changed) {
    changed = false;

    const byId = new Map(
      current.map((entry) => [
        entry.item.evidenceId,
        entry,
      ])
    );

    current = current.map((entry) => {
      if (!entry.eligible) {
        return entry;
      }

      const dependencies = [
        ...(entry.item
          .derivedFromEvidenceIds || []),
      ];

      const provenanceRoot =
        entry.item.provenance
          ?.rootEvidenceId;

      if (
        provenanceRoot != null &&
        !dependencies.includes(
          provenanceRoot
        )
      ) {
        dependencies.push(
          provenanceRoot
        );
      }

      const excludedDependency =
        dependencies.some(
          (evidenceId) =>
            byId.get(evidenceId)
              ?.eligible !== true
        );

      if (!excludedDependency) {
        return entry;
      }

      changed = true;

      return {
        ...entry,
        eligible: false,
        stale: false,
        reasonCode:
          "EVIDENCE_DEPENDENCY_EXCLUDED",
      };
    });
  }

  return current;
}

function collapseEvidenceV2(items) {
  const exact = new Map();
  const unique = [];
  let duplicate = 0;

  for (
    const item of [...items].sort(
      (a, b) =>
        a.evidenceId.localeCompare(
          b.evidenceId
        )
    )
  ) {
    const key = fingerprint({
      claimFingerprint:
        item.claimFingerprint,
      optionId: item.optionId,
      criterionId: item.criterionId,
      stance: item.stance,
      scope: item.scope,
      observedAt: item.observedAt ?? null,
      validUntil: item.validUntil ?? null,
    });

    if (exact.has(key)) {
      duplicate += 1;
      continue;
    }

    exact.set(key, item.evidenceId);
    unique.push(item);
  }

  const parent = new Map(
    unique.map((item) => [
      item.evidenceId,
      item.evidenceId,
    ])
  );

  function find(id) {
    const current = parent.get(id);

    if (current === undefined) {
      return null;
    }

    if (current === id) {
      return id;
    }

    const root = find(current);

    parent.set(id, root);

    return root;
  }

  function union(leftId, rightId) {
    const left = find(leftId);
    const right = find(rightId);

    if (
      left == null ||
      right == null ||
      left === right
    ) {
      return;
    }

    const [root, child] =
      left.localeCompare(right) <= 0
        ? [left, right]
        : [right, left];

    parent.set(child, root);
  }

  const byIndependenceKey =
    new Map();

  for (const item of unique) {
    const key = [
      item.claimId,
      item.optionId,
      item.criterionId,
      item.independenceKey,
    ].join("\u0000");

    if (
      byIndependenceKey.has(key)
    ) {
      union(
        item.evidenceId,
        byIndependenceKey.get(key)
      );
    } else {
      byIndependenceKey.set(
        key,
        item.evidenceId
      );
    }
  }

  for (const item of unique) {
    for (
      const dependencyId of
        item.derivedFromEvidenceIds || []
    ) {
      union(
        item.evidenceId,
        dependencyId
      );
    }

    const provenanceRoot =
      item.provenance?.rootEvidenceId;

    if (provenanceRoot != null) {
      union(
        item.evidenceId,
        provenanceRoot
      );
    }
  }

  const groups = new Map();

  for (const item of unique) {
    const root =
      find(item.evidenceId);

    if (!groups.has(root)) {
      groups.set(root, []);
    }

    groups.get(root).push(item);
  }

  const roots = [];
  let dependent = 0;

  for (const group of groups.values()) {
    const ordered = [...group].sort(
      (a, b) =>
        (
          V2_EVIDENCE_RANK[b.kind] ||
          0
        ) -
          (
            V2_EVIDENCE_RANK[a.kind] ||
            0
          ) ||
        a.evidenceId.localeCompare(
          b.evidenceId
        )
    );

    roots.push(ordered[0]);

    dependent +=
      ordered.length - 1;
  }

  roots.sort((a, b) =>
    a.evidenceId.localeCompare(
      b.evidenceId
    )
  );

  return {
    roots,
    duplicate,
    dependent,
  };
}

function evidenceIntervalsOverlap(
  left,
  right
) {
  const leftStart =
    left.observedAt == null
      ? Number.NEGATIVE_INFINITY
      : Date.parse(left.observedAt);

  const rightStart =
    right.observedAt == null
      ? Number.NEGATIVE_INFINITY
      : Date.parse(right.observedAt);

  const leftEnd =
    left.validUntil == null
      ? Number.POSITIVE_INFINITY
      : Date.parse(left.validUntil);

  const rightEnd =
    right.validUntil == null
      ? Number.POSITIVE_INFINITY
      : Date.parse(right.validUntil);

  return (
    leftStart <= rightEnd &&
    rightStart <= leftEnd
  );
}

function detectConflictsV2(
  roots,
  request
) {
  const byClaim = new Map();

  for (const item of roots) {
    if (!byClaim.has(item.claimId)) {
      byClaim.set(item.claimId, []);
    }

    byClaim.get(item.claimId).push(item);
  }

  const conflicts = [];

  for (
    const [claimId, group]
      of [...byClaim.entries()]
      .sort(([a], [b]) =>
        a.localeCompare(b)
      )
  ) {
    let incompatible = false;
    let valueConflict = false;

    for (let i = 0; i < group.length; i += 1) {
      for (
        let j = i + 1;
        j < group.length;
        j += 1
      ) {
        const left = group[i];
        const right = group[j];

        if (
          left.independenceKey ===
            right.independenceKey ||
          !evidenceIntervalsOverlap(
            left,
            right
          )
        ) {
          continue;
        }

        const leftValue =
          left.value === undefined
            ? null
            : left.value;

        const rightValue =
          right.value === undefined
            ? null
            : right.value;

        const valuesDiffer =
          leftValue !== null &&
          rightValue !== null &&
          JSON.stringify(stable(leftValue)) !==
            JSON.stringify(
              stable(rightValue)
            );

        const stancesConflict =
          new Set([
            left.stance,
            right.stance,
          ]).has("SUPPORTS") &&
          new Set([
            left.stance,
            right.stance,
          ]).has("OPPOSES");

        if (
          valuesDiffer ||
          stancesConflict
        ) {
          incompatible = true;
          valueConflict ||= valuesDiffer;
        }
      }
    }

    if (!incompatible) continue;

    const sample = group[0];

    const criterion =
      request.criteria.find(
        (item) =>
          item.criterionId ===
          sample.criterionId
      );

    const hard = request.constraints.some(
      (constraint) =>
        constraint.strength === "HARD" &&
        constraint.criterionId ===
          sample.criterionId &&
        (
          constraint.optionId == null ||
          constraint.optionId ===
            sample.optionId
        )
    );

    const material =
      hard ||
      criterion?.importance ===
        "CRITICAL";

    const evidenceIds = group
      .map((item) => item.evidenceId)
      .sort();

    conflicts.push({
      conflictId:
        "conflict-" +
        fingerprint({
          claimId,
          evidenceIds,
        }).slice(0, 20),
      claimId,
      type: valueConflict
        ? "VALUE_CONFLICT"
        : "STATUS_CONFLICT",
      evidenceIds,
      material,
    });
  }

  return conflicts;
}

function evaluateConstraintsV2(
  request,
  roots
) {
  const results = [];

  for (const constraint of request.constraints) {
    const targets =
      constraint.optionId == null
        ? request.options
        : request.options.filter(
            (option) =>
              option.optionId ===
              constraint.optionId
          );

    for (const option of targets) {
      const evidence = roots.filter(
        (item) =>
          item.optionId ===
            option.optionId &&
          item.criterionId ===
            constraint.criterionId
      );

      const states = evidence
        .filter(
          (item) =>
            item.value !== undefined &&
            item.value !== null
        )
        .map((item) =>
          meetsConstraintV2(
            item.value,
            constraint
          )
        )
        .filter(
          (value) =>
            value === true ||
            value === false
        );

      let status = "UNKNOWN";
      let reasonCodes = [
        "EVIDENCE_REQUIRED",
      ];

      if (
        states.includes(true) &&
        states.includes(false)
      ) {
        reasonCodes = [
          "CONFLICTING_EVIDENCE",
        ];
      } else if (states.includes(false)) {
        status = "VIOLATED";
        reasonCodes = [
          constraint.strength === "HARD"
            ? "HARD_CONSTRAINT_VIOLATED"
            : "SOFT_CONSTRAINT_VIOLATED",
        ];
      } else if (states.includes(true)) {
        status = "SATISFIED";
        reasonCodes = [
          "CONSTRAINT_VERIFIED",
        ];
      }

      results.push({
        constraintId:
          constraint.constraintId,
        optionId: option.optionId,
        status,
        reasonCodes,
      });
    }
  }

  return results.sort(
    (a, b) =>
      a.constraintId.localeCompare(
        b.constraintId
      ) ||
      a.optionId.localeCompare(
        b.optionId
      )
  );
}

function optionConstraintStateV2(
  optionId,
  constraints,
  request
) {
  const hardIds = new Set(
    request.constraints
      .filter(
        (item) =>
          item.strength === "HARD" &&
          (
            item.optionId == null ||
            item.optionId === optionId
          )
      )
      .map((item) => item.constraintId)
  );

  const relevant = constraints.filter(
    (item) =>
      item.optionId === optionId &&
      hardIds.has(item.constraintId)
  );

  if (
    relevant.some(
      (item) =>
        item.status === "VIOLATED"
    )
  ) {
    return "VIOLATED";
  }

  if (
    relevant.some(
      (item) =>
        item.status === "UNKNOWN"
    )
  ) {
    return "UNKNOWN";
  }

  return "SATISFIED";
}

function comparisonHasVerifiedAdvantage(
  first,
  second
) {
  if (!second) return true;

  const advantages = [];

  for (const left of first.evaluations) {
    const right =
      second.evaluations.find(
        (item) =>
          item.criterionId ===
          left.criterionId
      );

    if (
      !right ||
      left.assessment === "UNKNOWN" ||
      right.assessment === "UNKNOWN"
    ) {
      continue;
    }

    if (
      ASSESSMENTS[left.assessment] >
      ASSESSMENTS[right.assessment]
    ) {
      advantages.push({
        left,
        right,
      });
    }
  }

  if (!advantages.length) {
    return false;
  }

  return advantages.every(
    ({ left, right }) =>
      left.hasEligibleEvidence &&
      right.hasEligibleEvidence
  );
}

function uniqueWinnerForRootsV2(
  request,
  roots,
  constraintState
) {
  const evaluated =
    request.options.map((option) =>
      evaluateOptionV2(
        option,
        request.criteria,
        roots
      )
    );

  const feasible =
    evaluated
      .filter(
        (item) =>
          constraintState[
            item.optionId
          ] === "SATISFIED" &&
          item.supportScore !== null
      )
      .sort(
        (a, b) =>
          b.supportScore -
            a.supportScore ||
          a.optionId.localeCompare(
            b.optionId
          )
      );

  if (!feasible.length) {
    return null;
  }

  if (
    feasible.length > 1 &&
    feasible[0].supportScore ===
      feasible[1].supportScore
  ) {
    return null;
  }

  return feasible[0].optionId;
}

function conflictCanChangeWinnerV2(
  conflict,
  roots,
  request,
  constraintState
) {
  const evidenceIds =
    new Set(conflict.evidenceIds);

  const alternatives =
    roots
      .filter((item) =>
        evidenceIds.has(
          item.evidenceId
        )
      )
      .sort((a, b) =>
        a.evidenceId.localeCompare(
          b.evidenceId
        )
      );

  if (alternatives.length < 2) {
    return false;
  }

  const stableRoots =
    roots.filter(
      (item) =>
        !evidenceIds.has(
          item.evidenceId
        )
    );

  const winners = new Set();

  for (
    const alternative of alternatives
  ) {
    winners.add(
      uniqueWinnerForRootsV2(
        request,
        [
          ...stableRoots,
          alternative,
        ],
        constraintState
      )
    );
  }

  return winners.size > 1;
}

function materializeConflictsV2(
  conflicts,
  roots,
  request,
  constraintState
) {
  return conflicts
    .map((conflict) => {
      if (conflict.material) {
        return conflict;
      }

      return {
        ...conflict,
        material:
          conflictCanChangeWinnerV2(
            conflict,
            roots,
            request,
            constraintState
          ),
      };
    })
    .sort((a, b) =>
      a.conflictId.localeCompare(
        b.conflictId
      )
    );
}

function compareDecisionV2(
  raw,
  options = {}
) {
  const request =
    normalizeDecisionRequestV2(raw);

  const eligibility =
    applyEvidenceDependencyEligibilityV2(
      request.evidence.map((item) => ({
        item,
        ...evidenceEligibilityV2(
          item,
          request,
          options
        ),
      }))
    );

  const excluded =
    eligibility.filter(
      (item) => !item.eligible
    );

  const collapsed =
    collapseEvidenceV2(
      eligibility
        .filter((item) => item.eligible)
        .map((item) => item.item)
    );

  const roots = collapsed.roots;

  const constraints =
    evaluateConstraintsV2(
      request,
      roots
    );

  const detectedConflicts =
    detectConflictsV2(
      roots,
      request
    );

  const evaluated =
    request.options.map((option) =>
      evaluateOptionV2(
        option,
        request.criteria,
        roots
      )
    );

  const byOption =
    new Map(
      evaluated.map((item) => [
        item.optionId,
        item,
      ])
    );

  const constraintState =
    Object.fromEntries(
      request.options.map((option) => [
        option.optionId,
        optionConstraintStateV2(
          option.optionId,
          constraints,
          request
        ),
      ])
    );

  const conflicts =
    materializeConflictsV2(
      detectedConflicts,
      roots,
      request,
      constraintState
    );

  const ranked = [...evaluated].sort(
    (a, b) => {
      const stateRank = {
        SATISFIED: 2,
        UNKNOWN: 1,
        VIOLATED: 0,
      };

      return (
        stateRank[
          constraintState[b.optionId]
        ] -
          stateRank[
            constraintState[a.optionId]
          ] ||
        (b.supportScore ?? -1) -
          (a.supportScore ?? -1) ||
        a.optionId.localeCompare(
          b.optionId
        )
      );
    }
  );

  const rankedOptions =
    ranked.map((item, index) => ({
      optionId: item.optionId,
      rank: index + 1,
      supportScore:
        item.supportScore,
      evidenceCoverage:
        item.evidenceCoverage,
      constraintState:
        constraintState[item.optionId],
    }));

  const unknowns = [];
  const seenUnknowns = new Set();

  function pushUnknown({
    claimId,
    optionId,
    criterionId,
    reasonCode,
  }) {
    if (!claimId) return;

    const key = [
      claimId,
      optionId,
      criterionId,
      reasonCode,
    ].join("\u0000");

    if (seenUnknowns.has(key)) return;
    seenUnknowns.add(key);

    unknowns.push({
      unknownId:
        "unknown-" +
        fingerprint({
          claimId,
          optionId,
          criterionId,
          reasonCode,
        }).slice(0, 20),
      claimId,
      optionId,
      criterionId,
      reasonCode,
    });
  }

  for (const entry of excluded) {
    pushUnknown({
      claimId: entry.item.claimId,
      optionId: entry.item.optionId,
      criterionId:
        entry.item.criterionId,
      reasonCode: entry.reasonCode,
    });
  }

  for (const item of constraints) {
    if (item.status !== "UNKNOWN") {
      continue;
    }

    const constraint =
      request.constraints.find(
        (candidate) =>
          candidate.constraintId ===
          item.constraintId
      );

    const claim =
      request.evidence
        .filter(
          (evidence) =>
            evidence.optionId ===
              item.optionId &&
            evidence.criterionId ===
              constraint?.criterionId
        )
        .sort((a, b) =>
          a.evidenceId.localeCompare(
            b.evidenceId
          )
        )[0];

    pushUnknown({
      claimId: claim?.claimId,
      optionId: item.optionId,
      criterionId:
        constraint?.criterionId,
      reasonCode:
        "HARD_CONSTRAINT_UNKNOWN",
    });
  }

  unknowns.sort(
    (a, b) =>
      a.unknownId.localeCompare(
        b.unknownId
      )
  );

  const materialConflicts =
    conflicts.filter(
      (item) => item.material
    );

  const feasible =
    ranked.filter(
      (item) =>
        constraintState[item.optionId] ===
          "SATISFIED" &&
        item.supportScore !== null
    );

  const first = feasible[0] || null;
  const second = feasible[1] || null;

  const strictAdvantage =
    Boolean(first) &&
    (
      !second ||
      first.supportScore >
        second.supportScore
    );

  const topCriticalUnknown =
    first
      ? first.evaluations.some(
          (cell) =>
            request.criteria.find(
              (criterion) =>
                criterion.criterionId ===
                cell.criterionId
            )?.importance === "CRITICAL" &&
            cell.assessment === "UNKNOWN"
        )
      : true;

  const topRequiredEvidenceMissing =
    first
      ? first.evaluations.some(
          (cell) =>
            request.criteria.find(
              (criterion) =>
                criterion.criterionId ===
                cell.criterionId
            )?.requiredEvidence ===
              "VERIFIED" &&
            !cell.hasEligibleEvidence
        )
      : true;

  const advantageVerified =
    first
      ? comparisonHasVerifiedAdvantage(
          first,
          second
        )
      : false;

  const canDecide =
    Boolean(first) &&
    strictAdvantage &&
    !topCriticalUnknown &&
    !topRequiredEvidenceMissing &&
    advantageVerified &&
    materialConflicts.length === 0;

  const unresolvedClaims =
    new Set([
      ...unknowns.map(
        (item) => item.claimId
      ),
      ...conflicts.map(
        (item) => item.claimId
      ),
    ]);

  let proposals =
    request.verificationProposals.filter(
      (proposal) =>
        unresolvedClaims.size === 0 ||
        proposal.resolvesClaimIds.some(
          (claimId) =>
            unresolvedClaims.has(claimId)
        )
    );

  proposals = [...proposals].sort(
    (a, b) =>
      a.verificationId.localeCompare(
        b.verificationId
      )
  );

  const budgetExhausted =
    request.budget?.state ===
    "EXHAUSTED";

  let verdict;
  let stopReason;
  let reasonCodes;

  if (materialConflicts.length) {
    verdict = "CONFLICT";
    stopReason = "MATERIAL_CONFLICT";
    reasonCodes = [
      "MATERIAL_CONFLICT",
    ];
  } else if (canDecide) {
    verdict = "DECIDED";
    stopReason = "DECISION_COMPLETE";
    reasonCodes = [
      "CLEAR_ADVANTAGE",
      "EVIDENCE_SUFFICIENT",
      "MEETS_ALL_HARD_CONSTRAINTS",
    ];
    proposals = [];
  } else if (budgetExhausted) {
    verdict =
      "INSUFFICIENT_EVIDENCE";
    stopReason = "BUDGET_EXHAUSTED";
    reasonCodes = [
      "BUDGET_EXHAUSTED",
    ];
  } else if (
    first &&
    second &&
    first.supportScore ===
      second.supportScore
  ) {
    if (proposals.length) {
      verdict =
        "NEEDS_MORE_EVIDENCE";
    } else {
      verdict =
        "INSUFFICIENT_EVIDENCE";
    }

    stopReason = "NO_CLEAR_ADVANTAGE";
    reasonCodes = [
      "NO_CLEAR_ADVANTAGE",
    ];
  } else if (proposals.length) {
    verdict =
      "NEEDS_MORE_EVIDENCE";
    stopReason =
      "REQUIRED_EVIDENCE_MISSING";
    reasonCodes = [
      "REQUIRED_EVIDENCE_MISSING",
    ];
  } else {
    verdict =
      "INSUFFICIENT_EVIDENCE";

    const allViolated =
      request.options.every(
        (option) =>
          constraintState[
            option.optionId
          ] === "VIOLATED"
      );

    stopReason = allViolated
      ? "NO_FEASIBLE_OPTION"
      : "NO_AUTHORIZABLE_VERIFICATION";

    reasonCodes = [stopReason];
  }

  const supportScore =
    Object.fromEntries(
      request.options
        .map((option) => [
          option.optionId,
          byOption.get(
            option.optionId
          )?.supportScore ?? null,
        ])
        .sort(([a], [b]) =>
          a.localeCompare(b)
        )
    );

  const coverage =
    Object.fromEntries(
      request.options
        .map((option) => [
          option.optionId,
          byOption.get(
            option.optionId
          )?.evidenceCoverage ?? 0,
        ])
        .sort(([a], [b]) =>
          a.localeCompare(b)
        )
    );

  const criticalCriteria =
    request.criteria.filter(
      (criterion) =>
        criterion.importance ===
        "CRITICAL"
    );

  const criticalCellsComplete =
    criticalCriteria.every(
      (criterion) =>
        request.options.every(
          (option) =>
            roots.some(
              (evidence) =>
                evidence.optionId ===
                  option.optionId &&
                evidence.criterionId ===
                  criterion.criterionId
            )
        )
    );

  const rawResult = {
    schemaVersion: 2,
    engineVersion:
      V2_ENGINE_VERSION,
    decisionId: request.decisionId,
    verdict,
    recommendedOptionId:
      verdict === "DECIDED"
        ? first.optionId
        : null,
    reasonCodes: [
      ...new Set(reasonCodes),
    ].sort(),
    rankedOptions,
    constraints,
    unknowns,
    conflicts,
    verificationProposals:
      proposals,
    stopReason,
    evidenceSummary: {
      eligible: roots.length,
      excluded: excluded.length,
      stale: excluded.filter(
        (item) => item.stale
      ).length,
      duplicate:
        collapsed.duplicate,
      dependent:
        collapsed.dependent,
    },
    supportScore: {
      scale:
        "ORDINAL_0_4_WEIGHTED",
      byOption: supportScore,
      calibratedProbability: null,
      calibrationStatus:
        "NOT_CALIBRATED",
    },
    evidenceCoverage: {
      byOption: coverage,
      criticalCellsComplete,
    },
    recommendationIsAction: false,
    actionAuthorized: false,
    verificationAuthorized: false,
    decisionContextFingerprint:
      fingerprintDecisionContextV2(
        request
      ),
    publicMetadata: {
      optionCount:
        request.options.length,
      criterionCount:
        request.criteria.length,
      evidenceCount:
        request.evidence.length,
      eligibleEvidenceCount:
        roots.length,
      conflictCount:
        conflicts.length,
      unknownCount:
        unknowns.length,
      hasConflict:
        conflicts.length > 0,
    },
  };

  return normalizeDecisionResultV2(
    rawResult,
    request
  );
}

function createDecisionSupportEngine({ history = createDecisionHistoryService(), audit = null, now = () => new Date(), featureMode = "SHADOW", maxCache = 100 } = {}) {
  const cache = new Map(); const metrics = { decisions: 0, cacheHits: 0, searchRequests: 0, actionsExecuted: 0 };
  function compare(raw, options = {}) {
    if (raw?.schemaVersion === 2) {
      const result = compareDecisionV2(
        raw,
        options
      );

      metrics.decisions += 1;

      audit?.(
        "decision.v2-evaluated",
        {
          engineVersion:
            result.engineVersion,
          verdict: result.verdict,
          optionCount:
            result.publicMetadata.optionCount,
          criterionCount:
            result.publicMetadata
              .criterionCount,
          evidenceCount:
            result.publicMetadata
              .evidenceCount,
          conflictCount:
            result.publicMetadata
              .conflictCount,
          unknownCount:
            result.publicMetadata
              .unknownCount,
          decisionRef:
            fingerprint(
              result.decisionId
            ).slice(0, 12),
        }
      );

      return structuredClone(result);
    }

    const started = performance.now(); const request = normalizeDecisionRequest(raw);
    const criteriaStarted = performance.now(); const criteria = resolveCriteria(request); const criteriaResolutionMs = performance.now() - criteriaStarted;
    const evidence = filterEvidence(request, options); const evidenceById = new Map(evidence.map((item) => [item.evidenceId, item]));
    const contextFingerprint = fingerprint({ workspaceId: request.workspaceId, projectId: request.projectId, profileScope: request.profileScope,
      options: request.options, criteria, evidence, contextVersion: request.contextVersion, engine: ENGINE_VERSION });
    const cached = cache.get(contextFingerprint); if (cached) { metrics.cacheHits += 1; return structuredClone(cached); }
    const evaluationStarted = performance.now(); const evaluated = request.options.map((option) => evaluateOption(option, criteria, evidenceById));
    const unknowns = evaluated.flatMap((item) => item.evaluations.filter((entry) => entry.assessment === "UNKNOWN").map((entry) => ({ optionId: item.option.optionId, criterionId: entry.criterionId })));
    const importantUnknowns = unknowns.filter((unknown) => ["HIGH", "CRITICAL"].includes(criteria.find((item) => item.criterionId === unknown.criterionId)?.importance));
    const noOptionCanBeCompared = evaluated.every((item) =>
      item.evaluations.filter((entry) => ["HIGH", "CRITICAL"].includes(criteria.find((criterion) => criterion.criterionId === entry.criterionId)?.importance))
        .every((entry) => entry.assessment === "UNKNOWN")
    );
    const evidenceState = criteria.length === 0 || noOptionCanBeCompared ? "INSUFFICIENT" : unknowns.length ? "PARTIAL" : "SUFFICIENT";
    const uncertainty = { state: evidenceState, unknownCriteria: unknowns, staleEvidenceRefs: evidence.filter((item) => item.stale).map((item) => item.evidenceId),
      conflicts: evidence.filter((item) => item.conflict).map((item) => item.evidenceId) };
    const tradeoffs = keyTradeoffs(evaluated, criteria);
    const resolvedRecommendation = recommendation(evaluated, request, uncertainty, tradeoffs);
    const rankedOptions = [...evaluated].sort((a, b) => (b.comparisonIndex ?? -1) - (a.comparisonIndex ?? -1) || a.option.label.localeCompare(b.option.label, "fr"))
      .map((item, index) => ({ rank: item.comparisonIndex === null ? null : index + 1, optionId: item.option.optionId, label: item.option.label,
        status: item.option.status, comparisonBand: item.comparisonIndex === null ? "UNKNOWN" : item.comparisonIndex >= 3 ? "STRONG" : item.comparisonIndex >= 2 ? "BALANCED" : "WEAK",
        evidenceCoverage: item.evidenceCoverage }));
    const result = Object.freeze({ schemaVersion: 1, engineVersion: ENGINE_VERSION, decisionId: request.decisionId, decisionType: request.decisionType,
      status: uncertainty.staleEvidenceRefs.length ? "STALE" : "READY", recommendationType: resolvedRecommendation.type,
      recommendedOptionId: resolvedRecommendation.recommendedOptionId, reasonCodes: resolvedRecommendation.reasonCodes,
      rankedOptions, options: evaluated.map((item) => item.option), criteria, evaluations: evaluated.flatMap((item) => item.evaluations),
      keyTradeoffs: tradeoffs, uncertainties: uncertainty, assumptions: request.options.flatMap((item) => item.assumptions),
      risks: request.options.flatMap((option) => (option.metadata?.risks || []).slice(0, 20).map((risk, index) => ({
        riskId: risk.riskId || `${option.optionId}:risk:${index}`, optionId: option.optionId, category: risk.category || "OTHER",
        likelihood: ["LOW", "MEDIUM", "HIGH", "UNKNOWN"].includes(risk.likelihood) ? risk.likelihood : "UNKNOWN",
        impact: ["LOW", "MEDIUM", "HIGH", "UNKNOWN"].includes(risk.impact) ? risk.impact : "UNKNOWN",
        confidence: ["LOW", "MEDIUM", "HIGH", "UNKNOWN"].includes(risk.confidence) ? risk.confidence : "UNKNOWN",
        mitigation: risk.mitigation ? String(risk.mitigation).slice(0, 500) : null, evidenceRefs: (risk.evidenceRefs || []).filter((ref) => evidenceById.has(ref)),
      }))),
      blockers: evaluated.flatMap((item) => item.blockers.map((blocker) => ({ optionId: item.option.optionId, ...blocker }))),
      evidenceRefs: evidence.map((item) => item.evidenceId), citations: evidence.filter((item) => item.locator).map((item) => ({ evidenceId: item.evidenceId, locator: item.locator })),
      nextActions: evidenceState === "INSUFFICIENT" ? [{ type: "VERIFY_FACT", criterionId: importantUnknowns[0]?.criterionId || null, proposedOnly: true }] : [{ type: "USER_DECIDES", proposedOnly: true }],
      decisionContextFingerprint: contextFingerprint, workspaceId: request.workspaceId, projectId: request.projectId, profileScope: request.profileScope,
      recommendationIsAction: false, actionAuthorized: false, preferenceInferred: false, featureMode,
      metrics: { optionsCount: request.options.length, criteriaCount: criteria.length, evidenceCount: evidence.length, unknownCriteriaCount: unknowns.length,
        criteriaResolutionMs, evidenceResolutionMs: 0, evaluationMs: performance.now() - evaluationStarted, totalMs: performance.now() - started, modelCalls: 0, searchCalls: 0, estimatedCostUsd: 0 } });
    metrics.decisions += 1; audit?.("decision.recommendation-created", { decisionId: request.decisionId, workspaceRef: request.workspaceId ? fingerprint(request.workspaceId).slice(0, 12) : null,
      optionsCount: request.options.length, criteriaCount: criteria.length, evidenceCount: evidence.length, unknownCriteriaCount: unknowns.length, recommendationType: result.recommendationType });
    cache.set(contextFingerprint, result); while (cache.size > maxCache) cache.delete(cache.keys().next().value);
    return structuredClone(result);
  }
  function sensitivity(raw, scenarios = []) { return scenarios.slice(0, 12).map((scenario) => {
    const criteria = (raw.explicitCriteria || raw.criteria || []).map((criterion) => ({ ...criterion, importance: scenario.overrides?.[criterion.criterionId] || scenario.overrides?.[criterion.type] || criterion.importance }));
    const result = compare({ ...raw, explicitCriteria: criteria, contextVersion: `${raw.contextVersion || "0"}:${fingerprint(scenario.overrides || {}).slice(0, 8)}` });
    return { scenarioId: scenario.scenarioId, recommendationType: result.recommendationType, recommendedOptionId: result.recommendedOptionId, decisionId: result.decisionId };
  }); }
  function recordChoice(input) { const record = history.recordChoice(input); audit?.("decision.record-created", { decisionId: record.decisionId, recordId: record.decisionRecordId }); return record; }
  function render(result, { channel = "chat" } = {}) {
    const recommended = result.options.find((item) => item.optionId === result.recommendedOptionId);
    const downside = result.keyTradeoffs.find((item) => item.optionA === result.recommendedOptionId || item.optionB === result.recommendedOptionId);
    if (channel === "voice") return {
      recommendation: recommended?.label || result.recommendationType,
      reasons: result.reasonCodes.slice(0, 3),
      mainDownside: downside || null,
      uncertainty: result.uncertainties.state,
    };
    return result;
  }
  function health() { return { status: "ok", featureMode, cacheEntries: cache.size, ...metrics, executionAuthority: false, persistentPreferenceInference: false }; }
  return { compare, health, history, recordChoice, render, sensitivity };
}

module.exports = {
  ENGINE_VERSION,
  V2_ENGINE_VERSION,
  compareDecisionV2,
  createDecisionSupportEngine,
  evidenceAttested,
  evidenceEligibilityV2,
  filterEvidence,
  fingerprint,
  resolveCriteria,
};
