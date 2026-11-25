"use strict";

// Recorder V1 (V3-L8), première tranche : E.1 (enregistrement local, pause/reprise, sauvegarde
// progressive) et E.5 (consentement des participants), derrière le flag `recorder.v1` (OFF).
//
// - Tout reste sur le Mac : dossier `recordings/` du dossier de données (0700, fichiers 0600).
//   Aucun envoi réseau ici ; la transcription (E.2) viendra dans une tranche séparée.
// - Sauvegarde progressive : le navigateur envoie un morceau toutes les quelques secondes, dans
//   l'ordre (`x-recorder-seq`). Un morceau rejoué est ignoré ; un trou est refusé.
// - Pause et reprise sont horodatées : ces repères serviront aux horodatages du résumé (E.3).
// - Une session restée « en cours » au démarrage (plantage, Mac éteint) devient « interrompue » :
//   l'audio est conservé jusqu'au dernier morceau reçu.
// - À plusieurs, l'enregistrement exige d'avoir informé les participants (E.5).
// - E.2 : transcription par OpenAI seulement sur accord explicite pour CET enregistrement
//   (`consent: true`, horodaté dans meta.json), refusée en mode local uniquement ou budget atteint.
//   Le texte et ses passages horodatés restent sur le Mac (`transcript.json`, 0600).

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { MAX_TRANSCRIPTION_BYTES, estimateTranscriptionCostUsd } = require("./recorder-transcriber");

const ROUTE = /^\/api\/recorder\/sessions(?:\/(rec-\d{8}-[0-9a-f]{8})(?:\/(chunks|pause|resume|stop|audio|transcribe|transcript))?)?$/;
const MIME_TYPES = Object.freeze({ "audio/webm;codecs=opus": "webm", "audio/webm": "webm", "audio/mp4": "m4a" });
const MAX_CHUNK_BYTES = 2 * 1024 * 1024;
const MAX_SESSION_BYTES = 500 * 1024 * 1024;
const ACTIVE = new Set(["recording", "paused"]);

function recorderError(code, message, status = 400) { return Object.assign(new Error(message), { code, status }); }

function readRawBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = []; let total = 0;
    req.on("data", (chunk) => { total += chunk.length; if (total <= maxBytes) chunks.push(chunk); });
    req.on("end", () => (total > maxBytes ? reject(recorderError("RECORDER_CHUNK_TOO_LARGE", "Morceau audio trop volumineux.", 413)) : resolve(Buffer.concat(chunks))));
    req.on("error", reject);
  });
}

// Durée réellement enregistrée : somme des segments entre start/resume et pause/stop.
function activeDurationMs(events = [], now = Date.now()) {
  let total = 0; let openedAt = null;
  for (const event of events) {
    const at = Date.parse(event.at);
    if ((event.type === "start" || event.type === "resume") && openedAt === null) openedAt = at;
    if ((event.type === "pause" || event.type === "stop" || event.type === "interrupted") && openedAt !== null) { total += Math.max(0, at - openedAt); openedAt = null; }
  }
  if (openedAt !== null) total += Math.max(0, now - openedAt);
  return total;
}

