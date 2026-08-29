"use strict";

// Vérifie l’échappement et les états vides utilisés par les panneaux de l’interface.

const test = require("node:test");
const assert = require("node:assert/strict");
const { escapeHtml, parseFocusCommand } = require("../public/ui-utils");

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
