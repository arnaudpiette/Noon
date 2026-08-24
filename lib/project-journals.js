"use strict";

const fs = require("fs");
const crypto = require("crypto");

const PROJECT_STATES = new Set([
  "Non commencé", "En cours", "Bloqué", "À vérifier", "Terminé", "Archivé",
]);
const MAX_ITEMS = 60;
const MAX_SESSIONS = 100;
const MAX_TEXT = 2000;

function cleanText(value, max = MAX_TEXT) {
  const text = typeof value === "string" ? value.replace(/[\0\r]/g, " ").trim() : "";
  if (/\b(?:sk-[\w-]{12,}|OPENAI_API_KEY|BEGIN (?:RSA |EC )?PRIVATE KEY|\.env\b)/i.test(text)) {
    return "[information sensible masquée]";
  }
  return text.slice(0, max);
}

function cleanList(value, max = MAX_ITEMS) {
  const unique = new Map();
  for (const item of Array.isArray(value) ? value : []) {
    const text = cleanText(item, 500);
    if (text) unique.set(text.toLocaleLowerCase("fr"), text);
    if (unique.size >= max) break;
  }
  return [...unique.values()];
}

function emptyJournal(projectId, projectName = projectId) {
  return {
    projectId: cleanText(projectId, 120), projectName: cleanText(projectName, 150),
    objective: "", currentStatus: "Non commencé", completed: [], inProgress: [],
    nextActions: [], blockers: [], decisions: [], importantFiles: [],
    links: { github: null, figma: null, deployment: null },
    lastSessionSummary: "", lastSessionAt: null, updatedAt: null, sessions: [],
  };
}

function sanitizeSession(value = {}) {
  return {
    id: cleanText(value.id, 120) || crypto.randomUUID(),
    startedAt: value.startedAt || null,
    endedAt: value.endedAt || new Date().toISOString(),
    mode: value.mode === "DEV" ? "DEV" : "DA",
    summary: cleanText(value.summary), completed: cleanList(value.completed),
    decisions: cleanList(value.decisions), blockers: cleanList(value.blockers),
    nextAction: cleanText(value.nextAction, 500),
    filesMentioned: cleanList(value.filesMentioned),
    sourceConversationId: cleanText(value.sourceConversationId, 120),
  };
}

function sanitizeJournal(value = {}, projectId, projectName) {
  const base = emptyJournal(projectId, projectName);
  const status = PROJECT_STATES.has(value.currentStatus) ? value.currentStatus : base.currentStatus;
  const links = value.links || {};
  return {
    ...base,
    projectName: cleanText(value.projectName || projectName, 150),
    objective: cleanText(value.objective), currentStatus: status,
    completed: cleanList(value.completed), inProgress: cleanList(value.inProgress),
    nextActions: cleanList(value.nextActions), blockers: cleanList(value.blockers),
    decisions: cleanList(value.decisions), importantFiles: cleanList(value.importantFiles),
    links: {
      github: cleanText(links.github, 500) || null,
      figma: cleanText(links.figma, 500) || null,
      deployment: cleanText(links.deployment, 500) || null,
    },
    lastSessionSummary: cleanText(value.lastSessionSummary),
    lastSessionAt: value.lastSessionAt || null, updatedAt: value.updatedAt || null,
    sessions: (Array.isArray(value.sessions) ? value.sessions : [])
      .slice(-MAX_SESSIONS).map(sanitizeSession),
  };
}

function validateSessionSummary(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (typeof value.summary !== "string" || typeof value.nextAction !== "string") return null;
  for (const key of ["completed", "decisions", "inProgress", "blockers", "filesMentioned"]) {
    if (!Array.isArray(value[key]) || value[key].some((item) => typeof item !== "string")) return null;
  }
  return {
    summary: cleanText(value.summary), completed: cleanList(value.completed),
    decisions: cleanList(value.decisions), inProgress: cleanList(value.inProgress),
    blockers: cleanList(value.blockers), nextAction: cleanText(value.nextAction, 500),
    filesMentioned: cleanList(value.filesMentioned),
  };
}

