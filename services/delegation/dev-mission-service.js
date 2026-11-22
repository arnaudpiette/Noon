"use strict";

// V3-L5c — mission DEV déléguée, encadrée par deux approbations (D.3, docs/ROADMAP.md).
// 1. Lancer : approbation liée à l'objectif, aux chemins, à l'exécutant et au commit de base.
// 2. Appliquer : approbation liée à l'empreinte SHA-256 exacte du patch produit.
// Approbations du moteur V2 : usage unique, expiration, empreinte exacte, annulées au redémarrage.
// Noon n'applique qu'un patch de mission PASS, jamais sur un fichier qu'Arnaud a modifié
// localement, sans index ni commit (`git apply` simple). Rien n'est poussé.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const SKILL = "dev-mission";
const EXECUTORS = new Set(["codex-cli", "claude-code"]);
const MAX_OBJECTIVE = 4000;
const MAX_PATHS = 20;
const ID = /^mission-[0-9a-f]{12}$/;

const fail = (code, message, statusCode = 400) => Object.assign(new Error(message), { code, statusCode });

function defaultGit(cwd, args) {
  return execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], { cwd, encoding: "utf8", timeout: 60_000, maxBuffer: 25 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
}
const sha256File = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const statusPaths = (status) => String(status || "").split("\n").filter(Boolean).map((line) => line.slice(3).split(" -> ").pop());

function cleanRelativePaths(paths) {
  const list = Array.isArray(paths) && paths.length ? paths : ["."];
  if (list.length > MAX_PATHS) throw fail("MISSION_PATHS_INVALID", `${MAX_PATHS} chemins au plus.`);
  return [...new Set(list.map((item) => {
    const value = String(item || "").trim().replace(/\\/g, "/").replace(/\/+$/, "") || ".";
    if (path.isAbsolute(value) || value.split("/").includes("..") || value.length > 300) throw fail("MISSION_PATHS_INVALID", "Chemins relatifs au dépôt uniquement.");
    return value;
  }))].sort();
}

