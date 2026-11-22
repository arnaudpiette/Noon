"use strict";

// V3-L7 (A.5) — interface découpée par écran : ordre déclaré = fichiers présents, chaque morceau
// sous 1 500 lignes et syntaxiquement autonome, servi recollé en un seul /app.js.
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { APP_PARTS, appPartsDirectory, readAppBundle } = require("../services/http/app-bundle");

const PUBLIC = path.join(__dirname, "..", "public");

test("morceaux : liste déclarée = fichiers présents, chacun < 1 500 lignes et lisible seul", () => {
  const present = fs.readdirSync(appPartsDirectory(PUBLIC)).filter((name) => name.endsWith(".js")).sort();
  assert.deepEqual([...APP_PARTS].sort(), present);
  for (const name of APP_PARTS) {
    const source = fs.readFileSync(path.join(appPartsDirectory(PUBLIC), name), "utf8");
    assert.ok(source.split("\n").length <= 1500, `${name} dépasse 1 500 lignes`);
    assert.doesNotThrow(() => new vm.Script(source, { filename: name }), name);
  }
  assert.equal(fs.existsSync(path.join(PUBLIC, "app.js")), false, "plus de public/app.js monolithique");
});

test("recollage : un seul script, ordre préservé, servi en /app.js", () => {
  const bundle = readAppBundle(PUBLIC);
  assert.doesNotThrow(() => new vm.Script(bundle, { filename: "app.js" }));
  assert.ok(bundle.startsWith(fs.readFileSync(path.join(appPartsDirectory(PUBLIC), APP_PARTS[0]), "utf8")));
  assert.ok(bundle.indexOf("// DEV_PREVIEW_UI_START") < bundle.indexOf("// DEV_WORKSPACE_AGENT_UI_START"));
  assert.equal(require("../services/http/static-assets").STATIC_ASSETS["/app.js"].bundle, true);
  assert.match(fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8"), /staticAssets\.matches\(req\)/);
  assert.ok(fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8").includes('<script src="app.js"></script>'));
});
