"use strict";

// V3-L7 — résultats de l'orchestrateur Noon (proposition d'un spécialiste, résultat final avec
// trace et observabilité), sortis tels quels de noon-orchestrator.js. L'orchestrateur les
// construit avec ses propres `now`, `observability` et `trace`.

function createOrchestratorResults({ now, observability, trace }) {
  function specialistProposalResult(state, { status, proposal, result = null, policyDecision = null }) {
    state.metrics.totalMs = now() - state.startedAt;
    const executed = status === "executed";
    const rejected = status === "rejected";
    const text = executed
      ? `La proposition du spécialiste a été approuvée et exécutée : ${proposal.purpose || proposal.operation || proposal.skillId}.`
      : rejected
        ? `La proposition du spécialiste a été refusée et n’a pas été exécutée : ${proposal.purpose || proposal.operation || proposal.skillId}.`
        : `La proposition du spécialiste a été bloquée par la politique de sécurité et n’a pas été exécutée : ${proposal.purpose || proposal.operation || proposal.skillId}.`;
    return {
      status: "completed",
      text,
      executionId: state.executionId,
      requestedModel: null,
      modelUsed: null,
      route: null,
      toolCalls: state.toolCalls,
      approvals: [],
      usage: null,
      latency: { ...state.metrics },
      metadata: {
        context: state.context.metadata,
        delegation: state.delegation ? {
          delegationPlanId: state.delegation.plan?.delegationPlanId || null,
          status: state.delegation.status,
          reasonCodes: state.delegation.reasonCodes || [],
        } : null,
        specialistProposals: [{
          toolRequestId: proposal.toolRequestId,
          skillId: proposal.skillId,
          operation: proposal.operation,
          status,
          outcome: policyDecision?.outcome || null,
          reasonCodes: policyDecision?.reasons || [],
        }],
        toolRounds: state.metrics.toolRounds,
        fallbackCount: state.metrics.fallbackCount,
        secondOpinion: state.secondOpinion || null,
      },
      specialistProposal: { status, proposal, result, policyDecision },
      response: null,
    };
  }

  function finalResult(state, response, text) {
    state.metrics.totalMs = now() - state.startedAt;
    const deniedProposalCount = (state.proposalResults || []).filter((item) => item.denied === true).length;
    const visibleText = deniedProposalCount > 0
      ? `${text || "Je n'ai pas réussi à produire une réponse exploitable."}\n\nNoon a bloqué ${deniedProposalCount} proposition${deniedProposalCount > 1 ? "s" : ""} de spécialiste par mesure de sécurité ; aucune action correspondante n’a été exécutée.`
      : text || "Je n'ai pas réussi à produire une réponse exploitable.";
    const result = {
      status: "completed",
      text: visibleText,
      executionId: state.executionId,
      requestedModel: state.route.model,
      modelUsed: state.modelUsed || state.route.model,
      route: state.route,
      toolCalls: state.toolCalls,
      approvals: [],
      usage: response?.usage || null,
      latency: { ...state.metrics },
      metadata: {
        context: state.context.metadata,
        delegation: state.delegation ? {
          delegationPlanId: state.delegation.plan?.delegationPlanId || null,
          status: state.delegation.status,
          reasonCodes: state.delegation.reasonCodes || [],
          specialists: (state.delegation.results || []).map((item) => ({ specialistId: item.specialistId, status: item.status })),
          metrics: state.delegation.metrics || {},
        } : null,
        specialistProposals: (state.proposalResults || []).map((item) => ({
          toolRequestId: item.toolRequestId,
          skillId: item.skillId,
          operation: item.operation,
          outcome: item.policyDecision?.outcome || null,
          reasonCodes: item.policyDecision?.reasons || [],
          denied: item.denied === true,
        })),
        priorities: state.priorities.map(({ id, score, priorityLevel, scoringVersion }) => ({ id, score, priorityLevel, scoringVersion })),
        toolRounds: state.metrics.toolRounds,
        fallbackCount: state.metrics.fallbackCount,
        secondOpinion: state.secondOpinion || null,
      },
      response,
    };
    trace("completed", state, {
      modelUsed: result.modelUsed,
      toolRounds: result.metadata.toolRounds,
      fallbackCount: result.metadata.fallbackCount,
      totalMs: result.latency.totalMs,
    });
    observability?.completeExecution(state.executionId, {
      status: "completed",
      toolRounds: state.metrics.toolRounds,
      wallClockTotalMs: state.metrics.totalMs,
      technicalExecutionMs: Math.max(0, state.metrics.totalMs - state.metrics.approvalWaitMs),
    });
    return result;
  }

  return { specialistProposalResult, finalResult };
}

module.exports = { createOrchestratorResults };
