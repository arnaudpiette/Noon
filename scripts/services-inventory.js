#!/usr/bin/env node
"use strict";

// V3-L0 (A.7) : inventaire statique des services. Parcourt les require() relatifs depuis
// les points d'entrée de l'application (Electron, serveur local, preload, scripts servis
// au renderer) et classe chaque dossier de services/ :
//   BRANCHÉ  : atteint depuis l'application ;
//   TESTS    : atteint seulement depuis test/ ou scripts/ ;
//   MORT     : jamais requis.
// Statique : un service BRANCHÉ peut rester inactif à l'exécution (flag OFF, SHADOW).
// `--json` pour une sortie machine.
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const APP_ENTRIES = ["electron/main.js", "electron/preload.js", "server.js", "config.js"];
const REQUIRE = /require\(\s*["'`](\.{1,2}\/[^"'`]+)["'`]\s*\)/g;

function resolveFile(from, spec) {
  const base = path.resolve(path.dirname(from), spec);
  for (const candidate of [base, `${base}.js`, `${base}.json`, path.join(base, "index.js")]) {
    try { if (fs.statSync(candidate).isFile()) return candidate; } catch { /* suivant */ }
  }
  return null;
}

function walk(entries) {
  const seen = new Set();
  const stack = entries.map((entry) => path.join(ROOT, entry)).filter((file) => fs.existsSync(file));
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file) || !file.endsWith(".js")) { seen.add(file); continue; }
    seen.add(file);
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(REQUIRE)) {
      const target = resolveFile(file, match[1]);
      if (target && !seen.has(target) && !target.includes(`${path.sep}node_modules${path.sep}`)) stack.push(target);
    }
  }
  return seen;
}

const listJs = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  if (entry.isDirectory()) return entry.name === "node_modules" ? [] : listJs(full);
  return entry.name.endsWith(".js") ? [full] : [];
});

const app = walk(APP_ENTRIES);
const devEntries = [...listJs(path.join(ROOT, "test")), ...listJs(path.join(ROOT, "scripts"))].map((file) => path.relative(ROOT, file));
const dev = walk(devEntries);
const servicesDir = path.join(ROOT, "services");
const rows = fs.readdirSync(servicesDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => {
  const files = listJs(path.join(servicesDir, entry.name));
  const appFiles = files.filter((file) => app.has(file));
  const devFiles = files.filter((file) => !app.has(file) && dev.has(file));
  const deadFiles = files.filter((file) => !app.has(file) && !dev.has(file));
  const lines = files.reduce((sum, file) => sum + fs.readFileSync(file, "utf8").split("\n").length, 0);
  const status = appFiles.length ? "BRANCHÉ" : devFiles.length ? "TESTS" : "MORT";
  return { service: entry.name, status, files: files.length, appFiles: appFiles.length, testOnlyFiles: devFiles.map((file) => path.relative(ROOT, file)), deadFiles: deadFiles.map((file) => path.relative(ROOT, file)), lines };
});
const libFiles = listJs(path.join(ROOT, "lib"));
const lib = { files: libFiles.length, notInApp: libFiles.filter((file) => !app.has(file)).map((file) => ({ file: path.relative(ROOT, file), status: dev.has(file) ? "TESTS" : "MORT" })) };

if (process.argv.includes("--json")) { console.log(JSON.stringify({ services: rows, lib }, null, 2)); process.exit(0); }
for (const row of rows.sort((a, b) => a.status.localeCompare(b.status) || a.service.localeCompare(b.service))) {
  const partial = row.status === "BRANCHÉ" && (row.testOnlyFiles.length || row.deadFiles.length) ? ` · hors app : ${row.testOnlyFiles.length} tests seuls, ${row.deadFiles.length} morts` : "";
  console.log(`${row.status.padEnd(8)} ${row.service.padEnd(28)} ${String(row.files).padStart(3)} fichiers ${String(row.lines).padStart(6)} lignes${partial}`);
}
console.log(`\nlib/ : ${lib.files} fichiers, ${lib.notInApp.length} hors application`);
for (const item of lib.notInApp) console.log(`  ${item.status.padEnd(6)} ${item.file}`);
