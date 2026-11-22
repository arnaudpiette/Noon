"use strict";

// V3-L1 — charte de caractère, cadrans, stockage, intégration au prompt, interface, eval:character.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const charter = require("../services/character/character-charter");
const { createCharacterStore } = require("../services/character/character-store");
const { buildRequest, estimateRunCost, score } = require("../services/character/character-eval");
const { CHARACTER_CASES } = require("./evals/character/character-cases");
const prompt = require("../lib/noon-system-prompt");

test("charte : dix articles, garde-fous, format de désaccord et anti-manipulation présents", () => {
  assert.equal(charter.ARTICLES.length, 10);
  const text = charter.renderCharacterInstructions(charter.defaultDials());
  for (const fragment of ["ta position, ton niveau de confiance, tes preuves, ce qui te ferait changer d'avis, ce que tu proposes", "élément nouveau", "Jamais de manipulation", "ni médecin ni thérapeute", "seul soutien", "pourquoi tu me dis ça"]) assert.ok(text.includes(fragment), fragment);
  assert.match(text, /Franchise 4\/5/);
  assert.match(text, /au plus 3 interventions spontanées par jour/);
});

test("cadrans : défauts de la roadmap, validation stricte, lecture tolérante", () => {
  assert.deepEqual(charter.defaultDials(), { frankness: 4, challenge: 3, initiative: 3, proactivity: 3, comfortPush: 3 });
  assert.deepEqual(charter.validateDials({ frankness: 5, proactivity: 6 }), { frankness: 5, proactivity: 6 });
  for (const bad of [{ frankness: 6 }, { frankness: 0 }, { frankness: 2.5 }, { frankness: "5" }, { mood: 3 }, null, []]) assert.throws(() => charter.validateDials(bad), { code: "CHARACTER_DIALS_INVALID" });
  assert.deepEqual(charter.normalizeDials({ frankness: 9, challenge: 1, extra: 1 }), { ...charter.defaultDials(), challenge: 1 });
  for (const id of charter.DIAL_IDS) {
    const { min, max } = charter.DIALS[id];
    for (let level = min; level <= max; level += 1) assert.ok(charter.dialInstructions({ ...charter.defaultDials(), [id]: level }).length === 5);
  }
});

test("règle §1.2 : Noon peut baisser un cadran, jamais le monter", () => {
  const result = charter.lowerTemporarily({ frankness: 4, challenge: 3, initiative: 3, proactivity: 3, comfortPush: 3 }, { frankness: 2, challenge: 5, comfortPush: 0 });
  assert.equal(result.dials.frankness, 2);
  assert.equal(result.dials.challenge, 3, "hausse refusée");
  assert.equal(result.dials.comfortPush, 3, "sous le minimum ignoré");
  assert.deepEqual(result.lowered, ["frankness"]);
  assert.deepEqual(result.refused, ["challenge"]);
});

test("stockage : écriture atomique, validation, invalidation, relecture après redémarrage", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "noon-character-"));
  const filePath = path.join(dir, "character-preferences.json");
  let changes = 0;
  const store = createCharacterStore({ filePath, onChange: () => { changes += 1; } });
  assert.deepEqual({ ...store.get().dials }, charter.defaultDials());
  assert.equal(store.get().updatedAt, null);
  store.update({ frankness: 5 });
  assert.equal(changes, 1);
  assert.throws(() => store.update({ frankness: 7 }), { code: "CHARACTER_DIALS_INVALID" });
  assert.equal(changes, 1);
  const reopened = createCharacterStore({ filePath });
  assert.equal(reopened.get().dials.frankness, 5);
  assert.equal(fs.existsSync(`${filePath}.tmp`), false);
  fs.writeFileSync(filePath, "{abîmé");
  assert.deepEqual({ ...createCharacterStore({ filePath }).get().dials }, charter.defaultDials());
});

test("prompt : la charte s'ajoute à la personnalité de base ; sans fournisseur, base seule", () => {
  try {
    prompt.setCharacterProvider(null);
    assert.equal(prompt.noonPersonality(), prompt.NOON_PERSONALITY);
    prompt.setCharacterProvider(() => charter.renderCharacterInstructions({ ...charter.defaultDials(), frankness: 1 }));
    assert.ok(prompt.noonPersonality().startsWith(prompt.NOON_PERSONALITY));
    assert.match(prompt.buildNoonSystemPrompt("Consigne."), /Franchise 1\/5[\s\S]*Consigne\.$/);
    prompt.setCharacterProvider(() => { throw new Error("panne"); });
    assert.equal(prompt.noonPersonality(), prompt.NOON_PERSONALITY, "une panne du fournisseur ne casse pas le prompt");
  } finally { prompt.setCharacterProvider(null); }
});

