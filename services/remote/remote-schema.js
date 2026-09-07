"use strict";

const crypto = require("node:crypto");

const REMOTE_PROTOCOL_VERSION = 1;
const REMOTE_CHANNELS = Object.freeze(["TEXT", "VOICE", "MEDIA", "UI_ACTION", "APPROVAL_RESPONSE", "JOB_CONTROL"]);
const REMOTE_OUTPUT_TYPES = Object.freeze(["TEXT_DELTA", "TEXT_FINAL", "VOICE_EVENT", "JOB_CREATED", "JOB_STATUS", "APPROVAL_REQUIRED", "APPROVAL_RESULT", "MEDIA_RESULT", "ERROR", "PRESENCE"]);
const CONNECTION_STATES = Object.freeze(["DISCONNECTED", "CONNECTING", "CONNECTED", "DEGRADED", "RECONNECTING"]);
const PRESENCE_STATES = Object.freeze(["ACTIVE", "IDLE", "BACKGROUND", "OFFLINE", "UNKNOWN", "STALE"]);
const REQUEST_STATES = Object.freeze(["CREATED", "PENDING_DELIVERY", "DELIVERED", "ACCEPTED", "RUNNING", "WAITING_APPROVAL", "COMPLETED", "FAILED", "EXPIRED", "CANCELLED"]);
const CAPABILITIES = Object.freeze(["TEXT", "VOICE", "IMAGE_UPLOAD", "FILE_UPLOAD", "APPROVAL_UI", "ARTIFACT_PREVIEW", "PUSH", "JOB_STATUS"]);
const CHANNEL_SCOPES = Object.freeze({ TEXT: "REMOTE_TEXT", VOICE: "REMOTE_VOICE", MEDIA: "REMOTE_MEDIA", UI_ACTION: "REMOTE_TEXT", APPROVAL_RESPONSE: "REMOTE_APPROVALS", JOB_CONTROL: "REMOTE_JOBS" });

function clean(value, max = 160) { return value == null ? null : String(value).replace(/[\0\r\n]+/g, " ").trim().slice(0, max) || null; }
function validateRemoteInput(value, { now = Date.now() } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Object.assign(new Error("RemoteInput invalide."), { code: "REMOTE_INPUT_INVALID" });
  const channel = String(value.channel || "").toUpperCase();
  if (!REMOTE_CHANNELS.includes(channel)) throw Object.assign(new Error("Canal distant invalide."), { code: "REMOTE_CHANNEL_INVALID" });
  if (Number(value.protocolVersion) !== REMOTE_PROTOCOL_VERSION) throw Object.assign(new Error("Version Remote incompatible."), { code: "REMOTE_PROTOCOL_INCOMPATIBLE" });
  const envelope = {
    remoteInputId: clean(value.remoteInputId), deviceId: clean(value.deviceId), deviceSessionId: clean(value.deviceSessionId),
    channel, conversationId: clean(value.conversationId), workspaceId: clean(value.workspaceId), payload: value.payload && typeof value.payload === "object" ? structuredClone(value.payload) : {},
    timestamp: clean(value.timestamp), expiresAt: clean(value.expiresAt), sequence: Number(value.sequence), requestId: clean(value.requestId), nonce: clean(value.nonce, 240),
    signature: clean(value.signature, 2048), protocolVersion: Number(value.protocolVersion),
  };
  if (![envelope.remoteInputId, envelope.deviceId, envelope.deviceSessionId, envelope.requestId, envelope.nonce, envelope.signature, envelope.timestamp].every(Boolean) || !Number.isSafeInteger(envelope.sequence) || envelope.sequence < 1) throw Object.assign(new Error("RemoteInput incomplet."), { code: "REMOTE_INPUT_INVALID" });
  if (envelope.expiresAt && Date.parse(envelope.expiresAt) <= now) throw Object.assign(new Error("Requête distante expirée."), { code: "REMOTE_REQUEST_EXPIRED" });
  return envelope;
}
function createRemoteOutput({ requestId, conversationId = null, type, payloadRef = {}, sequence, final = false, now = Date.now } = {}) {
  if (!REMOTE_OUTPUT_TYPES.includes(type)) throw new TypeError("Type RemoteOutput invalide.");
  return { remoteOutputId: `remote_output_${crypto.randomUUID()}`, requestId, conversationId, type, payloadRef: structuredClone(payloadRef), sequence, final: final === true, createdAt: new Date(now()).toISOString(), protocolVersion: REMOTE_PROTOCOL_VERSION };
}

module.exports = { CAPABILITIES, CHANNEL_SCOPES, CONNECTION_STATES, PRESENCE_STATES, REMOTE_CHANNELS, REMOTE_OUTPUT_TYPES, REMOTE_PROTOCOL_VERSION, REQUEST_STATES, createRemoteOutput, validateRemoteInput };
