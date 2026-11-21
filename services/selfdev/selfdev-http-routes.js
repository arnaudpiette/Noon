"use strict";

// SelfDev V1 (SD-3) — surface HTTP locale, préfixe /api/selfdev/, flag selfdev.v1.
// Garde-fous : 404 si le flag est OFF au moment de la requête, en-tête x-noon-request
// obligatoire pour toute mutation, corps borné à clés exactes, aucun chemin d'exécution
// fourni par le client (le worktree vient du manifeste ; l'exécuteur sandboxé vérifie que
// le dossier est dans une racine read-write du workspace indiqué). Aucun modèle ici : le
// patch est produit par un run Goal Mode DEV ordinaire sur le projet du worktree.

const ROUTE = /^\/api\/selfdev\/(status|target|worktrees)(?:\/([a-z0-9][a-z0-9-]{5,47})(?:\/(baseline|patched|reproduction|verdict|check|review))?)?$/;
const BODY_LIMIT = 16 * 1024;

function httpError(status, code, message) { return Object.assign(new Error(message), { status, code }); }

function exactKeys(body, allowed, required = []) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw httpError(400, "SELFDEV_BODY_INVALID", "Corps de requête invalide.");
  for (const key of Object.keys(body)) if (!allowed.includes(key)) throw httpError(400, "SELFDEV_BODY_INVALID", `Champ non autorisé : ${key}.`);
  for (const key of required) if (body[key] == null) throw httpError(400, "SELFDEV_BODY_INVALID", `Champ requis : ${key}.`);
  return body;
}

function workspaceIdFrom(body) {
  const value = String(body.workspaceId || "").trim();
  if (!/^[A-Za-z0-9:_-]{1,180}$/.test(value)) throw httpError(400, "SELFDEV_BODY_INVALID", "workspaceId invalide.");
  return value;
}

// workspaceId facultatif : sinon, le serveur cherche l'unique workspace dont une racine
// read-write contient le worktree. Indice seulement : l'exécuteur sandboxé revérifie.
function resolveWorkspace(current, id, body) {
  if (body.workspaceId != null) return workspaceIdFrom(body);
  const found = typeof current.resolveWorkspaceIds === "function"
    ? current.resolveWorkspaceIds(current.worktreeService.describe(id).worktreePath) : [];
  if (found.length === 1) return workspaceIdFrom({ workspaceId: found[0] });
  throw httpError(409, found.length ? "SELFDEV_WORKSPACE_AMBIGUOUS" : "SELFDEV_WORKSPACE_REQUIRED",
    found.length ? "Plusieurs workspaces contiennent cette copie : précise lequel." : "Lie d'abord la copie à un workspace dont son dossier est une racine en lecture-écriture.");
}

