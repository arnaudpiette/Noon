"use strict";

// Vérifie les langues, accents, modes et limites de mémoire de la voix.

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  appendUniqueRealtimeResponse,
  calculateRealtimeCost,
  normalizeAccent,
  normalizeLanguage,
  normalizeNoonMode,
  parseVoicePreferenceCommand,
  trimConversationHistory,
} = require("../lib/voice-utils");

const usage = {
  input_token_details: {
    text_tokens: 1000,
    audio_tokens: 2000,
    cached_tokens_details: { text_tokens: 100, audio_tokens: 200 },
  },
  output_token_details: { text_tokens: 300, audio_tokens: 400 },
};

test("calcule les coûts Realtime Mini et Max", () => {
  assert.equal(calculateRealtimeCost("gpt-realtime-2.1-mini", usage), 0.027326);
  assert.equal(calculateRealtimeCost("gpt-realtime-2.1", usage), 0.09412);
});

test("ne comptabilise pas deux fois une réponse", () => {
  const ledger = { responseIds: [], costUSD: 0 };
  assert.equal(appendUniqueRealtimeResponse(ledger, "resp_1", 0.25), true);
  assert.equal(appendUniqueRealtimeResponse(ledger, "resp_1", 0.25), false);
  assert.equal(ledger.costUSD, 0.25);
});

test("normalise les variantes linguistiques et les accents", () => {
  assert.equal(normalizeLanguage("espagnol mexicain"), "es-MX");
  assert.equal(normalizeLanguage("portugais brésilien"), "pt-BR");
  assert.equal(normalizeAccent("  RUSSE\n"), "russe");
  assert.deepEqual(parseVoicePreferenceCommand("Habla español de México"), {
    language: "es-MX",
    accent: null,
  });
});

test("normalise les modes DA et DEV", () => {
  assert.equal(normalizeNoonMode("dev"), "DEV");
  assert.equal(normalizeNoonMode("inconnu"), "DA");
});

test("conserve les cinq derniers échanges complets", () => {
  const history = Array.from({ length: 14 }, (_, index) => ({ content: index }));
  assert.deepEqual(
    trimConversationHistory(history, 5).map((item) => item.content),
    [4, 5, 6, 7, 8, 9, 10, 11, 12, 13]
  );
});
