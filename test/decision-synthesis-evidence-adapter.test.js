"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  projectSynthesisEvidence,
} = require("../services/decision/synthesis-evidence-adapter");
const {
  normalizeDecisionRequestV2,
} = require("../services/decision/decision-schema");
const {
  createDecisionSupportEngine,
} = require("../services/decision/decision-support-engine");

function request(overrides = {}) {
  return {
    schemaVersion: 2,
    decisionId: "decision-synthesis-adapter",
    decisionType: "COMPARE",
    evaluationAt: "2026-10-09T12:00:00.000Z",
    scope: {
      profileScope: "owner",
      workspaceId: "workspace-1",
      projectId: null,
      purpose: "LOCAL_ANALYSIS",
    },
    options: [
      { optionId: "option-a", label: "A", source: "CURRENT_STATE", assumptions: [], values: {} },
      { optionId: "option-b", label: "B", source: "USER_PROVIDED", assumptions: [], values: {} },
    ],
    criteria: [
      {
        criterionId: "quality",
        label: "Qualité",
        type: "QUALITY",
        importance: "HIGH",
        direction: "MAXIMIZE",
        requiredEvidence: "VERIFIED",
        range: null,
      },
    ],
    constraints: [],
    evidence: [],
    verificationProposals: [],
    recommendationRequested: true,
    outputMode: "BALANCED",
    contextVersion: "synthesis-adapter-test-v1",
    ...overrides,
  };
}

function synthesis(overrides = {}) {
  return {
    synthesisId: "synthesis_opaque_id",
    evidenceSetFingerprint: "evidence-fingerprint-opaque",
    answer: "PRIVATE SYNTHESIS ANSWER",
    keyPoints: [{ text: "PRIVATE KEY POINT", citationIds: ["private-citation"] }],
    citations: [{ locator: { path: "/private/path" }, label: "PRIVATE LABEL" }],
    claims: [
      {
        claimId: "claim-a",
        independentRoots: ["canonical-source-a"],
        effectiveAt: "2026-10-08T10:00:00.000Z",
        status: "current",
        value: "PRIVATE CLAIM VALUE",
        subject: "private subject",
      },
    ],
    conflicts: [],
    sourceCoverage: [{ source: "private-source", status: "ok" }],
    ...overrides,
  };
}

function mapping(overrides = {}) {
  return {
    claimId: "claim-a",
    optionId: "option-a",
    criterionId: "quality",
    stance: "SUPPORTS",
    value: "GOOD",
    ...overrides,
  };
}

function projection(overrides = {}) {
  return projectSynthesisEvidence({
    synthesis: synthesis(overrides.synthesis),
    mappings: overrides.mappings || [mapping()],
    context: { decisionRequest: request(overrides.request) },
  });
}

test("projette des métadonnées V2 déterministes sans contenu brut", () => {
  const first = projection();
  const second = projection();

  assert.deepEqual(first, second);
  assert.equal(first.evidence.length, 1);
  assert.equal(first.evidence[0].kind, "LLM_ASSERTION");
  assert.equal(first.evidence[0].authority, "AGENT");
  assert.equal(first.evidence[0].verificationStatus, "UNVERIFIED");
  assert.equal(first.evidence[0].localOnly, true);
  assert.equal(first.evidence[0].allowedForRemoteModel, false);
  assert.equal(first.evidence[0].untrustedContent, true);
  assert.deepEqual(first.attestedEvidenceIds, []);
  assert.equal(first.evidence[0].observedAt, "2026-10-08T10:00:00.000Z");
  assert.equal(first.evidence[0].validUntil, null);
  assert.equal(first.evidence[0].freshnessRequirement, "HISTORICAL");

  const serialized = JSON.stringify(first);
  for (const secret of [
    "PRIVATE CLAIM VALUE",
    "PRIVATE SYNTHESIS ANSWER",
    "PRIVATE KEY POINT",
    "/private/path",
    "PRIVATE LABEL",
    "private subject",
    "private-source",
    "canonical-source-a",
    "synthesis_opaque_id",
  ]) {
    assert.equal(serialized.includes(secret), false);
  }

  const normalized = normalizeDecisionRequestV2({
    ...request(),
    evidence: first.evidence,
  });
  assert.equal(normalized.evidence.length, 1);
});

