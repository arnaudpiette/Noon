#!/usr/bin/env node
"use strict";

// V3-L6 (G.5) — eval:life : tes vraies demandes, rejouées à chaque commit important.
//   npm run eval:life                       → état : nombre de cas, coût estimé ; aucun appel.
//   npm run eval:life -- --add              → ajouter un cas (demande, attendu, signaux d'échec).
//   npm run eval:life -- --run              → appels payants (store: false) ; réponses dans
//                                             .noon-evals/life/ (hors dépôt, hors app packagée).
//   npm run eval:life -- --grade <fichier>  → notation par toi, puis comparaison au passage précédent.
//   npm run eval:life -- --report <fichier>
// Options : --model <id> (défaut gpt-5.6-terra), --dials-file <character-preferences.json>,
// --cases <fichier> (défaut .noon-evals/life/cases.json).
// Seule la demande est envoyée, avec la personnalité et la charte : ni mémoire, ni historique,
// ni outils. Le test porte donc sur la réponse de base de Noon.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline/promises");
const { buildNoonSystemPrompt, setCharacterProvider } = require("../lib/noon-system-prompt");
const { normalizeDials, renderCharacterInstructions } = require("../services/character/character-charter");
const { estimateRunCost } = require("../services/character/character-eval");
const { estimateModelCost } = require("../services/observability/model-pricing");
const { CATEGORIES, MIN_CASES, addCase, buildRequest, compare, loadCases, score } = require("../services/evaluation/life-eval");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, ".noon-evals", "life");
const args = process.argv.slice(2);
const option = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : null; };
const model = option("--model") || "gpt-5.6-terra";
const casesFile = path.resolve(option("--cases") || path.join(OUT_DIR, "cases.json"));
const writePrivate = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); };

function readCases() {
  if (!fs.existsSync(casesFile)) return { raw: { version: 1, cases: [] }, ...loadCases({ cases: [] }) };
  const raw = JSON.parse(fs.readFileSync(casesFile, "utf8"));
  return { raw, ...loadCases(raw) };
}

function loadDials() {
  const explicit = option("--dials-file");
  const fallback = path.join(os.homedir(), "Library", "Application Support", "noon", "character-preferences.json");
  const file = explicit || (fs.existsSync(fallback) ? fallback : null);
  if (!file) return { dials: normalizeDials(null), source: "défauts de la charte" };
  return { dials: normalizeDials(JSON.parse(fs.readFileSync(file, "utf8")).dials), source: explicit ? file : "tes réglages Noon" };
}

function systemPrompt() {
  const { dials, source } = loadDials();
  setCharacterProvider(() => renderCharacterInstructions(dials));
  return { prompt: buildNoonSystemPrompt(), source };
}

function previousRun(excludeFile) {
  if (!fs.existsSync(OUT_DIR)) return null;
  const files = fs.readdirSync(OUT_DIR).filter((name) => /^run-.*\.json$/.test(name)).map((name) => path.join(OUT_DIR, name)).filter((file) => file !== excludeFile).sort();
  return files.length ? files.at(-1) : null;
}

function printReport(file) {
  const run = JSON.parse(fs.readFileSync(file, "utf8"));
  const result = score(run.results);
  console.log(`Notés : ${result.graded}/${result.total} · réussis : ${result.passed}${result.rate == null ? "" : ` · taux : ${(result.rate * 100).toFixed(1)} %`}`);
  const reference = previousRun(path.resolve(file));
  if (reference) {
    const diff = compare(JSON.parse(fs.readFileSync(reference, "utf8")), run);
    console.log(`Par rapport à ${path.basename(reference)} : ${diff.regressions.length} régression(s)${diff.regressions.length ? ` (${diff.regressions.join(", ")})` : ""}, ${diff.improvements.length} amélioration(s).`);
  }
}

async function status() {
  const { cases, invalid, ready } = readCases();
  const { prompt, source } = systemPrompt();
  console.log(`eval:life · ${cases.length} cas (${MIN_CASES} à 50 visés) · modèle ${model} · charte : ${source}`);
  console.log(`Fichier des cas : ${path.relative(ROOT, casesFile)} (hors dépôt, hors app packagée)`);
  if (invalid.length) console.log(`Cas ignorés car invalides : ${invalid.map((item) => item.id || "?").join(", ")}`);
  if (!cases.length) { console.log("Aucun cas. Ajoute tes vraies demandes : npm run eval:life -- --add"); return; }
  const estimate = estimateRunCost(cases.map((item) => ({ messages: [{ content: item.request }] })), { systemPrompt: prompt, model });
  if (estimate.priced) console.log(`Coût estimé d'un passage : ~${estimate.typicalUsd.toFixed(3)} USD (plafond ${estimate.ceilingUsd.toFixed(3)} USD)`);
  if (!ready) console.log(`Encore ${MIN_CASES - cases.length} cas avant le minimum de ${MIN_CASES}.`);
  console.log("Lancer un passage payant : npm run eval:life -- --run");
}

