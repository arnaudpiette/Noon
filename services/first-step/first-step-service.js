"use strict";

// V3-L2c — « Je dois faire X » → une seule première action de 2 à 5 minutes (C.3, docs/ROADMAP.md).
// Un appel unique à un petit modèle, avec la personnalité et la charte de caractère ; la
// réponse est validée strictement (JSON, durée 2–5 min, une seule action). Aucun repli
// inventé : si le modèle n'est pas joignable ou répond mal, l'erreur est dite telle quelle.
// L'enregistrement est local : prochaine action du projet du Focus, sinon note de la boîte
// de réception (tri du Brief).

const MAX_TASK = 500;
const MAX_STEP = 240;
const MAX_WHY = 240;

const clip = (value, max) => { const text = String(value ?? "").replace(/\s+/g, " ").trim(); return text.length > max ? `${text.slice(0, max - 1)}…` : text; };
const fail = (code, message, statusCode = 400) => Object.assign(new Error(message), { code, statusCode });

const TASK_INSTRUCTIONS = [
  "Tâche du moment : Arnaud te donne une chose qu'il doit faire. Propose UNE seule première action physique et concrète, faisable en 2 à 5 minutes, qui le met en mouvement (ouvrir, écrire une phrase, chercher un document, envoyer un message court…).",
  "Pas de plan, pas de liste, pas de conseil général. L'action commence par un verbe à l'impératif, tutoie Arnaud et tient en une phrase.",
  "Si la tâche est floue, choisis l'action qui la clarifie le plus vite (par exemple écrire en une ligne ce que « terminé » veut dire).",
  "Réponds uniquement par un objet JSON : {\"step\": \"…\", \"minutes\": 2 à 5, \"why\": \"pourquoi ce premier pas, en une phrase courte\"}.",
].join("\n");

function parseModelAnswer(raw) {
  const text = String(raw || "").trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw fail("FIRST_STEP_INVALID_ANSWER", "Le modèle n'a pas proposé de première action exploitable.", 502);
  let data;
  try { data = JSON.parse(match[0]); } catch { throw fail("FIRST_STEP_INVALID_ANSWER", "Le modèle n'a pas proposé de première action exploitable.", 502); }
  const step = clip(data?.step, MAX_STEP);
  const minutes = Number(data?.minutes);
  if (!step || step.split(/\s+/).length < 2) throw fail("FIRST_STEP_INVALID_ANSWER", "Le modèle n'a pas proposé de première action exploitable.", 502);
  if (!Number.isInteger(minutes) || minutes < 2 || minutes > 5) throw fail("FIRST_STEP_INVALID_ANSWER", "La première action proposée ne tenait pas en 2 à 5 minutes.", 502);
  return { step, minutes, why: clip(data?.why, MAX_WHY) || null };
}

function createFirstStepService({ generate, personality = () => "", listProjects, saveProject, capture, now = () => new Date() } = {}) {
  if (typeof generate !== "function") throw new TypeError("generate requis.");

  function cleanTask(task) {
    const text = clip(task, MAX_TASK + 1);
    if (!text) throw fail("FIRST_STEP_EMPTY", "Dis-moi ce que tu dois faire.");
    if (text.length > MAX_TASK) throw fail("FIRST_STEP_TOO_LONG", `Décris la tâche en ${MAX_TASK} caractères au plus.`);
    return text;
  }

  async function suggest({ task }) {
    const cleaned = cleanTask(task);
    let base;
    try { base = String(personality() || ""); } catch { base = ""; }
    const instructions = [base, TASK_INSTRUCTIONS].filter(Boolean).join("\n\n");
    const raw = await generate({ instructions, input: `Je dois : ${cleaned}` });
    return { task: cleaned, ...parseModelAnswer(raw), generatedAt: now().toISOString() };
  }

  // Projet du Focus uniquement (correspondance exacte du nom) ; jamais un projet deviné.
  async function save({ task, step, focusName = null }) {
    const cleanedTask = cleanTask(task);
    const cleanedStep = clip(step, MAX_STEP);
    if (!cleanedStep) throw fail("FIRST_STEP_EMPTY", "Aucune action à enregistrer.");
    const wanted = String(focusName || "").trim().toLocaleLowerCase("fr-FR");
    const projects = wanted && typeof listProjects === "function" ? (await listProjects()) || [] : [];
    const project = wanted ? projects.find((item) => String(item.name || "").trim().toLocaleLowerCase("fr-FR") === wanted) : null;
    if (project && typeof saveProject === "function") {
      await saveProject({ ...project, nextAction: cleanedStep, status: project.status === "todo" ? "in_progress" : project.status });
      return { savedTo: "project", projectName: clip(project.name, 120), step: cleanedStep };
    }
    if (typeof capture !== "function") throw fail("FIRST_STEP_SAVE_UNAVAILABLE", "Enregistrement indisponible.", 500);
    await capture({ text: clip(`Première action pour « ${cleanedTask} » : ${cleanedStep}`, 2000), origin: "chat" });
    return { savedTo: "inbox", projectName: null, step: cleanedStep };
  }

  return Object.freeze({ suggest, save });
}

function renderFirstStep(result) {
  const lines = [`**Premier pas (${result.minutes} min) :** ${result.step}`];
  if (result.why) lines.push(result.why);
  return lines.join("\n\n");
}

module.exports = { TASK_INSTRUCTIONS, createFirstStepService, parseModelAnswer, renderFirstStep };
