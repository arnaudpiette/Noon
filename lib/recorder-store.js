"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const STATES = new Set(["recording", "paused", "available", "interrupted"]);
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CHUNK_BYTES = 256 * 1024;

function createRecorderStore(root) {
  const directory = path.join(root, "recordings");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  let activeId = null;
  const location = (id) => {
    if (!ID.test(String(id))) throw new Error("Enregistrement invalide.");
    return path.join(directory, id);
  };
  const read = (id) => JSON.parse(fs.readFileSync(path.join(location(id), "manifest.json"), "utf8"));
  function persist(record) {
    const target = path.join(location(record.id), "manifest.json");
    const temporary = `${target}.tmp`;
    const handle = fs.openSync(temporary, "w", 0o600);
    try {
      fs.writeFileSync(handle, JSON.stringify(record));
      fs.fsyncSync(handle);
    } finally { fs.closeSync(handle); }
    fs.renameSync(temporary, target);
    const dirHandle = fs.openSync(location(record.id), "r");
    try { fs.fsyncSync(dirHandle); } finally { fs.closeSync(dirHandle); }
  }
  function list() {
    return fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && ID.test(entry.name))
      .flatMap((entry) => { try { return [read(entry.name)]; } catch { return []; } })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((record) => ({ ...record, chunks: record.chunks.map(({ index, durationMs, bytes }) => ({ index, durationMs, bytes })) }));
  }
  function create({ title = "Nouvel enregistrement", inputLabel = "", mimeType = "" } = {}) {
    if (activeId) throw new Error("Un enregistrement est déjà actif.");
    if (!/^audio\/(webm|mp4|ogg)(;[a-z0-9=;._-]+)?$/i.test(mimeType)) throw new Error("Format audio refusé.");
    const id = crypto.randomUUID();
    fs.mkdirSync(location(id), { mode: 0o700 });
    const record = {
      id, title: String(title).slice(0, 120), inputLabel: String(inputLabel).slice(0, 120),
      mimeType, state: "recording", createdAt: new Date().toISOString(), durationMs: 0, chunks: [],
    };
    persist(record);
    activeId = id;
    return record;
  }
  function append(id, { index, durationMs, data }) {
    if (activeId !== id) throw new Error("Capture inactive.");
    const record = read(id);
    if (record.state !== "recording" || index !== record.chunks.length) throw new Error("Segment audio hors séquence.");
    if (!Number.isInteger(durationMs) || durationMs < 0 || durationMs > 600_000) throw new Error("Durée de segment invalide.");
    if (typeof data !== "string" || data.length > MAX_CHUNK_BYTES * 4 / 3 + 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
      throw new Error("Segment audio invalide ou trop volumineux.");
    }
    const bytes = Buffer.from(data, "base64");
    if (!bytes.length || bytes.length > MAX_CHUNK_BYTES || bytes.toString("base64") !== data) throw new Error("Segment audio invalide.");
    const filename = `${String(index).padStart(6, "0")}.media`;
    const temporary = path.join(location(id), `${filename}.tmp`);
    const destination = path.join(location(id), filename);
    const handle = fs.openSync(temporary, "wx", 0o600);
    try { fs.writeFileSync(handle, bytes); fs.fsyncSync(handle); }
    finally { fs.closeSync(handle); }
    fs.renameSync(temporary, destination);
    record.chunks.push({ index, durationMs, bytes: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex") });
    record.durationMs += durationMs;
    persist(record);
    return { index, durationMs: record.durationMs };
  }
  function setState(id, state) {
    if (activeId !== id || !STATES.has(state)) throw new Error("Transition refusée.");
    const record = read(id);
    const transitions = {
      recording: ["paused", "available", "interrupted"],
      paused: ["recording", "available", "interrupted"],
    };
    if (!transitions[record.state]?.includes(state)) throw new Error("Transition refusée.");
    record.state = state;
    persist(record);
    if (state === "available" || state === "interrupted") activeId = null;
    return record;
  }
  function recover() {
    for (const summary of list()) {
      if (summary.state !== "recording" && summary.state !== "paused") continue;
      const record = read(summary.id);
      const originalCount = record.chunks.length;
      record.chunks = record.chunks.filter((chunk) => {
        try {
          const bytes = fs.readFileSync(path.join(location(record.id), `${String(chunk.index).padStart(6, "0")}.media`));
          return bytes.length === chunk.bytes && crypto.createHash("sha256").update(bytes).digest("hex") === chunk.sha256;
        } catch { return false; }
      });
      record.durationMs = record.chunks.reduce((sum, chunk) => sum + chunk.durationMs, 0);
      record.missingSegments = originalCount - record.chunks.length;
      record.state = "interrupted";
      persist(record);
    }
  }
  function chunk(id, index) {
    const record = read(id);
    const entry = record.chunks.find((candidate) => candidate.index === index);
    if (!entry) throw new Error("Segment introuvable.");
    const bytes = fs.readFileSync(path.join(location(id), `${String(index).padStart(6, "0")}.media`));
    if (bytes.length !== entry.bytes || crypto.createHash("sha256").update(bytes).digest("hex") !== entry.sha256) throw new Error("Segment endommagé.");
    return { mimeType: record.mimeType, data: bytes.toString("base64"), durationMs: entry.durationMs };
  }
  recover();
  return { create, append, setState, list, chunk };
}

module.exports = { createRecorderStore };
