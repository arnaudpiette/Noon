"use strict";

// V3-L2a — capture rapide : repérage de « note ça », enregistrement local dans la boîte de
// réception, fenêtre de capture, câblage serveur / chat / Electron.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { createPersonalDatabase } = require("../services/persistence/database");
const { createPersonalIntelligenceRepository } = require("../services/persistence/repositories/personal-intelligence-repository");
const { createInboxService } = require("../services/personal-intelligence/inbox-service");
const { MAX_TEXT, createQuickCaptureService } = require("../services/capture/quick-capture-service");
const { parseCaptureCommand } = require("../public/ui-utils");

const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", ...parts), "utf8");

test("repérage : formulations de capture reconnues, demandes normales laissées au modèle", () => {
  const cases = {
    "Noon, note ça : acheter du pain": "acheter du pain",
    "noon note ça appeler Paul demain": "appeler Paul demain",
    "note : idée de logo en spirale": "idée de logo en spirale",
    "Note que la réunion est jeudi.": "la réunion est jeudi",
    "note-moi relancer l'agence": "relancer l'agence",
    "Salut Noon, note ça: test": "test",
    "Note ça :\nligne 1\nligne 2": "ligne 1\nligne 2",
  };
  for (const [input, text] of Object.entries(cases)) assert.deepEqual(parseCaptureCommand(input), { text }, input);
  for (const input of ["Note ce texte de 1 à 10", "note ça sur 10 : mon logo", "Peux-tu noter ça", "notes de réunion", "Quelle note pour ce logo ?", "note ça", "", null]) {
    assert.equal(parseCaptureCommand(input), null, String(input));
  }
});

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "noon-capture-"));
  const repository = createPersonalIntelligenceRepository(createPersonalDatabase(path.join(dir, "p.sqlite")));
  const inbox = createInboxService(repository);
  let clock = Date.parse("2026-11-22T09:00:00Z");
  return { inbox, service: createQuickCaptureService({ inboxService: inbox, now: () => new Date(clock += 1000) }) };
}

test("service : note enregistrée localement dans la boîte de réception, bornée, sans doublon d'identifiant", () => {
  const { inbox, service } = setup();
  const first = service.capture({ text: "  acheter   du pain  ", origin: "chat" });
  assert.equal(first.text, "acheter du pain");
  const second = service.capture({ text: "relancer l'agence", origin: "shortcut" });
  assert.notEqual(first.id, second.id);
  const items = inbox.list({}).filter((item) => item.sourceType === "manual_capture");
  assert.equal(items.length, 2);
  assert.equal(items.find((item) => item.id === first.id).status, "detected");
  assert.match(items.find((item) => item.id === first.id).requiredContext, /Capturé via chat/);
  const recent = service.recent(5);
  assert.equal(recent.length, 2);
  assert.ok(recent.every((item) => typeof item.text === "string"));
  assert.ok(inbox.toPriorityActions().some((action) => action.title === "acheter du pain"), "la note remonte dans les priorités du Brief");
  for (const [input, code] of [[{ text: "   " }, "CAPTURE_EMPTY"], [{ text: "x".repeat(MAX_TEXT + 1) }, "CAPTURE_TOO_LONG"], [{ text: "ok", origin: "email" }, "CAPTURE_ORIGIN_INVALID"]]) {
    assert.throws(() => service.capture(input), { code });
  }
});

class FakeElement {
  constructor(tag) { this.tagName = tag; this.value = ""; this.disabled = false; this.textContent = ""; this.dataset = {}; this.listeners = {}; }
  addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
  dispatch(type, event = {}) { for (const handler of this.listeners[type] || []) handler({ preventDefault() {}, ...event }); }
  focus() {}
}

function loadCapture(reply) {
  const context = { Promise, Object, JSON, Error, String };
  context.window = context;
  vm.runInNewContext(read("public", "capture.js"), context);
  const form = new FakeElement("form"); const input = new FakeElement("input"); const status = new FakeElement("p");
  const calls = []; let closed = 0; const timers = [];
  context.window.NoonCapture.createCaptureController({
    form, input, status, closeWindow: () => { closed += 1; }, setTimer: (fn) => timers.push(fn),
    fetchImpl: async (url, options) => { calls.push({ url, options }); return reply.ok ? { ok: true, json: async () => ({ status: "ok" }) } : { ok: false, json: async () => ({ message: "Note trop longue." }) }; },
  });
  return { form, input, status, calls, timers, closed: () => closed };
}

test("fenêtre de capture : Entrée enregistre puis ferme, Échap ferme, erreur affichée sans fermer", async () => {
  const ok = loadCapture({ ok: true });
  ok.input.value = "idée de logo";
  ok.form.dispatch("submit");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ok.calls[0].url, "/capture");
  assert.equal(ok.calls[0].options.headers["X-Noon-Request"], "1");
  assert.deepEqual(JSON.parse(ok.calls[0].options.body), { text: "idée de logo", origin: "shortcut" });
  assert.equal(ok.status.textContent, "Noté.");
  ok.timers[0](); assert.equal(ok.closed(), 1);
  ok.input.dispatch("keydown", { key: "Escape" }); assert.equal(ok.closed(), 2);

  const empty = loadCapture({ ok: true });
  empty.form.dispatch("submit");
  assert.equal(empty.calls.length, 0, "rien n'est envoyé pour une note vide");

  const failing = loadCapture({ ok: false });
  failing.input.value = "x";
  failing.form.dispatch("submit");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(failing.status.textContent, "Note trop longue.");
  assert.equal(failing.status.dataset.kind, "error");
  assert.equal(failing.timers.length, 0);
});

test("câblage : routes serveur bornées, chat sans appel au modèle, raccourci et barre de menus Electron", () => {
  const server = read("server.js");
  assert.match(server, /req\.method === "POST" && req\.url === "\/capture"[\s\S]{0,200}x-noon-request/);
  assert.match(server, /\["\/capture", "\/capture\.js", "\/capture\.css"\]/);
  assert.match(server, /form-action 'none'/);
  const app = read("public", "app.js");
  const captureIndex = app.indexOf("const captureCommand = filesToSend.length === 0 ? parseCaptureCommand(question) : null;");
  assert.ok(captureIndex > 0 && captureIndex < app.indexOf('const response = await fetch("/ai/stream"'), "la capture est traitée avant tout appel au modèle");
  assert.match(app, /body: JSON\.stringify\(\{ text, origin: "chat" \}\)/);
  const main = read("electron", "main.js");
  assert.match(main, /const DEFAULT_CAPTURE_SHORTCUT = "Control\+Option\+C";/);
  assert.match(main, /capture: register\(preferences\.captureShortcut, showCaptureWindow\)/);
  assert.match(main, /\{ label: "Noter…", click: showCaptureWindow \}/);
  const windowBlock = main.slice(main.indexOf("function showCaptureWindow()"), main.indexOf("function createTray()"));
  assert.match(windowBlock, /sandbox: true/);
  assert.match(windowBlock, /nodeIntegration: false/);
  assert.doesNotMatch(windowBlock, /preload/);
  assert.match(windowBlock, /will-navigate", \(event\) => event\.preventDefault\(\)/);
  assert.equal(/innerHTML/.test(read("public", "capture.js")), false);
});
