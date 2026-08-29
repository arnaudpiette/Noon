"use strict";

const fs = require("fs");
const path = require("path");

function validateSeed(seed) {
  const errors = [];
  if (!seed || typeof seed !== "object" || Array.isArray(seed)) errors.push("Le document racine doit être un objet.");
  if (!Array.isArray(seed?.memories)) errors.push("Le tableau memories est obligatoire.");
  for (const [index, item] of (seed?.memories || []).entries()) {
    if (!item || typeof item !== "object") { errors.push(`memories[${index}] est invalide.`); continue; }
    if (typeof item.subjectId !== "string") errors.push(`memories[${index}].subjectId est obligatoire.`);
    if (typeof item.statement !== "string" || !item.statement.trim()) errors.push(`memories[${index}].statement est obligatoire.`);
    if (item.status === "confirmed" && ["high", "restricted"].includes(item.sensitivity)) errors.push(`memories[${index}] sensible ne peut pas être préconfirmé.`);
  }
  return { valid: errors.length === 0, errors };
}

function createPrivateSeedImporter(service) {
  function preview(seed) {
    const validation = validateSeed(seed); if (!validation.valid) return { ...validation, entries: [] };
    const existing = service.listMemories({ includeDeleted: true });
    const entries = seed.memories.map((item, index) => {
      const duplicate = existing.find((saved) => saved.subjectId === item.subjectId && saved.statement.toLocaleLowerCase("fr") === item.statement.trim().toLocaleLowerCase("fr"));
      const expired = item.expiresAt ? new Date(item.expiresAt) <= new Date() : false;
      const sensitive = ["high", "restricted"].includes(item.sensitivity) || ["health", "legal", "finance", "address", "school"].includes(item.category);
      return { index, subjectId: item.subjectId, category: item.category || "general", sensitivity: item.sensitivity || "medium", status: sensitive ? "pending_review" : (item.status || "pending_review"), duplicate: Boolean(duplicate), expired, statementPreview: item.statement.slice(0, 160) };
    });
    return { valid: true, errors: [], entries, count: entries.length, sensitiveCount: entries.filter((entry) => ["high", "restricted"].includes(entry.sensitivity)).length };
  }
  function importSelected(seed, selectedIndexes = []) {
    const report = preview(seed); if (!report.valid) throw new Error(report.errors.join(" "));
    const allowed = new Set(selectedIndexes.map(Number)); const imported = [], skipped = [];
    for (const entry of report.entries) {
      if (!allowed.has(entry.index) || entry.duplicate || entry.expired) { skipped.push(entry.index); continue; }
      const item = seed.memories[entry.index];
      imported.push(service.createMemory({ ...item, status: entry.status, consentStatus: entry.status === "confirmed" ? "granted" : "pending", sourceType: "private-seed-import", sourceReference: cleanSource(seed.source || "local-private-import") }));
    }
    return { importedIds: imported.map((item) => item.id), skipped, importedCount: imported.length };
  }
  return { preview, importSelected };
}

function cleanSource(value) { return path.basename(String(value || "private-import")).slice(0, 120); }
function readSeedFile(filePath) { return JSON.parse(fs.readFileSync(filePath, "utf8")); }

module.exports = { createPrivateSeedImporter, readSeedFile, validateSeed };
