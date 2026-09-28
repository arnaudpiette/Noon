"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync(require.resolve("../public/index.html"), "utf8");
const css = fs.readFileSync(require.resolve("../public/style.css"), "utf8");
const app = fs.readFileSync(require.resolve("../public/app.js"), "utf8");

test("le Brief V2 expose sa structure et ses diagnostics secondaires", () => {
  assert.match(html, /id="briefStructuredContent"/);
  assert.match(html, /class="brief-diagnostics"/);
  assert.match(html, /Détails &amp; sources/);
  assert.match(html, /Synthèse Noon/);
});

test("les états READY PARTIAL GENERATING FAILED sont stylés", () => {
  for (const state of ["READY", "PARTIAL", "GENERATING", "FAILED"]) {
    assert.match(css, new RegExp(`data-state="${state}"`));
  }
});

test("la lecture vocale continue de lire la synthèse complète", () => {
  assert.match(
    app,
    /const combinedBrief = personalBriefContent\.textContent/
  );
  assert.match(
    app,
    /speakNoon\(\s*prepareTextForSpeech\(\s*combinedBrief/
  );
});

test("le renderer structuré et la synthèse restent deux couches séparées", () => {
  assert.match(
    app,
    /renderDailyBriefStructured\(briefStructuredContent, brief\)/
  );
  assert.match(
    app,
    /renderBriefMarkdown\(personalBriefContent, brief\?\.content/
  );
});


test("les contrôles vocaux exposent un état visuel de lecture actif", () => {
  assert.match(app, /readBriefButton\.dataset\.reading = "true"/);
  assert.match(app, /readBriefButton\.setAttribute\("aria-pressed", "true"\)/);
  assert.match(app, /readBriefButton\.dataset\.reading = "false"/);
  assert.match(
    fs.readFileSync(require.resolve("../public/style.css"), "utf8"),
    /#readBriefButton\[data-reading="true"\]/
  );
});
