"use strict";

// V3-L2b — « Où j'en étais ? » : point de reprise assemblé localement, sans appel au modèle.
// Sources : session de conversation active (mode, résumé, questions ouvertes), Focus validé
// côté serveur et son état Git (lecture seule), prochaine action du projet, dernières notes
// capturées. Une source en panne est simplement omise.

const clip = (value, max) => { const text = String(value ?? "").replace(/\s+/g, " ").trim(); return text.length > max ? `${text.slice(0, max - 1)}…` : text; };

function pickProject(projects, focusName) {
  const list = Array.isArray(projects) ? projects : [];
  const wanted = String(focusName || "").trim().toLocaleLowerCase("fr-FR");
  const byFocus = wanted ? list.find((project) => String(project.name || "").trim().toLocaleLowerCase("fr-FR") === wanted) : null;
  if (byFocus) return byFocus;
  return list.filter((project) => project.status === "in_progress" && project.nextAction)
    .sort((a, b) => String(b.lastActivityAt || b.updatedAt || "").localeCompare(String(a.lastActivityAt || a.updatedAt || "")))[0] || null;
}

function deriveNextStep({ project, session, git, captures }) {
  if (project?.nextAction) return { text: clip(project.nextAction, 300), source: "project" };
  if (session?.openQuestions?.length) return { text: `Trancher : ${session.openQuestions[0]}`, source: "session" };
  if (git?.modified > 0) return { text: git.modified === 1 ? "Relire le 1 fichier modifié puis faire un commit ou l'écarter." : `Relire les ${git.modified} fichiers modifiés puis faire un commit ou les écarter.`, source: "git" };
  if (captures?.length) return { text: `Trier la note : « ${clip(captures.at(-1).text, 120)} »`, source: "capture" };
  return null;
}

function createResumeBriefingService({ getActiveSession, resolveFocus, inspectGit, listProjects, recentCaptures, now = () => new Date() } = {}) {
  const safe = async (fn, fallback) => { try { return (await fn()) ?? fallback; } catch { return fallback; } };

  async function build({ focusId = null, focusPath = null } = {}) {
    const rawSession = await safe(() => getActiveSession?.(), null);
    const session = rawSession ? {
      mode: rawSession.mode || null,
      lastActivityAt: rawSession.lastActivityAt || null,
      summary: clip(rawSession.conversationSummary?.text, 400) || null,
      openQuestions: (rawSession.conversationSummary?.openQuestions || []).slice(0, 3).map((item) => clip(item, 160)),
      currentTask: clip(rawSession.currentTaskRef?.label, 160) || null,
    } : null;
    const focus = focusId ? await safe(() => resolveFocus?.(focusId, focusPath), null) : null;
    const git = focus?.path ? await safe(() => inspectGit?.(focus.path), null) : null;
    const gitView = git?.available ? { branch: git.branch, modified: git.modified, untracked: git.untracked, ahead: git.ahead, lastCommit: git.lastCommit ? { subject: clip(git.lastCommit.subject, 160), date: git.lastCommit.date } : null } : null;
    const project = pickProject(await safe(() => listProjects?.(), []), focus?.name);
    const projectView = project ? { name: clip(project.name, 120), nextAction: clip(project.nextAction, 300) || null, lastOutcome: clip(project.lastOutcome, 300) || null, lastActivityAt: project.lastActivityAt || null } : null;
    const captures = (await safe(() => recentCaptures?.(3), [])).slice(0, 3).map((item) => ({ text: clip(item.text, 200), createdAt: item.createdAt || null }));
    const briefing = { generatedAt: now().toISOString(), session, focus: focus ? { name: clip(focus.name, 120), git: gitView } : null, project: projectView, captures };
    briefing.nextStep = deriveNextStep({ project: projectView, session, git: gitView, captures });
    return briefing;
  }

  return Object.freeze({ build });
}

const when = (iso, now) => {
  const time = Date.parse(iso || "");
  if (!Number.isFinite(time)) return null;
  const minutes = Math.round((now - time) / 60_000);
  if (minutes < 2) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `il y a ${hours} h`;
  return `il y a ${Math.round(hours / 24)} jours`;
};

// Texte destiné au chat : uniquement ce qui est connu, sans rien inventer.
function renderResumeBriefing(briefing, { now = Date.now() } = {}) {
  const lines = ["Voici où tu en étais :"];
  if (briefing.focus) {
    const git = briefing.focus.git;
    lines.push(`• Focus : ${briefing.focus.name}${git ? ` — branche ${git.branch}, ${git.modified} fichier${git.modified > 1 ? "s" : ""} modifié${git.modified > 1 ? "s" : ""}${git.untracked ? `, ${git.untracked} non suivi${git.untracked > 1 ? "s" : ""}` : ""}` : ""}.`);
    if (git?.lastCommit) lines.push(`• Dernier commit : « ${git.lastCommit.subject} »${when(git.lastCommit.date, now) ? ` (${when(git.lastCommit.date, now)})` : ""}.`);
  }
  if (briefing.project) {
    lines.push(`• Projet : ${briefing.project.name}${briefing.project.lastOutcome ? ` — dernier résultat : ${briefing.project.lastOutcome}` : ""}.`);
  }
  if (briefing.session) {
    if (briefing.session.summary) lines.push(`• Dernière conversation${when(briefing.session.lastActivityAt, now) ? ` (${when(briefing.session.lastActivityAt, now)})` : ""} : ${briefing.session.summary}`);
    if (briefing.session.currentTask) lines.push(`• Tâche en cours : ${briefing.session.currentTask}.`);
    for (const question of briefing.session.openQuestions) lines.push(`• Question ouverte : ${question}`);
  }
  if (briefing.captures.length) lines.push(`• Notes récentes : ${briefing.captures.map((item) => `« ${item.text} »`).join(", ")}.`);
  if (lines.length === 1) return "Je n'ai pas trouvé de travail en cours : aucun Focus actif, aucun projet avec une prochaine action, aucune note récente. Sur quoi veux-tu reprendre ?";
  lines.push(briefing.nextStep ? `\nProchain petit pas : ${briefing.nextStep.text}` : "\nJe n'ai pas de prochaine étape enregistrée : dis-moi par quoi tu veux reprendre.");
  return lines.join("\n");
}

module.exports = { createResumeBriefingService, deriveNextStep, pickProject, renderResumeBriefing };
