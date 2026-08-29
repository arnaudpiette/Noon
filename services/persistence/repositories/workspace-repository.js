"use strict";

function parse(value, fallback) { try { return JSON.parse(value); } catch { return fallback; } }
function rowWorkspace(row) {
  if (!row) return null;
  return {
    id: row.id, name: row.name, type: row.type, status: row.status,
    profileScope: row.profile_scope, memoryScope: row.memory_scope,
    activeMode: row.active_mode, pinned: Boolean(row.pinned),
    metadata: parse(row.metadata_json, {}), createdAt: row.created_at,
    updatedAt: row.updated_at, archivedAt: row.archived_at, deletedAt: row.deleted_at,
  };
}

function createWorkspaceRepository(wrapper) {
  if (wrapper?.kind === "sqlite") {
    const db = wrapper.database;
    const saveWorkspace = db.prepare(`INSERT INTO workspaces(
      id,name,type,status,profile_scope,memory_scope,active_mode,pinned,metadata_json,
      created_at,updated_at,archived_at,deleted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,type=excluded.type,status=excluded.status,
      profile_scope=excluded.profile_scope,memory_scope=excluded.memory_scope,
      active_mode=excluded.active_mode,pinned=excluded.pinned,metadata_json=excluded.metadata_json,
      updated_at=excluded.updated_at,archived_at=excluded.archived_at,deleted_at=excluded.deleted_at`);
    const linkStatements = {
      project: db.prepare("INSERT OR IGNORE INTO workspace_projects(workspace_id,project_id,linked_at) VALUES(?,?,?)"),
      root: db.prepare("INSERT OR REPLACE INTO workspace_roots(workspace_id,root_path,access_mode,linked_at) VALUES(?,?,?,?)"),
      conversation: db.prepare("INSERT OR REPLACE INTO workspace_conversations(conversation_id,workspace_id,linked_at) VALUES(?,?,?)"),
      artifact: db.prepare("INSERT OR REPLACE INTO workspace_artifacts(artifact_id,workspace_id,project_id,linked_at) VALUES(?,?,?,?)"),
    };
    return {
      save(workspace) { saveWorkspace.run(workspace.id, workspace.name, workspace.type, workspace.status, workspace.profileScope, workspace.memoryScope, workspace.activeMode, workspace.pinned ? 1 : 0, JSON.stringify(workspace.metadata || {}), workspace.createdAt, workspace.updatedAt, workspace.archivedAt, workspace.deletedAt); return workspace; },
      get(id) { return rowWorkspace(db.prepare("SELECT * FROM workspaces WHERE id=?").get(id)); },
      list({ includeDeleted = false } = {}) { return db.prepare(`SELECT * FROM workspaces ${includeDeleted ? "" : "WHERE deleted_at IS NULL"} ORDER BY pinned DESC,updated_at DESC`).all().map(rowWorkspace); },
      link(kind, workspaceId, target, at) { const statement = linkStatements[kind]; if (!statement) throw new TypeError("Type de liaison Workspace invalide."); kind === "root" ? statement.run(workspaceId, target.path, target.mode, at) : kind === "conversation" ? statement.run(target.id, workspaceId, at) : kind === "artifact" ? statement.run(target.id, workspaceId, target.projectId || null, at) : statement.run(workspaceId, target.id, at); },
      unlink(kind, workspaceId, id) { const table = { project: "workspace_projects", root: "workspace_roots", conversation: "workspace_conversations", artifact: "workspace_artifacts" }[kind]; const column = { project: "project_id", root: "root_path", conversation: "conversation_id", artifact: "artifact_id" }[kind]; if (!table) throw new TypeError("Type de liaison Workspace invalide."); db.prepare(`DELETE FROM ${table} WHERE workspace_id=? AND ${column}=?`).run(workspaceId, id); },
      links(workspaceId) { return { projects: db.prepare("SELECT project_id AS id,linked_at AS linkedAt FROM workspace_projects WHERE workspace_id=?").all(workspaceId), roots: db.prepare("SELECT root_path AS path,access_mode AS mode,linked_at AS linkedAt FROM workspace_roots WHERE workspace_id=?").all(workspaceId), conversations: db.prepare("SELECT conversation_id AS id,linked_at AS linkedAt FROM workspace_conversations WHERE workspace_id=?").all(workspaceId), artifacts: db.prepare("SELECT artifact_id AS id,project_id AS projectId,linked_at AS linkedAt FROM workspace_artifacts WHERE workspace_id=?").all(workspaceId) }; },
      workspaceForConversation(id) { return db.prepare("SELECT workspace_id AS workspaceId FROM workspace_conversations WHERE conversation_id=?").get(id)?.workspaceId || null; },
      setActive(profile, id, at) { db.prepare("INSERT OR REPLACE INTO workspace_active_state(profile_scope,workspace_id,updated_at) VALUES(?,?,?)").run(profile, id, at); },
      getActive(profile) { return db.prepare("SELECT workspace_id AS workspaceId FROM workspace_active_state WHERE profile_scope=?").get(profile)?.workspaceId || null; },
    };
  }
  function mutate(operation) { const state = wrapper.load(); for (const key of ["workspaces", "workspace_projects", "workspace_roots", "workspace_conversations", "workspace_artifacts", "workspace_active_state"]) state[key] ||= []; const result = operation(state); wrapper.save(state); return result; }
  return {
    save(workspace) { return mutate((state) => { state.workspaces = state.workspaces.filter((item) => item.id !== workspace.id); state.workspaces.push({ ...workspace }); return workspace; }); },
    get(id) { return (wrapper.load().workspaces || []).find((item) => item.id === id) || null; },
    list({ includeDeleted = false } = {}) { return (wrapper.load().workspaces || []).filter((item) => includeDeleted || !item.deletedAt).sort((a,b) => Number(b.pinned)-Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt)); },
    link(kind, workspaceId, target, at) { return mutate((state) => { const key = `workspace_${kind === "project" ? "projects" : kind === "root" ? "roots" : kind === "conversation" ? "conversations" : "artifacts"}`; const idKey = kind === "root" ? "path" : "id"; if (["conversation", "artifact"].includes(kind)) state[key] = state[key].filter((item) => item[idKey] !== target[idKey]); else state[key] = state[key].filter((item) => item.workspaceId !== workspaceId || item[idKey] !== target[idKey]); state[key].push({ workspaceId, ...target, linkedAt: at }); }); },
    unlink(kind, workspaceId, id) { return mutate((state) => { const key = `workspace_${kind === "project" ? "projects" : kind === "root" ? "roots" : kind === "conversation" ? "conversations" : "artifacts"}`; const idKey = kind === "root" ? "path" : "id"; state[key] = state[key].filter((item) => item.workspaceId !== workspaceId || item[idKey] !== id); }); },
    links(workspaceId) { const state = wrapper.load(); return { projects: (state.workspace_projects || []).filter((x) => x.workspaceId === workspaceId), roots: (state.workspace_roots || []).filter((x) => x.workspaceId === workspaceId), conversations: (state.workspace_conversations || []).filter((x) => x.workspaceId === workspaceId), artifacts: (state.workspace_artifacts || []).filter((x) => x.workspaceId === workspaceId) }; },
    workspaceForConversation(id) { return (wrapper.load().workspace_conversations || []).find((item) => item.id === id)?.workspaceId || null; },
    setActive(profile, id, at) { return mutate((state) => { state.workspace_active_state = state.workspace_active_state.filter((item) => item.profileScope !== profile); state.workspace_active_state.push({ profileScope: profile, workspaceId: id, updatedAt: at }); }); },
    getActive(profile) { return (wrapper.load().workspace_active_state || []).find((item) => item.profileScope === profile)?.workspaceId || null; },
  };
}

module.exports = { createWorkspaceRepository, rowWorkspace };
