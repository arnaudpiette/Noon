"use strict";

// UI des connecteurs MCP (Control Center), derrière le flag connectors.mcp.
// Phase 1 : serveurs du catalogue, outils en lecture seule validés un par un.
// Toutes les valeurs serveur sont rendues avec textContent : aucun nom de
// serveur, d'outil ou d'erreur ne devient du HTML. Aucun jeton n'arrive ici :
// le serveur ne renvoie que l'état et, pendant une connexion OAuth, l'URL
// d'autorisation à ouvrir dans le navigateur.
(function attachMcpConnectorsUi(global) {
  const BASE = "/api/mcp/servers";
  const POLL_INTERVAL_MS = 2000;
  const POLL_MAX_ATTEMPTS = 150; // 5 minutes, puis arrêt explicite.

  const STATE_LABELS = Object.freeze({
    NOT_CONNECTED: "Non connecté",
    CONNECTING: "Connexion…",
    CONNECTED: "Connecté",
    AUTH_REQUIRED: "Autorisation requise",
    BLOCKED: "Bloqué (local uniquement ou hors ligne)",
    ERROR: "Erreur",
  });

  const ERROR_MESSAGES = Object.freeze({
    MCP_DISABLED: "Connecteurs MCP désactivés.",
    MCP_REMOTE_BLOCKED: "Serveur distant bloqué : Noon est en mode local uniquement ou hors ligne.",
    MCP_AUTH_REQUIRED: "Autorisation requise : relance la connexion.",
    MCP_CONNECT_FAILED: "Connexion impossible. Vérifie le réseau ou, pour l'application de bureau, que son serveur MCP est activé.",
    MCP_SERVER_NOT_INSTALLED: "Ce serveur n'est pas installé.",
    MCP_SERVER_UNKNOWN: "Serveur inconnu du catalogue.",
    MCP_TOOL_NOT_READ_ONLY: "Cet outil n'est pas reconnu comme lecture seule.",
    MCP_REQUEST_REFUSED: "Requête refusée par Noon.",
    MCP_AUTHORIZATION_URL_INVALID: "Adresse d'autorisation invalide : connexion annulée.",
  });

  const HIDDEN_REASONS = Object.freeze({
    DESTRUCTIVE_HINT: "masqué : le serveur le déclare destructif",
    SERVER_DECLARES_WRITE: "masqué : le serveur le déclare en écriture",
    NOT_DECLARED_READ_ONLY: "masqué : non déclaré en lecture seule",
    READ_ONLY_NOT_APPROVED_BY_USER: "non validé",
    MCP_SCHEMA_UNSUPPORTED: "masqué : paramètres non pris en charge",
  });

  function messageFor(error) {
    const code = String(error?.code || "");
    return ERROR_MESSAGES[code] || "Erreur du connecteur MCP.";
  }

  function apiError(status, payload) {
    const error = new Error(String(payload?.message || "Erreur du connecteur MCP."));
    error.code = String(payload?.code || (status === 404 ? "MCP_DISABLED" : "MCP_ERROR"));
    error.status = status;
    return error;
  }

  function createMcpConnectorsApi({ fetchImpl }) {
    if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl requis.");
    async function request(method, path, body) {
      const options = { method, cache: "no-store", headers: {} };
      if (method !== "GET") {
        options.headers["X-Noon-Request"] = "1";
        options.headers["Content-Type"] = "application/json";
        options.body = JSON.stringify(body || {});
      }
      const response = await fetchImpl(path, options);
      let payload = {};
      try { payload = await response.json(); } catch { payload = {}; }
      if (!response.ok) throw apiError(response.status, payload);
      return payload;
    }
    const at = (id, action = "") => `${BASE}/${encodeURIComponent(id)}${action ? `/${action}` : ""}`;
    return Object.freeze({
      list: () => request("GET", BASE),
      install: (id) => request("POST", at(id, "install")),
      connect: (id) => request("POST", at(id, "connect")),
      disconnect: (id) => request("POST", at(id, "disconnect")),
      setReadOnlyTools: (id, tools) => request("PUT", at(id, "read-only-tools"), { tools }),
      uninstall: (id) => request("DELETE", at(id)),
    });
  }

  // Seules des URL https sans identifiants sont ouvertes dans le navigateur.
  function isOpenableAuthorizationUrl(raw) {
    try {
      const url = new URL(String(raw));
      return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
    } catch { return false; }
  }

  function createMcpConnectorsController({ elements, api, openExternal = null, confirmImpl = null, schedule = null }) {
    const root = elements?.root;
    if (!root || !api) throw new TypeError("root et api requis.");
    const doc = root.ownerDocument || global.document;
    const ask = typeof confirmImpl === "function" ? confirmImpl : (text) => (typeof global.confirm === "function" ? global.confirm(text) : false);
    const later = typeof schedule === "function" ? schedule : (fn, ms) => global.setTimeout(fn, ms);
    let available = false;
    let busy = false;
    let notice = null;
    let lastData = { catalog: [], servers: [] };
    const drafts = new Map(); // serverId -> Set des outils cochés, non encore enregistrés
    let pollToken = 0;

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

    function pill(state) {
      const node = el("span", "control-status-pill", STATE_LABELS[state] || state || "Inconnu");
      node.dataset.state = state || "UNKNOWN";
      return node;
    }

    function setNotice(text, kind = "info") { notice = text ? { text: String(text), kind } : null; }

    async function run(action, { successNotice = null } = {}) {
      if (busy) return;
      busy = true; render();
      try {
        await action();
        if (successNotice) setNotice(successNotice);
        await refresh({ keepNotice: true });
      } catch (error) {
        setNotice(messageFor(error), "error");
        await refresh({ keepNotice: true }).catch(() => {});
      } finally {
        busy = false; render();
      }
    }

    async function refresh({ keepNotice = false } = {}) {
      const data = await api.list();
      lastData = { catalog: Array.isArray(data.catalog) ? data.catalog : [], servers: Array.isArray(data.servers) ? data.servers : [] };
      if (!keepNotice) setNotice(null);
      render();
      return lastData;
    }

    function stopPolling() { pollToken += 1; }

    // Après ouverture de l'autorisation : relit l'état jusqu'à CONNECTED/ERROR/BLOCKED.
    function pollUntilSettled(serverId) {
      const token = ++pollToken;
      let attempts = 0;
      const tick = async () => {
        if (token !== pollToken) return;
        attempts += 1;
        try {
          const data = await refresh({ keepNotice: true });
          const state = data.servers.find((server) => server.id === serverId)?.status?.state;
          if (state === "CONNECTED") { setNotice("Connecté. Valide ensuite les outils à exposer."); render(); return; }
          if (state === "ERROR" || state === "BLOCKED" || state === "NOT_CONNECTED") { setNotice("Autorisation non aboutie. Relance la connexion si besoin.", "error"); render(); return; }
        } catch (error) { setNotice(messageFor(error), "error"); render(); return; }
        if (attempts >= POLL_MAX_ATTEMPTS) { setNotice("Délai d'autorisation dépassé. Relance la connexion.", "error"); render(); return; }
        later(tick, POLL_INTERVAL_MS);
      };
      later(tick, POLL_INTERVAL_MS);
    }

    async function connect(server) {
      stopPolling();
      const result = await api.connect(server.id);
      if (result.status === "AUTH_REQUIRED") {
        if (!isOpenableAuthorizationUrl(result.authorizationUrl)) throw Object.assign(new Error("URL invalide"), { code: "MCP_AUTHORIZATION_URL_INVALID" });
        if (typeof openExternal === "function") {
          await openExternal(String(result.authorizationUrl));
          setNotice(`Termine l'autorisation ${server.displayName} dans ton navigateur, puis reviens ici.`);
        } else {
          setNotice(`Ouvre cette adresse dans ton navigateur pour autoriser ${server.displayName} : ${result.authorizationUrl}`);
        }
        pollUntilSettled(server.id);
        return;
      }
      setNotice(`${server.displayName} connecté (${Number(result.toolCount) || 0} outil(s) proposés par le serveur).`);
    }

    function draftFor(server) {
      if (!drafts.has(server.id)) drafts.set(server.id, new Set(server.userApprovedReadOnly || []));
      return drafts.get(server.id);
    }

    function toolStatus(server, name) {
      const tools = server.tools || {};
      if ((tools.exposed || []).some((tool) => tool.name === name)) return "exposé à Noon";
      const hidden = (tools.hidden || []).find((tool) => tool.name === name);
      if (hidden) return HIDDEN_REASONS[hidden.reason] || "masqué";
      return server.status?.state === "CONNECTED" ? "non proposé par le serveur" : "connexion requise pour vérifier";
    }

    function renderTools(server) {
      const box = el("fieldset", "mcp-connectors__tools");
      box.append(el("legend", "", "Outils en lecture seule"));
      box.append(el("p", "mcp-connectors__hint", "Coche uniquement les outils que Noon peut appeler. Les outils d'écriture restent toujours masqués."));
      const draft = draftFor(server);
      const list = el("ul", "mcp-connectors__tool-list");
      for (const name of server.readOnlyTools || []) {
        const item = el("li");
        const label = el("label");
        const checkbox = el("input");
        checkbox.type = "checkbox";
        checkbox.checked = draft.has(name);
        checkbox.disabled = busy;
        checkbox.addEventListener("change", () => { if (checkbox.checked) draft.add(name); else draft.delete(name); render(); });
        label.append(checkbox, el("span", "mcp-connectors__tool-name", name));
        item.append(label, el("span", "mcp-connectors__tool-status", toolStatus(server, name)));
        list.append(item);
      }
      box.append(list);
      const saved = new Set(server.userApprovedReadOnly || []);
      const changed = draft.size !== saved.size || [...draft].some((name) => !saved.has(name));
      box.append(button("Enregistrer les outils validés", () => run(async () => {
        const tools = (server.readOnlyTools || []).filter((name) => draft.has(name));
        await api.setReadOnlyTools(server.id, tools);
        drafts.delete(server.id);
      }, { successNotice: "Outils validés enregistrés." }), { disabled: !changed }));
      return box;
    }

    function renderServer(server) {
      const card = el("article", "control-card mcp-connectors__server");
      const head = el("div", "control-card__head");
      const state = server.status?.state || "NOT_CONNECTED";
      head.append(el("h3", "", server.displayName || server.id), pill(state));
      card.append(head);
      if (server.note) card.append(el("p", "", server.note));
      const meta = el("div", "control-card__meta");
      try { meta.append(el("span", "", `Adresse : ${new URL(server.url).host}`)); } catch { /* URL du catalogue relu */ }
      meta.append(el("span", "", server.auth === "oauth" ? "Connexion : OAuth" : "Connexion : locale, sans jeton"));
      if (state === "CONNECTED") meta.append(el("span", "", `Outils proposés par le serveur : ${Number(server.status?.toolCount) || 0}`));
      card.append(meta);
      const actions = el("div", "control-card__actions");
      if (state !== "CONNECTED") actions.append(button(state === "AUTH_REQUIRED" ? "Relancer l'autorisation" : "Connecter", () => run(() => connect(server))));
      if (state === "CONNECTED" || server.status?.hasCredentials) {
        actions.append(button("Déconnecter", () => run(async () => { stopPolling(); await api.disconnect(server.id); }, { successNotice: "Déconnecté. Les jetons locaux sont supprimés ; l'accès n'est pas révoqué chez le fournisseur." })));
      }
      actions.append(button("Désinstaller", () => {
        if (!ask(`Désinstaller ${server.displayName} ? Les jetons locaux et les outils validés seront supprimés.`)) return Promise.resolve();
        return run(async () => { stopPolling(); await api.uninstall(server.id); drafts.delete(server.id); }, { successNotice: "Serveur désinstallé." });
      }));
      card.append(actions, renderTools(server));
      return card;
    }

    function renderCatalogEntry(entry) {
      const card = el("article", "control-card mcp-connectors__catalog");
      const head = el("div", "control-card__head");
      head.append(el("h3", "", entry.displayName || entry.id));
      card.append(head);
      if (entry.note) card.append(el("p", "", entry.note));
      const actions = el("div", "control-card__actions");
      actions.append(button("Installer", () => run(() => api.install(entry.id), { successNotice: `${entry.displayName} installé. Connecte-le puis valide ses outils.` })));
      card.append(actions);
      return card;
    }

    function render() {
      if (!available) { root.hidden = true; return; }
      root.hidden = false;
      const header = el("header", "control-section__header");
      const title = el("div");
      title.append(
        el("h2", "", "Connecteurs MCP"),
        el("p", "", "Lecture seule. Un outil n'est exposé à Noon qu'après ta validation ; les résultats sont traités comme des données externes non fiables."),
      );
      header.append(title);
      const nodes = [header];
      if (notice) {
        const box = el("p", "control-center__notice", notice.text);
        box.setAttribute("role", notice.kind === "error" ? "alert" : "status");
        box.dataset.kind = notice.kind;
        nodes.push(box);
      }
      const installed = lastData.servers;
      if (installed.length) {
        const grid = el("div", "control-center__grid");
        for (const server of installed) grid.append(renderServer(server));
        nodes.push(el("h3", "mcp-connectors__subtitle", "Serveurs installés"), grid);
      }
      const available_ = lastData.catalog.filter((entry) => !entry.installed);
      if (available_.length) {
        const grid = el("div", "control-center__grid");
        for (const entry of available_) grid.append(renderCatalogEntry(entry));
        nodes.push(el("h3", "mcp-connectors__subtitle", "Catalogue"), grid);
      }
      if (!installed.length && !available_.length) nodes.push(el("div", "control-empty", "Aucun serveur MCP disponible."));
      root.replaceChildren(...nodes);
    }

    // Retourne true si le flag est actif (GET 200), false sinon (404 MCP_DISABLED ou erreur).
    async function init() {
      try {
        available = true;
        await refresh();
        return true;
      } catch (error) {
        available = false;
        render();
        return false;
      }
    }

    return Object.freeze({ init, refresh, render, stopPolling, isAvailable: () => available });
  }

  global.NoonMcpConnectorsUi = Object.freeze({
    ERROR_MESSAGES, HIDDEN_REASONS, POLL_INTERVAL_MS, POLL_MAX_ATTEMPTS, STATE_LABELS,
    createMcpConnectorsApi, createMcpConnectorsController, isOpenableAuthorizationUrl, messageFor,
  });
})(typeof window !== "undefined" ? window : globalThis);
