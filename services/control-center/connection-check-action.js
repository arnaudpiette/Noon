"use strict";

// Action « Tester » d'une connexion du Control Center. Pour Gmail et Google Agenda, un jeton
// présent mais refusé par Google (expiré ou révoqué) doit mener à la reconnexion, comme un jeton
// absent : sinon le bouton reteste sans fin et l'utilisateur n'a aucun moyen de réautoriser.

function createCheckConnectionAction({ googleConnectors = [], reliabilityEngine, createGoogleReadAuthorization } = {}) {
  if (!reliabilityEngine?.check) throw new TypeError("reliabilityEngine requis.");
  if (typeof createGoogleReadAuthorization !== "function") throw new TypeError("createGoogleReadAuthorization requis.");

  async function authorizationRequired(component = null) {
    const { url } = await createGoogleReadAuthorization();
    return component ? { status: "AUTH_REQUIRED", authorizationUrl: url, component } : { status: "AUTH_REQUIRED", authorizationUrl: url };
  }

  return async function checkConnection({ targetId } = {}) {
    const googleConnector = googleConnectors.find((connector) => connector?.id === targetId);
    if (googleConnector && !googleConnector.connected) return authorizationRequired();
    const component = await reliabilityEngine.check(targetId, { force: true });
    if (googleConnector && component?.state === "UNAUTHORIZED") return authorizationRequired(component);
    return { status: "SUCCEEDED", component };
  };
}

module.exports = { createCheckConnectionAction };
