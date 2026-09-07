"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { isPathInsideRoots } = require("../../lib/path-utils");
const { sanitizeAuditDetails } = require("./redaction");

const POLICY_BASE_VERSION = "operational-security-v1";

const OUTCOMES = Object.freeze({
  ALLOW: "ALLOW",
  ALLOW_WITH_CONSTRAINTS: "ALLOW_WITH_CONSTRAINTS",
  REQUIRE_APPROVAL: "REQUIRE_APPROVAL",
  DENY: "DENY",
  UNAVAILABLE: "UNAVAILABLE",
});

const RISK_LEVELS = Object.freeze({ LOW: "LOW", MEDIUM: "MEDIUM", HIGH: "HIGH", CRITICAL: "CRITICAL" });
const ACTION_CLASSES = Object.freeze({ READ: "READ", SUGGEST: "SUGGEST", PREPARE: "PREPARE", WRITE: "WRITE", EXECUTE: "EXECUTE", DESTRUCTIVE: "DESTRUCTIVE" });
const REVERSIBILITY = Object.freeze({ REVERSIBLE: "REVERSIBLE", PARTIALLY_REVERSIBLE: "PARTIALLY_REVERSIBLE", IRREVERSIBLE: "IRREVERSIBLE", UNKNOWN: "UNKNOWN" });
const TARGET_SCOPES = Object.freeze({ LOCAL: "LOCAL", REMOTE: "REMOTE", MIXED: "MIXED" });
const DATA_FLOWS = Object.freeze({ LOCAL_ONLY: "LOCAL_ONLY", LOCAL_TO_MODEL: "LOCAL_TO_MODEL", LOCAL_TO_REMOTE_SERVICE: "LOCAL_TO_REMOTE_SERVICE", REMOTE_READ: "REMOTE_READ", REMOTE_WRITE: "REMOTE_WRITE" });
const TRUST_LEVELS = Object.freeze({ HIGH: "HIGH", MEDIUM: "MEDIUM", LOW: "LOW", UNTRUSTED: "UNTRUSTED" });

const ORIGINS = new Set([
  "explicit_user_chat", "explicit_user_voice", "trusted_ui", "trusted_shortcut",
  "approval_resume", "system_scheduler", "proactive_recommendation",
  "external_content", "model_generated",
]);

const REASON_CODES = Object.freeze({
  HARD_RULE_DENY: "HARD_RULE_DENY",
  PERMISSION_MISSING: "PERMISSION_MISSING",
  APPROVAL_REQUIRED: "APPROVAL_REQUIRED",
  UNTRUSTED_ORIGIN: "UNTRUSTED_ORIGIN",
  REMOTE_SIDE_EFFECT: "REMOTE_SIDE_EFFECT",
  IRREVERSIBLE_ACTION: "IRREVERSIBLE_ACTION",
  OVERWRITE_EXISTING: "OVERWRITE_EXISTING",
  TARGET_OUT_OF_SCOPE: "TARGET_OUT_OF_SCOPE",
  PROTECTED_PROFILE: "PROTECTED_PROFILE",
  PROFILE_SCOPE_MISMATCH: "PROFILE_SCOPE_MISMATCH",
  LOCAL_ONLY_REMOTE_FLOW: "LOCAL_ONLY_REMOTE_FLOW",
  STALE_PRECONDITION: "STALE_PRECONDITION",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
  AUTH_REQUIRED: "AUTH_REQUIRED",
  UNKNOWN_REVERSIBILITY: "UNKNOWN_REVERSIBILITY",
  BATCH_SCOPE_HIGH: "BATCH_SCOPE_HIGH",
  EXPLICIT_ORDER_REQUIRED: "EXPLICIT_ORDER_REQUIRED",
  SAFE_MODE_READ_ONLY: "SAFE_MODE_READ_ONLY",
  NEGATED_OR_HYPOTHETICAL: "NEGATED_OR_HYPOTHETICAL",
});

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value) {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}

