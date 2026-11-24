"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const publicDirectory = path.join(__dirname, "..", "public");
const html = fs.readFileSync(path.join(publicDirectory, "index.html"), "utf8");
const css = fs.readFileSync(path.join(publicDirectory, "style.css"), "utf8");

test("les déclencheurs supérieurs référencent leurs panneaux", () => {
  assert.match(html, /id="settingsButton"[^>]*aria-controls="quickSettings"/);
  assert.match(html, /id="shareConversationButton"[^>]*aria-controls="shareConversationMenu"[^>]*aria-haspopup="menu"/);
  assert.match(html, /id="systemStatusButton"[^>]*aria-controls="controlCenter"[^>]*aria-haspopup="dialog"/);
});

// Interface V3, étape 1 : les réglages ne sont plus un menu déroulant mais l'onglet « Réglages »
// du Control Center ; seul le menu de partage garde la surface de menu.
test("les menus supérieurs partagent la surface Noon", () => {
  assert.doesNotMatch(html, /id="quickSettings"[^>]*noon-menu-panel/);
  assert.match(html, /id="shareConversationMenu"[^>]*noon-menu-panel/);
  assert.match(css, /--noon-menu-surface:/);
  assert.match(css, /\.noon-menu-panel\{[^}]*var\(--noon-menu-border\)[^}]*var\(--noon-menu-surface\)[^}]*var\(--noon-menu-shadow\)/);
});

test("le picto de la barre ouvre directement le Control Center sur l'onglet Réglages", () => {
  const { readAppSource } = require("./helpers/app-source");
  const app = readAppSource();
  const controlCenter = fs.readFileSync(path.join(publicDirectory, "control-center.js"), "utf8");
  assert.match(html, /id="settingsButton"[^>]*aria-label="Ouvrir le Control Center"[^>]*aria-haspopup="dialog"/);
  assert.match(html, /<div id="controlCenterSettings"[^>]*hidden>\s*<div id="quickSettings" class="quick-settings settings-page"/);
  assert.match(app, /settingsButton\.addEventListener\("click"[\s\S]{0,200}NoonControlCenter\?\.open\?\.\("settings"\)/);
  assert.match(controlCenter, /\[SETTINGS_SECTION\]: "Réglages"/);
  assert.doesNotMatch(html, /id="openControlCenterButton"/);
});

test("les pictos utilisent un seul jeu au trait", () => {
  for (const name of ["sliders", "share", "panel", "close", "refresh", "plus", "arrow-up", "mic"]) assert.match(html, new RegExp(`<symbol id="noon-i-${name}" viewBox="0 0 24 24">`));
  assert.match(css, /\.noon-icon\{[^}]*fill:none;stroke:currentColor;stroke-width:1\.6;stroke-linecap:round;stroke-linejoin:round\}/);
  assert.doesNotMatch(html, /class="gear-icon"|class="share-icon"/);
});

test("le menu de partage conserve une sémantique clavier", () => {
  assert.match(html, /id="shareConversationMenu"[^>]*role="menu"/);
  assert.equal((html.match(/role="menuitem"/g) || []).length, 3);
  assert.match(css, /\.share-conversation-menu button:focus-visible/);
});
