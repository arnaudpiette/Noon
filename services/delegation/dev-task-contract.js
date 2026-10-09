"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { isPathInsideRoots } = require("../../lib/path-utils");

const QUALITY_LEVELS = Object.freeze(["LOW", "NORMAL", "HIGH", "CRITICAL"]);
const DEV_PERMISSIONS = Object.freeze(["READ_ONLY", "READ_WRITE_WORKSPACE", "TERMINAL_SAFE", "PACKAGE_INSTALL", "GIT_LOCAL", "GIT_REMOTE"]);
const PRIVATE_NAMES = /(^|\/)(?:\.env(?:\.|$)|personal-intelligence\.sqlite(?:-|\.|$)|private-memory-master-key\.bin$|integration-tokens\.json$|\.noon-private(?:\/|$)|recovery-backups(?:\/|$))/i;

class DevTaskContractError extends Error {
  constructor(code, message) { super(message); this.name = "DevTaskContractError"; this.code = code; }
}

function realDirectory(value) {
  try {
    const resolved = fs.realpathSync(path.resolve(String(value || "")));
    if (!fs.statSync(resolved).isDirectory()) throw new Error("not-directory");
    return resolved;
  } catch { throw new DevTaskContractError("WORKSPACE_NOT_FOUND", "Le dépôt de travail est introuvable."); }
}

function resolveScopedPath(root, value) {
  const resolved = path.resolve(root, String(value || "."));
  let checked = resolved;
  try { checked = fs.existsSync(resolved) ? fs.realpathSync(resolved) : fs.realpathSync(path.dirname(resolved)) + path.sep + path.basename(resolved); } catch {}
  if (!isPathInsideRoots(checked, [root])) throw new DevTaskContractError("OUT_OF_SCOPE_CHANGE", "Un chemin sort du dépôt autorisé.");
  return checked;
}

function createDevTaskContract(input = {}) {
  if (input.workspaceAuthorized !== true || !input.workspaceId) throw new DevTaskContractError("PERMISSION_DENIED", "Le workspace doit être explicitement autorisé.");
  if (!String(input.objective || "").trim()) throw new DevTaskContractError("TASK_FAILURE", "L’objectif DEV est requis.");
  const repositoryRoot = realDirectory(input.repositoryRoot);
  const roots = (input.workspaceRoots || []).map(realDirectory);
  if (!roots.length || !isPathInsideRoots(repositoryRoot, roots)) throw new DevTaskContractError("PERMISSION_DENIED", "Le dépôt ne fait pas partie du workspace autorisé.");
  const allowedPaths = [...new Set((input.allowedPaths?.length ? input.allowedPaths : [repositoryRoot]).map((item) => resolveScopedPath(repositoryRoot, item)))];
  const forbiddenPaths = [...new Set((input.forbiddenPaths || []).map((item) => resolveScopedPath(repositoryRoot, item)))];
  const permissions = [...new Set(input.permissions || ["READ_WRITE_WORKSPACE", "TERMINAL_SAFE"])];
  if (permissions.some((item) => !DEV_PERMISSIONS.includes(item))) throw new DevTaskContractError("PERMISSION_DENIED", "Permission DEV inconnue.");
  if (permissions.includes("GIT_REMOTE")) throw new DevTaskContractError("PERMISSION_DENIED", "Les mutations Git distantes sont interdites en V2.5.");
  if (allowedPaths.some((item) => PRIVATE_NAMES.test(path.relative(repositoryRoot, item)))) throw new DevTaskContractError("PERMISSION_DENIED", "Un chemin privé ne peut pas être délégué.");
  return Object.freeze({
    taskId: String(input.taskId || `dev-task-${crypto.randomUUID()}`),
    objective: String(input.objective || "").trim().slice(0, 8000),
    taskDomain: "DEV",
    requiredQuality: QUALITY_LEVELS.includes(String(input.requiredQuality).toUpperCase()) ? String(input.requiredQuality).toUpperCase() : "NORMAL",
    workspace: String(input.workspace || input.workspaceId).slice(0, 160),
    workspaceId: String(input.workspaceId).slice(0, 160),
    sessionId: input.sessionId ? String(input.sessionId).slice(0, 200) : null,
    repositoryRoot,
    branch: input.branch ? String(input.branch).slice(0, 200) : null,
    allowedPaths: Object.freeze(allowedPaths),
    forbiddenPaths: Object.freeze(forbiddenPaths),
    constraints: Object.freeze([...(input.constraints || [])].map(String).slice(0, 100)),
    // Projection serveur uniquement : ce champ ne porte jamais permissions ni capacités.
    projectInstructions: Object.freeze([...(input.projectInstructions || [])].map((item) => String(item).trim()).filter(Boolean).slice(0, 20).map((item) => item.slice(0, 1000))),
    validationCommands: Object.freeze([...(input.validationCommands || [])].map(String).slice(0, 12)),
    permissions: Object.freeze(permissions),
    maxIterations: Math.max(1, Math.min(10, Number(input.maxIterations) || 3)),
    maxDuration: Math.max(1_000, Math.min(30 * 60_000, Number(input.maxDuration) || 10 * 60_000)),
    maxEstimatedCost: Number.isFinite(Number(input.maxEstimatedCost)) ? Math.max(0, Number(input.maxEstimatedCost)) : null,
    benchmark: input.benchmark?.id && Number.isFinite(Number(input.benchmark?.limitUsd)) ? Object.freeze({ id: String(input.benchmark.id).slice(0, 160), limitUsd: Math.max(0, Number(input.benchmark.limitUsd)) }) : null,
    localOnly: input.localOnly === true,
  });
}

module.exports = { DEV_PERMISSIONS, PRIVATE_NAMES, QUALITY_LEVELS, DevTaskContractError, createDevTaskContract, resolveScopedPath };
