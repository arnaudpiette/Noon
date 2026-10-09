"use strict";

const crypto =
  require("node:crypto");

const ADAPTER_VERSION =
  "agent-evaluation-evidence-v1";

const STATUSES =
  new Set([
    "PASS",
    "WARNING",
    "FAIL",
    "UNKNOWN",
    "SKIPPED",
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

const FRESHNESS =
  new Set([
    "LIVE",
    "RECENT",
    "CURRENT",
    "EVERGREEN",
    "HISTORICAL",
  ]);

const PURPOSES =
  new Set([
    "LOCAL_ANALYSIS",
    "REMOTE_MODEL_CONTEXT",
  ]);

function clean(value, max = 160) {
  return String(value ?? "")
    .replace(/[\0\r\n]/g, " ")
    .trim()
    .slice(0, max);
}

function digest(value) {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify(value)
    )
    .digest("hex");
}

function id(prefix, value) {
  return `${prefix}_${digest(value).slice(0, 24)}`;
}

function iso(value, field) {
  const parsed =
    new Date(value);

  if (
    !value ||
    !Number.isFinite(
      parsed.getTime()
    )
  ) {
    throw new TypeError(
      `${field} ISO explicite requis.`
    );
  }

  return parsed.toISOString();
}

function nullableId(
  value,
  field
) {
  if (value === null) {
    return null;
  }

  if (value === undefined) {
    return undefined;
  }

  const normalized =
    clean(value, 160);

  if (!normalized) {
    throw new TypeError(
      `${field} invalide.`
    );
  }

  return normalized;
}

function normalizeScope(
  raw = {}
) {
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw)
  ) {
    throw new TypeError(
      "scope Decision invalide."
    );
  }

  const profileScope =
    clean(
      raw.profileScope,
      160
    );

  if (!profileScope) {
    throw new TypeError(
      "scope.profileScope requis."
    );
  }

  const purpose =
    clean(
      raw.purpose,
      80
    ).toUpperCase();

  if (!PURPOSES.has(purpose)) {
    throw new TypeError(
      "scope.purpose Decision invalide."
    );
  }

  return {
    profileScope,

    workspaceId:
      nullableId(
        raw.workspaceId,
        "scope.workspaceId"
      ),

    projectId:
      nullableId(
        raw.projectId,
        "scope.projectId"
      ),

    purpose,
  };
}

function normalizeContext(
  raw
) {
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw)
  ) {
    throw new TypeError(
      "Contexte Decision explicite requis."
    );
  }

  const optionId =
    clean(raw.optionId, 160);

  const criterionId =
    clean(
      raw.criterionId,
      160
    );

  if (!optionId) {
    throw new TypeError(
      "optionId Decision requis."
    );
  }

  if (!criterionId) {
    throw new TypeError(
      "criterionId Decision requis."
    );
  }

  const observedAt =
    iso(
      raw.observedAt,
      "observedAt"
    );

  const validUntil =
    raw.validUntil == null
      ? null
      : iso(
          raw.validUntil,
          "validUntil"
        );

  const freshnessRequirement =
    clean(
      raw.freshnessRequirement ||
        "CURRENT",
      40
    ).toUpperCase();

  if (
    !FRESHNESS.has(
      freshnessRequirement
    )
  ) {
    throw new TypeError(
      "freshnessRequirement invalide."
    );
  }

  const localOnly =
    raw.localOnly !== false;

  const allowedForRemoteModel =
    raw.allowedForRemoteModel ===
    true;

  if (
    localOnly &&
    allowedForRemoteModel
  ) {
    throw new TypeError(
      "Une preuve localOnly ne peut pas être autorisée pour un modèle distant."
    );
  }

  return {
    optionId,
    criterionId,
    scope:
      normalizeScope(raw.scope),
    observedAt,
    validUntil,
    freshnessRequirement,
    localOnly,
    allowedForRemoteModel,
  };
}

function normalizeSourceEvidence(
  raw,
  index
) {
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw)
  ) {
    throw new TypeError(
      `Evidence Evaluation ${index} invalide.`
    );
  }

  const sourceId =
    clean(raw.id, 120);

  if (!sourceId) {
    throw new TypeError(
      `Evidence Evaluation ${index} sans id.`
    );
  }

  const status =
    clean(
      raw.status,
      40
    ).toUpperCase();

  const authority =
    clean(
      raw.authority,
      40
    ).toUpperCase();

  if (!STATUSES.has(status)) {
    throw new TypeError(
      `Statut Evaluation invalide : ${status}`
    );
  }

  if (
    !AUTHORITIES.has(
      authority
    )
  ) {
    throw new TypeError(
      `Autorité Evaluation invalide : ${authority}`
    );
  }

  return {
    sourceId,
    status,
    authority,
    critical:
      raw.critical === true,
  };
}

