"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ID_PATTERN = /^[a-f0-9-]{36}$/;
const MAX_CHUNK_BYTES = 4 * 1024 * 1024;
const MAX_RECORDING_BYTES = 512 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["audio/webm", "audio/mp4", "audio/ogg", "video/mp4"]);

class RecordingError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

function createRecordingStore(root) {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });

  function directory(id) {
    if (!ID_PATTERN.test(String(id))) throw new RecordingError("INVALID_ID", "Enregistrement inconnu.", 404);
    return path.join(root, id);
  }
  function load(id) {
    let recording;
    try { recording = JSON.parse(fs.readFileSync(path.join(directory(id), "metadata.json"), "utf8")); }
    catch { throw new RecordingError("NOT_FOUND", "Enregistrement inconnu.", 404); }
    return recording;
  }
  function save(recording) {
    const dir = directory(recording.id);
    const temp = path.join(dir, `metadata.${crypto.randomUUID()}.tmp`);
    try {
      fs.writeFileSync(temp, JSON.stringify(recording), { mode: 0o600, flag: "wx" });
      fs.renameSync(temp, path.join(dir, "metadata.json"));
    } finally { try { fs.unlinkSync(temp); } catch {} }
  }
  function publicRecord(recording) {
    const { id, title, createdAt, updatedAt, state, mimeType, bytes, chunks, transcript, transcriptRevision, durationMs, consent, project, analysis, segments, speakers, tags, metadataRevision } = recording;
    return { id, title, createdAt, updatedAt, state, mimeType, bytes, chunkCount: chunks.length, transcript, transcriptRevision, durationMs, consent, project, analysis: analysis || null, segments: segments || [], speakers: speakers || {}, tags: tags || [], metadataRevision: metadataRevision || 0 };
  }
  function create({ title, mimeType, consent, project } = {}) {
    if (!ALLOWED_TYPES.has(mimeType)) throw new RecordingError("INVALID_MEDIA_TYPE", "Format audio non pris en charge.");
    if (consent !== true) throw new RecordingError("CONSENT_REQUIRED", "Confirmez l'information des participants avant d'enregistrer.");
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const recording = { id, title: String(title || "Nouvel enregistrement").trim().slice(0, 160), mimeType, consent: true,
      project: String(project || "").slice(0, 160), tags: [], metadataRevision: 0, createdAt: now, updatedAt: now, state: "recording", bytes: 0,
      chunks: [], durationMs: 0, transcript: "", transcriptRevision: 0, segments: [], speakers: {} };
    fs.mkdirSync(directory(id), { mode: 0o700 });
    save(recording);
    return publicRecord(recording);
  }
  function append(id, { index, mimeType, buffer }) {
    const recording = load(id);
    if (recording.state !== "recording") throw new RecordingError("NOT_RECORDING", "Cet enregistrement est déjà terminé.", 409);
    if (mimeType !== recording.mimeType || !Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_CHUNK_BYTES) {
      throw new RecordingError("INVALID_CHUNK", "Fragment audio invalide ou trop volumineux.", 413);
    }
    if (!Number.isSafeInteger(index) || index < 0) throw new RecordingError("INVALID_INDEX", "Index audio invalide.");
    const digest = crypto.createHash("sha256").update(buffer).digest("hex");
    if (index < recording.chunks.length) {
      if (recording.chunks[index]?.sha256 === digest && recording.chunks[index]?.bytes === buffer.length) return publicRecord(recording);
      throw new RecordingError("CHUNK_CONFLICT", "Un autre fragment existe déjà à cette position.", 409);
    }
    if (index !== recording.chunks.length) throw new RecordingError("CHUNK_GAP", "Un fragment audio manque.", 409);
    if (recording.bytes + buffer.length > MAX_RECORDING_BYTES) throw new RecordingError("RECORDING_FULL", "Enregistrement trop volumineux.", 413);
    const target = path.join(directory(id), `${String(index).padStart(8, "0")}.chunk`);
    const temp = `${target}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temp, buffer, { mode: 0o600, flag: "wx" });
      fs.renameSync(temp, target);
      recording.chunks.push({ bytes: buffer.length, sha256: digest });
      recording.bytes += buffer.length;
      recording.updatedAt = new Date().toISOString();
      save(recording);
    } finally { try { fs.unlinkSync(temp); } catch {} }
    return publicRecord(recording);
  }
  function finish(id, durationMs) {
    const recording = load(id);
    if (recording.state === "ready") return publicRecord(recording);
    if (recording.state !== "recording" || !recording.chunks.length) throw new RecordingError("EMPTY_RECORDING", "Aucun son sauvegardé.", 409);
    recording.state = "ready";
    recording.durationMs = Number.isFinite(durationMs) ? Math.max(0, Math.floor(durationMs)) : 0;
    recording.updatedAt = new Date().toISOString();
    save(recording);
    return publicRecord(recording);
  }
  function chunks(id) {
    const recording = load(id);
    if (!recording.chunks.length) throw new RecordingError("EMPTY_RECORDING", "Aucun son sauvegardé.", 409);
    const buffers = recording.chunks.map((chunk, index) => {
      const data = fs.readFileSync(path.join(directory(id), `${String(index).padStart(8, "0")}.chunk`));
      if (data.length !== chunk.bytes || crypto.createHash("sha256").update(data).digest("hex") !== chunk.sha256) {
        throw new RecordingError("DAMAGED_AUDIO", "Un fragment audio est endommagé.", 409);
      }
      return data;
    });
    return { recording: publicRecord(recording), buffer: Buffer.concat(buffers) };
  }
  function transcript(id, text, expectedRevision, segments = []) {
    const recording = load(id);
    if (recording.state !== "ready") throw new RecordingError("NOT_READY", "Terminez l'enregistrement avant la transcription.", 409);
    if (recording.transcriptRevision !== expectedRevision) throw new RecordingError("REVISION_CONFLICT", "La transcription a été modifiée ailleurs.", 409);
    const value = String(text || "").trim();
    if (value.length > 500000) throw new RecordingError("TRANSCRIPT_TOO_LONG", "Transcription trop longue.", 413);
    recording.transcript = value;
    recording.segments = Array.isArray(segments) ? segments.slice(0, 5000).filter(segment =>
      Number.isFinite(segment.start) && Number.isFinite(segment.end) && segment.start >= 0 && segment.end > segment.start
      && segment.end <= 86400 && typeof segment.text === "string").map(segment => ({
        start: Math.round(segment.start * 1000) / 1000, end: Math.round(segment.end * 1000) / 1000,
        text: segment.text.slice(0, 2000), speaker: /^[A-Z]$/.test(segment.speaker) ? segment.speaker : null,
      })) : [];
    recording.speakers = {};
    recording.transcriptRevision += 1;
    recording.analysis = null;
    recording.updatedAt = new Date().toISOString();
    save(recording);
    return publicRecord(recording);
  }
  function updateMetadata(id, { title, project, tags, expectedRevision }) {
    const recording = load(id);
    if (recording.metadataRevision !== expectedRevision) throw new RecordingError("REVISION_CONFLICT", "Les détails ont été modifiés ailleurs.", 409);
    if (typeof title !== "string" || !title.trim() || title.length > 160 || typeof project !== "string" || project.length > 160 ||
      !Array.isArray(tags) || tags.length > 12 || tags.some(tag => typeof tag !== "string" || tag.length > 40)) {
      throw new RecordingError("INVALID_METADATA", "Titre, projet ou tags invalides.");
    }
    recording.title = title.trim();
    recording.project = project.trim();
    recording.tags = [...new Set(tags.map(tag => tag.trim()).filter(Boolean))];
    recording.metadataRevision += 1;
    recording.updatedAt = new Date().toISOString();
    save(recording);
    return publicRecord(recording);
  }
  function nameSpeaker(id, speaker, name, expectedRevision) {
    const recording = load(id);
    if (recording.transcriptRevision !== expectedRevision) throw new RecordingError("REVISION_CONFLICT", "La transcription a changé.", 409);
    if (!/^[A-Z]$/.test(String(speaker)) || !recording.segments.some(segment => segment.speaker === speaker)) throw new RecordingError("SPEAKER_UNKNOWN", "Intervenant inconnu.");
    const value = String(name || "").trim().slice(0, 80);
    if (value) recording.speakers[speaker] = value;
    else delete recording.speakers[speaker];
    recording.updatedAt = new Date().toISOString();
    save(recording);
    return publicRecord(recording);
  }
  function analyze(id, analysis, expectedRevision) {
    const recording = load(id);
    if (recording.transcriptRevision !== expectedRevision) throw new RecordingError("REVISION_CONFLICT", "La transcription a changé pendant l'analyse.", 409);
    if (!recording.transcript) throw new RecordingError("NO_TRANSCRIPT", "Aucune transcription à analyser.", 409);
    const normalized = { type: String(analysis.type || "réunion").slice(0, 40),
      summary: String(analysis.summary || "").slice(0, 4000),
      points: Array.isArray(analysis.points) ? analysis.points.slice(0, 12).map(point => ({
        kind: ["décision", "action", "question", "objection", "idée"].includes(point.kind) ? point.kind : "idée",
        text: String(point.text || "").slice(0, 500),
        quote: String(point.quote || "").slice(0, 500),
        owner: String(point.owner || "À confirmer").slice(0, 100),
        due: String(point.due || "À confirmer").slice(0, 100), status: "proposé",
      })).filter(point => point.text && point.quote && recording.transcript.includes(point.quote)) : [],
      transcriptRevision: expectedRevision, reviewRevision: 0, createdAt: new Date().toISOString(),
    };
    recording.analysis = normalized;
    recording.updatedAt = new Date().toISOString();
    save(recording);
    return publicRecord(recording);
  }
  function reviewPoint(id, pointIndex, status, expectedRevision, expectedReviewRevision) {
    const recording = load(id);
    if (!recording.analysis || recording.analysis.transcriptRevision !== expectedRevision) throw new RecordingError("REVISION_CONFLICT", "L'analyse est périmée.", 409);
    if (recording.analysis.reviewRevision !== expectedReviewRevision) throw new RecordingError("REVISION_CONFLICT", "Un point a été revu ailleurs.", 409);
    if (!Number.isSafeInteger(pointIndex) || pointIndex < 0 || !recording.analysis.points[pointIndex] || !["validé", "rejeté", "proposé"].includes(status)) {
      throw new RecordingError("INVALID_REVIEW", "Décision invalide.");
    }
    recording.analysis.points[pointIndex].status = status;
    recording.analysis.reviewRevision += 1;
    recording.updatedAt = new Date().toISOString();
    save(recording);
    return publicRecord(recording);
  }
  function list(query = "") {
    const normalized = String(query).trim().toLocaleLowerCase("fr-FR").slice(0, 160);
    return fs.readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory() && ID_PATTERN.test(entry.name))
      .map(entry => { try { return publicRecord(load(entry.name)); } catch { return null; } }).filter(Boolean)
      .filter(entry => !normalized || [entry.title, entry.project, ...(entry.tags || []), entry.transcript].join(" ").toLocaleLowerCase("fr-FR").includes(normalized))
      .map(({ transcript, segments, analysis, ...summary }) => summary)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  function remove(id) {
    load(id);
    fs.rmSync(directory(id), { recursive: true, force: false });
  }
  return { create, append, finish, chunks, transcript, analyze, nameSpeaker, updateMetadata, reviewPoint, list, load: id => publicRecord(load(id)), remove };
}

module.exports = { createRecordingStore, RecordingError, MAX_CHUNK_BYTES };