function originFor(value, channel = "chat") {
  const raw = String(value || "");
  if (ORIGINS.has(raw)) return raw;
  if (raw === "explicit_user") return channel === "voice" ? "explicit_user_voice" : "explicit_user_chat";
  if (raw === "shortcut") return "trusted_shortcut";
  if (raw === "system") return "system_scheduler";
  if (raw === "proactive") return "proactive_recommendation";
  return raw === "trusted_ui" ? raw : "model_generated";
}

function trustFor(origin) {
  if (["explicit_user_chat", "explicit_user_voice", "trusted_ui", "trusted_shortcut", "approval_resume"].includes(origin)) return TRUST_LEVELS.HIGH;
  if (origin === "system_scheduler") return TRUST_LEVELS.MEDIUM;
  if (origin === "proactive_recommendation" || origin === "model_generated") return TRUST_LEVELS.LOW;
  return TRUST_LEVELS.UNTRUSTED;
}

function operationText(request) {
  return `${request.skillId || ""} ${request.operation || ""}`.toLowerCase();
}

function classifyAction(request, skillPolicy = {}) {
  const operation = operationText(request);
  if (/generate_creative_image/.test(operation)) return ACTION_CLASSES.PREPARE;
  if (/(?:^|[\s._-])(delete|remove|trash|reset|clean|force|destroy|purge|drop|unlink|erase)(?:$|[\s._-])/.test(operation) || skillPolicy.destructive === true) return ACTION_CLASSES.DESTRUCTIVE;
  if (/(?:^|[\s._-])(send|push|publish|post|execute|run_remote|deploy)(?:$|[\s._-])/.test(operation)) return ACTION_CLASSES.EXECUTE;
  if (/(?:^|[\s._-])(suggest|propose|time_slot)(?:$|[\s._-])/.test(operation)) return ACTION_CLASSES.SUGGEST;
  if (/(?:^|[\s._-])(draft|prepare|preview|plan)(?:$|[\s._-])/.test(operation) || skillPolicy.level === "draft" || request.args?.previewOnly === true) return ACTION_CLASSES.PREPARE;
  if (/(?:^|[\s._-])(create|write|update|move|rename|commit|install|upload|generate)(?:$|[\s._-])/.test(operation) || skillPolicy.level === "write") return ACTION_CLASSES.WRITE;
  if (/(?:^|[\s._-])(read|search|browse|list|get|status|diff|log|show|analyze|synthesize)(?:$|[\s._-])/.test(operation) || skillPolicy.level === "read") return ACTION_CLASSES.READ;
  if (skillPolicy.level === "external") return ACTION_CLASSES.EXECUTE;
  if (skillPolicy.level === "destructive") return ACTION_CLASSES.DESTRUCTIVE;
  return ACTION_CLASSES.EXECUTE;
}

function classifyTarget(request, skillPolicy = {}) {
  const operation = operationText(request);
  const args = request.args || {};
  const targetType = /gmail|email/.test(operation) ? "email"
    : /calendar|event|agenda/.test(operation) ? "calendar"
      : /git/.test(operation) ? "git_repository"
        : /artifact|document|image|presentation/.test(operation) ? "artifact"
          : /memory|personal_context/.test(operation) ? "memory"
            : /file|directory|folder|codex/.test(operation) ? "local_file"
              : /shell|command|terminal/.test(operation) ? "system_state" : "service";
  const network = skillPolicy.networkAccess === true || ["email", "calendar"].includes(targetType) || /push|upload|publish|web/.test(operation);
  const local = ["local_file", "artifact", "memory", "git_repository", "system_state"].includes(targetType);
  const scope = network && local ? TARGET_SCOPES.MIXED : network ? TARGET_SCOPES.REMOTE : TARGET_SCOPES.LOCAL;
  const targetCount = Math.max(1, Number(request.targetCount || args.targetCount || (Array.isArray(request.targets) ? request.targets.length : 1)) || 1);
  const scopeName = String(request.scope || args.scope || (targetCount > 1 ? "batch" : "single_item"));
  return { targetType, scope, targetCount, scopeName };
}

