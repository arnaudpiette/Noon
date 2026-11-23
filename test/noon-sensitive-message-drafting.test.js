"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { NOON_PERSONALITY, buildNoonSystemPrompt } = require("../lib/noon-system-prompt");

test("la personnalité exige une posture neutre et factuelle dans les conflits", () => {
  assert.match(NOON_PERSONALITY, /relais neutre/);
  assert.match(NOON_PERSONALITY, /paroles attribuées/);
  assert.match(NOON_PERSONALITY, /sans présumer des intentions ni prendre parti/);
  assert.match(NOON_PERSONALITY, /demande concrète de clarification ou de solution/);
  assert.match(NOON_PERSONALITY, /Évite les accusations, menaces/);
});

test("le cadrage des messages sensibles est présent dans le prompt assemblé", () => {
  const prompt = buildNoonSystemPrompt("Instruction additionnelle.");
  assert.match(prompt, /raisonne en entonnoir/);
  assert.match(prompt, /Instruction additionnelle\./);
});
