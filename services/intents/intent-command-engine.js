"use strict";

const crypto = require("crypto");
const { adaptInput } = require("./input-adapters");
const { createCommandRegistry } = require("./command-registry");
const { createRecentEntityContext } = require("./recent-entity-context");
const { parseTemporal } = require("./temporal-parser");
const { INTENT_POLICY_VERSION, IntentError, validateNormalizedIntent } = require("./intent-schema");
const { resolveResearchScope } = require("../research/research-resolver");

const MODE_PATTERN = /\b(?:passe\s+en\s+|active\s+le\s+|mets?\s+le\s+)?mode\s+(dev|da|soutenance|focus|normal)\b|\bretour\s+(?:au\s+)?normal\b/i;
const WORKSPACE_PATTERN = /(?:^|\b)(?:passe\s+sur|bascule\s+sur|ouvre\s+(?:le\s+)?projet|\/focus)\s+(.+?)(?=\s+(?:en\s+mode|et\s+|puis\s+)|[.!?,;]|$)/i;
const FILLER_PATTERN = /^(?:(?:euh+|hum+|heu+|bon|alors|dis\s+noon|noon|salut\s+noon)[,\s]+)+/i;
const QUOTED_ACTION_PATTERN = /(?:phrase|expression|citation).{0,40}["'“‘](?:envoie|supprime|efface|crée|ouvre)/i;
const HYPOTHETICAL_PATTERN = /\b(?:que se passerait|qu'arriverait|qu’arriverait|si je|si tu|what would happen|qué pasaría)\b/i;
const NEGATION_PATTERN = /\b(?:ne|n')\s*(?:le\s+|la\s+|les\s+)?(?:supprime|efface|envoie|modifie|écrase)\s+pas\b|\b(?:don'?t|do not|no)\s+(?:delete|send|remove)\b/i;
const PRONOUN_PATTERN = /\b(?:ça|cela|ce fichier|ce document|ce projet|cette synthèse|cette presentation|cette présentation|celui-là|celui la|celle-là|celle la|le précédent|la précédente|la dernière version|le|la|en)\b/i;
const FORMAT_PATTERN = /\b(pdf|docx|word|xlsx|excel|pptx|powerpoint|png|markdown|md|html|rtf|csv)\b/i;

function clean(value, max = 4000) { return String(value || "").replace(/[\0\r]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max); }
function fingerprint(value) { return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 20); }
function confidenceFor(ambiguity, structured = false) { return ambiguity.some((item) => item.confidence === "HIGH") ? "low" : ambiguity.length ? "medium" : structured ? "high" : "high"; }
function expectedResponse(type) { return ["ASK", "SEARCH", "SUMMARIZE", "COMPARE"].includes(type) ? "answer" : ["OPEN", "NAVIGATE", "SWITCH_CONTEXT", "CONTROL"].includes(type) ? "client_action" : "execution_plan"; }
function flags(type) { return { requiresReasoning: ["ASK", "SUMMARIZE", "COMPARE", "PLAN"].includes(type), requiresSearch: type === "SEARCH", requiresTool: ["CREATE", "UPDATE", "DELETE", "OPEN", "GENERATE", "SCHEDULE", "REMIND", "CONFIRM", "REJECT", "CANCEL"].includes(type) }; }
function ambiguity(type, field, candidates = [], level = "HIGH") { return { type, field, candidates: candidates.map((item) => typeof item === "string" ? { id: item } : item), confidence: level, resolutionRequired: level === "HIGH" }; }

function createIntentCommandEngine({ workspaceEngine = null, commandRegistry = createCommandRegistry(), recentEntities = createRecentEntityContext(), semanticClassifier = null, observability = null, now = () => Date.now(), timezone = "Europe/Paris" } = {}) {
  const emit = (event, metadata = {}) => { try { observability?.(event, metadata); } catch {} };
  function make(envelope, input = {}) {
    const ambiguities = input.ambiguity || [];
    const base = {
      intentId: String(input.intentId || `intent-${crypto.randomUUID()}`),
      intentPolicyVersion: INTENT_POLICY_VERSION,
      type: input.type || "ASK", action: input.action || "answer",
      entities: input.entities && typeof input.entities === "object" ? input.entities : {},
      target: input.target && typeof input.target === "object" ? input.target : {},
      workspaceId: input.workspaceId || envelope.workspaceId || null,
      projectId: input.projectId || null, conversationId: envelope.conversationId || null,
      mode: input.mode || null, temporal: input.temporal || {}, confidence: input.confidence || confidenceFor(ambiguities, Boolean(envelope.uiAction || envelope.shortcutPayload || Object.keys(envelope.structured).length)),
      ambiguity: ambiguities, sourceChannel: envelope.channel,
      origin: envelope.originTrust, originalInputRef: fingerprint(`${envelope.inputId}:${envelope.timestamp}`),
      explicitOrder: input.explicitOrder === true, negated: input.negated === true,
      requiresReasoning: input.requiresReasoning ?? flags(input.type || "ASK").requiresReasoning,
      requiresSearch: input.requiresSearch ?? flags(input.type || "ASK").requiresSearch,
      requiresTool: input.requiresTool ?? flags(input.type || "ASK").requiresTool,
      expectedResponseType: input.expectedResponseType || expectedResponse(input.type || "ASK"),
      parseOnly: true, ignored: input.ignored === true,
      searchScopes: input.searchScopes || [], steps: input.steps,
      requiresPublicResearch: input.requiresPublicResearch === true,
      researchScope: ["PERSONAL", "PUBLIC", "MIXED"].includes(input.researchScope) ? input.researchScope : null,
      dependencyMode: input.dependencyMode || null,
    };
    return validateNormalizedIntent(base);
  }

  function structuredIntent(envelope) {
    const payload = envelope.uiAction || envelope.shortcutPayload || envelope.structured;
    if (!payload || !Object.keys(payload).length) return null;
    const operation = clean(payload.command || payload.action || payload.type, 80).toLocaleLowerCase("fr").replace(/[.\s-]+/g, "_");
    const map = {
      create_reminder: ["CREATE", "reminder"], reminder: ["CREATE", "reminder"],
      create_calendar_event: ["CREATE", "calendar_event"], delete_event: ["DELETE", "calendar_event"],
      switch_workspace: ["SWITCH_CONTEXT", "workspace"], set_mode: ["CONTROL", "mode"],
      open_artifact: ["OPEN", "artifact"], generate_artifact: ["GENERATE", "artifact"],
      cancel_execution: ["CANCEL", "execution"], confirm_approval: ["CONFIRM", "approval"], reject_approval: ["REJECT", "approval"],
    };
    if (!map[operation]) return null;
    const [type, action] = map[operation];
    const target = {};
    for (const key of ["eventId", "workspaceId", "artifactId", "executionId", "approvalId", "projectId", "fileRef"]) if (payload[key]) target[key] = String(payload[key]);
    const entities = {};
    for (const key of ["title", "date", "time", "durationMinutes", "mode", "workspace", "query", "format"]) if (payload[key] !== undefined) entities[key] = payload[key];
    let workspaceResolution = null;
    if (type === "SWITCH_CONTEXT" && !target.workspaceId && entities.workspace) {
      workspaceResolution = resolveWorkspace(clean(entities.workspace, 160), envelope);
      Object.assign(target, workspaceResolution.target);
    }
    const missingExactTarget = ["DELETE", "CONFIRM", "REJECT", "CANCEL"].includes(type) && !Object.keys(target).length;
    return make(envelope, { type, action, target, entities, workspaceId: target.workspaceId || workspaceResolution?.workspaceId, projectId: target.projectId, mode: entities.mode ? String(entities.mode).toUpperCase() : null, temporal: { date: entities.date || null, time: entities.time || null, durationMinutes: entities.durationMinutes || null, timezone }, explicitOrder: true, ambiguity: missingExactTarget ? [ambiguity("missing_target", "target", [], "HIGH")] : workspaceResolution?.ambiguity || [] });
  }

  function resolveWorkspace(name, envelope) {
    if (!workspaceEngine || !name) return { target: { name }, workspaceId: null, ambiguity: [ambiguity("unresolved_workspace", "workspace", [], "MEDIUM")] };
    const result = workspaceEngine.resolve(name);
    if (result.status === "resolved") return { target: { workspaceId: result.workspace.id, name: result.workspace.name }, workspaceId: result.workspace.id, ambiguity: [] };
    if (result.status === "ambiguous") return { target: { name }, workspaceId: null, ambiguity: [ambiguity("ambiguous_workspace", "workspace", result.matches.map((item) => ({ id: item.id, label: item.name })), "HIGH")] };
    return { target: { name }, workspaceId: null, ambiguity: [ambiguity("target_not_found", "workspace", [], "HIGH")] };
  }

  function resolveReference(text, envelope, type = null) {
    if (!PRONOUN_PATTERN.test(text)) return { target: {}, ambiguity: [] };
    const result = recentEntities.resolve(envelope.sessionId, type);
    if (result.status === "resolved") return { target: { [`${result.entity.type}Id`]: result.entity.id }, ambiguity: [] };
    return { target: {}, ambiguity: [ambiguity(result.status === "ambiguous" ? "ambiguous_reference" : "missing_reference", "target", result.candidates.map((item) => ({ id: item.id, label: item.label })), "HIGH")] };
  }

  function approvalIntent(text, envelope, context) {
    const normalized = text.toLocaleLowerCase("fr").trim(); const approvals = context.pendingApprovalIds || [];
    const modifies = /\b(?:oui|ok|d'accord|vas-y).+\b(?:mais|change|modifie|ajoute|retire)\b/i.test(normalized);
    if (modifies && approvals.length === 1) return make(envelope, { type: "UPDATE", action: "pending_action", target: { approvalId: approvals[0] }, entities: { modificationRequested: true }, explicitOrder: true });
    const yes = /^(?:oui|ok|d'accord|d’accord|vas-y|confirme)$/i.test(normalized);
    const no = /^(?:non|refuse|laisse tomber)$/i.test(normalized);
    if (!yes && !no) return null;
    if (!approvals.length) return /^laisse tomber$/i.test(normalized) ? null : make(envelope, { type: "ASK", action: "acknowledgement", confidence: "medium" });
    if (approvals.length > 1) return make(envelope, { type: yes ? "CONFIRM" : "REJECT", action: "approval", ambiguity: [ambiguity("multiple_approvals", "approvalId", approvals, "HIGH")] });
    return make(envelope, { type: yes ? "CONFIRM" : "REJECT", action: "approval", target: { approvalId: approvals[0] }, explicitOrder: true });
  }

  function deterministic(envelope, context = {}) {
    let text = clean(envelope.transcript || envelope.rawText);
    if (envelope.channel === "voice") text = text.replace(FILLER_PATTERN, "").trim();
    if (!text) return make(envelope, { type: "ASK", action: "empty", confidence: "low", ambiguity: [ambiguity("missing_input", "rawText", [], "HIGH")] });
    if (envelope.channel === "voice" && /^salut\s+noon[.!]?$/i.test(text)) return make(envelope, { type: "CONTROL", action: "wake_word", ignored: true, requiresReasoning: false, requiresTool: false, confidence: "high" });
    const approval = approvalIntent(text, envelope, context); if (approval) return approval;
    if (QUOTED_ACTION_PATTERN.test(text) || HYPOTHETICAL_PATTERN.test(text)) return make(envelope, { type: "ASK", action: "explain", negated: false });
    if (NEGATION_PATTERN.test(text)) return make(envelope, { type: "CONTROL", action: "prevent_action", negated: true, explicitOrder: true, requiresTool: false });
    if (/^(?:continue|la suite|reprends|vas-y)$/i.test(text)) {
      if (context.activeExecutionId || context.continuationAvailable) return make(envelope, { type: "CONTINUE", action: "previous_task", target: context.activeExecutionId ? { executionId: context.activeExecutionId } : {}, explicitOrder: true });
      return make(envelope, { type: "CONTINUE", action: "previous_task", confidence: "low", ambiguity: [ambiguity("missing_context", "continuation", [], "HIGH")] });
    }
    if (/^(?:stop|arrête|arrete)$/i.test(text)) {
      if (envelope.channel === "voice" && context.ttsActive) return make(envelope, { type: "CONTROL", action: "interrupt_speech", explicitOrder: true });
      if (context.activeExecutionId) return make(envelope, { type: "CANCEL", action: "execution", target: { executionId: context.activeExecutionId }, explicitOrder: true });
      return make(envelope, { type: "CANCEL", action: "active_operation", ambiguity: [ambiguity("missing_target", "executionId", [], "HIGH")] });
    }
    if (/^(?:annule|laisse tomber)$/i.test(text)) {
      const operations = context.activeOperationIds || [];
      if (operations.length === 1) return make(envelope, { type: "CANCEL", action: "active_operation", target: { executionId: operations[0] }, explicitOrder: true });
      return make(envelope, { type: "CANCEL", action: "active_operation", ambiguity: [ambiguity(operations.length > 1 ? "multiple_operations" : "missing_target", "executionId", operations, "HIGH")] });
    }

    const researchResolution = resolveResearchScope({ query: text });
    if (["PUBLIC", "MIXED"].includes(researchResolution.scope)) {
      return make(envelope, { type: "SEARCH", action: "public_research", entities: { query: clean(text, 1000) }, searchScopes: [researchResolution.scope.toLowerCase()], requiresSearch: true, requiresPublicResearch: true, researchScope: researchResolution.scope, explicitOrder: researchResolution.explicit });
    }
    const workspaceMatch = text.match(WORKSPACE_PATTERN); const modeMatch = text.match(MODE_PATTERN);
    const searchMatch = text.match(/\b(?:retrouve|cherche|recherche|trouve|find)\b(?:-moi)?\s+(?:le\s+)?(?:fichier|document|controller|contrôleur)?\s*(.+)$/i);
    const steps = [];
    if (workspaceMatch) { const resolved = resolveWorkspace(clean(workspaceMatch[1], 160), envelope); steps.push(make(envelope, { type: "SWITCH_CONTEXT", action: "workspace", ...resolved, explicitOrder: true })); }
    if (modeMatch) { const mode = String(modeMatch[1] || "NORMAL").toUpperCase(); steps.push(make(envelope, { type: "CONTROL", action: "mode", mode, entities: { mode }, explicitOrder: true })); }
    if (searchMatch) steps.push(make(envelope, { type: "SEARCH", action: /controller|contrôleur|code/i.test(text) ? "code" : "file", entities: { query: clean(searchMatch[1] || text, 500) }, searchScopes: ["project", "file"], requiresSearch: true, explicitOrder: true }));
    if (steps.length > 1) return make(envelope, { type: "COMPOUND", action: "ordered_steps", steps, dependencyMode: "sequential", workspaceId: steps.find((step) => step.workspaceId)?.workspaceId || envelope.workspaceId, explicitOrder: true, confidence: steps.some((step) => step.confidence === "low") ? "low" : "high", ambiguity: steps.flatMap((step) => step.ambiguity) });
    if (steps.length === 1) return steps[0];

    if (/\b(?:agenda|calendar|calendrier)\b/i.test(text) && /\b(?:rappels?|reminders?)\b/i.test(text) && /\b(?:montre|affiche|show)\b/i.test(text)) {
      return make(envelope, { type: "COMPOUND", action: "parallel_reads", dependencyMode: "parallel", steps: [make(envelope, { type: "OPEN", action: "calendar", explicitOrder: true }), make(envelope, { type: "OPEN", action: "reminders", explicitOrder: true })], explicitOrder: true });
    }
    const reminder = /\b(?:rappelle(?:-moi)?|mets?\s*(?:moi|-moi)?\s+un\s+rappel|create\s+(?:a\s+)?reminder|recu[eé]rdame)\b/i.test(text);
    if (reminder) {
      const title = clean(text.replace(/^.*?\b(?:pour|de|to|que)\b\s*/i, ""), 500);
      return make(envelope, { type: "CREATE", action: "reminder", entities: { title }, temporal: parseTemporal(text, { now: new Date(now()), timeZone: timezone }), explicitOrder: true });
    }
    if (/\b(?:organise|planifie|organize|plan)\b.*\b(?:journée|journee|day)\b/i.test(text)) return make(envelope, { type: "PLAN", action: "day", temporal: parseTemporal(text, { now: new Date(now()), timeZone: timezone }), explicitOrder: true });
    if (searchMatch) return steps[0];
    const format = text.match(FORMAT_PATTERN);
    if (format && /\b(?:fais|crée|cree|génère|genere|transforme|exporte|make|generate)\b/i.test(text)) {
      const normalizedFormat = ({ word: "docx", excel: "xlsx", powerpoint: "pptx", markdown: "md" })[format[1].toLowerCase()] || format[1].toLowerCase();
      const reference = resolveReference(text, envelope, "artifact");
      return make(envelope, { type: "GENERATE", action: "artifact", entities: { format: normalizedFormat }, ...reference, explicitOrder: true });
    }
    if (/\b(?:ouvre|open)\b/i.test(text) && PRONOUN_PATTERN.test(text)) { const reference = resolveReference(text, envelope); return make(envelope, { type: "OPEN", action: "referenced_resource", ...reference, explicitOrder: true }); }
    if (/\b(?:supprime|efface|delete|remove)\b/i.test(text) && !/\bcomment\b|\bhow\b/i.test(text)) { const reference = resolveReference(text, envelope); return make(envelope, { type: "DELETE", action: /événement|event/i.test(text) ? "calendar_event" : "resource", ...reference, explicitOrder: true }); }
    if (/\b(?:résume|resume|summarize)\b/i.test(text)) return make(envelope, { type: "SUMMARIZE", action: "content", ...resolveReference(text, envelope), explicitOrder: true });
    if (/\b(?:compare|comparaison)\b/i.test(text)) return make(envelope, { type: "COMPARE", action: "resources", requiresReasoning: true });
    return make(envelope, { type: "ASK", action: "answer", requiresReasoning: true });
  }

  async function normalize(envelopeInput, context = {}, options = {}) {
    const started = now(); const envelope = validateEnvelope(envelopeInput);
    emit("intent_received", { channel: envelope.channel, origin: envelope.originTrust });
    try {
      let intent = structuredIntent(envelope) || deterministic(envelope, context);
      const shouldFallback = options.allowSemanticFallback === true && semanticClassifier && intent.type === "ASK" && intent.action === "answer" && options.forceSemanticFallback === true;
      if (shouldFallback) {
        emit("intent_llm_fallback", { channel: envelope.channel });
        const candidate = await semanticClassifier({ text: envelope.transcript || envelope.rawText, channel: envelope.channel, context: { activeWorkspaceId: context.activeWorkspaceId || null } });
        try { intent = validateNormalizedIntent({ ...intent, ...candidate, intentId: intent.intentId, intentPolicyVersion: INTENT_POLICY_VERSION, sourceChannel: envelope.channel, origin: envelope.originTrust, originalInputRef: intent.originalInputRef, parseOnly: true }); }
        catch { intent = make(envelope, { type: "ASK", action: "answer", confidence: "low", ambiguity: [ambiguity("semantic_output_invalid", "intent", [], "MEDIUM")] }); }
      }
      const duration = now() - started;
      emit(intent.ambiguity.length ? "intent_ambiguous" : "intent_resolved", { channel: envelope.channel, intentType: intent.type, actionCategory: intent.action, confidence: intent.confidence, ambiguityCount: intent.ambiguity.length, durationMs: duration });
      emit("intent_normalized", { channel: envelope.channel, intentType: intent.type, confidence: intent.confidence, intentPolicyVersion: INTENT_POLICY_VERSION });
      emit("intent_normalization_ms", { channel: envelope.channel, value: duration });
      return intent;
    } catch (error) { emit("intent_failed", { channel: envelope.channel, code: String(error.code || error.name || "ERROR").slice(0, 80) }); throw error; }
  }
  function validateEnvelope(value) { const { validateInputEnvelope } = require("./intent-schema"); return validateInputEnvelope(value); }
  async function parse(channel, input = {}, context = {}, options = {}) { return normalize(adaptInput(channel, input), context, options); }
  function rememberEntity(sessionId, entity) { return recentEntities.remember(sessionId, entity); }
  return { commandRegistry, normalize, parse, parseOnly: parse, recentEntities, rememberEntity, policyVersion: INTENT_POLICY_VERSION };
}

module.exports = { createIntentCommandEngine };
