"use strict";

const crypto = require("crypto");

const BLOCKED_ACTIONS = new Set([
  "git_push_force", "git_reset_hard", "delete_remote_branch", "rewrite_history",
]);
const TERMINAL_STATUSES = new Set(["rejected", "expired", "consumed", "cancelled", "failed"]);

class ApprovalError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ApprovalError";
    this.code = code;
    this.type = code;
  }
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}

function normalizeArgs(value, depth = 0) {
  if (depth > 12) throw new ApprovalError("APPROVAL_ARGS_TOO_DEEP", "Action trop complexe pour être approuvée.");
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return value;
  if (Array.isArray(value)) return value.map((item) => normalizeArgs(item, depth + 1));
  if (value && typeof value === "object" && !Buffer.isBuffer(value)) {
    return Object.fromEntries(Object.keys(value).sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, normalizeArgs(value[key], depth + 1)]));
  }
  throw new ApprovalError("APPROVAL_ARGS_INVALID", "Arguments incompatibles avec une approbation sûre.");
}

function payloadHash({ provider, action, target, payload }) {
  return digest({ provider, action, target, payload: normalizeArgs(payload || {}) });
}

function actionFingerprint({ skillName, operation, normalizedArgs, target = null }) {
  return digest({ skillName, operation, target, normalizedArgs });
}

function tokenHash(token) { return digest({ token: String(token || "") }); }

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function humanSummary({ skillName, operation, args, target }) {
  const action = String(operation || skillName || "action").replaceAll("_", " ");
  if (/send.*email|email.*send/i.test(action)) {
    return `Envoyer l’e-mail à ${String(args?.to || target || "la cible indiquée")} avec le sujet « ${String(args?.subject || "sans sujet").slice(0, 180)} ».`;
  }
  if (/calendar|event/i.test(`${skillName} ${operation}`)) {
    return `${action} « ${String(args?.summary || args?.title || args?.eventId || "événement indiqué").slice(0, 180)} » dans l’agenda.`;
  }
  if (/file|artifact|document/i.test(`${skillName} ${operation}`)) {
    return `${action} pour ${String(args?.path || args?.name || args?.outputDirectory || target || "le fichier indiqué").slice(0, 240)}.`;
  }
  return `${action}${target ? ` sur ${String(target).slice(0, 240)}` : ""}.`;
}

function publicApproval(record) {
  return {
    id: record.id,
    approvalId: record.id,
    executionId: record.executionId,
    toolCallId: record.toolCallId,
    skillName: record.skillName,
    operation: record.operation,
    provider: record.skillName,
    action: record.operation,
    target: record.target,
    payloadHash: record.argsFingerprint,
    title: record.title,
    summary: record.summary,
    consequences: record.summary,
    permissionLevel: record.permissionLevel,
    policyVersion: record.contextRef?.policyVersion || null,
    riskLevel: record.riskLevel,
    status: record.status,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    actions: record.status === "pending" ? ["approve", "reject"] : [],
  };
}

