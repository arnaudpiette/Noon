"use strict";

// Interface V3, étape 3 : colonne de gauche courte (navigation, Projets, Récents, pied compact),
// vues dans la colonne, mode DA/DEV dans la barre du haut, recherche locale des chats.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { readAppSource } = require("./helpers/app-source");

const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
const app = readAppSource();
const sidebar = html.match(/<aside class="sidebar">[\s\S]*?<\/aside>/)?.[0] || "";
const topBar = html.match(/<header class="top-tools">[\s\S]*?<\/header>/)?.[0] || "";

test("la navigation principale suit l'ordre de la colonne Claude", () => {
  const nav = sidebar.match(/<nav class="sidebar-nav"[\s\S]*?<\/nav>/)?.[0] || "";
  const order = ["newConversationButton", "sidebarSearchButton", 'data-view="core"', 'data-view="chat"', 'data-view="brief"', 'data-view="personal"', "liveVoiceButton"];
  for (const marker of order) assert.ok(nav.includes(marker), `${marker} absent de la navigation`);
  assert.ok(order.every((marker, index) => index === 0 || nav.indexOf(marker) > nav.indexOf(order[index - 1])));
  assert.ok(sidebar.indexOf("sidebar-nav") < sidebar.indexOf('id="conversationProjects"'));
  assert.ok(sidebar.indexOf('id="conversationProjects"') < sidebar.indexOf('id="conversationHistory"'));
  assert.match(sidebar, /<footer class="sidebar-footer">[\s\S]*id="focusToggle"[\s\S]*id="budgetValue"[\s\S]*<\/footer>/);
});

test("les vues et le mode quittent la barre du haut ou la colonne selon leur rôle", () => {
  assert.doesNotMatch(topBar, /class="view-switch"/);
  assert.doesNotMatch(topBar, /class="view-btn/);
  assert.match(topBar, /id="topBarTitle"/);
  assert.match(topBar, /<div class="top-mode"[\s\S]*data-mode="DA"[\s\S]*data-mode="DEV"/);
  assert.doesNotMatch(sidebar, /class="mode-btn/);
  assert.match(app, /topBarTitle\.textContent = \{ core: "Assistant vocal", chat: "Chat", brief: "Brief du jour", personal: "Personnel" \}\[currentView\]/);
});

test("Rechercher filtre localement les chats récents", () => {
  assert.match(sidebar, /id="sidebarSearchButton"[^>]*aria-controls="conversationSearchInput"/);
  assert.match(sidebar, /<input id="conversationSearchInput" type="search"/);
  assert.match(app, /function applyConversationSearch\(\)/);
  assert.match(app, /renderConversationIndex[\s\S]*applyConversationSearch\(\);\n\}/);
});

test("les blocs masqués restent dans le DOM pour le JavaScript, hors de la navigation visible", () => {
  for (const id of ["integrationsList", "approvalsList", "automationsList", "activity", "stopRequestButton", "projectJournalPanel"]) {
    assert.match(html, new RegExp(`id="${id}"`), `${id} doit rester présent`);
  }
});

test("un premier clic sur la conversation restaurée l'ouvre avec son historique", () => {
  const body = app.match(/async function switchConversation\(sessionId\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.match(body, /if \(sessionId === currentSessionId\) \{\s*if \(!requestInProgress && conversationHistoryLoadedFor !== sessionId\) await loadConversationHistory\(\);\s*switchView\("chat"\);/);
  assert.match(body, /if \(requestInProgress\) \{\s*updateActivity\(/);
  assert.match(app, /conversationHistoryLoadedFor = currentSessionId;/);
});

test("les menus contextuels utilisent le jeu de pictos unique", () => {
  assert.match(app, /function noonIcon\(name\)/);
  assert.match(app, /icon\.append\(noonIcon\(\{ share: "share", rename: "pencil", folder: "folder", trash: "trash" \}\[action\.icon\]\)\)/);
  for (const name of ["pencil", "trash", "chevron-right"]) assert.match(html, new RegExp(`<symbol id="noon-i-${name}"`));
});
