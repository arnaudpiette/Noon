"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");
const { clean } = require("./media-schema");

const SIGNATURES = Object.freeze({
  "image/png": (buffer) => buffer.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")),
  "image/jpeg": (buffer) => buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
  "image/webp": (buffer) => buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP",
  "application/pdf": (buffer) => buffer.subarray(0, 5).toString("ascii") === "%PDF-",
  "audio/wav": (buffer) => buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WAVE",
  "audio/mpeg": (buffer) => buffer.subarray(0, 3).toString("ascii") === "ID3" || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0),
  "audio/mp4": (buffer) => buffer.subarray(4, 8).toString("ascii") === "ftyp",
  "audio/webm": (buffer) => buffer.subarray(0, 4).equals(Buffer.from("1a45dfa3", "hex")),
  "video/mp4": (buffer) => buffer.subarray(4, 8).toString("ascii") === "ftyp",
});

class MediaError extends Error {
  constructor(code, message, statusCode = 400) { super(message); this.name = "MediaError"; this.code = code; this.statusCode = statusCode; }
}

function decodeDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) throw new MediaError("MEDIA_INVALID_DATA", "Le contenu du média est invalide.");
  let buffer;
  try { buffer = Buffer.from(match[2].replace(/\s/g, ""), "base64"); } catch { throw new MediaError("MEDIA_INVALID_DATA", "Le média ne peut pas être décodé."); }
  if (!buffer.length) throw new MediaError("MEDIA_INVALID_DATA", "Le média est vide.");
  return { declaredMimeType: match[1].toLowerCase(), buffer };
}

function detectMediaType(mimeType, filename, sourceType) {
  if (mimeType.startsWith("image/")) return sourceType === "SCREEN_CAPTURE" || /capture|screenshot/i.test(filename || "") ? "SCREENSHOT" : "IMAGE";
  if (mimeType === "application/pdf") return "PDF";
  if (mimeType.startsWith("audio/")) return "AUDIO";
  if (mimeType.startsWith("video/")) return "VIDEO";
  return "DOCUMENT_VISUAL";
}

async function sanitizeImageDataUrlForRemote(dataUrl) {
  const { declaredMimeType, buffer } = decodeDataUrl(dataUrl);
  if (!declaredMimeType.startsWith("image/")) return dataUrl;
  // Sharp supprime les métadonnées par défaut. rotate() applique localement
  // l’orientation EXIF avant que l’EXIF/GPS soit retiré du flux distant.
  const sanitized = await sharp(buffer).rotate().toBuffer();
  return `data:${declaredMimeType};base64,${sanitized.toString("base64")}`;
}

function createMediaIntakeService({ allowedRoots = () => [], maxBytes = 12 * 1024 * 1024, now = () => Date.now() } = {}) {
  const fingerprintMemo = new Map();
  function bufferFromSource(source) {
    if (source.buffer) return { buffer: Buffer.from(source.buffer), declaredMimeType: String(source.mimeType || "application/octet-stream").toLowerCase(), sourceRef: null };
    if (source.dataUrl) return { ...decodeDataUrl(source.dataUrl), sourceRef: null };
    if (!source.path) throw new MediaError("MEDIA_SOURCE_MISSING", "Aucune source média n’a été fournie.");
    const resolved = path.resolve(String(source.path));
    let realPath;
    try { realPath = fs.realpathSync(resolved); } catch { throw new MediaError("MEDIA_SOURCE_UNAVAILABLE", "Le fichier média est introuvable.", 404); }
    const roots = allowedRoots().map((root) => { try { return fs.realpathSync(root); } catch { return path.resolve(root); } });
    if (!roots.some((root) => realPath === root || realPath.startsWith(`${root}${path.sep}`))) throw new MediaError("MEDIA_ROOT_NOT_ALLOWED", "Ce fichier est hors des dossiers autorisés.", 403);
    const stat = fs.statSync(realPath);
    if (!stat.isFile()) throw new MediaError("MEDIA_SOURCE_INVALID", "La source média n’est pas un fichier.");
    const memoKey = `${realPath}:${stat.size}:${stat.mtimeMs}`;
    const buffer = fs.readFileSync(realPath);
    return { buffer, declaredMimeType: String(source.mimeType || "application/octet-stream").toLowerCase(), sourceRef: { kind: "local", fingerprintKey: memoKey }, memoKey };
  }
  async function ingest(input = {}) {
    const started = now(); const source = input.source || {};
    const { buffer, declaredMimeType, sourceRef, memoKey } = bufferFromSource(source);
    if (buffer.length > maxBytes) throw new MediaError("MEDIA_TOO_LARGE", "Le média dépasse la taille autorisée.", 413);
    const signature = SIGNATURES[declaredMimeType];
    if (!signature || !signature(buffer)) throw new MediaError("MEDIA_SIGNATURE_MISMATCH", "Le contenu du fichier ne correspond pas à son type déclaré.");
    const fingerprint = memoKey && fingerprintMemo.get(memoKey) || crypto.createHash("sha256").update(buffer).digest("hex");
    if (memoKey) fingerprintMemo.set(memoKey, fingerprint);
    const filename = clean(source.filename || source.name || (source.path ? path.basename(source.path) : "media"), 150) || "media";
    const sourceType = ["USER_UPLOAD", "LOCAL_FILE", "ARTIFACT", "SCREEN_CAPTURE", "CONNECTOR_FILE", "PUBLIC_WEB", "GENERATED"].includes(input.sourceType) ? input.sourceType : source.path ? "LOCAL_FILE" : "USER_UPLOAD";
    const createdAt = new Date(now()).toISOString();
    return {
      asset: {
        assetId: `media-${fingerprint.slice(0, 24)}`, sourceType,
        sourceScope: input.sourceScope === "PUBLIC" ? "PUBLIC" : "PERSONAL",
        mediaType: detectMediaType(declaredMimeType, filename, sourceType), mimeType: declaredMimeType,
        filename, sizeBytes: buffer.length, fingerprint, sourceRef,
        workspaceId: clean(input.workspaceId, 160), conversationId: clean(input.conversationId, 160),
        createdAt, importedAt: createdAt, sensitivity: input.sensitivity || "medium",
        localOnly: input.localOnly === true, processingState: "REGISTERED",
        metadata: { dimensions: null, orientation: null, pageCount: null, durationMs: null },
      },
      payload: { buffer, dataUrl: `data:${declaredMimeType};base64,${buffer.toString("base64")}` },
      metrics: { inspectionMs: Math.max(0, now() - started), sizeBytes: buffer.length },
    };
  }
  return { ingest };
}

module.exports = {
  MediaError, SIGNATURES, createMediaIntakeService, decodeDataUrl,
  detectMediaType, sanitizeImageDataUrlForRemote,
};