// services : () => { targetStore, worktreeService | null, evidenceService | null,
//   reviewService | null, resolveWorkspaceIds(worktreePath) → string[] }
function createSelfDevHttpRoutes({ isEnabled, services, observability = () => {} } = {}) {
  if (typeof isEnabled !== "function" || typeof services !== "function") throw new TypeError("isEnabled et services requis.");
  const emit = (event, metadata) => { try { observability(event, metadata); } catch {} };

  const matches = (requestPath) => ROUTE.test(String(requestPath || ""));

  function context(current, id, body) {
    return Object.freeze({ workspaceId: resolveWorkspace(current, id, body), taskId: `selfdev-${id}`, sessionId: `selfdev:${id}`, permissions: Object.freeze(["TERMINAL_SAFE"]) });
  }

  function requireWorktrees(current) {
    if (!current.worktreeService || !current.evidenceService) throw httpError(409, "SELFDEV_TARGET_REQUIRED", "Enregistre d'abord la cible SelfDev.");
    return current;
  }

  async function dispatch(req, requestPath, readJsonBody) {
    const [, resource, id, action] = ROUTE.exec(requestPath);
    const method = req.method;
    const current = services();
    const body = async () => (method === "GET" ? {} : await readJsonBody(req, BODY_LIMIT));

    if (resource === "status" && method === "GET" && !id) {
      const target = current.targetStore.get();
      const worktrees = current.worktreeService ? current.worktreeService.list() : [];
      return { status: "ok", target, reviewAvailable: Boolean(current.reviewService), worktrees: worktrees.map((item) => ({ ...item, verdict: current.evidenceService?.verdict(item.id) || null, review: current.reviewService?.load(item.id) || null })) };
    }
    if (method !== "GET" && req.headers["x-noon-request"] !== "1") throw httpError(403, "SELFDEV_REQUEST_REFUSED", "Requête Noon refusée.");

    if (resource === "target" && !id) {
      if (method === "PUT") {
        const payload = exactKeys(await body(), ["repositoryRoot", "baseBranch", "worktreeContainer"], ["repositoryRoot", "baseBranch", "worktreeContainer"]);
        const target = current.targetStore.register(payload);
        emit("selfdev.target_registered", {});
        return { status: "ok", target };
      }
      if (method === "DELETE") { current.targetStore.clear(); emit("selfdev.target_cleared", {}); return { status: "ok" }; }
    }

    if (resource === "worktrees") {
      const { worktreeService, evidenceService, targetStore } = requireWorktrees(current);
      if (!id && method === "POST") {
        const payload = exactKeys(await body(), ["baseRef"]);
        const target = targetStore.get();
        if (!target || target.unavailable) throw httpError(409, "SELFDEV_TARGET_REQUIRED", "Cible SelfDev indisponible.");
        const created = worktreeService.create({ repositoryRoot: target.repositoryRoot, baseRef: payload.baseRef || target.baseBranch });
        emit("selfdev.worktree_created", { id: created.id });
        return { status: "ok", worktree: created };
      }
      if (id && !action && method === "DELETE") {
        const payload = exactKeys(await body(), ["discardChanges"]);
        const result = worktreeService.remove(id, { discardChanges: payload.discardChanges === true });
        emit("selfdev.worktree_removed", { id, branchKept: result.branchKept });
        return { status: "ok", ...result };
      }
      if (id && action === "check" && method === "GET") return { status: "ok", check: worktreeService.check(id) };
      if (id && action === "verdict" && method === "GET") return { status: "ok", verdict: evidenceService.verdict(id) };
      if (id && action === "baseline" && method === "POST") {
        const payload = exactKeys(await body(), ["workspaceId", "commands"], ["commands"]);
        const evidence = await evidenceService.runBaseline(id, { commands: payload.commands, context: context(current, id, payload) });
        emit("selfdev.baseline_measured", { id, commands: evidence.commands.length });
        return { status: "ok", verdict: evidenceService.verdict(id) };
      }
      if (id && action === "patched" && method === "POST") {
        const payload = exactKeys(await body(), ["workspaceId"]);
        await evidenceService.runPatched(id, { context: context(current, id, payload) });
        emit("selfdev.patch_measured", { id });
        return { status: "ok", verdict: evidenceService.verdict(id) };
      }
      if (id && action === "reproduction" && method === "POST") {
        const payload = exactKeys(await body(), ["workspaceId", "testFiles"], ["testFiles"]);
        const evidence = await evidenceService.runReproduction(id, { testFiles: payload.testFiles, context: context(current, id, payload) });
        emit("selfdev.reproduction_measured", { id, reproduced: evidence.reproduction.reproduced === true });
        return { status: "ok", verdict: evidenceService.verdict(id) };
      }
      if (id && action === "review" && method === "POST") {
        exactKeys(await body(), []);
        if (!current.reviewService) throw httpError(409, "SELFDEV_REVIEW_UNAVAILABLE", "Aucun relecteur disponible sur ce Mac.");
        const review = await current.reviewService.review(id);
        emit("selfdev.review_completed", { id, provider: review.provider });
        return { status: "ok", review };
      }
    }
    throw httpError(405, "SELFDEV_METHOD_NOT_ALLOWED", "Méthode non autorisée.");
  }

  async function handle(req, res, { requestPath, readJsonBody }) {
    const send = (status, payload) => { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(payload)); };
    if (!isEnabled()) return send(404, { status: "error", code: "SELFDEV_DISABLED", message: "SelfDev désactivé." });
    try {
      return send(200, await dispatch(req, requestPath, readJsonBody));
    } catch (error) {
      const code = String(error?.code || "");
      const known = /^SELFDEV_/.test(code);
      const status = error.status || (known ? (["SELFDEV_PROTECTED_PATH_CHANGED", "SELFDEV_REVIEW_BLOCKED"].includes(code) ? 409 : code === "SELFDEV_REVIEW_UNAVAILABLE" ? 503 : 400) : 500);
      return send(status, { status: "error", code: known ? code : "SELFDEV_ERROR", message: known ? error.message : "Erreur SelfDev." });
    }
  }

  return Object.freeze({ matches, handle });
}

module.exports = { createSelfDevHttpRoutes };
