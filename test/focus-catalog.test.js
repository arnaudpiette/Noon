"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  FOCUS_CATALOG,
  buildFocusCatalog,
  compareFocusEntries,
  findFocusEntry,
  safelyResolveDirectory,
} = require("../lib/focus-catalog");

const EXPECTED_LABELS = [
  "App cig", "Applications", "Corsaire", "Cours", "DEV", "Freelance",
  "Lieucommun", "Noon", "Openclassrooms", "portfolio", "Projet1", "Projet2",
  "Projet3", "Projet4", "Projet5", "Projet6", "Projet7", "Projet8",
  "•Teasfolio", "Téléchargement", "Website", "Website-arnaudpiette",
];

test("contient exactement les 22 libellés demandés sans doublon et dans l’ordre", () => {
  const sorted = [...FOCUS_CATALOG].sort(compareFocusEntries);
  const labels = sorted.map((entry) => entry.displayName);
  assert.deepEqual(labels, EXPECTED_LABELS);
  assert.equal(new Set(labels).size, labels.length);
  assert.notEqual(labels.indexOf("App cig"), labels.indexOf("Applications"));
  assert.ok(labels.includes("DEV"));
});

test("place Noon entre Lieucommun et Openclassrooms et reconnaît ses commandes", () => {
  const sorted = [...FOCUS_CATALOG].sort(compareFocusEntries);
  const labels = sorted.map((entry) => entry.displayName);
  assert.equal(labels.indexOf("Noon"), labels.indexOf("Lieucommun") + 1);
  assert.equal(labels.indexOf("Openclassrooms"), labels.indexOf("Noon") + 1);
  assert.equal(findFocusEntry("Focus sur Noon", FOCUS_CATALOG).id, "noon");
  assert.equal(findFocusEntry("assistant noon", FOCUS_CATALOG).id, "noon");
});

test("applique le tri numérique et classe Teasfolio sans la puce", () => {
  const entries = [
    { sortName: "Projet10" },
    { sortName: "•Teasfolio".replace(/^•/, "") },
    { sortName: "Projet2" },
  ].sort(compareFocusEntries);
  assert.deepEqual(entries.map((entry) => entry.sortName), ["Projet2", "Projet10", "Teasfolio"]);
});

test("reconnaît les alias Teasfolio, Projet 5 et Téléchargements", () => {
  assert.equal(findFocusEntry("Teasfolio", FOCUS_CATALOG).id, "teasfolio");
  assert.equal(findFocusEntry("Projet 5", FOCUS_CATALOG).id, "projet-5");
  assert.equal(findFocusEntry("Téléchargements", FOCUS_CATALOG).id, "telechargement");
});

test("marque une entrée inexistante comme Introuvable", () => {
  const catalog = buildFocusCatalog([path.join(os.tmpdir(), "racine-focus-absente")]);
  const dev = catalog.find((entry) => entry.id === "dev");
  assert.equal(dev.available, false);
  assert.equal(dev.status, "missing");
});

test("refuse le path traversal et un lien symbolique sortant", (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "noon-focus-"));
  const root = path.join(base, "root");
  const outside = path.join(base, "outside");
  fs.mkdirSync(root);
  fs.mkdirSync(outside);
  const link = path.join(root, "escape");
  fs.symlinkSync(outside, link, "dir");
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));

  assert.equal(safelyResolveDirectory(path.join(root, "..", "outside"), [root]), null);
  assert.equal(safelyResolveDirectory(link, [root]), null);
});
