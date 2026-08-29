"use strict";

// Persiste les plans et leur cycle de vie sans journaliser leur contenu.
function createArtifactRepository(wrapper) {
  if (wrapper?.kind === "sqlite") {
    const db = wrapper.database;
    const columns = [
      "artifact_id", "version", "parent_artifact_id", "artifact_type", "output_format",
      "state", "title", "content_fingerprint", "request_fingerprint", "plan_json",
      "source_ids_json", "source_synthesis_id", "privacy_mode", "preview_path",
      "output_path", "size_bytes", "created_at", "updated_at",
    ];
    const upsert = db.prepare(`INSERT INTO artifacts(${columns.join(",")})
      VALUES(${columns.map(() => "?").join(",")})
      ON CONFLICT(artifact_id,version) DO UPDATE SET
      state=excluded.state,plan_json=excluded.plan_json,preview_path=excluded.preview_path,
      output_path=excluded.output_path,size_bytes=excluded.size_bytes,updated_at=excluded.updated_at`);
    const writeColumns = ["write_operation_id", "artifact_id", "version", "destination", "content_fingerprint", "status", "created_at", "completed_at"];
    const upsertWrite = db.prepare(`INSERT INTO artifact_writes(${writeColumns.join(",")})
      VALUES(${writeColumns.map(() => "?").join(",")})
      ON CONFLICT(write_operation_id) DO UPDATE SET status=excluded.status,completed_at=excluded.completed_at`);
    return {
      save(record) { upsert.run(...columns.map((key) => record[key] ?? null)); return record; },
      get(id, version) { return db.prepare("SELECT * FROM artifacts WHERE artifact_id=? AND version=?").get(id, version) || null; },
      latest(id) { return db.prepare("SELECT * FROM artifacts WHERE artifact_id=? ORDER BY version DESC LIMIT 1").get(id) || null; },
      list(id) { return db.prepare("SELECT * FROM artifacts WHERE artifact_id=? ORDER BY version ASC").all(id); },
      listAll(limit = 100) { return db.prepare("SELECT * FROM artifacts ORDER BY updated_at DESC LIMIT ?").all(Math.max(1, Math.min(500, Number(limit) || 100))); },
      findDuplicate(fingerprint, format) { return db.prepare("SELECT * FROM artifacts WHERE content_fingerprint=? AND output_format=? ORDER BY updated_at DESC LIMIT 1").get(fingerprint, format) || null; },
      saveWrite(record) { upsertWrite.run(...writeColumns.map((key) => record[key] ?? null)); return record; },
      getWrite(id) { return db.prepare("SELECT * FROM artifact_writes WHERE write_operation_id=?").get(id) || null; },
    };
  }
  function mutate(operation) { const state = wrapper.load(); state.artifacts ||= []; state.artifact_writes ||= []; const result = operation(state); wrapper.save(state); return result; }
  return {
    save(record) { return mutate((state) => { state.artifacts = state.artifacts.filter((item) => item.artifact_id !== record.artifact_id || item.version !== record.version); state.artifacts.push(record); return record; }); },
    get(id, version) { return (wrapper.load().artifacts || []).find((item) => item.artifact_id === id && item.version === version) || null; },
    latest(id) { return (wrapper.load().artifacts || []).filter((item) => item.artifact_id === id).sort((a, b) => b.version - a.version)[0] || null; },
    list(id) { return (wrapper.load().artifacts || []).filter((item) => item.artifact_id === id).sort((a, b) => a.version - b.version); },
    listAll(limit = 100) { return (wrapper.load().artifacts || []).sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, Math.max(1, Math.min(500, Number(limit) || 100))); },
    findDuplicate(fingerprint, format) { return (wrapper.load().artifacts || []).filter((item) => item.content_fingerprint === fingerprint && item.output_format === format).sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0] || null; },
    saveWrite(record) { return mutate((state) => { state.artifact_writes = state.artifact_writes.filter((item) => item.write_operation_id !== record.write_operation_id); state.artifact_writes.push(record); return record; }); },
    getWrite(id) { return (wrapper.load().artifact_writes || []).find((item) => item.write_operation_id === id) || null; },
  };
}

module.exports = { createArtifactRepository };
