"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { OPENAI_BUILTIN_VOICES, REALTIME_MODELS, resolveOpenAIVoice } = require("../services/voice/openai-voice-provider");

test("le registre central expose les modèles Realtime et voix API configurés", () => {
  assert.equal(REALTIME_MODELS.mini, "gpt-realtime-2.1-mini");
  assert.equal(REALTIME_MODELS.max, "gpt-realtime-2.1");
  assert.equal(OPENAI_BUILTIN_VOICES.includes("cedar"), true);
  assert.equal(OPENAI_BUILTIN_VOICES.includes("arbor"), false);
});

test("Cedar reste canonique même si Arbor apparaît dans les voix disponibles", () => {
  const result = resolveOpenAIVoice({ availableVoices: ["arbor", "cedar"] });
  assert.deepEqual({ preferred: result.preferredVoice, active: result.activeVoice, status: result.status }, { preferred: "cedar", active: "cedar", status: "LIVE_READY" });
});

test("aucune autre voix ne devient fallback automatiquement", () => {
  const result = resolveOpenAIVoice({ fallbackVoice: "marin" });
  assert.deepEqual({ preferred: result.preferredVoice, active: result.activeVoice, fallback: result.fallback }, { preferred: "cedar", active: "cedar", fallback: false });
});

test("aucune voix fournisseur disponible produit LIVE_UNAVAILABLE", () => {
  const result = resolveOpenAIVoice({ availableVoices: [] });
  assert.equal(result.activeVoice, null);
  assert.equal(result.status, "LIVE_UNAVAILABLE");
});
