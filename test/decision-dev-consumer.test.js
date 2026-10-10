"use strict";

const assert =
  require("node:assert/strict");

const test =
  require("node:test");

const {
  createDevDecisionConsumer,
} = require(
  "../services/decision/dev-decision-consumer"
);

const {
  normalizeDecisionRequestV2,
} = require(
  "../services/decision/decision-schema"
);

function request(
  overrides = {}
) {
  return {
    schemaVersion: 2,
    decisionId:
      "decision-dev-consumer",
    decisionType:
      "COMPARE",
    evaluationAt:
      "2026-10-10T20:00:00.000Z",

    scope: {
      profileScope:
        "owner",
      workspaceId:
        "workspace-1",
      projectId:
        null,
      purpose:
        "LOCAL_ANALYSIS",
    },

    options: [
      {
        optionId:
          "option-a",
        label: "A",
        source:
          "CURRENT_STATE",
        assumptions: [],
        values: {},
      },
      {
        optionId:
          "option-b",
        label: "B",
        source:
          "CURRENT_STATE",
        assumptions: [],
        values: {},
      },
    ],

    criteria: [
      {
        criterionId:
          "quality",
        label:
          "Quality",
        type:
          "QUALITY",
        importance:
          "HIGH",
        direction:
          "MAXIMIZE",
        requiredEvidence:
          "VERIFIED",
        range: null,
      },
    ],

    constraints: [],
    evidence: [],
    verificationProposals: [],
    recommendationRequested:
      true,
    outputMode:
      "BALANCED",
    contextVersion:
      "dev-consumer-v1",

    ...overrides,
  };
}

function projectedEvidence(
  id =
    "decision_evidence_dev"
) {
  return {
    evidenceId: id,
    claimId:
      "decision_claim_dev",
    optionId:
      "option-a",
    criterionId:
      "quality",
    stance:
      "SUPPORTS",
    value: "GOOD",
    kind:
      "SYSTEM_OBSERVATION",
    authority:
      "SYSTEM",
    verificationStatus:
      "VERIFIED",
    critical: true,

    provenance: {
      producer:
        "native-dev",
      sourceType:
        "native_dev_validation",
      sourceRef:
        "dev:opaque",
      locatorRef:
        "terminal:opaque",
      method:
        "canonical_snapshot_binding_projection",
      rootEvidenceId:
        null,
    },

    scope: {
      profileScope:
        "owner",
      workspaceId:
        "workspace-1",
      projectId:
        null,
      purpose:
        "LOCAL_ANALYSIS",
    },

    observedAt: null,
    validUntil: null,
    freshnessRequirement:
      "HISTORICAL",

    claimFingerprint:
      "claim-fingerprint-dev",

    independenceKey:
      "independence-dev",

    derivedFromEvidenceIds:
      [],

    localOnly: true,
    allowedForRemoteModel:
      false,
    untrustedContent:
      false,
  };
}

test(
  "4.4E compose explicitement DEV puis transmet uniquement ses attestations",
  () => {
    const source =
      request();

    const before =
      structuredClone(
        source
      );

    let projectionCalls = 0;
    let compareCalls = 0;
    let receivedProjection =
      null;
    let receivedRequest =
      null;
    let receivedOptions =
      null;

    const evidence =
      projectedEvidence();

    const consumer =
      createDevDecisionConsumer({
        nativeDevFacade: {
          projectDecisionEvidence(
            input
          ) {
            projectionCalls += 1;
            receivedProjection =
              input;

            return {
              adapterVersion:
                "native-dev-evidence-v1",
              sourceDevRef:
                "dev-task-ref",
              evidence: [
                evidence,
              ],
              attestedEvidenceIds:
                [
                  evidence.evidenceId,
                ],
            };
          },
        },

        decisionSupportEngine: {
          compare(
            decisionRequest,
            options
          ) {
            compareCalls += 1;
            receivedRequest =
              decisionRequest;
            receivedOptions =
              options;

            return {
              verdict:
                "DECIDED",
              recommendationIsAction:
                false,
              actionAuthorized:
                false,
              verificationAuthorized:
                false,
            };
          },
        },
      });

    const mappings = [
      {
        source:
          "TERMINAL",
        optionId:
          "option-a",
        criterionId:
          "quality",
      },
    ];

    const result =
      consumer.compare({
        decisionRequest:
          source,

        devEvidence: {
          taskId:
            "task-1",
          mappings,
        },

        /*
         * Ce champ n'existe volontairement
         * pas dans le contrat du consumer.
         * Il ne peut donc pas injecter
         * d'attestation libre.
         */
        attestedEvidenceIds: [
          "FORGED",
        ],
      });

    assert.equal(
      projectionCalls,
      1
    );

    assert.equal(
      compareCalls,
      1
    );

    assert.equal(
      receivedProjection.taskId,
      "task-1"
    );

    assert.equal(
      receivedProjection.mappings,
      mappings
    );

    assert.deepEqual(
      receivedProjection
        .context
        .decisionRequest,
      normalizeDecisionRequestV2(
        source
      )
    );

    assert.equal(
      receivedRequest.evidence.length,
      1
    );

    assert.deepEqual(
      receivedRequest.evidence[0],
      evidence
    );

    assert.deepEqual(
      receivedOptions
        .attestedEvidenceIds,
      [
        evidence.evidenceId,
      ]
    );

    assert.equal(
      receivedOptions.remote,
      false
    );

    assert.equal(
      receivedOptions
        .attestedEvidenceIds
        .includes(
          "FORGED"
        ),
      false
    );

    assert.deepEqual(
      source,
      before
    );

    assert.equal(
      result.actionAuthorized,
      false
    );

    assert.equal(
      result
        .verificationAuthorized,
      false
    );
  }
);