test("mapping et requête Decision cible doivent vérifier les références", () => {
  assert.throws(
    () => projection({ mappings: [mapping({ optionId: "unknown-option" })] }),
    /optionId absent de la requête Decision cible/
  );
  assert.throws(
    () => projection({ mappings: [mapping({ criterionId: "unknown-criterion" })] }),
    /criterionId absent de la requête Decision cible/
  );
  assert.throws(
    () => projection({ mappings: [mapping({ optionId: "x".repeat(161) })] }),
    /optionId invalide/
  );
  assert.throws(
    () => projectSynthesisEvidence({
      synthesis: synthesis(),
      mappings: [mapping()],
      context: { decisionRequest: { schemaVersion: 2 } },
    }),
    /options: tableau attendu/
  );
});

test("une valeur et une stance déclarées ne deviennent jamais une attestation", () => {
  const result = projection({
    synthesis: synthesis({ claims: [{
      claimId: "claim-a",
      independentRoots: ["canonical-source-a"],
      effectiveAt: null,
      status: "final",
      value: "VERIFIED",
      verificationStatus: "VERIFIED",
    }] }),
    mappings: [mapping({ stance: "OPPOSES", value: "POOR" })],
  });

  assert.equal(result.evidence[0].stance, "OPPOSES");
  assert.equal(result.evidence[0].value, "POOR");
  assert.equal(result.evidence[0].verificationStatus, "UNVERIFIED");
  assert.deepEqual(result.attestedEvidenceIds, []);
  assert.ok(result.unknowns.some((item) => item.reasonCode === "OBSERVED_AT_UNKNOWN"));
  assert.ok(result.unknowns.some((item) => item.reasonCode === "SOURCE_STATUS_UNATTESTED"));
});

test("le moteur V2 réel ne décide pas à partir de cette projection seule", () => {
  const result = projection();
  const compared = createDecisionSupportEngine().compare({
    ...request(),
    evidence: result.evidence,
  }, { attestedEvidenceIds: result.attestedEvidenceIds });

  assert.notEqual(compared.verdict, "DECIDED");
  assert.equal(compared.actionAuthorized, false);
  assert.equal(compared.verificationAuthorized, false);
  assert.ok(compared.unknowns.some((item) => item.reasonCode === "EVIDENCE_NOT_ATTESTED"));
});

test("des racines partagées ou dérivées conservent une seule indépendance", () => {
  const result = projection({
    synthesis: synthesis({
      claims: [{
        claimId: "claim-a",
        independentRoots: ["root-conversation"],
        effectiveAt: null,
        status: "unknown",
      }],
    }),
  });

  assert.equal(result.evidence.length, 1);
  assert.equal(result.independentRoots.length, 1);
  assert.equal(result.evidence[0].independenceKey, result.independentRoots[0]);
});

test("les contradictions sont préservées et une sélection partielle est refusée", () => {
  const conflicting = synthesis({
    claims: [
      { claimId: "claim-a", independentRoots: ["root-a"], effectiveAt: null, status: "unknown" },
      { claimId: "claim-b", independentRoots: ["root-b"], effectiveAt: null, status: "unknown" },
    ],
    conflicts: [{
      conflictId: "conflict-a-b",
      claims: ["claim-a", "claim-b"],
      type: "VALUE_CONFLICT",
      severity: "high",
    }],
  });

  assert.throws(
    () => projectSynthesisEvidence({
      synthesis: conflicting,
      mappings: [mapping()],
      context: { decisionRequest: request() },
    }),
    /sélectionné partiellement/
  );

  const result = projectSynthesisEvidence({
    synthesis: conflicting,
    mappings: [mapping(), mapping({ claimId: "claim-b", optionId: "option-b", stance: "OPPOSES", value: null })],
    context: { decisionRequest: request() },
  });
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].type, "VALUE_CONFLICT");
  assert.equal(result.conflicts[0].severity, "high");
  assert.equal(result.conflicts[0].unresolved, true);
  assert.equal(Object.hasOwn(result.conflicts[0], "likelyResolution"), false);
});

