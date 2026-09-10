"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { NOON_VOICE_IDENTITY, createVoiceIdentity } = require("../services/voice/voice-identity");
const { assertRemoteVoiceAvailable, createRealtimeVoiceConfig } = require("../services/voice/realtime-config");

test("TTS, Live Mini et Live Max utilisent tous arbor", () => {
  const identity = createVoiceIdentity();
  assert.equal(identity.resolve({ pipeline: "tts" }).voice, "arbor");
  assert.equal(identity.resolve({ pipeline: "realtime", model: "gpt-realtime-2.1-mini" }).voice, "arbor");
  assert.equal(identity.resolve({ pipeline: "realtime", model: "gpt-realtime-2.1" }).voice, "arbor");
});

test("Luna, Terra, Sol et Astra n'influencent jamais l'identité", () => {
  const identity = createVoiceIdentity();
  const voices = ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol", "gpt-6-astra"]
    .map((model) => identity.resolve({ pipeline: "tts", model }).voice);
  assert.deepEqual(voices, ["arbor", "arbor", "arbor", "arbor"]);
});

test("français, anglais et espagnol conservent le même locuteur", () => {
  const identity = createVoiceIdentity();
  const results = ["fr-FR", "en-US", "es-ES"].map((language) => identity.resolve({ pipeline: "realtime", language }));
  assert.deepEqual(results.map((item) => item.identityId), ["noon-default", "noon-default", "noon-default"]);
  assert.deepEqual(results.map((item) => item.voice), ["arbor", "arbor", "arbor"]);
});

test("Arbor indisponible interdit toute tentative fournisseur", () => {
  const events = [];
  const identity = createVoiceIdentity({ debug: (event, metadata) => events.push({ event, metadata }) });
  const resolution = identity.resolve({ pipeline: "tts" });
  assert.deepEqual(identity.attempts(resolution), []);
  assert.throws(() => identity.assertAvailable(), { code: "VOICE_UNAVAILABLE" });
  identity.traceFallback(resolution, "provider_error");
  assert.equal(events.at(-1).metadata.fallback, null);
  assert.equal(NOON_VOICE_IDENTITY.primaryVoice, "arbor");
});

test("une nouvelle résolution conserve Arbor indisponible", () => {
  const identity = createVoiceIdentity();
  const first = identity.resolve({ pipeline: "tts" });
  identity.traceFallback(first, "temporary_error");
  assert.equal(identity.resolve({ pipeline: "tts" }).voice, "arbor");
});

test("périphérique et qualité restent des réglages de session", () => {
  const identity = createVoiceIdentity();
  const before = identity.resolve({ pipeline: "realtime", model: "gpt-realtime-2.1-mini", deviceId: "micro-a" });
  const after = identity.resolve({ pipeline: "realtime", model: "gpt-realtime-2.1", deviceId: "casque-b" });
  assert.equal(before.identityId, after.identityId);
  assert.equal(before.voice, after.voice);
});

test("les métriques et identifiants ne contiennent aucun contenu parlé", () => {
  let tick = 10;
  const identity = createVoiceIdentity({ now: () => tick++ });
  const resolved = identity.resolve({ pipeline: "tts", language: "fr-FR" });
  assert.equal(resolved.voiceIdentityResolveMs, 1);
  assert.match(identity.createSessionId(), /^voice_[0-9a-f-]+$/);
  assert.equal(Object.hasOwn(resolved, "text"), false);
});

test("Realtime impose le cerveau canonique pour toute question ou action", () => {
  const config = createRealtimeVoiceConfig({
    voiceIdentity: createVoiceIdentity(),
    memoryEngine: { getRelevantContext: () => ({ remoteContext: [] }) },
    buildSystemPrompt: (value) => value,
  });
  const instructions = config.buildInstructions({ history: [] });
  assert.match(instructions, /chaque question, analyse, demande d.action/);
  assert.match(instructions, /IntentCommandEngine.*ModelRouter.*ApprovalEngine/);
});

test("local-only bloque Realtime, transcription et TTS avant tout appel distant", () => {
  let calls = 0;
  const runtime = {
    preflight({ requiredCapabilities }) {
      calls += 1;
      assert.equal(requiredCapabilities[0].startsWith("REMOTE_"), true);
      return { status: "UNAVAILABLE" };
    },
  };
  for (const capability of ["REMOTE_REALTIME", "REMOTE_TRANSCRIPTION", "REMOTE_REALTIME"]) {
    assert.throws(() => assertRemoteVoiceAvailable(runtime, capability), {
      code: "LOCAL_ONLY_REMOTE_VOICE_BLOCKED",
    });
  }
  assert.equal(calls, 3);
});

