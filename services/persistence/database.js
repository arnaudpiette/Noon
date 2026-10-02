"use strict";

// Base locale structurée. node:sqlite évite toute dépendance native externe ;
// un démarrage dégradé reste possible si le runtime Electron ne l'expose pas.
const fs = require("fs");
const path = require("path");

const SCHEMA_VERSION = 19;
// Une attente courte absorbe les écritures SQLite qui se chevauchent entre
// deux processus Noon, sans transformer les erreurs persistantes en retry.
const PERSONAL_DATABASE_BUSY_TIMEOUT_MS = 1500;

function loadSqlite() {
  try { return require("node:sqlite"); }
  catch { return null; }
}

function hasColumn(database, tableName, columnName) {
  return database.prepare(`PRAGMA table_info(${tableName})`).all()
    .some((column) => column.name === columnName);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isDuplicateColumnError(error, columnName) {
  return error?.code === "ERR_SQLITE_ERROR" && error?.errcode === 1 &&
    new RegExp(`^duplicate column name:\\s*${escapeRegExp(columnName)}\\s*$`, "i")
      .test(String(error?.message || ""));
}

function ensureColumn(database, tableName, columnName, definition) {
  if (hasColumn(database, tableName, columnName)) return;
  try {
    database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${definition}`);
  } catch (error) {
    // Une autre initialisation peut avoir ajouté la colonne entre la lecture et
    // l'ALTER. BUSY/LOCKED et toute autre erreur doivent toujours remonter.
    if (!isDuplicateColumnError(error, columnName)) throw error;
    try {
      if (!hasColumn(database, tableName, columnName)) throw error;
    } catch {
      throw error;
    }
  }
  if (!hasColumn(database, tableName, columnName)) {
    throw new Error(`Migration SQLite incomplète : ${tableName}.${columnName}`);
  }
}

function createSchema(database) {
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS dev_project_rules (
      rule_id TEXT PRIMARY KEY, schema_version INTEGER NOT NULL,
      project_id TEXT NOT NULL, owner_profile_scope TEXT NOT NULL,
      kind TEXT NOT NULL, text TEXT NOT NULL, status TEXT NOT NULL,
      version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      deleted_at TEXT, created_by TEXT NOT NULL, updated_by TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS dev_project_rules_scope_idx
      ON dev_project_rules(project_id, owner_profile_scope, status, updated_at);
    CREATE TABLE IF NOT EXISTS memory_items (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, subject TEXT NOT NULL,
      value_json TEXT NOT NULL, source_type TEXT NOT NULL,
      source_reference TEXT, status TEXT NOT NULL, confidence REAL NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      last_confirmed_at TEXT, expires_at TEXT, sensitivity TEXT NOT NULL DEFAULT 'normal',
      use_allowed INTEGER NOT NULL DEFAULT 1, rejected_at TEXT, metadata_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS memory_status_idx ON memory_items(status, use_allowed, expires_at);
    CREATE INDEX IF NOT EXISTS memory_subject_idx ON memory_items(subject);
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, objective TEXT, current_state TEXT,
      status TEXT NOT NULL, next_action TEXT, deadline TEXT, priority INTEGER NOT NULL DEFAULT 50,
      estimated_minutes_remaining INTEGER, actual_minutes_spent INTEGER NOT NULL DEFAULT 0,
      decisions_json TEXT NOT NULL DEFAULT '[]', blockers_json TEXT NOT NULL DEFAULT '[]',
      important_files_json TEXT NOT NULL DEFAULT '[]', conversations_json TEXT NOT NULL DEFAULT '[]',
      emails_json TEXT NOT NULL DEFAULT '[]', events_json TEXT NOT NULL DEFAULT '[]',
      github_url TEXT, figma_url TEXT, last_activity_at TEXT, last_outcome TEXT,
      last_checked_at TEXT, source_reference TEXT, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS project_status_idx ON projects(status, priority, deadline);
    CREATE TABLE IF NOT EXISTS inbox_items (
      id TEXT PRIMARY KEY, source_type TEXT NOT NULL, source_reference TEXT NOT NULL,
      title TEXT NOT NULL, action TEXT, project_id TEXT, deadline TEXT,
      estimated_duration INTEGER, importance REAL NOT NULL DEFAULT 0.5,
      energy_required TEXT, required_context TEXT, status TEXT NOT NULL,
      detected_at TEXT NOT NULL, updated_at TEXT NOT NULL, expires_at TEXT,
      sensitivity TEXT NOT NULL DEFAULT 'normal', source_updated_at TEXT,
      source_stale INTEGER NOT NULL DEFAULT 0,
      UNIQUE(source_type, source_reference)
    );
    CREATE INDEX IF NOT EXISTS inbox_status_idx ON inbox_items(status, deadline, importance);
    CREATE TABLE IF NOT EXISTS recommendations (
      id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, inbox_item_id TEXT,
      score REAL NOT NULL, priority_level TEXT NOT NULL, payload_json TEXT NOT NULL,
      first_detected_at TEXT NOT NULL, last_presented_at TEXT, presentation_count INTEGER NOT NULL DEFAULT 0,
      user_response TEXT, cooldown_until TEXT, reactivation_key TEXT, expires_at TEXT, status TEXT NOT NULL,
      subject_scope TEXT
    );
    CREATE INDEX IF NOT EXISTS recommendation_status_idx ON recommendations(status, cooldown_until, expires_at);
    CREATE TABLE IF NOT EXISTS followups (
      id TEXT PRIMARY KEY, recommendation_id TEXT, project_id TEXT, status TEXT NOT NULL,
      estimated_minutes INTEGER, actual_minutes INTEGER, blocker TEXT, next_action TEXT,
      user_feedback TEXT, due_at TEXT, followed_up_at TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS feedback_events (
      id TEXT PRIMARY KEY, recommendation_hash TEXT, value TEXT NOT NULL,
      category TEXT, created_at TEXT NOT NULL, metadata_json TEXT NOT NULL DEFAULT '{}',
      subject_scope TEXT
    );
    CREATE TABLE IF NOT EXISTS metrics_events (
      id TEXT PRIMARY KEY, metric TEXT NOT NULL, value REAL NOT NULL,
      model TEXT, tool TEXT, category TEXT, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS metrics_time_idx ON metrics_events(created_at, metric);
    CREATE TABLE IF NOT EXISTS private_profiles (
      id TEXT PRIMARY KEY, payload_encrypted TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS private_memories (
      id TEXT PRIMARY KEY, subject_id TEXT NOT NULL, category TEXT NOT NULL,
      sensitivity TEXT NOT NULL, status TEXT NOT NULL, confidence REAL NOT NULL,
      source_type TEXT NOT NULL, observed_at TEXT NOT NULL, valid_from TEXT,
      valid_until TEXT, expires_at TEXT, api_policy TEXT NOT NULL,
      consent_required INTEGER NOT NULL DEFAULT 0, consent_status TEXT NOT NULL,
      tags_json TEXT NOT NULL DEFAULT '[]', supersedes_id TEXT,
      payload_encrypted TEXT NOT NULL, source_encrypted TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS private_memories_subject_idx ON private_memories(subject_id, status, updated_at);
    CREATE INDEX IF NOT EXISTS private_memories_policy_idx ON private_memories(api_policy, sensitivity, expires_at);
    CREATE TABLE IF NOT EXISTS private_memory_versions (
      id TEXT PRIMARY KEY, memory_id TEXT NOT NULL, payload_encrypted TEXT NOT NULL,
      changed_at TEXT NOT NULL, reason TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS private_hard_rules (
      id TEXT PRIMARY KEY, rule_key TEXT NOT NULL UNIQUE, statement TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1, requires_opt_in INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS private_consents (
      id TEXT PRIMARY KEY, subject_id TEXT NOT NULL, purpose TEXT NOT NULL,
      status TEXT NOT NULL, granted_at TEXT, revoked_at TEXT, updated_at TEXT NOT NULL,
      UNIQUE(subject_id, purpose)
    );
    CREATE TABLE IF NOT EXISTS private_memory_audit (
      id TEXT PRIMARY KEY, event_type TEXT NOT NULL, record_id TEXT,
      subject_id TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS private_memory_migrations (
      id TEXT PRIMARY KEY, status TEXT NOT NULL, backup_path TEXT,
      report_json TEXT NOT NULL DEFAULT '{}', started_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS private_memory_migration_records (
      migration_id TEXT NOT NULL, source_type TEXT NOT NULL,
      source_id_hash TEXT NOT NULL, fingerprint TEXT NOT NULL,
      target_id TEXT, disposition TEXT NOT NULL, error_code TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY(source_type, source_id_hash),
      FOREIGN KEY(migration_id) REFERENCES private_memory_migrations(id)
    );
    CREATE INDEX IF NOT EXISTS private_memory_migration_target_idx
      ON private_memory_migration_records(target_id);
    CREATE TABLE IF NOT EXISTS pending_approvals (
      id TEXT PRIMARY KEY,
      execution_id TEXT NOT NULL,
      tool_call_id TEXT,
      skill_name TEXT NOT NULL,
      operation TEXT NOT NULL,
      args_fingerprint TEXT NOT NULL,
      permission_level TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      decided_at TEXT,
      consumed_at TEXT,
      resume_token_hash TEXT NOT NULL,
      context_fingerprint TEXT,
      preconditions_fingerprint TEXT,
      superseded_by TEXT,
      failure_code TEXT
    );
    CREATE INDEX IF NOT EXISTS pending_approvals_status_idx
      ON pending_approvals(status, expires_at);
    CREATE INDEX IF NOT EXISTS pending_approvals_execution_idx
      ON pending_approvals(execution_id, status);
    CREATE TABLE IF NOT EXISTS execution_items (
      id TEXT PRIMARY KEY,
      action_id TEXT NOT NULL,
      plan_id TEXT,
      plan_block_id TEXT,
      subject_scope TEXT NOT NULL DEFAULT 'arnaud',
      project_id TEXT,
      source TEXT NOT NULL,
      source_ref TEXT,
      planned_start TEXT,
      planned_end TEXT,
      actual_start TEXT,
      actual_end TEXT,
      status TEXT NOT NULL,
      progress REAL,
      confidence REAL NOT NULL,
      completion_source TEXT,
      blocker_json TEXT,
      notes_encrypted TEXT,
      remaining_duration_minutes INTEGER,
      priority_score REAL NOT NULL DEFAULT 0,
      due_at TEXT,
      dependencies_json TEXT NOT NULL DEFAULT '[]',
      manual_move INTEGER NOT NULL DEFAULT 0,
      deferred_until TEXT,
      last_event_at TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(action_id, plan_block_id, subject_scope)
    );
    CREATE INDEX IF NOT EXISTS execution_status_idx ON execution_items(status, planned_end, due_at);
    CREATE INDEX IF NOT EXISTS execution_action_idx ON execution_items(action_id, subject_scope, updated_at);
    CREATE TABLE IF NOT EXISTS execution_events (
      id TEXT PRIMARY KEY,
      execution_item_id TEXT NOT NULL,
      event_key TEXT NOT NULL UNIQUE,
      event_type TEXT NOT NULL,
      from_status TEXT,
      to_status TEXT NOT NULL,
      source TEXT NOT NULL,
      confidence REAL NOT NULL,
      occurred_at TEXT NOT NULL,
      reason_code TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(execution_item_id) REFERENCES execution_items(id)
    );
    CREATE INDEX IF NOT EXISTS execution_events_item_idx ON execution_events(execution_item_id, occurred_at);
    CREATE TABLE IF NOT EXISTS duration_statistics (
      scope_key TEXT PRIMARY KEY,
      sample_count INTEGER NOT NULL,
      total_estimated_minutes REAL NOT NULL,
      total_actual_minutes REAL NOT NULL,
      samples_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS review_records (
      id TEXT PRIMARY KEY,
      review_type TEXT NOT NULL,
      subject_scope TEXT NOT NULL,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      review_version INTEGER NOT NULL DEFAULT 1,
      fingerprint TEXT NOT NULL UNIQUE,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS review_period_idx
      ON review_records(subject_scope, review_type, period_start, period_end);
    CREATE TABLE IF NOT EXISTS model_performance_samples (
      id TEXT PRIMARY KEY,
      task_domain TEXT NOT NULL,
      required_quality TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      success INTEGER,
      failure_category TEXT,
      latency_ms REAL,
      input_tokens INTEGER,
      output_tokens INTEGER,
      actual_cost REAL,
      first_pass_success INTEGER,
      fallback_used INTEGER NOT NULL DEFAULT 0,
      escalation_used INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS model_performance_lookup_idx
      ON model_performance_samples(task_domain, required_quality, provider, model, created_at);
    CREATE TABLE IF NOT EXISTS artifacts (
      artifact_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      parent_artifact_id TEXT,
      artifact_type TEXT NOT NULL,
      output_format TEXT NOT NULL,
      state TEXT NOT NULL,
      title TEXT NOT NULL,
      content_fingerprint TEXT NOT NULL,
      request_fingerprint TEXT NOT NULL,
      plan_json TEXT NOT NULL,
      source_ids_json TEXT NOT NULL DEFAULT '[]',
      source_synthesis_id TEXT,
      privacy_mode TEXT NOT NULL DEFAULT 'internal',
      preview_path TEXT,
      output_path TEXT,
      size_bytes INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(artifact_id, version)
    );
    CREATE INDEX IF NOT EXISTS artifacts_state_idx
      ON artifacts(state, updated_at);
    CREATE INDEX IF NOT EXISTS artifacts_fingerprint_idx
      ON artifacts(content_fingerprint, output_format);
    CREATE TABLE IF NOT EXISTS artifact_writes (
      write_operation_id TEXT PRIMARY KEY,
      artifact_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      destination TEXT NOT NULL,
      content_fingerprint TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active', profile_scope TEXT NOT NULL DEFAULT 'arnaud',
      memory_scope TEXT, active_mode TEXT, pinned INTEGER NOT NULL DEFAULT 0,
      metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL, archived_at TEXT, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS workspaces_status_idx ON workspaces(status, pinned, updated_at);
    CREATE TABLE IF NOT EXISTS workspace_projects (
      workspace_id TEXT NOT NULL, project_id TEXT NOT NULL, linked_at TEXT NOT NULL,
      PRIMARY KEY(workspace_id, project_id),
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
    );
    CREATE TABLE IF NOT EXISTS workspace_roots (
      workspace_id TEXT NOT NULL, root_path TEXT NOT NULL, access_mode TEXT NOT NULL,
      linked_at TEXT NOT NULL, PRIMARY KEY(workspace_id, root_path),
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
    );
    CREATE TABLE IF NOT EXISTS workspace_conversations (
      conversation_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, linked_at TEXT NOT NULL,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
    );
    CREATE INDEX IF NOT EXISTS workspace_conversations_workspace_idx ON workspace_conversations(workspace_id, linked_at);
    CREATE TABLE IF NOT EXISTS workspace_artifacts (
      artifact_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT,
      linked_at TEXT NOT NULL, FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
    );
    CREATE INDEX IF NOT EXISTS workspace_artifacts_workspace_idx ON workspace_artifacts(workspace_id, linked_at);
    CREATE TABLE IF NOT EXISTS workspace_active_state (
      profile_scope TEXT PRIMARY KEY, workspace_id TEXT, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS continuity_sessions (
      id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, profile_scope TEXT NOT NULL,
      workspace_id TEXT, project_id TEXT, mode TEXT, status TEXT NOT NULL,
      current_task_json TEXT, current_artifact_json TEXT, current_search_json TEXT,
      current_plan_json TEXT, active_execution_id TEXT,
      pending_approval_ids_json TEXT NOT NULL DEFAULT '[]',
      recent_entity_refs_json TEXT NOT NULL DEFAULT '[]',
      summary_json TEXT, resume_checkpoint_json TEXT, last_channel TEXT,
      recovered_from_crash INTEGER NOT NULL DEFAULT 0,
      version INTEGER NOT NULL DEFAULT 1, started_at TEXT NOT NULL,
      last_activity_at TEXT NOT NULL, updated_at TEXT NOT NULL, closed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS continuity_sessions_conversation_idx
      ON continuity_sessions(conversation_id, profile_scope, last_activity_at);
    CREATE INDEX IF NOT EXISTS continuity_sessions_status_idx
      ON continuity_sessions(status, last_activity_at);
    CREATE TABLE IF NOT EXISTS continuity_checkpoints (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
      payload_json TEXT NOT NULL, created_at TEXT NOT NULL,
      UNIQUE(session_id, fingerprint),
      FOREIGN KEY(session_id) REFERENCES continuity_sessions(id)
    );
    CREATE INDEX IF NOT EXISTS continuity_checkpoints_session_idx
      ON continuity_checkpoints(session_id, created_at);
    CREATE TABLE IF NOT EXISTS transactional_executions (
      execution_id TEXT PRIMARY KEY, intent_id TEXT, plan_version TEXT NOT NULL,
      plan_fingerprint TEXT NOT NULL, action_fingerprint TEXT,
      policy_version TEXT, approval_id TEXT, state TEXT NOT NULL,
      failure_policy TEXT NOT NULL, atomicity TEXT NOT NULL,
      workspace_id TEXT, project_id TEXT, profile_scope TEXT NOT NULL,
      session_id TEXT, conversation_id TEXT, reason_code TEXT,
      safe_result_json TEXT, requested_at TEXT NOT NULL, created_at TEXT NOT NULL,
      started_at TEXT, completed_at TEXT, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS transactional_executions_state_idx
      ON transactional_executions(state, updated_at);
    CREATE TABLE IF NOT EXISTS transactional_execution_steps (
      execution_id TEXT NOT NULL, step_id TEXT NOT NULL, skill_id TEXT NOT NULL,
      operation TEXT NOT NULL, args_fingerprint TEXT NOT NULL,
      idempotency_key TEXT NOT NULL, dependencies_json TEXT NOT NULL DEFAULT '[]',
      action_class TEXT NOT NULL, state TEXT NOT NULL,
      verification_level TEXT NOT NULL, verification_state TEXT,
      result_ref TEXT, provider_ref_hash TEXT, reason_code TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0, started_at TEXT,
      applied_at TEXT, verified_at TEXT, completed_at TEXT, updated_at TEXT NOT NULL,
      PRIMARY KEY(execution_id, step_id),
      FOREIGN KEY(execution_id) REFERENCES transactional_executions(execution_id)
    );
    CREATE INDEX IF NOT EXISTS transactional_steps_state_idx
      ON transactional_execution_steps(state, updated_at);
    CREATE INDEX IF NOT EXISTS transactional_steps_idempotency_idx
      ON transactional_execution_steps(idempotency_key, state);
    CREATE TABLE IF NOT EXISTS conversation_segments (
      id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, session_id TEXT NOT NULL,
      title TEXT, workspace_id TEXT, summary_ref TEXT, started_at TEXT NOT NULL,
      ended_at TEXT, reason TEXT,
      FOREIGN KEY(session_id) REFERENCES continuity_sessions(id)
    );
    CREATE INDEX IF NOT EXISTS conversation_segments_conversation_idx
      ON conversation_segments(conversation_id, started_at);
    CREATE TABLE IF NOT EXISTS background_jobs (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, handler_version INTEGER NOT NULL,
      state TEXT NOT NULL, priority TEXT NOT NULL, resource_class TEXT NOT NULL,
      profile_scope TEXT NOT NULL DEFAULT 'arnaud', workspace_id TEXT, project_id TEXT,
      session_id TEXT, conversation_id TEXT, input_mode TEXT NOT NULL,
      input_ref_json TEXT NOT NULL DEFAULT '{}', output_ref_json TEXT NOT NULL DEFAULT '{}',
      progress_json TEXT NOT NULL DEFAULT '{}', retry_policy_json TEXT NOT NULL DEFAULT '{}',
      budget_json TEXT NOT NULL DEFAULT '{}', metadata_json TEXT NOT NULL DEFAULT '{}',
      dependencies_json TEXT NOT NULL DEFAULT '[]', checkpoint_json TEXT NOT NULL DEFAULT '{}',
      idempotency_key TEXT, dedupe_key TEXT, attempt_count INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 1, scheduled_at TEXT NOT NULL,
      lease_owner TEXT, lease_expires_at TEXT, reason_code TEXT,
      notification_state TEXT NOT NULL DEFAULT 'PENDING', created_at TEXT NOT NULL,
      started_at TEXT, completed_at TEXT, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS background_jobs_queue_idx
      ON background_jobs(state, scheduled_at, priority, created_at);
    CREATE INDEX IF NOT EXISTS background_jobs_scope_idx
      ON background_jobs(profile_scope, workspace_id, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS background_jobs_idempotency_idx
      ON background_jobs(idempotency_key) WHERE idempotency_key IS NOT NULL;
    CREATE INDEX IF NOT EXISTS background_jobs_dedupe_idx
      ON background_jobs(dedupe_key, state);
    CREATE TABLE IF NOT EXISTS sync_meta (
      key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sync_devices (
      device_id TEXT PRIMARY KEY, device_type TEXT NOT NULL, display_name TEXT NOT NULL,
      platform TEXT, app_version TEXT, protocol_version INTEGER NOT NULL,
      public_signing_key TEXT NOT NULL, public_encryption_key TEXT NOT NULL,
      status TEXT NOT NULL, capabilities_json TEXT NOT NULL DEFAULT '[]',
      sync_scopes_json TEXT NOT NULL DEFAULT '[]', sync_window_json TEXT NOT NULL DEFAULT '{}',
      paired_at TEXT, last_seen_at TEXT, revoked_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sync_devices_status_idx ON sync_devices(status, last_seen_at);
    CREATE TABLE IF NOT EXISTS sync_pairing_requests (
      pairing_id TEXT PRIMARY KEY, device_id TEXT NOT NULL, request_json TEXT NOT NULL,
      code_hash TEXT NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL, consumed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS sync_entities (
      entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, profile_scope TEXT NOT NULL,
      revision INTEGER NOT NULL, payload_json TEXT NOT NULL, field_versions_json TEXT NOT NULL DEFAULT '{}',
      origin_device_id TEXT NOT NULL, deleted_at TEXT, updated_at TEXT NOT NULL,
      PRIMARY KEY(entity_type, entity_id, profile_scope)
    );
    CREATE TABLE IF NOT EXISTS sync_changes (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT, change_id TEXT NOT NULL UNIQUE,
      entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, operation TEXT NOT NULL,
      version INTEGER NOT NULL, changed_at TEXT NOT NULL, origin_device_id TEXT NOT NULL,
      profile_scope TEXT NOT NULL, sync_classification TEXT NOT NULL,
      changed_fields_json TEXT NOT NULL DEFAULT '[]', base_field_versions_json TEXT NOT NULL DEFAULT '{}',
      tombstone_until TEXT
    );
    CREATE INDEX IF NOT EXISTS sync_changes_cursor_idx ON sync_changes(sequence, profile_scope);
    CREATE TABLE IF NOT EXISTS sync_outbox (
      outbox_id TEXT PRIMARY KEY, change_id TEXT NOT NULL, target_device_id TEXT NOT NULL,
      state TEXT NOT NULL, attempt_count INTEGER NOT NULL DEFAULT 0, envelope_json TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, acknowledged_at TEXT,
      UNIQUE(change_id, target_device_id)
    );
    CREATE INDEX IF NOT EXISTS sync_outbox_state_idx ON sync_outbox(state, created_at);
    CREATE TABLE IF NOT EXISTS sync_applied_envelopes (
      envelope_id TEXT PRIMARY KEY, source_device_id TEXT NOT NULL,
      applied_at TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sync_conflicts (
      conflict_id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
      field TEXT NOT NULL, version_a_json TEXT NOT NULL, version_b_json TEXT NOT NULL,
      device_a TEXT NOT NULL, device_b TEXT NOT NULL, detected_at TEXT NOT NULL,
      resolution_state TEXT NOT NULL, resolution_json TEXT, resolved_at TEXT
    );
    CREATE INDEX IF NOT EXISTS sync_conflicts_state_idx ON sync_conflicts(resolution_state, detected_at);
    CREATE TABLE IF NOT EXISTS sync_cursors (
      device_id TEXT PRIMARY KEY, inbound_sequence INTEGER NOT NULL DEFAULT 0,
      outbound_sequence INTEGER NOT NULL DEFAULT 0, snapshot_revision INTEGER,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sync_remote_requests (
      request_id TEXT PRIMARY KEY, source_device_id TEXT NOT NULL, nonce_hash TEXT NOT NULL,
      status TEXT NOT NULL, intent_ref_json TEXT NOT NULL, created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL, consumed_at TEXT, result_ref_json TEXT,
      UNIQUE(source_device_id, nonce_hash)
    );
    CREATE TABLE IF NOT EXISTS remote_device_sessions (
      device_session_id TEXT PRIMARY KEY, device_id TEXT NOT NULL, connection_state TEXT NOT NULL,
      presence_state TEXT NOT NULL, capabilities_json TEXT NOT NULL DEFAULT '[]',
      active_conversation_id TEXT, connected_at TEXT NOT NULL, last_activity_at TEXT NOT NULL, closed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS remote_requests (
      request_id TEXT PRIMARY KEY, remote_input_id TEXT NOT NULL UNIQUE, device_id TEXT NOT NULL,
      device_session_id TEXT NOT NULL, channel TEXT NOT NULL, conversation_id TEXT, workspace_id TEXT,
      sequence INTEGER NOT NULL, nonce_hash TEXT NOT NULL, state TEXT NOT NULL,
      intent_ref_json TEXT NOT NULL DEFAULT '{}', result_ref_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL, expires_at TEXT, updated_at TEXT NOT NULL,
      UNIQUE(device_id, nonce_hash)
    );
    CREATE INDEX IF NOT EXISTS remote_requests_device_state_idx ON remote_requests(device_id, state, updated_at);
    CREATE TABLE IF NOT EXISTS remote_outputs (
      remote_output_id TEXT PRIMARY KEY, request_id TEXT NOT NULL, conversation_id TEXT,
      type TEXT NOT NULL, payload_ref_json TEXT NOT NULL, sequence INTEGER NOT NULL,
      final INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
      UNIQUE(request_id, sequence)
    );
    CREATE INDEX IF NOT EXISTS remote_outputs_resume_idx ON remote_outputs(request_id, sequence);
    CREATE TABLE IF NOT EXISTS remote_handoffs (
      handoff_id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, session_id TEXT NOT NULL,
      source_device_id TEXT NOT NULL, target_device_id TEXT NOT NULL, workspace_id TEXT,
      refs_json TEXT NOT NULL DEFAULT '{}', state TEXT NOT NULL, created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL, completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS remote_handoffs_target_idx ON remote_handoffs(target_device_id, state, expires_at);
    CREATE TABLE IF NOT EXISTS remote_media_transfers (
      transfer_id TEXT PRIMARY KEY, request_id TEXT NOT NULL, device_id TEXT NOT NULL,
      media_type TEXT NOT NULL, filename TEXT, expected_hash TEXT NOT NULL,
      received_hash TEXT, size_bytes INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL,
      asset_ref_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS remote_approval_responses (
      response_id TEXT PRIMARY KEY, approval_id TEXT NOT NULL, device_id TEXT NOT NULL,
      nonce_hash TEXT NOT NULL, decision TEXT NOT NULL, responded_at TEXT NOT NULL,
      state TEXT NOT NULL, UNIQUE(device_id, nonce_hash)
    );
    CREATE TABLE IF NOT EXISTS benchmark_sessions (
      id TEXT PRIMARY KEY, benchmark_id TEXT NOT NULL, suite_version TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE, state TEXT NOT NULL, next_run_index INTEGER NOT NULL DEFAULT 0,
      cancel_requested INTEGER NOT NULL DEFAULT 0, version_metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS benchmark_sessions_benchmark_idx ON benchmark_sessions(benchmark_id, created_at);
    CREATE INDEX IF NOT EXISTS benchmark_sessions_state_idx ON benchmark_sessions(state, updated_at);
    CREATE TABLE IF NOT EXISTS benchmark_runs (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, run_index INTEGER NOT NULL, task_id TEXT NOT NULL,
      participant TEXT NOT NULL, state TEXT NOT NULL, start_fingerprint TEXT, started_at TEXT, ended_at TEXT,
      failure_category TEXT, participant_reported_status TEXT, final_verdict TEXT,
      first_pass_success INTEGER, repair_cycles INTEGER, iterations INTEGER, duration_ms INTEGER,
      regression_count INTEGER, scope_violations INTEGER, security_violations INTEGER,
      user_intervention_count INTEGER NOT NULL DEFAULT 0, provider TEXT, initial_model TEXT, final_model TEXT,
      retry_count INTEGER, fallback_count INTEGER, escalation_count INTEGER, input_tokens INTEGER,
      output_tokens INTEGER, estimated_cost REAL, calculated_actual_cost REAL, cost_type TEXT,
      validation_summary_json TEXT, result_finalized INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL,
      UNIQUE(session_id, run_index), FOREIGN KEY(session_id) REFERENCES benchmark_sessions(id)
    );
    CREATE INDEX IF NOT EXISTS benchmark_runs_session_idx ON benchmark_runs(session_id, run_index);
    CREATE INDEX IF NOT EXISTS benchmark_runs_state_idx ON benchmark_runs(state, updated_at);
    CREATE TABLE IF NOT EXISTS benchmark_arms (
      arm_id TEXT PRIMARY KEY, suite_version TEXT NOT NULL, state TEXT NOT NULL,
      benchmark_session_id TEXT, approved_cap_usd REAL NOT NULL,
      created_at TEXT NOT NULL, expires_at TEXT NOT NULL, bound_at TEXT,
      completed_at TEXT, cancelled_at TEXT, failed_at TEXT, failure_reason TEXT,
      previous_runtime_state_json TEXT NOT NULL DEFAULT '{}',
      authorized_participants_json TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS benchmark_arms_state_expiry_idx ON benchmark_arms(state, expires_at);
    CREATE INDEX IF NOT EXISTS benchmark_arms_session_idx ON benchmark_arms(benchmark_session_id);
  `);
  // Migration additive pour les bases v12 créées pendant le rollout SHADOW.
  ensureColumn(database, "sync_changes", "base_field_versions_json", "base_field_versions_json TEXT NOT NULL DEFAULT '{}'");
  // Les anciennes exécutions restent volontairement sans projet : aucune
  // inférence ne doit les faire apparaître dans un contexte A3 projet.
  ensureColumn(database, "execution_items", "project_id", "project_id TEXT");
  database.exec("CREATE INDEX IF NOT EXISTS execution_scope_project_idx ON execution_items(subject_scope, project_id, planned_start, updated_at)");
  // Les recommandations et feedbacks historiques restent sans portée : une
  // review ciblée ne doit jamais les assimiler au profil demandé.
  ensureColumn(database, "recommendations", "subject_scope", "subject_scope TEXT");
  ensureColumn(database, "feedback_events", "subject_scope", "subject_scope TEXT");
  database.exec("CREATE INDEX IF NOT EXISTS recommendation_subject_time_idx ON recommendations(subject_scope, first_detected_at)");
  database.exec("CREATE INDEX IF NOT EXISTS feedback_subject_time_idx ON feedback_events(subject_scope, created_at)");
  try {
    database.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS memory_items_fts USING fts5(id UNINDEXED, subject, value_text);`);
    database.ftsAvailable = true;
  } catch { database.ftsAvailable = false; }
  database.prepare("INSERT OR IGNORE INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)")
    .run(SCHEMA_VERSION, "personal-intelligence-base", new Date().toISOString());
}

function createFallback(filePath) {
  const fallbackPath = `${filePath}.fallback.json`;
  function load() {
    try { return JSON.parse(fs.readFileSync(fallbackPath, "utf8")); }
    catch { return { version: SCHEMA_VERSION, dev_project_rules: [], memory_items: [], projects: [], inbox_items: [], recommendations: [], followups: [], feedback_events: [], metrics_events: [], pending_approvals: [], execution_items: [], execution_events: [], duration_statistics: [], review_records: [], model_performance_samples: [], artifacts: [], artifact_writes: [], workspaces: [], workspace_projects: [], workspace_roots: [], workspace_conversations: [], workspace_artifacts: [], workspace_active_state: [], continuity_sessions: [], continuity_checkpoints: [], conversation_segments: [], transactional_executions: [], transactional_execution_steps: [], background_jobs: [], sync_devices: [], sync_pairing_requests: [], sync_entities: [], sync_changes: [], sync_outbox: [], sync_applied_envelopes: [], remote_device_sessions: [], remote_requests: [], remote_outputs: [], remote_handoffs: [], remote_media_transfers: [], remote_approval_responses: [] }; }
  }
  function save(data) {
    fs.mkdirSync(path.dirname(fallbackPath), { recursive: true });
    const temporary = `${fallbackPath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, fallbackPath);
  }
  return { kind: "json-fallback", filePath: fallbackPath, load, save, ftsAvailable: false, close() {} };
}

function createPersonalDatabase(filePath) {
  const sqlite = loadSqlite();
  if (!sqlite?.DatabaseSync) return createFallback(filePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const database = new sqlite.DatabaseSync(filePath);
  try {
    database.exec(`PRAGMA busy_timeout = ${PERSONAL_DATABASE_BUSY_TIMEOUT_MS}`);
    createSchema(database);
  } catch (error) {
    try { database.close(); } catch {}
    throw error;
  }
  return { kind: "sqlite", filePath, database, get ftsAvailable() { return database.ftsAvailable === true; }, close: () => database.close() };
}

module.exports = {
  PERSONAL_DATABASE_BUSY_TIMEOUT_MS,
  SCHEMA_VERSION,
  createPersonalDatabase,
  createSchema,
  loadSqlite,
};
