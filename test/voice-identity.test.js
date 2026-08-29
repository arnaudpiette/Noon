"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { NOON_VOICE_IDENTITY, createVoiceIdentity } = require("../services/voice/voice-identity");

test("TTS, Live Mini et Live Max utilisent tous marin", () => {
  const identity = createVoiceIdentity();
  assert.equal(identity.resolve({ pipeline: "tts" }).voice, "marin");
  assert.equal(identity.resolve({ pipeline: "realtime", model: "gpt-realtime-2.1-mini" }).voice, "marin");
  assert.equal(identity.resolve({ pipeline: "realtime", model: "gpt-realtime-2.1" }).voice, "marin");
});

test("Luna, Terra et Sol n'influencent jamais l'identité", () => {
  const identity = createVoiceIdentity();
  const voices = ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"]
    .map((model) => identity.resolve({ pipeline: "tts", model }).voice);
  assert.deepEqual(voices, ["marin", "marin", "marin"]);
});

test("français, anglais et espagnol conservent le même locuteur", () => {
  const identity = createVoiceIdentity();
  const results = ["fr-FR", "en-US", "es-ES"].map((language) => identity.resolve({ pipeline: "realtime", language }));
  assert.deepEqual(results.map((item) => item.identityId), ["noon-default", "noon-default", "noon-default"]);
  assert.deepEqual(results.map((item) => item.voice), ["marin", "marin", "marin"]);
});

test("le fallback arrive après deux essais marin et reste explicite", () => {
  const events = [];
  const identity = createVoiceIdentity({ debug: (event, metadata) => events.push({ event, metadata }) });
  const resolution = identity.resolve({ pipeline: "tts" });
  assert.deepEqual(identity.attempts(resolution), [
    { voice: "marin", fallback: false, attempt: 1 },
    { voice: "marin", fallback: false, attempt: 2 },
    { voice: "cedar", fallback: true, attempt: 3 },
  ]);
  identity.traceFallback(resolution, "provider_error");
  assert.equal(events.at(-1).metadata.fallback, "cedar");
  assert.equal(NOON_VOICE_IDENTITY.primaryVoice, "marin");
});

test("une nouvelle résolution après fallback retente toujours marin", () => {
  const identity = createVoiceIdentity();
  const first = identity.resolve({ pipeline: "tts" });
  identity.traceFallback(first, "temporary_error");
  assert.equal(identity.resolve({ pipeline: "tts" }).voice, "marin");
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
