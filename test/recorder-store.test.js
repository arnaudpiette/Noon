"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createRecorderStore } = require("../lib/recorder-store");

test("la capture longue conserve les segments et récupère une session interrompue", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noon-recorder-"));
  try {
    const store = createRecorderStore(root);
    const recording = store.create({ title: "Réunion", mimeType: "audio/webm" });
    store.append(recording.id, { index: 0, durationMs: 4000, data: Buffer.from("segment-a").toString("base64") });
    store.setState(recording.id, "paused");
    assert.throws(() => store.append(recording.id, { index: 1, durationMs: 4000, data: Buffer.from("x").toString("base64") }), /séquence/);
    store.setState(recording.id, "recording");
    store.append(recording.id, { index: 1, durationMs: 1200, data: Buffer.from("segment-b").toString("base64") });
    const recovered = createRecorderStore(root).list()[0];
    assert.equal(recovered.state, "interrupted");
    assert.equal(recovered.durationMs, 5200);
    assert.equal(createRecorderStore(root).chunk(recording.id, 0).data, Buffer.from("segment-a").toString("base64"));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("un segment endommagé est refusé à la lecture et exclu de la récupération", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noon-recorder-"));
  try {
    const store = createRecorderStore(root);
    const recording = store.create({ mimeType: "audio/webm" });
    store.append(recording.id, { index: 0, durationMs: 3000, data: Buffer.from("audio").toString("base64") });
    fs.writeFileSync(path.join(root, "recordings", recording.id, "000000.media"), "tampered");
    assert.throws(() => store.chunk(recording.id, 0), /endommagé/);
    const recovered = createRecorderStore(root).list()[0];
    assert.equal(recovered.state, "interrupted");
    assert.equal(recovered.durationMs, 0);
    assert.equal(recovered.chunks.length, 0);
    assert.throws(() => store.chunk("../x", 0), /invalide/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("la transcription corrigée reste disponible après redémarrage sans effacer l'original", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noon-recorder-"));
  try {
    const store = createRecorderStore(root);
    const recording = store.create({ mimeType: "audio/webm" });
    store.append(recording.id, { index: 0, durationMs: 2500, data: Buffer.from("original").toString("base64") });
    store.setState(recording.id, "available");
    store.saveTranscript(recording.id, "Texte reconnu", "openai");
    store.saveTranscript(recording.id, "Texte corrigé", "manual");
    const restarted = createRecorderStore(root);
    assert.equal(restarted.list()[0].transcript.text, "Texte corrigé");
    assert.equal(restarted.list()[0].transcript.revision, 2);
    assert.equal(Buffer.from(restarted.chunk(recording.id, 0).data, "base64").toString(), "original");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
