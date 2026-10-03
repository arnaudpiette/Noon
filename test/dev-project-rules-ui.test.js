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

function setup({ bridge, confirmAction = () => true, getUnavailableReason } = {}) {
  const document = { createElement: () => new Node(), createDocumentFragment: () => new Node(true) };
  const window = { confirm: confirmAction };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "public", "dev-project-rules-ui.js"), "utf8"), { window, document });
  const elements = Object.fromEntries(["toggle", "panel", "project", "add", "readOnly", "list", "form", "input", "preview", "save", "cancel", "status"].map((key) => [key, new Node()]));
  elements.panel.hidden = true;
  let context = { workspaceId: "workspace-a", contextKey: "focus-a:/repo-a", projectName: "Projet A" };
  const controller = window.NoonDevProjectRulesUi.createDevProjectRulesController({ elements, bridge, getContext: () => context, getUnavailableReason, confirmAction });
  return { controller, elements, setContext: (value) => { context = value; } };
}

function setupMountedUi({ bridge, selectedProject = { workspaceId: "ui-validation-workspace-a", name: "Projet synthétique A" } } = {}) {
  const document = { createElement: () => new Node(), createDocumentFragment: () => new Node(true) };
  const window = { confirm: () => true };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "public", "dev-project-rules-ui.js"), "utf8"), { window, document });
  const elements = Object.fromEntries(["toggle", "panel", "project", "add", "readOnly", "list", "form", "input", "preview", "save", "cancel", "status"].map((key) => [key, new Node()]));
  elements.panel.hidden = true;
  const controller = window.NoonDevProjectRulesUi.mountDevProjectRulesUi({
    elements,
    bridge,
    getContext: () => ({ workspaceId: selectedProject.workspaceId, contextKey: `ui-validation:${selectedProject.workspaceId}`, projectName: selectedProject.name }),
  });
  return { controller, elements };
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

test("un changement de projet pendant la confirmation refuse la mutation", async () => {
  let calls = 0;
  let f;
  f = setup({
    bridge: {
      getDevProjectRules: async () => ({ project: { id: "project-a", name: "Projet synthétique A" }, storage: "READ_WRITE", rules: [] }),
      devProjectRule: async () => { calls += 1; },
    },
    confirmAction: () => {
      f.setContext({ workspaceId: "ui-validation-workspace-b", contextKey: "ui-validation:ui-validation-workspace-b", projectName: "Projet synthétique B" });
      return true;
    },
  });
  f.setContext({ workspaceId: "ui-validation-workspace-a", contextKey: "ui-validation:ui-validation-workspace-a", projectName: "Projet synthétique A" });
  await f.controller.refresh();
  f.elements.input.value = "Ne pas muter après changement.";
  f.elements.form.emit("submit");
  await flush();
  assert.equal(calls, 0);
  assert.match(f.elements.status.textContent, /projet a changé/i);
});

