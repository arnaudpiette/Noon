"use strict";

// V3-L1 — logique pure d'eval:character : requêtes, estimation de coût, score.
// La notation est faite par Arnaud (jamais par un modèle juge seul) : réussi, échoué, passé.
const { estimateModelCost } = require("../observability/model-pricing");

const PASS_THRESHOLD = 0.9;
const MIN_GRADED = 30;
const DEFAULT_OUTPUT_TOKENS = 450;
const MAX_OUTPUT_TOKENS = 900;
const GRADES = Object.freeze(["PASS", "FAIL", "SKIP"]);

const roughTokens = (text) => Math.ceil(String(text || "").length / 4);

function buildRequest(testCase, { systemPrompt, model }) {
  return {
    model, store: false, max_output_tokens: MAX_OUTPUT_TOKENS,
    instructions: systemPrompt,
    input: testCase.messages.map((message) => ({ role: message.role, content: String(message.content) })),
  };
}

// Estimation prudente avant tout appel payant (affichée avant le lancement).
function estimateRunCost(cases, { systemPrompt, model }) {
  let inputTokens = 0;
  for (const testCase of cases) inputTokens += roughTokens(systemPrompt) + testCase.messages.reduce((sum, message) => sum + roughTokens(message.content), 0);
  const outputTokens = cases.length * DEFAULT_OUTPUT_TOKENS;
  const maxOutputTokens = cases.length * MAX_OUTPUT_TOKENS;
  const typical = estimateModelCost("openai", model, { input_tokens: inputTokens, output_tokens: outputTokens });
  const ceiling = estimateModelCost("openai", model, { input_tokens: inputTokens, output_tokens: maxOutputTokens });
  return { inputTokens, outputTokens, typicalUsd: typical.total, ceilingUsd: ceiling.total, priced: typical.status === "available" };
}

function score(results) {
  const graded = results.filter((result) => result.grade === "PASS" || result.grade === "FAIL");
  const passed = graded.filter((result) => result.grade === "PASS").length;
  const rate = graded.length ? passed / graded.length : 0;
  const byCategory = {};
  for (const result of graded) {
    const entry = byCategory[result.category] ||= { passed: 0, graded: 0 };
    entry.graded += 1; if (result.grade === "PASS") entry.passed += 1;
  }
  const verdict = graded.length < MIN_GRADED ? "INCOMPLETE" : rate >= PASS_THRESHOLD ? "PASS" : "FAIL";
  return { graded: graded.length, passed, rate, verdict, byCategory, threshold: PASS_THRESHOLD, minGraded: MIN_GRADED };
}

module.exports = { GRADES, MAX_OUTPUT_TOKENS, MIN_GRADED, PASS_THRESHOLD, buildRequest, estimateRunCost, score };
