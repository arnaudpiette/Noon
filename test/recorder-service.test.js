"use strict";

// Recorder V1 (V3-L8), tranche E.1 + E.5 : enregistrement local, pause/reprise, sauvegarde
// progressive dans l'ordre, reprise après plantage, consentement des participants.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const test = require("node:test");
const { activeDurationMs, createRecorderService, createRecorderStore, MAX_CHUNK_BYTES } = require("../services/recorder/recorder-service");

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "noon-recorder-"));

function clock(start = "2026-11-25T10:00:00.000Z") {
  let current = Date.parse(start);
  return { now: () => new Date(current), advance: (ms) => { current += ms; } };
}

test("une session : morceaux dans l'ordre, rejeu ignoré, trou refusé, pause/reprise horodatées", () => {
  const time = clock();
  const store = createRecorderStore({ rootDirectory: path.join(tmpDir(), "recordings"), now: time.now, randomId: () => "0a1b2c3d" });
  const session = store.create({ title: "  Point   client Corsaire ", mimeType: "audio/webm;codecs=opus" });
  assert.equal(session.id, "rec-20261125-0a1b2c3d");
  assert.equal(session.title, "Point client Corsaire");
  assert.equal(session.status, "recording");
  assert.equal(store.appendChunk(session.id, 0, Buffer.from("AAA")).duplicate, false);
  assert.equal(store.appendChunk(session.id, 0, Buffer.from("AAA")).duplicate, true, "un morceau renvoyé n'est pas ajouté deux fois");
  assert.throws(() => store.appendChunk(session.id, 2, Buffer.from("CCC")), { code: "RECORDER_SEQ_GAP" });
  assert.throws(() => store.appendChunk(session.id, 1, Buffer.alloc(0)), { code: "RECORDER_CHUNK_EMPTY" });
  time.advance(60_000);
  store.transition(session.id, "pause");
  time.advance(30_000);
  store.appendChunk(session.id, 1, Buffer.from("BB"));
  store.transition(session.id, "resume");
  time.advance(15_000);
  const stopped = store.transition(session.id, "stop");
  assert.equal(stopped.status, "stopped");
  assert.equal(stopped.durationMs, 75_000, "la pause ne compte pas dans la durée");
  assert.deepEqual(stopped.events.map((event) => event.type), ["start", "pause", "resume", "stop"]);
  assert.equal(stopped.bytes, 5);
  assert.equal(fs.readFileSync(store.audioFile(session.id).path, "utf8"), "AAABB");
  assert.throws(() => store.appendChunk(session.id, 2, Buffer.from("X")), { code: "RECORDER_SESSION_CLOSED" });
  assert.throws(() => store.transition(session.id, "resume"), { code: "RECORDER_STATE_INVALID" });
});

test("fichiers privés, un seul enregistrement actif, format et consentement vérifiés", () => {
  const root = path.join(tmpDir(), "recordings");
  const store = createRecorderStore({ rootDirectory: root });
  assert.throws(() => store.create({ mimeType: "video/mp4" }), { code: "RECORDER_FORMAT_UNSUPPORTED" });
  assert.throws(() => store.create({ mimeType: "audio/webm", multiParticipant: true }), { code: "RECORDER_CONSENT_REQUIRED" });
  const session = store.create({ mimeType: "audio/webm", multiParticipant: true, participantsInformed: true });
  assert.equal(session.multiParticipant, true);
  assert.ok(session.participantsInformedAt);
  assert.match(session.title, /^Enregistrement du /);
  assert.throws(() => store.create({ mimeType: "audio/webm" }), { code: "RECORDER_ALREADY_ACTIVE" });
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(root).mode & 0o777, 0o700);
    assert.equal(fs.statSync(path.join(root, session.id)).mode & 0o777, 0o700);
    assert.equal(fs.statSync(store.audioFile(session.id).path).mode & 0o777, 0o600);
  }
  assert.throws(() => store.remove(session.id), { code: "RECORDER_STILL_ACTIVE" });
  store.transition(session.id, "stop");
  assert.deepEqual(store.remove(session.id), { deleted: session.id });
  assert.deepEqual(store.list(), []);
});