test("chosen voice survives a fresh process and ignores environment voice overrides", () => {
  const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
  const { execFileSync } = require('node:child_process');
  const { saveVoiceChoice } = require('../services/voice/voice-identity');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'noon-voice-test-'));
  const file = path.join(directory, 'voice-identity.json');
  try {
    saveVoiceChoice(file, 'arbor');
    const script = `const v=require(${JSON.stringify(require.resolve('../services/voice/voice-identity'))}).createVoiceIdentity({selectionPath:process.argv[1]});console.log(JSON.stringify(['tts','realtime'].map(pipeline=>v.resolve({pipeline}).voice)))`;
    for (let i = 0; i < 2; i++) assert.deepEqual(JSON.parse(execFileSync(process.execPath, ['-e', script, file], { env: { ...process.env, OPENAI_VOICE: 'nova' } }).toString()), ['arbor','arbor']);
    assert.throws(() => saveVoiceChoice(file, 'onyx'));
    fs.writeFileSync(file, '{"voice":"invalid"}');
    assert.equal(createVoiceIdentity({ selectionPath: file }).identity.targetVoice, "arbor");
  } finally { fs.rmSync(directory, { recursive:true, force:true }); }
});

test("runtime voice payloads use canonical resolution without browser or literal fallback", () => {
  const fs = require('node:fs');
  const server = fs.readFileSync(require.resolve('../server'), 'utf8');
  assert.match(server, /output: \{ voice: resolvedVoice.voice \}/);
  assert.match(server, /voiceIdentity.attempts\(resolvedVoice\)/);
  assert.match(server, /voice: attempt.voice/);
  for (const file of ['../server.js','../public/app.js','../public/live-voice.js','../services/voice/realtime-config.js']) {
    const code = fs.readFileSync(require.resolve(file),'utf8');
    assert.doesNotMatch(code, /voice\s*:\s*["'](?:marin|cedar|alloy|ash|ballad|coral|echo|fable|nova|onyx|sage|shimmer|verse)["']/);
    assert.doesNotMatch(code, /speechSynthesis\.speak\(|utterance\.voice/);
  }
});

for (const speaker of ["marin", "cedar", "macOS", "speechSynthesis"]) {
  test(`Arbor unavailable does not fallback to ${speaker}`, () => {
    const identity = createVoiceIdentity({ identity: { primaryVoice: speaker, fallbackVoice: speaker } });
    assert.equal(identity.identity.targetVoice, "arbor");
    assert.equal(identity.publicConfig().fallbackSpeakerAllowed, false);
    assert.deepEqual(identity.attempts(identity.resolve()), []);
    assert.throws(() => identity.assertAvailable(), { code: "VOICE_UNAVAILABLE" });
  });
}
test("audio guards precede remote requests and live microphone with no unsupported retry loop", () => {
  const fs = require("node:fs");
  const server = fs.readFileSync(require.resolve("../server"), "utf8");
  for (const route of ['req.url.startsWith("/realtime/session")', 'req.url === "/tts"']) {
    const handler = server.slice(server.indexOf(route));
    assert.ok(handler.indexOf("voiceIdentity.assertAvailable()") < handler.indexOf("assertRemoteVoiceAvailable("));
  }
  const live = fs.readFileSync(require.resolve("../public/live-voice"), "utf8");
  assert.ok(live.indexOf("await this.loadVoiceIdentity(requestedModel)") < live.indexOf("await navigator.mediaDevices.getUserMedia"));
  assert.match(live, /setState\("VoiceUnavailable", error.message\);\s*return;/);
});
test("wake detection and text greeting remain independent of audio availability", () => {
  const fs = require("node:fs");
  const app = fs.readFileSync(require.resolve("../public/app"), "utf8");
  assert.match(app, /link.action === "wake"[\s\S]*?greetArnaudWithDailyBrief/);
  const greeting = app.slice(app.indexOf("async function greetArnaudWithDailyBrief"));
  assert.ok(greeting.indexOf("await loadCreativeBrief(") < greeting.indexOf("await speakNoon("));
});
