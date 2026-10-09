"use strict";

const assert =
  require("node:assert/strict");

const test =
  require("node:test");

const {
  projectAgentEvaluationEvidence,
} = require(
  "../services/decision/agent-evaluation-evidence-adapter"
);

const {
  normalizeDecisionRequestV2,
} = require(
  "../services/decision/decision-schema"
);

const {
  createDecisionSupportEngine,
} = require(
  "../services/decision/decision-support-engine"
);

function evaluation() {
  return {
    evaluationPolicyVersion:
      "agent-evaluation-v1",
    executionId:
      "exec-sensitive-id",
    verdict: "PASS",
    confidence: "HIGH",
  };
}

function context(
  overrides = {}
) {
  return {
    optionId: "option-a",
    criterionId:
      "execution-result",
    observedAt:
      "2026-10-09T12:00:00.000Z",
    validUntil:
      "2026-10-10T12:00:00.000Z",
    freshnessRequirement:
      "CURRENT",
    localOnly: true,
    allowedForRemoteModel:
      false,
    scope: {
      profileScope: "owner",
      workspaceId: "w1",
      projectId: null,
      purpose:
        "LOCAL_ANALYSIS",
    },
    ...overrides,
  };
}

test(
  "PASS et FAIL fiables deviennent des preuves V2 vérifiées et attestables",
  () => {
    const result =
      projectAgentEvaluationEvidence({
        evaluation:
          evaluation(),

        evidence: [
          {
            id: "tests",
            status: "PASS",
            authority:
              "DETERMINISTIC",
            critical: true,
            content:
              "SECRET RAW CONTENT",
          },
          {
            id: "tool",
            status: "FAIL",
            authority: "SYSTEM",
            critical: true,
            prompt:
              "PRIVATE PROMPT",
          },
        ],

        context: context(),
      });

    assert.equal(
      result.evidence.length,
      2
    );

    const deterministic =
      result.evidence.find(
        (item) =>
          item.authority ===
          "DETERMINISTIC"
      );

    const system =
      result.evidence.find(
        (item) =>
          item.authority ===
          "SYSTEM"
      );

    assert.equal(
      deterministic.kind,
      "DETERMINISTIC_CHECK"
    );

    assert.equal(
      deterministic.stance,
      "SUPPORTS"
    );

    assert.equal(
      deterministic.value,
      true
    );

    assert.equal(
      deterministic
        .verificationStatus,
      "VERIFIED"
    );

    assert.equal(
      system.kind,
      "SYSTEM_OBSERVATION"
    );

    assert.equal(
      system.stance,
      "OPPOSES"
    );

    assert.equal(
      system.value,
      false
    );

    assert.equal(
      system
        .verificationStatus,
      "VERIFIED"
    );

    assert.equal(
      result
        .attestedEvidenceIds
        .length,
      2
    );

    const serialized =
      JSON.stringify(result);

    assert.equal(
      serialized.includes(
        "SECRET RAW CONTENT"
      ),
      false
    );

    assert.equal(
      serialized.includes(
        "PRIVATE PROMPT"
      ),
      false
    );

    assert.equal(
      serialized.includes(
        "exec-sensitive-id"
      ),
      false
    );
  }
);

test(
  "une déclaration AGENT reste LLM_ASSERTION non vérifiée et non attestée",
  () => {
    const result =
      projectAgentEvaluationEvidence({
        evaluation:
          evaluation(),

        evidence: [
          {
            id: "agent-claim",
            status: "PASS",
            authority: "AGENT",
            critical: false,
          },
        ],

        context: context(),
      });

    assert.equal(
      result.evidence[0].kind,
      "LLM_ASSERTION"
    );

    assert.equal(
      result.evidence[0]
        .verificationStatus,
      "UNVERIFIED"
    );

    assert.equal(
      result.evidence[0]
        .untrustedContent,
      true
    );

    assert.deepEqual(
      result.attestedEvidenceIds,
      []
    );
  }
);

test(
  "WARNING UNKNOWN et SKIPPED ne sont jamais attestés",
  () => {
    const result =
      projectAgentEvaluationEvidence({
        evaluation:
          evaluation(),

        evidence: [
          {
            id: "warning",
            status: "WARNING",
            authority: "SYSTEM",
          },
          {
            id: "unknown",
            status: "UNKNOWN",
            authority:
              "DETERMINISTIC",
          },
          {
            id: "skipped",
            status: "SKIPPED",
            authority:
              "DETERMINISTIC",
          },
        ],

        context: context(),
      });

    assert.deepEqual(
      result
        .attestedEvidenceIds,
      []
    );

    assert.deepEqual(
      result.evidence.map(
        (item) =>
          item.verificationStatus
      ).sort(),
      [
        "PARTIALLY_VERIFIED",
        "UNVERIFIED",
        "UNVERIFIED",
      ].sort()
    );

    assert.ok(
      result.evidence.every(
        (item) =>
          item.stance ===
            "NEUTRAL" &&
          item.value === null
      )
    );
  }
);

