"use strict";

// Recorder V1 (V3-L8) : panneau et voyant, sans navigateur (vm + faux DOM, faux micro).

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const PUBLIC = path.join(__dirname, "..", "public");
const SOURCE = fs.readFileSync(path.join(PUBLIC, "recorder-ui.js"), "utf8");

class FakeElement {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.hidden = false; this.disabled = false; this.checked = false; this.value = ""; this.className = ""; this.dataset = {}; this.listeners = {}; this.attributes = {}; this.ownText = ""; }
  get textContent() { return this.ownText + this.children.map((child) => child.textContent).join(""); }
  set textContent(value) { this.children = []; this.ownText = String(value); }
  set innerHTML(_) { throw new Error("innerHTML interdit"); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = [...nodes]; this.ownText = ""; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
  dispatch(type) { for (const handler of this.listeners[type] || []) handler({ target: this }); }
  click() { this.dispatch("click"); }
}
const all = (node) => node.children.flatMap((child) => [child, ...all(child)]);
const buttonByText = (root, text) => all(root).find((node) => node.tagName === "BUTTON" && node.textContent === text);
const checkboxes = (root) => all(root).filter((node) => node.tagName === "INPUT" && node.type === "checkbox");
const settle = async () => { for (let index = 0; index < 12; index += 1) await new Promise((resolve) => setImmediate(resolve)); };

class FakeMediaRecorder {
  static isTypeSupported(type) { return type === "audio/webm;codecs=opus"; }
  constructor(stream, options) { this.stream = stream; this.options = options; this.state = "inactive"; this.listeners = {}; FakeMediaRecorder.last = this; }
  addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
  emit(type, event = {}) { for (const handler of this.listeners[type] || []) handler(event); }
  start(timeslice) { this.timeslice = timeslice; this.state = "recording"; }
  pause() { this.state = "paused"; }
  resume() { this.state = "recording"; }
  requestData() {}
  stop() { this.emit("dataavailable", { data: { size: 3, label: "final" } }); this.state = "inactive"; this.emit("stop"); }
}

function harness({ micError = null, chunkFailures = 0 } = {}) {
  const document = { createElement: (tag) => new FakeElement(tag) };
  const context = { document, Promise, Object, String, Array, Number, Math, Date, JSON, Error, TypeError, setInterval: () => 1, clearInterval: () => {} };
  context.window = context;
  vm.runInNewContext(SOURCE, context);
  const ui = context.window.NoonRecorderUi;
  const calls = [];
  let sessions = [];
  let failuresLeft = chunkFailures;
  const tracks = [{ stopped: false, stop() { this.stopped = true; } }];
  const api = {
    list: async () => ({ sessions }),
    create: async (input) => { calls.push(["create", input]); const session = { id: "rec-20261125-0a1b2c3d", title: input.title || "Enregistrement", status: "recording", bytes: 0, durationMs: 0, createdAt: "2026-11-25T10:00:00Z" }; sessions = [session]; return { session }; },
    chunk: async (id, seq, blob) => { if (failuresLeft > 0) { failuresLeft -= 1; throw Object.assign(new Error("x"), { code: "RECORDER_SEQ_GAP" }); } calls.push(["chunk", seq, blob.label]); return {}; },
    pause: async () => { calls.push(["pause"]); return {}; },
    resume: async () => { calls.push(["resume"]); return {}; },
    stop: async () => { calls.push(["stop"]); sessions = [{ ...sessions[0], status: "stopped", bytes: 9 }]; return {}; },
    remove: async () => ({}),
    audioUrl: (id) => `/api/recorder/sessions/${id}/audio`,
  };
  const media = { getUserMedia: async (constraints) => { calls.push(["mic", constraints]); if (micError) throw Object.assign(new Error("mic"), { name: micError }); return { getTracks: () => tracks }; } };
  const root = new FakeElement("section"); root.ownerDocument = document;
  const indicator = new FakeElement("div");
  let clock = 0;
  const controller = ui.createRecorderController({ elements: { root, indicator }, api, media, MediaRecorderImpl: FakeMediaRecorder, getAudioConstraints: () => ({ deviceId: { exact: "micro-usb" } }), confirmImpl: () => true, now: () => clock });
  return { ui, controller, root, indicator, calls, tracks, tick: (ms) => { clock += ms; } };
}