function createDevMissionService({ runner, approvals, isEnabled = () => false, authorizeRepository = null, listExecutors = async () => [], git = defaultGit, now = () => new Date(), idFactory = () => `mission-${crypto.randomBytes(6).toString("hex")}`, observability = null } = {}) {
  if (!runner?.runDevTask || !approvals?.prepareAction) throw new TypeError("runner et approvals requis.");
  const missions = new Map();
  const emit = (event, metadata) => { try { observability?.(event, metadata); } catch {} };
  const ensureEnabled = () => { if (!isEnabled()) throw fail("MISSION_DISABLED", "Missions DEV désactivées (flag dev.missions).", 404); };
  const find = (id) => { const mission = ID.test(String(id || "")) ? missions.get(id) : null; if (!mission) throw fail("MISSION_NOT_FOUND", "Mission introuvable.", 404); return mission; };

  function view(mission) {
    return {
      id: mission.id, status: mission.status, createdAt: mission.createdAt, updatedAt: mission.updatedAt,
      objective: mission.args.objective, repositoryRoot: mission.args.repositoryRoot, allowedPaths: mission.args.allowedPaths,
      executor: mission.args.executor, baseCommit: mission.args.baseCommit,
      approval: mission.pendingApproval ? { id: mission.pendingApproval.id, kind: mission.pendingApproval.kind, expiresAt: mission.pendingApproval.expiresAt, summary: mission.pendingApproval.summary } : null,
      result: mission.result || null, error: mission.error || null,
    };
  }
  const touch = (mission, status) => { mission.status = status; mission.updatedAt = now().toISOString(); };

  function propose(input = {}) {
    ensureEnabled();
    const objective = String(input.objective || "").trim();
    if (!objective || objective.length > MAX_OBJECTIVE) throw fail("MISSION_OBJECTIVE_INVALID", `Objectif requis, ${MAX_OBJECTIVE} caractères au plus.`);
    const workspaceId = String(input.workspaceId || "").trim();
    if (!/^[A-Za-z0-9_.:-]{1,160}$/.test(workspaceId)) throw fail("MISSION_WORKSPACE_INVALID", "Espace de travail invalide.");
    const executor = input.executor == null ? "codex-cli" : String(input.executor);
    if (!EXECUTORS.has(executor)) throw fail("MISSION_EXECUTOR_INVALID", "Exécutant inconnu.");
    let repositoryRoot;
    try { repositoryRoot = fs.realpathSync(String(input.repositoryRoot || "")); } catch { throw fail("MISSION_REPOSITORY_INVALID", "Dépôt introuvable."); }
    // Autorisation avant toute lecture : le dépôt doit être une racine en écriture de l'espace de travail.
    if (typeof authorizeRepository !== "function" || authorizeRepository(workspaceId, repositoryRoot) !== true) throw fail("MISSION_REPOSITORY_FORBIDDEN", "Ce dépôt ne fait pas partie des dossiers autorisés en écriture de cet espace de travail.", 403);
    let baseCommit;
    try { baseCommit = git(repositoryRoot, ["rev-parse", "--verify", "HEAD^{commit}"]).trim(); } catch { throw fail("MISSION_REPOSITORY_INVALID", "Ce dossier n'est pas un dépôt Git avec au moins un commit."); }
    const args = { workspaceId, repositoryRoot, objective, allowedPaths: cleanRelativePaths(input.allowedPaths), executor, baseCommit };
    const id = idFactory();
    const approval = approvals.prepareAction({
      skillName: SKILL, operation: "run", target: repositoryRoot, normalizedArgs: args, permissionLevel: "local_write", riskLevel: "medium",
      title: "Lancer une mission DEV",
      summary: `${executor === "claude-code" ? "Claude Code" : "Codex"} travaillera dans une copie isolée de ${path.basename(repositoryRoot)} (commit ${baseCommit.slice(0, 7)}), chemins : ${args.allowedPaths.join(", ")}. Objectif : ${objective.slice(0, 300)}`,
    });
    const mission = { id, args, createdAt: now().toISOString(), updatedAt: now().toISOString(), status: "awaiting_start", pendingApproval: { id: approval.id, kind: "start", expiresAt: approval.expiresAt, summary: approval.summary } };
    missions.set(id, mission);
    emit("mission.proposed", { missionId: id, executor });
    return view(mission);
  }

  function consume(mission, approvalId, kind, payload) {
    if (mission.pendingApproval?.kind !== kind || mission.pendingApproval.id !== approvalId) throw fail("MISSION_APPROVAL_MISMATCH", "Cette approbation ne correspond pas à l'étape en cours.", 409);
    approvals.confirm(approvalId);
    approvals.consumeApproval(approvalId, { provider: SKILL, action: kind === "start" ? "run" : "apply_patch", target: mission.args.repositoryRoot, payload });
    mission.pendingApproval = null;
  }

  function start(id, { approvalId } = {}) {
    ensureEnabled();
    const mission = find(id);
    if (mission.status !== "awaiting_start") throw fail("MISSION_STATE_INVALID", "La mission n'attend pas de lancement.", 409);
    if ([...missions.values()].some((item) => item.status === "running")) throw fail("MISSION_BUSY", "Une mission est déjà en cours.", 409);
    const head = git(mission.args.repositoryRoot, ["rev-parse", "HEAD"]).trim();
    if (head !== mission.args.baseCommit) throw fail("MISSION_STALE", "Le dépôt a changé de commit depuis la proposition : propose à nouveau la mission.", 409);
    consume(mission, approvalId, "start", mission.args);
    touch(mission, "running");
    emit("mission.started", { missionId: id, executor: mission.args.executor });
    const { repositoryRoot } = mission.args;
    mission.running = Promise.resolve().then(() => runner.runDevTask({
      taskId: id, workspaceId: mission.args.workspaceId, repositoryRoot, objective: mission.args.objective,
      allowedPaths: mission.args.allowedPaths.map((item) => path.join(repositoryRoot, item)), executor: mission.args.executor,
    })).then((result) => finish(mission, result), (error) => { mission.error = { code: String(error?.code || "MISSION_RUN_FAILED").slice(0, 80) }; touch(mission, "failed"); emit("mission.failed", { missionId: id, code: mission.error.code }); });
    return view(mission);
  }

  function finish(mission, result) {
    const isolation = result?.isolation || {};
    mission.result = {
      agent: result?.agent || null, finalVerdict: result?.finalVerdict || "FAIL", failureCategory: result?.failureCategory || null,
      summary: String(result?.summary || "").slice(0, 4000), files: isolation.files || [], validations: (result?.validations || []).map((item) => ({ command: item.command, status: item.status })),
      sourceRepositoryUntouched: isolation.sourceRepositoryUntouched === true, sourceUncommittedChanges: isolation.sourceUncommittedChanges || 0,
      patchBytes: isolation.patchBytes || 0,
    };
    mission.patchPath = isolation.patchPath || null;
    if (mission.result.finalVerdict === "PASS" && mission.patchPath) {
      const payload = applyPayload(mission);
      const approval = approvals.prepareAction({
        skillName: SKILL, operation: "apply_patch", target: mission.args.repositoryRoot, normalizedArgs: payload, permissionLevel: "local_write", riskLevel: "medium",
        title: "Appliquer le diff de la mission",
        summary: `Appliquer ${payload.files.length} fichier(s) à ${path.basename(mission.args.repositoryRoot)} sans commit : ${payload.files.slice(0, 8).join(", ")}${payload.files.length > 8 ? "…" : ""}`,
      });
      mission.pendingApproval = { id: approval.id, kind: "apply", expiresAt: approval.expiresAt, summary: approval.summary };
      touch(mission, "awaiting_apply");
    } else touch(mission, mission.result.finalVerdict === "PASS" && !mission.patchPath ? "no_changes" : "failed");
    emit("mission.finished", { missionId: mission.id, verdict: mission.result.finalVerdict, status: mission.status });
  }

  function applyPayload(mission) {
    return { missionId: mission.id, repositoryRoot: mission.args.repositoryRoot, patchSha256: sha256File(mission.patchPath), files: mission.result.files.map((item) => item.path).sort() };
  }

  // Une approbation d'application expirée se renouvelle sans relancer la mission.
  function renewApplyApproval(id) {
    ensureEnabled();
    const mission = find(id);
    if (mission.status !== "awaiting_apply") throw fail("MISSION_STATE_INVALID", "La mission n'attend pas d'application.", 409);
    try { approvals.rejectApproval(mission.pendingApproval.id); } catch {}
    const payload = applyPayload(mission);
    const approval = approvals.prepareAction({ skillName: SKILL, operation: "apply_patch", target: mission.args.repositoryRoot, normalizedArgs: payload, permissionLevel: "local_write", riskLevel: "medium", title: "Appliquer le diff de la mission", summary: mission.pendingApproval.summary });
    mission.pendingApproval = { ...mission.pendingApproval, id: approval.id, expiresAt: approval.expiresAt };
    return view(mission);
  }

  function apply(id, { approvalId } = {}) {
    ensureEnabled();
    const mission = find(id);
    if (mission.status !== "awaiting_apply" || !mission.patchPath) throw fail("MISSION_STATE_INVALID", "La mission n'attend pas d'application.", 409);
    const repo = mission.args.repositoryRoot;
    const payload = applyPayload(mission);
    const local = new Set(statusPaths(git(repo, ["status", "--porcelain=v1", "--untracked-files=all"])));
    const conflicts = payload.files.filter((file) => local.has(file));
    if (conflicts.length) throw Object.assign(fail("MISSION_LOCAL_CONFLICT", `Tu as des modifications locales sur ${conflicts.slice(0, 5).join(", ")} : enregistre-les ou mets-les de côté avant d'appliquer.`, 409), { files: conflicts });
    try { git(repo, ["apply", "--check", "--whitespace=nowarn", mission.patchPath]); } catch { throw fail("MISSION_PATCH_CONFLICT", "Le diff ne s'applique plus proprement sur ton dossier (le code a changé depuis la mission).", 409); }
    consume(mission, approvalId, "apply", payload);
    git(repo, ["apply", "--whitespace=nowarn", mission.patchPath]);
    touch(mission, "applied");
    emit("mission.applied", { missionId: id, files: payload.files.length });
    return view(mission);
  }

  function discard(id) {
    ensureEnabled();
    const mission = find(id);
    if (["running", "applied", "discarded"].includes(mission.status)) throw fail("MISSION_STATE_INVALID", "Cette mission ne peut plus être abandonnée.", 409);
    if (mission.pendingApproval) { try { approvals.rejectApproval(mission.pendingApproval.id); } catch {} mission.pendingApproval = null; }
    if (mission.patchPath) { try { fs.rmSync(mission.patchPath, { force: true }); } catch {} mission.patchPath = null; }
    touch(mission, "discarded");
    emit("mission.discarded", { missionId: id });
    return view(mission);
  }

  return Object.freeze({
    propose, start, apply, discard, renewApplyApproval,
    get: (id) => view(find(id)),
    executors: () => listExecutors(),
    list: () => [...missions.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(view),
    // Tests et arrêt propre : attendre la fin de la mission en cours.
    settled: (id) => find(id).running || Promise.resolve(),
  });
}

module.exports = { SKILL, createDevMissionService, cleanRelativePaths };
