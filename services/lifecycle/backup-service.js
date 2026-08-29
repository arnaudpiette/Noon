"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function fingerprint(filePath) { const hash = crypto.createHash("sha256"); hash.update(fs.readFileSync(filePath)); return hash.digest("hex"); }
function inside(candidate, root) { const relative = path.relative(path.resolve(root), path.resolve(candidate)); return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)); }

function createBackupService({ backupRoot, storeRegistry, appVersion, schemaVersion, configSchemaVersion, sqliteBackup = null, now = () => Date.now(), observability = null } = {}) {
  if (!path.isAbsolute(backupRoot)) throw new TypeError("Le dossier de backup doit être absolu.");
  function validateDestination(destination) { if (!inside(destination, backupRoot)) throw Object.assign(new Error("Destination de backup hors périmètre."), { code: "BACKUP_PATH_FORBIDDEN" }); let cursor = path.dirname(destination); while (inside(cursor, backupRoot) && cursor !== path.dirname(cursor)) { if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw Object.assign(new Error("Symlink de backup refusé."), { code: "BACKUP_SYMLINK_FORBIDDEN" }); cursor = path.dirname(cursor); } }
  function validate(backupDirectory) {
    const manifestPath = path.join(backupDirectory, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    for (const stored of manifest.stores) { const target = path.join(backupDirectory, stored.relativePath); const definition = storeRegistry.get(stored.storeId); if (!inside(target, backupDirectory) || !fs.existsSync(target) || fs.statSync(target).size <= 0 || fingerprint(target) !== manifest.fingerprints[stored.storeId]) throw Object.assign(new Error(`Backup invalide : ${stored.storeId}`), { code: "BACKUP_INVALID" }); if (definition?.validateBackup && definition.validateBackup(target) !== true) throw Object.assign(new Error(`Backup illisible : ${stored.storeId}`), { code: "BACKUP_INVALID" }); }
    return { valid: true, manifest };
  }
  async function create({ reason = "MANUAL", availableBytes = Infinity } = {}) {
    const stores = storeRegistry.backupStores().filter((store) => fs.existsSync(store.path));
    const requiredBytes = stores.reduce((sum, store) => sum + fs.statSync(store.path).size, 0) * 1.2 + 1_048_576;
    if (availableBytes < requiredBytes) throw Object.assign(new Error("Espace disque insuffisant."), { code: "BACKUP_DISK_FULL" });
    const id = `backup-${new Date(now()).toISOString().replace(/[:.]/g, "-")}-${crypto.randomBytes(3).toString("hex")}`;
    const directory = path.join(backupRoot, id); validateDestination(directory); fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    observability?.("backup_started", { backupId: id, reason, storeCount: stores.length });
    const manifest = { backupId: id, createdAt: new Date(now()).toISOString(), appVersion, schemaVersion, configSchemaVersion, encrypted: stores.filter((item) => item.sensitive).every((item) => item.encrypted), reason, state: "CREATING", stores: [], fingerprints: {} };
    try {
      for (const store of stores) {
        const extension = path.extname(store.path) || ".data"; const relativePath = `${store.storeId}${extension}`; const target = path.join(directory, relativePath);
        if (store.kind === "sqlite" && sqliteBackup) await sqliteBackup(store, target); else fs.copyFileSync(store.path, target);
        fs.chmodSync(target, 0o600); manifest.stores.push({ storeId: store.storeId, relativePath, criticality: store.criticality, encrypted: store.encrypted }); manifest.fingerprints[store.storeId] = fingerprint(target);
      }
      manifest.state = "VALID"; fs.writeFileSync(path.join(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 }); validate(directory);
      observability?.("backup_completed", { backupId: id, sizeBytes: manifest.stores.reduce((sum, item) => sum + fs.statSync(path.join(directory, item.relativePath)).size, 0) });
      return { backupId: id, directory, manifest };
    } catch (error) { manifest.state = "INVALID"; observability?.("backup_validation_failed", { backupId: id, code: error.code || error.name }); throw error; }
  }
  function list() { if (!fs.existsSync(backupRoot)) return []; return fs.readdirSync(backupRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => { try { return validate(path.join(backupRoot, entry.name)).manifest; } catch { return null; } }).filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  function prune({ keepPerReason = 3, protectedBackupIds = [] } = {}) { const grouped = new Map(); for (const manifest of list()) { const group = grouped.get(manifest.reason) || []; group.push(manifest); grouped.set(manifest.reason, group); } const removed = []; for (const group of grouped.values()) { let removedInGroup = 0; for (const manifest of group.slice(Math.max(0, keepPerReason))) { if (protectedBackupIds.includes(manifest.backupId) || group.length - removedInGroup <= 1) continue; fs.rmSync(path.join(backupRoot, manifest.backupId), { recursive: true }); removed.push(manifest.backupId); removedInGroup += 1; } } return removed; }
  return { create, list, prune, root: backupRoot, validate };
}

module.exports = { createBackupService, fingerprint, inside };
