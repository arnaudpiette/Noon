"use strict";

// Stockage interne robuste : migrations, sauvegardes, sommes de contrôle et journal rotatif.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const LEGACY_FILES = [
  "usage.json", "voice-usage.json", "web-search-usage.json",
  "conversation-memory.json", "conversation-index.json", "conversation-summaries.json", "local-permissions.json", "projects-registry.json", "project-journals.json", "creative-brief.json", "personal-brief.json", "long-term-memory.json", "planning-preferences.json", "daily-plans.json",
  "automations.json", "approval-audit.json",
];

function isValidJsonFile(filePath) {
  try { JSON.parse(fs.readFileSync(filePath, "utf8")); return true; }
  catch { return false; }
}

function migrateLegacyData(sourceDirectory, dataDirectory) {
  fs.mkdirSync(dataDirectory, { recursive: true });
  const backupDirectory = path.join(dataDirectory, "migration-backup");
  const migrated = [];
  const skipped = [];
  for (const fileName of LEGACY_FILES) {
    const source = path.join(sourceDirectory, fileName);
    const destination = path.join(dataDirectory, fileName);
    if (!fs.existsSync(source) || fs.existsSync(destination)) continue;
    if (!isValidJsonFile(source)) { skipped.push({ fileName, reason: "invalid-json" }); continue; }
    fs.mkdirSync(backupDirectory, { recursive: true });
    fs.copyFileSync(source, path.join(backupDirectory, fileName));
    fs.copyFileSync(source, destination);
    if (!isValidJsonFile(destination)) {
      fs.unlinkSync(destination);
      skipped.push({ fileName, reason: "copy-validation-failed" });
      continue;
    }
    migrated.push(fileName);
  }
  return { migrated, skipped, legacyFilesPreserved: true };
}

function createRotatingLogger(dataDirectory, options = {}) {
  const logsDirectory = path.join(dataDirectory, "logs");
  const maxBytes = options.maxBytes || 512 * 1024;
  const maxFiles = options.maxFiles || 5;
  fs.mkdirSync(logsDirectory, { recursive: true });
  const redact = (value) => String(value ?? "")
    .replace(/(?:sk-|Bearer\s+)[A-Za-z0-9._-]+/gi, "[SECRET]")
    .replace(/\/Users\/[^/\s]+/g, "/Users/[USER]")
    .slice(0, 1200);
  function rotate(filePath) {
    if (!fs.existsSync(filePath) || fs.statSync(filePath).size < maxBytes) return;
    for (let index = maxFiles - 1; index >= 1; index -= 1) {
      const source = `${filePath}.${index}`;
      const destination = `${filePath}.${index + 1}`;
      if (fs.existsSync(source)) fs.renameSync(source, destination);
    }
    fs.renameSync(filePath, `${filePath}.1`);
  }
  return (level, event, details = "") => {
    const allowed = new Set(["info", "warning", "error", "security", "audit"]);
    const safeLevel = allowed.has(level) ? level : "info";
    const filePath = path.join(logsDirectory, "noon.log");
    rotate(filePath);
    fs.appendFileSync(filePath, `${JSON.stringify({
      timestamp: new Date().toISOString(), level: safeLevel,
      event: redact(event), details: redact(details),
    })}\n`, { mode: 0o600 });
  };
}

function checksum(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function createBackup(dataDirectory, backupDirectory, fileNames = LEGACY_FILES) {
  fs.mkdirSync(backupDirectory, { recursive: true });
  const id = new Date().toISOString().replace(/[:.]/g, "-");
  const destination = path.join(backupDirectory, `noon-backup-${id}`);
  fs.mkdirSync(destination, { recursive: true });
  const files = [];
  for (const fileName of fileNames) {
    const source = path.join(dataDirectory, fileName);
    if (!fs.existsSync(source) || !isValidJsonFile(source)) continue;
    const target = path.join(destination, path.basename(fileName));
    fs.copyFileSync(source, target);
    files.push({ name: path.basename(fileName), sha256: checksum(target) });
  }
  const manifest = { version: 1, createdAt: new Date().toISOString(), files };
  fs.writeFileSync(path.join(destination, "manifest.json"), JSON.stringify(manifest, null, 2));
  return { path: destination, manifest };
}

function validateBackup(directory) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"), "utf8"));
    const valid = manifest.version === 1 && manifest.files.every((file) => {
      const target = path.join(directory, path.basename(file.name));
      return fs.existsSync(target) && checksum(target) === file.sha256;
    });
    return { valid, manifest };
  } catch (error) { return { valid: false, error: error.message }; }
}

module.exports = {
  LEGACY_FILES,
  createBackup,
  createRotatingLogger,
  isValidJsonFile,
  migrateLegacyData,
  validateBackup,
};
