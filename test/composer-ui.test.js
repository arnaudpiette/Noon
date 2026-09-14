"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const publicDirectory = path.join(__dirname, "..", "public");
const html = fs.readFileSync(path.join(publicDirectory, "index.html"), "utf8");
const css = fs.readFileSync(path.join(publicDirectory, "style.css"), "utf8");
const app = fs.readFileSync(path.join(publicDirectory, "app.js"), "utf8");

test("le composeur conserve les actions dans sa barre interne", () => {
  const shell = html.match(/<form id="chatForm"[\s\S]*?<\/form>/)?.[0] || "";
  const actionIds = [
    "composerMenuButton",
    "liveVoiceQuality",
    "micButton",
    "sendButton",
  ];

  assert.ok(shell);
  for (const id of actionIds) assert.match(shell, new RegExp(`id="${id}"`));
  assert.ok(actionIds.every((id, index) => index === 0 || shell.indexOf(id) > shell.indexOf(actionIds[index - 1])));
});

test("le champ multiligne propose un agrandissement accessible", () => {
  assert.match(html, /id="expandPromptButton"[^>]*type="button"[^>]*aria-pressed="false"[^>]*hidden/);
  assert.doesNotMatch(html.match(/<textarea id="prompt"[^>]*>/)?.[0] || "", /maxlength/i);
  assert.match(css, /\.input-shell\.is-multiline/);
  assert.match(css, /"prompt prompt prompt prompt expand"/);
  assert.match(app, /composerDropZone\.classList\.toggle\("is-multiline", hasMultipleLines\)/);
  assert.match(app, /expandPromptButton\.addEventListener\("click"/);
});

test("le composeur utilise le nouveau placeholder et une typographie regular", () => {
  assert.match(html, /placeholder="Demande-moi n'importe quoi et abracadabra\.\.\."/);
  assert.match(css, /\.input-shell > #prompt\{[^}]*font-weight:400/);
  assert.match(css, /\.input-shell > #prompt::placeholder\{font-weight:400\}/);
  assert.match(css, /\.input-shell > \.send-btn\{[^}]*background:#2f7df6/);
  assert.match(css, /\.composer > \.microphone-btn,[^{]*\{[^}]*color:#2f7df6/);
});
