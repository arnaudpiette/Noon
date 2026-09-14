"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { ApprovalManager } = require("../services/approvals/approval-manager");
const { createContextCapsuleBuilder } = require("../services/delegation/context-capsule-builder");
const { createDelegationEngine } = require("../services/delegation/delegation-engine");
const { createSpecialistRegistry } = require("../services/delegation/specialist-registry");
const { createNoonOrchestrator } = require("../services/orchestration/noon-orchestrator");
const { createOpenAIProviderAdapter } = require("../services/models/providers/openai-provider");
const { PROVIDERS } = require("../services/models/model-registry");
const { createProviderPrivacyPolicy } = require("../services/security/provider-privacy-policy");
const { createOperationalSecurityPolicy } = require("../services/security/operational-security-policy");

function modelResponse(text) {
  return { output_text: text, output: [], usage: { input_tokens: 1, output_tokens: 1 } };
}

function specialistProposal(overrides = {}) {
  return {
    toolRequestId: "proposal-1",
    skillId: "send_email",
    operation: "send",
    purpose: "Envoyer le compte rendu validé",
    requestedInputs: { to: "client@example.test", body: "Compte rendu" },
    ...overrides,
  };
}

function createRealDelegationEngine(proposal) {
  return createDelegationEngine({
    registry: createSpecialistRegistry(),
    capsuleBuilder: createContextCapsuleBuilder(),
    modelRouter: () => ({ model: "gpt-5.6-luna", effort: "low", verbosity: "low" }),
    async runSpecialist({ specialist, capsule }) {
      return {
        specialistRunId: `run-${specialist.specialistId.toLowerCase()}`,
        specialistId: specialist.specialistId,
        subtaskId: capsule.subtaskId,
        status: "COMPLETED",
        summary: "Proposition bornée du spécialiste.",
        findings: [],
        recommendations: [],
        evidenceRefs: [],
        assumptions: [],
        uncertainties: [],
        proposedActions: [],
        proposedToolRequests: [proposal],
        artifactsSuggested: [],
        metrics: { modelCalls: 1, inputTokens: 10, outputTokens: 5, cost: 0 },
      };
    },
  });
}

function createFixture(proposal) {
  let executions = 0;
  let transactionalExecutions = 0;
  const responses = [modelResponse("La proposition refusée est visible dans les métadonnées.")];
  const approvalManager = new ApprovalManager();
  const operationalSecurityPolicy = createOperationalSecurityPolicy({
    hardRulesRegistry: { version: () => "rules-test", getRulesForContext: () => [] },
    permissionProvider: () => ({ allowed: true, code: "AUTHORIZED" }),
    allowedRootsProvider: () => ["/tmp"],
    allowedWriteRootsProvider: () => ["/tmp"],
  });
  const skillRegistry = {
    getSkillByName(name) {
      return {
        definition: { name },
        permissions: name === "write_artifact"
          ? { level: "write", confirmationRequired: true, networkAccess: false }
          : { level: "external", confirmationRequired: true, networkAccess: true },
        execution: { idempotent: false },
      };
    },
    authorize: () => ({ allowed: true, code: "AUTHORIZED" }),
    async executeSkill(name, args, context) {
      executions += 1;
      return { ok: true, name, args, confirmed: context.confirmed === true };
    },
  };
  const transactionalExecutionEngine = {
    async executeSingleStep(request) {
      transactionalExecutions += 1;
      const recheck = await request.revalidate();
      assert.notEqual(recheck.outcome, "DENY");
      assert.notEqual(recheck.outcome, "REQUIRE_APPROVAL");
      const preconditions = await request.checkPreconditions();
      assert.equal(preconditions.valid, true);
      return { status: "SUCCEEDED", result: await request.executeStep() };
    },
  };
  const client = {
    responses: {
      async create() {
        const next = responses.shift();
        if (!next) throw new Error("Appel modèle inattendu.");
        return next;
      },
    },
  };
  const providerPrivacyPolicy = createProviderPrivacyPolicy({ providerRegistry: PROVIDERS });
  const orchestrator = createNoonOrchestrator({
    contextBuilder: {
      buildContext() {
        return {
          remoteModelContext: {},
          runtime: {},
          metadata: { ruleIds: [], memoryIds: [], contextFingerprint: "context-test" },
        };
      },
    },
    selectModel: () => ({ model: "gpt-5.6-luna", effort: "low", verbosity: "low" }),
    modelFallbacks: () => ["gpt-5.6-luna"],
    providerAdapter: createOpenAIProviderAdapter({ clientProvider: () => client, privacyPolicy: providerPrivacyPolicy }),
    providerPrivacyPolicy,
    skillRegistry,
    approvalManager,
    getTools: () => [],
    buildSkillContext: () => ({ allowedRoots: ["/tmp"], explicitOrder: false }),
    captureApprovalPreconditions: () => ({ version: 1 }),
    recheckApprovalPreconditions: (_record, original) => original,
    operationalSecurityPolicy,
    transactionalExecutionEngine,
    delegationEngine: createRealDelegationEngine(proposal),
  });
  const request = {
    query: "Fais un audit complet du code et propose les actions nécessaires.",
    channel: "chat",
    modelProfile: "balanced",
    budgetMode: "NORMAL",
    maxRounds: 1,
    delegationFeatureMode: "ON",
    contextInput: { query: "Audit complet du code", channel: "chat" },
    buildInput: () => [{ role: "user", content: "Audit complet du code" }],
  };
  return {
    orchestrator,
    request,
    get executions() { return executions; },
    get transactionalExecutions() { return transactionalExecutions; },
  };
}

