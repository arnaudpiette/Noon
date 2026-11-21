"use strict";

// UI SelfDev (Control Center), derrière le flag selfdev.v1. Noon prépare un correctif sur
// une copie isolée de son dépôt ; il ne commite, ne pousse et ne fusionne jamais.
// Rendu en textContent uniquement ; aucun stockage navigateur ; aucune commande libre :
// les validations proposées sont celles que le serveur autorise.
(function attachSelfDevUi(global) {
  const BASE = "/api/selfdev";

  const VERDICT_LABELS = Object.freeze({ DEMONSTRATED: "Démontré", UNPROVEN: "Non prouvé", BLOCKED: "Bloqué" });
  const REASON_LABELS = Object.freeze({
    BASELINE_MISSING: "base non mesurée",
    PATCH_NOT_MEASURED: "patch non mesuré",
    PROTECTED_PATH_CHANGED: "un chemin protégé a été modifié",
    REGRESSION: "régression d'une validation",
    RESULT_MISSING: "résultat manquant",
    FLAKY_VALIDATION: "validation instable",
    REPRODUCTION_MISSING: "reproduction non mesurée",
    REPRO_NOT_FAILING_ON_BASE: "le test de reproduction passe déjà sur la base",
    REPRO_NOT_PASSING_AFTER_PATCH: "le test de reproduction échoue après le patch",
  });
  const CHANGE_LABELS = Object.freeze({
    UNCHANGED: "inchangé", REGRESSION: "régression", IMPROVED: "amélioré", FLAKY: "instable",
    FLAKY_AFTER_PATCH: "instable après patch", PRE_EXISTING_FAILURE: "échec déjà présent", MISSING: "manquant",
  });
  const ERROR_MESSAGES = Object.freeze({
    SELFDEV_DISABLED: "SelfDev désactivé.",
    SELFDEV_TARGET_REQUIRED: "Enregistre d'abord la cible SelfDev.",
    SELFDEV_TARGET_INVALID: "La cible doit être la racine du dépôt Noon.",
    SELFDEV_TARGET_NOT_NOON: "Ce dépôt n'est pas celui de Noon.",
    SELFDEV_BASE_INVALID: "Branche ou commit de base invalide.",
    SELFDEV_CONTAINER_INVALID: "Dossier des copies introuvable ou situé dans le dépôt.",
    SELFDEV_CONTAINER_NOT_AUTHORIZED: "Autorise d'abord le dossier des copies en lecture-écriture dans Noon.",
    SELFDEV_NODE_MODULES_CLONE_FAILED: "Clone de node_modules impossible : copie annulée.",
    SELFDEV_WORKSPACE_REQUIRED: "Lie d'abord la copie à un workspace dont son dossier est une racine en lecture-écriture.",
    SELFDEV_WORKSPACE_AMBIGUOUS: "Plusieurs workspaces contiennent cette copie.",
    SELFDEV_BASELINE_NOT_CLEAN: "La base doit être mesurée avant tout patch.",
    SELFDEV_BASELINE_MISSING: "Mesure d'abord la base.",
    SELFDEV_PATCH_EMPTY: "Aucune modification à évaluer dans la copie.",
    SELFDEV_PROTECTED_PATH_CHANGED: "Le patch touche un chemin protégé : proposition bloquée, aucune validation lancée.",
    SELFDEV_COMMAND_REFUSED: "Commande de validation non autorisée (npm test, npm run lint, npm run build, node --test <fichiers>).",
    SELFDEV_COMMANDS_INVALID: "Indique entre une et six commandes de validation.",
    SELFDEV_REPRO_NOT_NEW_TEST: "La reproduction doit reposer sur de nouveaux fichiers test/*.test.js.",
    SELFDEV_REPRO_INVALID: "Indique un à cinq fichiers de test de reproduction.",
    SELFDEV_WORKTREE_HAS_CHANGES: "La copie contient des modifications non commitées.",
    SELFDEV_REVIEW_BLOCKED: "Relecture distante bloquée : Noon est en mode local uniquement ou hors ligne.",
    SELFDEV_REVIEW_UNAVAILABLE: "Relecteur indisponible (Codex n'est pas installé ou n'a pas répondu).",
    SELFDEV_REQUEST_REFUSED: "Requête refusée par Noon.",
  });

  function messageFor(error) { return ERROR_MESSAGES[String(error?.code || "")] || "Erreur SelfDev."; }

  function createSelfDevApi({ fetchImpl }) {
    if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl requis.");
    async function request(method, path, body) {
      const options = { method, cache: "no-store", headers: {} };
      if (method !== "GET") {
        options.headers["X-Noon-Request"] = "1";
        options.headers["Content-Type"] = "application/json";
        options.body = JSON.stringify(body || {});
      }
      const response = await fetchImpl(path, options);
      let payload;
      try { payload = await response.json(); } catch { payload = {}; }
      if (!response.ok) throw Object.assign(new Error(String(payload.message || "Erreur SelfDev.")), { code: String(payload.code || (response.status === 404 ? "SELFDEV_DISABLED" : "SELFDEV_ERROR")), status: response.status });
      return payload;
    }
    const at = (id, action = "") => `${BASE}/worktrees/${encodeURIComponent(id)}${action ? `/${action}` : ""}`;
    return Object.freeze({
      status: () => request("GET", `${BASE}/status`),
      setTarget: (target) => request("PUT", `${BASE}/target`, target),
      createWorktree: () => request("POST", `${BASE}/worktrees`, {}),
      baseline: (id, commands) => request("POST", at(id, "baseline"), { commands }),
      patched: (id) => request("POST", at(id, "patched"), {}),
      reproduction: (id, testFiles) => request("POST", at(id, "reproduction"), { testFiles }),
      review: (id) => request("POST", at(id, "review"), {}),
      remove: (id, discardChanges) => request("DELETE", at(id), discardChanges ? { discardChanges: true } : {}),
    });
  }

  const splitList = (value) => String(value || "").split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);

  function createSelfDevController({ elements, api, confirmImpl = null }) {
    const root = elements?.root;
    if (!root || !api) throw new TypeError("root et api requis.");
    const doc = root.ownerDocument || global.document;
    const ask = typeof confirmImpl === "function" ? confirmImpl : (text) => (typeof global.confirm === "function" ? global.confirm(text) : false);
    let available = false;
    let busy = false;
    let notice = null;
    let data = { target: null, reviewAvailable: false, worktrees: [] };
    let editingTarget = false;
    const drafts = { target: { repositoryRoot: "", baseBranch: "", worktreeContainer: "" }, commands: new Map(), repro: new Map() };

    function el(tag, className = "", text = null) {
      const node = doc.createElement(tag);
      if (className) node.className = className;
      if (text != null) node.textContent = String(text);
      return node;
    }
    function button(label, onClick, { disabled = false } = {}) {
      const node = el("button", "", label);
      node.type = "button";
      node.disabled = busy || disabled;
      node.addEventListener("click", () => { void onClick(); });
      return node;
    }
    function field(label, value, onInput, { placeholder = "" } = {}) {
      const wrapper = el("label", "selfdev__field");
      const input = el("input");
      input.type = "text";
      input.value = value;
      input.placeholder = placeholder;
      input.disabled = busy;
      input.addEventListener("input", () => onInput(input.value));
      wrapper.append(el("span", "", label), input);
      return wrapper;
    }
    function pill(verdict) {
      const node = el("span", "control-status-pill", VERDICT_LABELS[verdict] || "Non mesuré");
      node.dataset.state = verdict === "DEMONSTRATED" ? "OK" : verdict === "BLOCKED" ? "ERROR" : "WARNING";
      return node;
    }
    const setNotice = (text, kind = "info") => { notice = text ? { text: String(text), kind } : null; };

    async function refresh({ keepNotice = false } = {}) {
      const payload = await api.status();
      data = { target: payload.target || null, reviewAvailable: payload.reviewAvailable === true, worktrees: Array.isArray(payload.worktrees) ? payload.worktrees : [] };
      if (!keepNotice) setNotice(null);
      render();
      return data;
    }

    async function run(action, successNotice = null) {
      if (busy) return;
      busy = true; setNotice("Opération en cours… (les validations peuvent prendre plusieurs minutes)"); render();
      try {
        await action();
        setNotice(successNotice);
        await refresh({ keepNotice: true });
      } catch (error) {
        setNotice(messageFor(error), "error");
        await refresh({ keepNotice: true }).catch(() => {});
      } finally { busy = false; render(); }
    }

    function renderTarget() {
      const box = el("section", "control-card selfdev__target");
      box.append(el("h3", "", "Cible"));
      const target = data.target;
      if (target && !target.unavailable && !editingTarget) {
        const meta = el("div", "control-card__meta");
        meta.append(el("span", "", `Dépôt : ${target.repositoryRoot}`), el("span", "", `Branche de base : ${target.baseBranch}`), el("span", "", `Copies : ${target.worktreeContainer}`));
        box.append(meta, (() => { const actions = el("div", "control-card__actions"); actions.append(button("Modifier la cible", async () => { editingTarget = true; drafts.target = { repositoryRoot: target.repositoryRoot, baseBranch: target.baseBranch, worktreeContainer: target.worktreeContainer }; render(); })); return actions; })());
        return box;
      }
      if (target?.unavailable) box.append(el("p", "control-center__notice", "La cible enregistrée n'est plus valide : enregistre-la à nouveau."));
      box.append(el("p", "selfdev__hint", "Le dossier des copies doit être hors du dépôt et autorisé en lecture-écriture dans Noon."));
      box.append(
        field("Dépôt Noon (racine)", drafts.target.repositoryRoot, (value) => { drafts.target.repositoryRoot = value; }, { placeholder: "/Users/…/Noon" }),
        field("Branche de base", drafts.target.baseBranch, (value) => { drafts.target.baseBranch = value; }, { placeholder: "v2/multi-provider" }),
        field("Dossier des copies", drafts.target.worktreeContainer, (value) => { drafts.target.worktreeContainer = value; }, { placeholder: "/Users/…/NoonSelfDev" }),
      );
      const actions = el("div", "control-card__actions");
      actions.append(button("Enregistrer la cible", () => run(async () => { await api.setTarget({ ...drafts.target }); editingTarget = false; }, "Cible SelfDev enregistrée.")));
      if (editingTarget) actions.append(button("Annuler", async () => { editingTarget = false; render(); }));
      box.append(actions);
      return box;
    }

    function renderVerdict(item) {
      const container = el("div", "selfdev__verdict");
      const verdict = item.verdict;
      if (!verdict) return container;
      if (verdict.reasons?.length) container.append(el("p", "", `Réserves : ${verdict.reasons.map((code) => REASON_LABELS[code] || code).join(" ; ")}`));
      if (verdict.violations?.length) container.append(el("p", "", `Chemins protégés : ${verdict.violations.map((entry) => entry.path).join(", ")}`));
      if (verdict.comparison?.length) {
        const list = el("ul", "selfdev__comparison");
        for (const entry of verdict.comparison) list.append(el("li", "", `${entry.command} : ${entry.before} → ${entry.after} (${CHANGE_LABELS[entry.change] || entry.change})`));
        container.append(list);
      }
      if (verdict.reproduction) {
        const repro = verdict.reproduction;
        container.append(el("p", "", `Reproduction (${(repro.files || []).join(", ")}) : base ${repro.onBase?.status || "?"}, après patch ${repro.afterPatch?.status || "?"}${repro.reproduced ? " — bug reproduit puis corrigé" : ""}`));
      }
      return container;
    }

    function renderWorktree(item) {
      const card = el("article", "control-card selfdev__worktree");
      const head = el("div", "control-card__head");
      head.append(el("h3", "", item.branch || item.id), pill(item.verdict?.verdict));
      card.append(head);
      const meta = el("div", "control-card__meta");
      meta.append(
        el("span", "", `Base : ${String(item.baseCommit || "").slice(0, 10)}`),
        el("span", "", `Copie : ${item.worktreePath}`),
        el("span", "", item.exists ? `Fichiers modifiés : ${item.changedFiles ?? "?"}` : "Copie absente du disque"),
        el("span", "", `Âge : ${item.ageDays} j`),
      );
      card.append(meta);
      if (item.cleanupSuggested) card.append(el("p", "control-center__notice", "Copie non traitée depuis plus de 14 jours : pense à la garder ou à la jeter."));
      card.append(renderVerdict(item));

      const commands = drafts.commands.get(item.id) ?? "npm test";
      const repro = drafts.repro.get(item.id) ?? "";
      const steps = el("div", "selfdev__steps");
      steps.append(field("Validations (séparées par des virgules)", commands, (value) => drafts.commands.set(item.id, value), { placeholder: "npm test, npm run lint" }));
      const baseActions = el("div", "control-card__actions");
      baseActions.append(
        button("1. Mesurer la base", () => run(() => api.baseline(item.id, String(drafts.commands.get(item.id) ?? "npm test").split(",").map((value) => value.trim()).filter(Boolean)), "Base mesurée. Lance maintenant le run Goal Mode DEV sur cette copie."), { disabled: !item.exists }),
        button("2. Mesurer le patch", () => run(() => api.patched(item.id), "Patch mesuré."), { disabled: !item.exists }),
      );
      steps.append(baseActions, field("Tests de reproduction (nouveaux fichiers)", repro, (value) => drafts.repro.set(item.id, value), { placeholder: "test/mon-bug.test.js" }));
      const reproActions = el("div", "control-card__actions");
      reproActions.append(button("3. Prouver la reproduction", () => run(() => api.reproduction(item.id, splitList(drafts.repro.get(item.id))), "Reproduction mesurée."), { disabled: !item.exists }));
      if (data.reviewAvailable) reproActions.append(button("4. Relire avec Codex (lecture seule)", () => run(() => api.review(item.id), "Relecture terminée."), { disabled: !item.exists }));
      steps.append(reproActions);
      card.append(steps);

      if (item.review?.analysis) {
        const review = el("section", "selfdev__review");
        review.append(el("h4", "", `Avis du relecteur (${item.review.provider}) — donnée non vérifiée, consultative`));
        review.append(el("p", "selfdev__review-text", item.review.analysis));
        if (item.review.truncated) review.append(el("p", "selfdev__hint", "Avis tronqué."));
        card.append(review);
      }

      const end = el("div", "control-card__actions");
      end.append(button("Jeter la copie", () => {
        const changed = Number(item.changedFiles) > 0;
        if (!ask(changed ? `Jeter la copie ${item.branch} et ses ${item.changedFiles} fichier(s) modifié(s) ? Les modifications non commitées seront perdues.` : `Jeter la copie ${item.branch} ?`)) return Promise.resolve();
        return run(() => api.remove(item.id, changed), "Copie supprimée. Une branche portant des commits est conservée.");
      }));
      card.append(el("p", "selfdev__hint", "Noon ne commite, ne pousse et ne fusionne jamais : examine le diff dans la copie, puis intègre-le toi-même si tu le gardes."), end);
      return card;
    }

    function render() {
      if (!available) { root.hidden = true; return; }
      root.hidden = false;
      const header = el("header", "control-section__header");
      const title = el("div");
      title.append(el("h2", "", "SelfDev"), el("p", "", "Noon prépare un correctif sur une copie isolée de son dépôt, prouve qu'il n'aggrave pas les validations et te le propose. Le patch lui-même est produit par un run Goal Mode DEV sur la copie."));
      header.append(title);
      const nodes = [header];
      if (notice) {
        const box = el("p", "control-center__notice", notice.text);
        box.setAttribute("role", notice.kind === "error" ? "alert" : "status");
        box.dataset.kind = notice.kind;
        nodes.push(box);
      }
      nodes.push(renderTarget());
      const targetReady = data.target && !data.target.unavailable;
      const actions = el("div", "control-card__actions");
      actions.append(button("Nouvelle copie isolée", () => run(() => api.createWorktree(), "Copie créée. Lie son dossier à un workspace, puis mesure la base."), { disabled: !targetReady }));
      nodes.push(actions);
      if (data.worktrees.length) {
        const grid = el("div", "control-center__grid");
        for (const item of data.worktrees) grid.append(renderWorktree(item));
        nodes.push(grid);
      } else if (targetReady) nodes.push(el("div", "control-empty", "Aucune copie SelfDev."));
      root.replaceChildren(...nodes);
    }

    async function init() {
      try { available = true; await refresh(); return true; }
      catch { available = false; render(); return false; }
    }

    return Object.freeze({ init, refresh, render, isAvailable: () => available });
  }

  global.NoonSelfDevUi = Object.freeze({ CHANGE_LABELS, ERROR_MESSAGES, REASON_LABELS, VERDICT_LABELS, createSelfDevApi, createSelfDevController, messageFor });
})(typeof window !== "undefined" ? window : globalThis);
