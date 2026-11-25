"use strict";

// Interface V3, étape 4 : atelier DEV à droite du chat (aperçu, terminal, Modifications),
// panneaux retenus par projet Focus, mode DA/DEV retenu par projet de conversations,
// en-tête du Chat remplacé par le titre de la conversation dans la barre du haut.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { APP_PARTS } = require("../services/http/app-bundle");
const { readAppSource } = require("./helpers/app-source");

const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "..", "public", "style.css"), "utf8");
const app = readAppSource();
const topBar = html.match(/<header class="top-tools">[\s\S]*?<\/header>/)?.[0] || "";

// Corps d'une fonction de premier niveau du bundle (déclaration jusqu'à l'accolade en colonne 0).
function topLevelFunction(name) {
  const match = app.match(new RegExp(`\\n(?:async )?function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}\\n`));
  assert.ok(match, `fonction ${name} introuvable`);
  return match[0];
}

class FakeClassList {
  constructor() { this.values = new Set(); }
  toggle(name, on) { if (on) this.values.add(name); else this.values.delete(name); return on; }
  contains(name) { return this.values.has(name); }
  add(name) { this.values.add(name); }
}

function fakeElement(extra = {}) {
  return { hidden: false, disabled: false, title: "", attributes: {}, classList: new FakeClassList(),
    setAttribute(name, value) { this.attributes[name] = value; }, ...extra };
}

function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (key) => (data.has(key) ? data.get(key) : null), setItem: (key, value) => data.set(key, String(value)), data };
}

test("la barre du haut porte les trois boutons de l'atelier, avec des pictos du jeu unique", () => {
  const toggles = topBar.match(/<div id="devPaneToggles"[\s\S]*?<\/div>/)?.[0] || "";
  assert.match(toggles, /class="dev-pane-toggles" role="group" aria-label="Panneaux DEV" hidden/);
  for (const [id, label, icon, controls] of [
    ["devPaneToggleTerminal", "Terminal", "terminal", "devTerminalPanel"],
    ["devPaneTogglePreview", "Aperçu", "browser", "devPreviewPanel"],
    ["devPaneToggleChanges", "Modifications", "diff", "devSourceControlPanel"],
  ]) {
    assert.match(toggles, new RegExp(`id="${id}"[^>]*aria-controls="${controls}"[^>]*aria-label="${label}"[^>]*>[^]*?#noon-i-${icon}`));
    assert.match(html, new RegExp(`<symbol id="noon-i-${icon}"`));
  }
  assert.ok(topBar.indexOf('id="devPaneToggles"') < topBar.indexOf('class="top-mode"'));
  assert.equal(APP_PARTS.at(-1), "12-dev-panes-layout.js");
});

