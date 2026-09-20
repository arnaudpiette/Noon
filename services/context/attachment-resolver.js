"use strict";

const crypto = require("crypto");
const path = require("path");

const REFERENCE_PATTERNS = [
  /\b(?:ce|le|mon|cet)\s+(?:document|fichier|dossier|rapport|texte|contexte)\b/i,
  /\b(?:ces|les|mes)\s+(?:documents|fichiers|dossiers)\b/i,
  /\b(?:la|les)\s+pi[eè]ces?\s+jointes?\b/i,
  /\b(?:le\s+)?fichier\s+pr[eé]c[eé]dent\b/i,
  /\b(?:ce\s+)?document\s+pr[eé]c[eé]dent\b/i,
  /\b(?:ce|les?\s+fichiers?|les?\s+documents?)\s+que\s+je\s+viens\s+de\s+(?:t['’]envoyer|te\s+transmettre|partager)\b/i,
  /\bce\s+que\s+je\s+viens\s+de\s+te\s+transmettre\b/i,
  /\bce\s+que\s+je\s+viens\s+de\s+(?:te\s+donner|t['’]envoyer|partager)\b/i,
  /\btout\s+ce\s+qui\s+est\s+(?:important|utile|pertinent)\s+ici\b/i,
  /\bdans\s+ce\s+(?:dossier|document|fichier)\b/i,
  /\bde\s+ce\s+(?:dossier|document|fichier)\b/i,
];

function decodeBase64DataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) return null;
  try {
    return Buffer.from(match[2].replace(/\s/g, ""), "base64");
  } catch {
    return null;
  }
}

function decodePdfLiteral(value) {
  return String(value || "")
    .replace(/\\([nrtbf()\\])/g, (_match, code) => ({
      n: "\n", r: "\r", t: "\t", b: "\b", f: "\f",
      "(": "(", ")": ")", "\\": "\\",
    })[code])
    .replace(/\\([0-7]{1,3})/g, (_match, octal) => String.fromCharCode(parseInt(octal, 8)));
}

function extractPdfText(buffer, maxChars = 200_000) {
  try {
    const source = Buffer.from(buffer).toString("latin1");
    const values = [];
    for (const match of source.matchAll(/\(((?:\\.|[^\\()])*)\)\s*Tj\b/g)) {
      values.push(decodePdfLiteral(match[1]));
    }
    for (const match of source.matchAll(/\[((?:.|\n|\r)*?)\]\s*TJ\b/g)) {
      for (const literal of match[1].matchAll(/\(((?:\\.|[^\\()])*)\)/g)) {
        values.push(decodePdfLiteral(literal[1]));
      }
    }
    const extracted = values.join(" ").replace(/\s+/g, " ").trim();
    return extracted.slice(0, maxChars);
  } catch {
    return "";
  }
}

const zlib = require("zlib");

function extractDocxTextSync(buffer, maxChars = 200_000) {
  try {
    const marker = Buffer.from("word/document.xml");
    const index = buffer.indexOf(marker);
    if (index === -1) return "";
    // Find local header PK\x03\x04 before this filename
    let headerPos = -1;
    for (let i = Math.max(0, index - 40); i <= index; i++) {
      if (buffer[i] === 0x50 && buffer[i + 1] === 0x4b && buffer[i + 2] === 0x03 && buffer[i + 3] === 0x04) {
        headerPos = i;
        break;
      }
    }
    if (headerPos === -1) return "";
    const fnLen = buffer.readUInt16LE(headerPos + 26);
    const extraLen = buffer.readUInt16LE(headerPos + 28);
    const dataStart = headerPos + 30 + fnLen + extraLen;
    const compressed = buffer.subarray(dataStart);
    const inflated = zlib.inflateRawSync(compressed).toString("utf8");
    return inflated
      .replace(/<w:p\b[^>]*>/g, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, "\"")
      .replace(/&apos;/g, "'")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maxChars);
  } catch {
    // Fallback: simple text cleanup
    return buffer.toString("latin1").replace(/<[^>]+>/g, " ").replace(/[^\x20-\x7E\n\r\t\u00A0-\u024F]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxChars);
  }
}

function extractTextFromAttachmentSync(attachment) {
  if (!attachment || typeof attachment !== "object") return "";
  if (attachment.extractedText) return String(attachment.extractedText);
  if (attachment.kind === "text" && typeof attachment.content === "string") {
    return attachment.content;
  }
  if (attachment.dataUrl) {
    const buffer = decodeBase64DataUrl(attachment.dataUrl);
    if (!buffer) return "";
    if (attachment.kind === "pdf" || /\.pdf$/i.test(attachment.name || "")) {
      return extractPdfText(buffer);
    }
    if (attachment.kind === "document" || /\.(?:docx|doc)$/i.test(attachment.name || "")) {
      if (buffer.subarray(0, 2).toString() === "PK") {
        return extractDocxTextSync(buffer);
      }
      return buffer.toString("utf8").replace(/[^\x20-\x7E\n\r\t\u00A0-\u024F]/g, " ").trim();
    }
    if (attachment.kind === "spreadsheet" || /\.(?:csv|tsv)$/i.test(attachment.name || "")) {
      return buffer.toString("utf8");
    }
  }
  return "";
}

function extractTextFromAttachment(attachment) { return extractTextFromAttachmentSync(attachment); }

function createAttachmentResolver({ maxPerConversation = 10 } = {}) {
  // Map<conversationKey, Array<ConversationAttachment>>
  const store = new Map();

  function conversationKeyFor({ conversationId, sessionId }) {
    return String(conversationId || sessionId || "noon-local");
  }

  function registerAttachment({ conversationId, sessionId, attachment, batchId = null }) {
    if (!attachment || typeof attachment !== "object") return null;
    const key = conversationKeyFor({ conversationId, sessionId });
    const list = store.get(key) || [];
    const filename = path.basename(String(attachment.name || "document.txt")).slice(0, 200);
    const id = attachment.id || `att-${crypto.randomUUID()}`;
    const extractedText = extractTextFromAttachmentSync(attachment);

    const record = {
      id,
      conversationId: key,
      filename,
      kind: attachment.kind || "text",
      mimeType: attachment.mimeType || null,
      content: attachment.content || null,
      dataUrl: attachment.dataUrl || null,
      extractedText,
      batchId,
      createdAt: new Date().toISOString(),
    };

    // Replace if exact duplicate filename already in list
    const existingIndex = list.findIndex((item) => item.filename === filename);
    if (existingIndex >= 0) {
      list[existingIndex] = record;
    } else {
      list.push(record);
      if (list.length > maxPerConversation) list.shift();
    }
    store.set(key, list);
    return record;
  }

  function registerAttachments({ conversationId, sessionId, attachments = [] }) {
    const registered = [];
    const batchId = `batch-${crypto.randomUUID()}`;
    for (const attachment of attachments) {
      const rec = registerAttachment({ conversationId, sessionId, attachment, batchId });
      if (rec) registered.push(rec);
    }
    return registered;
  }

  function listAttachments({ conversationId, sessionId }) {
    const key = conversationKeyFor({ conversationId, sessionId });
    return [...(store.get(key) || [])];
  }

  function hasAttachmentReference(text) {
    const normalized = String(text || "").trim();
    return REFERENCE_PATTERNS.some((pattern) => pattern.test(normalized));
  }

  function resolveAttachmentReference(text, { conversationId, sessionId, currentAttachments = [] } = {}) {
    // 1. Si des attachments sont fournis dans le tour courant, les privilégier
    if (Array.isArray(currentAttachments) && currentAttachments.length > 0) {
      const matchByName = currentAttachments.find((att) => {
        const name = String(att?.name || "").toLowerCase();
        return name && String(text || "").toLowerCase().includes(name);
      });
      if (matchByName) return matchByName;
      return currentAttachments[currentAttachments.length - 1];
    }

    // 2. Chercher dans l'historique des attachments de cette conversation
    const history = listAttachments({ conversationId, sessionId });
    if (!history.length) return null;

    // A. Recherche par nom exact ou partiel présent dans la requête
    const queryLower = String(text || "").toLowerCase();
    for (let i = history.length - 1; i >= 0; i--) {
      const att = history[i];
      const filenameLower = att.filename.toLowerCase();
      const baseName = filenameLower.replace(/\.[^.]+$/, "");
      if (queryLower.includes(filenameLower) || (baseName.length > 3 && queryLower.includes(baseName))) {
        return att;
      }
    }

    // B. Si la requête contient une référence anaphorique ("ce document", "ce dossier", "le fichier précédent")
    if (hasAttachmentReference(text)) {
      if (/\b(?:fichier|document)\s+pr[eé]c[eé]dent\b/i.test(text) && history.length > 1) {
        return history[history.length - 2];
      }
      return history[history.length - 1];
    }

    return null;
  }

  function resolveAttachmentReferences(text, context = {}) {
    const plural = /\b(?:dossier|documents|fichiers|pi[eè]ces?\s+jointes?)\b/i.test(String(text || ""));
    if (Array.isArray(context.currentAttachments) && context.currentAttachments.length) {
      if (plural) return [...context.currentAttachments];
      const current = resolveAttachmentReference(text, context);
      return current ? [current] : [];
    }
    const history = listAttachments(context);
    if (!history.length) return [];
    if (plural) {
      const latestBatchId = history[history.length - 1].batchId;
      return latestBatchId ? history.filter((item) => item.batchId === latestBatchId) : [history[history.length - 1]];
    }
    const resolved = resolveAttachmentReference(text, context);
    return resolved ? [resolved] : [];
  }

  function clear(conversationId) {
    if (conversationId) store.delete(String(conversationId));
    else store.clear();
  }

  return {
    clear,
    extractTextFromAttachment,
    hasAttachmentReference,
    listAttachments,
    registerAttachment,
    registerAttachments,
    resolveAttachmentReference,
    resolveAttachmentReferences,
  };
}

module.exports = {
  createAttachmentResolver,
  extractDocxText: extractDocxTextSync,
  extractPdfText,
  extractTextFromAttachment,
};
