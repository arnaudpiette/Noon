"use strict";

function selectMediaStrategy(asset, inspection = {}, request = {}) {
  if (asset.mediaType === "VIDEO") return { strategy: "UNSUPPORTED", requiredCapabilities: [], reason: "video_not_supported" };
  if (asset.mediaType === "AUDIO") return { strategy: "SPEECH_TRANSCRIPTION", requiredCapabilities: ["AUDIO_TRANSCRIPTION"], reason: "spoken_audio" };
  if (["IMAGE", "SCREENSHOT"].includes(asset.mediaType)) return { strategy: "VISION", requiredCapabilities: ["VISION", "STRUCTURED_OUTPUT"], reason: asset.mediaType.toLowerCase() };
  if (asset.mediaType === "PDF") {
    const kind = inspection.pdfKind || "UNKNOWN";
    if (kind === "TEXT_NATIVE") return { strategy: "NATIVE_TEXT_FIRST", requiredCapabilities: ["LONG_DOCUMENT"], reason: "native_text_available" };
    if (kind === "HYBRID") return { strategy: "HYBRID_SELECTIVE_VISION", requiredCapabilities: ["LONG_DOCUMENT", "VISION", "STRUCTURED_OUTPUT"], reason: "hybrid_pdf" };
    return { strategy: "SELECTIVE_VISION", requiredCapabilities: ["VISION", "LONG_DOCUMENT", "STRUCTURED_OUTPUT"], reason: kind === "SCANNED" ? "scanned_pdf" : "pdf_visual_or_unknown" };
  }
  return { strategy: "FILE_EXTRACTION", requiredCapabilities: ["LONG_DOCUMENT"], reason: "document_file" };
}

module.exports = { selectMediaStrategy };
