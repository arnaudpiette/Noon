"use strict";

const crypto = require("node:crypto");

const {
  normalizeDecisionRequestV2,
} = require("./decision-schema");

const {
  adaptNativeDevResult,
} = require("../dev/native-dev-result-adapter");

const ADAPTER_VERSION = "native-dev-evidence-v1";
const MAX_MAPPINGS = 100;
const SOURCE_KINDS = new Set(["TERMINAL", "IMPLEMENTATION"]);

function digest(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

function id(prefix, value) {
  return `${prefix}_${digest(value).slice(0, 24)}`;
}

function exactObject(value, field, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${field} doit être un objet.`);
  }

  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new TypeError(`${field}.${key} inattendu.`);
    }
  }

  return value;
}

function requiredId(value, field) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 160) {
    throw new TypeError(`${field} invalide.`);
  }

  return value.trim();
}

function normalizeContext(raw) {
  exactObject(raw, "context", ["decisionRequest"]);

  const request = normalizeDecisionRequestV2(raw.decisionRequest);

  if (request.scope.purpose !== "LOCAL_ANALYSIS") {
    throw new TypeError(
      "La projection DEV est limitée à LOCAL_ANALYSIS."
    );
  }

  return request;
}

function rawWorkspaceId(devResult) {
  const value = devResult?.analysis?.contract?.workspaceId;

  return typeof value === "string" && value.trim()
    ? value.trim()
    : null;
}

function sourceIdentity(kind, snapshot) {
  if (kind === "TERMINAL") {
    return "terminal-review";
  }

  return snapshot.observationRef;
}

function sourceAttestable(kind, snapshot) {
  const linked =
    snapshot?.localOnly === true
    && snapshot.bindingState === "LINKED"
    && snapshot.snapshotCoverage === "GIT_VISIBLE_COMPLETE"
    && typeof snapshot.snapshotRef === "string"
    && ["PASS", "FAIL"].includes(snapshot.validationStatus);

  if (!linked) {
    return false;
  }

  if (kind === "IMPLEMENTATION") {
    return snapshot.terminalSnapshotMatch === "MATCH";
  }

  return true;
}

function stanceForStatus(status) {
  if (status === "PASS") {
    return "SUPPORTS";
  }

  if (status === "FAIL") {
    return "OPPOSES";
  }

  return "NEUTRAL";
}

function valueForStatus(status) {
  if (status === "PASS") {
    return true;
  }

  if (status === "FAIL") {
    return false;
  }

  return null;
}

function validateSourceShape(kind, snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new TypeError("Snapshot DEV sélectionné invalide.");
  }

  if (
    snapshot.localOnly !== true
    || typeof snapshot.taskRef !== "string"
    || !/^native_dev_task_[a-f0-9]{32}$/.test(snapshot.taskRef)
    || typeof snapshot.workspaceRef !== "string"
    || !/^native_dev_workspace_[a-f0-9]{32}$/.test(snapshot.workspaceRef)
    || (
      snapshot.sessionRef !== null
      && (
        typeof snapshot.sessionRef !== "string"
        || !/^native_dev_session_[a-f0-9]{32}$/.test(snapshot.sessionRef)
      )
    )
  ) {
    throw new TypeError("Identité canonique du snapshot DEV invalide.");
  }

  if (
    kind === "TERMINAL"
    && snapshot.validationKind !== "TERMINAL_REVIEW_VALIDATION"
  ) {
    throw new TypeError("Snapshot terminal DEV invalide.");
  }

  if (
    kind === "IMPLEMENTATION"
    && (
      snapshot.validationKind !== "IMPLEMENTATION_VALIDATION"
      || typeof snapshot.observationRef !== "string"
      || !/^native_dev_validation_[a-f0-9]{32}$/.test(snapshot.observationRef)
      || !["MATCH", "DIFFERENT", "UNKNOWN"].includes(snapshot.terminalSnapshotMatch)
    )
  ) {
    throw new TypeError("Snapshot d'implémentation DEV invalide.");
  }

  return snapshot;
}

function normalizeMappings(rawMappings, request, adapted) {
  if (
    !Array.isArray(rawMappings)
    || rawMappings.length < 1
    || rawMappings.length > MAX_MAPPINGS
  ) {
    throw new TypeError(
      `mappings doit contenir entre 1 et ${MAX_MAPPINGS} éléments.`
    );
  }

  const optionIds = new Set(
    request.options.map((item) => item.optionId)
  );
  const criterionIds = new Set(
    request.criteria.map((item) => item.criterionId)
  );
  const implementationByRef = new Map(
    (Array.isArray(adapted.implementationValidationSnapshots)
      ? adapted.implementationValidationSnapshots
      : [])
      .map((item) => [item.observationRef, item])
  );

  const usedSources = new Set();
  const usedTargets = new Set();

  return rawMappings
    .map((raw, index) => {
      exactObject(raw, `mappings[${index}]`, [
        "source",
        "observationRef",
        "optionId",
        "criterionId",
      ]);

      const source =
        typeof raw.source === "string"
          ? raw.source.trim().toUpperCase()
          : "";

      if (!SOURCE_KINDS.has(source)) {
        throw new TypeError(`mappings[${index}].source invalide.`);
      }

      const optionId = requiredId(
        raw.optionId,
        `mappings[${index}].optionId`
      );
      const criterionId = requiredId(
        raw.criterionId,
        `mappings[${index}].criterionId`
      );

      if (!optionIds.has(optionId)) {
        throw new TypeError(
          `mappings[${index}].optionId ne référence aucune option Decision V2.`
        );
      }

      if (!criterionIds.has(criterionId)) {
        throw new TypeError(
          `mappings[${index}].criterionId ne référence aucun critère Decision V2.`
        );
      }

      let snapshot;
      let selector;

      if (source === "TERMINAL") {
        if (raw.observationRef !== undefined && raw.observationRef !== null) {
          throw new TypeError(
            `mappings[${index}].observationRef interdit pour TERMINAL.`
          );
        }

        snapshot = adapted.validationSnapshot;
        selector = "TERMINAL";
      } else {
        const observationRef = requiredId(
          raw.observationRef,
          `mappings[${index}].observationRef`
        );

        if (!/^native_dev_validation_[a-f0-9]{32}$/.test(observationRef)) {
          throw new TypeError(
            `mappings[${index}].observationRef invalide.`
          );
        }

        snapshot = implementationByRef.get(observationRef);

        if (!snapshot) {
          throw new TypeError(
            `mappings[${index}] référence une observation DEV inexistante.`
          );
        }

        selector = observationRef;
      }

      validateSourceShape(source, snapshot);

      const sourceKey = `${source}\u0000${selector}`;
      const targetKey = `${optionId}\u0000${criterionId}`;

      if (usedSources.has(sourceKey)) {
        throw new TypeError(
          `mappings[${index}] réutilise une même validation DEV.`
        );
      }

      if (usedTargets.has(targetKey)) {
        throw new TypeError(
          `mappings[${index}] cible une cellule Decision V2 déjà liée.`
        );
      }

      usedSources.add(sourceKey);
      usedTargets.add(targetKey);

      return {
        source,
        selector,
        optionId,
        criterionId,
        snapshot,
      };
    })
    .sort(
      (left, right) =>
        left.optionId.localeCompare(right.optionId)
        || left.criterionId.localeCompare(right.criterionId)
        || left.source.localeCompare(right.source)
        || left.selector.localeCompare(right.selector)
    );
}

function deepFreeze(value) {
  if (
    !value
    || typeof value !== "object"
    || Object.isFrozen(value)
  ) {
    return value;
  }

  for (const child of Object.values(value)) {
    deepFreeze(child);
  }

  return Object.freeze(value);
}

function projectNativeDevEvidence({
  devResult,
  mappings,
  context,
} = {}) {
  if (!devResult || typeof devResult !== "object" || Array.isArray(devResult)) {
    throw new TypeError("Résultat Native DEV requis.");
  }

  const request = normalizeContext(context);
  const workspaceId = rawWorkspaceId(devResult);

  if (
    !workspaceId
    || request.scope.workspaceId == null
    || request.scope.workspaceId !== workspaceId
  ) {
    throw new TypeError(
      "Le workspace Native DEV ne correspond pas au scope Decision V2."
    );
  }

  const adapted = adaptNativeDevResult(devResult);
  const normalizedMappings =
    normalizeMappings(mappings, request, adapted);

  const evidence = normalizedMappings.map((mapping) => {
    const snapshot = mapping.snapshot;
    const attestable =
      sourceAttestable(mapping.source, snapshot);
    const status = snapshot.validationStatus;
    const sourceKey =
      sourceIdentity(mapping.source, snapshot);
    const claimSeed = {
      taskRef: snapshot.taskRef,
      optionId: mapping.optionId,
      criterionId: mapping.criterionId,
    };
    const evidenceSeed = {
      ...claimSeed,
      sourceKind: mapping.source,
      sourceKey,
      snapshotRef: snapshot.snapshotRef,
      validationStatus: status,
    };

    return {
      evidenceId: id("decision_evidence", evidenceSeed),
      claimId: id("decision_claim", claimSeed),
      optionId: mapping.optionId,
      criterionId: mapping.criterionId,
      stance: stanceForStatus(status),
      value: valueForStatus(status),
      kind: "SYSTEM_OBSERVATION",
      authority: "SYSTEM",
      verificationStatus: attestable
        ? "VERIFIED"
        : "UNVERIFIED",
      critical: false,
      provenance: {
        producer: "native-dev-result-adapter",
        sourceType: "native_dev_validation_snapshot",
        sourceRef: `native-dev:${snapshot.taskRef}`,
        locatorRef: mapping.source === "IMPLEMENTATION"
          ? `validation:${snapshot.observationRef}`
          : snapshot.snapshotRef == null
            ? "terminal:unavailable"
            : `terminal:${snapshot.snapshotRef}`,
        method: "canonical_snapshot_binding_projection",
        rootEvidenceId: null,
      },
      scope: request.scope,
      observedAt: null,
      validUntil: null,
      freshnessRequirement: "HISTORICAL",
      claimFingerprint: digest(evidenceSeed),
      independenceKey: digest({
        workspaceRef: snapshot.workspaceRef,
        snapshotRef: snapshot.snapshotRef,
      }),
      derivedFromEvidenceIds: [],
      localOnly: true,
      allowedForRemoteModel: false,
      untrustedContent: false,
    };
  });

  const attestedEvidenceIds = evidence
    .filter((item) => item.verificationStatus === "VERIFIED")
    .map((item) => item.evidenceId)
    .sort();

  const sourceDevRef =
    normalizedMappings[0]?.snapshot.taskRef || null;

  return deepFreeze({
    adapterVersion: ADAPTER_VERSION,
    sourceDevRef,
    evidence: evidence.sort(
      (left, right) =>
        left.evidenceId.localeCompare(right.evidenceId)
    ),
    attestedEvidenceIds,
    privacyLimitations: [
      "SNAPSHOT_HASH_IS_REFERENCE_NOT_ANONYMIZATION",
      "GIT_VISIBLE_COVERAGE_ONLY",
      "NO_OS_CONFINEMENT_CLAIM",
      "NO_TRANSIENT_MUTATION_ABSENCE_CLAIM",
    ],
  });
}

module.exports = {
  ADAPTER_VERSION,
  projectNativeDevEvidence,
};