test("une proposition de spécialiste approuvée suit le chemin d'exécution officiel réel", async () => {
  const fixture = createFixture(specialistProposal());
  const pending = await fixture.orchestrator.run(fixture.request);

  assert.equal(pending.status, "approval_required");
  assert.equal(pending.type, "specialist_proposal");
  assert.equal(pending.approval.executionId, pending.executionId);
  assert.equal(fixture.executions, 0);
  assert.equal(fixture.transactionalExecutions, 0);

  const completed = await fixture.orchestrator.resume({
    executionId: pending.executionId,
    approvalId: pending.approval.id,
    resumeToken: pending.approval.resumeToken,
    decision: "approve",
  });

  assert.equal(completed.status, "completed");
  assert.equal(completed.specialistProposal.status, "executed");
  assert.match(completed.text, /approuvée et exécutée/);
  assert.equal(fixture.executions, 1);
  assert.equal(fixture.transactionalExecutions, 1);
});

test("une proposition de spécialiste refusée par la policy ne produit aucun effet et reste tracée", async () => {
  const fixture = createFixture(specialistProposal({
    skillId: "write_artifact",
    operation: "write",
    purpose: "Écrire hors du périmètre autorisé",
    requestedInputs: { path: "/private/noon-forbidden/result.txt", content: "X" },
  }));
  const result = await fixture.orchestrator.run(fixture.request);

  assert.equal(result.status, "completed");
  assert.equal(fixture.executions, 0);
  assert.equal(fixture.transactionalExecutions, 0);
  assert.equal(result.metadata.specialistProposals.length, 1);
  assert.equal(result.metadata.specialistProposals[0].outcome, "DENY");
  assert.equal(result.metadata.specialistProposals[0].denied, true);
  assert.ok(result.metadata.specialistProposals[0].reasonCodes.includes("TARGET_OUT_OF_SCOPE"));
  assert.match(result.text, /bloqué 1 proposition de spécialiste/);
});

test("le rejet utilisateur d'une proposition en attente ne produit aucun effet", async () => {
  const fixture = createFixture(specialistProposal());
  const pending = await fixture.orchestrator.run(fixture.request);
  const rejected = await fixture.orchestrator.resume({
    executionId: pending.executionId,
    approvalId: pending.approval.id,
    resumeToken: pending.approval.resumeToken,
    decision: "reject",
  });

  assert.equal(rejected.status, "completed");
  assert.equal(rejected.specialistProposal.status, "rejected");
  assert.match(rejected.text, /refusée et n’a pas été exécutée/);
  assert.equal(fixture.executions, 0);
  assert.equal(fixture.transactionalExecutions, 0);
});