test("scope explicite incompatible, contexte distant et métadonnées invalides sont refusés", () => {
  assert.throws(
    () => projection({
      synthesis: synthesis({
        scope: {
          profileScope: "other-profile",
          workspaceId: "workspace-1",
          projectId: null,
          purpose: "LOCAL_ANALYSIS",
        },
      }),
    }),
    /synthesis\.scope incompatible/
  );
  assert.throws(
    () => projection({ request: { scope: { ...request().scope, purpose: "REMOTE_MODEL_CONTEXT" } } }),
    /limitée à LOCAL_ANALYSIS/
  );
  assert.throws(
    () => projection({ synthesis: synthesis({ localOnly: "yes" }) }),
    /synthesis\.localOnly invalide/
  );
  const stillLocal = projection({
    synthesis: synthesis({ localOnly: false, allowedForRemoteModel: true }),
  });
  assert.equal(stillLocal.evidence[0].localOnly, true);
  assert.equal(stillLocal.evidence[0].allowedForRemoteModel, false);
});

test("scope et privacy sont contrôlés séparément par le moteur V2", () => {
  const result = projection();
  const engine = createDecisionSupportEngine();
  const scopeMismatch = engine.compare({
    ...request(),
    evidence: result.evidence.map((item) => ({
      ...item,
      scope: { ...item.scope, profileScope: "other-profile" },
    })),
  }, { attestedEvidenceIds: result.attestedEvidenceIds });
  assert.ok(scopeMismatch.unknowns.some((item) => item.reasonCode === "EVIDENCE_SCOPE_MISMATCH"));

  const remote = engine.compare({
    ...request(),
    evidence: result.evidence,
  }, { remote: true, attestedEvidenceIds: result.attestedEvidenceIds });
  assert.ok(remote.unknowns.some((item) => item.reasonCode === "EVIDENCE_PRIVACY_BLOCKED"));
});

test("dates absentes, couverture limitée, bornes et entrée source ne sont pas masquées", () => {
  const source = synthesis({
    claims: [{ claimId: "claim-a", independentRoots: ["root-a"], effectiveAt: null, status: "historical" }],
    sourceCoverage: [{ source: "private-source", status: "timeout" }],
  });
  const before = structuredClone(source);
  const result = projectSynthesisEvidence({
    synthesis: source,
    mappings: [mapping()],
    context: { decisionRequest: request() },
  });
  assert.deepEqual(source, before);
  assert.ok(result.unknowns.some((item) => item.reasonCode === "OBSERVED_AT_UNKNOWN"));
  assert.ok(result.unknowns.some((item) => item.reasonCode === "SOURCE_STATUS_UNATTESTED"));
  assert.ok(result.unknowns.some((item) => item.reasonCode === "SOURCE_COVERAGE_INCOMPLETE"));
  assert.ok(result.unknowns.some((item) => item.reasonCode === "SOURCE_SCOPE_UNKNOWN"));

  const tooManyMappings = Array.from({ length: 101 }, (_, index) => ({
    ...mapping({ claimId: `claim-${index}` }),
  }));
  const tooManyClaims = synthesis({
    claims: tooManyMappings.map((item) => ({
      claimId: item.claimId,
      independentRoots: [`root-${item.claimId}`],
      effectiveAt: null,
      status: "unknown",
    })),
  });
  assert.throws(
    () => projectSynthesisEvidence({
      synthesis: tooManyClaims,
      mappings: tooManyMappings,
      context: { decisionRequest: request() },
    }),
    /entre 1 et 100/
  );

  assert.throws(
    () => projection({
      synthesis: synthesis({
        claims: [{
          claimId: "claim-a",
          independentRoots: Array.from({ length: 101 }, (_, index) => `root-${index}`),
          effectiveAt: null,
          status: "unknown",
        }],
      }),
    }),
    /independentRoots dépasse la borne locale de 40/
  );
});

test("claims sans racine et valeurs de mapping invalides sont refusés", () => {
  assert.throws(
    () => projection({
      synthesis: synthesis({
        claims: [{ claimId: "claim-a", independentRoots: [], effectiveAt: null, status: "unknown" }],
      }),
    }),
    /independentRoots requis/
  );
  assert.throws(
    () => projection({ mappings: [mapping({ stance: "TRUST_ME" })] }),
    /stance invalide/
  );
  assert.throws(
    () => projection({ mappings: [mapping({ value: Number.NaN })] }),
    /nombre fini/
  );
});

