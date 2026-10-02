"use strict";

const { INTERNET_DECISIONS } = require("./internet-decision-router");

function limitation(reasonCode, message) {
  return Object.freeze({
    execute: false,
    reasonCode,
    message,
  });
}

/*
 * Ce garde ne décide ni de l'utilité du Web ni de son autorisation. Il ne fait
 * que traduire la décision canonique déjà produite pour le chat en appel vers
 * PublicResearchEngine ou en limitation explicite.
 */
function resolveChatResearchPlan({
  internetDecision,
  webSearchPreference = false,
  publicResearchEnabled = false,
  remainingWebCalls = 0,
} = {}) {
  if (!internetDecision?.decision) throw new TypeError("Décision Internet requise.");

  const decision = internetDecision.decision;
  if (decision === INTERNET_DECISIONS.LOCAL_ONLY) return limitation(internetDecision.reasonCode, null);
  if (decision === INTERNET_DECISIONS.ASK_USER) {
    return limitation("REMOTE_CONSENT_REQUIRED", "Je dois d’abord te demander confirmation avant de rechercher des sources publiques.");
  }

  const required = decision === INTERNET_DECISIONS.WEB_REQUIRED;
  const requested = required || (decision === INTERNET_DECISIONS.WEB_ALLOWED_OPTIONAL && webSearchPreference === true);
  if (!requested) return limitation("LOCAL_CONTEXT_SUFFICIENT", null);
  if (!publicResearchEnabled) {
    return limitation("PUBLIC_RESEARCH_DISABLED", "La recherche Internet nécessaire est désactivée pour le moment ; je ne peux pas présenter cette information comme vérifiée.");
  }
  if (Number(remainingWebCalls) <= 0) {
    return limitation("WEB_SEARCH_DAILY_LIMIT", "La limite quotidienne de recherches Internet est atteinte ; je ne peux pas vérifier cette information actuelle.");
  }
  return Object.freeze({
    execute: true,
    reasonCode: internetDecision.reasonCode,
    maxWebToolCalls: Math.min(2, Number(remainingWebCalls)),
  });
}

async function executeChatResearchPlan({ plan, research, input, onResearchStart } = {}) {
  if (plan?.execute !== true) return null;
  if (typeof research !== "function") throw new TypeError("Recherche publique requise.");
  onResearchStart?.();
  return research(input);
}

module.exports = { executeChatResearchPlan, resolveChatResearchPlan };
