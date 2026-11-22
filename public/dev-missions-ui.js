"use strict";

// V3-L5d — panneau « Missions DEV » (Control Center), derrière le flag dev.missions.
// Préparer une mission, la lancer après lecture de la validation, suivre son exécution dans la
// copie isolée, relire le diff, puis l'appliquer au dossier (sans commit) ou l'abandonner.
// Rendu en textContent uniquement : aucune valeur serveur (objectif, diff, chemin) ne devient du
// HTML. Aucun stockage navigateur.
(function attachDevMissionsUi(global) {
  const BASE = "/api/dev-missions";

  const STATUS_LABELS = Object.freeze({
    awaiting_start: "À valider", running: "En cours", awaiting_apply: "Diff à valider", applied: "Appliquée",
    no_changes: "Aucun changement", failed: "Échouée", discarded: "Abandonnée",
  });
  const STATUS_STATES = Object.freeze({ awaiting_start: "WARNING", running: "WARNING", awaiting_apply: "WARNING", applied: "OK", no_changes: "OK", failed: "ERROR", discarded: "UNKNOWN" });
  const FAILURE_LABELS = Object.freeze({
    AGENT_UNAVAILABLE: "exécutant indisponible sur ce Mac", AUTH_ERROR: "exécutant non connecté (session à ouvrir)", BUDGET_EXCEEDED: "limite d'itérations atteinte",
    TIMEOUT: "durée maximale dépassée", CANCELLED: "annulée", OUT_OF_SCOPE_CHANGE: "fichiers modifiés hors des chemins autorisés", VALIDATION_FAILED: "validations en échec",
  });
  const ERROR_MESSAGES = Object.freeze({
    MISSION_DISABLED: "Missions DEV désactivées (flag dev.missions).",
    MISSION_OBJECTIVE_INVALID: "Décris l'objectif de la mission (4 000 caractères au plus).",
    MISSION_WORKSPACE_INVALID: "Choisis un dépôt.",
    MISSION_EXECUTOR_INVALID: "Exécutant inconnu.",
    MISSION_PATHS_INVALID: "Chemins relatifs au dépôt uniquement, 20 au plus, sans « .. ».",
    MISSION_REPOSITORY_INVALID: "Ce dossier n'est pas un dépôt Git avec au moins un commit.",
    MISSION_REPOSITORY_FORBIDDEN: "Ce dépôt ne fait pas partie des dossiers autorisés en écriture de cet espace de travail.",
    MISSION_APPROVAL_MISMATCH: "Validation expirée ou déjà utilisée : prépare de nouveau la mission ou renouvelle la validation.",
    MISSION_STALE: "Le dépôt a changé de commit depuis la préparation : prépare de nouveau la mission.",
    MISSION_BUSY: "Une mission est déjà en cours.",
    MISSION_STATE_INVALID: "Cette action n'est plus possible pour cette mission.",
    MISSION_NOT_FOUND: "Mission introuvable (perdue au redémarrage de Noon ?).",
    MISSION_LOCAL_CONFLICT: "Tu as des modifications locales sur un fichier du diff : enregistre-les ou mets-les de côté avant d'appliquer.",
    MISSION_PATCH_CONFLICT: "Le diff ne s'applique plus proprement sur ton dossier (le code a changé depuis la mission).",
    MISSION_PATCH_UNAVAILABLE: "Diff introuvable.",
    APPROVAL_EXPIRED: "Validation expirée : renouvelle-la.",
    APPROVAL_ACTION_CHANGED: "Le diff a changé depuis la validation : renouvelle-la après l'avoir relu.",
    MISSION_REQUEST_REFUSED: "Requête refusée par Noon.",
  });
  const messageFor = (error) => {
    const base = ERROR_MESSAGES[String(error?.code || "")] || "Mission DEV indisponible.";
    return Array.isArray(error?.files) && error.files.length ? `${base} (${error.files.slice(0, 5).join(", ")})` : base;
  };

  function createDevMissionsApi({ fetchImpl }) {
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
      if (!response.ok) throw Object.assign(new Error(String(payload.message || "Erreur.")), { code: String(payload.code || (response.status === 404 ? "MISSION_DISABLED" : "MISSION_ERROR")), status: response.status, files: Array.isArray(payload.files) ? payload.files : undefined });
      return payload;
    }
    const enc = encodeURIComponent;
    return Object.freeze({
      list: () => request("GET", BASE),
      patch: (id) => request("GET", `${BASE}/${enc(id)}/patch`),
      propose: (body) => request("POST", BASE, body),
      start: (id, approvalId) => request("POST", `${BASE}/${enc(id)}/start`, { approvalId }),
      apply: (id, approvalId) => request("POST", `${BASE}/${enc(id)}/apply`, { approvalId }),
      renew: (id) => request("POST", `${BASE}/${enc(id)}/renew-apply`, {}),
      discard: (id) => request("POST", `${BASE}/${enc(id)}/discard`, {}),
    });
  }

  const splitPaths = (value) => String(value || "").split(/[,\n]/).map((item) => item.trim()).filter(Boolean);

  function createDevMissionsController({ elements, api, confirmImpl = null, now = () => Date.now(), setTimer = global.setTimeout?.bind(global), clearTimer = global.clearTimeout?.bind(global) }) {
    const root = elements?.root;
    if (!root || !api) throw new TypeError("root et api requis.");
    const doc = root.ownerDocument || global.document;
    const ask = typeof confirmImpl === "function" ? confirmImpl : (text) => (typeof global.confirm === "function" ? global.confirm(text) : false);
    let available = false;
    let busy = false;
    let notice = null;
    let data = null;
    let poll = null;
    const form = { repository: 0, objective: "", paths: "", executor: "codex-cli" };
    const patches = new Map(); // missionId → { text, truncated, bytes } affiché

    const el = (tag, className = "", text = null) => { const node = doc.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = String(text); return node; };
    function button(label, onClick, { disabled = false, kind = "" } = {}) {
      const node = el("button", kind, label);
      node.type = "button"; node.disabled = busy || disabled;
      node.addEventListener("click", () => { void onClick(); });
      return node;
    }
    const setNotice = (text, kind = "info") => { notice = text ? { text: String(text), kind } : null; };
    const expired = (approval) => !approval || Date.parse(approval.expiresAt) <= now();
    const time = (value) => new Date(value).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    const cancelled = () => Object.assign(new Error("annulé"), { code: "CANCELLED" });

    // Une mission en cours est relue toutes les 3 s jusqu'à son verdict.
    function schedulePoll() {
      if (poll && clearTimer) clearTimer(poll);
      poll = null;
      if (!setTimer || !(data?.missions || []).some((mission) => mission.status === "running")) return;
      poll = setTimer(() => { poll = null; void refresh({ keepNotice: true }).catch(() => {}); }, 3000);
    }

    async function refresh({ keepNotice = false } = {}) {
      data = await api.list();
      const ids = new Set((data.missions || []).map((mission) => mission.id));
      for (const id of [...patches.keys()]) if (!ids.has(id)) patches.delete(id);
      const executors = data.executors || [];
      if (!executors.some((item) => item.id === form.executor)) form.executor = executors.find((item) => item.default)?.id || "codex-cli";
      if (form.repository >= (data.repositories || []).length) form.repository = 0;
      if (!keepNotice) setNotice(null);
      render();
      schedulePoll();
      return data;
    }

    async function run(action, successNotice = null) {
      if (busy) return;
      busy = true; render();
      try { await action(); setNotice(successNotice, "success"); }
      catch (error) { if (error?.code === "CANCELLED") setNotice(null); else setNotice(messageFor(error), "error"); }
      finally { busy = false; }
      try { await refresh({ keepNotice: true }); } catch { render(); }
    }

    function field(labelText, control) {
      const wrapper = el("label", "dev-missions__field");
      wrapper.append(el("span", "", labelText), control);
      return wrapper;
    }

    function renderForm() {
      const card = el("section", "control-card dev-missions__form");
      card.append(el("h3", "", "Nouvelle mission"));
      const repositories = data.repositories || [];
      if (!repositories.length) {
        card.append(el("p", "dev-missions__hint", "Aucun dépôt Git parmi les dossiers autorisés en écriture de tes espaces de travail. Ajoute la racine du dépôt à un espace de travail, en écriture."));
        return card;
      }
      const repository = el("select");
      repositories.forEach((item, index) => {
        const option = el("option", "", `${item.name} — ${item.workspaceName}`);
        option.value = String(index); option.selected = index === form.repository;
        repository.append(option);
      });
      repository.value = String(form.repository);
      repository.disabled = busy;
      repository.addEventListener("change", () => { form.repository = Number(repository.value) || 0; });
      const objective = el("textarea");
      objective.value = form.objective; objective.rows = 4; objective.maxLength = 4000; objective.disabled = busy;
      objective.setAttribute("placeholder", "Ce que l'exécutant doit faire, et comment savoir que c'est fini.");
      objective.addEventListener("input", () => { form.objective = objective.value; });
      const paths = el("input");
      paths.type = "text"; paths.value = form.paths; paths.disabled = busy;
      paths.setAttribute("placeholder", "src, test (vide = tout le dépôt)");
      paths.addEventListener("input", () => { form.paths = paths.value; });
      const executor = el("select");
      for (const item of data.executors || []) {
        const option = el("option", "", `${item.name}${item.version ? ` (${item.version})` : ""}${item.available ? "" : " — indisponible"}`);
        option.value = item.id; option.disabled = !item.available; option.selected = item.id === form.executor;
        executor.append(option);
      }
      executor.value = form.executor;
      executor.disabled = busy;
      executor.addEventListener("change", () => { form.executor = executor.value; });
      const selected = repositories[form.repository];
      card.append(
        field("Dépôt", repository),
        el("p", "dev-missions__hint", selected.repositoryRoot),
        field("Objectif", objective),
        field("Chemins autorisés", paths),
        field("Exécutant", executor),
      );
      const actions = el("div", "control-card__actions");
      actions.append(button("Préparer la mission", () => run(async () => {
        const target = (data.repositories || [])[form.repository];
        const body = { workspaceId: target.workspaceId, repositoryRoot: target.repositoryRoot, objective: form.objective.trim(), allowedPaths: splitPaths(form.paths), executor: form.executor };
        await api.propose(body);
        form.objective = ""; form.paths = "";
      }, "Mission préparée : relis la validation ci-dessous avant de la lancer.")));
      card.append(actions);
      return card;
    }

    function renderResult(mission, card) {
      const result = mission.result;
      if (!result) return;
      if (result.summary) card.append(el("p", "dev-missions__summary", result.summary));
      if (result.failureCategory) card.append(el("p", "dev-missions__hint", `Cause : ${FAILURE_LABELS[result.failureCategory] || result.failureCategory}.`));
      if (result.files?.length) {
        card.append(el("p", "dev-missions__label", `Fichiers modifiés (${result.files.length})`));
        const list = el("ul", "dev-missions__files");
        for (const file of result.files) list.append(el("li", "", `${file.status} ${file.path}`));
        card.append(list);
      }
      if (result.validations?.length) card.append(el("p", "dev-missions__hint", `Validations : ${result.validations.map((item) => `${item.command} ${item.status}`).join(" · ")}`));
      if (result.sourceUncommittedChanges > 0) card.append(el("p", "dev-missions__hint", `L'exécutant est parti du dernier commit : ${result.sourceUncommittedChanges} modification(s) non commitée(s) de ton dossier ne lui étaient pas visibles.`));
    }

    function renderPatch(mission, card) {
      const shown = patches.get(mission.id);
      const actions = el("div", "control-card__actions");
      actions.append(button(shown ? "Masquer le diff" : "Voir le diff", () => run(async () => {
        if (patches.has(mission.id)) { patches.delete(mission.id); return; }
        patches.set(mission.id, (await api.patch(mission.id)).patch);
      })));
      card.append(actions);
      if (!shown) return;
      card.append(el("pre", "dev-missions__patch", shown.text));
      if (shown.truncated) card.append(el("p", "dev-missions__hint", `Diff tronqué à l'affichage (${Math.round(shown.bytes / 1024)} Ko au total) : relis le reste avec git diff après application.`));
    }

    function renderMission(mission) {
      const card = el("section", "control-card dev-missions__mission");
      const title = el("h3", "");
      const pill = el("span", "control-status-pill", STATUS_LABELS[mission.status] || mission.status);
      pill.dataset.state = STATUS_STATES[mission.status] || "UNKNOWN";
      title.append(doc.createTextNode(`${mission.objective.slice(0, 90)}${mission.objective.length > 90 ? "…" : ""} `), pill);
      card.append(title);
      const executorName = mission.executor === "claude-code" ? "Claude Code" : "Codex";
      card.append(el("p", "dev-missions__hint", `${executorName} · commit ${String(mission.baseCommit || "").slice(0, 7)} · chemins : ${(mission.allowedPaths || []).join(", ") === "." ? "tout le dépôt" : mission.allowedPaths.join(", ")} · ${mission.repositoryRoot}`));
      const actions = el("div", "control-card__actions");
      const discard = () => button("Abandonner", () => run(() => api.discard(mission.id), "Mission abandonnée."), { kind: "danger" });

      if (mission.status === "awaiting_start") {
        card.append(el("p", "dev-missions__approval", mission.approval?.summary || ""));
        if (expired(mission.approval)) card.append(el("p", "dev-missions__hint", "Validation expirée : abandonne puis prépare de nouveau la mission."));
        else card.append(el("p", "dev-missions__hint", `Validation valable jusqu'à ${time(mission.approval.expiresAt)}, usage unique.`));
        actions.append(button("Lancer la mission", () => run(() => api.start(mission.id, mission.approval.id), "Mission lancée dans une copie isolée : ton dossier ne bouge pas."), { disabled: expired(mission.approval) }), discard());
      } else if (mission.status === "running") {
        card.append(el("p", "", "L'exécutant travaille dans une copie isolée du dépôt. Ton dossier ne bouge pas."));
      } else if (mission.status === "awaiting_apply") {
        renderResult(mission, card);
        renderPatch(mission, card);
        card.append(el("p", "dev-missions__approval", mission.approval?.summary || ""));
        const late = expired(mission.approval);
        card.append(el("p", "dev-missions__hint", late ? "Validation expirée : renouvelle-la (le diff n'est pas recalculé)." : `Validation valable jusqu'à ${time(mission.approval.expiresAt)}. Aucun commit ne sera fait.`));
        const files = mission.result?.files?.length || 0;
        if (late) actions.append(button("Renouveler la validation", () => run(() => api.renew(mission.id), "Validation renouvelée.")));
        else actions.append(button("Appliquer à mon dossier", () => run(async () => {
          if (!ask(`Appliquer ${files} fichier(s) à ${mission.repositoryRoot} ? Rien ne sera indexé ni commité.`)) throw cancelled();
          await api.apply(mission.id, mission.approval.id);
        }, "Diff appliqué sans commit : relis-le avec git diff, puis commite toi-même.")));
        actions.append(discard());
      } else {
        renderResult(mission, card);
        if (mission.status === "applied") card.append(el("p", "dev-missions__hint", "Appliqué sans index ni commit. À toi de relire (git diff) et de commiter."));
        if (mission.status === "failed" && mission.error?.code) card.append(el("p", "dev-missions__hint", `Erreur : ${mission.error.code}.`));
        if (mission.status === "failed" || mission.status === "no_changes") actions.append(discard());
      }
      if (actions.childNodes.length) card.append(actions);
      return card;
    }

    function render() {
      if (!available || !data) { root.hidden = true; return; }
      root.hidden = false;
      const header = el("header", "control-section__header");
      const title = el("div");
      title.append(el("h2", "", "Missions DEV"), el("p", "", "Codex ou Claude Code travaille dans une copie isolée de ton dépôt. Deux validations : avant de lancer, puis avant d'appliquer le diff à ton dossier. Aucun commit, aucun push. Les missions sont perdues au redémarrage de Noon."));
      header.append(title);
      const nodes = [header];
      if (notice) {
        const box = el("p", "control-center__notice", notice.text);
        box.setAttribute("role", notice.kind === "error" ? "alert" : "status");
        box.dataset.kind = notice.kind;
        nodes.push(box);
      }
      nodes.push(renderForm());
      const missions = data.missions || [];
      if (missions.length) for (const mission of missions) nodes.push(renderMission(mission));
      else nodes.push(el("p", "dev-missions__hint", "Aucune mission depuis l'ouverture de Noon."));
      root.replaceChildren(...nodes);
    }

    async function init() {
      try { available = true; await refresh(); return true; }
      catch { available = false; render(); return false; }
    }

    return Object.freeze({ init, refresh, render, isAvailable: () => available });
  }

  global.NoonDevMissionsUi = Object.freeze({ ERROR_MESSAGES, createDevMissionsApi, createDevMissionsController, messageFor, splitPaths });
})(typeof window !== "undefined" ? window : globalThis);