test("démarrer : micro choisi respecté, morceaux toutes les 5 s envoyés dans l'ordre, voyant visible", async () => {
  const h = harness();
  assert.equal(await h.controller.init(), true);
  assert.equal(h.indicator.hidden, true);
  buttonByText(h.root, "Démarrer l'enregistrement").click();
  await settle();
  assert.equal(JSON.stringify(h.calls[0]), JSON.stringify(["mic", { audio: { deviceId: { exact: "micro-usb" } }, video: false }]));
  assert.equal(h.calls[1][0], "create");
  assert.equal(h.calls[1][1].mimeType, "audio/webm;codecs=opus");
  assert.equal(FakeMediaRecorder.last.timeslice, 5000);
  FakeMediaRecorder.last.emit("dataavailable", { data: { size: 10, label: "a" } });
  FakeMediaRecorder.last.emit("dataavailable", { data: { size: 0, label: "vide" } });
  FakeMediaRecorder.last.emit("dataavailable", { data: { size: 10, label: "b" } });
  await settle();
  assert.deepEqual(h.calls.filter(([kind]) => kind === "chunk"), [["chunk", 0, "a"], ["chunk", 1, "b"]], "morceau vide ignoré, ordre conservé");
  h.tick(65_000); h.controller.render();
  assert.equal(h.indicator.hidden, false);
  assert.match(h.indicator.textContent, /Enregistrement · 01:05/);
});

test("pause, reprise puis arrêt : le dernier morceau part avant l'arrêt, le micro est libéré", async () => {
  const h = harness();
  await h.controller.init();
  await h.controller.start();
  h.tick(10_000);
  await h.controller.togglePause();
  assert.match(h.indicator.textContent, /En pause · 00:10/);
  h.tick(50_000);
  h.controller.render();
  assert.match(h.indicator.textContent, /En pause · 00:10/, "la pause ne fait pas avancer le compteur");
  await h.controller.togglePause();
  h.tick(5_000);
  await h.controller.stop();
  const kinds = h.calls.map(([kind]) => kind);
  assert.deepEqual(kinds.slice(-4), ["pause", "resume", "chunk", "stop"], "le morceau final est sauvegardé avant l'arrêt");
  assert.equal(h.tracks[0].stopped, true);
  assert.equal(h.indicator.hidden, true);
  assert.match(h.root.textContent, /enregistré \(00:15\)/);
  assert.equal(all(h.root).some((node) => node.tagName === "AUDIO"), true, "l'enregistrement terminé se réécoute");
});

test("à plusieurs, le bouton reste inactif tant que les participants ne sont pas prévenus", async () => {
  const h = harness();
  await h.controller.init();
  const [multi] = checkboxes(h.root);
  multi.checked = true; multi.dispatch("change");
  assert.match(h.root.textContent, /préviens chaque participant et obtiens son accord/);
  assert.equal(buttonByText(h.root, "Démarrer l'enregistrement").disabled, true);
  const informed = checkboxes(h.root)[1];
  informed.checked = true; informed.dispatch("change");
  const start = buttonByText(h.root, "Démarrer l'enregistrement");
  assert.equal(start.disabled, false);
  start.click();
  await settle();
  const create = h.calls.find(([kind]) => kind === "create")[1];
  assert.equal(create.multiParticipant, true);
  assert.equal(create.participantsInformed, true);
});

test("micro refusé ou absent : message clair, aucune session créée", async () => {
  for (const [name, text] of [["NotAllowedError", /Autorisation du micro refusée/], ["NotFoundError", /n'en choisit pas un autre/]]) {
    const h = harness({ micError: name });
    await h.controller.init();
    await h.controller.start();
    assert.match(h.root.textContent, text);
    assert.equal(h.calls.some(([kind]) => kind === "create"), false);
  }
});

test("échec de sauvegarde répété : l'enregistrement s'arrête proprement avec un message honnête", async () => {
  const h = harness({ chunkFailures: 2 });
  await h.controller.init();
  await h.controller.start();
  FakeMediaRecorder.last.emit("dataavailable", { data: { size: 10, label: "a" } });
  await settle();
  assert.match(h.root.textContent, /Sauvegarde interrompue/);
  assert.equal(h.calls.some(([kind]) => kind === "stop"), true);
  assert.equal(h.indicator.hidden, true);
});

test("câblage : script servi et chargé avant app.js, entrée « Enregistreur » dans Aujourd'hui, voyant dans la barre", () => {
  const html = fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8");
  assert.ok(html.indexOf('<script src="recorder-ui.js"></script>') < html.indexOf('<script src="app.js"></script>'));
  assert.match(html, /<header class="top-tools">[\s\S]*id="recorderIndicator"[\s\S]*<\/header>/);
  assert.match(html, /id="controlCenterRecorder"[^>]*hidden><section id="recorderPanel"/);
  const assets = fs.readFileSync(path.join(__dirname, "..", "services", "http", "static-assets.js"), "utf8");
  assert.match(assets, /"\/recorder-ui\.js": \{ file: \["recorder-ui\.js"\]/);
  const cc = fs.readFileSync(path.join(PUBLIC, "control-center.js"), "utf8");
  assert.match(cc, /sections: \["overview", "approvals", RECORDER_SECTION,/);
  assert.doesNotMatch(SOURCE, /innerHTML|localStorage|fetch\(\s*["']https?:/);
});
