"use strict";

// UI « Compagnon iPhone » (Control Center), derrière le flag remote.lan (IP-3).
// Démarrer/arrêter la passerelle LAN, afficher l'invitation en QR, comparer le code de
// vérification, accorder des scopes, refuser, révoquer. Rendu en textContent et SVG
// construit nœud par nœud : aucune valeur serveur ne devient du HTML. Aucun stockage navigateur.
(function attachIphoneCompanionUi(global) {
  const BASE = "/api/remote-lan";
  const SVG_NS = "http://www.w3.org/2000/svg";

  const STATUS_LABELS = Object.freeze({ ACTIVE: "Actif", REVOKED: "Révoqué", SUSPENDED: "Suspendu" });
  const ERROR_MESSAGES = Object.freeze({
    REMOTE_LAN_DISABLED: "Passerelle iPhone désactivée.",
    REMOTE_LAN_KEYSTORE_UNAVAILABLE: "Coffre sécurisé macOS indisponible : la passerelle ne peut pas conserver l'identité du Mac.",
    REMOTE_LAN_NO_NETWORK: "Aucun réseau local détecté. Connecte le Mac au Wi-Fi ou à l'Ethernet.",
    REMOTE_LAN_PORT_IN_USE: "Le port de la passerelle est déjà utilisé par une autre application.",
    REMOTE_LAN_LISTEN_FAILED: "Impossible d'ouvrir l'écoute réseau (pare-feu macOS ?).",
    REMOTE_LAN_NOT_LISTENING: "Démarre d'abord la passerelle.",
    REMOTE_LAN_PAIRING_UNAVAILABLE: "Demande d'appairage expirée ou déjà traitée.",
    PAIRING_SCOPE_ESCALATION: "Choisis au moins une autorisation parmi celles demandées.",
    PAIRING_EXPIRED: "Demande d'appairage expirée : crée une nouvelle invitation.",
    REMOTE_LAN_DEVICE_UNKNOWN: "Appareil inconnu.",
    REMOTE_LAN_REQUEST_REFUSED: "Requête refusée par Noon.",
  });
  const messageFor = (error) => ERROR_MESSAGES[String(error?.code || "")] || "Erreur de la passerelle iPhone.";

  function createIphoneCompanionApi({ fetchImpl }) {
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
      if (!response.ok) throw Object.assign(new Error(String(payload.message || "Erreur.")), { code: String(payload.code || (response.status === 404 ? "REMOTE_LAN_DISABLED" : "REMOTE_LAN_ERROR")), status: response.status });
      return payload;
    }
    const enc = encodeURIComponent;
    return Object.freeze({
      status: () => request("GET", `${BASE}/status`),
      start: () => request("POST", `${BASE}/start`, {}),
      stop: () => request("POST", `${BASE}/stop`, {}),
      invite: () => request("POST", `${BASE}/invitations`, {}),
      approve: (pairingId, grantedScopes) => request("POST", `${BASE}/pairings/${enc(pairingId)}/approve`, { grantedScopes }),
      reject: (pairingId) => request("POST", `${BASE}/pairings/${enc(pairingId)}/reject`, {}),
      revoke: (deviceId) => request("POST", `${BASE}/devices/${enc(deviceId)}/revoke`, {}),
    });
  }

  // Dessine la matrice de modules ("0"/"1") en SVG, avec la zone de silence réglementaire.
  function qrSvg(doc, modules) {
    const size = modules.length;
    const quiet = 4;
    const svg = doc.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${size + quiet * 2} ${size + quiet * 2}`);
    svg.setAttribute("class", "iphone-companion__qr");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "QR code d'invitation à scanner avec l'iPhone");
    svg.setAttribute("shape-rendering", "crispEdges");
    const background = doc.createElementNS(SVG_NS, "rect");
    background.setAttribute("width", "100%"); background.setAttribute("height", "100%"); background.setAttribute("fill", "#fff");
    svg.append(background);
    let d = "";
    modules.forEach((row, y) => { for (let x = 0; x < row.length; x += 1) if (row[x] === "1") d += `M${x + quiet} ${y + quiet}h1v1h-1z`; });
    const path = doc.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d); path.setAttribute("fill", "#000");
    svg.append(path);
    return svg;
  }

  function createIphoneCompanionController({ elements, api, confirmImpl = null, now = () => Date.now(), setTimer = global.setTimeout?.bind(global), clearTimer = global.clearTimeout?.bind(global) }) {
    const root = elements?.root;
    if (!root || !api) throw new TypeError("root et api requis.");
    const doc = root.ownerDocument || global.document;
    const ask = typeof confirmImpl === "function" ? confirmImpl : (text) => (typeof global.confirm === "function" ? global.confirm(text) : false);
    let available = false;
    let busy = false;
    let notice = null;
    let data = null;
    let invitation = null;
    let poll = null;
    const choices = new Map(); // pairingId → Set(scopes)

    const el = (tag, className = "", text = null) => { const node = doc.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = String(text); return node; };
    function button(label, onClick, { disabled = false, kind = "" } = {}) {
      const node = el("button", kind, label);
      node.type = "button"; node.disabled = busy || disabled;
      node.addEventListener("click", () => { void onClick(); });
      return node;
    }
    const setNotice = (text, kind = "info") => { notice = text ? { text: String(text), kind } : null; };
    const label = (scope) => data?.scopeLabels?.[scope] || scope;

    // Pendant qu'une invitation est affichée, l'état est relu toutes les 3 s pour faire
    // apparaître la demande d'appairage ; l'attente s'arrête à l'expiration de l'invitation.
    function schedulePoll() {
      if (poll && clearTimer) clearTimer(poll);
      poll = null;
      if (!invitation || !setTimer) return;
      if (Date.parse(invitation.expiresAt) <= now()) { invitation = null; render(); return; }
      poll = setTimer(() => { poll = null; void refresh({ keepNotice: true }).catch(() => {}); }, 3000);
    }

    async function refresh({ keepNotice = false } = {}) {
      const payload = await api.status();
      data = payload.lan || null;
      if (!data?.listening) invitation = null;
      if (data?.pendingPairings?.length) invitation = null; // l'iPhone a scanné : place à la vérification
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

    function renderGateway() {
      const card = el("section", "control-card");
      card.append(el("h3", "", "Passerelle réseau local"));
      if (!data.keystore) card.append(el("p", "control-center__notice", ERROR_MESSAGES.REMOTE_LAN_KEYSTORE_UNAVAILABLE));
      if (data.listening) {
        card.append(el("p", "", `À l'écoute sur ${data.host}:${data.port} (réseau local uniquement).`));
        if (data.macFingerprint) card.append(el("p", "iphone-companion__hint", `Empreinte du Mac : ${data.macFingerprint.replace(/(.{4})/g, "$1 ").trim()}`));
        const actions = el("div", "control-card__actions");
        actions.append(button(invitation ? "Nouvelle invitation" : "Inviter un iPhone", () => run(async () => { invitation = (await api.invite()).invitation; })));
        actions.append(button("Arrêter", () => run(async () => { invitation = null; await api.stop(); }, "Passerelle arrêtée.")));
        card.append(actions);
      } else {
        card.append(el("p", "", "Arrêtée. Rien n'écoute sur le réseau. Le démarrage n'est jamais automatique : il faut le relancer ici après chaque ouverture de Noon."));
        const actions = el("div", "control-card__actions");
        actions.append(button("Démarrer", () => run(() => api.start(), "Passerelle démarrée. macOS peut demander d'autoriser les connexions entrantes."), { disabled: !data.keystore }));
        card.append(actions);
      }
      return card;
    }

    function renderInvitation() {
      const card = el("section", "control-card iphone-companion__invitation");
      card.append(el("h3", "", "Scanne ce code avec l'app Noon de l'iPhone"));
      if (Array.isArray(invitation.modules) && invitation.modules.length) card.append(qrSvg(doc, invitation.modules));
      const expires = new Date(invitation.expiresAt);
      card.append(el("p", "iphone-companion__hint", `Usage unique, valable jusqu'à ${expires.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}. L'iPhone doit être sur le même réseau Wi-Fi.`));
      return card;
    }

    function renderPairing(pairing) {
      const card = el("section", "control-card iphone-companion__pairing");
      card.append(el("h3", "", `Demande d'appairage : ${pairing.displayName}`));
      card.append(el("p", "", "Vérifie que l'iPhone affiche exactement ce code. S'il est différent, refuse."));
      card.append(el("p", "iphone-companion__code", `${pairing.verificationCode.slice(0, 3)} ${pairing.verificationCode.slice(3)}`));
      if (!choices.has(pairing.pairingId)) choices.set(pairing.pairingId, new Set());
      const selected = choices.get(pairing.pairingId);
      const fieldset = el("fieldset", "iphone-companion__scopes");
      fieldset.append(el("legend", "", "Autorisations accordées (parmi celles demandées)"));
      for (const scope of pairing.requestedScopes) {
        const wrapper = el("label", "");
        const input = el("input"); input.type = "checkbox"; input.checked = selected.has(scope); input.disabled = busy;
        input.addEventListener("change", () => { if (input.checked) selected.add(scope); else selected.delete(scope); render(); });
        wrapper.append(input, doc.createTextNode(` ${label(scope)}`));
        fieldset.append(wrapper);
      }
      card.append(fieldset);
      const actions = el("div", "control-card__actions");
      actions.append(button("Les codes sont identiques : approuver", () => run(async () => { await api.approve(pairing.pairingId, [...selected]); choices.delete(pairing.pairingId); }, `${pairing.displayName} est appairé.`), { disabled: selected.size === 0 }));
      actions.append(button("Refuser", () => run(async () => { await api.reject(pairing.pairingId); choices.delete(pairing.pairingId); }, "Demande refusée."), { kind: "danger" }));
      card.append(actions);
      return card;
    }

    function renderDevices() {
      const card = el("section", "control-card");
      card.append(el("h3", "", "Appareils appairés"));
      const devices = data.devices || [];
      if (!devices.length) { card.append(el("p", "iphone-companion__hint", "Aucun iPhone appairé.")); return card; }
      const list = el("ul", "iphone-companion__devices");
      for (const device of devices) {
        const item = el("li", "");
        const pill = el("span", "control-status-pill", STATUS_LABELS[device.status] || device.status);
        pill.dataset.state = device.status === "ACTIVE" ? "OK" : "WARNING";
        item.append(el("strong", "", device.displayName), doc.createTextNode(" "), pill);
        item.append(el("p", "iphone-companion__hint", `Autorisations : ${(device.scopes || []).map(label).join(", ") || "aucune"}${device.lastSeenAt ? ` · vu le ${new Date(device.lastSeenAt).toLocaleString("fr-FR")}` : ""}`));
        if (device.status === "ACTIVE") {
          item.append(button("Révoquer", () => run(async () => {
            if (!ask(`Révoquer ${device.displayName} ? Il ne pourra plus rien demander au Mac sans nouvel appairage.`)) throw Object.assign(new Error("annulé"), { code: "CANCELLED" });
            await api.revoke(device.deviceId);
          }, `${device.displayName} est révoqué.`), { kind: "danger" }));
        }
        list.append(item);
      }
      card.append(list);
      return card;
    }

    function render() {
      if (!available || !data) { root.hidden = true; return; }
      root.hidden = false;
      const header = el("header", "control-section__header");
      const title = el("div");
      title.append(el("h2", "", "Compagnon iPhone"), el("p", "", "Appaire un iPhone sur le réseau local. Le Mac reste l'unique autorité : l'iPhone ne reçoit ni secret, ni mémoire privée, et ne peut rien exécuter."));
      header.append(title);
      const nodes = [header];
      if (notice) {
        const box = el("p", "control-center__notice", notice.text);
        box.setAttribute("role", notice.kind === "error" ? "alert" : "status");
        box.dataset.kind = notice.kind;
        nodes.push(box);
      }
      nodes.push(renderGateway());
      for (const pairing of data.pendingPairings || []) nodes.push(renderPairing(pairing));
      if (invitation && data.listening) nodes.push(renderInvitation());
      nodes.push(renderDevices());
      root.replaceChildren(...nodes);
    }

    async function init() {
      try { available = true; await refresh(); return true; }
      catch { available = false; render(); return false; }
    }

    return Object.freeze({ init, refresh, render, isAvailable: () => available });
  }

  global.NoonIphoneCompanionUi = Object.freeze({ ERROR_MESSAGES, createIphoneCompanionApi, createIphoneCompanionController, messageFor, qrSvg });
})(typeof window !== "undefined" ? window : globalThis);
