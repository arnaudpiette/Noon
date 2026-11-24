"use strict";

// Préchargé dans chaque processus de test (`node --require … --test`, voir package.json).
// Les dossiers créés par mkdtemp sous le dossier temporaire du système, par un test ou par le
// code testé, sont supprimés à la fin du processus. Sans ce filet, chaque `npm test` laissait
// environ 950 dossiers « noon-* » (≈ 200 Mo), jusqu'à remplir le disque. Les nettoyages
// explicites des tests restent en place : ce module ne retire que ce qui reste.
// Ce fichier, situé sous test/, est aussi exécuté comme fichier de test : il ne déclare aucun test.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

if (!globalThis.__noonTempDirCleanupInstalled) {
  globalThis.__noonTempDirCleanupInstalled = true;
  const temporaryRoot = path.resolve(os.tmpdir());
  const created = new Set();
  const track = (directory) => {
    const resolved = path.resolve(String(directory));
    if (path.dirname(resolved) === temporaryRoot) created.add(resolved);
    return directory;
  };

  const originalSync = fs.mkdtempSync;
  fs.mkdtempSync = function mkdtempSync(...args) { return track(originalSync.apply(this, args)); };

  const originalAsync = fs.mkdtemp;
  fs.mkdtemp = function mkdtemp(prefix, options, callback) {
    const done = typeof options === "function" ? options : callback;
    const settings = typeof options === "function" ? undefined : options;
    return originalAsync.call(this, prefix, settings, (error, directory) => {
      if (!error) track(directory);
      done(error, directory);
    });
  };

  const originalPromise = fs.promises.mkdtemp;
  fs.promises.mkdtemp = async function mkdtemp(...args) { return track(await originalPromise.apply(this, args)); };

  process.on("exit", () => {
    for (const directory of created) {
      try { fs.rmSync(directory, { recursive: true, force: true, maxRetries: 2 }); } catch {}
    }
  });
}
