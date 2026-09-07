"use strict";

const crypto = require("node:crypto");
const { CHANNEL_SCOPES, validateRemoteInput } = require("./remote-schema");
const { verifyRemoteInput } = require("./remote-auth");

function digest(value) { return crypto.createHash("sha256").update(String(value)).digest("hex"); }
function createRemoteInteractionEngine({ repository, deviceRegistry, presenceService, handoffService, streamService, responsePolicy, intentCommandEngine, sessionContinuityEngine, handleIntent, backgroundJobEngine = null, mediaService = null, approvalService = null, mode = "SHADOW", now = () => Date.now(), observability = null } = {}) {
  if (!repository || !deviceRegistry || !intentCommandEngine || !sessionContinuityEngine || !handleIntent) throw new TypeError("Dépendances RemoteInteractionEngine incomplètes."); let currentMode = mode;
  const emit = (event, metadata = {}) => observability?.(event, metadata);
  function authenticate(raw) {
    const input = validateRemoteInput(raw, { now: now() }); const device = deviceRegistry.assertAuthorized(input.deviceId, CHANNEL_SCOPES[input.channel]);
    if (!verifyRemoteInput(input, device.publicSigningKey)) throw Object.assign(new Error("Signature RemoteInput invalide."), { code: "REMOTE_SIGNATURE_INVALID" });
    const replay = repository.findReplay({ requestId: input.requestId, remoteInputId: input.remoteInputId, deviceId: input.deviceId, nonceHash: digest(input.nonce) });
    return { input, device, replay };
  }
  async function receive(raw) {
    const started = now(); const { input, device, replay } = authenticate(raw);
    if (replay) return { deduplicated: true, request: replay, outputs: repository.outputsAfter(replay.requestId, 0) };
    const request = repository.createRequest({ ...input, nonceHash: digest(input.nonce), state: "ACCEPTED", createdAt: input.timestamp, expiresAt: input.expiresAt }); emit("remote_request_authenticated", { requestId: input.requestId, deviceId: input.deviceId, channel: input.channel });
    presenceService?.update(input.deviceSessionId, { activeConversationId: input.conversationId, presenceState: "ACTIVE" });
    try {
      if (input.channel === "APPROVAL_RESPONSE") { if (!approvalService) throw Object.assign(new Error("Approbations distantes désactivées."), { code: "REMOTE_APPROVALS_DISABLED" }); const result = approvalService.verify({ ...input.payload, deviceId: input.deviceId }); repository.updateRequest(input.requestId, "COMPLETED", { resultRef: { approvalId: input.payload.approvalId } }); return { request, result }; }
      if (input.channel === "MEDIA") { if (!mediaService) throw Object.assign(new Error("Médias distants désactivés."), { code: "REMOTE_MEDIA_DISABLED" }); const result = await mediaService.receive({ ...input.payload, requestId: input.requestId, deviceId: input.deviceId }); repository.updateRequest(input.requestId, "COMPLETED", { resultRef: { transferId: input.payload.transferId } }); return { request, result }; }
      if (input.channel === "JOB_CONTROL") { const action = input.payload.action; const job = action === "CANCEL" ? backgroundJobEngine?.cancel(input.payload.jobId, { profileScope: "arnaud" }) : backgroundJobEngine?.get(input.payload.jobId); if (!job) throw Object.assign(new Error("Job distant introuvable."), { code: "REMOTE_JOB_NOT_FOUND" }); const output = streamService.emit({ deviceSessionId: input.deviceSessionId, requestId: input.requestId, conversationId: input.conversationId, type: "JOB_STATUS", payloadRef: { jobId: job.id, state: job.state }, final: true }); repository.updateRequest(input.requestId, "COMPLETED", { resultRef: output.output.payloadRef }); return { request, output }; }
      const handoff = !input.conversationId && /^\s*(continue|reprends|la suite)\s*[.!?]*$/i.test(String(input.payload.text || "")) ? handoffService.resolve({ targetDeviceId: input.deviceId }) : null;
      if (handoff?.status === "AMBIGUOUS") { repository.updateRequest(input.requestId, "FAILED", { resultRef: { reason: "HANDOFF_AMBIGUOUS" } }); return { request, clarificationRequired: true, candidates: handoff.candidates }; }
      const conversationId = input.conversationId || handoff?.handoff?.conversationId;
      if (!conversationId) throw Object.assign(new Error("Conversation distante requise."), { code: "REMOTE_CONVERSATION_REQUIRED" });
      const continuity = sessionContinuityEngine.resolveSession({ conversationId, workspaceId: input.workspaceId || handoff?.handoff?.workspaceId, channel: input.channel === "VOICE" ? "voice" : "remote", profileScope: "arnaud" });
      const intent = await intentCommandEngine.parse(input.channel === "VOICE" ? "voice" : "chat", { text: input.payload.text, transcript: input.payload.transcript, conversationId, sessionId: continuity.id, workspaceId: input.workspaceId, metadata: { remote: true, deviceId: input.deviceId, origin: "EXPLICIT_USER_REMOTE_DEVICE" } }, { ...sessionContinuityEngine.contextForRequest(continuity.id), continuationAvailable: Boolean(handoff?.handoff) });
      repository.updateRequest(input.requestId, "RUNNING", { intentRef: { intentId: intent.intentId, type: intent.type, origin: "EXPLICIT_USER_REMOTE_DEVICE", deviceId: input.deviceId } });
      if (currentMode === "OFF" || currentMode === "SHADOW") return { request, intent, shadow: currentMode === "SHADOW", executed: false };
      emit("remote_response_started", { requestId: input.requestId, channel: input.channel });
      const result = await handleIntent({ intent, input, conversationId, continuitySession: continuity, onDelta: (delta) => streamService.delta({ deviceSessionId: input.deviceSessionId, requestId: input.requestId, conversationId }, delta) });
      const privacy = responsePolicy.evaluate({ classification: result.classification || "NORMAL", profileScope: result.profileScope || "arnaud", device, sourceRefs: result.sourceRefs || [] });
      if (!privacy.allowed) throw Object.assign(new Error("Réponse distante bloquée par la politique de confidentialité."), { code: "REMOTE_OUTPUT_POLICY_DENY", reasonCodes: privacy.reasonCodes });
      const messageId = result.messageId || `message_${crypto.randomUUID()}`; const output = streamService.finalize({ deviceSessionId: input.deviceSessionId, requestId: input.requestId, conversationId }, { messageId, text: result.answer, state: result.interrupted ? "interrupted" : "completed", classification: privacy.classification });
      repository.updateRequest(input.requestId, result.waitingApproval ? "WAITING_APPROVAL" : "COMPLETED", { resultRef: { messageId, outputId: output.output.remoteOutputId } });
      if (handoff?.handoff) handoffService.complete(handoff.handoff.handoffId); emit("remote_request_received", { requestId: input.requestId, durationMs: now() - started }); return { request, intent, result, output };
    } catch (error) { repository.updateRequest(input.requestId, error.code === "REMOTE_REQUEST_EXPIRED" ? "EXPIRED" : "FAILED", { resultRef: { errorCode: error.code || "REMOTE_FAILED" } }); emit("remote_request_rejected", { requestId: input.requestId, code: error.code || "REMOTE_FAILED" }); throw error; }
  }
  function setMode(next) { currentMode = next; }
  return { authenticate, mode: () => currentMode, receive, resume: streamService.resume, setMode, status: () => ({ mode: currentMode, ...repository.stats(), connectedDevices: presenceService?.list().filter((item) => item.connectionState === "CONNECTED").length || 0 }) };
}

module.exports = { createRemoteInteractionEngine };
