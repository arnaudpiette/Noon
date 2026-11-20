"use strict";

/*
 * 5.0D-4C-2 — Observation Native DEV pour la réconciliation Goal Mode.
 *
 * Lecture seule. Sources :
 * - ledger DEV : autorité des appels et du coût (entrées du taskId exact) ;
 * - journal Native DEV : autorité de l'état terminal et du démarrage
 *   (réservation de démarrage écrite avant tout await par la façade) ;
 * - résultat Native DEV en mémoire (fin de resume) : recoupement seulement.
 *
 * Verdicts depuis MAY_HAVE_STARTED : RECONCILE (comptabilité exacte, ou
 * prudente au coût estimé), UNKNOWN (issue incertaine), NONE (aucune
 * transition : en cours, illisible, garde-fou non satisfait).
 * La durée est rapportée, jamais persistée. Aucun contenu de tâche.
 */

const { TERMINAL_STATES } = require("../dev/dev-task-journal");

const NEVER_LAUNCHED_GRACE_MS = 2 * 60_000;
const BASIS = Object.freeze({
  ACTUAL: "ACTUAL",
  ESTIMATED_UPPER_BOUND: "ESTIMATED_UPPER_BOUND",
  NEVER_LAUNCHED: "NEVER_LAUNCHED",
});

