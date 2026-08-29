"use strict";

// Les items Responses sont conservés tels quels : call_id, résultats d’outils,
// raisonnement chiffré et items de compaction ne doivent pas être aplatis.
function preserveResponseItems(items = []) {
  return items.filter((item) => item && typeof item === "object").map((item) => structuredClone(item));
}
function appendTurn(context, response, nextUserMessage = null) {
  const next=[...preserveResponseItems(context),...preserveResponseItems(response?.output||[])];
  if(nextUserMessage)next.push({type:"message",role:"user",content:nextUserMessage});
  return next;
}
module.exports = { appendTurn, preserveResponseItems };
