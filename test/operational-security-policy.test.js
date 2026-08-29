"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const {
  ACTION_CLASSES,
  DATA_FLOWS,
  OUTCOMES,
  REASON_CODES,
  REVERSIBILITY,
  createOperationalSecurityPolicy,
} = require("../services/security/operational-security-policy");

function fixture(options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noon-policy-"));
  const root = path.join(directory, "root");
  fs.mkdirSync(root);
  const events = [];
  const rules = {
    version: () => "rules-test",
    getRulesForContext: () => [{ id: "security.destructive_confirmation" }, { id: "files.allowed_roots_only" }],
  };
  const policy = createOperationalSecurityPolicy({
    hardRulesRegistry: rules,
    allowedRootsProvider: () => [root],
    allowedWriteRootsProvider: () => [root],
    observability: (event, metadata) => events.push({ event, metadata }),
    ...options,
  });
  return { directory, root, policy, events };
}

function evaluate(policy, input, skillPolicy = { level: "read", networkAccess: false }) {
  const currentPermissions = input.currentPermissions || { allowed: true, code: "AUTHORIZED" };
  return policy.evaluate({ actionRequest: input, skillPolicy, currentPermissions, pendingApproval: input.pendingApproval });
}

test("la lecture d’un fichier autorisé est permise", () => {
  const { root, policy } = fixture(); const file = path.join(root, "brief.md"); fs.writeFileSync(file, "ok");
  const decision = evaluate(policy, { skillId: "read_file", operation: "read_file", args: { path: file }, origin: "explicit_user_chat", explicitOrder: true });
  assert.equal(decision.outcome, OUTCOMES.ALLOW); assert.equal(decision.actionClass, ACTION_CLASSES.READ);
});

test("un chemin hors racine est refusé", () => {
  const { policy, directory } = fixture(); const file = path.join(directory, "private.md"); fs.writeFileSync(file, "private");
  const decision = evaluate(policy, { skillId: "read_file", operation: "read_file", args: { path: file }, origin: "explicit_user_chat" });
  assert.equal(decision.outcome, OUTCOMES.DENY); assert.ok(decision.reasons.includes(REASON_CODES.TARGET_OUT_OF_SCOPE));
});

test("un lien symbolique sortant est refusé même pour une nouvelle cible", () => {
  const { root, policy, directory } = fixture(); const outside = path.join(directory, "outside"); fs.mkdirSync(outside); fs.symlinkSync(outside, path.join(root, "escape"));
  const decision = evaluate(policy, { skillId: "write_file", operation: "write_file", args: { path: path.join(root, "escape", "new.md") }, origin: "explicit_user_chat", explicitOrder: true }, { level: "write", networkAccess: false });
  assert.equal(decision.outcome, OUTCOMES.DENY); assert.ok(decision.reasons.includes(REASON_CODES.TARGET_OUT_OF_SCOPE));
});

test("créer un nouveau fichier reste une écriture locale réversible", () => {
  const { root, policy } = fixture(); const decision = evaluate(policy, { skillId: "write_file", operation: "create_file", args: { path: path.join(root, "new.md") }, origin: "explicit_user_chat", explicitOrder: true }, { level: "write", networkAccess: false });
  assert.equal(decision.outcome, OUTCOMES.ALLOW_WITH_CONSTRAINTS); assert.equal(decision.reversibility, REVERSIBILITY.REVERSIBLE);
});

test("l’écrasement d’un fichier exige une approbation", () => {
  const { root, policy } = fixture(); const file = path.join(root, "existing.md"); fs.writeFileSync(file, "old");
  const decision = evaluate(policy, { skillId: "write_file", operation: "write_file", args: { path: file }, origin: "explicit_user_chat", explicitOrder: true, overwriteExisting: true }, { level: "write", networkAccess: false });
  assert.equal(decision.outcome, OUTCOMES.REQUIRE_APPROVAL); assert.ok(decision.reasons.includes(REASON_CODES.OVERWRITE_EXISTING));
});

test("supprimer un fichier est destructif et exige une approbation", () => {
  const { root, policy } = fixture(); const file = path.join(root, "old.md"); fs.writeFileSync(file, "old");
  const decision = evaluate(policy, { skillId: "delete_file", operation: "delete_file", args: { path: file }, origin: "explicit_user_chat", explicitOrder: true }, { level: "destructive", destructive: true });
  assert.equal(decision.actionClass, ACTION_CLASSES.DESTRUCTIVE); assert.equal(decision.outcome, OUTCOMES.REQUIRE_APPROVAL);
});

