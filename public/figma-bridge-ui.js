"use strict";

// Panneau « Figma » du Control Center (flag figma.bridge) : jumelage du plugin « Noon Bridge »
// importé dans Figma Desktop, état de la connexion, test de lecture, dissociation.
// Rendu en textContent uniquement ; aucun stockage navigateur ; le code de jumelage n'est
// affiché que dans ce panneau et expire en 5 minutes.
(function attachFigmaBridgeUi(global) {
  const BASE = "/api/figma-bridge";
  const ERROR_MESSAGES = Object.freeze({
    FIGMA_BRIDGE_DISABLED: "Passerelle Figma désactivée (flag figma.bridge).",
    FIGMA_BRIDGE_NOT_PAIRED: "Plugin non jumelé : génère un code et saisis-le dans le plugin.",
    FIGMA_BRIDGE_NOT_CONNECTED: "Plugin non ouvert : dans Figma, lance Plugins → Development → Noon Bridge.",
    FIGMA_BRIDGE_TIMEOUT: "Le plugin n'a pas répondu à temps (fenêtre du plugin fermée ?).",
    FIGMA_BRIDGE_PORT_IN_USE: "Le port 3856 est déjà utilisé sur ce Mac.",
    FIGMA_BRIDGE_REQUEST_REFUSED: "Requête refusée par Noon.",
  });
  const messageFor = (error) => ERROR_MESSAGES[String(error?.code || "")] || String(error?.message || "Passerelle Figma indisponible.");

  function createFigmaBridgeApi({ fetchImpl }) {
    if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl requis.");
    async function request(method, path) {
      const options = { method, cache: "no-store", headers: {} };
      if (method !== "GET") { options.headers["X-Noon-Request"] = "1"; options.headers["Content-Type"] = "application/json"; options.body = "{}"; }
      const response = await fetchImpl(path, options);
      let payload;
      try { payload = await response.json(); } catch { payload = {}; }
      if (!response.ok) throw Object.assign(new Error(String(payload.message || "Erreur.")), { code: String(payload.code || (response.status === 404 ? "FIGMA_BRIDGE_DISABLED" : "FIGMA_BRIDGE_ERROR")), status: response.status });
      return payload;
    }
    return Object.freeze({
      status: () => request("GET", BASE),
      pairingCode: () => request("POST", `${BASE}/pairing-code`),
      unpair: () => request("POST", `${BASE}/unpair`),
      test: () => request("POST", `${BASE}/test`),
    });
  }

  function createFigmaBridgeController({ elements = {}, api, confirmImpl = (text) => global.confirm?.(text) === true }) {
    const root = elements.root;
    if (!root || !api) throw new TypeError("root et api requis.");
    let available = false;
    let bridge = null;
    let pairing = null;
    let notice = null;
    let lastPage = null;

    const el = (tag, className = "", text = null) => { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = String(text); return node; };
    const button = (label, onClick) => { const node = el("button", "", label); node.type = "button"; node.addEventListener("click", onClick); return node; };

    async function run(work, success = null) {
      try { await work(); notice = success ? { kind: "status", text: success } : null; }
      catch (error) { notice = { kind: "error", text: messageFor(error) }; }
      await refresh();
    }

    function render() {
      if (!available || !bridge) { root.hidden = true; return; }
      root.hidden = false;
      const header = el("header", "control-section__header");
      const title = el("div");
      title.append(el("h2", "", "Figma"), el("p", "", "Le plugin « Noon Bridge » donne à Noon l'accès au fichier ouvert dans Figma Desktop (mode Design), sur ce Mac uniquement. Demande dans le chat : Noon lit la page, la sélection et les styles ; pour créer ou modifier, il te présente le plan et attend « Confirmer exactement ». Aucune suppression ; Cmd+Z dans Figma annule un plan entier."));
      header.append(title);
      const nodes = [header];
      if (notice) { const box = el("p", "control-center__notice", notice.text); box.setAttribute("role", notice.kind === "error" ? "alert" : "status"); box.dataset.kind = notice.kind; nodes.push(box); }

      const card = el("article", "control-card");
      const head = el("div", "control-card__head");
      const state = bridge.connected ? "HEALTHY" : bridge.paired ? "DEGRADED" : "UNKNOWN";
      const pill = el("span", "control-status-pill", bridge.connected ? "Connecté" : bridge.paired ? "Jumelé, plugin fermé" : "Non jumelé");
      pill.dataset.state = state;
      head.append(el("h3", "", "Plugin Noon Bridge"), pill);
      card.append(head);
      if (bridge.connected && bridge.file) card.append(el("p", "", `Fichier : ${bridge.file.fileName || "?"} · page : ${bridge.file.pageName || "?"}`));
      if (pairing) {
        card.append(el("p", "figma-bridge__code", `Code de jumelage : ${pairing.code}`));
        card.append(el("p", "", "Saisis-le dans la fenêtre du plugin (valable 5 minutes)."));
      }
      if (!bridge.paired) {
        const steps = el("ol", "figma-bridge__steps");
        for (const step of ["Dans Figma Desktop : Plugins → Development → Import plugin from manifest…", "Choisis le fichier figma-plugin/noon-bridge/manifest.json du dossier Noon.", "Lance Plugins → Development → Noon Bridge, puis saisis le code ci-dessous."]) steps.append(el("li", "", step));
        card.append(steps);
      }
      if (lastPage) card.append(el("p", "", `Lecture OK : « ${lastPage.pageName} », ${lastPage.childCount} élément(s) au premier niveau.`));
      const actions = el("div", "control-card__actions");
      actions.append(button(bridge.paired ? "Nouveau code (rejumeler)" : "Générer un code", () => run(async () => { const data = await api.pairingCode(); pairing = data.pairing; })));
      if (bridge.connected) actions.append(button("Tester la lecture", () => run(async () => { const data = await api.test(); lastPage = data.page; }, "Le plugin a répondu.")));
      if (bridge.paired) actions.append(button("Dissocier", () => { if (!confirmImpl("Dissocier le plugin Figma ? Il faudra le rejumeler avec un nouveau code.")) return Promise.resolve(); return run(async () => { await api.unpair(); pairing = null; lastPage = null; }, "Plugin dissocié."); }));
      card.append(actions);
      nodes.push(card);
      root.replaceChildren(...nodes);
    }

    async function refresh() {
      const data = await api.status().catch((error) => { if (error.code === "FIGMA_BRIDGE_DISABLED") { available = false; return null; } throw error; });
      bridge = data?.bridge || null;
      if (bridge?.paired && bridge.connected) pairing = null;
      if (pairing && Date.parse(pairing.expiresAt) <= Date.now()) pairing = null;
      render();
      return available;
    }

    async function init() {
      try { available = true; return await refresh(); }
      catch { available = false; render(); return false; }
    }

    return Object.freeze({ init, refresh, render, isAvailable: () => available });
  }

  global.NoonFigmaBridgeUi = Object.freeze({ ERROR_MESSAGES, createFigmaBridgeApi, createFigmaBridgeController, messageFor });
})(typeof window !== "undefined" ? window : globalThis);