test(
  "4.4E conserve les preuves existantes mais ne leur invente aucune attestation",
  () => {
    const existing =
      projectedEvidence(
        "decision_evidence_existing"
      );

    const dev =
      projectedEvidence(
        "decision_evidence_dev"
      );

    existing.verificationStatus =
      "VERIFIED";

    let optionsSeen =
      null;

    const consumer =
      createDevDecisionConsumer({
        nativeDevFacade: {
          projectDecisionEvidence() {
            return {
              evidence: [dev],
              attestedEvidenceIds:
                [
                  dev.evidenceId,
                ],
            };
          },
        },

        decisionSupportEngine: {
          compare(
            composed,
            options
          ) {
            optionsSeen =
              options;

            assert.deepEqual(
              composed.evidence.map(
                (item) =>
                  item.evidenceId
              ),
              [
                existing.evidenceId,
                dev.evidenceId,
              ].sort()
            );

            return {
              ok: true,
            };
          },
        },
      });

    consumer.compare({
      decisionRequest:
        request({
          evidence: [
            existing,
          ],
        }),

      devEvidence: {
        taskId:
          "task-1",
        mappings: [],
      },
    });

    assert.deepEqual(
      optionsSeen
        .attestedEvidenceIds,
      [
        dev.evidenceId,
      ]
    );
  }
);

test(
  "4.4E refuse une attestation hors projection et les collisions evidenceId",
  () => {
    const dev =
      projectedEvidence();

    const badAttestation =
      createDevDecisionConsumer({
        nativeDevFacade: {
          projectDecisionEvidence() {
            return {
              evidence: [dev],
              attestedEvidenceIds:
                ["FORGED"],
            };
          },
        },

        decisionSupportEngine: {
          compare() {
            throw new Error(
              "compare ne doit pas être atteint"
            );
          },
        },
      });

    assert.throws(
      () =>
        badAttestation.compare({
          decisionRequest:
            request(),
          devEvidence: {
            taskId:
              "task-1",
            mappings: [],
          },
        }),
      /hors projection/
    );

    const collision =
      createDevDecisionConsumer({
        nativeDevFacade: {
          projectDecisionEvidence() {
            return {
              evidence: [dev],
              attestedEvidenceIds:
                [
                  dev.evidenceId,
                ],
            };
          },
        },

        decisionSupportEngine: {
          compare() {
            throw new Error(
              "compare ne doit pas être atteint"
            );
          },
        },
      });

    assert.throws(
      () =>
        collision.compare({
          decisionRequest:
            request({
              evidence: [
                dev,
              ],
            }),
          devEvidence: {
            taskId:
              "task-1",
            mappings: [],
          },
        }),
      /Collision evidenceId/
    );
  }
);

test(
  "4.4E transmet remote sans jamais modifier l'autorité DEV",
  () => {
    const dev =
      projectedEvidence();

    let seen = null;

    const consumer =
      createDevDecisionConsumer({
        nativeDevFacade: {
          projectDecisionEvidence() {
            return {
              evidence: [dev],
              attestedEvidenceIds:
                [
                  dev.evidenceId,
                ],
            };
          },
        },

        decisionSupportEngine: {
          compare(
            _request,
            options
          ) {
            seen = options;

            return {
              verdict:
                "INSUFFICIENT_EVIDENCE",
              recommendationIsAction:
                false,
              actionAuthorized:
                false,
              verificationAuthorized:
                false,
            };
          },
        },
      });

    const result =
      consumer.compare({
        decisionRequest:
          request(),

        devEvidence: {
          taskId:
            "task-1",
          mappings: [],
        },

        remote: true,
      });

    assert.equal(
      seen.remote,
      true
    );

    assert.deepEqual(
      seen.attestedEvidenceIds,
      [
        dev.evidenceId,
      ]
    );

    assert.equal(
      result.actionAuthorized,
      false
    );
  }
);
