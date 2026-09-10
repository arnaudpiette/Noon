"use strict";

// UI du Control Center. Toutes les valeurs serveur sont rendues avec textContent :
// aucun nom de composant, d'extension ou d'erreur ne devient du HTML exécutable.
(() => {
  const dialog = document.getElementById("controlCenter");
  if (!dialog) return;
  const navigation = document.getElementById("controlCenterNavigation");
  const overview = document.getElementById("controlCenterOverview");
  const section = document.getElementById("controlCenterSection");
  const loading = document.getElementById("controlCenterLoading");
  const viewSelect = document.getElementById("controlCenterView");
  const openButton = document.getElementById("openControlCenterButton");
  const closeButton = document.getElementById("closeControlCenter");
  const refreshButton = document.getElementById("refreshControlCenter");
  const labels = Object.freeze({
    overview: "Vue d’ensemble", connections: "Connexions", jobs: "Travaux", approvals: "Validations",
    reliability: "Fiabilité", memory: "Mémoire", rules: "Règles permanentes", workspaces: "Espaces de travail",
    goals: "Objectifs", portfolio: "Capacité", devices: "Appareils", sync: "Synchronisation",
    extensions: "Extensions", permissions: "Permissions", notifications: "Notifications", privacy: "Confidentialité",
    offline: "Local et hors ligne", configuration: "Configuration", backups: "Sauvegardes",
    evaluations: "Évaluations", diagnostics: "Diagnostics",
  });
  const actionLabels = Object.freeze({
    RUN_QUICK_DIAGNOSTIC: "Vérifier", CHECK_CONNECTION: "Tester", CHECK_EXTENSION: "Tester",
  });
  let activeSection = "overview";

  function element(tag, className = "", text = null) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  }

  function statusPill(state) {
    const pill = element("span", "control-status-pill", state || "UNKNOWN");
    pill.dataset.state = state || "UNKNOWN";
    return pill;
  }

  function renderMeta(meta, target) {
    if (!meta || typeof meta !== "object") return;
    const container = element("div", "control-card__meta");
    for (const [key, value] of Object.entries(meta).slice(0, 8)) {
      if (value == null || typeof value === "object") continue;
      container.append(element("span", "", `${key} : ${value}`));
    }
    if (container.childNodes.length) target.append(container);
  }

  async function requestAction(action, targetId, button) {
    button.disabled = true;
    try {
      const response = await fetch("/api/control-center/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Noon-Request": "1" },
        body: JSON.stringify({ action, targetId, params: {} }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Action impossible.");
      const authorizationUrl = data.action?.result?.authorizationUrl;
      if (authorizationUrl) window.open(authorizationUrl, "_blank", "noopener");
      await load(activeSection, true);
    } catch (error) {
      const message = element("p", "control-center__notice", error.message || "Action impossible.");
      message.dataset.partial = "true";
      section.prepend(message);
    } finally {
      button.disabled = false;
    }
  }

  function renderCard(value) {
    const card = element("article", "control-card");
    const head = element("div", "control-card__head");
    head.append(element("h3", "", value.label || "Élément"), statusPill(value.state));
    card.append(head);
    if (value.summary) card.append(element("p", "", value.summary));
    renderMeta(value.meta, card);
    const supported = (value.actions || []).filter((action) => actionLabels[action]);
    if (supported.length) {
      const actions = element("div", "control-card__actions");
      for (const action of supported) {
        const button = element("button", "", actionLabels[action]);
        button.type = "button";
        button.addEventListener("click", () => requestAction(action, value.id, button));
        actions.append(button);
      }
      card.append(actions);
    }
    return card;
  }

  function renderSection(model) {
    section.replaceChildren();
    const head = element("header", "control-section__header");
    const title = element("div");
    title.append(element("h2", "", labels[model.sectionId] || model.sectionId), element("p", "", model.summary));
    head.append(title, statusPill(model.status));
    section.append(head);
    if (model.partial) {
      const notice = element("p", "control-center__notice", "Les données affichées sont partielles. Les autres fonctions de Noon restent disponibles.");
      notice.dataset.partial = "true";
      section.append(notice);
    }
    if (!model.items?.length) section.append(element("div", "control-empty", "Aucun élément à afficher dans cette section."));
    else {
      const grid = element("div", "control-center__grid");
      for (const value of model.items) grid.append(renderCard(value));
      section.append(grid);
    }
  }

  function renderOverview(snapshot) {
    overview.replaceChildren();
    const hero = element("section", "control-overview__hero");
    const copy = element("div");
    copy.append(element("h2", "", "État de Noon"), element("p", "", snapshot.needsAttention.length ? `${snapshot.needsAttention.length} élément(s) nécessitent votre attention.` : "Noon fonctionne et aucune action prioritaire n’est requise."));
    hero.append(copy, statusPill(snapshot.overallStatus));
    overview.append(hero);
    const grid = element("div", "control-center__grid");
    for (const model of Object.values(snapshot.sections || {})) {
      const card = renderCard({ id: model.sectionId, label: labels[model.sectionId] || model.sectionId, state: model.status, summary: model.summary, meta: model.counts });
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.addEventListener("click", () => load(model.sectionId));
      card.addEventListener("keydown", (event) => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); load(model.sectionId); } });
      grid.append(card);
    }
    overview.append(grid);
  }

  function renderNavigation(sectionIds) {
    navigation.replaceChildren();
    for (const id of ["overview", ...sectionIds]) {
      const button = element("button", id === activeSection ? "active" : "", labels[id] || id);
      button.type = "button";
      button.dataset.section = id;
      button.addEventListener("click", () => load(id));
      navigation.append(button);
    }
  }

  async function load(sectionId = "overview", force = false) {
    activeSection = sectionId;
    loading.hidden = false; overview.hidden = true; section.hidden = true;
    const query = new URLSearchParams({ view: viewSelect.value });
    if (force) query.set("refresh", "1");
    try {
      const url = sectionId === "overview"
        ? `/api/control-center/overview?${query}`
        : `/api/control-center/sections/${encodeURIComponent(sectionId)}?${query}`;
      const response = await fetch(url, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Control Center indisponible.");
      if (sectionId === "overview") {
        renderNavigation(data.snapshot.availableSections || []);
        renderOverview(data.snapshot); overview.hidden = false;
      } else {
        [...navigation.querySelectorAll("button")].forEach((button) => button.classList.toggle("active", button.dataset.section === sectionId));
        renderSection(data.section); section.hidden = false;
      }
    } catch (error) {
      section.replaceChildren(element("div", "control-empty", error.message || "Control Center indisponible."));
      section.hidden = false;
    } finally {
      loading.hidden = true;
    }
  }

  async function open() {
    if (!dialog.open) dialog.showModal();
    await load("overview");
  }

  openButton?.addEventListener("click", () => { document.getElementById("quickSettings").hidden = true; void open(); });
  closeButton.addEventListener("click", () => dialog.close());
  refreshButton.addEventListener("click", () => load(activeSection, true));
  viewSelect.addEventListener("change", () => load(activeSection, true));
  dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
  window.NoonControlCenter = Object.freeze({ open, refresh: () => load(activeSection, true) });
})();
