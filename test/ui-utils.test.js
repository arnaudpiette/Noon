"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { escapeHtml } = require("../public/ui-utils");

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
