"use strict";

const path = require("path");

function httpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function readBody(req, maxBytes, parser) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    req.on("data", (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes <= maxBytes) chunks.push(chunk);
    });
    req.on("end", () => {
      if (totalBytes > maxBytes) return reject(httpError("La requête dépasse la taille autorisée.", 413));
      try { resolve(parser(Buffer.concat(chunks))); }
      catch { reject(httpError("Le contenu JSON est invalide.", 400)); }
    });
    req.on("error", reject);
  });
}

function readJsonBody(req, maxBytes = 8 * 1024 * 1024) {
  return readBody(req, maxBytes, (buffer) => JSON.parse(buffer.toString("utf8") || "{}"));
}

function readTextBody(req, maxBytes = 128 * 1024) {
  return readBody(req, maxBytes, (buffer) => buffer.toString("utf8"));
}

const BINARY_TYPES = Object.freeze({
  spreadsheet: {
    extensions: { ".csv": "text/csv", ".tsv": "text/tsv", ".xls": "application/vnd.ms-excel",
      ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
    maxDataUrlBytes: 5 * 1024 * 1024, invalid: "Le format du tableur est invalide.", tooLarge: "Le tableur est trop volumineux.",
  },
  document: {
    extensions: { ".doc": "application/msword", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ".odt": "application/vnd.oasis.opendocument.text", ".rtf": "application/rtf", ".ppt": "application/vnd.ms-powerpoint",
      ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
    maxDataUrlBytes: 5 * 1024 * 1024, invalid: "Le format du document est invalide.", tooLarge: "Le document dépasse la taille autorisée.",
  },
});

function validateBinary(raw, fileName, extension, kind) {
  const rule = BINARY_TYPES[kind];
  const expectedMimeType = rule.extensions[extension];
  const dataUrl = String(raw.dataUrl || "");
  if (!expectedMimeType || raw.mimeType !== expectedMimeType || !dataUrl.startsWith(`data:${expectedMimeType};base64,`)) {
    throw httpError(rule.invalid, 400);
  }
  if (dataUrl.length > rule.maxDataUrlBytes) throw httpError(rule.tooLarge, 413);
  return { kind, name: fileName, mimeType: expectedMimeType, dataUrl };
}

function validateAttachment(raw) {
  if (!raw || typeof raw !== "object") throw httpError("Pièce jointe invalide.", 400);
  const fileName = String(raw.name || "").slice(0, 150);
  const extension = path.extname(fileName).toLowerCase();
  if (BINARY_TYPES[raw.kind]) return validateBinary(raw, fileName, extension, raw.kind);
  const privacy = { localOnly: raw.localOnly === true, sourceScope: raw.sourceScope === "PUBLIC" ? "PUBLIC" : "PERSONAL" };
  if (raw.kind === "pdf") {
    const dataUrl = String(raw.dataUrl || "");
    if (raw.mimeType !== "application/pdf" || !dataUrl.startsWith("data:application/pdf;base64,")) throw httpError("Le format du PDF est invalide.", 400);
    if (dataUrl.length > 5 * 1024 * 1024) throw httpError("Le PDF dépasse la taille autorisée.", 413);
    return { kind: "pdf", name: fileName, mimeType: "application/pdf", dataUrl, ...privacy };
  }
  if (raw.kind === "image") {
    const mimeType = raw.mimeType;
    const dataUrl = String(raw.dataUrl || "");
    if (!["image/png", "image/jpeg", "image/webp"].includes(mimeType) || !dataUrl.startsWith(`data:${mimeType};base64,`)) throw httpError("Le format de l’image est invalide.", 400);
    if (dataUrl.length > 3 * 1024 * 1024) throw httpError("L’image dépasse la taille autorisée.", 413);
    return { kind: "image", name: fileName, mimeType, dataUrl, ...privacy };
  }
  if (raw.kind === "audio") {
    const mimeType = String(raw.mimeType || "").toLowerCase();
    const dataUrl = String(raw.dataUrl || "");
    if (!["audio/webm", "audio/wav", "audio/mpeg", "audio/mp4"].includes(mimeType) || !dataUrl.startsWith(`data:${mimeType};base64,`)) throw httpError("Le format audio est invalide.", 400);
    if (dataUrl.length > 14 * 1024 * 1024) throw httpError("Le fichier audio dépasse la taille autorisée.", 413);
    return { kind: "audio", name: fileName, mimeType, dataUrl, ...privacy };
  }
  if (raw.kind === "text") {
    if (typeof raw.content !== "string" || Buffer.byteLength(raw.content, "utf8") > 1024 * 1024) throw httpError("Le fichier texte est invalide ou trop volumineux.", 413);
    return { kind: "text", name: fileName, content: raw.content };
  }
  throw httpError("Type de pièce jointe non accepté.", 400);
}

function getErrorHeader(error, headerName) {
  const headers = error?.headers;
  if (!headers) return null;
  if (typeof headers.get === "function") return headers.get(headerName);
  return headers[headerName] || headers[headerName.toLowerCase()] || null;
}

module.exports = { getErrorHeader, readJsonBody, readTextBody, validateAttachment };
