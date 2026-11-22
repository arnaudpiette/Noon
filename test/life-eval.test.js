"use strict";

// V3-L6 (G.5) — eval:life : cas validés, ajout numéroté, comparaison (régressions, notes reprises),
// cas privés exclus du dépôt et de l'app packagée.
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { MAX_CASES, addCase, buildRequest, compare, loadCases, score } = require("../services/evaluation/life-eval");

const sample = (n) => ({ request: `Demande inventée ${n}`, expected: "Une réponse courte et juste.", redFlags: ["invente une info ; "], category: "agenda" });

test("ajout : identifiants L-001…, validation, plafond de 50 cas", () => {
  let raw = { cases: [] };
  raw = addCase(raw, sample(1), { now: () => new Date("2026-11-22T10:00:00Z") });
  raw = addCase(raw, { ...sample(2), category: "inconnue" });
  assert.deepEqual(raw.cases.map((item) => [item.id, item.category]), [["L-001", "agenda"], ["L-002", "autre"]]);
  assert.equal(raw.cases[0].addedAt, "2026-11-22T10:00:00.000Z");
  assert.throws(() => addCase(raw, { request: "", expected: "x" }), (error) => error.code === "LIFE_EVAL_CASE_INVALID");
  let full = { cases: [] };
  for (let index = 0; index < MAX_CASES; index += 1) full = addCase(full, sample(index));
  assert.throws(() => addCase(full, sample(99)), (error) => error.code === "LIFE_EVAL_FULL");
});

test("chargement : cas invalides ou dupliqués écartés ; prêt à partir de 30", () => {
  const { cases, invalid, ready } = loadCases({ cases: [{ id: "L-001", request: "abc", expected: "def" }, { id: "L-001", request: "abc", expected: "def" }, { id: "X", request: "abc", expected: "def" }] });
  assert.equal(cases.length, 1);
  assert.deepEqual(invalid.map((item) => item.errors), [["duplicate"], ["id"]]);
  assert.equal(ready, false);
  assert.equal(loadCases({ cases: Array.from({ length: 30 }, (_, index) => ({ id: `L-${String(index + 1).padStart(3, "0")}`, request: "abc", expected: "def" })) }).ready, true);
});

test("requête : seule la demande est envoyée, store false", () => {
  const request = buildRequest({ request: "Qu'est-ce que j'ai demain ?" }, { systemPrompt: "Tu es Noon.", model: "gpt-5.6-terra" });
  assert.deepEqual(request, { model: "gpt-5.6-terra", store: false, max_output_tokens: 900, instructions: "Tu es Noon.", input: [{ role: "user", content: "Qu'est-ce que j'ai demain ?" }] });
});

test("comparaison : régressions, améliorations, notes reprises si réponse identique", () => {
  const before = { results: [{ id: "L-001", grade: "PASS", response: "a" }, { id: "L-002", grade: "FAIL", response: "b" }, { id: "L-003", grade: "PASS", response: "c" }] };
  const after = { results: [{ id: "L-001", grade: "FAIL", response: "a2" }, { id: "L-002", grade: "PASS", response: "b2" }, { id: "L-003", grade: null, response: "c" }] };
  assert.deepEqual(compare(before, after), { regressions: ["L-001"], improvements: ["L-002"], reusable: [{ id: "L-003", grade: "PASS" }] });
  assert.deepEqual(score(after.results), { graded: 2, passed: 1, total: 3, rate: 0.5 });
  assert.equal(score([]).rate, null);
});

test("script : état sans appel réseau ; cas privés exclus du dépôt et du packaging", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "noon-life-"));
  const file = path.join(dir, "cases.json");
  fs.writeFileSync(file, JSON.stringify(addCase({ cases: [] }, sample(1))));
  const dials = path.join(dir, "character-preferences.json");
  fs.writeFileSync(dials, JSON.stringify({ dials: {} }));
  const output = execFileSync(process.execPath, [path.join(__dirname, "..", "scripts", "eval-life.js"), "--cases", file, "--dials-file", dials], { encoding: "utf8", env: { ...process.env, OPENAI_API_KEY: "" } });
  assert.match(output, /eval:life · 1 cas/);
  assert.match(output, /Encore 29 cas avant le minimum de 30/);
  assert.match(fs.readFileSync(path.join(__dirname, "..", ".gitignore"), "utf8"), /^\.noon-evals\/$/m);
  const { packagerConfig } = require("../forge.config");
  assert.ok(packagerConfig.ignore.some((pattern) => pattern.test("/.noon-evals/life/cases.json")), "cas exclus de Noon.app");
});
