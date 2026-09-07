"use strict";

const { createRemoteOutput } = require("./remote-schema");

function createRemoteStreamService({ repository, transportRouter, conversationStore = null, now = () => Date.now(), observability = null } = {}) {
  function emit({ deviceSessionId, requestId, conversationId, type, payloadRef, final = false }) {
    const sequence = repository.nextOutputSequence(requestId); const output = createRemoteOutput({ requestId, conversationId, type, payloadRef, sequence, final, now }); repository.saveOutput(output);
    const route = transportRouter.select({ deviceSessionId, channel: type === "VOICE_EVENT" ? "VOICE" : "TEXT", realtime: !final });
    if (route.transport) route.transport.send(output); return { output, delivery: route.status };
  }
  function delta(context, text) { return emit({ ...context, type: "TEXT_DELTA", payloadRef: { delta: String(text).slice(0, 4000) }, final: false }); }
  function finalize(context, { messageId, text, state = "completed", classification = "NORMAL" }) {
    const persisted = conversationStore?.appendAssistant?.({ conversationId: context.conversationId, messageId, text, state }) || { messageId };
    const result = emit({ ...context, type: "TEXT_FINAL", payloadRef: { messageId: persisted.messageId || messageId, state, classification }, final: true }); observability?.("remote_response_completed", { requestId: context.requestId, messageId: persisted.messageId || messageId }); return result;
  }
  function resume(requestId, afterSequence = 0) { return repository.outputsAfter(requestId, afterSequence); }
  return { delta, emit, finalize, resume };
}

module.exports = { createRemoteStreamService };