function classifyDataFlow(request, target, actionClass, skillPolicy = {}) {
  if (request.dataFlow && Object.values(DATA_FLOWS).includes(request.dataFlow)) return request.dataFlow;
  if (request.toRemoteModel === true) return DATA_FLOWS.LOCAL_TO_MODEL;
  if (target.scope === TARGET_SCOPES.LOCAL) return DATA_FLOWS.LOCAL_ONLY;
  if (actionClass === ACTION_CLASSES.READ || actionClass === ACTION_CLASSES.SUGGEST) return DATA_FLOWS.REMOTE_READ;
  if (skillPolicy.networkAccess || target.scope !== TARGET_SCOPES.LOCAL) {
    return request.hasLocalData ? DATA_FLOWS.LOCAL_TO_REMOTE_SERVICE : DATA_FLOWS.REMOTE_WRITE;
  }
  return DATA_FLOWS.LOCAL_ONLY;
}

function classifyReversibility(request, actionClass) {
  if (request.reversibility && Object.values(REVERSIBILITY).includes(request.reversibility)) return request.reversibility;
  const operation = operationText(request);
  if (actionClass === ACTION_CLASSES.READ || actionClass === ACTION_CLASSES.SUGGEST || actionClass === ACTION_CLASSES.PREPARE) return REVERSIBILITY.REVERSIBLE;
  if (/send|push|publish|post|delete|trash|reset|clean|purge/.test(operation)) return REVERSIBILITY.IRREVERSIBLE;
  if (/overwrite|move|rename|update|commit/.test(operation) || request.overwriteExisting) return REVERSIBILITY.PARTIALLY_REVERSIBLE;
  if (/create|write|generate|upload/.test(operation)) return REVERSIBILITY.REVERSIBLE;
  return REVERSIBILITY.UNKNOWN;
}

function inspectPath(request, allowedRoots, allowedWriteRoots, actionClass) {
  const requestedPath = request.args?.path || request.args?.outputDirectory || request.targets?.find((item) => item?.path)?.path;
  if (!requestedPath) return { checked: false, allowed: true, exists: false, symlink: false };
  const resolved = path.resolve(String(requestedPath));
  let checkedPath = resolved;
  let exists = false;
  try {
    exists = fs.existsSync(resolved);
    if (exists) checkedPath = fs.realpathSync(resolved);
    else {
      let ancestor = path.dirname(resolved);
      const missingSegments = [path.basename(resolved)];
      while (!fs.existsSync(ancestor) && path.dirname(ancestor) !== ancestor) {
        missingSegments.unshift(path.basename(ancestor));
        ancestor = path.dirname(ancestor);
      }
      checkedPath = path.join(fs.realpathSync(ancestor), ...missingSegments);
    }
  } catch {
    return { checked: true, allowed: false, code: REASON_CODES.TARGET_OUT_OF_SCOPE, exists: false, symlink: true };
  }
  const roots = ([ACTION_CLASSES.WRITE, ACTION_CLASSES.DESTRUCTIVE].includes(actionClass) ? allowedWriteRoots : allowedRoots)
    .map((root) => { try { return fs.realpathSync(root); } catch { return path.resolve(root); } });
  return {
    checked: true,
    allowed: Array.isArray(roots) && roots.length > 0 && isPathInsideRoots(checkedPath, roots),
    exists,
    symlink: checkedPath !== resolved,
    code: REASON_CODES.TARGET_OUT_OF_SCOPE,
  };
}

