"use strict";

// V3-L2c — « Je dois faire X » → une première action de 2 à 5 minutes.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createFirstStepService, parseModelAnswer, renderFirstStep } = require("../services/first-step/first-step-service");
const { parseFirstStepCommand } = require("../public/ui-utils");

const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", ...parts), "utf8");

test("parseFirstStepCommand reconnaît « je dois faire X » et ignore les questions et phrases sans verbe d'action", () => {
  assert.deepEqual(parseFirstStepCommand("Je dois faire ma déclaration d'impôts"), { task: "faire ma déclaration d'impôts" });
  assert.deepEqual(parseFirstStepCommand("il faut que je finisse le rapport Kasa."), { task: "finir le rapport Kasa" });
  assert.deepEqual(parseFirstStepCommand("Noon, je dois m’occuper de la chaudière"), { task: "m'occuper de la chaudière" });
  assert.deepEqual(parseFirstStepCommand("faut que je commence le dossier"), { task: "commencer le dossier" });
  for (const text of ["je dois faire quoi ?", "je dois partir à 18h", "je dois faire ça", "Comment je dois faire ma déclaration ?", "Note ça : je dois faire X", ""]) {
    assert.equal(parseFirstStepCommand(text), null, text);
  }
});

test("parseModelAnswer exige une action unique de 2 à 5 minutes en JSON", () => {
  assert.deepEqual(parseModelAnswer('```json\n{"step":"Ouvre le site des impôts et connecte-toi.","minutes":3,"why":"Entrer dans l\'espace lève le premier blocage."}\n```'),
    { step: "Ouvre le site des impôts et connecte-toi.", minutes: 3, why: "Entrer dans l'espace lève le premier blocage." });
  for (const raw of ["Commence par t'organiser.", '{"step":"Ouvre le dossier","minutes":15}', '{"step":"Ouvre","minutes":3}', '{"step":"Ouvre le dossier","minutes":2.5}', "{oops}"]) {
    assert.throws(() => parseModelAnswer(raw), (error) => error.code === "FIRST_STEP_INVALID_ANSWER", raw);
  }
});

test("suggest envoie la personnalité + la consigne et seulement la tâche, puis valide la réponse", async () => {
  const calls = [];
  const service = createFirstStepService({
    personality: () => "PERSONNALITÉ ET CHARTE",
    generate: async (request) => { calls.push(request); return '{"step":"Écris en une ligne ce que « rapport terminé » veut dire.","minutes":2,"why":"La tâche est floue."}'; },
    now: () => new Date("2026-11-22T10:00:00Z"),
  });
  const result = await service.suggest({ task: "  finir   le rapport  " });
  assert.equal(calls.length, 1);
  assert.match(calls[0].instructions, /^PERSONNALITÉ ET CHARTE\n\n/);
  assert.match(calls[0].instructions, /2 à 5 minutes/);
  assert.equal(calls[0].input, "Je dois : finir le rapport");
  assert.equal(result.minutes, 2);
  assert.equal(result.task, "finir le rapport");
  assert.equal(renderFirstStep(result), "**Premier pas (2 min) :** Écris en une ligne ce que « rapport terminé » veut dire.\n\nLa tâche est floue.");
  await assert.rejects(service.suggest({ task: "   " }), (error) => error.code === "FIRST_STEP_EMPTY");
  await assert.rejects(service.suggest({ task: "x".repeat(501) }), (error) => error.code === "FIRST_STEP_TOO_LONG");
  const failing = createFirstStepService({ generate: async () => { throw Object.assign(new Error("Clé OpenAI absente."), { statusCode: 503 }); } });
  await assert.rejects(failing.suggest({ task: "finir le rapport" }), /Clé OpenAI absente/);
});

test("save : prochaine action du projet du Focus (nom exact), sinon boîte de réception ; jamais un projet deviné", async () => {
  const projects = [{ id: "p1", name: "Kasa", status: "todo", nextAction: null }, { id: "p2", name: "Noon", status: "in_progress", nextAction: "Ancienne" }];
  const saved = []; const captured = [];
  const service = createFirstStepService({
    generate: async () => "",
    listProjects: () => projects,
    saveProject: (project) => saved.push(project),
    capture: (item) => captured.push(item),
  });
  assert.deepEqual(await service.save({ task: "finir le rapport", step: "Ouvre le rapport.", focusName: "kasa" }), { savedTo: "project", projectName: "Kasa", step: "Ouvre le rapport." });
  assert.equal(saved[0].nextAction, "Ouvre le rapport.");
  assert.equal(saved[0].status, "in_progress");
  assert.deepEqual(await service.save({ task: "finir le rapport", step: "Ouvre le rapport.", focusName: null }), { savedTo: "inbox", projectName: null, step: "Ouvre le rapport." });
  assert.deepEqual(captured[0], { text: "Première action pour « finir le rapport » : Ouvre le rapport.", origin: "chat" });
  await service.save({ task: "finir le rapport", step: "Ouvre le rapport.", focusName: "Inconnu" });
  assert.equal(saved.length, 1, "un Focus sans projet correspondant ne modifie aucun projet");
  await assert.rejects(service.save({ task: "x", step: " ", focusName: null }), (error) => error.code === "FIRST_STEP_EMPTY");
});

test("câblage : routes protégées par l'en-tête Noon, petit modèle, store:false, local-only respecté, interception avant le modèle", () => {
  const server = read("server.js");
  assert.match(server, /FIRST_STEP_MODEL = "gpt-5\.6-luna"/);
  assert.match(server, /store: false, max_output_tokens: 400/);
  assert.match(server, /state === "LOCAL_ONLY"[\s\S]{0,200}FIRST_STEP_REMOTE_FORBIDDEN/);
  assert.match(server, /req\.url === "\/first-step" \|\| req\.url === "\/first-step\/save"[\s\S]{0,200}x-noon-request/);
  const app = read("public", "app.js");
  const send = app.slice(app.indexOf("async function sendQuestion("));
  assert.ok(send.indexOf("parseFirstStepCommand(question)") > 0 && send.indexOf("parseFirstStepCommand(question)") < send.indexOf("shouldSuggestWebSearch(question)"));
});
