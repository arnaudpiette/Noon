"use strict";

// V3-L7 — les routes HTTP sortent progressivement de server.js vers des modules. Les tests
// de câblage lisent ici server.js suivi de ces modules, pour garder leurs vérifications.
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
const ROUTE_MODULES = Object.freeze([
  "services/http/static-assets.js",
  "services/memory/memory-http-routes.js",
  "services/personal-intelligence/personal-intelligence-http-routes.js",
  "services/dev/dev-http-routes.js",
]);

function readServerSource() {
  return [path.join(ROOT, "server.js"), ...ROUTE_MODULES.map((file) => path.join(ROOT, file))]
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n");
}

module.exports = { ROUTE_MODULES, readServerSource };
