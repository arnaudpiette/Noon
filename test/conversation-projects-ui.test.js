"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
const app = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "..", "public", "style.css"), "utf8");

test("la section Projets suit Chats et permet une création accessible", () => {
  assert.match(html, /id="conversationHistory"[\s\S]*id="conversationProjects"/);
  assert.match(html, /id="createConversationProject"[^>]*aria-label="Créer un projet"/);
  assert.match(app, /createConversationProjectButton\.addEventListener/);
});

test("une conversation peut être déplacée sans duplication par menu ou glisser-déposer", () => {
  assert.match(app, /Déplacer vers le projet/);
  assert.match(app, /Aucun projet \/ Chats/);
  assert.match(app, /text\/x-noon-conversation/);
  assert.match(app, /updateIndexedConversation\(conversationItem\.id, \{ folderId: projectId \}\)/);
  assert.match(css, /\.conversation-project\.is-drop-target/);
});

test("les menus et projets exposent les attributs clavier et ARIA", () => {
  assert.match(app, /aria-haspopup/);
  assert.match(app, /event\.key === "Escape"/);
  assert.match(app, /"ArrowDown", "ArrowUp"/);
  assert.match(app, /role = "menuitem"/);
});

test("Chats reste dans le flux et défile sans recouvrir Projets", () => {
  assert.match(css, /\.sidebar>\.conversation-history,\.sidebar>\.conversation-projects\{flex:0 0 auto/);
  assert.match(css, /\.conversation-history__list\{max-height:min\(38vh,360px\);overflow-x:hidden;overflow-y:auto/);
  assert.match(css, /\.conversation-history\[open\]\+\.conversation-projects/);
});

test("les actions des menus latéraux restent sur une seule ligne", () => {
  assert.match(css, /\.conversation-context-menu\{width:272px;max-width:calc\(100vw - 24px\)\}/);
  assert.match(css, /\.conversation-context-menu__item\{width:100%;white-space:nowrap\}/);
});

test("les conversations et projets se renomment dans la ligne sans window.prompt", () => {
  assert.match(app, /async function beginIndexedConversationRename/);
  assert.match(app, /await beginIndexedConversationRename\(conversationItem\.id\)/);
  assert.match(app, /async function beginConversationProjectRename/);
  assert.match(app, /event\.key === "Enter"/);
  assert.match(app, /event\.key === "Escape"/);
  assert.doesNotMatch(app.slice(app.indexOf("function openConversationContextMenu"), app.indexOf("function renderConversationIndex")), /window\.prompt/);
  assert.match(css, /\.conversation-project__rename/);
  assert.match(css, /\.conversation-history__rename/);
});
