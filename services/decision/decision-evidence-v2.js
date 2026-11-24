"use strict";

// V3-L7 — preuves du moteur d'aide à la décision V2 (forme stable et empreinte, autorités
// d'attestation, attestation, éligibilité, dépendances entre preuves, fusion), sorties telles
// quelles de decision-support-engine.js. Fonctions pures et constantes ;
// decision-support-engine.js réexporte les mêmes `fingerprint`, `evidenceAttested` et
// `evidenceEligibilityV2`.

const crypto = require("node:crypto");

function stable(value) { if (Array.isArray(value)) return value.map(stable); if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])); return value; }
function fingerprint(value) { return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }

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

module.exports = {
  stable,
  fingerprint,
  V2_ATTESTATION_AUTHORITIES,
  V2_EVIDENCE_RANK,
  sameScope,
  evidenceAttested,
  evidenceEligibilityV2,
  applyEvidenceDependencyEligibilityV2,
  collapseEvidenceV2,
};
