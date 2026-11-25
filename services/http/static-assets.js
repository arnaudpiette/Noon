"use strict";

// V3-L7 — fichiers de l'interface servis par le serveur local, sortis de server.js.
// Table exacte : URL → fichier de public/ et en-têtes, identiques à ceux d'avant.
// Correspondance sur `req.url` complet (une URL avec ?query n'est pas servie ici, comme avant).
// Les fichiers sont relus à chaque requête : une modification locale est visible sans redémarrer.

const fs = require("node:fs");
const path = require("node:path");
const { readAppBundle } = require("./app-bundle");

const JS = "application/javascript; charset=utf-8";
const plainJs = Object.freeze({ "Content-Type": JS });
const nosniffJs = Object.freeze({ "Content-Type": JS, "X-Content-Type-Options": "nosniff" });

const APP_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";

const STATIC_ASSETS = Object.freeze({
  "/app": { file: ["index.html"], headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": APP_CSP, "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" } },
  "/style.css": { file: ["style.css"], headers: { "Content-Type": "text/css; charset=utf-8" } },
  // V3-L7 (A.5) : public/app/*.js recollés dans l'ordre et servis en un seul script.
  "/app.js": { bundle: true, headers: plainJs },
  "/ui-utils.js": { file: ["ui-utils.js"], headers: plainJs },
  "/control-center.js": { file: ["control-center.js"], headers: plainJs },
  "/dev-project-rules-ui.js": { file: ["dev-project-rules-ui.js"], headers: plainJs },
  "/selfdev-ui.js": { file: ["selfdev-ui.js"], headers: nosniffJs },
  "/character-ui.js": { file: ["character-ui.js"], headers: nosniffJs },
  "/iphone-companion-ui.js": { file: ["iphone-companion-ui.js"], headers: nosniffJs },
  "/figma-bridge-ui.js": { file: ["figma-bridge-ui.js"], headers: nosniffJs },
  "/dev-missions-ui.js": { file: ["dev-missions-ui.js"], headers: nosniffJs },
  "/noon-health-ui.js": { file: ["noon-health-ui.js"], headers: nosniffJs },
  "/mcp-connectors-ui.js": { file: ["mcp-connectors-ui.js"], headers: nosniffJs },
  "/recorder-ui.js": { file: ["recorder-ui.js"], headers: nosniffJs },
  "/goal-mode-dev-ui.js": { file: ["goal-mode-dev-ui.js"], headers: plainJs },
  "/dev-terminal-profile-ui.js": { file: ["dev-terminal-profile-ui.js"], headers: { "Content-Type": JS, "Cache-Control": "no-store" } },
  "/live-voice-core.js": { file: ["live-voice-core.js"], headers: plainJs },
  "/live-voice.js": { file: ["live-voice.js"], headers: plainJs },
  "/noon-particles.js": { file: ["noon-particles.js"], headers: plainJs },
  "/assets/noon-icon-attachment.svg": { file: ["assets", "noon-icon-attachment.svg"], headers: { "Content-Type": "image/svg+xml; charset=utf-8" } },
});

function createStaticAssets({ publicDirectory } = {}) {
  if (!publicDirectory) throw new TypeError("publicDirectory requis.");
  const matches = (req) => req?.method === "GET" && Object.prototype.hasOwnProperty.call(STATIC_ASSETS, req.url);
  function handle(req, res) {
    const asset = STATIC_ASSETS[req.url];
    const body = asset.bundle ? readAppBundle(publicDirectory) : fs.readFileSync(path.join(publicDirectory, ...asset.file));
    res.writeHead(200, { ...asset.headers });
    return res.end(body);
  }
  return Object.freeze({ matches, handle });
}

module.exports = { APP_CSP, STATIC_ASSETS, createStaticAssets };
