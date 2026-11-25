
// Interface V3, étape 4 — atelier DEV et mode par projet.
//
// Atelier : en mode DEV, le terminal (avec ses Modifications Git) et l'aperçu forment une colonne à
// droite du chat, redimensionnable par la poignée verticale. Trois boutons de la barre du haut
// affichent ou masquent chaque panneau. Largeur et panneaux masqués sont retenus par projet Focus.
// Masquer un panneau ne ferme rien : le terminal continue de tourner, la page de l'aperçu reste chargée.
// Sous DEV_SPLIT_MIN_CHAT_WIDTH, l'ancienne disposition empilée reste en place.
//
// Mode par projet : le mode DA/DEV choisi dans une conversation est retenu pour son projet
// (dossier de conversations) et réappliqué quand on rouvre une conversation de ce projet.

const DEV_SPLIT_MIN_CHAT_WIDTH = 640;

const devPaneToggles = document.getElementById("devPaneToggles");
const devPaneToggleTerminal = document.getElementById("devPaneToggleTerminal");
const devPaneTogglePreview = document.getElementById("devPaneTogglePreview");
const devPaneToggleChanges = document.getElementById("devPaneToggleChanges");

// Appelée aussi par 02 au changement de contexte, parfois avant l'exécution de ce morceau :
// ces deux fonctions n'utilisent donc aucune constante déclarée ici.
function devPanesStorageKey() {
  return currentFocusId ? `noonDevPanes:${currentFocusId}` : "noonDevPanes";
}

function loadDevPaneVisibility() {
  let saved;
  try {
    saved = JSON.parse(localStorage.getItem(devPanesStorageKey()) || "{}") || {};
  } catch {
    saved = {};
  }
  devPaneVisibility.previewHidden = saved.previewHidden === true;
  devPaneVisibility.terminalHidden = saved.terminalHidden === true;
}

function saveDevPaneVisibility() {
  localStorage.setItem(devPanesStorageKey(), JSON.stringify({
    previewHidden: devPaneVisibility.previewHidden,
    terminalHidden: devPaneVisibility.terminalHidden,
  }));
}

function setDevPaneToggleState(button, pressed, disabled = false, title = "") {
  if (!button) return;
  button.setAttribute("aria-pressed", String(pressed));
  button.disabled = disabled;
  if (title) button.title = title;
}

function syncDevPanesLayout() {
  const devMode = currentMode === "DEV";
  const chatActive = chatView.classList.contains("active");
  const wide = chatView.getBoundingClientRect().width >= DEV_SPLIT_MIN_CHAT_WIDTH || !chatActive;
  const terminalShown = devMode && !devTerminalPanel.hidden && !devPaneVisibility.terminalHidden;
  const previewShown = devMode && !devPreviewPanel.hidden;
  const split = devMode && wide && (terminalShown || previewShown);

  chatView.classList.toggle("dev-terminal-user-hidden", devMode && devPaneVisibility.terminalHidden);
  chatView.classList.toggle("dev-split", split);
  chatView.classList.toggle("dev-split-preview", split && previewShown);
  chatView.classList.toggle("dev-split-terminal", split && terminalShown);
  chatView.parentElement?.classList.toggle("dev-split", split && chatActive);

  if (devPaneToggles) devPaneToggles.hidden = !devMode || currentView !== "chat";
  const focusReady = Boolean(currentFocusId && currentFocusPath);
  setDevPaneToggleState(devPaneToggleTerminal, terminalShown);
  setDevPaneToggleState(
    devPaneTogglePreview,
    previewShown,
    !focusReady,
    focusReady ? "Aperçu" : "Aperçu : choisis d’abord un projet Focus"
  );
  setDevPaneToggleState(
    devPaneToggleChanges,
    terminalShown && devTerminalPanel.classList.contains("is-source-control"),
    !focusReady || devSourceControlToggle.disabled,
    focusReady ? "Modifications" : "Modifications : choisis d’abord un projet Focus"
  );

  syncDevPreviewResizeHandle();
  scheduleDevPreviewBounds();
  scheduleDevTerminalWorkspaceClamp();
}

function showDevTerminalPane() {
  if (!devPaneVisibility.terminalHidden) return;
  devPaneVisibility.terminalHidden = false;
  saveDevPaneVisibility();
  syncDevPanesLayout();
}

devPaneToggleTerminal?.addEventListener("click", () => {
  devPaneVisibility.terminalHidden = !devPaneVisibility.terminalHidden;
  saveDevPaneVisibility();
  syncDevPanesLayout();
  if (!devPaneVisibility.terminalHidden) devTerminalInput?.focus?.();
});

devPaneTogglePreview?.addEventListener("click", async () => {
  devPaneVisibility.previewHidden = !devPaneVisibility.previewHidden;
  saveDevPaneVisibility();
  await syncDevPreviewPanel();
  syncDevPanesLayout();
});

// « Modifications » = vue Source Control du terminal ; l'ouvrir réaffiche le terminal si besoin.
devPaneToggleChanges?.addEventListener("click", () => {
  const showing = devTerminalPanel.classList.contains("is-source-control");
  if (showing && devPaneVisibility.terminalHidden === false) {
    devSourceControlToggle.click();
    return;
  }
  showDevTerminalPane();
  if (devTerminalState.collapsed) devTerminalCollapseButton.click();
  if (!devSourceControlIsAllowed()) {
    updateActivity("Modifications : le terminal du projet doit d’abord être ouvert.");
    return;
  }
  if (!devTerminalPanel.classList.contains("is-source-control")) devSourceControlToggle.click();
});

function readProjectModes() {
  try {
    const saved = JSON.parse(localStorage.getItem("noonProjectModes") || "{}");
    return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
  } catch {
    return {};
  }
}

function conversationFolderId(sessionId) {
  return conversationIndexState.conversations.find((item) => item.id === sessionId)?.folderId || "general";
}

function rememberProjectMode() {
  const modes = readProjectModes();
  modes[conversationFolderId(currentSessionId)] = currentMode;
  localStorage.setItem("noonProjectModes", JSON.stringify(modes));
}

// Réapplique le mode retenu pour ce projet ; sans mode retenu, le mode courant est conservé.
function applyProjectMode(folderId) {
  const mode = readProjectModes()[folderId];
  if (!ALLOWED_MODES.includes(mode) || mode === currentMode) return;
  setMode(mode, false);
  updateActivity(`Mode ${mode} : celui de ce projet.`);
}

// Écouteur ajouté après celui de 08 : setMode a déjà mis à jour currentMode.
modeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    rememberProjectMode();
  });
});

// 02 recharge la visibilité retenue avant de resynchroniser l'aperçu ; ici, on recale la colonne.
window.addEventListener("noon-context-change", syncDevPanesLayout);
window.addEventListener("noon-view-change", syncDevPanesLayout);
window.addEventListener("resize", syncDevPanesLayout);

// Les panneaux sont montrés ou cachés par leurs propres modules (de façon asynchrone) :
// la colonne suit leur attribut « hidden » et la vue Source Control.
const devPanesObserver = new MutationObserver(syncDevPanesLayout);
devPanesObserver.observe(devTerminalPanel, { attributes: true, attributeFilter: ["hidden", "class"] });
devPanesObserver.observe(devPreviewPanel, { attributes: true, attributeFilter: ["hidden"] });
devPanesObserver.observe(devSourceControlToggle, { attributes: true, attributeFilter: ["disabled"] });

loadDevPaneVisibility();
syncDevPanesLayout();
