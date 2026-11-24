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
const { DEPENDENCIES: HTTP_SERVER_DEPENDENCIES } = require("../services/http/noon-http-server");

// Noms exposés par l'objet d'accesseurs de server.js, chacun sous la forme exacte
// `get nom() { return nom; },`.
function routeAccessors() {
  const start = server.indexOf("const httpRouteDependencies = {\n");
  assert.notEqual(start, -1);
  const body = server.slice(server.indexOf("\n", start) + 1, server.indexOf("\n};", start)).split("\n");
  return body.map((line) => {
    const match = /^ {2}get ([A-Za-z_$][\w$]*)\(\) \{ return ([A-Za-z_$][\w$]*); \},$/.exec(line);
    assert.ok(match && match[1] === match[2], line);
    return match[1];
  });
}

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
    // Import statique : fourni par la composition, jamais aussi par un accesseur de server.js.
    const accessors = routeAccessors();
    for (const name of loaded.DEPENDENCIES) {
      if (name in ROUTE_COMPOSITION.STATIC_ROUTE_DEPENDENCIES) assert.equal(accessors.includes(name), false, name);
      else assert.ok(accessors.includes(name), name);
    }
    assert.ok(HTTP_SERVER_DEPENDENCIES.includes(instance), instance);
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

test("composition : server.js expose exactement les dépendances vivantes, et passe toutes les routes au serveur HTTP", () => {
  assert.deepEqual(routeAccessors(), [...ROUTE_COMPOSITION.HTTP_ROUTE_LIVE_DEPENDENCIES]);
  assert.match(server, /\nconst httpRouteModules = createHttpRouteModules\(httpRouteDependencies\);\n/);
  assert.match(server, /createNoonHttpServer\(\{\n {2}\.\.\.httpRouteModules,\n/);
  for (const [name] of ROUTE_COMPOSITION.ROUTE_MODULES) assert.ok(HTTP_SERVER_DEPENDENCIES.includes(name), name);
});

test("imports statiques : mêmes objets que les modules d'origine, aucun recouvrement avec server.js", () => {
  const sources = {
    fs: [require("fs")], path: [require("path")], crypto: [require("crypto")],
    PRIORITY_DIRECTORIES: ["../config"],
    modelForQuality: ["../lib/voice-utils"], normalizeAccent: ["../lib/voice-utils"],
    normalizeLanguage: ["../lib/voice-utils"], normalizeVoiceQuality: ["../lib/voice-utils"],
    buildFocusCatalog: ["../lib/focus-catalog"], resolveProject: ["../lib/projects-registry"],
    findCodexExecutable: ["../lib/codex-bridge"], normalizeIntelligenceProfile: ["../lib/noon-intelligence"],
    CHARACTER_DIALS: ["../services/character/character-charter", "DIALS"],
    GENERAL_FOLDER_ID: ["../lib/conversation-index"], MAX_FOLDERS: ["../lib/conversation-index"],
    MAX_CONVERSATIONS_PER_FOLDER: ["../lib/conversation-index"], createFolder: ["../lib/conversation-index"],
    renameFolder: ["../lib/conversation-index"], updateConversation: ["../lib/conversation-index"],
    deleteFolder: ["../lib/conversation-index"],
    REALTIME_MODELS: ["../services/voice/openai-voice-provider"],
    assertRemoteVoiceAvailable: ["../services/voice/realtime-config"],
    renderResumeBriefing: ["../services/resume/resume-briefing-service"],
    renderFirstStep: ["../services/first-step/first-step-service"],
    DEFAULT_WEIGHTS: ["../services/personal-intelligence/priority-engine"],
    GOAL_MODE_DEV_HTTP_PREFIX: ["../services/goals/goal-mode-dev-http-routes"],
    assertGenericApprovalAllowed: ["../services/approvals/goal-mode-dev-approval-guard"],
    genericApprovals: ["../services/approvals/goal-mode-dev-approval-guard"],
    goalDevRetryHttpStatus: ["../services/goals/goal-dev-retry-http-contract"],
    normalizeGoalDevRetryPrepareRequest: ["../services/goals/goal-dev-retry-http-contract"],
    normalizeGoalDevRetryResumeRequest: ["../services/goals/goal-dev-retry-http-contract"],
    projectGoalDevRetryPermitResponse: ["../services/goals/goal-dev-retry-http-contract"],
    projectGoalDevRetryResumeResponse: ["../services/goals/goal-dev-retry-http-contract"],
    assertDevTaskIdNotReserved: ["../services/dev/dev-task-id-namespace"],
    isReservedGoalModeDevTaskId: ["../services/dev/dev-task-id-namespace"],
    toChatProgressEvent: ["../services/observability/chat-progress-event"],
    WEB_SEARCH_PRICE_PER_CALL: ["../services/observability/model-pricing"],
    getErrorHeader: ["../services/http/request-utils"], readJsonBody: ["../services/http/request-utils"],
    readTextBody: ["../services/http/request-utils"], validateAttachment: ["../services/http/request-utils"],
    resolveChatResearchPlan: ["../services/research/chat-research-gate"],
  };
  assert.deepEqual(Object.keys(ROUTE_COMPOSITION.STATIC_ROUTE_DEPENDENCIES).sort(), Object.keys(sources).sort());
  for (const [name, [origin, exportName = name]] of Object.entries(sources)) {
    const expected = typeof origin === "string" ? require(origin)[exportName] : origin;
    assert.notEqual(expected, undefined, name);
    assert.equal(ROUTE_COMPOSITION.STATIC_ROUTE_DEPENDENCIES[name], expected, name);
  }
  assert.equal(Object.isFrozen(ROUTE_COMPOSITION.STATIC_ROUTE_DEPENDENCIES), true);
});

test("createHttpRouteModules : construit les 20 modules, refuse une dépendance absente ou fournie deux fois", () => {
  const live = (names) => Object.defineProperties({}, Object.fromEntries(names.map((name) => [name, { get: () => undefined, enumerable: true }])));
  const modules = ROUTE_COMPOSITION.createHttpRouteModules(live(ROUTE_COMPOSITION.HTTP_ROUTE_LIVE_DEPENDENCIES));
  assert.deepEqual(Object.keys(modules), ROUTE_COMPOSITION.ROUTE_MODULES.map(([name]) => name));
  for (const handler of Object.values(modules)) assert.equal(typeof handler, "function");
  const [missing, ...rest] = ROUTE_COMPOSITION.HTTP_ROUTE_LIVE_DEPENDENCIES;
  assert.throws(() => ROUTE_COMPOSITION.createHttpRouteModules(live(rest)), new RegExp(`Dépendance manquante : ${missing}$`));
  assert.throws(() => ROUTE_COMPOSITION.createHttpRouteModules(live([...ROUTE_COMPOSITION.HTTP_ROUTE_LIVE_DEPENDENCIES, "readJsonBody"])), /Dépendance fournie deux fois : readJsonBody/);
});
