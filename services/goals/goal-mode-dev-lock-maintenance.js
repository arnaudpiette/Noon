"use strict";

/*
 * B3b — Maintenance du verrou DATA_DIRECTORY pour Goal Mode DEV.
 *
 * - startup() : acquisition avec reprise automatique stricte (même hostname
 *   + ESRCH, sous mutex de reprise), puis scan de réconciliation STARTUP si
 *   le verrou est obtenu. Sinon : audit RECONCILE_SCAN_SKIPPED_LOCK, aucun scan.
 * - inspect() : état du verrou pour l'affichage (aucune écriture).
 * - takeover() : reprise explicite (confirmée par l'utilisateur, détenteur
 *   attendu revérifié sous le mutex). Aucun scan automatique : l'UI propose
 *   « Réconcilier maintenant ».
 * - scanNow() : scan explicite, verrou exigé. Chaque réservation passe par la
 *   réconciliation EXPLICIT (dispatch en cours, délai de grâce « jamais
 *   lancée ») : un dispatch de ce processus peut être en vol, contrairement
 *   au démarrage.
 * Audit : événements et compteurs seulement, jamais de contenu.
 *
 * B4c — diagnostic du verrou dans un journal dédié (`diagnostics`), à part de
 * l'audit général limité à 500 entrées où les événements du démarrage
 * disparaissent en quelques minutes : `lock_acquire` à chaque démarrage,
 * `lock_inspect` seulement si l'état n'est pas HELD_BY_THIS, et copie des
 * reprises. Métadonnées seulement : jamais le jeton, le chemin ni le hostname.
 */

function httpError(code, statusCode, message) {
  return Object.assign(new Error(message), { code, statusCode });
}

