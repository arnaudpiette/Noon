"use strict";

// V3-L7 — modules de routes sortis de server.js : dépendances déclarées et fournies par le
// serveur, requête étrangère rendue au serveur (NOT_HANDLED), aucun accès aux dépendances
// tant qu'aucune route ne correspond.
const assert = require("node:assert/strict");
const test = require("node:test");
const { NOT_HANDLED } = require("../services/http/route-result");
const { readServerSource } = require("./helpers/server-source");
const ROUTE_COMPOSITION = require("../services/http/route-modules-composition");

const MODULES = [
  ["../services/personal-intelligence/personal-intelligence-http-routes", "createPersonalIntelligenceHttpRoutes", "personalIntelligenceHttpRoutes"],
  ["../services/dev/dev-http-routes", "createDevHttpRoutes", "devHttpRoutes"],
  ["../services/workspaces/projects-http-routes", "createProjectsHttpRoutes", "projectsHttpRoutes"],
  ["../services/sessions/conversation-http-routes", "createConversationHttpRoutes", "conversationHttpRoutes"],
  ["../services/voice/voice-http-routes", "createVoiceHttpRoutes", "voiceHttpRoutes"],
  ["../services/control-center/system-http-routes", "createSystemHttpRoutes", "systemHttpRoutes"],
  ["../services/goals/goals-http-routes", "createGoalsHttpRoutes", "goalsHttpRoutes"],
  ["../services/voice/transcription-http-routes", "createTranscriptionHttpRoutes", "transcriptionHttpRoutes"],
  ["../services/planning/day-http-routes", "createDayHttpRoutes", "dayHttpRoutes"],
];
const server = readServerSource();

for (const [file, factory, instance] of MODULES) {
  const loaded = require(file);

  test(`${factory} : dépendance manquante refusée à la construction`, () => {
    assert.throws(() => loaded[factory]({}), /Dépendance manquante/);
  });

  test(`${factory} : requête étrangère → NOT_HANDLED, rien n'est écrit`, async () => {
    // Dépendance neutre : toute propriété la renvoie, tout appel répond undefined (ex. un
    // `autreModule.matches(requestPath)` en tête de bloc répond « non »).
    const inert = new Proxy(function inert() {}, { get: (target, key) => (key === Symbol.toPrimitive ? () => "\u0000inert" : typeof key === "symbol" ? undefined : inert), apply: () => undefined });
    const deps = Object.fromEntries(loaded.DEPENDENCIES.map((name) => [name, inert]));
    const handle = loaded[factory](deps);
    const res = { writeHead() { throw new Error("aucune réponse attendue"); }, end() { throw new Error("aucune réponse attendue"); } };
    for (const method of ["GET", "POST"]) {
      assert.equal(await handle({ method, url: "/route-inexistante", headers: {} }, res, "/route-inexistante"), NOT_HANDLED);
    }
  });

  test(`${factory} : le serveur fournit chaque dépendance par un accesseur`, () => {
    // Construction groupée : le module est enregistré avec sa propre fabrique et ses propres
    // DEPENDENCIES, et l'objet d'accesseurs de server.js expose chacune d'elles.
    const entry = ROUTE_COMPOSITION.ROUTE_MODULES.find(([name]) => name === instance);
    assert.ok(entry, instance);
    assert.equal(entry[1], loaded[factory]);
    assert.equal(entry[2], loaded.DEPENDENCIES);
    const start = server.indexOf("const httpRouteDependencies = {");
    assert.notEqual(start, -1);
    const accessors = server.slice(start, server.indexOf("\n};", start));
    for (const name of loaded.DEPENDENCIES) assert.ok(accessors.includes(`get ${name}() { return ${name}; },`), name);
    assert.match(server, new RegExp(`\\n  ${instance},\\n[\\s\\S]*?\\} = createHttpRouteModules\\(httpRouteDependencies\\);`));
    assert.match(server, new RegExp(`await ${instance}\\(req, res, requestPath\\);\\n\\s*if \\(routed !== NOT_HANDLED\\) return routed;`));
  });
}

test("pickDependencies : seulement les noms déclarés, relus à chaque accès, dépendance manquante refusée", () => {
  const { pickDependencies } = require("../services/http/route-dependencies");
  let late;
  const source = { get late() { return late; }, other: "non déclaré" };
  const picked = pickDependencies(source, ["late"]);
  assert.deepEqual(Object.keys(picked), ["late"]);
  assert.equal(picked.late, undefined);
  late = "initialisé plus tard";
  assert.equal(picked.late, "initialisé plus tard");
  assert.equal("other" in picked, false);
  assert.throws(() => pickDependencies(source, ["absente"]), /Dépendance manquante : absente/);
});

test("construction groupée : chaque module de routes reçoit exactement ses DEPENDENCIES", () => {
  const { pickDependencies } = require("../services/http/route-dependencies");
  const source = new Proxy({}, { has: () => true, get: (target, key) => `valeur:${String(key)}` });
  for (const [name, , dependencies] of ROUTE_COMPOSITION.ROUTE_MODULES) {
    assert.deepEqual(Object.keys(pickDependencies(source, dependencies)), [...dependencies], name);
  }
  assert.equal(new Set(ROUTE_COMPOSITION.ROUTE_MODULES.map(([name]) => name)).size, ROUTE_COMPOSITION.ROUTE_MODULES.length);
  assert.deepEqual(ROUTE_COMPOSITION.HTTP_ROUTE_DEPENDENCIES, [...new Set(ROUTE_COMPOSITION.ROUTE_MODULES.flatMap(([, , dependencies]) => dependencies))].sort());
});