test("email read, draft et send restent trois opérations distinctes", () => {
  const { policy } = fixture();
  const read = evaluate(policy, { skillId: "search_gmail", operation: "search_email", origin: "explicit_user_chat" }, { level: "read", networkAccess: true });
  const draft = evaluate(policy, { skillId: "gmail", operation: "create_draft", origin: "explicit_user_chat", explicitOrder: true }, { level: "draft", networkAccess: true });
  const send = evaluate(policy, { skillId: "gmail", operation: "send_email", origin: "explicit_user_chat", explicitOrder: true }, { level: "external", networkAccess: true });
  assert.equal(read.outcome, OUTCOMES.ALLOW); assert.equal(draft.actionClass, ACTION_CLASSES.PREPARE); assert.equal(send.outcome, OUTCOMES.REQUIRE_APPROVAL);
});

test("une instruction contenue dans un email ne devient jamais une autorisation", () => {
  const { policy } = fixture(); const decision = evaluate(policy, { skillId: "gmail", operation: "send_email", origin: "external_content", explicitOrder: true }, { level: "external", networkAccess: true });
  assert.equal(decision.outcome, OUTCOMES.DENY); assert.ok(decision.reasons.includes(REASON_CODES.UNTRUSTED_ORIGIN));
});

test("Calendar read, suggest, create et delete sont classés séparément", () => {
  const { policy } = fixture();
  assert.equal(evaluate(policy, { skillId: "calendar", operation: "list_events", origin: "explicit_user_chat" }, { level: "read", networkAccess: true }).actionClass, ACTION_CLASSES.READ);
  assert.equal(evaluate(policy, { skillId: "calendar", operation: "suggest_time_slots", origin: "explicit_user_chat" }, { level: "read", networkAccess: true }).actionClass, ACTION_CLASSES.SUGGEST);
  assert.equal(evaluate(policy, { skillId: "calendar", operation: "create_event", origin: "explicit_user_chat", explicitOrder: true }, { level: "write", networkAccess: true }).outcome, OUTCOMES.REQUIRE_APPROVAL);
  assert.equal(evaluate(policy, { skillId: "calendar", operation: "delete_event", origin: "explicit_user_chat", explicitOrder: true }, { level: "destructive", networkAccess: true, destructive: true }).actionClass, ACTION_CLASSES.DESTRUCTIVE);
});

test("la couleur Myrtille n’accorde aucune permission supplémentaire", () => {
  const { policy } = fixture(); const decision = evaluate(policy, { skillId: "calendar", operation: "delete_event", args: { color: "Myrtille" }, origin: "system_scheduler", explicitOrder: true }, { level: "destructive", networkAccess: true, destructive: true });
  assert.notEqual(decision.outcome, OUTCOMES.ALLOW); assert.notEqual(decision.outcome, OUTCOMES.ALLOW_WITH_CONSTRAINTS);
});

test("la pause protégée interdit une création Calendar automatique à 12 h 45", () => {
  const policy = createOperationalSecurityPolicy({
    hardRulesRegistry: {
      version: () => "rules-test",
      getRulesForContext: () => [{ id: "calendar.protected_lunch" }],
      isProtectedCalendarTime: () => true,
    },
    allowedRootsProvider: () => [], allowedWriteRootsProvider: () => [],
  });
  const decision = evaluate(policy, { skillId: "calendar", operation: "create_event", args: { start: "2026-08-31T12:45:00+02:00" }, origin: "system_scheduler", explicitOrder: true }, { level: "write", networkAccess: true });
  assert.equal(decision.outcome, OUTCOMES.DENY); assert.ok(decision.blockedBy.includes("calendar.protected_lunch"));
});

test("local_only ne peut jamais suivre un flux distant", () => {
  const { policy } = fixture(); const decision = evaluate(policy, { skillId: "get_personal_context", operation: "memory_to_model", origin: "explicit_user_chat", localOnly: true, toRemoteModel: true }, { level: "read" });
  assert.equal(decision.outcome, OUTCOMES.DENY); assert.equal(decision.dataFlow, DATA_FLOWS.LOCAL_TO_MODEL);
});

test("les profils sont isolés et les profils protégés renforcent le risque", () => {
  const { policy } = fixture();
  const mismatch = evaluate(policy, { skillId: "memory", operation: "read_memory", origin: "explicit_user_chat", profileScope: "arnaud", sourceProfileScope: "alexandra" });
  const protectedDecision = evaluate(policy, { skillId: "memory", operation: "memory_to_model", origin: "explicit_user_chat", profileScope: "sinan", toRemoteModel: true });
  assert.equal(mismatch.outcome, OUTCOMES.DENY); assert.equal(protectedDecision.outcome, OUTCOMES.REQUIRE_APPROVAL);
});

