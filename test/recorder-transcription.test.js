"use strict";

// Recorder V1 (V3-L8), E.2 : transcription par OpenAI seulement sur accord explicite pour chaque
// enregistrement ; texte et passages horodatés gardés sur le Mac.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createRecorderStore, MAX_TRANSCRIPTION_BYTES } = require("../services/recorder/recorder-service");
const { createOpenAiRecorderTranscriber, estimateTranscriptionCostUsd, RECORDER_TRANSCRIPTION_MODEL } = require("../services/recorder/recorder-transcriber");

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "noon-recorder-tr-"));

function stoppedSession({ bytes = 5 } = {}) {
  let t = Date.parse("2026-11-25T10:00:00Z");
  const store = createRecorderStore({ rootDirectory: path.join(tmpDir(), "recordings"), now: () => new Date(t) });
  const session = store.create({ title: "Réunion", mimeType: "audio/webm;codecs=opus" });
  store.appendChunk(session.id, 0, Buffer.alloc(bytes, 1));
  t += 120_000;
  store.transition(session.id, "stop");
  return { store, id: session.id };
}

function fakeTranscriber({ remote = true, blocked = false, fail = false } = {}) {
  const calls = [];
  return { calls, model: "whisper-1", isRemoteAllowed: () => remote, budgetBlocked: () => blocked,
    async transcribe(input) { calls.push(input); if (fail) throw Object.assign(new Error("boom"), { status: 500 }); return { model: "whisper-1", language: "french", text: "Bonjour. On commence.", segments: [{ start: 0, end: 2.1, text: "Bonjour." }, { start: 2.1, end: 4, text: "On commence." }] }; } };
}