function createApprovalEngine({
  ttlMs = 5 * 60 * 1000,
  retentionMs = 7 * 24 * 60 * 60 * 1000,
  repository = null,
  auditLog = null,
  now = () => Date.now(),
} = {}) {
  const actions = new Map();
  const inFlight = new Map();
  let storageAvailable = true;

  function audit(event, record, extra = {}) {
    try {
      auditLog?.append(event, {
        approvalId: record?.id || null,
        executionId: record?.executionId || null,
        skill: record?.skillName || null,
        operation: record?.operation || null,
        permissionLevel: record?.permissionLevel || null,
        fingerprint: record?.argsFingerprint || null,
        ...extra,
      });
    } catch {
      // Une panne de télémétrie ne doit jamais modifier la décision de sécurité.
    }
  }

  function persisted(record) {
    return {
      id: record.id, execution_id: record.executionId, tool_call_id: record.toolCallId,
      skill_name: record.skillName, operation: record.operation,
      args_fingerprint: record.argsFingerprint, permission_level: record.permissionLevel,
      status: record.status, created_at: record.createdAt, expires_at: record.expiresAt,
      decided_at: record.decidedAt || null, consumed_at: record.consumedAt || null,
      resume_token_hash: record.resumeTokenHash,
      context_fingerprint: record.contextRef?.fingerprint || null,
      preconditions_fingerprint: record.preconditionsFingerprint || null,
      superseded_by: record.supersededBy || null, failure_code: record.failureCode || null,
    };
  }

  function save(record) {
    if (!repository) return record;
    try { repository.save(persisted(record)); }
    catch (error) {
      storageAvailable = false;
      throw new ApprovalError("APPROVAL_STORAGE_ERROR", "Le stockage sécurisé des approbations est indisponible.");
    }
    return record;
  }

  // Politique de redémarrage : aucune action conservée ne redevient exécutable.
  if (repository) {
    try {
      for (const row of repository.list()) {
        if (["pending", "approved"].includes(row.status)) {
          repository.save({ ...row, status: "cancelled", decided_at: new Date(now()).toISOString(), failure_code: "RESTART_RECONFIRMATION_REQUIRED" });
        }
      }
      repository.cleanup(new Date(now() - retentionMs).toISOString());
    } catch {
      storageAvailable = false;
    }
  }

  function expire(record) {
    if (!record || TERMINAL_STATUSES.has(record.status)) return record;
    if (Date.parse(record.expiresAt) > now()) return record;
    record.status = "expired";
    record.decidedAt = new Date(now()).toISOString();
    save(record);
    audit("approval.expired", record);
    return record;
  }

  function prepareAction(input = {}) {
    if (!storageAvailable) throw new ApprovalError("APPROVAL_STORAGE_ERROR", "Le stockage sécurisé des approbations est indisponible.");
    const operation = String(input.operation || input.action || "").trim();
    if (!operation) throw new ApprovalError("APPROVAL_OPERATION_REQUIRED", "Opération d’approbation absente.");
    if (BLOCKED_ACTIONS.has(operation)) throw new ApprovalError("ACTION_BLOCKED", "Action définitivement bloquée par Noon.");
    const normalizedArgs = normalizeArgs(input.normalizedArgs ?? input.payload ?? {});
    const skillName = String(input.skillName || input.provider || "unknown").trim();
    const createdMs = now();
    const resumeToken = crypto.randomBytes(32).toString("base64url");
    const target = input.target == null ? null : String(input.target).slice(0, 500);
    const preconditions = normalizeArgs(input.preconditions || {});
    const record = {
      id: `approval_${crypto.randomUUID()}`,
      executionId: String(input.executionId || `exec_${crypto.randomUUID()}`),
      toolCallId: input.toolCallId ? String(input.toolCallId) : null,
      skillName, operation, target, normalizedArgs,
      argsFingerprint: actionFingerprint({ skillName, operation, normalizedArgs, target }),
      permissionLevel: String(input.permissionLevel || "external"),
      title: String(input.title || "Validation requise").slice(0, 160),
      summary: String(input.sanitizedSummary || input.summary || humanSummary({ skillName, operation, args: normalizedArgs, target })).slice(0, 1000),
      riskLevel: input.riskLevel || (input.strengthened ? "high" : "medium"),
      createdAt: new Date(createdMs).toISOString(),
      expiresAt: new Date(createdMs + Math.max(1, Number(input.ttlMs) || ttlMs)).toISOString(),
      status: "pending", resumeToken, resumeTokenHash: tokenHash(resumeToken),
      contextRef: normalizeArgs(input.contextRef || {}), preconditions,
      preconditionsFingerprint: digest(preconditions),
      decidedAt: null, consumedAt: null, supersededBy: null, failureCode: null,
    };
    save(record);
    actions.set(record.id, record);
    audit("approval.created", record);
    return { ...publicApproval(record), resumeToken };
  }

  function requestApproval(input = {}) {
    return prepareAction({
      executionId: input.executionId,
      toolCallId: input.toolCallId,
      skillName: input.provider,
      operation: input.action,
      normalizedArgs: input.payload,
      target: input.target,
      sanitizedSummary: input.summary || input.consequences,
      permissionLevel: input.permissionLevel || (input.strengthened ? "destructive" : "external"),
      strengthened: input.strengthened,
      preconditions: input.preconditions,
      contextRef: input.contextRef,
    });
  }

  function getRecord(id) {
    const record = actions.get(String(id));
    if (!record) throw new ApprovalError("APPROVAL_NOT_FOUND", "Approbation absente ou indisponible après redémarrage.");
    expire(record);
    return record;
  }

  function confirm(id) {
    const record = getRecord(id);
    if (record.status === "expired") throw new ApprovalError("approval_expired", "Autorisation expirée.");
    if (record.status !== "pending") throw new ApprovalError("APPROVAL_INVALID", "Autorisation absente, utilisée ou invalide.");
    record.status = "approved";
    record.decidedAt = new Date(now()).toISOString();
    save(record);
    audit("approval.approved", record);
    return publicApproval(record);
  }

  function consumeApproval(id, exactInput) {
    const record = getRecord(id);
    if (record.status === "expired") throw new ApprovalError("approval_expired", "Autorisation expirée.");
    if (record.status !== "approved") throw new ApprovalError("APPROVAL_INVALID", "Autorisation invalide ou déjà utilisée.");
    const normalizedArgs = normalizeArgs(exactInput.payload || {});
    const fingerprint = actionFingerprint({
      skillName: String(exactInput.provider), operation: String(exactInput.action),
      normalizedArgs, target: exactInput.target == null ? null : String(exactInput.target).slice(0, 500),
    });
    if (!safeEqual(record.argsFingerprint, fingerprint)) {
      throw new ApprovalError("APPROVAL_ACTION_CHANGED", "Le contenu ou la cible a changé : nouvelle autorisation requise.");
    }
    record.status = "consumed";
    record.consumedAt = new Date(now()).toISOString();
    save(record);
    audit("approval.consumed", record);
    return true;
  }

  function rejectApproval(id) {
    const record = getRecord(id);
    if (record.status !== "pending") return false;
    record.status = "rejected";
    record.decidedAt = new Date(now()).toISOString();
    save(record);
    audit("approval.rejected", record);
    return true;
  }

  function cancel(id, supersededBy = null) {
    const record = getRecord(id);
    if (TERMINAL_STATUSES.has(record.status)) return false;
    record.status = "cancelled";
    record.supersededBy = supersededBy;
    record.decidedAt = new Date(now()).toISOString();
    save(record);
    audit("approval.cancelled", record, { supersededBy });
    return true;
  }

  async function resumeApprovedAction({
    approvalId, resumeToken, decision, exactAction = null,
    recheckHardRules, recheckPermission, recheckConnector, recheckPreconditions,
    execute,
  } = {}) {
    if (inFlight.has(approvalId)) return inFlight.get(approvalId);
    const operation = (async () => {
      const record = getRecord(approvalId);
      if (record.status === "expired") throw new ApprovalError("approval_expired", "Cette approbation a expiré.");
      if (record.status === "consumed") throw new ApprovalError("APPROVAL_CONSUMED", "Cette action a déjà été exécutée.");
      if (record.status !== "pending") throw new ApprovalError("APPROVAL_INVALID", "Cette approbation n’est plus active.");
      if (!safeEqual(record.resumeTokenHash, tokenHash(resumeToken))) throw new ApprovalError("APPROVAL_TOKEN_INVALID", "Jeton de reprise invalide.");
      if (decision !== "approve") {
        rejectApproval(record.id);
        return { status: "rejected", approval: publicApproval(record), result: null };
      }
      if (exactAction) {
        const args = normalizeArgs(exactAction.normalizedArgs ?? exactAction.payload ?? {});
        const fingerprint = actionFingerprint({
          skillName: String(exactAction.skillName || exactAction.provider),
          operation: String(exactAction.operation || exactAction.action),
          normalizedArgs: args,
          target: exactAction.target == null ? null : String(exactAction.target).slice(0, 500),
        });
        if (!safeEqual(record.argsFingerprint, fingerprint)) throw new ApprovalError("APPROVAL_ACTION_CHANGED", "L’action a changé et exige une nouvelle approbation.");
      }
      record.status = "approved";
      record.decidedAt = new Date(now()).toISOString();
      save(record);
      audit("approval.approved", record);
      for (const [name, check] of [
        ["HARD_RULE_RECHECK_FAILED", recheckHardRules],
        ["PERMISSION_RECHECK_FAILED", recheckPermission],
        ["CONNECTOR_RECHECK_FAILED", recheckConnector],
      ]) {
        if (typeof check === "function" && await check(record) !== true) {
          record.status = "failed"; record.failureCode = name; save(record); audit("approval.failed", record, { code: name });
          throw new ApprovalError(name, "L’action n’est plus autorisée.");
        }
      }
      if (typeof recheckPreconditions === "function") {
        const current = normalizeArgs(await recheckPreconditions(record) || {});
        if (!safeEqual(record.preconditionsFingerprint, digest(current))) {
          record.status = "failed"; record.failureCode = "approval_stale"; save(record); audit("approval.stale", record);
          throw new ApprovalError("approval_stale", "L’état ciblé a changé depuis la préparation de l’action.");
        }
      }
      if (typeof execute !== "function") throw new ApprovalError("APPROVAL_EXECUTOR_REQUIRED", "Exécuteur de reprise absent.");
      try {
        const result = await execute(record.normalizedArgs, record);
        record.status = "consumed";
        record.consumedAt = new Date(now()).toISOString();
        save(record);
        audit("approval.consumed", record);
        return { status: "consumed", approval: publicApproval(record), result };
      } catch (error) {
        record.status = "failed";
        record.failureCode = String(error?.code || error?.name || "EXECUTION_FAILED").slice(0, 100);
        save(record);
        audit("approval.failed", record, { code: record.failureCode });
        throw error;
      }
    })();
    inFlight.set(approvalId, operation);
    try { return await operation; }
    finally { inFlight.delete(approvalId); }
  }

  function listPending({ executionId = null } = {}) {
    const list = [];
    for (const record of actions.values()) {
      expire(record);
      if (record.status === "pending" && (!executionId || record.executionId === executionId)) list.push(publicApproval(record));
    }
    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  function activeApprovalId(executionId) {
    const items = listPending({ executionId });
    return items.length === 1 ? items[0].id : null;
  }

  return {
    prepareAction, requestApproval, confirm, consumeApproval, rejectApproval,
    resumeApprovedAction, listPending, activeApprovalId, cancel,
    get: (id) => publicApproval(getRecord(id)),
    cleanup: () => repository?.cleanup(new Date(now() - retentionMs).toISOString()) || 0,
    storageAvailable: () => storageAvailable,
  };
}

class ApprovalEngine {
  constructor(options) { return createApprovalEngine(options); }
}

module.exports = {
  ApprovalEngine, ApprovalError, BLOCKED_ACTIONS, actionFingerprint,
  createApprovalEngine, humanSummary, normalizeArgs, payloadHash, stableStringify,
};
