"use strict";

// Langue et accent de Conversation Live : visibles dans Réglages → Voix et audio (mêmes
// identifiants que les anciens champs cachés), toujours réglables à la voix.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { normalizeLanguage } = require("../lib/voice-utils");

const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
const live = fs.readFileSync(path.join(__dirname, "..", "public", "live-voice.js"), "utf8");

test("les réglages sont visibles dans Voix et audio, une seule fois, plus jamais cachés", () => {
  const voice = html.match(/<fieldset class="voice-settings">[\s\S]*?<\/fieldset>/)?.[0] || "";
  assert.match(voice, /<select id="liveVoiceLanguage">/);
  assert.match(voice, /<input id="liveVoiceAccent" type="text" maxlength="60"/);
  assert.equal(html.split('id="liveVoiceLanguage"').length - 1, 1);
  assert.equal(html.split('id="liveVoiceAccent"').length - 1, 1);
  assert.doesNotMatch(html, /id="liveVoice(Language|Accent)" type="hidden"/);
});

test("chaque langue proposée est une langue reconnue par le serveur, Automatique compris", () => {
  const select = html.match(/<select id="liveVoiceLanguage">[\s\S]*?<\/select>/)?.[0] || "";
  const values = [...select.matchAll(/<option value="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(values[0], "auto");
  assert.equal(values.length, 10);
  for (const value of values) assert.equal(normalizeLanguage(value, "INCONNUE"), value, value);
});

test("« aucun accent » s'affiche vide ; une langue enregistrée inconnue revient à Automatique", () => {
  assert.match(live, /elements\.accent\.value = savedAccent === "none" \? "" : savedAccent;/);
  assert.match(live, /if \(elements\.language\.value !== \(localStorage\.getItem\(STORAGE\.language\) \|\| "auto"\)\) elements\.language\.value = "auto";/);
  // Le réglage oral met à jour les mêmes champs.
  assert.match(live, /if \(action\.type === "setVoiceStyle"\) \{\s*elements\.language\.value = action\.language;/);
});
