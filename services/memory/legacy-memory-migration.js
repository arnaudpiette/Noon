"use strict";

// Migration one-shot, prudente et réversible vers la mémoire privée.
// Les rapports ne contiennent jamais les phrases migrées : uniquement des
// compteurs, empreintes, codes d'erreur et identifiants techniques.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const BASE_SUBJECTS = new Set(["arnaud", "alexandra", "sinan", "kaan", "household", "noon", "projects"]);
const SECRET_PATTERN = /(?:sk-[A-Za-z0-9_-]{12,}|api[_ -]?key|password|mot de passe|BEGIN (?:RSA |EC )?PRIVATE KEY|bearer\s+[A-Za-z0-9._-]+)/i;
const PROTECTED = new Set(["health", "legal", "finance", "address", "school", "identity"]);
const STATUS_MAP = Object.freeze({
  confirmed: "confirmed", inferred: "candidate", temporary: "pending_review",
  rejected: "historical", expired: "historical", blocked: "historical",
});

function hash(value) { return crypto.createHash("sha256").update(Buffer.isBuffer(value) ? value : String(value)).digest("hex"); }
function normalize(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ").trim().toLocaleLowerCase("fr");
}
function sourceHash(type, id) { return hash(`${type}:${id}`); }
function fingerprint(item) { return hash(`${item.subjectId}\0${item.category}\0${normalize(item.statement)}`); }
function safeJson(filePath, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return fallback; }
}
function statementFrom(value) {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return "";
  for (const key of ["statement", "text", "preference", "rule", "objective", "decision", "feedback", "value"]) {
    if (typeof value[key] === "string" && value[key].trim()) return value[key].trim();
  }
  return "";
}
function categoryFor(item) {
  const explicit = String(item.metadata?.category || "").trim().toLowerCase();
  if (explicit) return explicit.slice(0, 80);
  return ({ work_preference: "preference", permanent_constraint: "rule", identity_role: "identity",
    deadline: "commitment", temporary_information: "general", professional_relationship: "relationship" })[item.type] || String(item.type || "general").slice(0, 80);
}
function subjectFor(item) {
  const explicit = String(item.metadata?.profileId || "").trim().toLowerCase();
  if (BASE_SUBJECTS.has(explicit) || explicit.startsWith("project:")) return explicit;
  const projectId = String(item.metadata?.projectId || "").trim();
  if (projectId) return `project:${projectId.slice(0, 80)}`;
  // Les anciens souvenirs appartenaient au propriétaire. Aucune personne
  // tierce n'est déduite à partir du texte ou du libellé.
  return "arnaud";
}
function canonicalStructured(item, hardRulesRegistry) {
  if (hardRulesRegistry?.matchesLegacyMemory(item)) return { disposition: "legacy_rule_duplicate" };
  if (item.type === "active_project") return { disposition: "project_store_preserved" };
  const statement = statementFrom(item.value);
  if (!statement) return { disposition: "quarantined", errorCode: "NO_CANONICAL_STATEMENT" };
  if (SECRET_PATTERN.test(statement)) return { disposition: "quarantined", errorCode: "POTENTIAL_SECRET" };
  const subjectId = subjectFor(item);
  const category = categoryFor(item);
  const protectedData = PROTECTED.has(category) || ["alexandra", "sinan", "kaan", "household"].includes(subjectId);
  const explicitlyConfirmed = item.status === "confirmed" && item.useAllowed !== false;
  return {
    item: {
      subjectId, category, statement: statement.slice(0, 12000),
      sensitivity: protectedData ? "high" : item.sensitivity === "restricted" ? "restricted" : "medium",
      status: protectedData ? "pending_review" : STATUS_MAP[item.status] || "pending_review",
      confidence: Number.isFinite(Number(item.confidence)) ? Number(item.confidence) : 0.5,
      sourceType: "migration:structured-memory",
      sourceReference: `structured:${sourceHash("structured", item.id).slice(0, 20)}`,
      observedAt: item.lastConfirmedAt || item.updatedAt || item.createdAt,
      expiresAt: item.expiresAt || null,
      apiPolicy: protectedData ? "confirm_each_use" : item.metadata?.apiPolicy === "allowed" && explicitlyConfirmed ? "contextual" : "local_only",
      consentRequired: protectedData || item.metadata?.consentRequired === true,
      consentStatus: protectedData ? "pending" : item.metadata?.consentStatus === "granted" ? "granted" : "pending",
      tags: ["migrated", `legacy:${item.type}`],
      payload: { legacyStatus: item.status, migrationReview: !explicitlyConfirmed },
    },
  };
}
function canonicalLegacy(item) {
  const statement = String(item.text || "").trim();
  if (!statement) return { disposition: "quarantined", errorCode: "EMPTY_LEGACY_MEMORY" };
  if (SECRET_PATTERN.test(statement)) return { disposition: "quarantined", errorCode: "POTENTIAL_SECRET" };
  return { item: { subjectId: "arnaud", category: "general", statement: statement.slice(0, 12000),
    sensitivity: "medium", status: "pending_review", confidence: 0.5,
    sourceType: "migration:long-term-json", sourceReference: `legacy:${sourceHash("legacy", item.id).slice(0, 20)}`,
    observedAt: item.updatedAt || item.createdAt, apiPolicy: "local_only", consentRequired: false,
    consentStatus: "pending", tags: ["migrated", "legacy-json", ...(item.tags || []).slice(0, 8)],
    payload: { migrationReview: true } } };
}
function emptyReport(id) {
  return { migrationId: id, discovered: 0, eligible: 0, migrated: 0, duplicates: 0,
    unchanged: 0, quarantined: 0, skippedRules: 0, preservedProjects: 0, failed: 0,
    bySource: {}, byProfile: {}, errorCodes: {}, legacyMarked: false };
}
function increment(report, key, nested = null) {
  if (nested) report[key][nested] = (report[key][nested] || 0) + 1;
  else report[key] = (report[key] || 0) + 1;
}

