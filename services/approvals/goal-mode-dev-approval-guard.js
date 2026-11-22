"use strict";

/*
 * B3a — Les approbations Goal Mode DEV ont leur carte dédiée : elles ne sont
 * ni listées ni reprises par les routes d'approbation génériques.
 */

const { SKILL_NAME } = require("../goals/goal-mode-dev-approval-action");

// V3-L5c : les missions DEV déléguées ont aussi leurs routes dédiées (/api/dev-missions).
const DEDICATED_SKILLS = new Set([SKILL_NAME, "dev-mission"]);

function isGoalModeDevApproval(approval) {
  return DEDICATED_SKILLS.has(approval?.skillName) || DEDICATED_SKILLS.has(approval?.provider);
}

function genericApprovals(list) {
  return (Array.isArray(list) ? list : []).filter((approval) => !isGoalModeDevApproval(approval));
}

function assertGenericApprovalAllowed(approval) {
  if (isGoalModeDevApproval(approval)) {
    throw Object.assign(new Error("Approbation Goal Mode DEV : utiliser la carte dédiée."), {
      statusCode: 409, code: "GOAL_MODE_DEV_APPROVAL_DEDICATED",
    });
  }
  return approval;
}

module.exports = { assertGenericApprovalAllowed, genericApprovals, isGoalModeDevApproval };
