"use strict";

// Conversation Live : accueil des personnes déclarées et restriction serveur quand un enfant parle.

const assert = require("node:assert/strict");
const test = require("node:test");

const { CHILD_ALLOWED_TOOLS, LIVE_SPEAKERS, createLiveSpeakerRegistry, normalizeLiveSpeaker } = require("../services/voice/live-speakers");
const { REALTIME_TOOLS, createRealtimeVoiceConfig } = require("../services/voice/realtime-config");
const { createVoiceHttpRoutes } = require("../services/voice/voice-http-routes");

test("les phrases d'accueil demandées par Arnaud sont exactes", () => {
  assert.equal(LIVE_SPEAKERS.alexandra.greeting, "Ah, salut Cleopatatra ! Qu'est-ce que je peux faire pour toi, ma divine déesse ?");
  for (const child of ["kaan", "sinan"]) {
    assert.equal(LIVE_SPEAKERS[child].child, true);
    assert.equal(LIVE_SPEAKERS[child].greeting, "Mais quelle bonne surprise ! Ton père sait que tu es sur son ordi, petit schmète ?");
  }
  assert.equal(LIVE_SPEAKERS.alexandra.child, false);
  assert.equal(normalizeLiveSpeaker(" Kaan "), "kaan");
  assert.equal(normalizeLiveSpeaker("inconnu"), null);
});

test("un enfant identifié le reste jusqu'à la prochaine session Live", () => {
  const registry = createLiveSpeakerRegistry();
  assert.equal(registry.isChildSession("s1"), false);
  assert.equal(registry.declare("s1", "sinan").child, true);
  const claim = registry.declare("s1", "arnaud");
  assert.equal(claim.speaker, "sinan");
  assert.equal(claim.kept, true);
  assert.equal(registry.isChildSession("s1"), true);
  registry.start("s1");
  assert.equal(registry.isChildSession("s1"), false);
  assert.throws(() => registry.declare("s1", "quelqu'un"), { code: "LIVE_SPEAKER_UNKNOWN" });
});

const voiceIdentity = { resolve: () => ({ styleInstructions: "Voix Cedar." }) };
const memoryEngine = { getRelevantContext: () => ({ remoteContext: [{ value: "souvenir privé d'Arnaud" }] }) };
const config = createRealtimeVoiceConfig({ voiceIdentity, memoryEngine, buildSystemPrompt: (...parts) => ["Personnalité d'Arnaud.", ...parts].join(" ") });

test("la session Live connaît l'outil de déclaration ; la session enfant n'a ni historique ni souvenirs", () => {
  assert.ok(REALTIME_TOOLS.some((tool) => tool.name === "set_noon_speaker"));
  const normal = config.buildInstructions({ language: "fr", accent: "none", mode: "DA", history: [{ role: "user", content: "message privé" }] });
  assert.match(normal, /set_noon_speaker/);
  assert.match(normal, /message privé/);
  const child = config.buildChildInstructions({ speaker: LIVE_SPEAKERS.kaan });
  assert.match(child, /Kaan/);
  assert.match(child, /petit schmète/);
  assert.doesNotMatch(child, /message privé|souvenir privé|Personnalité d'Arnaud/);
  assert.deepEqual(config.childTools.map((tool) => tool.name).sort(), [...CHILD_ALLOWED_TOOLS].sort());
});

function routeHarness() {
  const calls = { askAI: 0 };
  const deps = new Proxy({
    normalizeSessionId: (value) => String(value || "default"),
    readJsonBody: async (req) => req.body,
    realtimeVoiceConfig: config,
    normalizeNoonMode: (value) => value || "DA",
    normalizeFocusName: () => null,
    normalizeFocusPath: () => null,
    resolveFocusCatalogSelection: () => null,
    createConversationKey: () => "key",
    getConversationHistory: () => [],
    refreshDailyWebSearchUsage: () => ({ calls: 0 }),
    WEB_SEARCH_DAILY_LIMIT: 10,
    askAI: async () => { calls.askAI += 1; return { answer: "données privées" }; },
  }, { has: () => true, get: (target, key) => (key in target ? target[key] : () => { throw new Error(`dépendance inattendue : ${String(key)}`); }) });
  const handle = createVoiceHttpRoutes(deps);
  async function tool(name, args, sessionId = "s1") {
    const req = { method: "POST", url: "/realtime/tool", headers: { "x-noon-request": "1" }, body: { name, arguments: args, sessionId } };
    const res = { status: 0, body: "", writeHead(code) { this.status = code; }, end(text) { this.body = text; } };
    await handle(req, res, "/realtime/tool");
    return { httpStatus: res.status, ...JSON.parse(res.body) };
  }
  return { tool, calls };
}

test("Kaan déclaré : accueil exact, session restreinte, accès aux données d'Arnaud refusé côté serveur", async () => {
  const h = routeHarness();
  const declared = await h.tool("set_noon_speaker", { speaker: "kaan" });
  assert.equal(declared.say, LIVE_SPEAKERS.kaan.greeting);
  assert.equal(declared.restricted, true);
  assert.equal(declared.clientAction.type, "restrictLiveSession");
  assert.deepEqual(declared.clientAction.tools.map((tool) => tool.name).sort(), [...CHILD_ALLOWED_TOOLS].sort());
  for (const name of ["ask_noon_brain", "manage_noon_projects", "set_noon_focus", "set_noon_mode"]) {
    const refused = await h.tool(name, { question: "Qu'a dit papa hier ?", action: "list", query: "", clear: true, mode: "DEV" });
    assert.equal(refused.httpStatus, 200);
    assert.equal(refused.status, "restricted");
    assert.equal(refused.message.includes("un enfant parle"), true, name);
  }
  assert.equal(h.calls.askAI, 0);
  const claim = await h.tool("set_noon_speaker", { speaker: "arnaud" });
  assert.equal(claim.speaker, "Kaan");
  assert.equal(claim.say, null);
});

test("Alexandra déclarée : phrase d'accueil, sans restriction", async () => {
  const h = routeHarness();
  const declared = await h.tool("set_noon_speaker", { speaker: "alexandra" }, "s2");
  assert.equal(declared.say, LIVE_SPEAKERS.alexandra.greeting);
  assert.equal(declared.restricted, false);
  assert.equal(declared.clientAction, null);
});
