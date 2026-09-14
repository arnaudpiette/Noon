"use strict";

// Vérifie les garde-fous de sécurité, les coûts vocaux et le nettoyage des sessions Realtime.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { isPathInsideRoots } = require("../lib/path-utils");
const {
  cleanupRealtimeResources,
  reconnectDelay,
} = require("../public/live-voice-core");

test("autorise un Focus dans une racine et refuse le path traversal", () => {
  const root = path.join(path.sep, "Users", "noon", "projects");
  assert.equal(isPathInsideRoots(path.join(root, "Kasa"), [root]), true);
  assert.equal(isPathInsideRoots(path.join(root, "..", "secrets"), [root]), false);
  assert.equal(isPathInsideRoots(`${root}-copie`, [root]), false);
});

test("nettoie toutes les ressources WebRTC", () => {
  const calls = [];
  const channel = { close: () => calls.push("channel") };
  const peer = { close: () => calls.push("peer") };
  const stream = { getTracks: () => [{ stop: () => calls.push("track") }] };
  const audio = { pause: () => calls.push("audio"), srcObject: {} };
  cleanupRealtimeResources({ channel, peer, stream, audio });
  assert.deepEqual(calls, ["channel", "peer", "track", "audio"]);
  assert.equal(audio.srcObject, null);
});

test("nettoie trois cycles Live successifs sans conserver de ressource", () => {
  const calls = [];
  for (let cycle = 0; cycle < 3; cycle += 1) {
    const audio = { pause: () => calls.push(`audio-${cycle}`), srcObject: {} };
    cleanupRealtimeResources({
      channel: { close: () => calls.push(`channel-${cycle}`) },
      peer: { close: () => calls.push(`peer-${cycle}`), ontrack: () => {}, onconnectionstatechange: () => {} },
      stream: { getTracks: () => [{ stop: () => calls.push(`track-${cycle}`) }] },
      audio,
    });
    assert.equal(audio.srcObject, null);
  }
  assert.equal(calls.length, 12);
});

test("limite la reconnexion à deux tentatives avec backoff", () => {
  assert.equal(reconnectDelay(0), 800);
  assert.equal(reconnectDelay(1), 1600);
  assert.equal(reconnectDelay(2), null);
});
