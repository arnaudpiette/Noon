"use strict";

const {
  V2_LIMITS,
  normalizeDecisionRequestV2,
} = require("./decision-schema");

function exactObject(
  value,
  label,
  allowed
) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new TypeError(
      `${label} invalide.`
    );
  }

  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new TypeError(
        `${label}.${key} non autorisé.`
      );
    }
  }

  return value;
}

function createDevDecisionConsumer({
  nativeDevFacade,
  decisionSupportEngine,
} = {}) {
  if (
    typeof nativeDevFacade
      ?.projectDecisionEvidence !==
      "function"
  ) {
    throw new TypeError(
      "NativeDevFacade Decision Evidence requise."
    );
  }

  if (
    typeof decisionSupportEngine
      ?.compare !==
      "function"
  ) {
    throw new TypeError(
      "DecisionSupportEngine requis."
    );
  }

  function compare({
    decisionRequest,
    devEvidence,
    remote = false,
  } = {}) {
    const request =
      normalizeDecisionRequestV2(
        decisionRequest
      );

    exactObject(
      devEvidence,
      "devEvidence",
      [
        "taskId",
        "mappings",
      ]
    );

    if (
      typeof devEvidence.taskId !==
        "string" ||
      !devEvidence.taskId.trim()
    ) {
      throw new TypeError(
        "devEvidence.taskId requis."
      );
    }

    if (
      !Array.isArray(
        devEvidence.mappings
      )
    ) {
      throw new TypeError(
        "devEvidence.mappings doit être un tableau."
      );
    }

    /*
     * L'autorité vient exclusivement de la façade
     * Native DEV 4.4D et de l'adaptateur 4.4C.
     *
     * Aucun attestedEvidenceIds fourni par l'appelant
     * n'entre dans cette fonction.
     */
    const projection =
      nativeDevFacade
        .projectDecisionEvidence({
          taskId:
            devEvidence.taskId,
          mappings:
            devEvidence.mappings,
          context: {
            decisionRequest:
              request,
          },
        });

    if (
      !projection ||
      typeof projection !==
        "object" ||
      !Array.isArray(
        projection.evidence
      ) ||
      !Array.isArray(
        projection
          .attestedEvidenceIds
      )
    ) {
      throw new TypeError(
        "Projection Native DEV invalide."
      );
    }

    const projectionIds =
      new Set();

    for (
      const item of projection.evidence
    ) {
      if (
        !item ||
        typeof item !== "object" ||
        typeof item.evidenceId !==
          "string" ||
        !item.evidenceId
      ) {
        throw new TypeError(
          "Evidence Native DEV projetée invalide."
        );
      }

      if (
        projectionIds.has(
          item.evidenceId
        )
      ) {
        throw new TypeError(
          "Evidence Native DEV projetée dupliquée."
        );
      }

      projectionIds.add(
        item.evidenceId
      );
    }

    const attested =
      [];

    const seenAttested =
      new Set();

    for (
      const evidenceId of
        projection
          .attestedEvidenceIds
    ) {
      if (
        typeof evidenceId !==
          "string" ||
        !projectionIds.has(
          evidenceId
        )
      ) {
        throw new TypeError(
          "Attestation Native DEV hors projection."
        );
      }

      if (
        seenAttested.has(
          evidenceId
        )
      ) {
        throw new TypeError(
          "Attestation Native DEV dupliquée."
        );
      }

      seenAttested.add(
        evidenceId
      );

      attested.push(
        evidenceId
      );
    }

    const evidence = [
      ...request.evidence,
      ...projection.evidence,
    ];

    if (
      evidence.length >
      V2_LIMITS.evidence
    ) {
      throw new TypeError(
        `La composition dépasse la borne V2 de ${V2_LIMITS.evidence} preuves.`
      );
    }

    /*
     * Une collision avec une preuve fournie dans
     * decisionRequest doit échouer avant compare :
     * elle ne peut jamais hériter de l'attestation DEV.
     */
    const evidenceIds =
      new Set();

    for (const item of evidence) {
      if (
        evidenceIds.has(
          item.evidenceId
        )
      ) {
        throw new TypeError(
          "Collision evidenceId lors de la composition DEV."
        );
      }

      evidenceIds.add(
        item.evidenceId
      );
    }

    /*
     * Canonicalise une seconde fois après fusion :
     * - ordre global déterministe des preuves ;
     * - validation complète du contrat composé ;
     * - aucune dépendance implicite au normalizer
     *   interne du moteur Decision.
     */
    const composed =
      normalizeDecisionRequestV2({
        ...request,
        evidence,
      });

    return decisionSupportEngine.compare(
      composed,
      {
        remote:
          remote === true,

        attestedEvidenceIds:
          [...attested].sort(),
      }
    );
  }

  return Object.freeze({
    compare,
  });
}

module.exports = {
  createDevDecisionConsumer,
};
