"use strict";

const crypto = require("node:crypto");

const MEDIA_TYPES = Object.freeze(["IMAGE", "SCREENSHOT", "PDF", "AUDIO", "DOCUMENT_VISUAL", "VIDEO"]);
const SOURCE_TYPES = Object.freeze(["USER_UPLOAD", "LOCAL_FILE", "ARTIFACT", "SCREEN_CAPTURE", "CONNECTOR_FILE", "PUBLIC_WEB", "GENERATED"]);
const PROCESSING_STATES = Object.freeze(["REGISTERED", "INSPECTING", "EXTRACTING", "ANALYZING", "READY", "PARTIAL", "FAILED", "UNSUPPORTED", "UNAVAILABLE", "INTERRUPTED"]);
const EVIDENCE_TYPES = Object.freeze(["TEXT", "VISUAL_OBSERVATION", "TABLE", "CHART", "AUDIO_TRANSCRIPT", "METADATA"]);
const CONFIDENCE_LEVELS = Object.freeze(["HIGH", "MEDIUM", "LOW", "UNKNOWN"]);
const EXTRACTION_METHODS = Object.freeze(["native_text", "vision", "ocr", "speech_transcription", "metadata"]);

function stableHash(value, length = 32) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, length);
}

function clean(value, maximum = 180) {
  return value == null ? null : String(value).replace(/[\0\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum) || null;
}

function normalizeMultimodalRequest(input = {}) {
  return {
    requestId: clean(input.requestId, 160) || `media-request-${crypto.randomUUID()}`,
    assetIds: [...new Set((input.assetIds || []).map((item) => clean(item, 160)).filter(Boolean))].slice(0, 12),
    userIntent: clean(input.userIntent, 4000) || "Analyser le média fourni.",
    workspaceId: clean(input.workspaceId, 160),
    conversationId: clean(input.conversationId, 160),
    requestedOutputs: [...new Set((input.requestedOutputs || ["SUMMARY"]).map((item) => clean(item, 80)).filter(Boolean))].slice(0, 12),
    analysisDepth: ["LIGHT", "STANDARD", "DEEP"].includes(input.analysisDepth) ? input.analysisDepth : "STANDARD",
    privacyContext: {
      localOnly: input.privacyContext?.localOnly === true,
      allowRemote: input.privacyContext?.allowRemote !== false,
      sourceScope: input.privacyContext?.sourceScope === "PUBLIC" ? "PUBLIC" : "PERSONAL",
    },
  };
}

module.exports = {
  CONFIDENCE_LEVELS, EVIDENCE_TYPES, EXTRACTION_METHODS, MEDIA_TYPES,
  PROCESSING_STATES, SOURCE_TYPES, clean, normalizeMultimodalRequest, stableHash,
};
