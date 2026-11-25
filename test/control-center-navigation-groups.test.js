"use strict";

// Interface V3, étape 2 : la navigation du Control Center range les sections en groupes titrés.
// « Réglages » reste en tête sans titre ; une section inconnue tombe dans « Système » (jamais perdue).

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

class FakeElement {
  constructor(tagName = "div", id = "") {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.children = [];
    this.ownText = "";
    this.hidden = false;
    this.dataset = {};
    this.attributes = {};
    this.listeners = {};
    this.open = false;
    this.className = "";
    this.classList = { toggle: (name, on) => { this[`class:${name}`] = on; }, contains: (name) => Boolean(this[`class:${name}`]) };
  }
  get childNodes() { return this.children; }
  get textContent() { return this.ownText + this.children.map((child) => child.textContent).join(""); }
  set textContent(value) { this.children = []; this.ownText = String(value); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = [...nodes]; this.ownText = ""; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(type, handler) { this.listeners[type] = handler; }
  click() { this.listeners.click?.({ target: this }); }
  querySelectorAll(selector) {
    const all = (node) => node.children.flatMap((child) => [child, ...all(child)]);
    return all(this).filter((node) => node.tagName === selector.toUpperCase());
  }
  showModal() { this.open = true; }
  close() { this.open = false; }
}

function loadControlCenter(availableSections) {
  const ids = ["controlCenter", "controlCenterNavigation", "controlCenterOverview", "controlCenterSection",
    "controlCenterLoading", "controlCenterView", "closeControlCenter", "refreshControlCenter", "controlCenterSettings"];
  const nodes = Object.fromEntries(ids.map((id) => [id, new FakeElement(id === "controlCenter" ? "dialog" : "div", id)]));
  nodes.controlCenterView.value = "USER";
  const fetch = async () => ({ ok: true, json: async () => ({ snapshot: { availableSections, sections: {}, needsAttention: [], overallStatus: "HEALTHY" } }) });
  const window = {};
  const document = { getElementById: (id) => nodes[id] || null, createElement: (tag) => new FakeElement(tag) };
  const source = fs.readFileSync(path.join(__dirname, "..", "public", "control-center.js"), "utf8");
  vm.runInNewContext(source, { window, document, fetch, URLSearchParams, encodeURIComponent, Promise, Object, String, Array, Map });
  return { api: window.NoonControlCenter, navigation: nodes.controlCenterNavigation };
}

const settle = async () => { for (let index = 0; index < 5; index += 1) await new Promise((resolve) => setImmediate(resolve)); };

test("la navigation range les sections en groupes titrés, Réglages en tête", async () => {
  const h = loadControlCenter(["diagnostics", "memory", "connections", "approvals", "privacy", "workspaces", "backups"]);
  await h.api.open();
  await settle();
  const entries = h.navigation.children.map((node) => `${node.tagName === "P" ? "#" : ""}${node.textContent}`);
  assert.deepEqual(entries, [
    "Réglages",
    "#Aujourd’hui", "Vue d’ensemble", "Validations",
    "#Intégrations", "Connexions",
    "#Mémoire et confidentialité", "Mémoire", "Confidentialité",
    "#DEV", "Espaces de travail",
    "#Système", "Sauvegardes", "Diagnostics",
  ]);
});

test("une section inconnue n'est jamais perdue : elle tombe dans Système", async () => {
  const h = loadControlCenter(["future-section"]);
  await h.api.open();
  await settle();
  const entries = h.navigation.children.map((node) => node.textContent);
  assert.deepEqual(entries.slice(-2), ["Système", "future-section"]);
});

test("le picto ouvre l'onglet Réglages, actif dans la navigation", async () => {
  const h = loadControlCenter(["approvals"]);
  await h.api.open("settings");
  await settle();
  const active = h.navigation.querySelectorAll("button").find((button) => button.classList.contains("active"));
  assert.equal(active?.textContent, "Réglages");
});

test("le sélecteur « Vue » sans effet visible est retiré ; l'interface demande la vue utilisateur", async () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
  assert.doesNotMatch(html, /id="controlCenterView"/);
  const requested = [];
  const ids = ["controlCenter", "controlCenterNavigation", "controlCenterOverview", "controlCenterSection",
    "controlCenterLoading", "closeControlCenter", "refreshControlCenter", "controlCenterSettings"];
  const nodes = Object.fromEntries(ids.map((id) => [id, new FakeElement(id === "controlCenter" ? "dialog" : "div", id)]));
  const fetch = async (url) => { requested.push(url); return { ok: true, json: async () => ({ snapshot: { availableSections: ["approvals"], sections: {}, needsAttention: [], overallStatus: "HEALTHY" } }) }; };
  const window = {};
  const document = { getElementById: (id) => nodes[id] || null, createElement: (tag) => new FakeElement(tag) };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "public", "control-center.js"), "utf8"), { window, document, fetch, URLSearchParams, encodeURIComponent, Promise, Object, String, Array, Map });
  await window.NoonControlCenter.open();
  await settle();
  assert.ok(requested.length > 0);
  assert.ok(requested.every((url) => url.includes("view=USER")), requested.join(" "));
});