test("mapping.value est fermé aux interprétations V2 explicites", () => {
  for (const value of ["POOR", "WEAK", "NEUTRAL", "GOOD", "EXCELLENT", "UNKNOWN", null]) {
    assert.equal(projection({ mappings: [mapping({ value })] }).evidence[0].value, value);
  }
  assert.throws(
    () => projection({ mappings: [mapping({ value: "PRIVATE FREE TEXT" })] }),
    /valeur qualitative admise/
  );
  assert.throws(
    () => projection({ mappings: [mapping({ value: 5 })] }),
    /range numérique explicite/
  );

  const ranged = { ...request().criteria[0], range: { min: 0, max: 10 } };
  assert.equal(projection({ request: { criteria: [ranged] }, mappings: [mapping({ value: 5 })] }).evidence[0].value, 5);
  assert.throws(
    () => projection({ request: { criteria: [ranged] }, mappings: [mapping({ value: -1 })] }),
    /range numérique explicite/
  );
  assert.throws(
    () => projection({ request: { criteria: [ranged] }, mappings: [mapping({ value: 11 })] }),
    /range numérique explicite/
  );
  assert.throws(
    () => projection({ mappings: [mapping({ value: true })] }),
    /booléen sans interprétation V2 explicite/
  );

  const booleanConstraint = {
    constraintId: "quality-is-true",
    optionId: "option-a",
    criterionId: "quality",
    operator: "EQUALS",
    expected: true,
    strength: "SOFT",
    evidenceRequirement: "VERIFIED",
  };
  assert.throws(
    () => projection({
      request: request({
        constraints: [{
          ...booleanConstraint,
          constraintId: "quality-is-true-globally",
          optionId: null,
        }],
      }),
      mappings: [mapping({ value: true })],
    }),
    /booléen sans interprétation V2 explicite/
  );
  assert.equal(projection({
    request: { constraints: [booleanConstraint] },
    mappings: [mapping({ value: true })],
  }).evidence[0].value, true);
});

test("les clés de racines sont stables entre synthèses et distinctes par racine", () => {
  const commonClaim = {
    claimId: "claim-a",
    independentRoots: ["canonical-shared-root"],
    effectiveAt: null,
    status: "unknown",
  };
  const first = projection({ synthesis: synthesis({ claims: [commonClaim] }) });
  const second = projection({
    synthesis: synthesis({
      synthesisId: "other-synthesis",
      evidenceSetFingerprint: "other-evidence-fingerprint",
      claims: [commonClaim],
    }),
  });
  const distinct = projection({
    synthesis: synthesis({
      synthesisId: "third-synthesis",
      evidenceSetFingerprint: "third-evidence-fingerprint",
      claims: [{ ...commonClaim, independentRoots: ["canonical-other-root"] }],
    }),
  });

  assert.equal(first.evidence[0].independenceKey, second.evidence[0].independenceKey);
  assert.notEqual(first.evidence[0].independenceKey, distinct.evidence[0].independenceKey);

  const shared = projectSynthesisEvidence({
    synthesis: synthesis({
      claims: [
        commonClaim,
        { ...commonClaim, claimId: "claim-b" },
      ],
    }),
    mappings: [
      mapping(),
      mapping({ claimId: "claim-b", optionId: "option-b", value: "POOR" }),
    ],
    context: { decisionRequest: request() },
  });
  assert.equal(shared.independentRoots.length, 1);
  assert.equal(shared.evidence[0].independenceKey, shared.evidence[1].independenceKey);
});

test("types inconnus de conflit deviennent UNKNOWN sans texte privé", () => {
  const result = projectSynthesisEvidence({
    synthesis: synthesis({
      claims: [
        { claimId: "claim-a", independentRoots: ["root-a"], effectiveAt: null, status: "unknown", value: "PRIVATE VALUE" },
        { claimId: "claim-b", independentRoots: ["root-b"], effectiveAt: null, status: "unknown", value: "PRIVATE VALUE B" },
      ],
      conflicts: [{
        conflictId: "conflict-private",
        claims: ["claim-a", "claim-b"],
        type: "PRIVATE CONFLICT TYPE",
        severity: "PRIVATE SEVERITY",
        subject: "PRIVATE SUBJECT",
        likelyResolution: "PRIVATE RESOLUTION",
      }],
    }),
    mappings: [mapping(), mapping({ claimId: "claim-b", optionId: "option-b", value: "POOR" })],
    context: { decisionRequest: request() },
  });
  assert.deepEqual(result.conflicts[0].type, "UNKNOWN");
  assert.deepEqual(result.conflicts[0].severity, "UNKNOWN");
  const serialized = JSON.stringify(result);
  for (const privateText of ["PRIVATE VALUE", "PRIVATE CONFLICT TYPE", "PRIVATE SEVERITY", "PRIVATE SUBJECT", "PRIVATE RESOLUTION"]) {
    assert.equal(serialized.includes(privateText), false);
  }
});

