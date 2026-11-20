"use strict";

/*
 * Branchement B1 — signalement des tâches Native DEV interrompues au
 * démarrage. Audit sans contenu (compteurs seulement), aucune action :
 * chaque tâche interrompue exige une décision utilisateur.
 */

function errorCode(error) {
  return String(error?.code || error?.name || "SCAN_FAILED").slice(0, 80);
}

function reportInterruptedNativeDevTasks({ sources = [], audit } = {}) {
  if (typeof audit !== "function") throw new TypeError("Audit requis.");
  const summary = [];
  for (const source of sources) {
    const name = String(source?.name || "unknown").slice(0, 40);
    try {
      const items = typeof source?.recover === "function" ? source.recover() : [];
      const list = Array.isArray(items) ? items : [];
      const entry = Object.freeze({
        source: name,
        interrupted: list.filter((item) => typeof item?.taskId === "string" && item.taskId).length,
        unreadable: list.filter((item) => item?.status === "JOURNAL_UNREADABLE").length,
        requiresUserDecision: list.length > 0,
      });
      summary.push(entry);
      audit("dev.native_interrupted_at_startup", { ...entry });
    } catch (error) {
      const entry = Object.freeze({ source: name, failed: true, code: errorCode(error) });
      summary.push(entry);
      audit("dev.native_interrupted_scan_failed", { ...entry });
    }
  }
  return Object.freeze(summary);
}

module.exports = { reportInterruptedNativeDevTasks };
