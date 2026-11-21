"use strict";

// SelfDev V1 (SD-3) — politique de chemins injectée dans la projection Goal Mode DEV.
// Pour un dépôt situé dans le conteneur SelfDev : forbiddenPaths du worktree (zones
// protégées, tests existants, AGENTS.md). Échec fermé pour tout dossier du conteneur
// qui n'est pas un worktree SelfDev connu (sonde, copie orpheline). Hors conteneur : null.

const fs = require("node:fs");
const path = require("node:path");
const { isPathInsideRoots } = require("../../lib/path-utils");

function policyError(code, message) { return Object.assign(new Error(message), { code }); }

// getContext() → { worktreeService } ou null (aucune cible SelfDev enregistrée).
function createSelfDevPathPolicyProvider({ getContext }) {
  if (typeof getContext !== "function") throw new TypeError("getContext requis.");
  return function selfDevPathPolicy({ repositoryRoot }) {
    const context = getContext();
    if (!context?.worktreeService) return null;
    let root;
    try { root = fs.realpathSync(path.resolve(String(repositoryRoot || ""))); }
    catch { throw policyError("SELFDEV_REPOSITORY_INVALID", "Dépôt cible introuvable."); }
    if (!isPathInsideRoots(root, [context.worktreeService.containerRoot])) return null;
    const proposal = context.worktreeService.findByPath(root);
    if (!proposal) throw policyError("SELFDEV_WORKTREE_UNKNOWN", "Dossier du conteneur SelfDev non reconnu : projection refusée.");
    return Object.freeze({ forbiddenPaths: context.worktreeService.contractPolicyPaths(proposal.id), selfDevId: proposal.id });
  };
}

module.exports = { createSelfDevPathPolicyProvider };
