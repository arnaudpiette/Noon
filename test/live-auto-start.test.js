"use strict";

// Conversation Live à l'ouverture de Noon : réglage activé par défaut, phrase d'Arnaud mot pour mot,
// jamais hors de l'app, jamais deux fois par lancement, jamais budget bloqué ni en Qualité Max.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { LAUNCH_GREETING, launchGreetingEvent, liveAutoStartEnabled, shouldAutoStartLive } = require("../public/live-voice-core");

const PUBLIC = path.join(__dirname, "..", "public");

test("la phrase d'ouverture est celle d'Arnaud, envoyée telle quelle au modèle vocal", () => {
  assert.equal(LAUNCH_GREETING, "Salut Noon, par quoi on commence aujourd’hui ?");
  const event = launchGreetingEvent();
  assert.equal(event.type, "response.create");
  assert.ok(event.response.instructions.includes(`« ${LAUNCH_GREETING} »`));
  assert.match(event.response.instructions, /sans rien ajouter ni retirer/);
});

test("réglage activé par défaut, désactivable", () => {
  assert.equal(liveAutoStartEnabled(null), true);
  assert.equal(liveAutoStartEnabled("on"), true);
  assert.equal(liveAutoStartEnabled("off"), false);
});

test("démarrage seulement dans l'app, une fois, budget disponible, hors Qualité Max", () => {
  const base = { desktopApp: true, enabled: true, alreadyStarted: false, budgetState: "OK", quality: "mini" };
  assert.deepEqual(shouldAutoStartLive(base), { start: true, reason: "AUTO_START" });
  assert.equal(shouldAutoStartLive({ ...base, desktopApp: false }).reason, "NOT_DESKTOP_APP");
  assert.equal(shouldAutoStartLive({ ...base, enabled: false }).reason, "DISABLED");
  assert.equal(shouldAutoStartLive({ ...base, alreadyStarted: true }).reason, "ALREADY_STARTED");
  assert.equal(shouldAutoStartLive({ ...base, budgetState: "BLOCKED" }).reason, "BUDGET_BLOCKED");
  assert.equal(shouldAutoStartLive({ ...base, budgetState: "blocked" }).reason, "BUDGET_BLOCKED");
  assert.equal(shouldAutoStartLive({ ...base, quality: "max" }).reason, "MAX_QUALITY");
  assert.equal(shouldAutoStartLive({ ...base, budgetState: null }).start, true, "budget illisible : le serveur refusera s'il est bloqué");
  assert.equal(shouldAutoStartLive().start, false, "par défaut, aucun micro ouvert hors de l'app");
});

test("câblage : interrupteur dans Voix et audio, accueil seulement pour la session de lancement, réveil du Mac exclu", () => {
  const html = fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8");
  const voice = html.match(/<fieldset class="voice-settings">[\s\S]*?<\/fieldset>/)?.[0] || "";
  assert.match(voice, /<input id="liveAutoStart" type="checkbox"/);
  assert.match(voice, /Salut Noon, par quoi on commence aujourd’hui \?/);
  const live = fs.readFileSync(path.join(PUBLIC, "live-voice.js"), "utf8");
  assert.match(live, /if \(this\.pendingLaunchGreeting\) \{\s*this\.pendingLaunchGreeting = false;\s*this\.send\(core\.launchGreetingEvent\(\)\);/);
  assert.match(live, /live\.pendingLaunchGreeting = true;\s*await live\.connect\(\);/);
  assert.match(live, /sessionStorage\.setItem\(AUTO_START_SESSION_FLAG, "1"\)/);
  const resume = live.match(/if \(state === "resume"\) \{[\s\S]*?\}/)?.[0] || "";
  assert.doesNotMatch(resume, /connect\(/, "le réveil du Mac ne rouvre jamais le micro");
  // L'écoute « Salut Noon » est coupée pendant Live : Noon ne se réveille pas en s'entendant.
  const main = fs.readFileSync(path.join(__dirname, "..", "electron", "main.js"), "utf8");
  assert.match(main, /if \(!preferences\.wakeWordEnabled \|\| liveVoiceActive\) \{\s*await wakeWordService\.stop\(\);/);
});
