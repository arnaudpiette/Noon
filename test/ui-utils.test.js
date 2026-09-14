"use strict";

// Vérifie l’échappement et les états vides utilisés par les panneaux de l’interface.

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  escapeHtml,
  parseFocusCommand,
  shouldConvertPastedText,
  createPastedTextFileName,
  maskPrivateMemoryValue,
  privateMemoryCategoryLabel,
} = require("../public/ui-utils");

test("échappe les valeurs injectées dans les chaînes HTML", () => {
  assert.equal(
    escapeHtml('<script data-label="Noon">Tom & Jerry\'s</script>'),
    "&lt;script data-label=&quot;Noon&quot;&gt;Tom &amp; Jerry&#039;s&lt;/script&gt;"
  );
});

test("accepte les valeurs absentes sans casser le panneau", () => {
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml(undefined), "");
});

test("ne confond pas une mention du projet Focus avec une commande", () => {
  assert.equal(parseFocusCommand("dis-moi ce qui manque sur le projet focus"), null);
  assert.deepEqual(parseFocusCommand("Focus sur Kasa"), {
    action: "select",
    name: "Kasa",
  });
  assert.deepEqual(parseFocusCommand("Retire le focus"), {
    action: "clear",
    name: null,
  });
});

test("convertit uniquement les collages dépassant le seuil en fichier", () => {
  assert.equal(shouldConvertPastedText("a".repeat(12_000)), false);
  assert.equal(shouldConvertPastedText("a".repeat(12_001)), true);
  assert.equal(shouldConvertPastedText(null), false);
});

test("génère un nom de fichier texte stable et sûr", () => {
  assert.equal(
    createPastedTextFileName(new Date("2026-09-13T08:09:10.123Z")),
    "texte-colle-2026-09-13T08-09-10-123Z.txt"
  );
});

test("masque une mémoire privée sans révéler son contenu ni sa longueur", () => {
  const shortMask = maskPrivateMemoryValue("secret court fictif");
  const longMask = maskPrivateMemoryValue("secret fictif ".repeat(50));
  assert.equal(shortMask, "••••••••••••");
  assert.equal(longMask, shortMask);
  assert.doesNotMatch(shortMask, /secret/i);
});

test("conserve la catégorie existante et utilise Autres uniquement si elle manque", () => {
  assert.equal(privateMemoryCategoryLabel("préférences"), "préférences");
  assert.equal(privateMemoryCategoryLabel(""), "Autres");
});
