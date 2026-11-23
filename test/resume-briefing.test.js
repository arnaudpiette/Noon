"use strict";
const { readServerSource } = require("./helpers/server-source");
const { readAppSource } = require("./helpers/app-source");

// V3-L2b — « Où j'en étais ? » : assemblage local, prochain pas, rendu honnête, câblage.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createResumeBriefingService, deriveNextStep, pickProject, renderResumeBriefing } = require("../services/resume/resume-briefing-service");
const { isResumeCommand } = require("../public/ui-utils");
const { parseNoonDeepLink } = require("../electron/app-core");

const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", ...parts), "utf8");
const NOW = Date.parse("2026-11-22T10:00:00Z");

function service(overrides = {}) {
  const calls = { resolveFocus: [], inspectGit: [] };
  const deps = {
    getActiveSession: () => ({ mode: "DEV", lastActivityAt: "2026-11-22T08:00:00Z", conversationSummary: { text: "On a branché la capture rapide.", openQuestions: ["Faut-il garder Ctrl+Option+C ?"] }, currentTaskRef: { label: "Tester la capture" } }),
    resolveFocus: (id, focusPath) => { calls.resolveFocus.push([id, focusPath]); return id === "noon" ? { name: "Noon", path: "/Users/x/Noon" } : null; },
    inspectGit: (projectPath) => { calls.inspectGit.push(projectPath); return { available: true, branch: "v2/multi-provider", modified: 3, untracked: 1, ahead: 0, lastCommit: { subject: "feat(capture): quick capture", date: "2026-11-22T09:30:00Z" } }; },
    listProjects: () => [
      { name: "Kasa", status: "in_progress", nextAction: "Envoyer la maquette mobile", lastActivityAt: "2026-11-20T10:00:00Z" },
      { name: "Noon", status: "in_progress", nextAction: "Essayer ⌃⌥C dans l'app", lastOutcome: "Capture livrée", lastActivityAt: "2026-11-21T10:00:00Z" },
    ],
    recentCaptures: () => [{ text: "acheter du pain", createdAt: "2026-11-22T09:00:00Z" }],
    now: () => new Date(NOW),
    ...overrides,
  };
  return { svc: createResumeBriefingService(deps), calls };
}

test("assemblage : Focus validé côté serveur, Git du Focus, projet du Focus, notes, prochain pas", async () => {
  const { svc, calls } = service();
  const briefing = await svc.build({ focusId: "noon", focusPath: "/Users/x/Noon" });
  assert.deepEqual(calls.resolveFocus, [["noon", "/Users/x/Noon"]]);
  assert.deepEqual(calls.inspectGit, ["/Users/x/Noon"]);
  assert.equal(briefing.focus.name, "Noon");
  assert.equal(briefing.focus.git.modified, 3);
  assert.equal(briefing.project.name, "Noon", "le projet du Focus l'emporte");
  assert.deepEqual(briefing.nextStep, { text: "Essayer ⌃⌥C dans l'app", source: "project" });
  const text = renderResumeBriefing(briefing, { now: NOW });
  for (const fragment of ["Focus : Noon — branche v2/multi-provider, 3 fichiers modifiés, 1 non suivi", "Dernier commit : « feat(capture): quick capture » (il y a 30 min)", "Dernière conversation (il y a 2 h)", "Question ouverte : Faut-il garder", "« acheter du pain »", "Prochain petit pas : Essayer ⌃⌥C dans l'app"]) assert.ok(text.includes(fragment), fragment);
});

test("Focus refusé par le serveur : aucun accès Git ; sources en panne ignorées", async () => {
  const { svc, calls } = service({ getActiveSession: () => { throw new Error("panne"); }, recentCaptures: () => { throw new Error("panne"); } });
  const briefing = await svc.build({ focusId: "inconnu", focusPath: "/etc" });
  assert.equal(briefing.focus, null);
  assert.equal(calls.inspectGit.length, 0);
  assert.equal(briefing.session, null);
  assert.deepEqual(briefing.captures, []);
  assert.equal(briefing.project.name, "Noon", "sans Focus : projet actif le plus récent");
});

test("prochain pas : projet, puis question ouverte, puis fichiers modifiés, puis note à trier", () => {
  assert.equal(deriveNextStep({ project: { nextAction: "A" } }).source, "project");
  assert.equal(deriveNextStep({ project: null, session: { openQuestions: ["Q ?"] } }).text, "Trancher : Q ?");
  assert.match(deriveNextStep({ git: { modified: 1 } }).text, /^Relire le 1 fichier modifié/);
  assert.equal(deriveNextStep({ captures: [{ text: "pain" }] }).source, "capture");
  assert.equal(deriveNextStep({}), null);
  assert.equal(pickProject([{ name: "A", status: "todo", nextAction: "x" }], null), null, "un projet à faire sans activité n'est pas « en cours »");
});

test("rendu : rien d'inventé quand rien n'est connu", async () => {
  const { svc } = service({ getActiveSession: () => null, listProjects: () => [], recentCaptures: () => [] });
  const text = renderResumeBriefing(await svc.build({}), { now: NOW });
  assert.match(text, /^Je n'ai pas trouvé de travail en cours/);
});

test("commande et câblage : repérage strict, route locale, lien profond et barre de menus", () => {
  for (const input of ["Où j'en étais ?", "ou j'en etais", "Noon, où j’en étais ?", "on en était où ?", "je reprends", "Où en suis-je ?"]) assert.equal(isResumeCommand(input), true, input);
  for (const input of ["Où est le fichier ?", "je reprends le dessin demain", "", null]) assert.equal(isResumeCommand(input), false, String(input));
  assert.deepEqual(parseNoonDeepLink("noon://resume"), { action: "resume" });
  const server = readServerSource();
  assert.match(server, /resolveFocus: \(focusId, focusPath\) => resolveFocusCatalogSelection\(focusId, focusPath\)/);
  assert.match(server, /req\.url === "\/resume" \|\| req\.url\.startsWith\("\/resume\?"\)/);
  const app = readAppSource();
  assert.ok(app.indexOf("isResumeCommand(question)") < app.indexOf('const response = await fetch("/ai/stream"'), "traité avant tout appel au modèle");
  assert.match(read("electron", "main.js"), /\{ label: "Où j'en étais \?", click: \(\) => dispatchDeepLink\("noon:\/\/resume"\) \}/);
});