function createRecorderStore({ rootDirectory, now = () => new Date(), randomId = () => crypto.randomBytes(4).toString("hex") }) {
  fs.mkdirSync(rootDirectory, { recursive: true, mode: 0o700 });
  const sessionDir = (id) => path.join(rootDirectory, id);
  const metaPath = (id) => path.join(sessionDir(id), "meta.json");

  function readMeta(id) {
    try { return JSON.parse(fs.readFileSync(metaPath(id), "utf8")); } catch { return null; }
  }
  function writeMeta(meta) {
    const temporary = `${metaPath(meta.id)}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(meta, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, metaPath(meta.id));
    return meta;
  }
  function requireMeta(id) {
    const meta = readMeta(id);
    if (!meta) throw recorderError("RECORDER_SESSION_UNKNOWN", "Enregistrement introuvable.", 404);
    return meta;
  }
  function audioPath(meta) { return path.join(sessionDir(meta.id), `audio.${MIME_TYPES[meta.mimeType] || "webm"}`); }
  function publicView(meta) {
    return { id: meta.id, title: meta.title, status: meta.status, mimeType: meta.mimeType, createdAt: meta.createdAt, stoppedAt: meta.stoppedAt || null,
      bytes: meta.bytes, chunks: meta.nextSeq, durationMs: activeDurationMs(meta.events, ACTIVE.has(meta.status) ? now().getTime() : undefined),
      multiParticipant: meta.consent.multiParticipant, participantsInformedAt: meta.consent.participantsInformedAt, events: meta.events.map((event) => ({ ...event })),
      transcription: meta.transcription ? { ...meta.transcription } : null,
      transcriptionCostEstimateUsd: estimateTranscriptionCostUsd(activeDurationMs(meta.events)), transcribable: meta.bytes > 0 && meta.bytes <= MAX_TRANSCRIPTION_BYTES };
  }
  function list() {
    return fs.readdirSync(rootDirectory).filter((name) => ROUTE.test(`/api/recorder/sessions/${name}`))
      .map(readMeta).filter(Boolean).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).map(publicView);
  }

  // Démarrage : toute session restée active est marquée interrompue (audio conservé).
  function recoverInterrupted() {
    let recovered = 0;
    for (const session of list()) {
      if (!ACTIVE.has(session.status)) continue;
      const meta = readMeta(session.id);
      const lastAt = meta.lastChunkAt || meta.createdAt;
      meta.events.push({ type: "interrupted", at: lastAt });
      meta.status = "interrupted"; meta.stoppedAt = lastAt;
      writeMeta(meta); recovered += 1;
    }
    return recovered;
  }

  function create({ title, mimeType, multiParticipant = false, participantsInformed = false } = {}) {
    if (list().some((session) => ACTIVE.has(session.status))) throw recorderError("RECORDER_ALREADY_ACTIVE", "Un enregistrement est déjà en cours.", 409);
    if (!Object.prototype.hasOwnProperty.call(MIME_TYPES, String(mimeType))) throw recorderError("RECORDER_FORMAT_UNSUPPORTED", "Format audio non pris en charge.");
    if (multiParticipant === true && participantsInformed !== true) throw recorderError("RECORDER_CONSENT_REQUIRED", "Préviens d'abord les participants que la réunion est enregistrée.");
    const createdAt = now();
    const stamp = createdAt.toISOString().slice(0, 10).replace(/-/g, "");
    let id;
    do { id = `rec-${stamp}-${randomId()}`; } while (fs.existsSync(sessionDir(id)));
    fs.mkdirSync(sessionDir(id), { mode: 0o700 });
    const cleanTitle = String(title ?? "").replace(/\s+/g, " ").trim().slice(0, 120) || `Enregistrement du ${createdAt.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })}`;
    const meta = writeMeta({
      id, title: cleanTitle, status: "recording", mimeType: String(mimeType), createdAt: createdAt.toISOString(), stoppedAt: null,
      bytes: 0, nextSeq: 0, lastChunkAt: null, events: [{ type: "start", at: createdAt.toISOString() }],
      consent: { multiParticipant: multiParticipant === true, participantsInformedAt: multiParticipant === true ? createdAt.toISOString() : null },
    });
    fs.writeFileSync(audioPath(meta), Buffer.alloc(0), { mode: 0o600 });
    return publicView(meta);
  }

  function appendChunk(id, seq, buffer) {
    const meta = requireMeta(id);
    if (!ACTIVE.has(meta.status)) throw recorderError("RECORDER_SESSION_CLOSED", "Cet enregistrement est terminé.", 409);
    if (!Number.isInteger(seq) || seq < 0) throw recorderError("RECORDER_SEQ_INVALID", "Numéro de morceau invalide.");
    if (seq < meta.nextSeq) return { duplicate: true, session: publicView(meta) };
    if (seq > meta.nextSeq) throw recorderError("RECORDER_SEQ_GAP", "Morceau manquant : la sauvegarde doit reprendre dans l'ordre.", 409);
    if (!buffer.length) throw recorderError("RECORDER_CHUNK_EMPTY", "Morceau audio vide.");
    if (meta.bytes + buffer.length > MAX_SESSION_BYTES) throw recorderError("RECORDER_TOO_LARGE", "Enregistrement trop long : arrête-le et lance-en un nouveau.", 413);
    fs.appendFileSync(audioPath(meta), buffer, { mode: 0o600 });
    meta.bytes += buffer.length; meta.nextSeq += 1; meta.lastChunkAt = now().toISOString();
    return { duplicate: false, session: publicView(writeMeta(meta)) };
  }

  function transition(id, action) {
    const meta = requireMeta(id);
    const allowed = { pause: ["recording"], resume: ["paused"], stop: ["recording", "paused"] }[action];
    if (!allowed.includes(meta.status)) throw recorderError("RECORDER_STATE_INVALID", "Action impossible dans l'état actuel de l'enregistrement.", 409);
    const at = now().toISOString();
    meta.events.push({ type: action, at });
    meta.status = { pause: "paused", resume: "recording", stop: "stopped" }[action];
    if (action === "stop") meta.stoppedAt = at;
    return publicView(writeMeta(meta));
  }

  function remove(id) {
    const meta = requireMeta(id);
    if (ACTIVE.has(meta.status)) throw recorderError("RECORDER_STILL_ACTIVE", "Arrête d'abord l'enregistrement.", 409);
    const target = path.resolve(sessionDir(id));
    if (path.dirname(target) !== path.resolve(rootDirectory)) throw recorderError("RECORDER_SESSION_UNKNOWN", "Enregistrement introuvable.", 404);
    fs.rmSync(target, { recursive: true, force: true });
    return { deleted: id };
  }

  const transcriptPath = (id) => path.join(sessionDir(id), "transcript.json");

  // E.2 : l'appelant a vérifié l'accord ; ici, état et limites, puis écriture locale du texte.
  async function transcribe(id, { consent, transcriber }) {
    const meta = requireMeta(id);
    if (consent !== true) throw recorderError("RECORDER_TRANSCRIPTION_CONSENT_REQUIRED", "Confirme d'abord l'envoi de cet enregistrement à OpenAI.");
    if (!transcriber) throw recorderError("RECORDER_TRANSCRIPTION_UNAVAILABLE", "Transcription indisponible.", 503);
    if (ACTIVE.has(meta.status)) throw recorderError("RECORDER_STILL_ACTIVE", "Arrête d'abord l'enregistrement.", 409);
    if (meta.transcription?.status === "running") throw recorderError("RECORDER_TRANSCRIPTION_RUNNING", "Transcription déjà en cours.", 409);
    if (!meta.bytes) throw recorderError("RECORDER_CHUNK_EMPTY", "Cet enregistrement est vide.");
    if (meta.bytes > MAX_TRANSCRIPTION_BYTES) throw recorderError("RECORDER_TRANSCRIPTION_TOO_LARGE", "Enregistrement trop long pour une transcription en un seul envoi (24 Mo au plus, environ 1 h 40).", 413);
    if (!transcriber.isRemoteAllowed()) throw recorderError("RECORDER_REMOTE_BLOCKED", "Noon est en mode local uniquement ou hors ligne : la transcription par OpenAI est bloquée.", 409);
    if (transcriber.budgetBlocked()) throw recorderError("RECORDER_BUDGET_BLOCKED", "Budget mensuel Noon atteint.", 403);
    const durationMs = activeDurationMs(meta.events);
    meta.transcription = { status: "running", consentAt: now().toISOString(), model: transcriber.model, startedAt: now().toISOString(), completedAt: null, errorCode: null, segments: 0, costEstimateUsd: estimateTranscriptionCostUsd(durationMs) };
    writeMeta(meta);
    try {
      const result = await transcriber.transcribe({ buffer: fs.readFileSync(audioPath(meta)), mimeType: meta.mimeType, durationMs });
      fs.writeFileSync(transcriptPath(id), JSON.stringify({ model: result.model, language: result.language, text: result.text, segments: result.segments }, null, 2), { mode: 0o600 });
      Object.assign(meta.transcription, { status: "done", completedAt: now().toISOString(), segments: result.segments.length, language: result.language });
      return publicView(writeMeta(meta));
    } catch (error) {
      Object.assign(meta.transcription, { status: "failed", completedAt: now().toISOString(), errorCode: String(error?.status || error?.code || error?.name || "ERROR").slice(0, 60) });
      writeMeta(meta);
      throw recorderError("RECORDER_TRANSCRIPTION_FAILED", "La transcription a échoué. L'enregistrement est intact : tu peux réessayer.", 502);
    }
  }

  function transcript(id) {
    requireMeta(id);
    try { return JSON.parse(fs.readFileSync(transcriptPath(id), "utf8")); }
    catch { throw recorderError("RECORDER_TRANSCRIPT_MISSING", "Pas encore de transcription pour cet enregistrement.", 404); }
  }

  // Une transcription restée « en cours » au démarrage (Noon quitté pendant l'envoi) est marquée en échec.
  function recoverTranscriptions() {
    for (const session of list()) {
      if (session.transcription?.status !== "running") continue;
      const meta = readMeta(session.id);
      Object.assign(meta.transcription, { status: "failed", errorCode: "INTERRUPTED", completedAt: now().toISOString() });
      writeMeta(meta);
    }
  }

  return { list, create, appendChunk, transition, remove, recoverInterrupted, recoverTranscriptions, transcribe, transcript, audioFile: (id) => { const meta = requireMeta(id); return { path: audioPath(meta), mimeType: meta.mimeType }; } };
}

function createRecorderService({ enabled = false, dataDirectory = null, observability = () => {}, storeOptions = {}, transcriber = null } = {}) {
  const matches = (requestPath) => ROUTE.test(requestPath);
  if (!enabled || !dataDirectory) {
    return { enabled: false, matches,
      async handle(req, res) { res.writeHead(404, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify({ status: "error", code: "RECORDER_DISABLED", message: "Enregistreur désactivé." })); } };
  }
  const store = createRecorderStore({ rootDirectory: path.join(dataDirectory, "recordings"), ...storeOptions });
  const emit = (event, metadata) => { try { observability(event, metadata); } catch {} };
  const recovered = store.recoverInterrupted();
  if (recovered) emit("recorder.sessions_interrupted", { count: recovered });
  store.recoverTranscriptions();

  async function handle(req, res, { requestPath, readJsonBody }) {
    const send = (status, payload) => { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(payload)); };
    const [, id, action] = ROUTE.exec(requestPath) || [];
    try {
      if (req.method === "GET" && !id) return send(200, { status: "ok", sessions: store.list() });
      if (req.method === "GET" && id && action === "audio") {
        const file = store.audioFile(id);
        const stat = fs.statSync(file.path);
        res.writeHead(200, { "Content-Type": file.mimeType.split(";")[0], "Content-Length": stat.size, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
        return fs.createReadStream(file.path).pipe(res);
      }
      if (req.method === "GET" && id && action === "transcript") return send(200, { status: "ok", transcript: store.transcript(id) });
      if (req.headers["x-noon-request"] !== "1") return send(403, { status: "error", code: "RECORDER_REQUEST_REFUSED", message: "Requête Noon refusée." });
      if (req.method === "POST" && id && action === "transcribe") {
        const body = await readJsonBody(req, 1024);
        const session = await store.transcribe(id, { consent: body?.consent, transcriber });
        emit("recorder.transcribed", { sessionId: id, segments: session.transcription.segments, durationMs: session.durationMs });
        return send(200, { status: "ok", session });
      }
      if (req.method === "POST" && !id) {
        const body = await readJsonBody(req, 4 * 1024);
        const session = store.create(body || {});
        emit("recorder.started", { sessionId: session.id, multiParticipant: session.multiParticipant });
        return send(200, { status: "ok", session });
      }
      if (req.method === "POST" && id && action === "chunks") {
        const seq = Number(req.headers["x-recorder-seq"]);
        const result = store.appendChunk(id, seq, await readRawBody(req, MAX_CHUNK_BYTES));
        return send(200, { status: "ok", ...result });
      }
      if (req.method === "POST" && id && ["pause", "resume", "stop"].includes(action)) {
        const session = store.transition(id, action);
        if (action === "stop") emit("recorder.stopped", { sessionId: id, bytes: session.bytes, durationMs: session.durationMs });
        return send(200, { status: "ok", session });
      }
      if (req.method === "DELETE" && id && !action) {
        const result = store.remove(id);
        emit("recorder.deleted", { sessionId: id });
        return send(200, { status: "ok", ...result });
      }
      return send(405, { status: "error", code: "RECORDER_METHOD_NOT_ALLOWED" });
    } catch (error) {
      const known = /^RECORDER_/.test(String(error.code || ""));
      if (!known) emit("recorder.error", { errorCode: String(error.code || error.name || "ERROR").slice(0, 60) });
      return send(known ? error.status || 400 : error.statusCode || 500, { status: "error", code: known ? error.code : "RECORDER_ERROR", message: known ? error.message : "Erreur de l'enregistreur." });
    }
  }

  return { enabled: true, matches, handle, store };
}

module.exports = { MAX_TRANSCRIPTION_BYTES, MAX_CHUNK_BYTES, MAX_SESSION_BYTES, MIME_TYPES, activeDurationMs, createRecorderService, createRecorderStore };
