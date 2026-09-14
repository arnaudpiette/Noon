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

test("les menus supérieurs partagent la surface Noon", () => {
  assert.match(html, /id="quickSettings"[^>]*noon-menu-panel/);
  assert.match(html, /id="shareConversationMenu"[^>]*noon-menu-panel/);
  assert.match(css, /--noon-menu-surface:/);
  assert.match(css, /\.noon-menu-panel\{[^}]*var\(--noon-menu-border\)[^}]*var\(--noon-menu-surface\)[^}]*var\(--noon-menu-shadow\)/);
});

test("le menu de partage conserve une sémantique clavier", () => {
  assert.match(html, /id="shareConversationMenu"[^>]*role="menu"/);
  assert.equal((html.match(/role="menuitem"/g) || []).length, 3);
  assert.match(css, /\.share-conversation-menu button:focus-visible/);
});