function createProjectJournalStore({ filePath, backupPath = `${filePath}.bak` }) {
  let data = { version: 1, projects: {} };
  let saving = false;

  function parseFile(candidate) {
    const parsed = JSON.parse(fs.readFileSync(candidate, "utf8"));
    if (!parsed || parsed.version !== 1 || typeof parsed.projects !== "object") throw new Error("Schéma invalide");
    return { version: 1, projects: Object.fromEntries(Object.entries(parsed.projects)
      .map(([id, journal]) => [id, sanitizeJournal(journal, id, journal?.projectName || id)])) };
  }

  function loadProjectJournals() {
    for (const candidate of [filePath, backupPath]) {
      try { data = parseFile(candidate); return data; } catch { /* Essaie la sauvegarde. */ }
    }
    data = { version: 1, projects: {} };
    return data;
  }

  function saveProjectJournals() {
    if (saving) throw new Error("Une sauvegarde du journal est déjà en cours.");
    saving = true;
    const temporary = `${filePath}.tmp`;
    try {
      if (fs.existsSync(filePath)) fs.copyFileSync(filePath, backupPath);
      fs.writeFileSync(temporary, JSON.stringify(data, null, 2), { encoding: "utf8", mode: 0o600 });
      fs.renameSync(temporary, filePath);
    } finally {
      saving = false;
      try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch { /* Sans impact. */ }
    }
  }

  function getProjectJournal(projectId, projectName = projectId) {
    if (!data.projects[projectId]) data.projects[projectId] = emptyJournal(projectId, projectName);
    return structuredClone(data.projects[projectId]);
  }

  function updateProjectJournal(projectId, update, projectName = projectId) {
    const current = getProjectJournal(projectId, projectName);
    data.projects[projectId] = sanitizeJournal({ ...current, ...update, updatedAt: new Date().toISOString() }, projectId, projectName);
    saveProjectJournals();
    return getProjectJournal(projectId, projectName);
  }

  function appendProjectSession(projectId, session, projectName = projectId) {
    const current = getProjectJournal(projectId, projectName);
    const compact = sanitizeSession(session);
    const completedKeys = new Set(compact.completed.map((item) => item.toLocaleLowerCase("fr")));
    return updateProjectJournal(projectId, {
      ...current,
      completed: cleanList([...current.completed, ...compact.completed]),
      inProgress: cleanList([...(session.inProgress || []), ...current.inProgress]
        .filter((item) => !completedKeys.has(String(item).toLocaleLowerCase("fr")))),
      decisions: cleanList([...current.decisions, ...compact.decisions]),
      blockers: cleanList(compact.blockers),
      nextActions: cleanList(compact.nextAction ? [compact.nextAction, ...current.nextActions] : current.nextActions),
      importantFiles: cleanList([...current.importantFiles, ...compact.filesMentioned]),
      lastSessionSummary: compact.summary, lastSessionAt: compact.endedAt,
      sessions: [...current.sessions, compact].slice(-MAX_SESSIONS),
    }, projectName);
  }

  function buildCompactProjectContext(projectId) {
    const journal = data.projects[projectId];
    if (!journal) return "";
    return [
      `Projet actif : ${journal.projectName}`, `État : ${journal.currentStatus}`,
      `Dernière décision : ${journal.decisions.at(-1) || "aucune"}`,
      `Prochaine action : ${journal.nextActions[0] || "non définie"}`,
      `Blocage : ${journal.blockers[0] || "aucun"}`,
    ].join("\n").slice(0, 1600);
  }

  loadProjectJournals();
  return { loadProjectJournals, saveProjectJournals, getProjectJournal, updateProjectJournal, appendProjectSession, buildCompactProjectContext };
}

module.exports = { PROJECT_STATES, cleanText, cleanList, emptyJournal, sanitizeJournal, validateSessionSummary, createProjectJournalStore };