function createActionRequest(input = {}, skillPolicy = {}) {
  const origin = originFor(input.origin, input.channel);
  const request = {
    actionId: String(input.actionId || `action-${crypto.randomUUID()}`),
    intentId: input.intentId || null,
    executionId: input.executionId || null,
    actor: String(input.actor || (origin === "system_scheduler" ? "scheduler" : origin === "proactive_recommendation" ? "proactive" : "user")),
    origin,
    trustLevel: trustFor(origin),
    skillId: String(input.skillId || "unknown"),
    operation: String(input.operation || input.skillId || "unknown"),
    args: input.args && typeof input.args === "object" ? input.args : {},
    targets: Array.isArray(input.targets) ? input.targets.slice(0, 200) : [],
    workspaceId: input.workspaceId || null,
    projectId: input.projectId || null,
    profileScope: input.profileScope || "arnaud",
    sourceProfileScope: input.sourceProfileScope || input.profileScope || "arnaud",
    sideEffects: Array.isArray(input.sideEffects) ? input.sideEffects.slice(0, 30) : [],
    context: input.context && typeof input.context === "object" ? input.context : {},
    explicitOrder: input.explicitOrder === true,
    negated: input.negated === true,
    hypothetical: input.hypothetical === true,
    localOnly: input.localOnly === true,
    protectedProfile: input.protectedProfile === true || ["alexandra", "sinan", "kaan"].includes(input.profileScope),
    hasLocalData: input.hasLocalData === true,
    overwriteExisting: input.overwriteExisting === true || input.args?.overwrite === true,
    preconditions: input.preconditions && typeof input.preconditions === "object" ? input.preconditions : {},
    preconditionsValid: input.preconditionsValid !== false,
    safeMode: input.safeMode === true,
    targetCount: input.targetCount,
    scope: input.scope,
    dataFlow: input.dataFlow,
    toRemoteModel: input.toRemoteModel === true,
    isSpecialistProposal: input.isSpecialistProposal === true,
  };
  request.actionClass = classifyAction(request, skillPolicy);
  request.target = classifyTarget(request, skillPolicy);
  request.dataFlow = classifyDataFlow(request, request.target, request.actionClass, skillPolicy);
  request.reversibility = classifyReversibility(request, request.actionClass);
  request.actionFingerprint = fingerprint({
    skillId: request.skillId,
    operation: request.operation,
    argsHash: fingerprint(request.args),
    targetsHash: fingerprint(request.targets),
    target: request.target,
    profileScope: request.profileScope,
    dataFlow: request.dataFlow,
  });
  return request;
}

