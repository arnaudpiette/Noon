"use strict";

const CAPABILITIES = Object.freeze({
  IN_APP: { supportsActions: true, supportsReplacement: true, supportsDeliveryAck: true, supportsSensitiveContent: true, supportsSound: false, supportsRichContent: true },
  MACOS_NOTIFICATION: { supportsActions: false, supportsReplacement: false, supportsDeliveryAck: false, supportsSensitiveContent: false, supportsSound: true, supportsRichContent: false },
  MOBILE_PUSH: { supportsActions: true, supportsReplacement: true, supportsDeliveryAck: true, supportsSensitiveContent: false, supportsSound: true, supportsRichContent: false },
  BADGE: { supportsActions: false, supportsReplacement: true, supportsDeliveryAck: false, supportsSensitiveContent: false, supportsSound: false, supportsRichContent: false },
  VOICE: { supportsActions: false, supportsReplacement: false, supportsDeliveryAck: false, supportsSensitiveContent: false, supportsSound: true, supportsRichContent: false },
});
function createDeliveryRouter({ handlers = {}, capabilities = CAPABILITIES } = {}) {
  function available(channel, context = {}) { return Boolean(handlers[channel]) && context.deviceCapabilities?.[channel] !== false; }
  async function deliver(record, context = {}) {
    const handler = handlers[record.channel]; if (!handler || !available(record.channel, context)) return { ok: false, retryable: false, code: "CHANNEL_UNAVAILABLE" };
    try { const result = await handler(record, context); return { ok: result?.ok !== false, acknowledged: result?.acknowledged === true, externalId: result?.externalId || null }; }
    catch (error) { return { ok: false, retryable: error?.retryable === true, unknownOutcome: error?.unknownOutcome === true, code: String(error?.code || "DELIVERY_FAILED").slice(0, 80) }; }
  }
  return { available, capabilities: (channel) => capabilities[channel] || null, deliver, list: () => Object.entries(capabilities).map(([channelId, value]) => ({ channelId, ...value, available: Boolean(handlers[channelId]) })) };
}
module.exports = { CAPABILITIES, createDeliveryRouter };