function finite(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function durationOf(record) {
  const start = Date.parse(record?.createdAt);
  const end = Date.parse(record?.completedAt);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : null;
}

function createGoalModeDevObservationReader({
  devTaskJournal,
  devBudgetService,
  graceMs = NEVER_LAUNCHED_GRACE_MS,
} = {}) {
  if (typeof devTaskJournal?.lookup !== "function" || typeof devBudgetService?.entries !== "function" ||
      !Number.isSafeInteger(graceMs) || graceMs < 0) {
    throw new TypeError("Dépendances d'observation Goal Mode DEV requises.");
  }

  function journalState(taskId) {
    try { return devTaskJournal.lookup(taskId); } catch { return { status: "UNREADABLE" }; }
  }

  function ledgerEntries(taskId) {
    let entries;
    try { entries = devBudgetService.entries(); } catch { return null; }
    if (!Array.isArray(entries)) return null;
    return entries.filter((entry) => entry?.taskId === taskId && entry.status !== "RELEASED");
  }

  // Résumé sans contenu, pour le statut et l'audit.
  function summarize(binding) {
    const journal = journalState(binding.taskId);
    const entries = ledgerEntries(binding.taskId);
    const ledger = {};
    for (const entry of entries || []) ledger[entry.status] = (ledger[entry.status] || 0) + 1;
    return Object.freeze({
      journal: journal.status === "PRESENT"
        ? (TERMINAL_STATES.has(journal.record.state) ? "TERMINAL" : "NON_TERMINAL")
        : journal.status,
      ledger: entries === null ? null : Object.freeze(ledger),
      durationMs: journal.status === "PRESENT" ? durationOf(journal.record) : null,
    });
  }

  function verdict(decision, reason, extra = {}) {
    return Object.freeze({ decision, reason, ...extra });
  }

  /*
   * context : {
   *   trigger: "RESUME_END" | "STARTUP" | "EXPLICIT",
   *   inProgress: dispatch de cette réservation en cours dans ce processus,
   *   cancelRequested: arrêt demandé par cette instance,
   *   devResult: résultat Native DEV en mémoire (fin de resume) ou null,
   *   lockHeld: verrou exclusif DATA_DIRECTORY détenu par ce processus,
   *   now: horodatage courant (ms),
   * }
   */
  function observe({ binding, record, context = {} }) {
    const journal = journalState(binding.taskId);
    const entries = ledgerEntries(binding.taskId);
    const durationMs = journal.status === "PRESENT" ? durationOf(journal.record) : null;
    if (journal.status === "UNREADABLE" || journal.status === undefined) {
      return verdict("NONE", "JOURNAL_UNREADABLE");
    }
    if (entries === null) return verdict("NONE", "LEDGER_UNREADABLE");
    if (entries.some((entry) => entry.status === "RESERVED")) return verdict("NONE", "LEDGER_IN_PROGRESS");
    const providerCalls = entries.length;
    const exclusive = context.trigger === "RESUME_END" || context.trigger === "STARTUP" ||
      (context.trigger === "EXPLICIT" && context.lockHeld === true && context.inProgress !== true);

    if (journal.status === "PRESENT") {
      if (!TERMINAL_STATES.has(journal.record.state)) {
        if (context.inProgress === true) return verdict("NONE", "IN_PROGRESS");
        // Non terminal sans dispatch vivant : seulement avec garantie d'exclusivité.
        if (!exclusive) return verdict("NONE", "LOCK_NOT_HELD");
        return verdict("UNKNOWN", context.cancelRequested === true ? "CANCELLED" : "OUTCOME_UNCERTAIN", {
          observation: { stepEngaged: true, providerCalls, retries: 0, actualCost: null, accountedCost: null, accountingUnit: null },
          durationMs,
        });
      }
      // Recoupement avec le résultat en mémoire, s'il existe.
      const calls = context.devResult?.metrics?.providerCalls ?? context.devResult?.providerCalls;
      const reported = Array.isArray(calls) ? calls.length : null;
      if (reported !== null && reported !== providerCalls) {
        return verdict("UNKNOWN", "USAGE_INCOMPLETE", {
          observation: { stepEngaged: true, providerCalls, retries: 0, actualCost: null, accountedCost: null, accountingUnit: null },
          durationMs,
        });
      }
      const allActual = entries.every((entry) => entry.status === "RECONCILED" && finite(entry.actualCost) !== null);
      let accountedCost = 0;
      for (const entry of entries) {
        const cost = finite(entry.actualCost) ?? finite(entry.estimatedCost);
        if (cost === null) {
          return verdict("UNKNOWN", "USAGE_INCOMPLETE", {
            observation: { stepEngaged: true, providerCalls, retries: 0, actualCost: null, accountedCost: null, accountingUnit: null },
            durationMs,
          });
        }
        accountedCost += cost;
      }
      return verdict("RECONCILE", allActual ? "OBSERVED" : "ESTIMATED", {
        basis: allActual ? BASIS.ACTUAL : BASIS.ESTIMATED_UPPER_BOUND,
        observation: {
          stepEngaged: true, providerCalls, retries: 0,
          actualCost: allActual ? accountedCost : null, accountedCost, accountingUnit: "USD",
        },
        durationMs,
      });
    }

    // Journal ABSENT.
    if (providerCalls > 0) {
      if (!exclusive && context.inProgress === true) return verdict("NONE", "IN_PROGRESS");
      return verdict("UNKNOWN", "PERSISTENCE_UNCERTAIN", {
        observation: { stepEngaged: null, providerCalls, retries: null, actualCost: null, accountedCost: null, accountingUnit: null },
        durationMs: null,
      });
    }
    // « Jamais lancée » : la façade n'a pas atteint sa réservation de démarrage.
    if (context.trigger === "EXPLICIT") {
      if (context.inProgress === true) return verdict("NONE", "IN_PROGRESS");
      if (context.lockHeld !== true) return verdict("NONE", "LOCK_NOT_HELD");
      const startedAt = Date.parse(record?.mayHaveStartedAt);
      if (!Number.isFinite(startedAt) || !Number.isFinite(context.now) || context.now - startedAt < graceMs) {
        return verdict("NONE", "GRACE_PERIOD");
      }
    } else if (context.trigger !== "RESUME_END" && context.trigger !== "STARTUP") {
      return verdict("NONE", "TRIGGER_INVALID");
    }
    return verdict("RECONCILE", "NEVER_LAUNCHED", {
      basis: BASIS.NEVER_LAUNCHED,
      observation: { stepEngaged: false, providerCalls: 0, retries: 0, actualCost: 0, accountedCost: 0, accountingUnit: "USD" },
      durationMs: null,
    });
  }

  return Object.freeze({ observe, summarize });
}

/*
 * Relais synchrone entre le réconciliateur et le store : le store lit, au
 * moment de la transition, l'observation déposée pour cette réservation.
 */
function createGoalModeDevObservationBroker() {
  const pending = new Map();
  return Object.freeze({
    read(binding) {
      return pending.get(binding?.reservationId) ?? null;
    },
    withObservation(binding, observation, action) {
      pending.set(binding.reservationId, Object.freeze({
        runId: binding.runId, stepId: binding.stepId, taskId: binding.taskId,
        reservationId: binding.reservationId, terminal: true, complete: true, ...observation,
      }));
      try { return action(); } finally { pending.delete(binding.reservationId); }
    },
  });
}

module.exports = {
  BASIS,
  NEVER_LAUNCHED_GRACE_MS,
  createGoalModeDevObservationBroker,
  createGoalModeDevObservationReader,
};