test("l'en-tête du Chat disparaît ; la barre affiche le titre de la conversation", () => {
  assert.match(css, /#chatView>\.chat-header\{display:none\}/);
  const context = {
    document: { getElementById: () => topBarTitle },
    conversationIndexState: { conversations: [{ id: "s1", title: "Plan MCP phase 2" }] },
    currentSessionId: "s1",
    currentView: "chat",
  };
  const topBarTitle = { textContent: "" };
  vm.runInNewContext(`${topLevelFunction("syncTopBarTitle")}; syncTopBarTitle();`, context);
  assert.equal(topBarTitle.textContent, "Plan MCP phase 2");
  vm.runInNewContext(`currentSessionId = "nouvelle"; syncTopBarTitle();`, context);
  assert.equal(topBarTitle.textContent, "Nouveau chat");
  vm.runInNewContext(`currentView = "brief"; syncTopBarTitle();`, context);
  assert.equal(topBarTitle.textContent, "Brief du jour");
});

function layoutHarness({ mode = "DEV", chatWidth = 1172, focus = true, terminalHidden = false, previewHidden = false } = {}) {
  const workspace = fakeElement();
  const chatView = fakeElement({ parentElement: workspace, getBoundingClientRect: () => ({ width: chatWidth }) });
  chatView.classList.add("active");
  const context = {
    currentMode: mode,
    currentView: "chat",
    currentFocusId: focus ? "corsaire" : null,
    currentFocusPath: focus ? "/projets/corsaire" : null,
    DEV_SPLIT_MIN_CHAT_WIDTH: 640,
    devPaneVisibility: { previewHidden, terminalHidden },
    chatView,
    devTerminalPanel: fakeElement(),
    devPreviewPanel: fakeElement({ hidden: !focus || previewHidden }),
    devPaneToggles: fakeElement(),
    devPaneToggleTerminal: fakeElement(),
    devPaneTogglePreview: fakeElement(),
    devPaneToggleChanges: fakeElement(),
    devSourceControlToggle: fakeElement(),
    syncDevPreviewResizeHandle() {},
    scheduleDevPreviewBounds() {},
    scheduleDevTerminalWorkspaceClamp() {},
  };
  vm.runInNewContext(`${topLevelFunction("setDevPaneToggleState")}\n${topLevelFunction("syncDevPanesLayout")}\nsyncDevPanesLayout();`, context);
  return context;
}

test("en DEV, aperçu et terminal forment une colonne à droite du chat", () => {
  const h = layoutHarness();
  for (const name of ["dev-split", "dev-split-preview", "dev-split-terminal"]) assert.ok(h.chatView.classList.contains(name), name);
  assert.ok(h.chatView.parentElement.classList.contains("dev-split"), "le champ de saisie suit la colonne du chat");
  assert.equal(h.devPaneToggles.hidden, false);
  assert.equal(h.devPaneToggleTerminal.attributes["aria-pressed"], "true");
  assert.equal(h.devPaneTogglePreview.attributes["aria-pressed"], "true");
});

test("masquer le terminal le cache sans le fermer ; masquer les deux rend toute la largeur au chat", () => {
  const terminalOff = layoutHarness({ terminalHidden: true });
  assert.ok(terminalOff.chatView.classList.contains("dev-terminal-user-hidden"));
  assert.ok(terminalOff.chatView.classList.contains("dev-split-preview"));
  assert.ok(!terminalOff.chatView.classList.contains("dev-split-terminal"));
  assert.equal(terminalOff.devTerminalPanel.hidden, false, "la session du terminal n'est pas fermée");
  assert.match(css, /#chatView\.dev-terminal-user-hidden \.dev-terminal-panel\{display:none!important\}/);

  const bothOff = layoutHarness({ terminalHidden: true, previewHidden: true });
  assert.ok(!bothOff.chatView.classList.contains("dev-split"));
  assert.ok(!bothOff.chatView.parentElement.classList.contains("dev-split"));
});

test("hors DEV, sans Focus ou en fenêtre étroite, l'atelier ne s'applique pas", () => {
  const da = layoutHarness({ mode: "DA" });
  assert.ok(!da.chatView.classList.contains("dev-split"));
  assert.equal(da.devPaneToggles.hidden, true);
  const narrow = layoutHarness({ chatWidth: 600 });
  assert.ok(!narrow.chatView.classList.contains("dev-split"), "ancienne disposition sous 640 px de chat");
  const noFocus = layoutHarness({ focus: false });
  assert.equal(noFocus.devPaneTogglePreview.disabled, true);
  assert.equal(noFocus.devPaneToggleChanges.disabled, true);
  assert.ok(noFocus.chatView.classList.contains("dev-split-terminal"), "le terminal invite à choisir un Focus");
});

test("panneaux masqués et largeur de l'atelier sont retenus pour chaque projet Focus", () => {
  const localStorage = fakeStorage({ "noonDevPanes:corsaire": JSON.stringify({ previewHidden: true }), noonDevPreviewWidth: "520" });
  const context = { localStorage, currentFocusId: "corsaire", devPaneVisibility: { previewHidden: false, terminalHidden: true }, DEV_PREVIEW_WIDTH_STORAGE_KEY: "noonDevPreviewWidth" };
  vm.runInNewContext(`${topLevelFunction("devPanesStorageKey")}\n${topLevelFunction("loadDevPaneVisibility")}\n${topLevelFunction("saveDevPaneVisibility")}\n${topLevelFunction("devPreviewWidthStorageKey")}\nloadDevPaneVisibility();`, context);
  assert.deepEqual({ ...context.devPaneVisibility }, { previewHidden: true, terminalHidden: false });
  vm.runInNewContext(`currentFocusId = "portfolio"; loadDevPaneVisibility(); devPaneVisibility.terminalHidden = true; saveDevPaneVisibility();`, context);
  assert.equal(localStorage.getItem("noonDevPanes:portfolio"), JSON.stringify({ previewHidden: false, terminalHidden: true }));
  assert.equal(vm.runInNewContext("devPreviewWidthStorageKey()", context), "noonDevPreviewWidth:portfolio");
  // Valeur illisible : repli sans erreur sur les panneaux visibles.
  localStorage.setItem("noonDevPanes:portfolio", "{cassé");
  vm.runInNewContext("loadDevPaneVisibility();", context);
  assert.deepEqual({ ...context.devPaneVisibility }, { previewHidden: false, terminalHidden: false });
  assert.match(topLevelFunction("loadDevPreviewWidth"), /devPreviewWidthStorageKey\(\)[\s\S]*DEV_PREVIEW_WIDTH_STORAGE_KEY/);
});

test("le mode DA/DEV est retenu par projet et réappliqué à l'ouverture d'une conversation", () => {
  const localStorage = fakeStorage();
  const calls = [];
  const context = {
    localStorage, currentMode: "DEV", currentSessionId: "p1", ALLOWED_MODES: ["DA", "DEV", "SOUTENANCE"],
    conversationIndexState: { conversations: [{ id: "p1", folderId: "corsaire" }, { id: "c1", folderId: "general" }] },
    setMode(mode) { calls.push(mode); context.currentMode = mode; },
    updateActivity() {},
  };
  vm.runInNewContext(["readProjectModes", "conversationFolderId", "rememberProjectMode", "applyProjectMode"].map(topLevelFunction).join("\n"), context);
  vm.runInNewContext(`rememberProjectMode(); currentSessionId = "c1"; currentMode = "DA"; rememberProjectMode();`, context);
  assert.deepEqual(JSON.parse(localStorage.getItem("noonProjectModes")), { corsaire: "DEV", general: "DA" });
  vm.runInNewContext(`applyProjectMode(conversationFolderId("p1"));`, context);
  assert.deepEqual(calls, ["DEV"]);
  vm.runInNewContext(`applyProjectMode("sans-mode-retenu"); applyProjectMode("corsaire");`, context);
  assert.deepEqual(calls, ["DEV"], "sans mode retenu, ou déjà dans le bon mode : rien ne change");
  localStorage.setItem("noonProjectModes", "[1,2]");
  assert.equal(vm.runInNewContext("JSON.stringify(readProjectModes())", context), "{}");
  // Branchements : ouverture d'une conversation, nouvelle conversation, clic sur DA/DEV.
  assert.match(app, /currentSessionId = sessionId;\n\s*localStorage\.setItem\(SESSION_STORAGE_KEY, currentSessionId\);\n\s*applyProjectMode\(conversationFolderId\(sessionId\)\);/);
  assert.match(app, /currentSessionId = createSessionId\(\);\n\s*localStorage\.setItem\(SESSION_STORAGE_KEY, currentSessionId\);\n\s*applyProjectMode\(targetFolderId\);/);
  assert.match(app, /modeButtons\.forEach\(\(button\) => \{\n\s*button\.addEventListener\("click", \(\) => \{\n\s*rememberProjectMode\(\);/);
});
