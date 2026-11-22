#!/usr/bin/env node
"use strict";

// V3-L1 — eval:character (docs/ROADMAP.md §1.3).
//   npm run eval:character                     → simulation : cas, modèle, coût estimé ; aucun appel.
//   npm run eval:character -- --run            → appels payants au modèle (store: false), réponses
//                                                enregistrées dans .noon-evals/character/ (non versionné).
//   npm run eval:character -- --grade <fichier> → notation par Arnaud dans le terminal.
//   npm run eval:character -- --report <fichier>
// Options : --model <id> (défaut gpt-5.6-terra), --dials-file <character-preferences.json>.
// Seuls les 30 cas de test (inventés) sont envoyés : aucune mémoire ni donnée personnelle.
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline/promises");
const { CHARACTER_CASES } = require("../test/evals/character/character-cases");
const { buildNoonSystemPrompt, setCharacterProvider } = require("../lib/noon-system-prompt");
const { CHARTER_VERSION, normalizeDials, renderCharacterInstructions } = require("../services/character/character-charter");
const { buildRequest, estimateRunCost, score } = require("../services/character/character-eval");
const { estimateModelCost } = require("../services/observability/model-pricing");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, ".noon-evals", "character");
const args = process.argv.slice(2);
const option = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : null; };
const model = option("--model") || "gpt-5.6-terra";

function loadDials() {
  const file = option("--dials-file");
  if (!file) return { dials: normalizeDials(null), source: "défauts de la charte" };
  return { dials: normalizeDials(JSON.parse(fs.readFileSync(file, "utf8")).dials), source: file };
}

function systemPromptFor(dials) {
  setCharacterProvider(() => renderCharacterInstructions(dials));
  return buildNoonSystemPrompt();
}

function printScore(file) {
  const run = JSON.parse(fs.readFileSync(file, "utf8"));
  const result = score(run.results);
  console.log(`Notés : ${result.graded}/${run.results.length} · réussis : ${result.passed} · taux : ${(result.rate * 100).toFixed(1)} % · seuil ${result.threshold * 100} % sur ${result.minGraded} cas`);
  for (const [category, entry] of Object.entries(result.byCategory)) console.log(`  ${category.padEnd(11)} ${entry.passed}/${entry.graded}`);
  console.log(`Verdict : ${result.verdict}`);
  return result;
}

async function run() {
  const { dials, source } = loadDials();
  const systemPrompt = systemPromptFor(dials);
  const estimate = estimateRunCost(CHARACTER_CASES, { systemPrompt, model });
  console.log(`eval:character · charte ${CHARTER_VERSION} · ${CHARACTER_CASES.length} cas · modèle ${model}`);
  console.log(`Cadrans : ${JSON.stringify(dials)} (${source})`);
  console.log(estimate.priced
    ? `Coût estimé : ~${estimate.typicalUsd.toFixed(3)} USD (plafond ${estimate.ceilingUsd.toFixed(3)} USD) · ~${estimate.inputTokens} tokens en entrée`
    : `Coût non estimable : modèle ${model} absent de la table de prix.`);
  if (!args.includes("--run")) { console.log("Simulation seulement. Relance avec « -- --run » pour appeler le modèle."); return; }
  require("dotenv").config({ path: path.join(ROOT, ".env"), quiet: true });
  if (!process.env.OPENAI_API_KEY) { console.error("OPENAI_API_KEY absente : rien n'a été envoyé."); process.exitCode = 1; return; }
  const OpenAI = require("openai");
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const results = []; let total = 0;
  for (const testCase of CHARACTER_CASES) {
    process.stdout.write(`${testCase.id}… `);
    try {
      const response = await client.responses.create(buildRequest(testCase, { systemPrompt, model }));
      const cost = estimateModelCost("openai", model, response.usage || {});
      total += cost.total || 0;
      results.push({ id: testCase.id, category: testCase.category, response: String(response.output_text || ""), usage: response.usage || null, grade: null, note: "" });
      console.log("ok");
    } catch (error) {
      results.push({ id: testCase.id, category: testCase.category, response: "", error: String(error?.status || error?.code || "ERROR"), grade: null, note: "" });
      console.log(`échec (${error?.status || error?.code || "erreur"})`);
    }
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `run-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, `${JSON.stringify({ charterVersion: CHARTER_VERSION, model, dials, createdAt: new Date().toISOString(), costUsd: Number(total.toFixed(4)), results }, null, 2)}\n`);
  console.log(`Coût réel : ${total.toFixed(4)} USD · réponses : ${path.relative(ROOT, file)}`);
  console.log(`Note-les : npm run eval:character -- --grade ${path.relative(ROOT, file)}`);
}

async function grade(file) {
  const runData = JSON.parse(fs.readFileSync(file, "utf8"));
  const byId = new Map(CHARACTER_CASES.map((testCase) => [testCase.id, testCase]));
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (const result of runData.results) {
      if (result.grade) continue;
      const testCase = byId.get(result.id);
      console.log(`\n━━ ${result.id} · ${testCase.category} · ${testCase.title}`);
      for (const message of testCase.messages) console.log(`${message.role === "user" ? "Arnaud" : "Noon (avant)"} : ${message.content}`);
      console.log(`\nNoon : ${result.response || `(aucune réponse : ${result.error})`}`);
      console.log(`\nAttendu : ${testCase.expected}`);
      console.log(`Échec si : ${testCase.redFlags.join(" · ")}`);
      const answer = (await rl.question("Réussi (r), échoué (e), passer (p), quitter (q) ? ")).trim().toLowerCase();
      if (answer === "q") break;
      result.grade = answer === "r" ? "PASS" : answer === "e" ? "FAIL" : "SKIP";
      if (result.grade === "FAIL") result.note = (await rl.question("Note (facultatif) : ")).trim().slice(0, 500);
      fs.writeFileSync(file, `${JSON.stringify(runData, null, 2)}\n`);
    }
  } finally { rl.close(); }
  printScore(file);
}

(async () => {
  if (option("--grade")) return grade(option("--grade"));
  if (option("--report")) return printScore(option("--report"));
  return run();
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
