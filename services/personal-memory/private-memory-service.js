"use strict";

const { negationChanged, tokenSimilarity } = require("./document-memory-importer");

const crypto = require("crypto");
const { createHardRulesRegistry } = require("../rules/hard-rules-registry");

const SUBJECTS = new Set(["arnaud", "alexandra", "sinan", "kaan", "household", "noon", "projects"]);
const SENSITIVITIES = new Set(["low", "medium", "high", "restricted"]);
const STATUSES = new Set(["candidate", "pending_review", "confirmed", "historical", "superseded", "deleted"]);
const API_POLICIES = new Set(["allowed", "contextual", "confirm_each_use", "local_only"]);
const PROTECTED_CATEGORIES = new Set(["health", "legal", "finance", "address", "school", "identity"]);
const CHILDREN = new Set(["sinan", "kaan"]);

const DEFAULT_PROFILES = [
  ["arnaud", "Arnaud", false, "contextual"], ["alexandra", "Alexandra", false, "confirm_each_use"],
  ["sinan", "Sinan", true, "confirm_each_use"], ["kaan", "Kaan", true, "confirm_each_use"],
  ["household", "Foyer", false, "confirm_each_use"], ["noon", "Noon", false, "allowed"],
  ["projects", "Projets", false, "contextual"],
];

// Représentation legacy conservée dans SQLite pour compatibilité. Les
// définitions proviennent désormais du registre central.
const DEFAULT_HARD_RULES = createHardRulesRegistry().legacyPrivateRules();

function now() { return new Date().toISOString(); }
function clean(value, max = 2000) { return String(value || "").replace(/[\0\r]/g, " ").trim().slice(0, max); }
function parseJson(value, fallback) { try { return JSON.parse(value); } catch { return fallback; } }
function requiredSensitivity(subjectId, category, requested) {
  const sensitivity = SENSITIVITIES.has(requested) ? requested : "medium";

  if (sensitivity === "restricted") return "restricted";
  if (CHILDREN.has(subjectId) || PROTECTED_CATEGORIES.has(category)) return "high";

  return sensitivity;
}

function requiredPolicy(subjectId, category, sensitivity, requested) {
  if (requested === "local_only") return requested;
  if (CHILDREN.has(subjectId) || PROTECTED_CATEGORIES.has(category) || ["high", "restricted"].includes(sensitivity)) return "confirm_each_use";
  if (["alexandra", "household"].includes(subjectId)) return "confirm_each_use";
  return API_POLICIES.has(requested) ? requested : "contextual";
}

