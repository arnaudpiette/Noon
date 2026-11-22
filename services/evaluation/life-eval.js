"use strict";

// V3-L6 (G.5) — eval:life : 30 à 50 demandes réelles d'Arnaud, rejouées à chaque commit important.
// Les cas vivent hors du dépôt et hors de l'app packagée (`.noon-evals/life/cases.json`).
// Notation par Arnaud (réussi / échoué / passé) ; la comparaison avec le passage précédent
// signale les régressions (réussi avant, échoué maintenant). Logique pure, sans réseau.

const MIN_CASES = 30;
const MAX_CASES = 50;
const MAX_TEXT = 4000;
const CATEGORIES = Object.freeze(["agenda", "rappels", "mails", "travail", "dev", "perso", "recherche", "autre"]);
const ID = /^L-\d{3}$/;

const clean = (value, max = MAX_TEXT) => String(value ?? "").replace(/\r\n?/g, "\n").trim().slice(0, max);

function validateCase(input) {
  const errors = [];
  const testCase = {
    id: String(input?.id || ""),
    category: CATEGORIES.includes(input?.category) ? input.category : "autre",
    request: clean(input?.request),
    expected: clean(input?.expected, 1000),
    redFlags: (Array.isArray(input?.redFlags) ? input.redFlags : []).map((item) => clean(item, 300)).filter(Boolean).slice(0, 8),
    addedAt: input?.addedAt || null,
  };
  if (!ID.test(testCase.id)) errors.push("id");
  if (testCase.request.length < 3) errors.push("request");
  if (testCase.expected.length < 3) errors.push("expected");
  return { testCase, errors };
}

function loadCases(raw) {
  const list = Array.isArray(raw?.cases) ? raw.cases : [];
  const cases = []; const invalid = []; const seen = new Set();
  for (const item of list) {
    const { testCase, errors } = validateCase(item);
    if (errors.length || seen.has(testCase.id)) { invalid.push({ id: testCase.id || null, errors: errors.length ? errors : ["duplicate"] }); continue; }
    seen.add(testCase.id); cases.push(testCase);
  }
  return { cases, invalid, ready: cases.length >= MIN_CASES };
}

function nextId(cases) {
  const max = cases.reduce((top, item) => Math.max(top, Number(String(item.id).slice(2)) || 0), 0);
  return `L-${String(max + 1).padStart(3, "0")}`;
}

function addCase(raw, input, { now = () => new Date() } = {}) {
  const { cases } = loadCases(raw);
  if (cases.length >= MAX_CASES) throw Object.assign(new Error(`${MAX_CASES} cas au plus.`), { code: "LIFE_EVAL_FULL" });
  const { testCase, errors } = validateCase({ ...input, id: nextId(cases), addedAt: now().toISOString() });
  if (errors.length) throw Object.assign(new Error(`Cas invalide : ${errors.join(", ")}.`), { code: "LIFE_EVAL_CASE_INVALID" });
  return { version: 1, cases: [...cases, testCase] };
}

function buildRequest(testCase, { systemPrompt, model, maxOutputTokens = 900 }) {
  return { model, store: false, max_output_tokens: maxOutputTokens, instructions: systemPrompt, input: [{ role: "user", content: testCase.request }] };
}

function score(results) {
  const graded = results.filter((item) => item.grade === "PASS" || item.grade === "FAIL");
  const passed = graded.filter((item) => item.grade === "PASS").length;
  return { graded: graded.length, passed, total: results.length, rate: graded.length ? passed / graded.length : null };
}

// Régressions : réussi au passage de référence, échoué maintenant. Réponse identique au caractère
// près → la note précédente peut être reprise sans relecture.
function compare(previous, current) {
  const before = new Map((previous?.results || []).map((item) => [item.id, item]));
  const regressions = []; const improvements = []; const reusable = [];
  for (const item of current?.results || []) {
    const old = before.get(item.id);
    if (!old) continue;
    if (old.grade === "PASS" && item.grade === "FAIL") regressions.push(item.id);
    if (old.grade === "FAIL" && item.grade === "PASS") improvements.push(item.id);
    if (!item.grade && old.grade && old.response && old.response === item.response) reusable.push({ id: item.id, grade: old.grade });
  }
  return { regressions, improvements, reusable };
}

module.exports = { CATEGORIES, MAX_CASES, MIN_CASES, addCase, buildRequest, compare, loadCases, nextId, score, validateCase };
