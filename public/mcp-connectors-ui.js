"use strict";

// UI des connecteurs MCP (Control Center), derrière le flag connectors.mcp.
// Phase 1 : serveurs du catalogue, outils en lecture seule validés un par un.
// Phase 2 : outils d'écriture cochés par l'utilisateur ; chaque appel demande ensuite une
// approbation exacte dans le chat (serveur, outil, arguments).
// Phase 3 : serveur ajouté par URL (HTTPS, sans secret dans l'URL) ; outils différés signalés.
// Phase 5 : plugins déclaratifs importés d'un fichier JSON local, relus avant installation.
// Phase 6 : serveurs à jeton personnel (GitHub) : champ masqué, jamais relu.
// Toutes les valeurs serveur sont rendues avec textContent : aucun nom de
// serveur, d'outil ou d'erreur ne devient du HTML. Aucun jeton n'arrive ici :
// le serveur ne renvoie que l'état et, pendant une connexion OAuth, l'URL
// d'autorisation à ouvrir dans le navigateur.
(function attachMcpConnectorsUi(global) {
  const BASE = "/api/mcp/servers";
  const PLUGINS = "/api/mcp/plugins";
  const POLL_INTERVAL_MS = 2000;
  const POLL_MAX_ATTEMPTS = 150; // 5 minutes, puis arrêt explicite.

  const STATE_LABELS = Object.freeze({
    NOT_CONNECTED: "Non connecté",
    CONNECTING: "Connexion…",
    CONNECTED: "Connecté",
    AUTH_REQUIRED: "Autorisation requise",
    BLOCKED: "Bloqué (local uniquement ou hors ligne)",
    ERROR: "Erreur",
    UNAVAILABLE: "Indisponible",
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
    MCP_LOCAL_SERVER_UNREACHABLE: "Serveur local introuvable sur ce Mac. Pour Figma : ouvre un fichier, passe en Dev Mode (Maj+D), puis « Enable desktop MCP server » (siège Dev ou Full requis).",
    MCP_CLIENT_NOT_ACCEPTED: "Indisponible : ce fournisseur n'accepte pas Noon sur son serveur en ligne.",
    MCP_PROJECT_REF_INVALID: "Identifiant de projet invalide.",
    MCP_TOOL_NAME_INVALID: "Nom d'outil invalide.",
    MCP_TOOL_LIST_TOO_LONG: "Trop d'outils d'écriture cochés (50 au plus).",
    MCP_SERVER_NAME_REQUIRED: "Donne un nom au serveur.",
    MCP_SERVER_URL_INVALID: "Adresse de serveur invalide.",
    MCP_SERVER_URL_INSECURE: "Un serveur distant doit utiliser HTTPS.",
    MCP_SERVER_URL_SECRET: "L'adresse semble contenir un secret : retire-le, la connexion passera par l'autorisation du serveur.",
    MCP_CUSTOM_LIMIT: "Limite atteinte : 10 serveurs ajoutés par URL.",
    MCP_SERVER_DUPLICATE: "Ce serveur est déjà ajouté.",
    MCP_TOKEN_INVALID: "Jeton invalide : colle le jeton complet, sans espace.",
    MCP_TOKEN_REQUIRED: "Jeton d'accès requis pour ce serveur.",
    MCP_TOKEN_REJECTED: "Jeton refusé par le serveur : il est peut-être expiré, révoqué ou trop limité.",
    MCP_TOKEN_NOT_SUPPORTED: "Ce serveur n'utilise pas de jeton personnel.",
    MCP_PLUGIN_INVALID: "Fichier de plugin invalide.",
    MCP_PLUGIN_UNKNOWN_FIELD: "Le plugin contient un champ inconnu : refusé.",
    MCP_PLUGIN_SCHEMA: "Format de plugin non reconnu (attendu : noon.plugin/1).",
    MCP_PLUGIN_INSTRUCTIONS_TOO_LONG: "Consigne du plugin trop longue.",
    MCP_PLUGIN_DUPLICATE: "Ce plugin est déjà installé : désinstalle-le d'abord pour le mettre à jour.",
    MCP_PLUGIN_LIMIT: "Limite atteinte : 10 plugins.",
    MCP_PLUGIN_UNKNOWN: "Plugin inconnu.",
    MCP_PLUGIN_FILE_UNREADABLE: "Fichier illisible : choisis un fichier JSON de plugin Noon.",
  });

  const HIDDEN_REASONS = Object.freeze({
    DESTRUCTIVE_HINT: "masqué : le serveur le déclare destructif",
    SERVER_DECLARES_WRITE: "masqué : le serveur le déclare en écriture",
    NOT_DECLARED_READ_ONLY: "masqué : non déclaré en lecture seule",
    READ_ONLY_NOT_APPROVED_BY_USER: "non validé",
    MCP_SCHEMA_UNSUPPORTED: "masqué : paramètres non pris en charge",
    WRITE_NOT_APPROVED_BY_USER: "écriture non autorisée",
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
      let payload;
      try { payload = await response.json(); } catch { payload = {}; }
      if (!response.ok) throw apiError(response.status, payload);
      return payload;
    }
    const at = (id, action = "") => `${BASE}/${encodeURIComponent(id)}${action ? `/${action}` : ""}`;
    return Object.freeze({
      list: () => request("GET", BASE),
      addCustom: (displayName, url) => request("POST", BASE, { displayName, url }),
      listPlugins: () => request("GET", PLUGINS),
      installPlugin: (manifest) => request("POST", PLUGINS, { manifest }),
      uninstallPlugin: (id) => request("DELETE", `${PLUGINS}/${encodeURIComponent(id)}`),
      install: (id, options = {}) => request("POST", at(id, "install"), options),
      connect: (id) => request("POST", at(id, "connect")),
      disconnect: (id) => request("POST", at(id, "disconnect")),
      setReadOnlyTools: (id, tools) => request("PUT", at(id, "read-only-tools"), { tools }),
      setWriteTools: (id, tools) => request("PUT", at(id, "write-tools"), { tools }),
      setToken: (id, token) => request("PUT", at(id, "token"), { token }),
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
    let lastData = { catalog: [], servers: [], plugins: [] };
    let pluginReview = null; // manifeste lu depuis un fichier, en attente de relecture
    const drafts = new Map(); // serverId -> Set des outils cochés, non encore enregistrés
    const writeDrafts = new Map(); // serverId -> Set des outils d'écriture cochés, non encore enregistrés
    const projectRefs = new Map(); // catalogue -> identifiant de projet saisi
    const customDraft = { displayName: "", url: "" }; // formulaire « Ajouter un serveur par URL »
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
      let plugins;
      try { plugins = (await api.listPlugins()).plugins || []; } catch { plugins = []; }
      lastData = { catalog: Array.isArray(data.catalog) ? data.catalog : [], servers: Array.isArray(data.servers) ? data.servers : [], plugins: Array.isArray(plugins) ? plugins : [] };
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
      const exposed = (tools.exposed || []).find((tool) => tool.name === name);
      if (exposed) return exposed.deferred ? "exposé à Noon (trouvé par recherche d'outils)" : "exposé à Noon";
      const hidden = (tools.hidden || []).find((tool) => tool.name === name);
      if (hidden) return HIDDEN_REASONS[hidden.reason] || "masqué";
      return server.status?.state === "CONNECTED" ? "non proposé par le serveur" : "connexion requise pour vérifier";
    }

    // Serveur du catalogue : sa liste relue. Serveur ajouté par URL : les outils que le serveur
    // annonce en lecture seule (readOnlyHint), plus ceux déjà validés.
    function readOnlyCandidates(server) {
      if (!server.custom) return [...(server.readOnlyTools || [])];
      const tools = server.tools || {};
      const names = [
        ...(tools.exposed || []).filter((tool) => tool.level === "READ"),
        ...(tools.hidden || []).filter((tool) => tool.reason === "READ_ONLY_NOT_APPROVED_BY_USER"),
      ].map((tool) => String(tool.name));
      return [...new Set([...names, ...(server.userApprovedReadOnly || [])])].sort();
    }

    function renderTools(server) {
      const box = el("fieldset", "mcp-connectors__tools");
      box.append(el("legend", "", "Outils en lecture seule"));
      box.append(el("p", "mcp-connectors__hint", "Coche uniquement les outils que Noon peut appeler sans te demander."));
      const draft = draftFor(server);
      const list = el("ul", "mcp-connectors__tool-list");
      for (const name of readOnlyCandidates(server)) {
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
        const tools = readOnlyCandidates(server).filter((name) => draft.has(name));
        await api.setReadOnlyTools(server.id, tools);
        drafts.delete(server.id);
      }, { successNotice: "Outils validés enregistrés." }), { disabled: !changed }));
      return box;
    }

    // Outils d'écriture proposés par le serveur (ni lecture seule, ni destructifs).
    function writeToolNames(server) {
      const tools = server.tools || {};
      const names = [
        ...(tools.exposed || []).filter((tool) => tool.level === "WRITE"),
        ...(tools.hidden || []).filter((tool) => tool.reason === "WRITE_NOT_APPROVED_BY_USER"),
      ].map((tool) => String(tool.name));
      return [...new Set([...names, ...(server.userApprovedWriteTools || [])])].sort();
    }

    function renderWriteTools(server) {
      const box = el("fieldset", "mcp-connectors__tools mcp-connectors__tools--write");
      box.append(el("legend", "", "Outils d'écriture"));
      box.append(el("p", "mcp-connectors__hint", "Un outil coché devient visible pour Noon, mais chaque appel attend ta confirmation exacte dans le chat (serveur, outil, arguments). Les outils destructifs restent masqués."));
      const names = writeToolNames(server);
      if (!names.length) {
        box.append(el("p", "mcp-connectors__hint", server.status?.state === "CONNECTED" ? "Aucun outil d'écriture proposé par ce serveur." : "Connecte le serveur pour voir ses outils d'écriture."));
        return box;
      }
      if (!writeDrafts.has(server.id)) writeDrafts.set(server.id, new Set(server.userApprovedWriteTools || []));
      const draft = writeDrafts.get(server.id);
      const list = el("ul", "mcp-connectors__tool-list");
      for (const name of names) {
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
      const saved = new Set(server.userApprovedWriteTools || []);
      const added = [...draft].filter((name) => !saved.has(name));
      const changed = added.length > 0 || [...saved].some((name) => !draft.has(name));
      box.append(button("Enregistrer les outils d'écriture", () => {
        if (added.length && !ask(`Autoriser Noon à proposer ${added.length} outil(s) d'écriture sur ${server.displayName} ? Rien ne partira sans ta confirmation exacte, appel par appel.`)) return Promise.resolve();
        return run(async () => {
          await api.setWriteTools(server.id, names.filter((name) => draft.has(name)));
          writeDrafts.delete(server.id);
        }, { successNotice: "Outils d'écriture enregistrés." });
      }, { disabled: !changed }));
      return box;
    }

    // Jeton personnel : champ masqué, jamais pré-rempli ni relu ; vidé dès l'envoi.
    function renderTokenField(server) {
      const box = el("div", "mcp-connectors__token");
      if (server.tokenHelp) box.append(el("p", "mcp-connectors__hint", server.tokenHelp));
      const label = el("label", "mcp-connectors__project");
      const input = el("input");
      input.type = "password";
      input.autocomplete = "off";
      input.spellcheck = false;
      input.disabled = busy;
      label.append(el("span", "", server.status?.hasCredentials ? "Remplacer le jeton d'accès" : "Jeton d'accès personnel"), input);
      const save = button("Enregistrer le jeton et connecter", () => {
        const token = String(input.value || "").trim();
        input.value = "";
        return run(async () => { await api.setToken(server.id, token); }, { successNotice: `${server.displayName} connecté. Valide ensuite les outils à exposer.` });
      });
      const validate = () => { save.disabled = busy || String(input.value || "").trim().length < 20; };
      input.addEventListener("input", validate);
      validate();
      const actions = el("div", "control-card__actions");
      actions.append(save);
      box.append(label, actions);
      return box;
    }

    function renderServer(server) {
      const card = el("article", "control-card mcp-connectors__server");
      const head = el("div", "control-card__head");
      const state = server.status?.state || "NOT_CONNECTED";
      head.append(el("h3", "", server.displayName || server.id), pill(state));
      card.append(head);
      if (server.note) card.append(el("p", "", server.note));
      if (server.unavailable) card.append(el("p", "mcp-connectors__unavailable", server.unavailable.message));
      const meta = el("div", "control-card__meta");
      try { meta.append(el("span", "", `Adresse : ${new URL(server.url).host}`)); } catch { /* URL du catalogue relu */ }
      if (server.projectRef) meta.append(el("span", "", `Projet : ${server.projectRef}`));
      if (server.custom) meta.append(el("span", "", "Ajouté par URL"));
      meta.append(el("span", "", server.auth === "oauth" ? "Connexion : OAuth" : server.auth === "token" ? "Connexion : jeton personnel, chiffré sur ce Mac" : "Connexion : locale, sans jeton"));
      if (state === "CONNECTED") meta.append(el("span", "", `Outils proposés par le serveur : ${Number(server.status?.toolCount) || 0}`));
      card.append(meta);
      const actions = el("div", "control-card__actions");
      const tokenServer = server.auth === "token";
      if (tokenServer && !server.unavailable) card.append(renderTokenField(server));
      if (state !== "CONNECTED" && !server.unavailable && (!tokenServer || server.status?.hasCredentials)) actions.append(button(state === "AUTH_REQUIRED" && !tokenServer ? "Relancer l'autorisation" : "Connecter", () => run(() => connect(server))));
      if (state === "CONNECTED" || server.status?.hasCredentials) {
        actions.append(button("Déconnecter", () => run(async () => { stopPolling(); await api.disconnect(server.id); }, { successNotice: "Déconnecté. Les jetons locaux sont supprimés ; l'accès n'est pas révoqué chez le fournisseur." })));
      }
      actions.append(button("Désinstaller", () => {
        if (!ask(`Désinstaller ${server.displayName} ? Les jetons locaux et les outils validés seront supprimés.`)) return Promise.resolve();
        return run(async () => { stopPolling(); await api.uninstall(server.id); drafts.delete(server.id); writeDrafts.delete(server.id); }, { successNotice: "Serveur désinstallé." });
      }));
      card.append(actions, renderTools(server), renderWriteTools(server));
      return card;
    }

    function renderCatalogEntry(entry) {
      const card = el("article", "control-card mcp-connectors__catalog");
      const head = el("div", "control-card__head");
      head.append(el("h3", "", entry.displayName || entry.id));
      card.append(head);
      if (entry.note) card.append(el("p", "", entry.note));
      if (entry.unavailable) {
        head.append(pill("UNAVAILABLE"));
        card.append(el("p", "mcp-connectors__unavailable", entry.unavailable.message));
        return card;
      }
      const actions = el("div", "control-card__actions");
      // Serveur limité à un projet : l'identifiant est demandé avant l'installation.
      const install = button("Installer", () => run(() => api.install(entry.id, entry.projectRef ? { projectRef: String(projectRefs.get(entry.id) || "").trim() } : {}), { successNotice: `${entry.displayName} installé. Connecte-le puis valide ses outils.` }));
      if (entry.projectRef) {
        const field = el("label", "mcp-connectors__project");
        const input = el("input");
        input.type = "text";
        input.autocomplete = "off";
        input.spellcheck = false;
        input.value = projectRefs.get(entry.id) || "";
        input.disabled = busy;
        let pattern = null;
        try { pattern = new RegExp(String(entry.projectRef.pattern)); } catch { pattern = null; }
        const validate = () => { install.disabled = busy || !(pattern && pattern.test(input.value.trim())); };
        // Pas de nouveau rendu à la frappe : le champ garde le focus, seul le bouton suit.
        input.addEventListener("input", () => { projectRefs.set(entry.id, input.value); validate(); });
        validate();
        field.append(el("span", "", entry.projectRef.label || "Identifiant du projet"), input);
        card.append(field);
      }
      actions.append(install);
      card.append(actions);
      return card;
    }

    function renderAddCustom() {
      const card = el("article", "control-card mcp-connectors__custom");
      card.append(el("h3", "", "Ajouter un serveur par URL"));
      card.append(el("p", "mcp-connectors__hint", "N'ajoute que des serveurs de confiance : un serveur MCP reçoit ce que Noon lui envoie. Adresse HTTPS, sans clé ni jeton dedans ; la connexion passe par l'autorisation du serveur."));
      const field = (labelText, key, type) => {
        const label = el("label", "mcp-connectors__project");
        const input = el("input");
        input.type = type;
        input.autocomplete = "off";
        input.spellcheck = false;
        input.value = customDraft[key];
        input.disabled = busy;
        input.dataset.field = key;
        label.append(el("span", "", labelText), input);
        card.append(label);
        return input;
      };
      const name = field("Nom", "displayName", "text");
      const address = field("Adresse du serveur MCP (https://…)", "url", "url");
      const add = button("Ajouter", () => run(async () => {
        await api.addCustom(customDraft.displayName.trim(), customDraft.url.trim());
        customDraft.displayName = ""; customDraft.url = "";
      }, { successNotice: "Serveur ajouté. Connecte-le puis valide ses outils." }));
      // Pas de nouveau rendu à la frappe : les champs gardent le focus, seul le bouton suit.
      const validate = () => { add.disabled = busy || !customDraft.displayName.trim() || !customDraft.url.trim(); };
      for (const input of [name, address]) input.addEventListener("input", () => { customDraft[input.dataset.field] = input.value; validate(); });
      validate();
      const actions = el("div", "control-card__actions");
      actions.append(add);
      card.append(actions);
      return card;
    }

    // Lecture locale du fichier choisi : rien n'est envoyé avant la relecture et la confirmation.
    async function readPluginFile(file) {
      try {
        const manifest = JSON.parse(await file.text());
        if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("format");
        pluginReview = manifest;
        setNotice(null);
      } catch {
        pluginReview = null;
        setNotice(ERROR_MESSAGES.MCP_PLUGIN_FILE_UNREADABLE, "error");
      }
      render();
    }

    function pluginServerLines(servers) {
      const list = el("ul", "mcp-connectors__tool-list");
      for (const server of Array.isArray(servers) ? servers : []) {
        let host = String(server?.host || "");
        if (!host) { try { host = new URL(String(server?.url)).host; } catch { host = "adresse invalide"; } }
        const item = el("li");
        item.append(el("span", "mcp-connectors__tool-name", String(server?.displayName || server?.key || "Serveur")), el("span", "mcp-connectors__tool-status", host));
        list.append(item);
      }
      return list;
    }

    function renderPlugins() {
      const nodes = [];
      const grid = el("div", "control-center__grid");
      for (const plugin of lastData.plugins) {
        const card = el("article", "control-card mcp-connectors__plugin");
        const head = el("div", "control-card__head");
        head.append(el("h3", "", `${plugin.name} ${plugin.version}`));
        card.append(head);
        if (plugin.description) card.append(el("p", "", plugin.description));
        card.append(pluginServerLines(plugin.servers));
        if (plugin.instructions) card.append(el("p", "mcp-connectors__hint", `Consigne pour Noon : ${plugin.instructions}`));
        const actions = el("div", "control-card__actions");
        actions.append(button("Désinstaller le plugin", () => {
          if (!ask(`Désinstaller le plugin ${plugin.name} ? Ses serveurs, leurs jetons locaux et leurs outils validés seront supprimés.`)) return Promise.resolve();
          return run(() => api.uninstallPlugin(plugin.id), { successNotice: "Plugin désinstallé." });
        }));
        card.append(actions);
        grid.append(card);
      }
      const importCard = el("article", "control-card mcp-connectors__plugin-import");
      importCard.append(el("h3", "", "Importer un plugin"));
      importCard.append(el("p", "mcp-connectors__hint", "Un plugin Noon est un fichier JSON (noon.plugin/1) qui regroupe des serveurs MCP et une consigne d'usage. Aucun code n'est exécuté ; ses outils restent à valider un par un, et chaque écriture demande ta confirmation."));
      if (pluginReview) {
        const review = el("div", "mcp-connectors__plugin-review");
        review.append(el("strong", "", `${String(pluginReview.name || pluginReview.id || "Plugin")} ${String(pluginReview.version || "")}`.trim()));
        if (pluginReview.description) review.append(el("p", "", String(pluginReview.description)));
        review.append(el("p", "mcp-connectors__hint", "Serveurs qui seront ajoutés :"), pluginServerLines(pluginReview.mcpServers));
        review.append(el("p", "mcp-connectors__hint", pluginReview.instructions ? `Consigne transmise à Noon : ${String(pluginReview.instructions)}` : "Aucune consigne pour Noon."));
        const actions = el("div", "control-card__actions");
        actions.append(
          button("Installer ce plugin", () => {
            const manifest = pluginReview;
            if (!ask(`Installer le plugin ${String(manifest.name || manifest.id)} ? Ses serveurs reçoivent ce que Noon leur envoie.`)) return Promise.resolve();
            return run(async () => { await api.installPlugin(manifest); pluginReview = null; }, { successNotice: "Plugin installé. Connecte ses serveurs puis valide leurs outils." });
          }),
          button("Annuler", () => { pluginReview = null; render(); return Promise.resolve(); }),
        );
        review.append(actions);
        importCard.append(review);
      } else {
        const label = el("label", "mcp-connectors__project");
        const input = el("input");
        input.type = "file";
        input.accept = "application/json,.json";
        input.disabled = busy;
        input.addEventListener("change", () => { const file = input.files?.[0]; if (file) void readPluginFile(file); });
        label.append(el("span", "", "Fichier du plugin (.json)"), input);
        importCard.append(label);
      }
      grid.append(importCard);
      nodes.push(el("h3", "mcp-connectors__subtitle", "Plugins"), grid);
      return nodes;
    }

    function render() {
      if (!available) { root.hidden = true; return; }
      root.hidden = false;
      const header = el("header", "control-section__header");
      const title = el("div");
      title.append(
        el("h2", "", "Connecteurs MCP"),
        el("p", "", "Un outil n'est exposé à Noon qu'après ta validation ; chaque écriture attend en plus ta confirmation exacte. Les résultats sont traités comme des données externes non fiables."),
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
      const custom = el("div", "control-center__grid");
      custom.append(renderAddCustom());
      nodes.push(el("h3", "mcp-connectors__subtitle", "Autre serveur"), custom, ...renderPlugins());
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
