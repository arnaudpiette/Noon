"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { normalizeSafeChatUrl, renderChatMarkdown, tokenizeChatMarkdown } = require("../public/ui-utils");

function fakeContainer() {
  const document = {
    createDocumentFragment() { return { children: [], append(node) { this.children.push(node); } }; },
    createTextNode(value) { return { nodeType: 3, value }; },
    createElement(tagName) { return { tagName, href: "", target: "", rel: "", textContent: "" }; },
  };
  return { ownerDocument: document, children: [], replaceChildren(fragment) { this.children = fragment.children; } };
}

test("un lien Markdown HTTPS devient un lien ouvrable", () => {
  const container = fakeContainer();
  renderChatMarkdown(container, "[Ouvrir](https://example.com/test)");
  assert.deepEqual(container.children, [{ tagName: "a", href: "https://example.com/test", target: "_blank", rel: "noopener noreferrer", textContent: "Ouvrir" }]);
});

test("une URL HTTP(S) brute est autolinkifiée", () => {
  const tokens = tokenizeChatMarkdown("Voir https://example.com/test.");
  assert.deepEqual(tokens, [{ type: "text", value: "Voir " }, { type: "link", label: "https://example.com/test", href: "https://example.com/test" }, { type: "text", value: "." }]);
});

test("les URI dangereuses et invalides ne deviennent jamais exécutables", () => {
  assert.equal(normalizeSafeChatUrl("javascript:alert(1)"), null);
  assert.equal(normalizeSafeChatUrl("data:text/html,test"), null);
  assert.equal(normalizeSafeChatUrl("file:///tmp/test"), null);
  assert.equal(normalizeSafeChatUrl("pas une url"), null);
  const dangerous = tokenizeChatMarkdown("[Piège](javascript:alert(1))");
  assert.equal(dangerous.map((token) => token.value || token.label).join(""), "[Piège](javascript:alert(1))");
  assert.equal(dangerous.some((token) => token.type === "link"), false);
});

test("le HTML modèle reste un noeud texte et ne crée aucun script", () => {
  const container = fakeContainer();
  renderChatMarkdown(container, '<img src=x onerror="alert(1)"><script>alert(1)</script>');
  assert.equal(container.children.length, 1);
  assert.equal(container.children[0].nodeType, 3);
});

test("le streaming reste textuel et le rendu final ne pose aucun handler par lien", () => {
  const app = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
  assert.match(app, /streamedParagraph\.textContent = streamedText/);
  assert.match(app, /renderChatMarkdown\(paragraph, text\)/);
  assert.doesNotMatch(renderChatMarkdown.toString(), /addEventListener|onclick/);
});

test("un clic HTTPS suit le mécanisme Electron externe existant", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "electron", "main.js"), "utf8");
  assert.match(main, /setWindowOpenHandler\(\(\{ url \}\) => \{[\s\S]*?openExternalUrl\(url\)[\s\S]*?action: "deny"/);
  assert.match(main, /async function openExternalUrl[\s\S]*?isSafeExternalUrl[\s\S]*?shell\.openExternal/);
});

test("les liens sont accessibles nativement au clavier", () => {
  const container = fakeContainer();
  renderChatMarkdown(container, "https://example.com/test");
  assert.equal(container.children[0].tagName, "a");
  assert.equal(Object.hasOwn(container.children[0], "tabindex"), false);
});

test("les cartes de sources conservent URL, source et résumé structurés", () => {
  const app = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
  assert.match(app, /source\.url/);
  assert.match(app, /source\.source \|\| source\.domain/);
  assert.match(app, /source\.snippet/);
});