function createPrivateMemoryService({ databaseWrapper, cipher, audit = () => {} }) {
  if (!cipher) return { available: false, reason: "Le coffre macOS est indisponible." };
  if (databaseWrapper.kind !== "sqlite") return { available: false, reason: "SQLite local est requis pour la mémoire privée." };
  const db = databaseWrapper.database;

  function auditEntry(eventType, recordId, subjectId, status = "ok") {
    return { id: crypto.randomUUID(), eventType, recordId: recordId || null, subjectId: subjectId || null, status, createdAt: now() };
  }
  function insertAudit(entry) {
    db.prepare("INSERT INTO private_memory_audit(id,event_type,record_id,subject_id,status,created_at) VALUES(?,?,?,?,?,?)")
      .run(entry.id, entry.eventType, entry.recordId, entry.subjectId, entry.status, entry.createdAt);
  }
  function notifyAudit(entry) {
    audit("private-memory", { eventType: entry.eventType, recordId: entry.recordId, subjectId: entry.subjectId, status: entry.status });
  }
  function recordAudit(eventType, recordId, subjectId, status = "ok") {
    const entry = auditEntry(eventType, recordId, subjectId, status);
    insertAudit(entry);
    notifyAudit(entry);
  }
  function transaction(operation) {
    const ownsTransaction = db.isTransaction !== true;
    const savepoint = ownsTransaction ? null : `private_memory_update_${crypto.randomUUID().replaceAll("-", "")}`;
    if (ownsTransaction) db.exec("BEGIN IMMEDIATE"); else db.exec(`SAVEPOINT ${savepoint}`);
    try {
      const result = operation();
      if (ownsTransaction) db.exec("COMMIT"); else db.exec(`RELEASE SAVEPOINT ${savepoint}`);
      return { result, committed: ownsTransaction };
    } catch (error) {
      if (ownsTransaction) {
        try { db.exec("ROLLBACK"); } catch {}
      } else {
        try { db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`); } catch {}
        try { db.exec(`RELEASE SAVEPOINT ${savepoint}`); } catch {}
      }
      throw error;
    }
  }
  function ensureDefaults() {
    const stamp = now();
    for (const [id, displayName, isMinor, defaultApiPolicy] of DEFAULT_PROFILES) {
      db.prepare("INSERT OR IGNORE INTO private_profiles(id,payload_encrypted,enabled,updated_at) VALUES(?,?,1,?)")
        .run(id, cipher.encrypt({ displayName, relationshipToOwner: id === "arnaud" ? "self" : id, isMinor, defaultApiPolicy, consentStatus: id === "arnaud" || id === "noon" ? "granted" : "pending" }), stamp);
    }
    for (const [key, statement, requiresOptIn = false] of DEFAULT_HARD_RULES) {
      db.prepare("INSERT OR IGNORE INTO private_hard_rules(id,rule_key,statement,enabled,requires_opt_in,updated_at) VALUES(?,?,?,?,?,?)")
        .run(crypto.randomUUID(), key, statement, requiresOptIn ? 0 : 1, requiresOptIn ? 1 : 0, stamp);
    }
  }
  function profile(row) { return row ? { id: row.id, ...cipher.decrypt(row.payload_encrypted), enabled: Boolean(row.enabled), updatedAt: row.updated_at } : null; }
  function memory(row) {
    if (!row) return null;
    return { id: row.id, subjectId: row.subject_id, category: row.category, sensitivity: row.sensitivity, status: row.status, confidence: row.confidence, sourceType: row.source_type, sourceReference: row.source_encrypted ? cipher.decrypt(row.source_encrypted) : null, observedAt: row.observed_at, validFrom: row.valid_from, validUntil: row.valid_until, expiresAt: row.expires_at, apiPolicy: row.api_policy, consentRequired: Boolean(row.consent_required), consentStatus: row.consent_status, tags: parseJson(row.tags_json, []), supersedesId: row.supersedes_id, ...cipher.decrypt(row.payload_encrypted), createdAt: row.created_at, updatedAt: row.updated_at, deletedAt: row.deleted_at };
  }
  function validate(input) {
    const subjectId = clean(input.subjectId, 60);
    if (!SUBJECTS.has(subjectId) && !subjectId.startsWith("project:")) throw new Error("Profil mémoire invalide.");
    const category = clean(input.category || "general", 80).toLowerCase();
    const sensitivity = requiredSensitivity(subjectId, category, input.sensitivity);
    let status = STATUSES.has(input.status) ? input.status : "pending_review";
    const consentRequired = Boolean(input.consentRequired || CHILDREN.has(subjectId) || PROTECTED_CATEGORIES.has(category) || ["high", "restricted"].includes(sensitivity));
    if (consentRequired && status === "confirmed" && input.consentStatus !== "granted") status = "pending_review";
    return { subjectId, category, sensitivity, status, consentRequired, apiPolicy: requiredPolicy(subjectId, category, sensitivity, input.apiPolicy), consentStatus: input.consentStatus === "granted" ? "granted" : "pending" };
  }
  function createMemory(input) {
    const checked = validate(input); const id = input.id || crypto.randomUUID(); const stamp = now();
    const statement = clean(input.statement, 12000); if (!statement) throw new Error("Le souvenir est vide.");
    const duplicate = listMemories({ subjectId: checked.subjectId, includeDeleted: false }).find((item) => item.category === checked.category && item.statement.toLocaleLowerCase("fr") === statement.toLocaleLowerCase("fr"));
    if (duplicate) return { ...duplicate, duplicate: true };
    const conflict = listMemories({
      subjectId: checked.subjectId,
      status: "confirmed",
      includeDeleted: false,
    }).find((item) => (
      item.category === checked.category
      && item.statement !== statement
      && tokenSimilarity(item.statement, statement) > 0.65
      && negationChanged(item.statement, statement)
    ));
    if (conflict && checked.status === "confirmed") checked.status = "pending_review";
    db.prepare(`INSERT INTO private_memories(id,subject_id,category,sensitivity,status,confidence,source_type,observed_at,valid_from,valid_until,expires_at,api_policy,consent_required,consent_status,tags_json,supersedes_id,payload_encrypted,source_encrypted,created_at,updated_at,deleted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)`)
      .run(id, checked.subjectId, checked.category, checked.sensitivity, checked.status, Math.max(0, Math.min(1, Number(input.confidence) || 0.5)), clean(input.sourceType || "explicit-user", 80), input.observedAt || stamp, input.validFrom || null, input.validUntil || null, input.expiresAt || null, checked.apiPolicy, checked.consentRequired ? 1 : 0, checked.consentStatus, JSON.stringify((input.tags || []).map((tag) => clean(tag, 60)).slice(0, 20)), input.supersedesId || null, cipher.encrypt({ statement, payload: { ...(input.payload || {}), conflictWithId: conflict?.id || null } }), input.sourceReference ? cipher.encrypt(clean(input.sourceReference, 1000)) : null, stamp, stamp);
    recordAudit("memory.created", id, checked.subjectId); return getMemory(id);
  }
  function getMemory(id) { return memory(db.prepare("SELECT * FROM private_memories WHERE id=?").get(id)); }
  function listMemories(filters = {}) {
    db.prepare("UPDATE private_memories SET status='historical',updated_at=? WHERE expires_at IS NOT NULL AND expires_at<=? AND status NOT IN ('deleted','historical')").run(now(), now());
    const clauses = [], values = [];
    if (filters.subjectId) { clauses.push("subject_id=?"); values.push(filters.subjectId); }
    if (filters.status) { clauses.push("status=?"); values.push(filters.status); }
    if (filters.sensitivity) { clauses.push("sensitivity=?"); values.push(filters.sensitivity); }
    if (!filters.includeDeleted) clauses.push("status<>'deleted'");
    let items = db.prepare(`SELECT * FROM private_memories ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY updated_at DESC LIMIT 500`).all(...values).map(memory);
    const query = clean(filters.query, 200).toLocaleLowerCase("fr");
    if (query) items = items.filter((item) => `${item.statement} ${(item.tags || []).join(" ")}`.toLocaleLowerCase("fr").includes(query));
    return items;
  }
  function updateMemory(id, changes, reason = "correction") {
    const current = getMemory(id); if (!current) throw new Error("Souvenir introuvable.");
    const next = { ...current, ...changes, id };
    const checked = validate(next);
    const version = { id: crypto.randomUUID(), memoryId: id, payloadEncrypted: cipher.encrypt(current), changedAt: now(), reason: clean(reason, 120) };
    const update = { category: checked.category, sensitivity: checked.sensitivity, status: checked.status,
      confidence: Math.max(0, Math.min(1, Number(next.confidence) || 0)), expiresAt: next.expiresAt || null,
      apiPolicy: checked.apiPolicy, consentRequired: checked.consentRequired ? 1 : 0,
      consentStatus: checked.consentStatus, tags: JSON.stringify(next.tags || []),
      payloadEncrypted: cipher.encrypt({ statement: clean(next.statement, 12000), payload: next.payload || null }), updatedAt: now() };
    const entry = auditEntry("memory.updated", id, checked.subjectId);
    const outcome = transaction(() => {
      db.prepare("INSERT INTO private_memory_versions(id,memory_id,payload_encrypted,changed_at,reason) VALUES(?,?,?,?,?)")
        .run(version.id, version.memoryId, version.payloadEncrypted, version.changedAt, version.reason);
      db.prepare("UPDATE private_memories SET category=?,sensitivity=?,status=?,confidence=?,expires_at=?,api_policy=?,consent_required=?,consent_status=?,tags_json=?,payload_encrypted=?,updated_at=? WHERE id=?")
        .run(update.category, update.sensitivity, update.status, update.confidence, update.expiresAt,
          update.apiPolicy, update.consentRequired, update.consentStatus, update.tags, update.payloadEncrypted, update.updatedAt, id);
      insertAudit(entry);
    });
    // Un appelant qui possède la transaction décide seul du commit. La ligne
    // d'audit reste transactionnelle ; aucune notification externe n'anticipe
    // un commit que ce service ne peut pas observer.
    if (outcome.committed) notifyAudit(entry);
    return getMemory(id);
  }
  function forgetMemory(id) { const current = getMemory(id); if (!current) throw new Error("Souvenir introuvable."); db.prepare("UPDATE private_memories SET status='deleted',payload_encrypted=?,source_encrypted=NULL,deleted_at=?,updated_at=? WHERE id=?").run(cipher.encrypt({ statement: "", payload: null }), now(), now(), id); recordAudit("memory.deleted", id, current.subjectId); return true; }
  function purgeSubject(subjectId) { const ids = db.prepare("SELECT id FROM private_memories WHERE subject_id=?").all(subjectId); db.prepare("DELETE FROM private_memory_versions WHERE memory_id IN (SELECT id FROM private_memories WHERE subject_id=?)").run(subjectId); db.prepare("DELETE FROM private_memories WHERE subject_id=?").run(subjectId); recordAudit("profile.purged", null, subjectId); return ids.length; }
  function exportSubject(subjectId) { return { version: 1, exportedAt: now(), profile: profile(db.prepare("SELECT * FROM private_profiles WHERE id=?").get(subjectId)), memories: listMemories({ subjectId, includeDeleted: true }) }; }
  function setSettings({ enabled, sensitiveApiAllowed }) { db.prepare("INSERT OR REPLACE INTO private_consents(id,subject_id,purpose,status,granted_at,revoked_at,updated_at) VALUES('global-memory','noon','memory-enabled',?,?,?,?)").run(enabled ? "granted" : "revoked", enabled ? now() : null, enabled ? null : now(), now()); db.prepare("INSERT OR REPLACE INTO private_consents(id,subject_id,purpose,status,granted_at,revoked_at,updated_at) VALUES('sensitive-api','noon','sensitive-api',?,?,?,?)").run(sensitiveApiAllowed ? "granted" : "revoked", sensitiveApiAllowed ? now() : null, sensitiveApiAllowed ? null : now(), now()); return settings(); }
  function consentStatus(id, fallback = false) { const row = db.prepare("SELECT status FROM private_consents WHERE id=?").get(id); return row ? row.status === "granted" : fallback; }
  function settings() { return { enabled: consentStatus("global-memory", true), sensitiveApiAllowed: consentStatus("sensitive-api", false) }; }
  function listProfiles() { return db.prepare("SELECT * FROM private_profiles ORDER BY rowid").all().map(profile); }
  function setProfileEnabled(subjectId, enabled) { if (!SUBJECTS.has(subjectId)) throw new Error("Profil mémoire invalide."); db.prepare("UPDATE private_profiles SET enabled=?,updated_at=? WHERE id=?").run(enabled ? 1 : 0, now(), subjectId); recordAudit("profile.settings", null, subjectId); return profile(db.prepare("SELECT * FROM private_profiles WHERE id=?").get(subjectId)); }
  function isProfileEnabled(subjectId) { const row = db.prepare("SELECT enabled FROM private_profiles WHERE id=?").get(subjectId); return Boolean(row?.enabled); }
  function hardRules() { return db.prepare("SELECT id,rule_key key,statement,enabled,requires_opt_in requiresOptIn FROM private_hard_rules WHERE enabled=1 ORDER BY rowid").all().map((row) => ({ ...row, enabled: Boolean(row.enabled), requiresOptIn: Boolean(row.requiresOptIn) })); }
  // API technique de migration : les tables ne contiennent que des empreintes,
  // identifiants et compteurs. Aucun contenu personnel déchiffré n'y est écrit.
  function beginMigration({ id, backupPath = null, report = {} }) {
    db.prepare("INSERT OR IGNORE INTO private_memory_migrations(id,status,backup_path,report_json,started_at) VALUES(?,?,?,?,?)")
      .run(id, "running", backupPath, JSON.stringify(report), now());
  }
  function migrationRecord(sourceType, sourceIdHash) {
    return db.prepare("SELECT * FROM private_memory_migration_records WHERE source_type=? AND source_id_hash=? AND disposition NOT IN ('rolled_back','failed')")
      .get(sourceType, sourceIdHash) || null;
  }
  function recordMigration(entry) {
    db.prepare(`INSERT OR REPLACE INTO private_memory_migration_records
      (migration_id,source_type,source_id_hash,fingerprint,target_id,disposition,error_code,created_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(entry.migrationId, entry.sourceType, entry.sourceIdHash,
      entry.fingerprint, entry.targetId || null, entry.disposition, entry.errorCode || null, now());
  }
  function completeMigration(id, status, report = {}) {
    db.prepare("UPDATE private_memory_migrations SET status=?,report_json=?,completed_at=? WHERE id=?")
      .run(status, JSON.stringify(report), now(), id);
    recordAudit("migration.completed", id, "noon", status);
  }
  function migrationStatus(id) {
    const row = db.prepare("SELECT * FROM private_memory_migrations WHERE id=?").get(id);
    if (!row) return null;
    return { id: row.id, status: row.status, backupPath: row.backup_path,
      report: parseJson(row.report_json, {}), startedAt: row.started_at, completedAt: row.completed_at };
  }
  function rollbackMigration(id) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const targets = db.prepare("SELECT target_id FROM private_memory_migration_records WHERE migration_id=? AND disposition='migrated' AND target_id IS NOT NULL").all(id);
      for (const { target_id: targetId } of targets) {
        db.prepare("DELETE FROM private_memory_versions WHERE memory_id=?").run(targetId);
        db.prepare("DELETE FROM private_memories WHERE id=?").run(targetId);
      }
      db.prepare("UPDATE private_memory_migration_records SET disposition='rolled_back' WHERE migration_id=? AND disposition='migrated'").run(id);
      db.prepare("UPDATE private_memory_migrations SET status='rolled_back',completed_at=? WHERE id=?").run(now(), id);
      db.exec("COMMIT");
      recordAudit("migration.rolled_back", id, "noon");
      return { migrationId: id, removed: targets.length };
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }
  ensureDefaults();
  return { available: true, createMemory, getMemory, listMemories, updateMemory, forgetMemory, purgeSubject, exportSubject, listProfiles, setProfileEnabled, isProfileEnabled, hardRules, settings, setSettings, recordAudit, beginMigration, migrationRecord, recordMigration, completeMigration, migrationStatus, rollbackMigration };
}

module.exports = { API_POLICIES, CHILDREN, PROTECTED_CATEGORIES, SENSITIVITIES, STATUSES, SUBJECTS, createPrivateMemoryService, requiredPolicy, requiredSensitivity };