function createOperationalSecurityPolicy({ hardRulesRegistry = null, reliabilityEngine = null, permissionProvider = null, allowedRootsProvider = () => [], allowedWriteRootsProvider = () => [], observability = null, now = () => Date.now(), traceLimit = 200 } = {}) {
  const traces = [];
  const policyVersion = `${POLICY_BASE_VERSION}:${hardRulesRegistry?.version?.() || "rules-unknown"}`;
  const emit = (event, metadata) => { try { observability?.(event, sanitizeAuditDetails(metadata)); } catch {} };

  function componentFor(request) {
    const text = operationText(request);
    if (/gmail|email/.test(text)) return "gmail";
    if (/calendar|agenda|event/.test(text)) return "google-calendar";
    if (/file|directory|folder|codex|git|shell/.test(text)) return "filesystem";
    if (/artifact|document|image|presentation/.test(text)) return "artifacts";
    if (/memory|personal_context/.test(text)) return "private-memory";
    return null;
  }

  function evaluate(input = {}) {
    const started = now();
    const skillPolicy = input.skillPolicy || {};
    const request = input.actionRequest?.actionFingerprint ? input.actionRequest : createActionRequest(input.actionRequest, skillPolicy);
    const reasons = [];
    const blockedBy = [];
    const constraints = [];
    const requiredPermissions = [];
    const matchedRules = hardRulesRegistry?.getRulesForContext?.({
      intent: request.target.targetType === "email" ? "email" : request.target.targetType === "calendar" ? "calendar" : request.target.targetType === "memory" ? "memory" : request.target.targetType === "local_file" ? "files" : null,
      tools: [request.skillId], projectId: request.projectId, channel: request.origin.includes("voice") ? "live" : "chat",
    }) || [];
    const add = (code) => { if (!reasons.includes(code)) reasons.push(code); };

    const pathDecision = inspectPath(request, allowedRootsProvider(), allowedWriteRootsProvider(), request.actionClass);
    const permission = input.currentPermissions || permissionProvider?.(request.skillId, request.args, input.permissionContext || {}) || { allowed: true, code: "AUTHORIZED" };
    const mutating = [ACTION_CLASSES.WRITE, ACTION_CLASSES.EXECUTE, ACTION_CLASSES.DESTRUCTIVE].includes(request.actionClass);
    const approvalValid = input.pendingApproval?.valid === true;

    if (request.negated || request.hypothetical) { add(REASON_CODES.NEGATED_OR_HYPOTHETICAL); blockedBy.push(REASON_CODES.HARD_RULE_DENY); }
    if (!pathDecision.allowed) { add(REASON_CODES.TARGET_OUT_OF_SCOPE); blockedBy.push(REASON_CODES.TARGET_OUT_OF_SCOPE); }
    if (request.localOnly && request.dataFlow !== DATA_FLOWS.LOCAL_ONLY) { add(REASON_CODES.LOCAL_ONLY_REMOTE_FLOW); blockedBy.push("memory.local_only"); }
    if (request.sourceProfileScope !== request.profileScope) { add(REASON_CODES.PROFILE_SCOPE_MISMATCH); blockedBy.push(REASON_CODES.PROFILE_SCOPE_MISMATCH); }
    if (request.protectedProfile && request.dataFlow !== DATA_FLOWS.LOCAL_ONLY && !approvalValid) add(REASON_CODES.PROTECTED_PROFILE);
    if (!request.preconditionsValid) { add(REASON_CODES.STALE_PRECONDITION); blockedBy.push(REASON_CODES.STALE_PRECONDITION); }
    if (request.safeMode && mutating) { add(REASON_CODES.SAFE_MODE_READ_ONLY); blockedBy.push(REASON_CODES.SAFE_MODE_READ_ONLY); }
    // Pour les propositions de spécialistes : transformer UNTRUSTED_ORIGIN → REQUIRE_APPROVAL au lieu de DENY
    if (["external_content", "model_generated", "proactive_recommendation"].includes(request.origin) && mutating && !request.isSpecialistProposal) { add(REASON_CODES.UNTRUSTED_ORIGIN); blockedBy.push(REASON_CODES.UNTRUSTED_ORIGIN); }
    if (request.isSpecialistProposal && ["external_content", "model_generated", "proactive_recommendation"].includes(request.origin) && mutating) { add(REASON_CODES.APPROVAL_REQUIRED); }
    if (skillPolicy.explicitOrderRequired && !request.explicitOrder) { add(REASON_CODES.EXPLICIT_ORDER_REQUIRED); blockedBy.push(REASON_CODES.EXPLICIT_ORDER_REQUIRED); }
    const calendarTime = request.args?.start || request.args?.startAt || request.args?.dateTime || request.context?.scheduledAt;
    if (request.target.targetType === "calendar" && mutating && calendarTime &&
      hardRulesRegistry?.isProtectedCalendarTime?.(calendarTime) &&
      ["system_scheduler", "proactive_recommendation"].includes(request.origin)) {
      add(REASON_CODES.HARD_RULE_DENY); blockedBy.push("calendar.protected_lunch");
    }

    if (permission.allowed !== true) {
      if (String(permission.code).includes("CONFIRMATION_REQUIRED")) add(REASON_CODES.APPROVAL_REQUIRED);
      else if (String(permission.code).includes("PATH") || permission.code === "NO_ALLOWED_ROOT") { add(REASON_CODES.TARGET_OUT_OF_SCOPE); blockedBy.push(REASON_CODES.TARGET_OUT_OF_SCOPE); }
      else if (String(permission.code).includes("EXPLICIT_ORDER")) { add(REASON_CODES.EXPLICIT_ORDER_REQUIRED); blockedBy.push(REASON_CODES.EXPLICIT_ORDER_REQUIRED); }
      else { add(REASON_CODES.PERMISSION_MISSING); blockedBy.push(REASON_CODES.PERMISSION_MISSING); requiredPermissions.push(skillPolicy.level || "unknown"); }
    }

    const componentId = componentFor(request);
    let reliabilityState = input.reliabilityState || null;
    if (!reliabilityState && componentId && reliabilityEngine) {
      try { reliabilityState = reliabilityEngine.snapshot(componentId); } catch {}
    }
    if (reliabilityState && ["UNAVAILABLE", "MISCONFIGURED", "UNAUTHORIZED"].includes(reliabilityState.state)) {
      add(reliabilityState.state === "UNAUTHORIZED" ? REASON_CODES.AUTH_REQUIRED : REASON_CODES.SERVICE_UNAVAILABLE);
    }

    if (request.target.scope !== TARGET_SCOPES.LOCAL && mutating) add(REASON_CODES.REMOTE_SIDE_EFFECT);
    if (request.reversibility === REVERSIBILITY.IRREVERSIBLE) add(REASON_CODES.IRREVERSIBLE_ACTION);
    if (request.reversibility === REVERSIBILITY.UNKNOWN && mutating) add(REASON_CODES.UNKNOWN_REVERSIBILITY);
    if (request.overwriteExisting || (/write|create/.test(operationText(request)) && pathDecision.exists && request.args?.path)) add(REASON_CODES.OVERWRITE_EXISTING);
    if (request.target.targetCount > 1) add(REASON_CODES.BATCH_SCOPE_HIGH);

    let riskLevel = RISK_LEVELS.LOW;
    if (request.actionClass === ACTION_CLASSES.PREPARE || request.actionClass === ACTION_CLASSES.WRITE || request.target.targetCount > 1 || request.protectedProfile) riskLevel = RISK_LEVELS.MEDIUM;
    if (request.actionClass === ACTION_CLASSES.EXECUTE || request.actionClass === ACTION_CLASSES.DESTRUCTIVE || reasons.includes(REASON_CODES.OVERWRITE_EXISTING) || reasons.includes(REASON_CODES.IRREVERSIBLE_ACTION)) riskLevel = RISK_LEVELS.HIGH;
    if (request.actionClass === ACTION_CLASSES.DESTRUCTIVE && (request.target.targetCount > 10 || ["account", "all", "repository"].includes(request.target.scopeName))) riskLevel = RISK_LEVELS.CRITICAL;

    const absoluteDeny = blockedBy.length > 0;
    const serviceUnavailable = reasons.includes(REASON_CODES.SERVICE_UNAVAILABLE) || reasons.includes(REASON_CODES.AUTH_REQUIRED);
    const approvalReasons = [REASON_CODES.REMOTE_SIDE_EFFECT, REASON_CODES.IRREVERSIBLE_ACTION, REASON_CODES.OVERWRITE_EXISTING, REASON_CODES.BATCH_SCOPE_HIGH, REASON_CODES.PROTECTED_PROFILE, REASON_CODES.UNKNOWN_REVERSIBILITY];
    const mustApprove = reasons.includes(REASON_CODES.APPROVAL_REQUIRED) || approvalReasons.some((code) => reasons.includes(code));
    let outcome = OUTCOMES.ALLOW;
    if (absoluteDeny) outcome = OUTCOMES.DENY;
    else if (serviceUnavailable) outcome = OUTCOMES.UNAVAILABLE;
    else if (mustApprove && !approvalValid) outcome = OUTCOMES.REQUIRE_APPROVAL;
    else if (request.actionClass !== ACTION_CLASSES.READ || constraints.length) outcome = OUTCOMES.ALLOW_WITH_CONSTRAINTS;
    if (approvalValid && mustApprove) constraints.push("APPROVAL_EXACTE_CONSUMMABLE_UNE_FOIS");
    if (request.actionClass === ACTION_CLASSES.WRITE) constraints.push("PRESERVE_ORIGINALS");

    const decision = {
      decisionId: `decision-${crypto.randomUUID()}`,
      policyVersion,
      actionId: request.actionId,
      actionFingerprint: request.actionFingerprint,
      outcome,
      riskLevel,
      actionClass: request.actionClass,
      target: request.target,
      dataFlow: request.dataFlow,
      reversibility: request.reversibility,
      reasons,
      requiredApproval: outcome === OUTCOMES.REQUIRE_APPROVAL,
      requiredPermissions,
      blockedBy,
      constraints,
      allowedScope: outcome === OUTCOMES.DENY ? null : request.target.scopeName,
      matchedRuleIds: matchedRules.map((rule) => rule.id),
      evaluatedAt: new Date(now()).toISOString(),
      expiresAt: mutating ? new Date(now() + 5 * 60_000).toISOString() : null,
    };
    const trace = sanitizeAuditDetails({
      decisionId: decision.decisionId,
      actionFingerprint: request.actionFingerprint,
      policyVersion,
      origin: request.origin,
      trustLevel: request.trustLevel,
      actionClass: request.actionClass,
      targetType: request.target.targetType,
      targetScope: request.target.scope,
      targetCount: request.target.targetCount,
      dataFlow: request.dataFlow,
      reversibility: request.reversibility,
      riskLevel,
      reasons,
      matchedRuleIds: decision.matchedRuleIds,
      outcome,
      durationMs: now() - started,
    });
    traces.unshift(trace); traces.splice(traceLimit);
    emit("security_policy_evaluated", trace);
    emit(outcome === OUTCOMES.DENY ? "security_policy_denied" : outcome === OUTCOMES.REQUIRE_APPROVAL ? "security_policy_requires_approval" : outcome === OUTCOMES.ALLOW_WITH_CONSTRAINTS ? "security_policy_constraint_applied" : "security_policy_allowed", trace);
    emit("security_policy_ms", { value: trace.durationMs, actionClass: request.actionClass, riskLevel });
    return decision;
  }

  function compareLegacy(decision, legacyDecision) {
    const legacyAllowed = legacyDecision?.allowed === true;
    const policyAllowed = [OUTCOMES.ALLOW, OUTCOMES.ALLOW_WITH_CONSTRAINTS].includes(decision.outcome);
    const result = legacyAllowed === policyAllowed ? "same_decision" : legacyAllowed ? "legacy_allowed_new_restricted" : "legacy_denied_new_allowed";
    emit("security_policy_shadow_compared", { result, outcome: decision.outcome, legacyCode: String(legacyDecision?.code || "unknown").slice(0, 80) });
    return result;
  }

  function evaluateDataFlow(input = {}) {
    const decision = evaluate({
      actionRequest: {
        origin: "explicit_user_chat",
        skillId: "multimodal.analyze",
        operation: "analyze local media",
        explicitOrder: true,
        localOnly: input.localOnly === true,
        hasLocalData: true,
        toRemoteModel: true,
        dataFlow: DATA_FLOWS.LOCAL_TO_MODEL,
        workspaceId: input.workspaceId || null,
        profileScope: input.profileScope || "arnaud",
      },
      currentPermissions: { allowed: true, code: "AUTHORIZED_USER_MEDIA" },
    });
    if (decision.outcome === OUTCOMES.DENY) {
      const error = new Error("La politique de confidentialité interdit l’envoi distant de ce média.");
      error.code = input.localOnly ? "MEDIA_LOCAL_ONLY_REMOTE_BLOCKED" : "MEDIA_REMOTE_FLOW_DENIED";
      throw error;
    }
    return decision;
  }

  return {
    evaluate,
    evaluateDataFlow,
    createActionRequest,
    compareLegacy,
    requiresApproval: (request, options = {}) => evaluate({ ...options, actionRequest: request }).requiredApproval,
    traces: () => structuredClone(traces),
    version: () => policyVersion,
    enums: { OUTCOMES, RISK_LEVELS, ACTION_CLASSES, REVERSIBILITY, TARGET_SCOPES, DATA_FLOWS, TRUST_LEVELS },
  };
}

module.exports = {
  ACTION_CLASSES,
  DATA_FLOWS,
  ORIGINS,
  OUTCOMES,
  POLICY_BASE_VERSION,
  REASON_CODES,
  REVERSIBILITY,
  RISK_LEVELS,
  TARGET_SCOPES,
  TRUST_LEVELS,
  createActionRequest,
  createOperationalSecurityPolicy,
  fingerprint,
};
