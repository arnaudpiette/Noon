#!/usr/bin/env node
"use strict";

// IP-2 : régénère test/fixtures/remote-interop-vectors.v1.json (déterministe).
// `--check` échoue si le fichier versionné diffère de ce que produit le code actuel.
const fs = require("node:fs");
const path = require("node:path");
const { buildInteropVectors } = require("../services/remote/remote-interop-vectors");

const target = path.join(__dirname, "..", "test", "fixtures", "remote-interop-vectors.v1.json");
const content = `${JSON.stringify(buildInteropVectors(), null, 2)}\n`;
if (process.argv.includes("--check")) {
  const current = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
  if (current !== content) { console.error("Vecteurs d'interopérabilité obsolètes : lancer npm run remote:vectors."); process.exit(1); }
  console.log("Vecteurs d'interopérabilité à jour.");
} else {
  fs.writeFileSync(target, content);
  console.log(`Écrit : ${path.relative(process.cwd(), target)}`);
}