test("les contextes synthétiques A et B gardent leurs règles séparées", async () => {
  const reads = [];
  const mutations = [];
  const f = setup({
    bridge: {
      async getDevProjectRules(workspaceId) {
        reads.push(workspaceId);
        const isA = workspaceId === "ui-validation-workspace-a";
        return { project: { id: isA ? "ui-validation-project-a" : "ui-validation-project-b", name: isA ? "Projet synthétique A" : "Projet synthétique B" }, storage: "READ_WRITE", rules: [{ ruleId: isA ? "a" : "b", text: isA ? "Règle A" : "Règle B", status: "ACTIVE", version: 1 }] };
      },
      async devProjectRule(payload) { mutations.push(payload); },
    },
  });
  f.setContext({ workspaceId: "ui-validation-workspace-a", contextKey: "ui-validation:ui-validation-workspace-a", projectName: "Projet synthétique A" });
  await f.controller.refresh();
  assert.equal(f.elements.list.children[0].children[0].textContent, "Règle A");
  f.setContext({ workspaceId: "ui-validation-workspace-b", contextKey: "ui-validation:ui-validation-workspace-b", projectName: "Projet synthétique B" });
  await f.controller.refresh();
  assert.equal(f.elements.list.children[0].children[0].textContent, "Règle B");
  f.elements.input.value = "Règle B nouvelle";
  f.elements.form.emit("submit");
  await flush();
  assert.deepEqual(reads.slice(0, 2), ["ui-validation-workspace-a", "ui-validation-workspace-b"]);
  assert.equal(mutations[0].workspaceId, "ui-validation-workspace-b");
  assert.equal(mutations[0].expectedProjectId, "ui-validation-project-b");
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

test("le mode isolé explique l’absence de workspace au lieu de faire croire à des règles vides", async () => {
  const f = setup({ bridge: null, getUnavailableReason: () => "Validation UI isolée : workspace synthétique requis." });
  f.setContext({ workspaceId: null, contextKey: null, projectName: "Profil isolé" });
  await f.controller.refresh();
  assert.match(f.elements.status.textContent, /workspace synthétique requis/i);
  assert.match(f.elements.readOnly.textContent, /workspace synthétique requis/i);
  assert.equal(f.elements.list.children.length, 0);
});

test("le bouton Règles ouvre et referme réellement le panneau", async () => {
  const bridge = {
    async getDevProjectRules() {
      return {
        project: {
          id: "project-a",
          name: "Projet A",
        },
        storage: "READ_WRITE",
        rules: [],
      };
    },
    async devProjectRule() {},
  };

  const f = setup({ bridge });

  f.elements.panel.hidden = true;

  f.elements.toggle.emit("click");
  await flush();

  assert.equal(
    f.elements.panel.hidden,
    false,
    "le panneau doit être visible après le clic"
  );

  assert.equal(
    f.elements.toggle.attributes.get(
      "aria-expanded"
    ),
    "true"
  );

  f.elements.toggle.emit("click");

  assert.equal(
    f.elements.panel.hidden,
    true,
    "le second clic doit refermer le panneau"
  );

  assert.equal(
    f.elements.toggle.attributes.get(
      "aria-expanded"
    ),
    "false"
  );
});

test("le câblage monté depuis la page ouvre les règles du projet synthétique sélectionné", async () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
  const app = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const reads = [];
  const f = setupMountedUi({
    bridge: {
      async getDevProjectRules(workspaceId) {
        reads.push(workspaceId);
        return { project: { id: "ui-validation-project-a", name: "Projet synthétique A" }, storage: "READ_WRITE", rules: [] };
      },
      async devProjectRule() {},
    },
  });

  assert.ok(html.indexOf('src="dev-project-rules-ui.js"') < html.indexOf('src="app.js"'));
  assert.match(server, /req\.method === "GET" && req\.url === "\/dev-project-rules-ui\.js"/);
  assert.match(app, /NoonDevProjectRulesUi\?\.mountDevProjectRulesUi\(/);
  assert.match(app, /Le module des règles DEV n’a pas pu être chargé/);
  f.elements.toggle.emit("click");
  await flush();

  assert.equal(f.elements.panel.hidden, false, "le panneau doit devenir visible après le clic réel du bouton monté");
  assert.equal(f.elements.toggle.attributes.get("aria-expanded"), "true");
  assert.equal(f.elements.project.textContent, "Projet synthétique A");
  assert.deepEqual(reads, ["ui-validation-workspace-a"]);
});

test("le câblage UI réactive une règle inactive, transmet sa version et rafraîchit son état", async () => {
  const mutations = [];
  let rule = { ruleId: "inactive-a", text: "Règle suspendue.", status: "DISABLED", version: 7 };
  const f = setupMountedUi({
    bridge: {
      async getDevProjectRules() { return { project: { id: "ui-validation-project-a", name: "Projet synthétique A" }, storage: "READ_WRITE", rules: [rule] }; },
      async devProjectRule(payload) { mutations.push(payload); rule = { ...rule, status: "ACTIVE", version: 8 }; },
    },
  });
  await f.controller.refresh();
  const reactivate = findButton(f.elements.list, "Réactiver");
  assert.ok(reactivate); assert.equal(reactivate.className, "dev-project-rule-reactivate");
  reactivate.emit("click"); reactivate.emit("click");
  await flush();
  assert.equal(JSON.stringify(mutations), JSON.stringify([{ action: "enable", workspaceId: "ui-validation-workspace-a", expectedProjectId: "ui-validation-project-a", ruleId: "inactive-a", expectedVersion: 7 }]));
  assert.equal(findButton(f.elements.list, "Désactiver").disabled, false);
  assert.match(f.elements.status.textContent, /Règles chargées/i);
  assert.match(f.elements.list.children[0].children[1].textContent, /Active/);
});

test("un échec de réactivation conserve l'état inactif et une règle supprimée n'offre aucune réactivation", async () => {
  const rule = { ruleId: "inactive-a", text: "Règle suspendue.", status: "DISABLED", version: 7 };
  let calls = 0;
  const f = setup({ bridge: { getDevProjectRules: async () => ({ project: { id: "project-a", name: "Projet A" }, storage: "READ_WRITE", rules: [rule] }), devProjectRule: async () => { calls += 1; throw Object.assign(new Error("refus"), { code: "RULE_MUTATION_REFUSED" }); } } });
  await f.controller.refresh(); findButton(f.elements.list, "Réactiver").emit("click"); await flush();
  assert.equal(calls, 1); assert.ok(findButton(f.elements.list, "Réactiver")); assert.match(f.elements.list.children[0].children[1].textContent, /Inactive/); assert.match(f.elements.status.textContent, /a changé/i);
  const deleted = setup({ bridge: { getDevProjectRules: async () => ({ project: { id: "project-a", name: "Projet A" }, storage: "READ_WRITE", rules: [{ ...rule, status: "DELETED" }] }), devProjectRule: async () => assert.fail("aucune mutation") } });
  await deleted.controller.refresh(); assert.equal(findButton(deleted.elements.list, "Réactiver"), null);
});

test("le panneau Règles ouvert reste visible dans le Terminal", () => {
  const css = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "public",
      "style.css"
    ),
    "utf8"
  );

  assert.match(
    css,
    /#devTerminalPanel:has\(#devProjectRulesPanel:not\(\[hidden\]\)\)\{[\s\S]*overflow-y:auto!important/
  );

  assert.match(
    css,
    /#devProjectRulesPanel:not\(\[hidden\]\)\{[\s\S]*max-height:[\s\S]*overflow:auto/
  );
});