function createLegacyMemoryMigration({ dataDirectory, privateMemoryService, structuredRepository,
  legacyStore, hardRulesRegistry = null, observability = null, batchSize = 100 } = {}) {
  if (!privateMemoryService?.available) throw new Error("La mémoire privée chiffrée est indisponible.");
  const legacyPath = path.join(dataDirectory, "long-term-memory.json");
  const databasePath = path.join(dataDirectory, "personal-intelligence.sqlite");

  function sources() {
    const legacy = legacyStore?.load?.().memories || safeJson(legacyPath, { memories: [] }).memories || [];
    const structured = structuredRepository?.listMemories?.({ limit: 500 }) || [];
    return [
      ...legacy.map((item) => ({ sourceType: "legacy_json", sourceId: item.id || hash(item.text), raw: item, mapped: canonicalLegacy(item) })),
      ...structured.map((item) => ({ sourceType: "structured_sqlite", sourceId: item.id, raw: item, mapped: canonicalStructured(item, hardRulesRegistry) })),
    ];
  }
  function createBackup(migrationId) {
    const directory = path.join(dataDirectory, "memory-migration-backup", migrationId);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const manifest = { migrationId, createdAt: new Date().toISOString(), files: [] };
    for (const source of [legacyPath, databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
      if (!fs.existsSync(source)) continue;
      const destination = path.join(directory, path.basename(source));
      fs.copyFileSync(source, destination);
      fs.chmodSync(destination, 0o600);
      manifest.files.push({ name: path.basename(source), bytes: fs.statSync(source).size,
        sha256: hash(fs.readFileSync(source)) });
    }
    fs.writeFileSync(path.join(directory, "manifest.json"), JSON.stringify(manifest, null, 2), { mode: 0o600 });
    return { directory, fileCount: manifest.files.length };
  }
  function dryRun(migrationId = `memory-v1-${Date.now()}`) {
    const report = emptyReport(migrationId);
    for (const source of sources()) {
      increment(report, "discovered"); increment(report, "bySource", source.sourceType);
      const existing = privateMemoryService.migrationRecord(source.sourceType, sourceHash(source.sourceType, source.sourceId));
      if (existing) { increment(report, "unchanged"); continue; }
      if (!source.mapped.item) {
        if (source.mapped.disposition === "legacy_rule_duplicate") increment(report, "skippedRules");
        else if (source.mapped.disposition === "project_store_preserved") increment(report, "preservedProjects");
        else { increment(report, "quarantined"); increment(report, "errorCodes", source.mapped.errorCode || "AMBIGUOUS"); }
        continue;
      }
      increment(report, "eligible"); increment(report, "byProfile", source.mapped.item.subjectId);
      const fp = fingerprint(source.mapped.item);
      const duplicate = privateMemoryService.listMemories({ subjectId: source.mapped.item.subjectId, includeDeleted: false })
        .some((entry) => fingerprint(entry) === fp);
      if (duplicate) increment(report, "duplicates");
    }
    return report;
  }
  function migrate({ migrationId = `memory-v1-${Date.now()}`, backup = null } = {}) {
    const started = Date.now(); const report = emptyReport(migrationId);
    privateMemoryService.beginMigration({ id: migrationId, backupPath: backup?.directory || null, report });
    const entries = sources();
    for (let offset = 0; offset < entries.length; offset += Math.max(1, batchSize)) {
      for (const source of entries.slice(offset, offset + batchSize)) {
        increment(report, "discovered"); increment(report, "bySource", source.sourceType);
        const idHash = sourceHash(source.sourceType, source.sourceId);
        if (privateMemoryService.migrationRecord(source.sourceType, idHash)) { increment(report, "unchanged"); continue; }
        const mapped = source.mapped;
        if (!mapped.item) {
          const disposition = mapped.disposition || "quarantined";
          if (disposition === "legacy_rule_duplicate") increment(report, "skippedRules");
          else if (disposition === "project_store_preserved") increment(report, "preservedProjects");
          else { increment(report, "quarantined"); increment(report, "errorCodes", mapped.errorCode || "AMBIGUOUS"); }
          privateMemoryService.recordMigration({ migrationId, sourceType: source.sourceType, sourceIdHash: idHash,
            fingerprint: hash(`${source.sourceType}:${idHash}`), disposition, errorCode: mapped.errorCode });
          continue;
        }
        increment(report, "eligible"); increment(report, "byProfile", mapped.item.subjectId);
        const fp = fingerprint(mapped.item);
        try {
          const created = privateMemoryService.createMemory(mapped.item);
          const disposition = created.duplicate ? "duplicate" : "migrated";
          increment(report, created.duplicate ? "duplicates" : "migrated");
          privateMemoryService.recordMigration({ migrationId, sourceType: source.sourceType,
            sourceIdHash: idHash, fingerprint: fp, targetId: created.id, disposition });
        } catch (error) {
          const code = String(error.code || error.name || "MIGRATION_ERROR").slice(0, 80);
          increment(report, "failed"); increment(report, "errorCodes", code);
          privateMemoryService.recordMigration({ migrationId, sourceType: source.sourceType,
            sourceIdHash: idHash, fingerprint: fp, disposition: "failed", errorCode: code });
        }
      }
    }
    report.legacyMarked = true;
    report.durationMs = Date.now() - started;
    privateMemoryService.completeMigration(migrationId, report.failed ? "completed_with_errors" : "completed", report);
    observability?.recordMigration?.({ ...report });
    return report;
  }
  function compare(queries = ["préférences", "projet", "objectif", "contrainte"]) {
    return queries.map((query) => {
      const legacyCount = (legacyStore?.relevant?.(query, 20) || []).length;
      const canonicalCount = privateMemoryService.listMemories({ query, includeDeleted: false }).length;
      return { queryHash: hash(query).slice(0, 12), legacyCount, canonicalCount,
        difference: canonicalCount - legacyCount };
    });
  }
  return { createBackup, dryRun, migrate, compare,
    rollback: (migrationId) => privateMemoryService.rollbackMigration(migrationId) };
}

module.exports = { canonicalLegacy, canonicalStructured, createLegacyMemoryMigration,
  fingerprint, normalize, sourceHash, statementFrom };
