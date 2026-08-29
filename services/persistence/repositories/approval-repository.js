"use strict";

// Ce dépôt ne conserve jamais les arguments ou le résumé détaillé d'une action.
// Il persiste uniquement les identifiants, empreintes et états nécessaires à l'audit.

function createApprovalRepository(wrapper) {
  if (wrapper?.kind === "sqlite") {
    const db = wrapper.database;
    const columns = [
      "id", "execution_id", "tool_call_id", "skill_name", "operation",
      "args_fingerprint", "permission_level", "status", "created_at", "expires_at",
      "decided_at", "consumed_at", "resume_token_hash", "context_fingerprint",
      "preconditions_fingerprint", "superseded_by", "failure_code",
    ];
    const upsert = db.prepare(`INSERT INTO pending_approvals(${columns.join(",")})
      VALUES(${columns.map(() => "?").join(",")})
      ON CONFLICT(id) DO UPDATE SET status=excluded.status,decided_at=excluded.decided_at,
      consumed_at=excluded.consumed_at,superseded_by=excluded.superseded_by,
      failure_code=excluded.failure_code`);
    return {
      save(record) { upsert.run(...columns.map((key) => record[key] ?? null)); return record; },
      get(id) { return db.prepare("SELECT * FROM pending_approvals WHERE id=?").get(id) || null; },
      list() { return db.prepare("SELECT * FROM pending_approvals ORDER BY created_at DESC").all(); },
      cleanup(beforeIso) {
        return db.prepare("DELETE FROM pending_approvals WHERE status IN ('consumed','rejected','expired','cancelled','failed') AND COALESCE(consumed_at,decided_at,created_at)<?").run(beforeIso).changes;
      },
    };
  }
  return {
    save(record) {
      const state = wrapper.load();
      state.pending_approvals ||= [];
      state.pending_approvals = state.pending_approvals.filter((item) => item.id !== record.id);
      state.pending_approvals.push(record);
      wrapper.save(state);
      return record;
    },
    get(id) { return (wrapper.load().pending_approvals || []).find((item) => item.id === id) || null; },
    list() { return [...(wrapper.load().pending_approvals || [])]; },
    cleanup(beforeIso) {
      const state = wrapper.load();
      const before = (state.pending_approvals || []).length;
      state.pending_approvals = (state.pending_approvals || []).filter((item) =>
        !["consumed", "rejected", "expired", "cancelled", "failed"].includes(item.status) ||
        String(item.consumed_at || item.decided_at || item.created_at) >= beforeIso
      );
      wrapper.save(state);
      return before - state.pending_approvals.length;
    },
  };
}

module.exports = { createApprovalRepository };
