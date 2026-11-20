"use strict";

/*
 * B3a — UI Goal Mode DEV : panneau, carte d'approbation dédiée, résultat de
 * réconciliation et contrôles du run.
 *
 * Règles :
 * - tout l'affichage passe par textContent, jamais innerHTML (la consigne et
 *   les règles projet peuvent contenir du HTML) ;
 * - le jeton de reprise reste en mémoire dans le contrôleur (Map), jamais
 *   dans localStorage, sessionStorage, un cookie, le DOM ni la console ;
 * - decision toujours explicite ; Planifier exige une confirmation qui
 *   affiche le coût maximal estimé de l'appel de planning ;
 * - resume est synchrone ; le statut est suivi toutes les 3 s jusqu'à la fin
 *   ou jusqu'à maxDuration du contrat + 2 min, puis « suivi arrêté ».
 */
(function attachGoalModeDevUi(global) {
  const PREFIX = "/api/goals/mode-dev/";
  const POLL_INTERVAL_MS = 3_000;
  const POLL_GRACE_MS = 2 * 60_000;
  const OPEN_RESERVATION_STATUSES = ["PREPARED", "MAY_HAVE_STARTED"];

  const ERROR_MESSAGES = Object.freeze({
    GOAL_MODE_DEV_LOCAL_ONLY_REQUIRED: "Ce Goal ou vos préférences imposent un traitement local : Goal Mode DEV distant indisponible.",
    approval_expired: "Approbation expirée : renouvelez-la.",
    APPROVAL_CONSUMED: "Cette approbation a déjà été utilisée.",
    APPROVAL_INVALID: "Cette approbation n'est plus active.",
    APPROVAL_TOKEN_INVALID: "Approbation inconnue de cette session : renouvelez-la.",
    GOAL_MODE_DEV_DISPATCH_TICKET_UNKNOWN: "Réservation inconnue de cette session Noon (redémarrage ?).",
    GOAL_MODE_DEV_DISPATCH_RULES_CHANGED: "Les règles projet ont changé depuis l'approbation.",
    GOAL_MODE_DEV_DISPATCH_TARGET_CHANGED: "Le repository a changé depuis la préparation.",
    GOAL_MODE_DEV_DISPATCH_PERMISSION_REVOKED: "Une permission requise a été retirée.",
    GOAL_MODE_DEV_DISPATCH_BUDGET_EXHAUSTED: "Budget DEV insuffisant.",
    GOAL_MODE_DEV_DISPATCH_GOAL_STALE: "Le Goal a changé (pause, archivage ou nouvelle version).",
    GOAL_MODE_DEV_DISPATCH_OUTCOME_UNCERTAIN: "Issue DEV incertaine : réconciliation requise.",
    GOAL_MODE_EXECUTION_UNKNOWN_BLOCKED: "Une issue DEV incertaine bloque ce run.",
    GOAL_MODE_EXECUTION_IN_FLIGHT: "Une réservation DEV est déjà en cours sur ce run.",
    GOAL_MODE_RUN_PERSISTENCE_CONFLICT: "Le run a changé entre-temps : actualisez.",
    approval_stale: "L'état a changé depuis l'approbation : renouvelez-la.",
    // B3b : verrou des données.
    GOAL_MODE_DEV_LOCK_HOLDER_ALIVE: "Une autre instance de Noon utilise ces données sur ce Mac : quittez-la d'abord.",
    GOAL_MODE_DEV_LOCK_HOLDER_UNVERIFIED: "Impossible de vérifier le détenteur du verrou : reprise refusée.",
    GOAL_MODE_DEV_LOCK_EXPECTED_HOLDER_MISMATCH: "Le détenteur du verrou a changé : actualisez l'état.",
    GOAL_MODE_DEV_LOCK_TAKEOVER_CHANGED: "Le verrou a changé pendant la reprise : actualisez l'état.",
    GOAL_MODE_DEV_LOCK_TAKEOVER_BUSY: "Une reprise du verrou est déjà en cours.",
    GOAL_MODE_DEV_LOCK_HELD: "Le verrou a été obtenu par une autre instance.",
    GOAL_MODE_DEV_RECONCILE_LOCK_REQUIRED: "Verrou des données requis : reprenez-le d'abord.",
  });

  const LOCK_LABELS = Object.freeze({
    HELD_BY_THIS: "Verrou des données détenu par cette instance.",
    ABSENT: "Aucun verrou des données (scan de démarrage non exécuté).",
    STALE: "Verrou périmé : son processus a disparu.",
    FOREIGN_HOST: "Verrou posé depuis une autre machine (ou un autre nom de Mac).",
    UNREADABLE: "Verrou illisible.",
    HELD: "Verrou détenu par une autre instance de Noon sur ce Mac : quittez-la pour le libérer.",
    UNVERIFIED: "État du détenteur du verrou indéterminé.",
  });

  const BASIS_LABELS = Object.freeze({
    ACTUAL: "coût réel",
    ESTIMATED_UPPER_BOUND: "coût estimé (borne haute)",
    NEVER_LAUNCHED: "jamais lancée — rien consommé",
  });

  function messageFor(code) {
    if (typeof code !== "string" || !code) return "Opération Goal Mode DEV refusée.";
    return ERROR_MESSAGES[code] || `Opération refusée (${code}).`;
  }

  function createGoalModeDevApi({ fetchImpl } = {}) {
    if (typeof fetchImpl !== "function") throw new TypeError("fetch requis.");
    async function call(method, route, body) {
      const url = route.startsWith("/") ? route : `${PREFIX}${route}`;
      let response;
      try {
        response = await fetchImpl(url, {
          method,
          cache: "no-store",
          headers: { "Content-Type": "application/json", "X-Noon-Request": "1" },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch {
        return { ok: false, status: 0, code: "NETWORK_UNAVAILABLE", body: null };
      }
      let json = null;
      try { json = await response.json(); } catch { json = null; }
      if (response.ok) return { ok: true, status: response.status, body: json?.result ?? json };
      return { ok: false, status: response.status, code: json?.code || null, body: json };
    }
    return Object.freeze({
      get: (route) => call("GET", route),
      post: (route, body) => call("POST", route, body),
    });
  }

  function createGoalModeDevController({
    elements,
    api,
    confirmAction = (message) => global.confirm(message),
    setTimer = (fn, ms) => global.setInterval(fn, ms),
    clearTimer = (handle) => global.clearInterval(handle),
    now = () => Date.now(),
  } = {}) {
    if (!elements?.root || typeof api?.get !== "function" || typeof api?.post !== "function") {
      throw new TypeError("Éléments et API Goal Mode DEV requis.");
    }
    const document = global.document;
    const root = elements.root;
    // Jetons en mémoire seulement : approvalId → { token, reservationId, runId }.
    const tokens = new Map();
    const pending = new Set();
    let pollHandle = null;
    let enabled = false;

    const region = (name) => {
      const node = document.createElement("div");
      node.className = `goal-mode-dev__${name}`;
      return node;
    };
    const formRegion = region("new-run");
    const runsRegion = region("runs");
    const lockRegion = region("lock");
    let lockState = null;
    let goalsById = new Map();
    const approvalRegion = region("approval");
    const resultRegion = region("result");
    const statusRegion = region("status");
    statusRegion.setAttribute("role", "status");

    function text(tag, value, className) {
      const node = document.createElement(tag);
      node.textContent = value === null || value === undefined ? "" : String(value);
      if (className) node.className = className;
      return node;
    }

    function button(label, handler, { disabled = false } = {}) {
      const node = document.createElement("button");
      node.type = "button";
      node.textContent = label;
      node.disabled = disabled;
      node.addEventListener("click", () => { void handler(); });
      return node;
    }

    function setStatus(message) {
      statusRegion.textContent = message || "";
    }

    function fail(result) {
      setStatus(messageFor(result?.code));
      return null;
    }

    async function guarded(key, action) {
      if (pending.has(key)) return null;
      pending.add(key);
      renderBusy();
      try { return await action(); } finally { pending.delete(key); renderBusy(); }
    }

    function renderBusy() {
      for (const node of root.querySelectorAll?.("button[data-action]") || []) {
        node.disabled = pending.size > 0;
      }
    }

    function actionButton(label, key, handler) {
      const node = button(label, () => guarded(key, handler));
      node.setAttribute("data-action", key);
      return node;
    }

    // ---- Runs ----

    async function init() {
      const result = await api.get("runs");
      if (!result.ok && result.code === "GOAL_MODE_DEV_DISABLED") {
        enabled = false;
        root.hidden = true;
        return false;
      }
      enabled = true;
      root.hidden = false;
      root.replaceChildren(text("h3", "Goal Mode DEV"), formRegion, runsRegion, approvalRegion, resultRegion,
        lockRegion, statusRegion);
      await loadGoals();
      await refreshLock();
      if (!result.ok) return fail(result) ?? true;
      renderRuns(result.body.runs || []);
      return true;
    }

    // ---- Maintenance du verrou (B3b) ----

    async function refreshLock() {
      const result = await api.get("maintenance/lock");
      lockState = result.ok ? result.body : null;
      renderLock();
      return lockState;
    }

    function renderLock({ reconcileOffered = false } = {}) {
      lockRegion.replaceChildren(text("h4", "Verrou des données"));
      if (!lockState) {
        lockRegion.append(text("p", "État du verrou indisponible."));
        return;
      }
      lockRegion.append(text("p", LOCK_LABELS[lockState.state] || LOCK_LABELS.UNVERIFIED));
      if (lockState.holderPid !== null && lockState.holderPid !== undefined) {
        const host = lockState.holderHostname ? ` · ${lockState.holderHostname}` : "";
        const since = lockState.holderCreatedAt ? ` · depuis ${lockState.holderCreatedAt}` : "";
        lockRegion.append(text("p", `Détenteur : PID ${lockState.holderPid}${host}${since}`));
      }
      // Indication seulement : n'autorise aucune reprise.
      if (lockState.state === "HELD" && lockState.machineRestarted === true) {
        lockRegion.append(text("p", "Le Mac a redémarré depuis la pose du verrou : ce PID est probablement réutilisé par un autre programme. Reprise refusée tant qu'il est vivant."));
      }
      if (lockState.takeoverPending) {
        lockRegion.append(text("p", "Une reprise du verrou est en cours ou a été interrompue."));
      }
      if (lockState.canTakeOver) {
        lockRegion.append(actionButton(lockState.state === "ABSENT" ? "Prendre le verrou" : "Reprendre le verrou",
          "lock-takeover", () => takeoverLock()));
      }
      if (reconcileOffered && lockState.state === "HELD_BY_THIS") {
        lockRegion.append(actionButton("Réconcilier maintenant", "reconcile-scan", () => reconcileNow()));
      }
    }

    async function takeoverLock() {
      const observed = lockState || await refreshLock();
      if (!observed?.canTakeOver) {
        setStatus(LOCK_LABELS[observed?.state] || "Reprise du verrou impossible.");
        return null;
      }
      const holder = observed.holderPid !== null && observed.holderPid !== undefined
        ? `PID ${observed.holderPid}${observed.holderHostname ? ` sur ${observed.holderHostname}` : ""}` : "inconnu";
      const confirmed = confirmAction(
        `Reprendre le verrou des données Noon ?\nDétenteur : ${holder}\nRaison : ${LOCK_LABELS[observed.state]}\nVérifiez qu'aucune autre instance de Noon n'utilise ces données.`
      );
      if (confirmed !== true) {
        setStatus("Reprise du verrou annulée.");
        return null;
      }
      const result = await api.post("maintenance/lock-takeover", {
        confirm: true,
        expectedHolderPid: Number.isSafeInteger(observed.holderPid) ? observed.holderPid : null,
      });
      if (!result.ok) {
        await refreshLock();
        return fail(result);
      }
      await refreshLock();
      // Décision 7 : après une reprise explicite, scan proposé (jamais automatique).
      renderLock({ reconcileOffered: true });
      setStatus("Verrou repris. Lancez « Réconcilier maintenant » pour vérifier les tâches en suspens.");
      return result.body;
    }

    async function reconcileNow() {
      const result = await api.post("maintenance/reconcile-scan", { confirm: true });
      if (!result.ok) return fail(result);
      const summary = result.body;
      setStatus(`Scan : ${summary.scanned} examinée(s), ${summary.reconciled} réconciliée(s), ${summary.unknown} inconnue(s), ${summary.unchanged} inchangée(s), ${summary.failed} en échec.`);
      await refreshLock();
      await refreshRuns();
      return summary;
    }

    async function loadGoals() {
      const result = await api.get("/api/goals");
      const goals = result.ok && Array.isArray(result.body?.goals) ? result.body.goals : [];
      goalsById = new Map(goals.map((goal) => [goal.goalId, goal]));
      renderNewRunForm(goals.filter((goal) => goal.status === "ACTIVE" && goal.userConfirmed === true &&
        (goal.linkedWorkspaceIds || []).length && (goal.linkedProjectIds || []).length));
    }

    function select(name, options) {
      const node = document.createElement("select");
      node.name = name;
      for (const [value, label] of options) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        node.append(option);
      }
      if (options.length) node.value = options[0][0];
      return node;
    }

    function numberInput(name, value, label) {
      const wrapper = document.createElement("label");
      const input = document.createElement("input");
      input.type = "number";
      input.name = name;
      input.min = "0";
      input.value = String(value);
      wrapper.append(text("span", label), input);
      return { wrapper, input };
    }

    function renderNewRunForm(goals) {
      formRegion.replaceChildren();
      if (!goals.length) {
        formRegion.append(text("p", "Aucun Goal actif lié à un workspace et à un projet."));
        return;
      }
      const goalSelect = select("goalId", goals.map((goal) => [goal.goalId, goal.title || goal.goalId]));
      const workspaceSelect = select("workspaceId", []);
      const projectSelect = select("projectId", []);
      const syncLinks = () => {
        const goal = goalsById.get(goalSelect.value);
        workspaceSelect.replaceChildren(...select("w", (goal?.linkedWorkspaceIds || []).map((id) => [id, id])).children);
        projectSelect.replaceChildren(...select("p", (goal?.linkedProjectIds || []).map((id) => [id, id])).children);
        workspaceSelect.value = goal?.linkedWorkspaceIds?.[0] ?? "";
        projectSelect.value = goal?.linkedProjectIds?.[0] ?? "";
      };
      goalSelect.addEventListener("change", syncLinks);
      syncLinks();
      const fields = {
        maxSteps: numberInput("maxSteps", 4, "Étapes max"),
        maxRetries: numberInput("maxRetries", 1, "Essais max"),
        maxProviderCalls: numberInput("maxProviderCalls", 4, "Appels max"),
        maxDurationMinutes: numberInput("maxDurationMinutes", 30, "Durée max (min)"),
        maxEstimatedCost: numberInput("maxEstimatedCost", 1, "Coût max (USD)"),
      };
      const submit = actionButton("Créer et démarrer", "create-run", () => createRun({
        goalId: goalSelect.value,
        workspaceId: workspaceSelect.value,
        projectId: projectSelect.value,
        limits: {
          maxSteps: Number(fields.maxSteps.input.value),
          maxRetries: Number(fields.maxRetries.input.value),
          maxProviderCalls: Number(fields.maxProviderCalls.input.value),
          maxDuration: Number(fields.maxDurationMinutes.input.value) * 60_000,
          maxEstimatedCost: Number(fields.maxEstimatedCost.input.value),
        },
      }));
      formRegion.append(text("strong", "Nouveau run"), goalSelect, workspaceSelect, projectSelect,
        ...Object.values(fields).map((field) => field.wrapper), submit);
    }

    function renderRuns(runs) {
      runsRegion.replaceChildren();
      if (!runs.length) {
        runsRegion.append(text("p", "Aucun run Goal Mode DEV."));
        return;
      }
      for (const run of runs) {
        const item = document.createElement("article");
        item.className = "goal-mode-dev__run";
        item.append(
          text("strong", `${goalsById.get(run.goalId)?.title || run.goalId} · ${run.status}`),
          text("small", `Révision ${run.revision} · ${run.usage.providerCalls} appels · ${run.usage.estimatedCost} USD`),
        );
        const controls = document.createElement("div");
        controls.className = "goal-mode-dev__controls";
        if (run.status === "RUNNING") {
          controls.append(
            actionButton("Planifier", `plan:${run.runId}`, () => plan(run.runId)),
            actionButton("Pause", `pause:${run.runId}`, () => pauseRun(run.runId)),
            actionButton("Arrêter", `stop:${run.runId}`, () => stopRun(run.runId)),
          );
        }
        if (["PAUSED", "BLOCKED"].includes(run.status)) {
          controls.append(actionButton("Reprendre", `resume-run:${run.runId}`, () => resumeRun(run.runId)));
        }
        for (const reservation of run.reservations || []) {
          if (reservation.status === "MAY_HAVE_STARTED") {
            controls.append(
              actionButton("Réconcilier", `reconcile:${reservation.reservationId}`, () => reconcile(run.runId, reservation.reservationId)),
              actionButton("Arrêter la tâche", `cancel:${reservation.reservationId}`, () => cancelExecution(run.runId, reservation.reservationId)),
            );
          }
          if (reservation.status === "PREPARED") {
            // Après un rechargement, le jeton est perdu : Renouveler en émet un nouveau
            // (le serveur reste seul juge de la recevabilité du renouvellement).
            if (run.status === "RUNNING") {
              controls.append(actionButton("Renouveler", `renew:${reservation.reservationId}`, () => renew(reservation.reservationId, run.runId)));
            }
            controls.append(actionButton("Libérer", `release:${reservation.reservationId}`, () => release(run.runId, reservation.reservationId)));
          }
        }
        item.append(controls);
        runsRegion.append(item);
      }
    }

    async function refreshRuns() {
      const result = await api.get("runs");
      if (!result.ok) return fail(result);
      renderRuns(result.body.runs || []);
      return result.body.runs;
    }

    async function current(runId) {
      const result = await api.get(`runs/${encodeURIComponent(runId)}`);
      return result.ok ? result.body : fail(result);
    }

    async function createRun({ goalId, workspaceId, projectId, limits }) {
      const created = await api.post("runs", { goalId, workspaceId, projectId, limits, userConfirmed: true });
      if (!created.ok) return fail(created);
      const started = await api.post("runs/start", { runId: created.body.runId, expectedRevision: created.body.revision });
      if (!started.ok) return fail(started);
      setStatus("Run démarré.");
      await refreshRuns();
      return started.body;
    }

    // ---- Planning (appel fournisseur payant, confirmation explicite) ----

    async function plan(runId) {
      const estimate = await api.get(`runs/${encodeURIComponent(runId)}/planning-estimate`);
      if (!estimate.ok) return fail(estimate);
      if (estimate.body.decision !== "PLAN" || estimate.body.maxEstimatedCost === null) {
        setStatus(`Aucun planning nécessaire (${estimate.body.decision}).`);
        return null;
      }
      const confirmed = confirmAction(
        `Planifier appelle un fournisseur de modèle (payant). Coût maximal estimé : ${estimate.body.maxEstimatedCost} USD. Continuer ?`
      );
      if (confirmed !== true) {
        setStatus("Planification annulée.");
        return null;
      }
      const planned = await api.post("planning", { runId, confirmProviderCall: true });
      if (!planned.ok) return fail(planned);
      if (planned.body.status !== "PROPOSED" || !planned.body.stepId) {
        setStatus(`Planification : ${planned.body.status}.`);
        return planned.body;
      }
      await showProposal(runId, planned.body.stepId);
      return planned.body;
    }

    async function showProposal(runId, stepId) {
      const proposal = await api.get(`runs/${encodeURIComponent(runId)}/proposals/${encodeURIComponent(stepId)}`);
      if (!proposal.ok) return fail(proposal);
      const card = document.createElement("article");
      card.className = "goal-mode-dev__proposal";
      card.append(
        text("strong", "Proposition"),
        text("p", proposal.body.objective),
        text("small", `Résultat attendu : ${proposal.body.expectedOutcome}`),
        text("small", `Admission : ${proposal.body.admission?.decision || "inconnue"}`),
      );
      if (proposal.body.admission?.decision === "ADMIT") {
        card.append(actionButton("Préparer", `prepare:${stepId}`, () => prepare(runId, stepId)));
      }
      approvalRegion.replaceChildren(card);
      return proposal.body;
    }

    // ---- Approbation dédiée ----

    async function prepare(runId, stepId) {
      const run = await current(runId);
      if (!run) return null;
      const prepared = await api.post("dispatch/prepare", { runId, expectedRevision: run.revision, stepId });
      if (!prepared.ok) return fail(prepared);
      remember(prepared.body, runId);
      renderApproval(prepared.body, runId);
      return prepared.body.approval.approvalId;
    }

    function remember(prepared, runId) {
      tokens.set(prepared.approval.approvalId, {
        token: prepared.resumeToken, reservationId: prepared.reservationId, runId,
      });
    }

    function renderApproval(prepared, runId) {
      const view = prepared.display;
      const card = document.createElement("article");
      card.className = "goal-mode-dev__approval";
      card.append(
        text("h4", prepared.approval.title || "Lancer une tâche DEV Goal Mode"),
        text("p", `Goal : ${view.goalTitle ?? "sans titre"}`, "goal-mode-dev__goal"),
        text("p", view.instruction, "goal-mode-dev__instruction"),
        text("p", `Repository : ${view.repositoryRoot}${view.branch ? ` (${view.branch})` : ""}`),
        text("p", `Permissions : ${(view.permissions || []).join(", ") || "aucune"}`),
        text("p", `Coût maximal : ${view.maxEstimatedCost} USD`),
        text("p", `Appels maximum : ${view.maxProviderCalls}`),
        text("p", `Durée maximale : ${Math.round(Number(view.maxDuration) / 1000)} s`),
        text("p", `Expire à : ${new Date(prepared.approval.expiresAt).toLocaleTimeString("fr-FR")}`),
      );
      const rules = document.createElement("ul");
      rules.className = "goal-mode-dev__rules";
      for (const rule of view.projectRules || []) rules.append(text("li", rule));
      card.append(text("strong", `Règles projet (${(view.projectRules || []).length})`), rules);
      const approvalId = prepared.approval.approvalId;
      const actions = document.createElement("div");
      actions.className = "goal-mode-dev__actions";
      actions.append(
        actionButton("Approuver", `decide:${approvalId}`, () => decide(approvalId, "approve")),
        actionButton("Refuser", `decide:${approvalId}`, () => decide(approvalId, "reject")),
        actionButton("Renouveler", `renew:${prepared.reservationId}`, () => renew(prepared.reservationId, runId)),
      );
      card.append(actions);
      approvalRegion.replaceChildren(card);
    }

    async function renew(reservationId, runId) {
      const renewed = await api.post("dispatch/renew", { reservationId });
      if (!renewed.ok) return fail(renewed);
      for (const [approvalId, entry] of tokens) {
        if (entry.reservationId === reservationId) tokens.delete(approvalId);
      }
      remember(renewed.body, runId);
      renderApproval(renewed.body, runId);
      setStatus("Approbation renouvelée.");
      return renewed.body.approval.approvalId;
    }

    async function decide(approvalId, decision) {
      const entry = tokens.get(approvalId);
      if (!entry) {
        setStatus(messageFor("APPROVAL_TOKEN_INVALID"));
        return null;
      }
      if (decision !== "approve" && decision !== "reject") return null;
      if (decision === "approve") startPolling(entry.runId, entry.reservationId);
      const result = await api.post("dispatch/resume", {
        approvalId, resumeToken: entry.token, decision,
      });
      if (result.ok || ["APPROVAL_CONSUMED", "APPROVAL_INVALID", "approval_expired"].includes(result.code)) {
        tokens.delete(approvalId);
      }
      if (!result.ok) {
        // Déconnexion : le dispatch continue côté serveur, le suivi reste actif.
        if (result.code !== "NETWORK_UNAVAILABLE") stopPolling();
        return fail(result);
      }
      stopPolling();
      approvalRegion.replaceChildren();
      if (result.body.status === "rejected") {
        setStatus("Approbation refusée. La réservation reste préparée.");
      } else {
        renderReconciliation(result.body.reconciliation, entry.runId, entry.reservationId);
      }
      await refreshRuns();
      return result.body;
    }

    // ---- Résultat et réconciliation ----

    function renderReconciliation(reconciliation, runId, reservationId) {
      resultRegion.replaceChildren();
      if (!reconciliation) {
        resultRegion.append(text("p", "Résultat de réconciliation indisponible."));
        return;
      }
      const card = document.createElement("article");
      card.className = "goal-mode-dev__reconciliation";
      card.append(text("strong", `Réconciliation : ${reconciliation.outcome}`));
      if (reconciliation.outcome === "RECONCILED" && reconciliation.accounting) {
        card.append(text("p",
          `${reconciliation.accounting.providerCalls} appels · ${reconciliation.accounting.accountedCost} USD`));
      }
      if (BASIS_LABELS[reconciliation.basis]) {
        card.append(text("p", BASIS_LABELS[reconciliation.basis], "goal-mode-dev__basis"));
      }
      if (reconciliation.outcome === "UNKNOWN") {
        card.append(text("p", `Issue incertaine (${reconciliation.reason}) : le DEV de ce run est bloqué.`));
      }
      if (reconciliation.outcome === "UNCHANGED") {
        card.append(
          text("p", `Non réconcilié (${reconciliation.reason}).`),
          actionButton("Réconcilier", `reconcile:${reservationId}`, () => reconcile(runId, reservationId)),
        );
      }
      resultRegion.append(card);
    }

    async function reconcile(runId, reservationId) {
      const run = await current(runId);
      if (!run) return null;
      const result = await api.post("dispatch/reconcile", { runId, expectedRevision: run.revision, reservationId });
      if (!result.ok) return fail(result);
      renderReconciliation(result.body, runId, reservationId);
      await refreshRuns();
      return result.body;
    }

    // ---- Suivi pendant resume ----

    function startPolling(runId, reservationId) {
      stopPolling();
      const startedAt = now();
      let deadline = null;
      void current(runId).then((run) => {
        if (run) deadline = startedAt + Number(run.limits?.maxDuration || 0) + POLL_GRACE_MS;
      });
      pollHandle = setTimer(async () => {
        if (deadline !== null && now() > deadline) {
          stopPolling();
          setStatus("Suivi arrêté.");
          renderReconciliation({ outcome: "UNCHANGED", reason: "SUIVI_ARRETE" }, runId, reservationId);
          return;
        }
        const status = await api.get(`runs/${encodeURIComponent(runId)}/reservations/${encodeURIComponent(reservationId)}`);
        if (status.ok) {
          setStatus(`Tâche DEV : ${status.body.reservationStatus}`);
          if (!OPEN_RESERVATION_STATUSES.includes(status.body.reservationStatus)) stopPolling();
        }
      }, POLL_INTERVAL_MS);
    }

    function stopPolling() {
      if (pollHandle !== null) clearTimer(pollHandle);
      pollHandle = null;
    }

    // ---- Contrôles du run ----

    async function pauseRun(runId, { releasePrepared = false } = {}) {
      const run = await current(runId);
      if (!run) return null;
      const result = await api.post("runs/pause", { runId, expectedRevision: run.revision, releasePrepared });
      if (!result.ok) return fail(result);
      const release = result.body.release;
      setStatus(release && !release.released
        ? `Run en pause. Libération refusée (${release.code}).`
        : "Run en pause.");
      await refreshRuns();
      return result.body;
    }

    async function resumeRun(runId) {
      const run = await current(runId);
      if (!run) return null;
      const result = await api.post("runs/resume", { runId, expectedRevision: run.revision });
      if (!result.ok) return fail(result);
      setStatus(result.body.releaseRequired.length
        ? "Run repris. Une réservation préparée doit être libérée."
        : "Run repris.");
      await refreshRuns();
      return result.body;
    }

    async function stopRun(runId, status = "CANCELLED") {
      if (confirmAction(`Arrêter définitivement ce run (${status}) ?`) !== true) return null;
      const run = await current(runId);
      if (!run) return null;
      const result = await api.post("runs/stop", { runId, expectedRevision: run.revision, status });
      if (!result.ok) return fail(result);
      setStatus(`Run ${result.body.status}.`);
      await refreshRuns();
      return result.body;
    }

    async function cancelExecution(runId, reservationId) {
      if (confirmAction("Demander l'arrêt de la tâche DEV en cours ? L'issue restera à réconcilier.") !== true) return null;
      const result = await api.post("dispatch/cancel", { runId, reservationId });
      if (!result.ok) return fail(result);
      setStatus("Arrêt demandé. Réconciliation requise.");
      return result.body;
    }

    async function release(runId, reservationId) {
      if (confirmAction("Libérer cette réservation préparée ? Le step ne pourra plus être réservé.") !== true) return null;
      const run = await current(runId);
      if (!run) return null;
      const result = await api.post("dispatch/release", { runId, expectedRevision: run.revision, reservationId });
      if (!result.ok) return fail(result);
      setStatus("Réservation libérée.");
      await refreshRuns();
      return result.body;
    }

    return Object.freeze({
      init,
      refreshRuns,
      createRun,
      plan,
      prepare,
      decide,
      renew,
      reconcile,
      pauseRun,
      resumeRun,
      stopRun,
      cancelExecution,
      release,
      refreshLock,
      takeoverLock,
      reconcileNow,
      isEnabled: () => enabled,
      hasToken: (approvalId) => tokens.has(approvalId),
      tokenCount: () => tokens.size,
    });
  }

  global.NoonGoalModeDevUi = Object.freeze({
    BASIS_LABELS,
    ERROR_MESSAGES,
    LOCK_LABELS,
    POLL_GRACE_MS,
    POLL_INTERVAL_MS,
    createGoalModeDevApi,
    createGoalModeDevController,
    messageFor,
  });
})(typeof window !== "undefined" ? window : globalThis);
