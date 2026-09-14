"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const publicDirectory = path.join(__dirname, "..", "public");
const html = fs.readFileSync(path.join(publicDirectory, "index.html"), "utf8");
const app = fs.readFileSync(path.join(publicDirectory, "app.js"), "utf8");
const css = fs.readFileSync(path.join(publicDirectory, "style.css"), "utf8");

test("la mémoire privée est masquée par défaut sans état persistant", () => {
  assert.match(html, /id="privateMemoryVisibilityButton"[^>]*aria-pressed="false"/);
  assert.match(app, /let privateMemoryShowAll = false/);
  assert.match(app, /visiblePrivateMemoryIds = new Set\(\)/);
  assert.doesNotMatch(app, /localStorage[^\n]*(?:privateMemoryShowAll|visiblePrivateMemoryIds)/);
  assert.match(app, /resetPrivateMemoryVisibility\(\{ render: false \}\)/);
});

test("les contrôles global et individuel sont accessibles", () => {
  assert.match(app, /privateMemoryVisibilityButton\.setAttribute\("aria-pressed"/);
  assert.match(app, /reveal\.setAttribute\("aria-pressed"/);
  assert.match(app, /cette information privée/);
  assert.match(css, /\.private-memory-visibility-toggle:focus-visible,\.private-memory-reveal:focus-visible/);
});

test("chaque révélation exige une authentification locale", () => {
  assert.match(html, /id="privateMemoryAuthDialog"/);
  assert.match(html, /id="privateMemoryPasswordInput" type="password"/);
  assert.match(app, /requestPrivateMemoryAuthentication\(\)/);
  assert.match(app, /authenticatePrivateMemory\(\{method:"touch-id"\}\)/);
  assert.match(app, /authenticatePrivateMemory\(\{method:"password",password\}\)/);
  assert.doesNotMatch(app, /localStorage[^\n]*(?:privateMemoryAuth|privateMemoryPassword)/);
});

test("le renderer masque le texte mais conserve les actions mémoire canoniques", () => {
  assert.match(app, /visible\?memory\.statement:maskPrivateMemoryValue\(memory\.statement\)/);
  assert.match(app, /privateMemoryAction\("update"/);
  assert.match(app, /privateMemoryAction\("forget"/);
  assert.match(app, /privateMemoryAction\("confirm"/);
  assert.match(app, /const groups = new Map\(\)/);
});

test("le panneau explique stockage local et transmission pertinente", () => {
  assert.match(html, /Stockée localement/);
  assert.match(html, /seules les informations pertinentes peuvent être incluses/);
  assert.match(html, /fournisseur d’IA/);
});
