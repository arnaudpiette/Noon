"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  createBackup,
  migrateLegacyData,
  validateBackup,
} = require("../lib/internal-data");
const { routeNoonRequest } = require("../lib/agent-router");

test("migre les JSON valides sans supprimer les fichiers historiques", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noon-migration-"));
  const source = path.join(root, "source");
  const destination = path.join(root, "data");
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, "usage.json"), '{"requests":2}');
  const result = migrateLegacyData(source, destination);
  assert.deepEqual(result.migrated, ["usage.json"]);
  assert.equal(fs.existsSync(path.join(source, "usage.json")), true);
  assert.equal(fs.existsSync(path.join(destination, "migration-backup", "usage.json")), true);
});

test("crée et valide une sauvegarde avec checksums", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noon-backup-"));
  fs.writeFileSync(path.join(root, "usage.json"), '{"requests":1}');
  const backup = createBackup(root, path.join(root, "backups"), ["usage.json"]);
  assert.equal(validateBackup(backup.path).valid, true);
  fs.writeFileSync(path.join(backup.path, "usage.json"), "{}");
  assert.equal(validateBackup(backup.path).valid, false);
});

test("route une seule spécialité principale selon la demande", () => {
  assert.equal(routeNoonRequest("Corrige ce bug dans le router").id, "dev");
  assert.equal(routeNoonRequest("Prépare ma soutenance OpenClassrooms").id, "openclassrooms");
  assert.equal(routeNoonRequest("Réponds à cet email").id, "mail");
  assert.equal(routeNoonRequest("Travaille la typographie", { mode: "DA" }).id, "design");
});
