"use strict";

// Contrôle le paquet macOS final et refuse l’inclusion de secrets ou données d’exécution.

const fs = require("fs");
const path = require("path");

const outDirectory = path.join(__dirname, "..", "out");
if (!fs.existsSync(outDirectory)) {
  console.error("Aucun package dans out/. Lancez npm run package:mac:x64.");
  process.exitCode = 1;
  return;
}

const forbiddenNames = new Set([".env", "integration-tokens.json", "conversation-memory.json"]);
const problems = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (forbiddenNames.has(entry.name)) problems.push(target);
    if (entry.isDirectory()) walk(target);
  }
}
walk(outDirectory);

if (problems.length) {
  console.error(`Fichiers interdits détectés :\n${problems.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log("Package vérifié : aucun secret ou fichier runtime connu détecté.");
}
