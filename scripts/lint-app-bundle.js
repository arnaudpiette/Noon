#!/usr/bin/env node
"use strict";

// V3-L7 (A.5) — contrôle de l'interface découpée (public/app/*.js).
// Les morceaux partagent une seule portée une fois recollés : on vérifie la syntaxe de chacun,
// puis on lint le fichier recollé (tel qu'il est servi en /app.js), et chaque erreur est ramenée
// à son morceau et à sa ligne. --syntax-only : syntaxe seulement (utilisé par npm test).
const path = require("node:path");
const vm = require("node:vm");
const fs = require("node:fs");
const { APP_PARTS, appPartsDirectory, readAppBundle } = require("../services/http/app-bundle");

const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const MAX_LINES = 1500;

function locate(line) {
  let start = 1;
  for (const name of APP_PARTS) {
    const count = fs.readFileSync(path.join(appPartsDirectory(PUBLIC), name), "utf8").split("\n").length - 1;
    if (line < start + count + 1) return `public/app/${name}:${line - start + 1}`;
    start += count;
  }
  return `public/app.js:${line}`;
}

(async () => {
  let failed = false;
  for (const name of APP_PARTS) {
    const file = path.join(appPartsDirectory(PUBLIC), name);
    const source = fs.readFileSync(file, "utf8");
    try { new vm.Script(source, { filename: file }); }
    catch (error) { failed = true; console.error(`Syntaxe : public/app/${name} — ${error.message}`); }
    const lines = source.split("\n").length;
    if (lines > MAX_LINES) { failed = true; console.error(`Taille : public/app/${name} fait ${lines} lignes (plafond ${MAX_LINES}).`); }
  }
  const bundle = readAppBundle(PUBLIC);
  try { new vm.Script(bundle, { filename: "app.js" }); } catch (error) { failed = true; console.error(`Syntaxe du fichier recollé : ${error.message}`); }
  if (!process.argv.includes("--syntax-only") && !failed) {
    const { ESLint } = require("eslint");
    const eslint = new ESLint({ cwd: ROOT, ignore: false });
    const [result] = await eslint.lintText(bundle, { filePath: path.join(PUBLIC, "app.js") });
    for (const message of result.messages) {
      if (message.severity < 2) continue;
      failed = true;
      console.error(`${locate(message.line)}:${message.column}  ${message.message}  ${message.ruleId || ""}`);
    }
  }
  if (failed) process.exitCode = 1;
  else console.log(`public/app : ${APP_PARTS.length} morceaux, syntaxe${process.argv.includes("--syntax-only") ? "" : " et lint"} OK.`);
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