test("bornes locales et V2 sont refusées avant projection", () => {
  assert.throws(
    () => projection({ synthesis: synthesis({ claims: new Array(201) }) }),
    /synthesis\.claims dépasse la borne locale de 200/
  );
  assert.throws(
    () => projection({ synthesis: synthesis({ sourceCoverage: new Array(41) }) }),
    /sourceCoverage dépasse la borne locale de 40/
  );
  assert.throws(
    () => projection({ synthesis: synthesis({ conflicts: new Array(201) }) }),
    /conflicts dépasse la borne locale de 200/
  );
  assert.throws(
    () => projection({
      synthesis: synthesis({ conflicts: [{
        conflictId: "large-conflict",
        claims: new Array(201).fill("claim-a"),
        type: "VALUE_CONFLICT",
        severity: "high",
      }] }),
    }),
    /claims dépasse la borne locale de 200/
  );

  const expandedClaims = ["claim-a", "claim-b", "claim-c"].map((claimId) => ({
    claimId,
    independentRoots: Array.from({ length: 40 }, (_, index) => `${claimId}-root-${index}`),
    effectiveAt: null,
    status: "unknown",
  }));
  const expandedMappings = expandedClaims.map((claim, index) => mapping({
    claimId: claim.claimId,
    optionId: index % 2 === 0 ? "option-a" : "option-b",
    value: "GOOD",
  }));
  assert.throws(
    () => projectSynthesisEvidence({
      synthesis: synthesis({
        claims: expandedClaims,
        sourceCoverage: new Array(41),
      }),
      mappings: expandedMappings,
      context: { decisionRequest: request() },
    }),
    /sourceCoverage dépasse la borne locale de 40/
  );
  assert.throws(
    () => projectSynthesisEvidence({
      synthesis: synthesis({
        claims: expandedClaims,
        conflicts: new Array(201),
      }),
      mappings: expandedMappings,
      context: { decisionRequest: request() },
    }),
    /conflicts dépasse la borne locale de 200/
  );
  assert.throws(
    () => projectSynthesisEvidence({
      synthesis: synthesis({ claims: expandedClaims }),
      mappings: expandedMappings,
      context: { decisionRequest: request() },
    }),
    /borne V2 de 100 preuves/
  );
});

test("permuter claims, mappings et racines ne change pas la projection", () => {
  const claims = [
    { claimId: "claim-a", independentRoots: ["root-b", "root-a"], effectiveAt: null, status: "unknown" },
    { claimId: "claim-b", independentRoots: ["root-c"], effectiveAt: null, status: "unknown" },
  ];
  const mappings = [
    mapping(),
    mapping({ claimId: "claim-b", optionId: "option-b", value: "POOR" }),
  ];
  const first = projectSynthesisEvidence({
    synthesis: synthesis({ claims }),
    mappings,
    context: { decisionRequest: request() },
  });
  const second = projectSynthesisEvidence({
    synthesis: synthesis({ claims: [
      { ...claims[1] },
      { ...claims[0], independentRoots: [...claims[0].independentRoots].reverse() },
    ] }),
    mappings: [...mappings].reverse(),
    context: { decisionRequest: request() },
  });
  assert.deepEqual(first, second);
});

test("l'adaptateur ne mute ni synthesis, ni mappings, ni contexte", () => {
  const inputSynthesis = synthesis();
  const inputMappings = [mapping()];
  const inputContext = { decisionRequest: request() };
  const before = structuredClone({ inputSynthesis, inputMappings, inputContext });

  projectSynthesisEvidence({
    synthesis: inputSynthesis,
    mappings: inputMappings,
    context: inputContext,
  });

  assert.deepEqual({ inputSynthesis, inputMappings, inputContext }, before);
});