test(
  "la projection est déterministe quel que soit l'ordre des preuves",
  () => {
    const items = [
      {
        id: "b",
        status: "PASS",
        authority: "SYSTEM",
      },
      {
        id: "a",
        status: "FAIL",
        authority:
          "DETERMINISTIC",
      },
    ];

    const first =
      projectAgentEvaluationEvidence({
        evaluation:
          evaluation(),
        evidence: items,
        context: context(),
      });

    const second =
      projectAgentEvaluationEvidence({
        evaluation:
          evaluation(),
        evidence:
          items.slice().reverse(),
        context: context(),
      });

    assert.deepEqual(
      first,
      second
    );
  }
);

test(
  "deux sources indépendantes contradictoires partagent le même claim et produisent CONFLICT",
  () => {
    const projection =
      projectAgentEvaluationEvidence({
        evaluation:
          evaluation(),

        evidence: [
          {
            id: "tests",
            status: "PASS",
            authority:
              "DETERMINISTIC",
            critical: true,
          },
          {
            id: "runtime-observation",
            status: "FAIL",
            authority: "SYSTEM",
            critical: true,
          },
        ],

        context: context(),
      });

    assert.equal(
      projection.evidence[0]
        .claimId,
      projection.evidence[1]
        .claimId
    );

    assert.notEqual(
      projection.evidence[0]
        .evidenceId,
      projection.evidence[1]
        .evidenceId
    );

    assert.notEqual(
      projection.evidence[0]
        .independenceKey,
      projection.evidence[1]
        .independenceKey
    );

    const result =
      createDecisionSupportEngine()
        .compare(
          {
            schemaVersion: 2,
            decisionId:
              "decision-evaluation-conflict",
            decisionType:
              "COMPARE",
            evaluationAt:
              "2026-10-09T12:00:00.000Z",

            scope:
              context().scope,

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
                  "USER_PROVIDED",
                assumptions: [],
                values: {},
              },
            ],

            criteria: [
              {
                criterionId:
                  "execution-result",
                label:
                  "Résultat d'exécution",
                type: "QUALITY",
                importance:
                  "CRITICAL",
                direction:
                  "MAXIMIZE",
                requiredEvidence:
                  "VERIFIED",
                range: null,
              },
            ],

            constraints: [],
            evidence:
              projection.evidence,
            verificationProposals:
              [],
            recommendationRequested:
              true,
            outputMode:
              "BALANCED",
            contextVersion:
              "evaluation-conflict-v1",
          },
          {
            attestedEvidenceIds:
              projection
                .attestedEvidenceIds,
          }
        );

    assert.equal(
      result.verdict,
      "CONFLICT"
    );

    assert.equal(
      result.conflicts.length,
      1
    );

    assert.equal(
      result.conflicts[0]
        .material,
      true
    );

    assert.equal(
      result.actionAuthorized,
      false
    );

    assert.equal(
      result.verificationAuthorized,
      false
    );
  }
);

test(
  "un contexte Decision explicite et un observedAt valide sont obligatoires",
  () => {
    assert.throws(
      () =>
        projectAgentEvaluationEvidence({
          evaluation:
            evaluation(),
          evidence: [],
        }),
      /Contexte Decision explicite requis/
    );

    assert.throws(
      () =>
        projectAgentEvaluationEvidence({
          evaluation:
            evaluation(),
          evidence: [],
          context:
            context({
              observedAt: null,
            }),
        }),
      /observedAt ISO explicite requis/
    );
  }
);

test(
  "les preuves projetées satisfont le schéma strict V2 sans créer d'autorité",
  () => {
    const projection =
      projectAgentEvaluationEvidence({
        evaluation:
          evaluation(),

        evidence: [
          {
            id: "tests",
            status: "PASS",
            authority:
              "DETERMINISTIC",
            critical: true,
          },
        ],

        context: context(),
      });

    const normalized =
      normalizeDecisionRequestV2({
        schemaVersion: 2,
        decisionId:
          "decision-adapter-test",
        decisionType: "COMPARE",
        evaluationAt:
          "2026-10-09T12:00:00.000Z",

        scope:
          context().scope,

        options: [
          {
            optionId: "option-a",
            label: "A",
            source:
              "CURRENT_STATE",
            assumptions: [],
            values: {},
          },
          {
            optionId: "option-b",
            label: "B",
            source:
              "USER_PROVIDED",
            assumptions: [],
            values: {},
          },
        ],

        criteria: [
          {
            criterionId:
              "execution-result",
            label:
              "Résultat d'exécution",
            type: "QUALITY",
            importance:
              "CRITICAL",
            direction:
              "MAXIMIZE",
            requiredEvidence:
              "VERIFIED",
            range: null,
          },
        ],

        constraints: [],
        evidence:
          projection.evidence,
        verificationProposals:
          [],
        recommendationRequested:
          true,
        outputMode: "BALANCED",
        contextVersion:
          "adapter-test-v1",
      });

    assert.equal(
      normalized.evidence.length,
      1
    );

    assert.equal(
      projection
        .attestedEvidenceIds
        .length,
      1
    );

    assert.equal(
      Object.hasOwn(
        projection,
        "actionAuthorized"
      ),
      false
    );

    assert.equal(
      Object.hasOwn(
        projection,
        "verdict"
      ),
      false
    );
  }
);