test("sans accord explicite, rien ne part ; avec accord, texte et passages restent sur le Mac", async () => {
  const { store, id } = stoppedSession();
  const transcriber = fakeTranscriber();
  await assert.rejects(store.transcribe(id, { consent: undefined, transcriber }), { code: "RECORDER_TRANSCRIPTION_CONSENT_REQUIRED" });
  await assert.rejects(store.transcribe(id, { consent: "true", transcriber }), { code: "RECORDER_TRANSCRIPTION_CONSENT_REQUIRED" });
  assert.equal(transcriber.calls.length, 0);
  const session = await store.transcribe(id, { consent: true, transcriber });
  assert.equal(transcriber.calls.length, 1);
  assert.equal(transcriber.calls[0].durationMs, 120_000);
  assert.equal(session.transcription.status, "done");
  assert.ok(session.transcription.consentAt, "l'accord est horodaté");
  assert.equal(session.transcription.segments, 2);
  const transcript = store.transcript(id);
  assert.equal(transcript.text, "Bonjour. On commence.");
  assert.deepEqual(transcript.segments.map((s) => s.start), [0, 2.1]);
  const file = path.join(path.dirname(store.audioFile(id).path), "transcript.json");
  if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test("mode local uniquement, budget atteint, enregistrement trop long ou en cours : refus sans appel", async () => {
  for (const [options, code] of [[{ remote: false }, "RECORDER_REMOTE_BLOCKED"], [{ blocked: true }, "RECORDER_BUDGET_BLOCKED"]]) {
    const { store, id } = stoppedSession();
    const transcriber = fakeTranscriber(options);
    await assert.rejects(store.transcribe(id, { consent: true, transcriber }), { code });
    assert.equal(transcriber.calls.length, 0);
  }
  const big = stoppedSession({ bytes: 16 });
  const metaFile = path.join(path.dirname(big.store.audioFile(big.id).path), "meta.json");
  const meta = JSON.parse(fs.readFileSync(metaFile, "utf8")); meta.bytes = MAX_TRANSCRIPTION_BYTES + 1; fs.writeFileSync(metaFile, JSON.stringify(meta));
  await assert.rejects(big.store.transcribe(big.id, { consent: true, transcriber: fakeTranscriber() }), { code: "RECORDER_TRANSCRIPTION_TOO_LARGE" });
  assert.equal(big.store.list()[0].transcribable, false);
  const store = createRecorderStore({ rootDirectory: path.join(tmpDir(), "recordings") });
  const active = store.create({ mimeType: "audio/webm" });
  store.appendChunk(active.id, 0, Buffer.from("x"));
  await assert.rejects(store.transcribe(active.id, { consent: true, transcriber: fakeTranscriber() }), { code: "RECORDER_STILL_ACTIVE" });
});

test("échec d'OpenAI : enregistrement intact, état « échec », nouvel essai possible ; reprise après plantage", async () => {
  const { store, id } = stoppedSession();
  await assert.rejects(store.transcribe(id, { consent: true, transcriber: fakeTranscriber({ fail: true }) }), { code: "RECORDER_TRANSCRIPTION_FAILED" });
  assert.equal(store.list()[0].transcription.status, "failed");
  assert.equal(fs.readFileSync(store.audioFile(id).path).length, 5);
  assert.equal((await store.transcribe(id, { consent: true, transcriber: fakeTranscriber() })).transcription.status, "done");
  const metaFile = path.join(path.dirname(store.audioFile(id).path), "meta.json");
  const meta = JSON.parse(fs.readFileSync(metaFile, "utf8")); meta.transcription.status = "running"; fs.writeFileSync(metaFile, JSON.stringify(meta));
  store.recoverTranscriptions();
  assert.equal(store.list()[0].transcription.errorCode, "INTERRUPTED");
});

test("transcripteur OpenAI : whisper-1 en verbose_json horodaté, coût exact compté au budget", async () => {
  const requests = []; const tracked = [];
  const transcriber = createOpenAiRecorderTranscriber({
    getOpenAIClient: () => ({ audio: { transcriptions: { create: async (input) => { requests.push(input); return { text: " Salut ", language: "french", segments: [{ start: 0, end: 1.5, text: " Salut " }, { start: 1.5, end: 2, text: "  " }] }; } } } }),
    toFile: async (buffer, name, options) => ({ name, type: options.type, size: buffer.length }),
    isRemoteAllowed: () => true, budgetBlocked: () => false, trackUsage: (ms) => tracked.push(ms),
  });
  const result = await transcriber.transcribe({ buffer: Buffer.from("abc"), mimeType: "audio/webm;codecs=opus", durationMs: 90_000 });
  assert.equal(requests[0].model, RECORDER_TRANSCRIPTION_MODEL);
  assert.equal(requests[0].response_format, "verbose_json");
  assert.deepEqual(requests[0].timestamp_granularities, ["segment"]);
  assert.equal(requests[0].file.type, "audio/webm");
  assert.deepEqual(result.segments, [{ start: 0, end: 1.5, text: "Salut" }], "passages vides retirés");
  assert.deepEqual(tracked, [90_000]);
  assert.equal(estimateTranscriptionCostUsd(30 * 60_000), 0.18);
  assert.equal(createOpenAiRecorderTranscriber({ getOpenAIClient: () => ({}), toFile: async () => ({}), isRemoteAllowed: () => { throw new Error("x"); }, budgetBlocked: () => { throw new Error("x"); } }).isRemoteAllowed(), false);
});

test("budget : le surcoût de whisper-1 s'ajoute au mois, au-delà du tarif de base", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "services", "models", "usage-tracking.js"), "utf8");
  assert.match(source, /function trackTranscriptionUsage\(durationMs, \{ pricePerMinute = null \} = \{\}\)/);
  assert.match(source, /usage\.modelPremiumCostUSD = \(usage\.modelPremiumCostUSD \|\| 0\) \+ \(safeDurationMs \/ 60000\) \* extraPerMinute;/);
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(server, /trackTranscriptionUsage\(durationMs, \{ pricePerMinute: RECORDER_TRANSCRIPTION_PRICE_PER_MINUTE \}\)/);
  assert.match(server, /requiredCapabilities: \["REMOTE_TRANSCRIPTION"\]/);
});
