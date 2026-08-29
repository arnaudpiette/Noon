"use strict";

const fs = require("node:fs");
const path = require("node:path");

function createRecoveryService({ backupService, storeRegistry, backupCurrent, validateRestored, maintenance, observability = null } = {}) {
  async function restore(backupId, { approved = false, automatic = false, noWritesSinceFailure = false } = {}) {
    if (!approved && !(automatic && noWritesSinceFailure)) throw Object.assign(new Error("Approbation exacte requise pour restaurer."), { code: "RESTORE_APPROVAL_REQUIRED" });
    const manifest = backupService.list().find((item) => item.backupId === backupId);
    if (!manifest) throw Object.assign(new Error("Backup valide introuvable."), { code: "BACKUP_NOT_FOUND" });
    maintenance?.set("RECOVERING"); observability?.("restore_started", { backupId });
    try {
      const safetyBackup = await backupCurrent?.();
      const directory = path.join(backupService.root || "", backupId);
      for (const item of manifest.stores) {
        const store = storeRegistry.get(item.storeId); if (!store) continue;
        const source = path.join(directory, item.relativePath); const temporary = `${store.path}.${process.pid}.restore`;
        fs.copyFileSync(source, temporary); fs.renameSync(temporary, store.path);
      }
      await validateRestored?.(manifest);
      maintenance?.set("MAINTENANCE_READ_ONLY"); observability?.("restore_completed", { backupId });
      return { restored: true, backupId, safetyBackupId: safetyBackup?.backupId || null, restartRequired: true };
    } catch (error) { observability?.("restore_failed", { backupId, code: error.code || error.name }); throw error; }
  }
  return { restore };
}

module.exports = { createRecoveryService };
