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

test("importe une piste locale en segments puis restitue les octets d'origine", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noon-recorder-"));
  try {
    const source = path.join(root, "sample.webm");
    const original = Buffer.alloc(400_000, 42);
    Buffer.from([0x1a, 0x45, 0xdf, 0xa3]).copy(original);
    fs.writeFileSync(source, original);
    const store = createRecorderStore(root);
    const record = await store.importAudio(source, "audio/webm", "sample.webm");
    assert.equal(record.state, "available");
    assert.equal(record.chunks.length, 2, "segments de 256 Ko");
    assert.deepEqual(Buffer.concat(record.chunks.map(({ index }) => Buffer.from(store.chunk(record.id, index).data, "base64"))), original);
    fs.writeFileSync(source, "texte qui n'est pas un audio");
    await assert.rejects(store.importAudio(source, "audio/webm", "invalid"), /audio valide/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("renomme puis supprime uniquement une prise terminée", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noon-recorder-"));
  try {
    const store = createRecorderStore(root);
    const record = store.create({ mimeType: "audio/webm" });
    assert.throws(() => store.remove(record.id), /active/);
    store.append(record.id, { index: 0, durationMs: 1000, data: Buffer.from("audio").toString("base64") });
    store.setState(record.id, "available");
    store.rename(record.id, "Entretien");
    assert.equal(store.list()[0].title, "Entretien");
    store.remove(record.id);
    assert.equal(store.list().length, 0);
    assert.throws(() => store.remove("../outside"), /invalide/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("une capture orpheline (renderer rechargé) est close comme interrompue et libère la suivante", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noon-recorder-"));
  try {
    const store = createRecorderStore(root);
    assert.equal(store.interruptActive(), null);
    const orphan = store.create({ title: "Orpheline", mimeType: "audio/webm" });
    store.append(orphan.id, { index: 0, durationMs: 4000, data: Buffer.from("segment-a").toString("base64") });
    assert.throws(() => store.create({ mimeType: "audio/webm" }), /déjà actif/);
    assert.deepEqual(store.interruptActive(), { id: orphan.id });
    const closed = store.list().find(({ id }) => id === orphan.id);
    assert.equal(closed.state, "interrupted");
    assert.equal(closed.durationMs, 4000);
    assert.equal(closed.missingSegments, 0);
    store.rename(orphan.id, "Renommée");
    const next = store.create({ mimeType: "audio/webm" });
    assert.notEqual(next.id, orphan.id);
    assert.throws(() => store.append(orphan.id, { index: 1, durationMs: 1, data: Buffer.from("x").toString("base64") }), /inactive/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("repères de transcription : validés, conservés lors d'une correction manuelle, refusés s'ils sont incohérents", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noon-recorder-"));
  try {
    const store = createRecorderStore(root);
    const record = store.create({ mimeType: "audio/webm" });
    store.append(record.id, { index: 0, durationMs: 1000, data: Buffer.from("a").toString("base64") });
    store.setState(record.id, "available");
    const segments = [{ startMs: 0, endMs: 230_000 }, { startMs: 230_000, endMs: 470_000 }];
    assert.deepEqual(store.saveTranscript(record.id, "[00:00] a\n\n[03:50] b", "openai", segments).segments, segments);
    assert.deepEqual(store.saveTranscript(record.id, "[00:00] a corrigé\n\n[03:50] b", "manual").segments, segments, "correction manuelle : repères conservés");
    assert.equal(store.saveTranscript(record.id, "texte", "openai").segments, undefined, "nouvelle transcription sans découpe : pas de repères hérités");
    for (const bad of [[], [{ startMs: 10, endMs: 5 }], [{ startMs: 0, endMs: 10 }, { startMs: 5, endMs: 20 }], [{ startMs: 0.5, endMs: 10 }], "x"]) {
      assert.throws(() => store.saveTranscript(record.id, "t", "openai", bad), /Repères/);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