function kindForAuthority(
  authority
) {
  if (
    authority ===
    "DETERMINISTIC"
  ) {
    return "DETERMINISTIC_CHECK";
  }

  if (authority === "SYSTEM") {
    return "SYSTEM_OBSERVATION";
  }

  if (authority === "HUMAN") {
    return "HUMAN_CONFIRMATION";
  }

  return "LLM_ASSERTION";
}

function verificationStatus(
  item
) {
  if (
    !TRUSTED_AUTHORITIES.has(
      item.authority
    )
  ) {
    return "UNVERIFIED";
  }

  if (
    item.status === "PASS" ||
    item.status === "FAIL"
  ) {
    return "VERIFIED";
  }

  if (
    item.status ===
    "WARNING"
  ) {
    return "PARTIALLY_VERIFIED";
  }

  return "UNVERIFIED";
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

function deepFreeze(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Object.isFrozen(value)
  ) {
    return value;
  }

  for (
    const child
    of Object.values(value)
  ) {
    deepFreeze(child);
  }

  return Object.freeze(value);
}

function projectAgentEvaluationEvidence({
  evaluation,
  evidence = [],
  context,
} = {}) {
  if (
    !evaluation ||
    typeof evaluation !==
      "object"
  ) {
    throw new TypeError(
      "AgentEvaluation requis."
    );
  }

  const executionId =
    clean(
      evaluation.executionId,
      160
    );

  if (!executionId) {
    throw new TypeError(
      "AgentEvaluation.executionId requis."
    );
  }

  const normalizedContext =
    normalizeContext(context);

  const normalizedEvidence =
    (Array.isArray(evidence)
      ? evidence
      : [])
      .map(
        normalizeSourceEvidence
      )
      .sort(
        (left, right) =>
          left.sourceId.localeCompare(
            right.sourceId
          ) ||
          left.status.localeCompare(
            right.status
          ) ||
          left.authority.localeCompare(
            right.authority
          )
      );

  const executionRef =
    digest({
      executionId,
      evaluationPolicyVersion:
        clean(
          evaluation
            .evaluationPolicyVersion,
          120
        ),
    }).slice(0, 32);

  const projected =
    normalizedEvidence.map(
      (item) => {
        const kind =
          kindForAuthority(
            item.authority
          );

        const verification =
          verificationStatus(item);

        const claimSeed = {
          executionRef,
          optionId:
            normalizedContext.optionId,
          criterionId:
            normalizedContext
              .criterionId,
        };

        const evidenceSeed = {
          ...claimSeed,
          sourceEvidenceId:
            item.sourceId,
        };

        const evidenceId =
          id(
            "decision_evidence",
            {
              ...evidenceSeed,
              status:
                item.status,
              authority:
                item.authority,
            }
          );

        return {
          evidenceId,

          claimId:
            id(
              "decision_claim",
              claimSeed
            ),

          optionId:
            normalizedContext.optionId,

          criterionId:
            normalizedContext
              .criterionId,

          stance:
            stanceForStatus(
              item.status
            ),

          value:
            valueForStatus(
              item.status
            ),

          kind,

          authority:
            item.authority,

          verificationStatus:
            verification,

          critical:
            item.critical,

          provenance: {
            producer:
              "agent-evaluation-runtime",

            sourceType:
              "agent_evaluation",

            sourceRef:
              `evaluation:${executionRef}`,

            locatorRef:
              `evidence:${digest(
                item.sourceId
              ).slice(0, 24)}`,

            method:
              "bounded_metadata_projection",

            rootEvidenceId: null,
          },

          scope:
            normalizedContext.scope,

          observedAt:
            normalizedContext
              .observedAt,

          validUntil:
            normalizedContext
              .validUntil,

          freshnessRequirement:
            normalizedContext
              .freshnessRequirement,

          claimFingerprint:
            digest({
              ...evidenceSeed,
              status:
                item.status,
              value:
                valueForStatus(
                  item.status
                ),
            }),

          independenceKey:
            digest({
              executionRef,
              sourceEvidenceId:
                item.sourceId,
            }),

          derivedFromEvidenceIds:
            [],

          localOnly:
            normalizedContext
              .localOnly,

          allowedForRemoteModel:
            normalizedContext
              .allowedForRemoteModel,

          untrustedContent:
            item.authority ===
            "AGENT",
        };
      }
    );

  const attestedEvidenceIds =
    projected
      .filter(
        (item) =>
          item.verificationStatus ===
            "VERIFIED" &&
          TRUSTED_AUTHORITIES.has(
            item.authority
          )
      )
      .map(
        (item) =>
          item.evidenceId
      )
      .sort();

  return deepFreeze({
    adapterVersion:
      ADAPTER_VERSION,

    sourceEvaluationRef:
      executionRef,

    evidence:
      projected,

    attestedEvidenceIds,
  });
}

module.exports = {
  ADAPTER_VERSION,
  projectAgentEvaluationEvidence,
};
