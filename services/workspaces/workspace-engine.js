"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { isPathInsideRoots } = require("../../lib/path-utils");

const WORKSPACE_TYPES = new Set(["project", "client", "learning", "personal", "system", "general"]);
const WORKSPACE_STATUSES = new Set(["active", "paused", "archived"]);
const ROOT_MODES = new Set(["read-only", "read-write"]);

class WorkspaceError extends Error {
  constructor(code, message) { super(message); this.name = "WorkspaceError"; this.code = code; }
}
function clean(value, max = 120) { return String(value || "").replace(/[\0\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max); }
function normalize(value) { return clean(value).toLocaleLowerCase("fr").normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }

function createWorkspaceEngine({ repository, allowedRoots = () => [], projectProvider = () => [], conversationProvider = () => [], artifactProvider = () => [], invalidateContext = null, observability = null, now = () => Date.now() } = {}) {
  if (!repository) throw new TypeError("WorkspaceRepository est requis.");
  const emit = (event, metadata = {}) => { try { observability?.(event, metadata); } catch {} };
  const timestamp = () => new Date(now()).toISOString();
  function requireWorkspace(id, { mutable = false } = {}) {
    const workspace = repository.get(String(id || ""));
    if (!workspace || workspace.deletedAt) throw new WorkspaceError("WORKSPACE_NOT_FOUND", "Espace de travail introuvable.");
    if (mutable && workspace.status === "archived") throw new WorkspaceError("WORKSPACE_ARCHIVED", "Cet espace de travail est archivé.");
    return workspace;
  }
  function changed(workspaceId, event) { invalidateContext?.(workspaceId); emit(event, { workspaceId }); }
  function create(input = {}) {
    const name = clean(input.name);
    if (!name) throw new WorkspaceError("WORKSPACE_NAME_REQUIRED", "Le nom de l’espace de travail est requis.");
    const type = WORKSPACE_TYPES.has(input.type) ? input.type : "project";
    const at = timestamp();
    const workspace = { id: String(input.id || `workspace-${crypto.randomUUID()}`), name, type, status: "active", profileScope: clean(input.profileScope || "arnaud", 80), memoryScope: clean(input.memoryScope || `project:${input.projectId || input.id || name}`, 160), activeMode: input.activeMode ? clean(input.activeMode, 40) : null, pinned: input.pinned === true, metadata: input.metadata && typeof input.metadata === "object" ? input.metadata : {}, createdAt: at, updatedAt: at, archivedAt: null, deletedAt: null };
    if (repository.get(workspace.id)) throw new WorkspaceError("WORKSPACE_EXISTS", "Cet identifiant d’espace existe déjà.");
    repository.save(workspace); changed(workspace.id, "workspace_created"); return workspace;
  }
  function update(id, changes = {}) {
    const workspace = requireWorkspace(id, { mutable: true });
    if (changes.name !== undefined) { const name = clean(changes.name); if (!name) throw new WorkspaceError("WORKSPACE_NAME_REQUIRED", "Le nom est vide."); workspace.name = name; }
    if (changes.type !== undefined) { if (!WORKSPACE_TYPES.has(changes.type)) throw new WorkspaceError("WORKSPACE_TYPE_INVALID", "Type d’espace invalide."); workspace.type = changes.type; }
    if (changes.status !== undefined) { if (!WORKSPACE_STATUSES.has(changes.status) || changes.status === "archived") throw new WorkspaceError("WORKSPACE_STATUS_INVALID", "Utilisez archive() pour archiver."); workspace.status = changes.status; }
    if (changes.activeMode !== undefined) workspace.activeMode = changes.activeMode ? clean(changes.activeMode, 40) : null;
    if (changes.pinned !== undefined) workspace.pinned = changes.pinned === true;
    workspace.updatedAt = timestamp(); repository.save(workspace); changed(id, "workspace_updated"); return workspace;
  }
  function archive(id) { const workspace = requireWorkspace(id); const at = timestamp(); workspace.status = "archived"; workspace.archivedAt = at; workspace.updatedAt = at; repository.save(workspace); changed(id, "workspace_archived"); return workspace; }
  function logicalDelete(id) { const workspace = requireWorkspace(id); const at = timestamp(); workspace.deletedAt = at; workspace.updatedAt = at; repository.save(workspace); changed(id, "workspace_deleted"); return workspace; }
  function activate(id, { profileScope = "arnaud" } = {}) { const started = now(); const workspace = requireWorkspace(id, { mutable: true }); const profile = clean(profileScope, 80); if (workspace.profileScope !== profile) throw new WorkspaceError("WORKSPACE_PROFILE_MISMATCH", "Cet espace appartient à un autre profil."); const previousWorkspaceId = repository.getActive(profile); repository.setActive(profile, workspace.id, timestamp()); changed(id, previousWorkspaceId && previousWorkspaceId !== id ? "workspace_switched" : "workspace_activated"); emit("workspace_switch_ms", { workspaceId: id, value: now() - started }); return { ...workspace, previousWorkspaceId: previousWorkspaceId || null }; }
  function active(profileScope = "arnaud") { const id = repository.getActive(clean(profileScope, 80)); return id ? repository.get(id) : null; }
  function resolve(query, { includeArchived = false } = {}) {
    const started = now();
    const raw = clean(query); if (!raw) return { status: "not_found", matches: [] };
    const candidates = repository.list().filter((item) => includeArchived || item.status !== "archived");
    const byId = candidates.find((item) => item.id === raw); if (byId) { emit("workspace_resolution_ms", { value: now() - started, status: "resolved", matchCount: 1 }); return { status: "resolved", workspace: byId, matches: [byId] }; }
    const matches = candidates.filter((item) => normalize(item.name) === normalize(raw));
    const result = matches.length === 1 ? { status: "resolved", workspace: matches[0], matches } : matches.length > 1 ? { status: "ambiguous", matches } : { status: "not_found", matches: [] };
    emit("workspace_resolution_ms", { value: now() - started, status: result.status, matchCount: matches.length }); return result;
  }
  function linkProject(workspaceId, projectId) { const workspace = requireWorkspace(workspaceId, { mutable: true }); const project = projectProvider().find((item) => item.id === projectId); if (!project) throw new WorkspaceError("PROJECT_NOT_FOUND", "Projet introuvable."); repository.link("project", workspace.id, { id: projectId }, timestamp()); changed(workspace.id, "workspace_binding_added"); return project; }
  function unlinkProject(workspaceId, projectId) { requireWorkspace(workspaceId, { mutable: true }); repository.unlink("project", workspaceId, projectId); changed(workspaceId, "workspace_binding_removed"); }
  function bindRoot(workspaceId, rootPath, mode = "read-only") {
    const workspace = requireWorkspace(workspaceId, { mutable: true });
    if (!ROOT_MODES.has(mode)) throw new WorkspaceError("ROOT_MODE_INVALID", "Mode d’accès invalide.");
    let realPath; try { realPath = fs.realpathSync(path.resolve(String(rootPath))); } catch { throw new WorkspaceError("ROOT_NOT_FOUND", "Dossier local introuvable."); }
    const roots = allowedRoots(mode).map((entry) => { try { return fs.realpathSync(entry); } catch { return path.resolve(entry); } });
    if (!isPathInsideRoots(realPath, roots)) throw new WorkspaceError("ROOT_NOT_ALLOWED", "Ce dossier n’est pas autorisé pour ce mode d’accès.");
    repository.link("root", workspace.id, { path: realPath, mode }, timestamp()); changed(workspace.id, "workspace_binding_added"); return { path: realPath, mode };
  }
  function unbindRoot(workspaceId, rootPath) { requireWorkspace(workspaceId, { mutable: true }); let resolved; try { resolved = fs.realpathSync(path.resolve(String(rootPath))); } catch { resolved = path.resolve(String(rootPath)); } repository.unlink("root", workspaceId, resolved); changed(workspaceId, "workspace_binding_removed"); }
  function linkConversation(workspaceId, conversationId) { const workspace = requireWorkspace(workspaceId, { mutable: true }); const id = clean(conversationId, 100); if (!id) throw new WorkspaceError("CONVERSATION_ID_REQUIRED", "Conversation invalide."); repository.link("conversation", workspace.id, { id }, timestamp()); changed(workspace.id, "workspace_conversation_linked"); return id; }
  function moveConversation(conversationId, workspaceId) { return linkConversation(workspaceId, conversationId); }
  function unlinkConversation(conversationId) { const workspaceId = repository.workspaceForConversation(conversationId); if (!workspaceId) return false; repository.unlink("conversation", workspaceId, conversationId); changed(workspaceId, "workspace_binding_removed"); return true; }
  function linkArtifact(workspaceId, artifactId, projectId = null) { const workspace = requireWorkspace(workspaceId, { mutable: true }); repository.link("artifact", workspace.id, { id: clean(artifactId, 120), projectId: projectId ? clean(projectId, 120) : null }, timestamp()); changed(workspace.id, "workspace_artifact_linked"); return artifactId; }
  function context(id, { conversationLimit = 15, artifactLimit = 20 } = {}) {
    const started = now();
    const workspace = requireWorkspace(id); const links = repository.links(id);
    const projects = projectProvider().filter((item) => links.projects.some((link) => link.id === item.id));
    const conversationMap = new Map(conversationProvider().map((item) => [item.id, item]));
    const artifactMap = new Map(artifactProvider().map((item) => [item.artifactId || item.artifact_id || item.id, item]));
    const warnings = [];
    for (const root of links.roots) if (!fs.existsSync(root.path)) warnings.push({ code: "ROOT_UNAVAILABLE" });
    const conversations = links.conversations.slice(-conversationLimit).map((link) => conversationMap.get(link.id) || { id: link.id, orphan: true }).filter(Boolean);
    const artifacts = links.artifacts.slice(-artifactLimit).map((link) => artifactMap.get(link.id) || { id: link.id, projectId: link.projectId, orphan: true }).filter(Boolean);
    const result = { workspace: { ...workspace }, workspaceId: workspace.id, displayName: workspace.name, activeProject: projects[0] || null, projects, relevantRoots: links.roots, roots: links.roots, recentConversations: conversations, conversations, recentArtifacts: artifacts, artifacts, memoryScope: workspace.memoryScope, currentState: { workspaceId: workspace.id, activeProjectId: projects[0]?.id || null, activeConversationId: conversations[0]?.id || null, mode: workspace.activeMode, lastOpenedAt: workspace.updatedAt, currentArtifactId: artifacts[0]?.artifactId || artifacts[0]?.id || null }, warnings, stats: { projectCount: projects.length, rootCount: links.roots.length, conversationCount: links.conversations.length, artifactCount: links.artifacts.length, lastActivityAt: workspace.updatedAt } };
    emit("workspace_context_build_ms", { workspaceId: id, value: now() - started, projectCount: projects.length, rootCount: links.roots.length, conversationCount: links.conversations.length, artifactCount: links.artifacts.length }); return result;
  }
  function temporaryContext(id, overrides = {}) { const base = context(id); return { ...base, temporary: true, activeProject: overrides.projectId ? projectProvider().find((item) => item.id === overrides.projectId) || null : base.activeProject, relevantRoots: overrides.roots || base.relevantRoots }; }
  function health(id) { const value = context(id); const issues = [...value.warnings]; for (const item of value.conversations) if (item.orphan) issues.push({ code: "ORPHAN_CONVERSATION", id: item.id }); for (const item of value.artifacts) if (item.orphan) issues.push({ code: "ORPHAN_ARTIFACT", id: item.id }); const linkedProjects = repository.links(id).projects; for (const item of linkedProjects) if (!value.projects.some((project) => project.id === item.id)) issues.push({ code: "ORPHAN_PROJECT", id: item.id }); emit("workspace_health_checked", { workspaceId: id, issueCount: issues.length }); return { workspaceId: id, healthy: issues.length === 0, issues }; }
  function ensureLegacy(input = {}) {
    const legacyId = clean(input.legacyId, 120);

    if (!legacyId) {
      throw new WorkspaceError(
        "LEGACY_ID_REQUIRED",
        "Identifiant legacy requis."
      );
    }

    const id =
      `workspace-legacy-${crypto
        .createHash("sha256")
        .update(`${legacyId}:${input.rootPath || ""}`)
        .digest("hex")
        .slice(0, 20)}`;

    let workspace = repository.get(id);

    if (!workspace) {
      workspace = create({
        id,
        name: input.name || legacyId,
        type: input.type || "project",
        memoryScope:
          input.memoryScope ||
          `project:${legacyId}`,
        metadata: {
          legacyId,
          migration: "shadow",
        },
      });
    }

    if (
      input.rootPath &&
      !repository
        .links(id)
        .roots
        .some(
          (root) =>
            root.path === input.rootPath
        )
    ) {
      bindRoot(
        id,
        input.rootPath,
        input.mode || "read-only"
      );
    }

    const projectId =
      clean(input.projectId, 120);

    if (input.exclusiveProject === true) {
      for (
        const linked of
        repository.links(id).projects
      ) {
        if (
          !projectId ||
          linked.id !== projectId
        ) {
          unlinkProject(
            id,
            linked.id
          );
        }
      }
    }

    if (
      projectId &&
      !repository
        .links(id)
        .projects
        .some(
          (linked) =>
            linked.id === projectId
        )
    ) {
      linkProject(
        id,
        projectId
      );
    }

    return workspace;
  }
  return { create, update, archive, logicalDelete, activate, openWorkspace: activate, getActiveWorkspace: active, active, resolve, get: (id) => requireWorkspace(id), list: (options) => repository.list(options), linkProject, unlinkProject, bindRoot, unbindRoot, linkConversation, moveConversation, unlinkConversation, linkArtifact, context, temporaryContext, health, ensureLegacy, workspaceForConversation: repository.workspaceForConversation };
}

module.exports = { ROOT_MODES, WORKSPACE_STATUSES, WORKSPACE_TYPES, WorkspaceError, createWorkspaceEngine };
