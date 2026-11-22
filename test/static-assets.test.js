"use strict";

// V3-L7 — fichiers de l'interface servis depuis une table : chaque entrée existe, en-têtes
// exacts, correspondance stricte sur l'URL (pas de ?query, pas d'autre méthode).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { APP_CSP, STATIC_ASSETS, createStaticAssets } = require("../services/http/static-assets");
const { readAppBundle } = require("../services/http/app-bundle");

const PUBLIC = path.join(__dirname, "..", "public");
const serve = (assets, url) => {
  const res = { writeHead(code, headers) { this.code = code; this.headers = headers; }, end(body) { this.body = body; } };
  assets.handle({ method: "GET", url }, res);
  return res;
};

test("chaque entrée de la table pointe vers un fichier présent et se sert telle quelle", () => {
  const assets = createStaticAssets({ publicDirectory: PUBLIC });
  for (const [url, asset] of Object.entries(STATIC_ASSETS)) {
    assert.equal(assets.matches({ method: "GET", url }), true, url);
    const res = serve(assets, url);
    assert.equal(res.code, 200, url);
    assert.deepEqual(res.headers, asset.headers, url);
    const expected = asset.bundle ? readAppBundle(PUBLIC) : fs.readFileSync(path.join(PUBLIC, ...asset.file));
    assert.equal(Buffer.compare(Buffer.from(res.body), Buffer.from(expected)), 0, url);
  }
});

test("en-têtes sensibles conservés : CSP de /app, nosniff, no-store du profil Terminal", () => {
  assert.equal(STATIC_ASSETS["/app"].headers["Content-Security-Policy"], APP_CSP);
  assert.match(APP_CSP, /script-src 'self';/);
  assert.match(APP_CSP, /frame-ancestors 'none'/);
  assert.equal(STATIC_ASSETS["/app"].headers["Referrer-Policy"], "no-referrer");
  assert.equal(STATIC_ASSETS["/dev-missions-ui.js"].headers["X-Content-Type-Options"], "nosniff");
  assert.equal(STATIC_ASSETS["/dev-terminal-profile-ui.js"].headers["Cache-Control"], "no-store");
});

test("correspondance stricte : ni ?query, ni POST, ni chemin voisin, ni clé héritée", () => {
  const assets = createStaticAssets({ publicDirectory: PUBLIC });
  assert.equal(assets.matches({ method: "GET", url: "/app.js?x=1" }), false);
  assert.equal(assets.matches({ method: "POST", url: "/app.js" }), false);
  assert.equal(assets.matches({ method: "GET", url: "/../server.js" }), false);
  assert.equal(assets.matches({ method: "GET", url: "constructor" }), false);
  assert.equal(assets.matches({ method: "GET", url: "/toString" }), false);
});
