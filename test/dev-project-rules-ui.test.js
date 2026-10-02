"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

class Node {
  constructor(fragment = false) { this.fragment = fragment; this.children = []; this.listeners = new Map(); this.dataset = {}; this.hidden = false; this.disabled = false; this.value = ""; this.textContent = ""; this.className = ""; this.attributes = new Map(); }
  append(...items) { this.children.push(...items.flatMap((item) => item?.fragment ? item.children : [item])); }
  replaceChildren(...items) { this.children = []; this.append(...items); }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  emit(type) { this.listeners.get(type)?.({ preventDefault() {} }); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  focus() {}
}

function setup({ bridge, confirmAction = () => true } = {}) {
  const document = { createElement: () => new Node(), createDocumentFragment: () => new Node(true) };
  const window = { confirm: confirmAction };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "public", "dev-project-rules-ui.js"), "utf8"), { window, document });
  const elements = Object.fromEntries(["toggle", "panel", "project", "add", "readOnly", "list", "form", "input", "preview", "save", "cancel", "status"].map((key) => [key, new Node()]));
  elements.panel.hidden = true;
  let context = { workspaceId: "workspace-a", contextKey: "focus-a:/repo-a", projectName: "Projet A" };
  const controller = window.NoonDevProjectRulesUi.createDevProjectRulesController({ elements, bridge, getContext: () => context, confirmAction });
  return { controller, elements, setContext: (value) => { context = value; } };
}

async function flush() { for (let i = 0; i < 6; i += 1) await Promise.resolve(); }
function findButton(node, text) { if (node?.textContent === text) return node; for (const child of node?.children || []) { const found = findButton(child, text); if (found) return found; } return null; }

test("parcours UI IPC : lecture autorisée, aperçu, création, modification, désactivation et suppression explicites", async () => {
  const mutations = [];
  const rule = { ruleId: "r1", text: "<img src=x onerror=window.pwned=1>", status: "ACTIVE", version: 4 };
  const bridge = { async getDevProjectRules() { return { project: { id: "project-a", name: "Projet A" }, storage: "READ_WRITE", rules: [rule] }; }, async devProjectRule(payload) { mutations.push(payload); return { ok: true }; } };
  const f = setup({ bridge });
  await f.controller.refresh();
  assert.equal(f.elements.project.textContent, "Projet A");
  assert.equal(f.elements.list.children[0].children[0].textContent, rule.text, "le texte n’est jamais injecté comme HTML");
  f.elements.input.value = "Préférer le test ciblé."; f.elements.form.emit("submit"); await flush();
  assert.equal(JSON.stringify(mutations[0]), JSON.stringify({ action: "create", workspaceId: "workspace-a", expectedProjectId: "project-a", text: "Préférer le test ciblé." }));
  findButton(f.elements.list, "Modifier").emit("click"); f.elements.input.value = "Tester puis relire."; f.elements.form.emit("submit"); await flush();
  assert.equal(JSON.stringify(mutations[1]), JSON.stringify({ action: "update", workspaceId: "workspace-a", expectedProjectId: "project-a", text: "Tester puis relire.", ruleId: "r1", expectedVersion: 4 }));
  findButton(f.elements.list, "Désactiver").emit("click"); await flush();
  assert.equal(JSON.stringify(mutations[2]), JSON.stringify({ action: "disable", workspaceId: "workspace-a", expectedProjectId: "project-a", ruleId: "r1", expectedVersion: 4 }));
  findButton(f.elements.list, "Supprimer").emit("click"); await flush();
  assert.equal(JSON.stringify(mutations[3]), JSON.stringify({ action: "delete", workspaceId: "workspace-a", expectedProjectId: "project-a", ruleId: "r1", expectedVersion: 4 }));
});

test("annulation et refus de confirmation ne produisent aucune mutation", async () => {
  let calls = 0;
  const f = setup({ bridge: { getDevProjectRules: async () => ({ project: { id: "project-a", name: "Projet A" }, storage: "READ_WRITE", rules: [] }), devProjectRule: async () => { calls += 1; } }, confirmAction: () => false });
  await f.controller.refresh(); f.elements.input.value = "Ne pas écrire."; f.elements.cancel.emit("click"); await flush();
  assert.equal(calls, 0); assert.match(f.elements.status.textContent, /annul/i);
});

test("changement de projet et fallback restent sans écrasement", async () => {
  let resolveMutation; const pending = new Promise((resolve) => { resolveMutation = resolve; });
  const bridge = { getDevProjectRules: async () => ({ project: { id: "project-a", name: "Projet A" }, storage: "READ_WRITE", rules: [{ ruleId: "r", text: "Initiale", status: "ACTIVE", version: 1 }] }), devProjectRule: async () => pending };
  const f = setup({ bridge }); await f.controller.refresh(); findButton(f.elements.list, "Modifier").emit("click"); f.elements.input.value = "Nouvelle"; f.elements.form.emit("submit");
  f.setContext({ workspaceId: "workspace-b", contextKey: "focus-b:/repo-b", projectName: "Projet B" }); resolveMutation(); await flush();
  assert.match(f.elements.status.textContent, /projet a changé/i);
  const readOnly = setup({ bridge: { getDevProjectRules: async () => ({ project: { id: "project-a", name: "Projet A" }, storage: "READ_ONLY", rules: [] }), devProjectRule: async () => assert.fail("aucune mutation") } });
  await readOnly.controller.refresh(); assert.equal(readOnly.elements.form.hidden, true); assert.match(readOnly.elements.readOnly.textContent, /lecture seule/i);
  const unavailable = setup({ bridge: null }); await unavailable.controller.refresh(); assert.match(unavailable.elements.readOnly.textContent, /IPC/i);
});

test("une version obsolète est affichée sans nouvelle tentative d’écrasement", async () => {
  let calls = 0;
  const f = setup({ bridge: { getDevProjectRules: async () => ({ project: { id: "project-a", name: "Projet A" }, storage: "READ_WRITE", rules: [{ ruleId: "r", text: "Initiale", status: "ACTIVE", version: 2 }] }), devProjectRule: async () => { calls += 1; throw Object.assign(new Error("refus"), { code: "RULE_MUTATION_REFUSED" }); } } });
  await f.controller.refresh(); findButton(f.elements.list, "Modifier").emit("click"); f.elements.input.value = "Tentative"; f.elements.form.emit("submit"); await flush();
  assert.equal(calls, 1); assert.match(f.elements.status.textContent, /a changé/i);
});

test("une lecture IPC indisponible ne fabrique pas une liste vide", async () => {
  const f = setup({ bridge: { getDevProjectRules: async () => { throw new Error("offline"); }, devProjectRule: async () => assert.fail("aucune mutation") } });
  await f.controller.refresh();
  assert.match(f.elements.status.textContent, /indisponible/i);
  assert.equal(f.elements.list.children.length, 0);
});
