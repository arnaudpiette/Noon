"use strict";

// V3-L7 (A.5) — texte complet de l'interface (public/app/*.js recollés), tel que servi en /app.js.
const path = require("node:path");
const { readAppBundle } = require("../../services/http/app-bundle");

function readAppSource() { return readAppBundle(path.join(__dirname, "..", "..", "public")); }

module.exports = { readAppSource };
