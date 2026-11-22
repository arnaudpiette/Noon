"use strict";

// V3-L7 (A.5) — l'interface est découpée en morceaux par écran (public/app/), recollés dans cet
// ordre et servis en un seul /app.js. Le navigateur exécute donc toujours un script unique, comme
// avant le découpage : mêmes déclarations remontées, aucune reprise asynchrone entre deux morceaux.
const fs = require("node:fs");
const path = require("node:path");

const APP_PARTS = Object.freeze([
  "01-core.js",
  "02-dev-preview.js",
  "03-dev-terminal-layout-problems.js",
  "04-dev-source-control.js",
  "05-dev-terminal-session.js",
  "06-dev-terminal-tabs.js",
  "07-dev-workspace-agent.js",
  "08-chat-input-voice.js",
  "09-conversations-projects.js",
  "10-views-brief-memory.js",
  "11-recording-integrations.js",
]);

function appPartsDirectory(publicDirectory) { return path.join(publicDirectory, "app"); }

function readAppBundle(publicDirectory) {
  const directory = appPartsDirectory(publicDirectory);
  return APP_PARTS.map((name) => fs.readFileSync(path.join(directory, name), "utf8")).join("");
}

module.exports = { APP_PARTS, appPartsDirectory, readAppBundle };
