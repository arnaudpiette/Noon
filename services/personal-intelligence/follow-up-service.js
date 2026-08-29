"use strict";

const VALID_OUTCOMES = new Set(["completed", "continue", "blocked", "cancelled", "misestimated"]);
function createFollowUpService(repository) {
  function schedule(item) { return repository.saveFollowup({ ...item, status: "pending" }); }
  function complete(item) { if (!VALID_OUTCOMES.has(item.outcome)) throw new Error("Résultat de suivi invalide."); const saved=repository.saveFollowup({ ...item, status:item.outcome, followedUpAt:new Date().toISOString() }); if(item.projectId&&item.nextAction){const project=repository.getProject(item.projectId);if(project)repository.upsertProject({...project,nextAction:item.nextAction,status:item.outcome==="blocked"?"blocked":project.status});} return saved; }
  return { complete, due: repository.listDueFollowups, schedule };
}
module.exports = { VALID_OUTCOMES, createFollowUpService };
