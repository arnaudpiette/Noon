"use strict";
const { readAppSource } = require("./helpers/app-source");

// B4b : le panneau Goal Mode DEV doit être réellement visible. Les tests UI
// (vm + faux DOM) ignorent le CSS : au premier essai réel, le panneau était
// dans `.operations-panel`, masqué par `display:none!important`. Ce fichier
// vérifie statiquement qu'aucune règle des feuilles de style chargées par
// index.html ne masque le panneau ni l'un de ses ancêtres, puis le
// comportement de l'entrée « Goal Mode DEV » du Control Center.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const PUBLIC = path.join(__dirname, "..", "public");
const INDEX = fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8");
const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

// ---- HTML : chaîne des ancêtres d'un identifiant ----

function parseAttributes(text) {
  const attributes = {};
  const pattern = /([^\s=/"'>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let match;
  while ((match = pattern.exec(text))) attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  return attributes;
}

function ancestorChain(html, id) {
  const source = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "");
  const stack = [];
  const pattern = /<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let match;
  while ((match = pattern.exec(source))) {
    const [, closing, rawTag, rawAttributes] = match;
    const tag = rawTag.toLowerCase();
    if (closing) {
      const index = stack.map((item) => item.tag).lastIndexOf(tag);
      if (index >= 0) stack.length = index;
      continue;
    }
    const attributes = parseAttributes(rawAttributes);
    const element = {
      tag, attributes, id: attributes.id || null,
      classes: new Set(String(attributes.class || "").split(/\s+/).filter(Boolean)),
    };
    if (element.id === id) return [...stack, element];
    if (!VOID_TAGS.has(tag) && !/\/\s*$/.test(rawAttributes)) stack.push(element);
  }
  return null;
}

// ---- CSS : règles aplaties (blocs @media / @supports inclus) ----

function cssRules(css) {
  const rules = [];
  (function parse(text) {
    let buffer = "";
    for (let index = 0; index < text.length;) {
      const char = text[index];
      if (char === "{") {
        let depth = 1;
        let end = index + 1;
        while (end < text.length && depth) {
          if (text[end] === "{") depth += 1;
          else if (text[end] === "}") depth -= 1;
          end += 1;
        }
        const head = buffer.trim();
        const inner = text.slice(index + 1, end - 1);
        if (head.startsWith("@")) {
          if (/^@(media|supports|layer|container)\b/i.test(head)) parse(inner);
        } else {
          rules.push({ selector: head, body: inner });
        }
        buffer = "";
        index = end;
        continue;
      }
      if (char === ";" || char === "}") { buffer = ""; index += 1; continue; }
      buffer += char;
      index += 1;
    }
  })(css.replace(/\/\*[\s\S]*?\*\//g, ""));
  return rules;
}

function hides(body) {
  return /(^|;)\s*display\s*:\s*none\b/i.test(body) || /(^|;)\s*visibility\s*:\s*(hidden|collapse)\b/i.test(body);
}

function splitTopLevel(text, separators) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const char of text) {
    if (char === "(" || char === "[") depth += 1;
    if (char === ")" || char === "]") depth -= 1;
    if (depth === 0 && separators.includes(char)) { parts.push(current); current = ""; continue; }
    current += char;
  }
  parts.push(current);
  return parts.map((item) => item.trim()).filter(Boolean);
}

// Dernier sélecteur composé (celui qui désigne l'élément masqué).
function lastCompound(selector) {
  return splitTopLevel(selector, [" ", ">", "+", "~", "\n", "\t"]).pop() || "";
}

// Correspondance prudente : pseudo-classes ignorées (donc « peut correspondre »),
// pseudo-éléments exclus (ils ne masquent pas l'élément). `[hidden]` est piloté
// par le JS et testé à part ; `dialog:not([open])` est l'état normal fermé.
function compoundMayMatch(compound, element) {
  if (/::/.test(compound)) return false;
  if (/\[hidden\]/i.test(compound)) return false;
  if (/^dialog\b/i.test(compound) && /:not\(\[open\]\)/i.test(compound)) return false;
  const withoutPseudo = compound.replace(/:{1,2}[\w-]+(\((?:[^()]|\([^()]*\))*\))?/g, "");
  const tag = /^([a-zA-Z][\w-]*|\*)/.exec(withoutPseudo)?.[1];
  if (tag && tag !== "*" && tag.toLowerCase() !== element.tag) return false;
  for (const [, id] of withoutPseudo.matchAll(/#([\w-]+)/g)) if (element.id !== id) return false;
  for (const [, name] of withoutPseudo.matchAll(/\.([\w-]+)/g)) if (!element.classes.has(name)) return false;
  for (const [, name, value] of withoutPseudo.matchAll(/\[\s*([\w-]+)\s*(?:[~|^$*]?=\s*["']?([^"'\]]*)["']?)?\s*\]/g)) {
    if (!Object.hasOwn(element.attributes, name.toLowerCase())) return false;
    if (value !== undefined && element.attributes[name.toLowerCase()] !== value) return false;
  }
  return true;
}

function hidingOffenders(chain, css) {
  const offenders = [];
  for (const rule of cssRules(css)) {
    if (!hides(rule.body)) continue;
    for (const selector of splitTopLevel(rule.selector, [","])) {
      const compound = lastCompound(selector);
      for (const element of chain) {
        if (compoundMayMatch(compound, element)) {
          offenders.push(`${selector} → <${element.tag}${element.id ? `#${element.id}` : ""}${[...element.classes].map((name) => `.${name}`).join("")}>`);
        }
      }
    }
  }
  return offenders;
}

function linkedStylesheets(html) {
  return [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((href) => !/^https?:/i.test(href))
    .map((href) => fs.readFileSync(path.join(PUBLIC, href), "utf8"))
    .join("\n");
}

test("B4b visibilité : aucune règle CSS ne masque le panneau Goal Mode DEV ni ses ancêtres", () => {
  const chain = ancestorChain(INDEX, "goalModeDevPanel");
  assert.ok(chain, "panneau introuvable dans index.html");
  const ids = chain.map((element) => element.id).filter(Boolean);
  // Emplacement attendu : le Control Center, hors de la barre latérale.
  for (const expected of ["controlCenter", "controlCenterGoalModeDev", "goalModeDevPanel"]) {
    assert.ok(ids.includes(expected), `${expected} absent de la chaîne : ${ids.join(" > ")}`);
  }
  assert.equal(chain.some((element) => element.classes.has("operations-panel") || element.id === "approvalsPanel"), false);
  assert.equal(chain.some((element) => element.tag === "aside" || element.classes.has("sidebar")), false);
  const css = linkedStylesheets(INDEX);
  assert.ok(css.length > 1000, "feuille de style chargée");
  assert.deepEqual(hidingOffenders(chain, css), []);
});

test("B4b visibilité : le contrôle détecte bien un panneau masqué (pas de test vacant)", () => {
  // L'ancien emplacement, avec la vraie feuille de style : détecté.
  const old = `<aside class="sidebar"><section class="side-section operations-panel"><div id="approvalsPanel" class="operations-content" hidden>
    <section id="goalModeDevPanel" class="goal-mode-dev" hidden></section></div></section></aside>`;
  const offenders = hidingOffenders(ancestorChain(old, "goalModeDevPanel"), linkedStylesheets(INDEX));
  assert.ok(offenders.some((item) => item.includes(".operations-panel")), offenders.join("\n"));
  // Règles synthétiques : @media, sélecteur composé, visibility, liste de sélecteurs.
  const chain = ancestorChain(`<dialog id="controlCenter" class="control-center"><main class="control-center__content">
    <div id="controlCenterGoalModeDev" class="control-center__goal-mode-dev"><section id="goalModeDevPanel" class="goal-mode-dev"></section></div></main></dialog>`, "goalModeDevPanel");
  for (const css of [
    "@media (max-width: 760px) { .control-center__content { display: none } }",
    ".x, .control-center .control-center__goal-mode-dev { display:none!important }",
    "#goalModeDevPanel { visibility: hidden; }",
    "main.control-center__content:not(.y) { display: none }",
  ]) {
    assert.equal(hidingOffenders(chain, css).length > 0, true, css);
  }
  // Exceptions explicites : [hidden], pseudo-éléments, dialog fermé, autres éléments.
  for (const css of [
    "[hidden] { display: none !important }",
    ".goal-mode-dev::before { display: none }",
    "dialog:not([open]) { display: none }",
    ".operations-panel { display: none }",
    ".goal-mode-dev { display: grid }",
  ]) {
    assert.deepEqual(hidingOffenders(chain, css), [], css);
  }
});

// ---- Control Center : entrée « Goal Mode DEV » (vm + faux DOM) ----

class FakeElement {
  constructor(tag, id = null) {
    this.tagName = tag.toUpperCase();
    this.id = id;
    this.children = [];
    this.hidden = false;
    this.className = "";
    this.dataset = {};
    this.listeners = {};
    this.attributes = {};
    this.ownText = "";
    this.open = false;
    const element = this;
    this.classList = {
      toggle(name, force) {
        const names = new Set(element.className.split(/\s+/).filter(Boolean));
        if (force === undefined ? !names.has(name) : force) names.add(name); else names.delete(name);
        element.className = [...names].join(" ");
      },
      contains: (name) => element.className.split(/\s+/).includes(name),
    };
  }
  get childNodes() { return this.children; }
  get textContent() { return this.ownText + this.children.map((child) => child.textContent).join(""); }
  set textContent(value) { this.children = []; this.ownText = String(value); }
  set innerHTML(_) { throw new Error("innerHTML interdit"); }
  append(...nodes) { this.children.push(...nodes); }
  prepend(...nodes) { this.children.unshift(...nodes); }
  replaceChildren(...nodes) { this.children = [...nodes]; this.ownText = ""; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
  click() { for (const handler of this.listeners.click || []) handler({ target: this }); }
  querySelectorAll(selector) {
    if (selector !== "button") throw new Error(`sélecteur non pris en charge : ${selector}`);
    const all = (node) => node.children.flatMap((child) => [child, ...all(child)]);
    return all(this).filter((node) => node.tagName === "BUTTON");
  }
  showModal() { this.open = true; }
  close() { this.open = false; }
}

function loadControlCenter() {
  const ids = ["controlCenter", "controlCenterNavigation", "controlCenterOverview", "controlCenterSection",
    "controlCenterLoading", "controlCenterView", "openControlCenterButton", "closeControlCenter",
    "refreshControlCenter", "quickSettings", "controlCenterGoalModeDev", "noonVoicePolicy"];
  const nodes = Object.fromEntries(ids.map((id) => [id, new FakeElement(id === "controlCenter" ? "dialog" : "div", id)]));
  nodes.controlCenterView.value = "USER";
  nodes.controlCenterGoalModeDev.hidden = true;
  const sentinel = new FakeElement("section", "goalModeDevPanel");
  nodes.controlCenterGoalModeDev.append(sentinel);
  const urls = [];
  const fetch = async (url) => {
    urls.push(url);
    const body = url.includes("/overview")
      ? { snapshot: { availableSections: ["approvals", "goals"], sections: {}, needsAttention: [], overallStatus: "OK" } }
      : { section: { sectionId: "goals", summary: "Objectifs", status: "OK", items: [] } };
    return { ok: true, json: async () => body };
  };
  const window = {};
  const document = { getElementById: (id) => nodes[id] || null, createElement: (tag) => new FakeElement(tag) };
  const source = fs.readFileSync(path.join(PUBLIC, "control-center.js"), "utf8");
  vm.runInNewContext(source, { window, document, fetch, URLSearchParams, encodeURIComponent, Promise, Object, String, Array });
  const navLabels = () => nodes.controlCenterNavigation.children.map((button) => button.textContent);
  const navButton = (label) => nodes.controlCenterNavigation.children.find((button) => button.textContent === label);
  return { api: window.NoonControlCenter, nodes, sentinel, urls, navLabels, navButton };
}

const settle = async () => { for (let index = 0; index < 5; index += 1) await new Promise((resolve) => setImmediate(resolve)); };

test("B4b Control Center : entrée Goal Mode DEV seulement si disponible, panneau affiché sans rechargement", async () => {
  const h = loadControlCenter();
  const container = h.nodes.controlCenterGoalModeDev;
  // Indisponible (flag OFF) : aucune entrée, showGoalModeDev retombe sur la vue d'ensemble.
  await h.api.open();
  assert.deepEqual(h.navLabels(), ["Vue d’ensemble", "Validations", "Objectifs"]);
  await h.api.showGoalModeDev();
  await settle();
  assert.equal(container.hidden, true);
  // Disponible : l'entrée apparaît (navigation déjà rendue), sans requête serveur dédiée.
  h.api.setGoalModeDevAvailable(true);
  assert.deepEqual(h.navLabels(), ["Vue d’ensemble", "Validations", "Objectifs", "Goal Mode DEV"]);
  h.navButton("Goal Mode DEV").click();
  await settle();
  assert.equal(container.hidden, false);
  assert.equal(h.nodes.controlCenterOverview.hidden, true);
  assert.equal(h.nodes.controlCenterSection.hidden, true);
  assert.equal(h.nodes.controlCenterLoading.hidden, true);
  assert.ok(h.navButton("Goal Mode DEV").classList.contains("active"));
  // Actualiser reste sur le panneau, sans appeler une section serveur « goal-mode-dev ».
  h.nodes.refreshControlCenter.click();
  await settle();
  assert.equal(container.hidden, false);
  assert.equal(h.urls.some((url) => url.includes("goal-mode-dev")), false);
  // Autre section : le panneau est masqué mais jamais vidé (état et jeton conservés).
  h.navButton("Objectifs").click();
  await settle();
  assert.equal(container.hidden, true);
  assert.equal(h.nodes.controlCenterSection.hidden, false);
  assert.deepEqual(container.children, [h.sentinel]);
  // Retour au panneau, puis indisponible : entrée retirée, retour à la vue d'ensemble.
  h.navButton("Goal Mode DEV").click();
  await settle();
  h.api.setGoalModeDevAvailable(false);
  await settle();
  assert.deepEqual(h.navLabels(), ["Vue d’ensemble", "Validations", "Objectifs"]);
  assert.equal(container.hidden, true);
  assert.equal(h.nodes.controlCenterOverview.hidden, false);
  assert.deepEqual(container.children, [h.sentinel]);
});

test("B4b contrat source : Control Center ne vide jamais le conteneur Goal Mode DEV ; loadFocusProjects corrigé", () => {
  const source = fs.readFileSync(path.join(PUBLIC, "control-center.js"), "utf8");
  assert.equal(/goalModeDevContainer\.(replaceChildren|append|prepend|textContent|innerHTML)/.test(source), false);
  assert.match(source, /if \(goalModeDevContainer\) goalModeDevContainer\.hidden = true;/);
  // Bug antérieur (b993b27) : loadFocusProjects n'existait pas ; l'ajout d'un dossier levait une erreur.
  for (const file of fs.readdirSync(PUBLIC).filter((name) => name.endsWith(".js"))) {
    assert.equal(fs.readFileSync(path.join(PUBLIC, file), "utf8").includes("loadFocusProjects"), false, file);
  }
  const app = readAppSource();
  assert.match(app, /await refreshLocalFolderPermissions\(\); await loadLocalProjects\(\);/);
  assert.match(app, /\nasync function loadLocalProjects\(\) \{/);
});

test("Control Center : le bandeau de politique vocale n'apparaît que sur la vue d'ensemble", async () => {
  const h = loadControlCenter();
  const banner = h.nodes.noonVoicePolicy;
  await h.api.open();
  assert.equal(banner.hidden, false);
  h.navButton("Objectifs").click();
  await settle();
  assert.equal(banner.hidden, true);
  h.api.setGoalModeDevAvailable(true);
  h.navButton("Goal Mode DEV").click();
  await settle();
  assert.equal(banner.hidden, true);
  h.navButton("Vue d’ensemble").click();
  await settle();
  assert.equal(banner.hidden, false);
});
