"use strict";

// Vérifie l’ajout, la révocation et la normalisation des autorisations de dossiers.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createLocalPermissionStore } = require("../lib/local-permissions");

test("ajoute, persiste et révoque une autorisation locale", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noon-permissions-"));
  const allowed = path.join(root, "allowed"); fs.mkdirSync(allowed);
  const store = createLocalPermissionStore(path.join(root, "permissions.json"));
  const permission = store.add({ path: allowed, mode: "read-write", output: true });
  assert.equal(permission.path, fs.realpathSync(allowed));
  assert.deepEqual(store.roots("read-write"), [fs.realpathSync(allowed)]);
  store.remove(allowed);
  assert.deepEqual(store.roots(), []);
});

test("refuse un dossier disparu et normalise un lien symbolique", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noon-permissions-"));
  const allowed = path.join(root, "allowed"); fs.mkdirSync(allowed);
  const link = path.join(root, "link"); fs.symlinkSync(allowed, link);
  const store = createLocalPermissionStore(path.join(root, "permissions.json"));
  assert.equal(store.add({ path: link }).path, fs.realpathSync(allowed));
  assert.throws(() => store.add({ path: path.join(root, "missing") }), /indisponible/);
});
