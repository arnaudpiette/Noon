"use strict";

// V3-L7 — modules de routes sortis de server.js : dépendances déclarées et fournies par le
// serveur, requête étrangère rendue au serveur (NOT_HANDLED), aucun accès aux dépendances
// tant qu'aucune route ne correspond.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { NOT_HANDLED } = require("../services/http/route-result");

const MODULES = [
  ["../services/personal-intelligence/personal-intelligence-http-routes", "createPersonalIntelligenceHttpRoutes", "personalIntelligenceHttpRoutes"],
  ["../services/dev/dev-http-routes", "createDevHttpRoutes", "devHttpRoutes"],
];
const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

for (const [file, factory, instance] of MODULES) {
  const loaded = require(file);

  test(`${factory} : dépendance manquante refusée à la construction`, () => {
    assert.throws(() => loaded[factory]({}), /Dépendance manquante/);
  });

  test(`${factory} : requête étrangère → NOT_HANDLED, rien n'est écrit`, async () => {
    const deps = Object.fromEntries(loaded.DEPENDENCIES.map((name) => [name, undefined]));
    const handle = loaded[factory](deps);
    const res = { writeHead() { throw new Error("aucune réponse attendue"); }, end() { throw new Error("aucune réponse attendue"); } };
    for (const method of ["GET", "POST"]) {
      assert.equal(await handle({ method, url: "/route-inexistante", headers: {} }, res, "/route-inexistante"), NOT_HANDLED);
    }
  });

  test(`${factory} : le serveur fournit chaque dépendance par un accesseur`, () => {
    const start = server.indexOf(`const ${instance} = ${factory}({`);
    assert.notEqual(start, -1);
    const construction = server.slice(start, server.indexOf("});", start));
    for (const name of loaded.DEPENDENCIES) assert.ok(construction.includes(`get ${name}() { return ${name}; },`), name);
    assert.match(server, new RegExp(`await ${instance}\\(req, res, requestPath\\);\\n\\s*if \\(routed !== NOT_HANDLED\\) return routed;`));
  });
}
