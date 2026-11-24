"use strict";

// V3-L7 — application de la décision d'intervention (permission d'interrompre ou d'agir) par
// l'orchestrateur Noon, sortie telle quelle de noon-orchestrator.js. L'orchestrateur la
// construit avec son propre `interventionPermissionEngine`.

function createOrchestratorIntervention({ interventionPermissionEngine }) {
  function applyInterventionDecision({
    actionRequest,
    securityDecision,
    skillPolicy = {},
    profileScope = null,
    workspaceId = null,
  } = {}) {
    if (
      !interventionPermissionEngine ||
      !securityDecision
    ) {
      return securityDecision;
    }

    const rawActionClass =
      String(
        securityDecision.actionClass ||
        skillPolicy.level ||
        actionRequest?.actionClass ||
        "READ"
      ).toUpperCase();

    const normalizedActionClass =
      ({
        EXTERNAL: "EXECUTE",
        DELETE: "DESTRUCTIVE",
        UPDATE: "WRITE",
        CREATE: "WRITE",
      })[rawActionClass] ||
      rawActionClass;

    const actionClass =
      [
        "READ",
        "SUGGEST",
        "PREPARE",
        "WRITE",
        "EXECUTE",
        "DESTRUCTIVE",
      ].includes(
        normalizedActionClass
      )
        ? normalizedActionClass
        : (
            securityDecision.outcome ===
              "REQUIRE_APPROVAL"
              ? "EXECUTE"
              : "READ"
          );

    const interventionDecision =
      interventionPermissionEngine
        .evaluate({
          actionRequest: {
            ...(actionRequest || {}),
            actionClass,
          },

          securityDecision,
          profileScope,
          workspaceId,
        });

    /*
     * OperationalSecurityPolicy reste l'autorité canonique.
     * InterventionPermissionEngine n'écrase jamais son outcome
     * dans le chemin NoonOrchestrator.
     */
    return {
      ...securityDecision,
      interventionDecision,
    };
  }

  return { applyInterventionDecision };
}

module.exports = { createOrchestratorIntervention };
