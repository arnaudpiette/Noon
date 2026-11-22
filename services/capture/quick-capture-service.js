"use strict";

// V3-L2a — capture rapide « Noon, note ça » : enregistrement local et immédiat dans la boîte
// de réception (sourceType manual_capture), sans appel au modèle. Le tri se fait plus tard
// (Brief, boîte de réception). Texte borné ; aucune donnée envoyée hors du Mac.
const crypto = require("node:crypto");

const SOURCE_TYPE = "manual_capture";
const MAX_TEXT = 2000;
const ORIGINS = Object.freeze(["shortcut", "chat", "voice", "tray"]);

function captureError(code, message) { return Object.assign(new Error(message), { code, statusCode: 400 }); }

function createQuickCaptureService({ inboxService, now = () => new Date() } = {}) {
  if (!inboxService?.ingest || !inboxService?.list) throw new TypeError("inboxService requis.");

  function capture({ text, origin = "shortcut" } = {}) {
    const clean = String(text ?? "").replace(/\s+/g, " ").trim();
    if (!clean) throw captureError("CAPTURE_EMPTY", "Rien à noter.");
    if (clean.length > MAX_TEXT) throw captureError("CAPTURE_TOO_LONG", `Note trop longue (${MAX_TEXT} caractères au maximum).`);
    if (!ORIGINS.includes(origin)) throw captureError("CAPTURE_ORIGIN_INVALID", "Origine de capture invalide.");
    const [item] = inboxService.ingest(SOURCE_TYPE, [{
      id: `capture-${crypto.randomUUID()}`,
      title: clean.slice(0, 300),
      action: clean.slice(0, 800),
      requiredContext: `Capturé via ${origin} le ${now().toISOString()}`,
      importance: 0.5,
      status: "detected",
    }]);
    return { id: item.id, text: clean, origin, capturedAt: now().toISOString() };
  }

  function recent(limit = 10) {
    const bounded = Math.max(1, Math.min(50, Number(limit) || 10));
    return inboxService.list({})
      .filter((item) => item.sourceType === SOURCE_TYPE)
      .sort((a, b) => String(b.detectedAt || "").localeCompare(String(a.detectedAt || "")))
      .slice(0, bounded)
      .map((item) => ({ id: item.id, text: item.action || item.title, status: item.status, createdAt: item.detectedAt || null }));
  }

  return Object.freeze({ capture, recent });
}

module.exports = { MAX_TEXT, ORIGINS, SOURCE_TYPE, createQuickCaptureService };
