"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  PRIORITY_ORDER,
  createHardRulesRegistry,
} = require("../services/rules/hard-rules-registry");

test("une règle de sécurité gagne sur une préférence contradictoire", () => {
  const registry = createHardRulesRegistry();
  const security = registry.getRule("security.destructive_confirmation");
  const preference = {
    id: "preference.no_confirmation",
    hierarchy: "preference",
    weight: PRIORITY_ORDER.preference,
  };
  assert.equal(registry.resolveConflict([preference, security]).id, security.id);
});

test("autorise un brouillon mais bloque l'envoi sans permission distincte", () => {
  const registry = createHardRulesRegistry();
  assert.deepEqual(registry.evaluatePermission({ resource: "email", action: "draft" }), {
    allowed: true,
    ruleId: "email.draft_allowed",
  });
  assert.equal(registry.evaluatePermission({ resource: "email", action: "send" }).allowed, false);
  assert.equal(registry.evaluatePermission({ resource: "email", action: "send", explicitPermission: true, confirmed: true }).allowed, true);
});

test("identifie 12 h 45 comme pause Calendar protégée", () => {
  const registry = createHardRulesRegistry();
  assert.equal(registry.isProtectedCalendarTime("2026-06-01T10:45:00.000Z"), true);
  assert.equal(registry.isProtectedCalendarTime("2026-06-01T12:00:00.000Z"), false);
  assert.deepEqual(registry.getRule("calendar.protected_lunch").value, {
    start: "12:30", end: "13:30", timezone: "Europe/Paris",
  });
});

test("bloque l'écrasement d'un fichier sans permission explicite", () => {
  const registry = createHardRulesRegistry();
  const blocked = registry.evaluatePermission({ resource: "files", action: "overwrite" });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.ruleId, "files.no_overwrite");
});

test("interdit local_only et exige la confirmation pour confirm_each_use", () => {
  const registry = createHardRulesRegistry();
  assert.deepEqual(registry.canUseMemoryRemotely({ id: "m1", apiPolicy: "local_only" }), {
    allowed: false, ruleId: "memory.local_only",
  });
  assert.equal(registry.canUseMemoryRemotely({ id: "m2", apiPolicy: "confirm_each_use" }).allowed, false);
  assert.equal(registry.canUseMemoryRemotely({ id: "m2", apiPolicy: "confirm_each_use" }, ["m2"]).allowed, true);
});

test("un contexte conversationnel sans agenda n'injecte aucune règle Calendar", () => {
  const registry = createHardRulesRegistry();
  const rules = registry.getRulesForContext({ channel: "chat", intent: "conversation" });
  assert.equal(rules.some((rule) => rule.category === "calendar"), false);
  assert.equal(rules.some((rule) => rule.id === "security.destructive_confirmation"), true);
});

test("conserve les IDs privés existants sans fusion", () => {
  const registry = createHardRulesRegistry();
  assert.deepEqual(registry.privateProfileIds(), [
    "arnaud", "alexandra", "sinan", "kaan", "household", "noon", "projects", "project:*",
  ]);
});

test("expose l'identité vocale unique sans modifier le moteur audio", () => {
  const registry = createHardRulesRegistry();
  const voice = registry.getRule("voice.single_identity");
  assert.equal(voice.enforcement, "llm");
  assert.deepEqual(voice.enforcedBy, ["voice-instructions"]);
});

test("préserve exactement les représentations legacy attendues", () => {
  const registry = createHardRulesRegistry();
  assert.equal(registry.legacyOperationalRules().length, 10);
  assert.equal(registry.legacyPrivateRules().length, 10);
  assert.equal(registry.legacyPrivateRules().some(([key]) => key === "focus-myrtille"), true);
});

test("journalise uniquement les IDs des règles sélectionnées", () => {
  const events = [];
  const registry = createHardRulesRegistry({ debug: (event, metadata) => events.push({ event, metadata }) });
  registry.getRulesForContext({ channel: "chat", intent: "email" });
  assert.equal(events[0].event, "hard-rules.selected");
  assert.equal(events[0].metadata.ruleIds.includes("email.send_requires_explicit_permission"), true);
  assert.equal(JSON.stringify(events).includes("Préparer un brouillon"), false);
});

test("aligne les niveaux techniques sur une seule échelle de capacités", () => {
  assert.deepEqual(createHardRulesRegistry().permissionLevelCapabilities(), {
    read: "READ", draft: "PREPARE", write: "WRITE", external: "EXECUTE", destructive: "EXECUTE",
  });
});