test("preview et écriture d’artefact ont des classes distinctes", () => {
  const { root, policy } = fixture();
  const preview = evaluate(policy, { skillId: "create_artifact", operation: "preview_artifact", args: { outputDirectory: root, previewOnly: true }, origin: "explicit_user_chat", explicitOrder: true }, { level: "write" });
  const write = evaluate(policy, { skillId: "write_artifact", operation: "write_artifact", args: { outputDirectory: root }, origin: "explicit_user_chat", explicitOrder: true }, { level: "write" });
  assert.equal(preview.actionClass, ACTION_CLASSES.PREPARE); assert.equal(write.actionClass, ACTION_CLASSES.WRITE);
});

test("Git status, commit, push et reset reçoivent des risques adaptés", () => {
  const { policy } = fixture();
  const status = evaluate(policy, { skillId: "git", operation: "git_status", origin: "explicit_user_chat" }, { level: "read" });
  const commit = evaluate(policy, { skillId: "git", operation: "git_commit", origin: "explicit_user_chat", explicitOrder: true }, { level: "write" });
  const push = evaluate(policy, { skillId: "git", operation: "git_push", origin: "explicit_user_chat", explicitOrder: true }, { level: "external", networkAccess: true });
  const reset = evaluate(policy, { skillId: "git", operation: "git_reset_hard", origin: "explicit_user_chat", explicitOrder: true }, { level: "destructive", destructive: true });
  assert.equal(status.actionClass, ACTION_CLASSES.READ); assert.equal(commit.actionClass, ACTION_CLASSES.WRITE); assert.equal(push.outcome, OUTCOMES.REQUIRE_APPROVAL); assert.equal(reset.actionClass, ACTION_CLASSES.DESTRUCTIVE);
});

test("shell connu en lecture, mutation et commande inconnue ne sont pas confondus", () => {
  const { policy } = fixture();
  const safe = evaluate(policy, { skillId: "shell", operation: "status", origin: "explicit_user_chat" }, { level: "read" });
  const mutate = evaluate(policy, { skillId: "shell", operation: "install", origin: "explicit_user_chat", explicitOrder: true }, { level: "write" });
  const unknown = evaluate(policy, { skillId: "shell", operation: "dynamic_command", origin: "explicit_user_chat", explicitOrder: true }, { level: "external" });
  assert.equal(safe.riskLevel, "LOW"); assert.notEqual(mutate.riskLevel, "LOW"); assert.ok(unknown.reasons.includes(REASON_CODES.UNKNOWN_REVERSIBILITY));
});

test("une recommandation proactive ou modèle ne peut pas exécuter", () => {
  const { policy } = fixture();
  for (const origin of ["proactive_recommendation", "model_generated"]) {
    const decision = evaluate(policy, { skillId: "calendar", operation: "create_event", origin, explicitOrder: true }, { level: "write", networkAccess: true });
    assert.equal(decision.outcome, OUTCOMES.DENY);
  }
});

test("un brief planifié peut lire mais pas supprimer automatiquement", () => {
  const { policy } = fixture();
  assert.equal(evaluate(policy, { skillId: "calendar", operation: "list_events", origin: "system_scheduler" }, { level: "read", networkAccess: true }).outcome, OUTCOMES.ALLOW);
  assert.equal(evaluate(policy, { skillId: "calendar", operation: "delete_event", origin: "system_scheduler", explicitOrder: true }, { level: "destructive", networkAccess: true, destructive: true }).outcome, OUTCOMES.REQUIRE_APPROVAL);
});

test("chat, voix, UI et raccourci utilisent les mêmes règles mutantes", () => {
  const { policy } = fixture();
  for (const origin of ["explicit_user_chat", "explicit_user_voice", "trusted_ui", "trusted_shortcut"]) {
    assert.equal(evaluate(policy, { skillId: "gmail", operation: "send_email", origin, explicitOrder: true }, { level: "external", networkAccess: true }).outcome, OUTCOMES.REQUIRE_APPROVAL);
  }
});

