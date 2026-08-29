"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function stableId(prefix, value) {
  return `${prefix}-${crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 24)}`;
}
function readJson(filePath) { return JSON.parse(fs.readFileSync(filePath, "utf8")); }
function backupSource(filePath, backupDirectory) {
  if (!fs.existsSync(filePath)) return null;
  fs.mkdirSync(backupDirectory, { recursive: true });
  const destination = path.join(backupDirectory, path.basename(filePath));
  if (!fs.existsSync(destination)) fs.copyFileSync(filePath, destination);
  return destination;
}

function migrateLegacyPersonalData({ repository, dataDirectory, logger = null }) {
  const migrationId = "legacy-personal-data-v1";
  if (repository.hasMigration(migrationId)) return { migrated: false, reason: "already-applied" };
  const memoryFile = path.join(dataDirectory, "long-term-memory.json");
  const projectsFile = path.join(dataDirectory, "project-journals.json");
  const backupDirectory = path.join(dataDirectory, "migration-backup", migrationId);
  const result = { migrated: true, memories: 0, projects: 0, backups: [] };
  try {
    for (const filePath of [memoryFile, projectsFile]) {
      const backup = backupSource(filePath, backupDirectory); if (backup) result.backups.push(backup);
    }
    repository.transaction(() => {
      if (fs.existsSync(memoryFile)) {
        const state = readJson(memoryFile);
        for (const memory of Array.isArray(state.memories) ? state.memories : []) {
          repository.upsertMemory({
            id: stableId("legacy-memory", memory.id || memory.text), type: "temporary_information",
            subject: "Mémoire importée", value: { text: String(memory.text || "").slice(0, 1000), tags: memory.tags || [] },
            sourceType: "legacy-long-term-memory", sourceReference: memory.id || null,
            status: "confirmed", confidence: 1, lastConfirmedAt: memory.updatedAt || memory.createdAt || null,
            metadata: { migratedFrom: "long-term-memory.json" },
          });
          result.memories += 1;
        }
      }
      if (fs.existsSync(projectsFile)) {
        const state = readJson(projectsFile);
        for (const [id, project] of Object.entries(state.projects || {})) {
          repository.upsertProject({
            id: stableId("legacy-project", id), name: project.projectName || id,
            objective: project.objective || "", currentState: project.lastSessionSummary || "",
            status: ({ "Non commencé": "todo", "En cours": "in_progress", "Bloqué": "blocked", "À vérifier": "waiting", "Terminé": "completed", "Archivé": "archived" })[project.currentStatus] || "todo",
            nextAction: project.nextActions?.[0] || null, decisions: project.decisions || [], blockers: project.blockers || [],
            importantFiles: project.importantFiles || [], githubUrl: project.links?.github || null,
            figmaUrl: project.links?.figma || null, lastActivityAt: project.lastSessionAt || project.updatedAt || null,
            sourceReference: id,
          });
          result.projects += 1;
        }
      }
      repository.markMigration(migrationId, result);
    });
    return result;
  } catch (error) {
    logger?.("error", "personal-data-migration-failed", error.code || error.name || "ERROR");
    return { migrated: false, reason: "failed", error: String(error.message || error).slice(0, 180), backups: result.backups };
  }
}

module.exports = { backupSource, migrateLegacyPersonalData, stableId };
