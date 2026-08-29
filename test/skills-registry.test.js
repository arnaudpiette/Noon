"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createSkillRegistry } = require("../skills/registry");
const { authorizeSkill } = require("../skills/permissions");

test("charge quinze skills uniques avec des schémas stricts", () => {
  const registry = createSkillRegistry();
  const skills = registry.getAllSkills();
  assert.equal(skills.length, 15);
  assert.equal(new Set(skills.map((skill) => skill.definition.name)).size, skills.length);
  for (const skill of skills) {
    assert.equal(skill.definition.strict, true);
    assert.equal(skill.definition.parameters.additionalProperties, false);
    assert.equal(typeof skill.execute, "function");
    assert.ok(skill.permissions.level);
  }
});

test("refuse au démarrage un doublon ou un schéma non strict", () => {
  const registry = createSkillRegistry();
  const skill = registry.getAllSkills()[0];
  assert.throws(() => createSkillRegistry([skill, skill]), /dupliqué/);
  assert.throws(
    () => createSkillRegistry([{ ...skill, definition: { ...skill.definition, strict: false } }]),
    /Définition invalide/
  );
});

test("diffère uniquement les skills spécialisés pour Tool Search", () => {
  const registry = createSkillRegistry();
  const definitions = registry.getToolDefinitions({ deferRare: true });
  const immediate = definitions.filter((tool) => !tool.defer_loading).map((tool) => tool.name);
  const deferred = definitions.filter((tool) => tool.defer_loading).map((tool) => tool.name);
  assert.deepEqual(immediate.sort(), ["browse_directory", "read_file", "search_files", "search_personal_sources"]);
  assert.deepEqual(deferred.sort(), ["ask_codex", "create_artifact", "generate_creative_image", "get_personal_context", "list_execution_items", "list_noon_inbox", "search_gmail", "suggest_time_slots", "synthesize_personal_sources", "update_execution_status", "write_artifact"]);
});

test("refuse un skill inconnu et une écriture sans ordre explicite", async () => {
  const registry = createSkillRegistry();
  await assert.rejects(() => registry.executeSkill("missing", {}, {}), /Outil inconnu/);
  await assert.rejects(
    () => registry.executeSkill("create_artifact", {}, { handlers: {}, explicitOrder: false }),
    /EXPLICIT_ORDER_REQUIRED/
  );
});

test("le moteur central exige une confirmation pour une action destructive", () => {
  const skill = { permissions: { level: "destructive", destructive: true, confirmationRequired: true } };
  assert.equal(authorizeSkill(skill, { confirmed: false }).allowed, false);
  assert.equal(authorizeSkill(skill, { confirmed: true }).allowed, true);
});

test("le moteur central refuse un chemin hors racine et un lien symbolique sortant", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "noon-skill-permissions-"));
  const allowed = path.join(temporary, "allowed");
  const outside = path.join(temporary, "outside");
  fs.mkdirSync(allowed); fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(allowed, "escape"));
  const readSkill = { permissions: { level: "read", destructive: false } };
  assert.equal(authorizeSkill(readSkill, { allowedRoots: [allowed] }, { path: outside }).allowed, false);
  assert.equal(authorizeSkill(readSkill, { allowedRoots: [allowed] }, { path: path.join(allowed, "escape") }).allowed, false);
});

test("associe l'exécution au handler injecté sans exposer server.js", async () => {
  const registry = createSkillRegistry();
  const result = await registry.executeSkill("search_files", { query: "Kasa" }, {
    sessionId: "session-test",
    handlers: { searchFiles: (query) => [{ name: query }] },
  });
  assert.deepEqual(result, [{ name: "Kasa" }]);
});

test("expose le suivi d'exécution au chat sans contourner l'ordre explicite", async () => {
  const registry = createSkillRegistry();
  const listed = await registry.executeSkill("list_execution_items", { status: null }, {
    handlers: { listExecutionItems: () => [{ executionItemId: "execution-1", status: "planned" }] },
  });
  assert.equal(listed[0].executionItemId, "execution-1");

  await assert.rejects(
    () => registry.executeSkill("update_execution_status", {
      executionItemId: "execution-1", status: "completed", progress: 100,
      remainingDurationMinutes: 0, deferredUntil: null,
    }, { explicitOrder: false, handlers: { updateExecutionStatus: () => ({}) } }),
    /EXPLICIT_ORDER_REQUIRED/
  );

  const updated = await registry.executeSkill("update_execution_status", {
    executionItemId: "execution-1", status: "completed", progress: 100,
    remainingDurationMinutes: 0, deferredUntil: null,
  }, {
    explicitOrder: true,
    handlers: { updateExecutionStatus: (args) => ({ status: args.status }) },
  });
  assert.equal(updated.status, "completed");
});

test("journalise le cycle d'un outil sans arguments ni résultat bruts", async () => {
  const entries = [];
  const registry = createSkillRegistry(undefined, { auditLog: { append: (event, details) => entries.push({ event, details }) } });
  await registry.executeSkill("search_files", { query: "donnée personnelle" }, {
    sessionId: "session-personnelle", handlers: { searchFiles: () => [{ secret: "résultat privé" }] },
  });
  assert.deepEqual(entries.map((entry) => entry.event), ["tool.requested", "tool.authorized", "tool.started", "tool.succeeded"]);
  const serialized = JSON.stringify(entries);
  assert.doesNotMatch(serialized, /donnée personnelle|résultat privé|session-personnelle/);
});