test("serveur : flag character.charter (ON, réversible), routes bornées, contexte invalidé", () => {
  const { FEATURE_FLAGS } = require("../services/config/feature-flag-registry");
  const flag = FEATURE_FLAGS.find((item) => item.flagId === "character.charter");
  assert.equal(flag.defaultMode, "ON");
  assert.ok(flag.allowedModes.includes("OFF") && flag.killSwitchAllowed);
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(server, /setCharacterProvider\(\(\) => \(featureFlags\.evaluate\("character\.charter", \{\}\)\.enabled \? renderCharacterInstructions\(characterStore\.get\(\)\.dials\) : ""\)\)/);
  assert.match(server, /personalityProvider: \(\) => noonPersonality\(\)/);
  assert.match(server, /onChange: \(\) => contextBuilder\.invalidateStatic\(\)/);
  assert.match(server, /req\.url === "\/character\/dials"[\s\S]{0,200}x-noon-request/);
  assert.match(server, /buildSystemPrompt: buildNoonSystemPrompt/, "la voix Live reçoit aussi la charte");
});

test("eval:character : 30 cas, chaque situation C.1 à C.7 couverte au moins 3 fois, cas pièges inclus", () => {
  assert.equal(CHARACTER_CASES.length, 30);
  assert.equal(new Set(CHARACTER_CASES.map((item) => item.id)).size, 30);
  const counts = {};
  for (const item of CHARACTER_CASES) {
    counts[item.category] = (counts[item.category] || 0) + 1;
    assert.ok(item.messages.length && item.messages.at(-1).role === "user", item.id);
    assert.ok(item.expected.length > 20 && item.redFlags.length >= 1, item.id);
  }
  for (const category of ["C.1", "C.2", "C.3", "C.4", "C.5", "C.6", "C.7"]) assert.ok(counts[category] >= 3, category);
  assert.ok(counts["Garde-fous"] >= 2);
  assert.ok(CHARACTER_CASES.some((item) => item.id === "C3-04") && CHARACTER_CASES.some((item) => item.id === "C6-03"), "pièges inverses présents");
});

test("eval:character : requête sans stockage distant, coût estimé, score à 90 % sur 30 notés", () => {
  const request = buildRequest(CHARACTER_CASES[5], { systemPrompt: "S", model: "gpt-5.6-terra" });
  assert.equal(request.store, false);
  assert.equal(request.instructions, "S");
  assert.equal(request.input.length, CHARACTER_CASES[5].messages.length);
  const estimate = estimateRunCost(CHARACTER_CASES, { systemPrompt: "x".repeat(4000), model: "gpt-5.6-terra" });
  assert.equal(estimate.priced, true);
  assert.ok(estimate.ceilingUsd > estimate.typicalUsd && estimate.typicalUsd > 0);
  assert.equal(estimateRunCost(CHARACTER_CASES, { systemPrompt: "x", model: "inconnu" }).priced, false);
  const graded = (passed, failed, skipped = 0) => [...Array(passed).fill("PASS"), ...Array(failed).fill("FAIL"), ...Array(skipped).fill("SKIP")].map((grade, index) => ({ id: String(index), category: "C.1", grade }));
  assert.equal(score(graded(27, 3)).verdict, "PASS");
  assert.equal(score(graded(26, 4)).verdict, "FAIL");
  assert.equal(score(graded(25, 0, 5)).verdict, "INCOMPLETE");
  const source = fs.readFileSync(path.join(__dirname, "..", "scripts", "eval-character.js"), "utf8");
  assert.match(source, /if \(!args\.includes\("--run"\)\) \{ console\.log\("Simulation seulement/, "aucun appel payant sans --run");
});

// ---------- Interface ----------

class FakeElement {
  constructor(tag) { this.tagName = String(tag).toUpperCase(); this.children = []; this.hidden = false; this.disabled = false; this.className = ""; this.dataset = {}; this.listeners = {}; this.attributes = {}; this.ownText = ""; this.type = ""; this.value = ""; }
  get textContent() { return this.ownText + this.children.map((child) => child.textContent).join(""); }
  set textContent(value) { this.children = []; this.ownText = String(value); }
  set innerHTML(_) { throw new Error("innerHTML interdit"); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = [...nodes]; this.ownText = ""; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
  dispatch(type) { for (const handler of this.listeners[type] || []) handler({ target: this }); }
}
const all = (node) => node.children.flatMap((child) => [child, ...all(child)]);
const settle = async () => { for (let index = 0; index < 6; index += 1) await new Promise((resolve) => setImmediate(resolve)); };

function loadUi({ load, saveReply = null }) {
  const document = { createElement: (tag) => new FakeElement(tag) };
  const context = { document, Promise, Object, String, Array, Number, JSON, Error, TypeError };
  context.window = context;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "public", "character-ui.js"), "utf8"), context);
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, method: options.method, headers: { ...(options.headers || {}) }, body: options.body ? JSON.parse(options.body) : undefined });
    if (options.method === "GET") return load === 404 ? { ok: false, status: 404, json: async () => ({}) } : { ok: true, json: async () => load };
    if (saveReply?.error) return { ok: false, status: 400, json: async () => ({ code: "CHARACTER_DIALS_INVALID", message: "Franchise : valeur entre 1 et 5 attendue." }) };
    return { ok: true, json: async () => ({ status: "ok", dials: { ...load.dials, ...JSON.parse(options.body).dials } }) };
  };
  const ui = context.window.NoonCharacterUi;
  const root = new FakeElement("fieldset"); root.ownerDocument = document; root.hidden = true;
  const timers = [];
  const controller = ui.createCharacterController({ elements: { root }, api: ui.createCharacterApi({ fetchImpl }), setTimer: (fn) => { timers.push(fn); return timers.length; }, clearTimer: () => {} });
  return { controller, root, calls, timers };
}

