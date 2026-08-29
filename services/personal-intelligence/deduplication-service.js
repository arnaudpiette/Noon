"use strict";

const crypto = require("crypto");
function recommendationHash(value) { return crypto.createHash("sha256").update(JSON.stringify([value.sourceType,value.sourceReference,value.action,value.projectId||null])).digest("hex"); }
function createDeduplicationService(repository, { defaultCooldownHours = 24, maxNonUrgentPerDay = 3 } = {}) {
  function evaluate(recommendation, now = new Date()) {
    const hash=recommendationHash(recommendation); const existing=repository.getRecommendationByHash(hash); const reactivationKey=String(recommendation.reactivationKey||recommendation.deadline||recommendation.sourceUpdatedAt||"");
    if(existing){const cooldownValue=existing.cooldownUntil||existing.cooldown_until;const previousKey=existing.reactivationKey||existing.reactivation_key;const changed=reactivationKey&&reactivationKey!==previousKey;if(existing.status==="dismissed"&&!changed)return{allowed:false,hash,reason:"dismissed"};const cooldown=cooldownValue&&new Date(cooldownValue)>now;const riskIncreased=Number(recommendation.score)>Number(existing.score)+10;if(cooldown&&!changed&&!riskIncreased)return{allowed:false,hash,reason:"cooldown"};}
    const cooldownUntil=new Date(now.getTime()+defaultCooldownHours*3_600_000).toISOString(); repository.saveRecommendation({hash,inboxItemId:recommendation.inboxItemId,score:recommendation.score,priorityLevel:recommendation.priorityLevel,payload:recommendation,cooldownUntil,reactivationKey,status:"ready"}); return{allowed:true,hash,reason:existing?"reactivated":"new",maxNonUrgentPerDay};
  }
  function recordPresented(hash, at) { repository.recordPresentation(hash, at); }
  return { evaluate, recordPresented, recommendationHash };
}
module.exports = { createDeduplicationService, recommendationHash };