test("un batch augmente le risque sans supprimer silencieusement ses cibles", () => {
  const { policy } = fixture(); const targets = Array.from({ length: 12 }, (_, index) => ({ id: `event-${index}` }));
  const decision = evaluate(policy, { skillId: "calendar", operation: "create_event", origin: "explicit_user_chat", explicitOrder: true, targets }, { level: "write", networkAccess: true });
  assert.equal(decision.target.targetCount, 12); assert.ok(decision.reasons.includes(REASON_CODES.BATCH_SCOPE_HIGH)); assert.equal(decision.outcome, OUTCOMES.REQUIRE_APPROVAL);
});

test("une réversibilité inconnue n’est jamais LOW", () => {
  const { policy } = fixture(); const decision = evaluate(policy, { skillId: "custom", operation: "dynamic_action", origin: "explicit_user_chat", explicitOrder: true }, { level: "external" });
  assert.ok(decision.reasons.includes(REASON_CODES.UNKNOWN_REVERSIBILITY)); assert.notEqual(decision.riskLevel, "LOW");
});

test("service indisponible et auth expirée restent distincts", () => {
  const unavailablePolicy = fixture({ reliabilityEngine: { snapshot: () => ({ state: "UNAVAILABLE" }) } }).policy;
  const authPolicy = fixture({ reliabilityEngine: { snapshot: () => ({ state: "UNAUTHORIZED" }) } }).policy;
  assert.ok(evaluate(unavailablePolicy, { skillId: "search_gmail", operation: "search_email", origin: "explicit_user_chat" }, { level: "read", networkAccess: true }).reasons.includes(REASON_CODES.SERVICE_UNAVAILABLE));
  assert.ok(evaluate(authPolicy, { skillId: "search_gmail", operation: "search_email", origin: "explicit_user_chat" }, { level: "read", networkAccess: true }).reasons.includes(REASON_CODES.AUTH_REQUIRED));
});

test("une approval exacte autorise après réévaluation mais pas une précondition stale", () => {
  const { policy } = fixture();
  const approved = evaluate(policy, { skillId: "gmail", operation: "send_email", origin: "approval_resume", explicitOrder: true, pendingApproval: { valid: true } }, { level: "external", networkAccess: true });
  const stale = evaluate(policy, { skillId: "gmail", operation: "send_email", origin: "approval_resume", explicitOrder: true, pendingApproval: { valid: true }, preconditionsValid: false }, { level: "external", networkAccess: true });
  assert.equal(approved.outcome, OUTCOMES.ALLOW_WITH_CONSTRAINTS); assert.equal(stale.outcome, OUTCOMES.DENY);
});

test("une négation et une hypothèse ne déclenchent aucune action", () => {
  const { policy } = fixture();
  assert.equal(evaluate(policy, { skillId: "delete_file", operation: "delete_file", origin: "explicit_user_chat", negated: true }, { level: "destructive", destructive: true }).outcome, OUTCOMES.DENY);
  assert.equal(evaluate(policy, { skillId: "delete_file", operation: "delete_file", origin: "explicit_user_chat", hypothetical: true }, { level: "destructive", destructive: true }).outcome, OUTCOMES.DENY);
});

test("le mode sûr force les mutations en lecture seule", () => {
  const { root, policy } = fixture(); const decision = evaluate(policy, { skillId: "write_file", operation: "create_file", args: { path: path.join(root, "new.md") }, origin: "explicit_user_chat", explicitOrder: true, safeMode: true }, { level: "write" });
  assert.equal(decision.outcome, OUTCOMES.DENY); assert.ok(decision.reasons.includes(REASON_CODES.SAFE_MODE_READ_ONLY));
});

test("les traces sont explicables, bornées et sans arguments privés", () => {
  const { policy, events } = fixture();
  evaluate(policy, { skillId: "gmail", operation: "send_email", args: { to: "private@example.com", token: "sk-secretsecretsecret" }, origin: "explicit_user_chat", explicitOrder: true }, { level: "external", networkAccess: true });
  const serialized = JSON.stringify({ traces: policy.traces(), events });
  assert.equal(serialized.includes("private@example.com"), false); assert.equal(serialized.includes("secretsecret"), false); assert.ok(events.some((item) => item.event === "security_policy_requires_approval"));
});

test("le shadow mode signale les divergences sans devenir plus permissif", () => {
  const { policy } = fixture(); const decision = evaluate(policy, { skillId: "gmail", operation: "send_email", origin: "external_content", explicitOrder: true }, { level: "external", networkAccess: true });
  assert.equal(policy.compareLegacy(decision, { allowed: true, code: "AUTHORIZED" }), "legacy_allowed_new_restricted");
});