test("après un plantage, la session active devient interrompue et garde son audio", () => {
  const root = path.join(tmpDir(), "recordings");
  const time = clock();
  const first = createRecorderStore({ rootDirectory: root, now: time.now });
  const session = first.create({ mimeType: "audio/webm" });
  time.advance(20_000);
  first.appendChunk(session.id, 0, Buffer.from("audio"));
  time.advance(500_000);
  const restarted = createRecorderStore({ rootDirectory: root, now: time.now });
  assert.equal(restarted.recoverInterrupted(), 1);
  const [recovered] = restarted.list();
  assert.equal(recovered.status, "interrupted");
  assert.equal(recovered.durationMs, 20_000, "la durée s'arrête au dernier morceau reçu");
  assert.equal(recovered.bytes, 5);
  assert.equal(restarted.recoverInterrupted(), 0);
  assert.ok(restarted.create({ mimeType: "audio/webm" }), "un nouvel enregistrement est possible");
});

test("durée active : segments ouverts comptés jusqu'à maintenant", () => {
  const events = [{ type: "start", at: "2026-11-25T10:00:00Z" }, { type: "pause", at: "2026-11-25T10:01:00Z" }, { type: "resume", at: "2026-11-25T10:02:00Z" }];
  assert.equal(activeDurationMs(events, Date.parse("2026-11-25T10:02:30Z")), 90_000);
});

async function withServer(service, run) {
  const readJsonBody = (req) => new Promise((resolve) => { let text = ""; req.on("data", (c) => { text += c; }); req.on("end", () => resolve(text ? JSON.parse(text) : {})); });
  const server = http.createServer((req, res) => {
    const requestPath = new URL(req.url, "http://127.0.0.1").pathname;
    if (!service.matches(requestPath)) { res.writeHead(404); return res.end(); }
    return service.handle(req, res, { requestPath, readJsonBody });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/recorder/sessions`;
  try { await run(base); } finally { await new Promise((resolve) => server.close(resolve)); }
}

test("routes : flag OFF → 404 ; en-tête Noon exigé ; morceaux bruts ; audio relu ; journal sans titre", async () => {
  const off = createRecorderService({ enabled: false });
  assert.equal(off.matches("/api/recorder/sessions"), true);
  const events = [];
  const service = createRecorderService({ enabled: true, dataDirectory: tmpDir(), observability: (event, metadata) => events.push([event, metadata]) });
  await withServer(service, async (base) => {
    const json = { "Content-Type": "application/json", "X-Noon-Request": "1" };
    assert.equal((await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 403);
    const created = await (await fetch(base, { method: "POST", headers: json, body: JSON.stringify({ title: "Réunion budget secrète", mimeType: "audio/webm;codecs=opus" }) })).json();
    const id = created.session.id;
    const chunk = (seq, body) => fetch(`${base}/${id}/chunks`, { method: "POST", headers: { "Content-Type": "audio/webm", "X-Noon-Request": "1", "X-Recorder-Seq": String(seq) }, body });
    assert.equal((await chunk(0, Buffer.from("OPUS1"))).status, 200);
    assert.equal((await chunk(5, Buffer.from("OPUS2"))).status, 409);
    assert.equal((await chunk(1, Buffer.alloc(MAX_CHUNK_BYTES + 1))).status, 413);
    assert.equal((await chunk(1, Buffer.from("OPUS2"))).status, 200);
    assert.equal((await fetch(`${base}/${id}/stop`, { method: "POST", headers: json })).status, 200);
    const audio = await fetch(`${base}/${id}/audio`);
    assert.equal(audio.headers.get("content-type"), "audio/webm");
    assert.equal(await audio.text(), "OPUS1OPUS2");
    const list = await (await fetch(base)).json();
    assert.equal(list.sessions[0].durationMs >= 0, true);
    assert.equal((await fetch(`${base}/${id}`, { method: "DELETE", headers: { "X-Noon-Request": "1" } })).status, 200);
    assert.equal((await fetch(`${base}/${id}/audio`)).status, 404);
  });
  assert.ok(events.some(([event]) => event === "recorder.started"));
  assert.ok(!JSON.stringify(events).includes("budget secrète"), "aucun titre dans le journal");
});

test("le flag recorder.v1 existe et reste OFF par défaut", () => {
  const { FEATURE_FLAGS } = require("../services/config/feature-flag-registry");
  const flag = FEATURE_FLAGS.find((item) => item.flagId === "recorder.v1");
  assert.ok(flag);
  assert.equal(flag.defaultMode, "OFF");
});