const status = { status: "ok", enabled: true, dials: charter.defaultDials(), definitions: charter.DIALS };

test("UI Caractère : cinq curseurs, enregistrement groupé avec en-tête Noon, état honnête si désactivé", async () => {
  const { controller, root, calls, timers } = loadUi({ load: status });
  assert.equal(await controller.init(), true);
  assert.equal(root.hidden, false);
  const sliders = all(root).filter((node) => node.tagName === "INPUT" && node.type === "range");
  assert.equal(sliders.length, 5);
  assert.deepEqual(sliders.map((node) => [node.min, node.max, node.value]), [["1", "5", "4"], ["1", "5", "3"], ["1", "5", "3"], ["1", "6", "3"], ["1", "5", "3"]]);
  assert.match(root.textContent, /Franchise4\/5/);
  sliders[0].value = "5"; sliders[0].dispatch("change");
  assert.match(root.textContent, /Cash/);
  const fresh = all(root).filter((node) => node.tagName === "INPUT" && node.type === "range");
  fresh[3].value = "1"; fresh[3].dispatch("change");
  assert.equal(calls.filter((call) => call.method === "POST").length, 0, "attente avant enregistrement");
  await timers.at(-1)(); await settle();
  const post = calls.find((call) => call.method === "POST");
  assert.deepEqual(post.body, { dials: { frankness: 5, proactivity: 1 } });
  assert.equal(post.headers["X-Noon-Request"], "1");
  assert.match(root.textContent, /Enregistré/);

  const off = loadUi({ load: { ...status, enabled: false } });
  await off.controller.init();
  assert.match(off.root.textContent, /personnalité de base/);
  assert.ok(all(off.root).filter((node) => node.tagName === "INPUT").every((node) => node.disabled));

  const missing = loadUi({ load: 404 });
  assert.equal(await missing.controller.init(), false);
  assert.equal(missing.root.hidden, true);
});

test("UI Caractère : erreur serveur affichée ; câblage index et app", async () => {
  const { controller, root, timers } = loadUi({ load: status, saveReply: { error: true } });
  await controller.init();
  const slider = all(root).find((node) => node.tagName === "INPUT");
  slider.value = "2"; slider.dispatch("change");
  await timers.at(-1)(); await settle();
  assert.ok(all(root).some((node) => node.attributes?.role === "alert"));
  const index = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
  assert.ok(index.includes('id="characterSettings"'));
  assert.ok(index.indexOf('<script src="character-ui.js"></script>') < index.indexOf('<script src="app.js"></script>'));
  assert.match(fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8"), /window\.NoonCharacterUi\.createCharacterController/);
});
