"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createRecordingStore } = require("../services/recorder/recording-store");

test("recording survives a restart, duplicate uploads are idempotent, corrections are versioned", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noon-recording-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let store = createRecordingStore(root);
  assert.throws(() => store.create({ mimeType: "audio/webm" }), { code: "CONSENT_REQUIRED" });
  const { id } = store.create({ mimeType: "audio/webm", consent: true });
  const first = Buffer.from("recording segment 1");
  store.append(id, { index: 0, mimeType: "audio/webm", buffer: first });
  store = createRecordingStore(root);
  assert.equal(store.load(id).state, "recording");
  store.append(id, { index: 0, mimeType: "audio/webm", buffer: first });
  assert.equal(store.load(id).chunkCount, 1);
  assert.throws(() => store.append(id, { index: 0, mimeType: "audio/webm", buffer: Buffer.from("other") }), { code: "CHUNK_CONFLICT" });
  assert.throws(() => store.append(id, { index: 2, mimeType: "audio/webm", buffer: first }), { code: "CHUNK_GAP" });
  store.append(id, { index: 1, mimeType: "audio/webm", buffer: Buffer.from("segment 2") });
  assert.equal(store.finish(id, 4200).durationMs, 4200);
  assert.equal(store.chunks(id).buffer.toString(), "recording segment 1segment 2");
  store.transcript(id, "bonjour", 0);
  assert.throws(() => store.transcript(id, "conflit", 0), { code: "REVISION_CONFLICT" });
  assert.equal(store.transcript(id, "bonjour corrigé", 1).transcriptRevision, 2);
  fs.writeFileSync(path.join(root, id, "00000001.chunk"), "tampered");
  assert.throws(() => store.chunks(id), { code: "DAMAGED_AUDIO" });
  store.remove(id);
  assert.equal(store.list().length, 0);
});

test("analysis keeps only quotations present in the current transcript and expires after a correction", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noon-recording-analysis-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = createRecordingStore(root);
  const { id } = store.create({ mimeType: "audio/webm", consent: true });
  store.append(id, { index: 0, mimeType: "audio/webm", buffer: Buffer.from("audio") });
  store.finish(id, 1000);
  store.transcript(id, "Luc : envoyer le rapport mardi.", 0);
  const record = store.analyze(id, { summary: "Un rapport est demandé.", points: [
    { kind: "action", text: "Envoyer le rapport", quote: "envoyer le rapport mardi", owner: "À confirmer", due: "À confirmer" },
    { kind: "action", text: "Inventé", quote: "vendredi prochain" },
  ] }, 1);
  assert.equal(record.analysis.points.length, 1);
  assert.equal(store.reviewPoint(id, 0, "validé", 1, 0).analysis.points[0].status, "validé");
  assert.throws(() => store.reviewPoint(id, 0, "rejeté", 1, 0), { code: "REVISION_CONFLICT" });
  assert.throws(() => store.analyze(id, {}, 0), { code: "REVISION_CONFLICT" });
  assert.equal(store.transcript(id, "Luc : envoyer le rapport jeudi.", 1).analysis, null);
});

test("speaker labels need manual confirmation and timed segments disappear after text edits", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noon-recording-speaker-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = createRecordingStore(root);
  const { id } = store.create({ mimeType: "audio/webm", consent: true });
  store.append(id, { index: 0, mimeType: "audio/webm", buffer: Buffer.from("audio") });
  store.finish(id, 1000);
  const record = store.transcript(id, "Bonjour", 0, [{ start: 0, end: 1, text: "Bonjour", speaker: "A" }, { start: -1, end: 0, text: "invalide" }]);
  assert.deepEqual(record.segments, [{ start: 0, end: 1, text: "Bonjour", speaker: "A" }]);
  assert.equal(store.nameSpeaker(id, "A", "Luc", 1).speakers.A, "Luc");
  assert.throws(() => store.nameSpeaker(id, "B", "Inconnu", 1), { code: "SPEAKER_UNKNOWN" });
  assert.equal(store.transcript(id, "Salut", 1).segments.length, 0);
  assert.deepEqual(store.load(id).speakers, {});
});

test("metadata uses optimistic revisions and library search includes transcript without exposing it in list", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noon-recording-search-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = createRecordingStore(root);
  const { id } = store.create({ mimeType: "audio/webm", consent: true });
  store.append(id, { index: 0, mimeType: "audio/webm", buffer: Buffer.from("audio") });
  store.finish(id, 1000);
  store.transcript(id, "Le secret du cours", 0);
  const updated = store.updateMetadata(id, { title: "Cours", project: "Noon", tags: ["formation"], expectedRevision: 0 });
  assert.equal(updated.metadataRevision, 1);
  assert.throws(() => store.updateMetadata(id, { title: "Erreur", project: "", tags: [], expectedRevision: 0 }), { code: "REVISION_CONFLICT" });
  assert.equal(store.list("secret")[0].id, id);
  assert.equal(Object.hasOwn(store.list("secret")[0], "transcript"), false);
  assert.equal(store.list("formation").length, 1);
  assert.equal(store.list("autre").length, 0);
});