async function add() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const { raw } = readCases();
    console.log("Nouveau cas. Écris la demande telle que tu la ferais à Noon.");
    const request = await rl.question("Demande : ");
    const expected = await rl.question("Bonne réponse (ce qu'elle doit faire ou contenir) : ");
    const redFlags = (await rl.question("Signaux d'échec (séparés par « ; », facultatif) : ")).split(";");
    const category = (await rl.question(`Catégorie (${CATEGORIES.join(", ")}) : `)).trim().toLowerCase();
    const next = addCase(raw, { request, expected, redFlags, category });
    writePrivate(casesFile, next);
    console.log(`Ajouté : ${next.cases.at(-1).id} · ${next.cases.length} cas au total.`);
  } finally { rl.close(); }
}

async function run() {
  const { cases } = readCases();
  if (!cases.length) { console.error("Aucun cas : npm run eval:life -- --add"); process.exitCode = 1; return; }
  if (cases.length < MIN_CASES) console.log(`Attention : ${cases.length} cas seulement (minimum visé : ${MIN_CASES}).`);
  require("dotenv").config({ path: path.join(ROOT, ".env"), quiet: true });
  if (!process.env.OPENAI_API_KEY) { console.error("OPENAI_API_KEY absente : rien n'a été envoyé."); process.exitCode = 1; return; }
  const { prompt } = systemPrompt();
  const OpenAI = require("openai");
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const results = []; let total = 0;
  for (const testCase of cases) {
    process.stdout.write(`${testCase.id}… `);
    try {
      const response = await client.responses.create(buildRequest(testCase, { systemPrompt: prompt, model }));
      const cost = estimateModelCost("openai", model, response.usage || {});
      total += cost.total || 0;
      results.push({ id: testCase.id, category: testCase.category, response: String(response.output_text || ""), grade: null, note: "" });
      console.log("ok");
    } catch (error) {
      results.push({ id: testCase.id, category: testCase.category, response: "", error: String(error?.status || error?.code || "ERROR"), grade: null, note: "" });
      console.log(`échec (${error?.status || error?.code || "erreur"})`);
    }
  }
  const file = path.join(OUT_DIR, `run-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  const runData = { model, createdAt: new Date().toISOString(), costUsd: Number(total.toFixed(4)), results };
  const reference = previousRun(file);
  if (reference) {
    const { reusable } = compare(JSON.parse(fs.readFileSync(reference, "utf8")), runData);
    for (const item of reusable) Object.assign(runData.results.find((result) => result.id === item.id), { grade: item.grade, note: "note reprise (réponse identique)" });
    if (reusable.length) console.log(`${reusable.length} note(s) reprise(s) du passage précédent (réponse identique).`);
  }
  writePrivate(file, runData);
  console.log(`Coût réel : ${total.toFixed(4)} USD · réponses : ${path.relative(ROOT, file)}`);
  console.log(`Note-les : npm run eval:life -- --grade ${path.relative(ROOT, file)}`);
}

async function grade(file) {
  const runData = JSON.parse(fs.readFileSync(file, "utf8"));
  const byId = new Map(readCases().cases.map((testCase) => [testCase.id, testCase]));
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (const result of runData.results) {
      if (result.grade) continue;
      const testCase = byId.get(result.id);
      if (!testCase) continue;
      console.log(`\n━━ ${result.id} · ${testCase.category}`);
      console.log(`Toi : ${testCase.request}`);
      console.log(`\nNoon : ${result.response || `(aucune réponse : ${result.error})`}`);
      console.log(`\nAttendu : ${testCase.expected}`);
      if (testCase.redFlags.length) console.log(`Échec si : ${testCase.redFlags.join(" · ")}`);
      const answer = (await rl.question("Réussi (r), échoué (e), passer (p), quitter (q) ? ")).trim().toLowerCase();
      if (answer === "q") break;
      result.grade = answer === "r" ? "PASS" : answer === "e" ? "FAIL" : "SKIP";
      if (result.grade === "FAIL") result.note = (await rl.question("Note (facultatif) : ")).trim().slice(0, 500);
      writePrivate(file, runData);
    }
  } finally { rl.close(); }
  printReport(file);
}

(async () => {
  if (args.includes("--add")) return add();
  if (option("--grade")) return grade(option("--grade"));
  if (option("--report")) return printReport(option("--report"));
  if (args.includes("--run")) return run();
  return status();
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