function createGoalModeDevLockMaintenance({
  lock, runtime, audit = () => {}, diagnostics = () => {}, now = () => Date.now(), pid = process.pid,
} = {}) {
  if (typeof lock?.acquire !== "function" || typeof lock?.takeover !== "function" ||
    typeof lock?.inspect !== "function" || typeof lock?.isHeld !== "function") {
    throw new TypeError("Verrou DATA_DIRECTORY requis pour la maintenance.");
  }
  if (typeof runtime?.dispatchService?.reconcileAtStartup !== "function" ||
    typeof runtime?.dispatchService?.reconcileExecution !== "function" ||
    typeof runtime?.runStore?.listRunIds !== "function") {
    throw new TypeError("Runtime Goal Mode DEV requis pour la maintenance.");
  }

  function emit(event, metadata) {
    try { audit(`goals.mode-dev.${event}`, metadata); } catch {}
  }

  function previousPid(result) {
    return Number.isSafeInteger(result?.previous?.pid) ? result.previous.pid : null;
  }

  let startedAt = null;

  function diag(event, metadata) {
    try { diagnostics(`goals.mode-dev.${event}`, metadata); } catch {}
  }

  const integerOrNull = (value) => (Number.isSafeInteger(value) ? value : null);
  const booleanOrNull = (value) => (typeof value === "boolean" ? value : null);
  const codeOrNull = (value) => (typeof value === "string" && /^[A-Z0-9_]{1,40}$/.test(value) ? value : null);

  function startup() {
    startedAt = now();
    const result = lock.acquire({ autoTakeover: true });
    diag("lock_acquire", {
      reason: codeOrNull(result.reason),
      acquired: result.acquired === true,
      selfPid: integerOrNull(pid),
      holderPid: integerOrNull(result.holderPid) ?? previousPid(result),
      readError: codeOrNull(result.readError),
    });
    if (result.reason === "TAKEN_OVER") {
      const metadata = { mode: "AUTOMATIC", previousPid: previousPid(result), reason: "SAME_HOST_ESRCH" };
      emit("lock_takeover", metadata);
      diag("lock_takeover", metadata);
    }
    if (!result.acquired) {
      emit("RECONCILE_SCAN_SKIPPED_LOCK", { reason: result.reason });
      return Object.freeze({ lock: result.reason, scan: null });
    }
    try {
      const summary = runtime.dispatchService.reconcileAtStartup();
      emit("reconcile_scan", { ...summary, trigger: "STARTUP" });
      return Object.freeze({ lock: result.reason, scan: summary });
    } catch (error) {
      emit("reconcile_scan_failed", { code: String(error?.code || error?.name || "SCAN_FAILED").slice(0, 80) });
      return Object.freeze({ lock: result.reason, scan: null });
    }
  }

  function inspect() {
    const view = lock.inspect();
    if (view?.state !== "HELD_BY_THIS") {
      const diagnostic = view?.diagnostic || {};
      const elapsed = startedAt === null ? null : now() - startedAt;
      diag("lock_inspect", {
        state: codeOrNull(view?.state),
        read: codeOrNull(diagnostic.read),
        readError: codeOrNull(diagnostic.readError),
        tokenPresent: booleanOrNull(diagnostic.tokenPresent),
        tokenMatch: booleanOrNull(diagnostic.tokenMatch),
        pidMatch: booleanOrNull(diagnostic.pidMatch),
        sameHost: booleanOrNull(diagnostic.sameHost),
        holderIsSelf: diagnostic.pidMatch === true && diagnostic.sameHost === true,
        selfPid: integerOrNull(pid),
        holderPid: integerOrNull(view?.holderPid),
        sinceStartupMs: Number.isFinite(elapsed) ? Math.max(0, Math.round(elapsed)) : null,
      });
    }
    return view;
  }

  function takeover({ expectedHolderPid } = {}) {
    const result = lock.takeover({ expectedHolderPid });
    if (result.acquired) {
      if (result.reason === "TAKEN_OVER") {
        const metadata = { mode: "EXPLICIT", previousPid: previousPid(result), reason: "USER_CONFIRMED" };
        emit("lock_takeover", metadata);
        diag("lock_takeover", metadata);
      }
      return Object.freeze({
        acquired: true, reason: result.reason, previousPid: previousPid(result), reconcileRecommended: true,
      });
    }
    emit("lock_takeover_refused", { reason: result.reason });
    diag("lock_takeover_refused", { reason: codeOrNull(result.reason) });
    const statusCode = result.reason === "UNAVAILABLE" ? 503 : 409;
    throw httpError(`GOAL_MODE_DEV_LOCK_${result.reason}`, statusCode, "Reprise du verrou refusée.");
  }

  function scanNow() {
    if (lock.isHeld() !== true) {
      throw httpError("GOAL_MODE_DEV_RECONCILE_LOCK_REQUIRED", 409, "Verrou DATA_DIRECTORY requis pour le scan.");
    }
    const summary = { scanned: 0, reconciled: 0, unknown: 0, unchanged: 0, failed: 0 };
    for (const runId of runtime.runStore.listRunIds()) {
      let snapshot;
      try { snapshot = runtime.runStore.get(runId); } catch { summary.failed += 1; continue; }
      for (const record of snapshot.state.executionReservations || []) {
        if (record.status !== "MAY_HAVE_STARTED") continue;
        summary.scanned += 1;
        try {
          // Révision relue à chaque réservation (chaque transition l'incrémente).
          const expectedRevision = runtime.runStore.get(runId).revision;
          const result = runtime.dispatchService.reconcileExecution({
            runId, expectedRevision, reservationId: record.reservationId,
          });
          if (result.outcome === "RECONCILED") summary.reconciled += 1;
          else if (result.outcome === "UNKNOWN") summary.unknown += 1;
          else summary.unchanged += 1;
        } catch {
          summary.failed += 1;
        }
      }
    }
    emit("reconcile_scan", { ...summary, trigger: "EXPLICIT" });
    return Object.freeze(summary);
  }

  return Object.freeze({ inspect, scanNow, startup, takeover });
}

module.exports = { createGoalModeDevLockMaintenance };
