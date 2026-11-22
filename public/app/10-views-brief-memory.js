function createProjectConversationRow(conversationItem) {
  const item = document.createElement("div");
  item.className = "conversation-history__item conversation-project__conversation";
  item.draggable = true;
  item.dataset.conversationId = conversationItem.id;
  item.classList.toggle("active", conversationItem.id === currentSessionId);
  item.addEventListener("dragstart", (event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/x-noon-conversation", conversationItem.id); item.classList.add("is-dragging"); });
  item.addEventListener("dragend", () => item.classList.remove("is-dragging"));
  const openButton = document.createElement("button");
  openButton.type = "button";
  openButton.className = "conversation-history__open";
  openButton.title = conversationItem.title;
  const title = document.createElement("span");
  title.className = "conversation-history__title";
  title.textContent = conversationItem.title || "Nouvelle conversation";
  openButton.append(title);
  openButton.addEventListener("click", () => void switchConversation(conversationItem.id));
  const more = document.createElement("button");
  more.type = "button";
  more.className = "conversation-history__delete conversation-history__more";
  more.setAttribute("aria-label", `Plus d’actions pour ${conversationItem.title}`);
  more.setAttribute("aria-haspopup", "menu");
  more.textContent = "⋮";
  more.addEventListener("click", (event) => { event.stopPropagation(); openConversationContextMenu(more, conversationItem); });
  item.append(openButton, more);
  return item;
}

function openProjectContextMenu(anchor, project) {
  closeConversationContextMenu();
  const menu = document.createElement("div");
  menu.className = "conversation-context-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", `Actions pour ${project.title}`);
  for (const action of [{ id: "rename", label: "Renommer" }, { id: "delete", label: "Supprimer le projet", destructive: true }]) {
    if (action.destructive) { const separator=document.createElement("span");separator.className="conversation-context-menu__separator";separator.setAttribute("aria-hidden","true");menu.append(separator); }
    const button = document.createElement("button");
    button.type = "button";
    button.role = "menuitem";
    button.className = "conversation-context-menu__item";
    if (action.destructive) button.classList.add("is-destructive");
    button.textContent = action.label;
    button.addEventListener("click", async () => { closeConversationContextMenu(); try { if (action.id === "rename") await beginConversationProjectRename(project.id); else await deleteConversationProject(project); } catch (error) { updateActivity(error.message); } });
    menu.append(button);
  }
  document.body.append(menu);
  const anchorRect = anchor.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(12, Math.min(window.innerWidth - menuRect.width - 12, anchorRect.right - menuRect.width))}px`;
  menu.style.top = `${Math.max(12, Math.min(window.innerHeight - menuRect.height - 12, anchorRect.bottom + 6))}px`;
  activeConversationContextMenu = menu;
  menu.querySelector("button")?.focus();
}

function renderConversationProjects(conversations) {
  conversationProjectsList.replaceChildren();
  const projects = conversationIndexState.folders.filter((folder) => folder.id !== "general");
  if (!projects.length) { const empty=document.createElement("span");empty.className="conversation-history__empty";empty.textContent="Aucun projet.";conversationProjectsList.append(empty);return; }
  for (const project of projects) {
    const projectDetails = document.createElement("details");
    projectDetails.className = "conversation-project";
    projectDetails.dataset.conversationProject = project.id;
    projectDetails.open = true;
    const summary = document.createElement("summary");
    const folderIcon = document.createElement("span");
    folderIcon.className = "sidebar-line-icon sidebar-line-icon--folder";
    folderIcon.setAttribute("aria-hidden", "true");
    const name = document.createElement("span");
    name.className = "conversation-project__name";
    name.textContent = project.title;
    name.title = project.title;
    const more = document.createElement("button");
    more.type = "button";
    more.className = "conversation-project__more";
    more.textContent = "⋮";
    more.setAttribute("aria-label", `Actions pour le projet ${project.title}`);
    more.setAttribute("aria-haspopup", "menu");
    more.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); openProjectContextMenu(more, project); });
    const chevron = document.createElement("span");
    chevron.className = "conversation-project__chevron";
    chevron.setAttribute("aria-hidden", "true");
    summary.append(folderIcon, name, more, chevron);
    projectDetails.append(summary);
    const list = document.createElement("div");
    list.className = "conversation-project__list";
    const projectConversations = conversations.filter((item) => item.folderId === project.id).sort((left,right)=>new Date(right.updatedAt)-new Date(left.updatedAt));
    if (!projectConversations.length) { const empty=document.createElement("span");empty.className="conversation-project__empty";empty.textContent="Aucune conversation";list.append(empty); }
    else projectConversations.forEach((item) => list.append(createProjectConversationRow(item)));
    projectDetails.append(list);
    const setDropState = (active) => projectDetails.classList.toggle("is-drop-target", active);
    projectDetails.addEventListener("dragover", (event) => { if (Array.from(event.dataTransfer.types).includes("text/x-noon-conversation")) { event.preventDefault(); event.dataTransfer.dropEffect="move"; setDropState(true); } });
    projectDetails.addEventListener("dragleave", (event) => { if (!projectDetails.contains(event.relatedTarget)) setDropState(false); });
    projectDetails.addEventListener("drop", async (event) => { event.preventDefault();setDropState(false);const id=event.dataTransfer.getData("text/x-noon-conversation");const item=conversationIndexState.conversations.find((candidate)=>candidate.id===id);if(item&&item.folderId!==project.id){try{await moveConversationToProject(item,project.id);}catch(error){updateActivity(error.message);}} });
    conversationProjectsList.append(projectDetails);
  }
}

document.addEventListener("click", (event) => {
  if (activeConversationContextMenu && !activeConversationContextMenu.contains(event.target)) {
    closeConversationContextMenu();
  }
});

window.addEventListener("resize", closeConversationContextMenu);
createConversationProjectButton.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); void createConversationProject().catch((error) => updateActivity(error.message)); });

async function loadConversationIndex() {
  const navigationSerial =
    conversationIndexNavigationSerial;

  try {
    const response = await fetch("/conversations", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message);
    const conversations = data.conversations || [];
    const folders = data.folders || [];
    conversationIndexState = { folders, conversations };
    const retainedIds = new Set(conversations.map((item) => item.id));
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      const prefix = `${CONVERSATION_STORAGE_KEY}:`;
      if (key?.startsWith(prefix) && !retainedIds.has(key.slice(prefix.length))) {
        localStorage.removeItem(key);
      }
    }
    if (
      navigationSerial !==
      conversationIndexNavigationSerial
    ) {
      return;
    }
    renderConversationIndex(conversations);
  } catch (error) {
    conversationHistoryList.textContent = "Historique indisponible.";
    updateActivity(error.message);
  }
}

function switchView(viewName) {
  if (currentView === "personal" && viewName !== "personal") {
    resetPrivateMemoryVisibility();
  }
  currentView = ["chat", "brief", "personal"].includes(viewName) ? viewName : "core";

  viewButtons.forEach((button) => {
    const isActive = button.dataset.view === currentView;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });

  views.forEach((view) => {
    view.classList.toggle("active", view.id === `${currentView}View`);
  });

  document.body.dataset.interactionMode = currentView;

  if (currentView === "brief") {
    interruptNoonSpeech(false);
    window.noonLiveVoice?.disconnect({ announce: false });
    void loadCreativeBrief();
    updateActivity("Brief Noon ouvert.");
  } else if (currentView === "personal") {
    resetPrivateMemoryVisibility({ render: false });
    interruptNoonSpeech(false);
    window.noonLiveVoice?.disconnect({ announce: false });
    void loadPersonalIntelligence();
    updateActivity("Intelligence personnelle ouverte.");
  } else if (currentView === "chat") {
    interruptNoonSpeech(false);
    window.noonLiveVoice?.disconnect({ announce: false });
    updateActivity("Mode Chat : réponses écrites uniquement.");
    window.setTimeout(() => promptInput.focus(), 0);
  } else {
    updateActivity("Assistant vocal actif.");
  }
}

let briefLoadVersion = 0;
let briefRefreshTimer = null;
const briefHistorySelect = document.getElementById("briefHistorySelect");
briefHistorySelect.addEventListener("change", () => { void loadCreativeBrief(); });
window.addEventListener("online", () => { if (currentView === "brief") void loadCreativeBrief(); });
window.addEventListener("focus", () => { if (currentView === "brief") void loadCreativeBrief(); });

async function loadCreativeBrief() {
  const version = ++briefLoadVersion;
  window.clearTimeout(briefRefreshTimer);
  const historicalDate = briefHistorySelect.value;
  briefState.textContent = personalBriefState.textContent = "Chargement…";
  personalBriefState.dataset.state = "LOADING";
  personalBriefContent.replaceChildren();
  briefStructuredContent.replaceChildren();
  briefGeneratedAt.textContent = "";
  try {
    const response = await fetch(historicalDate
      ? `/daily-brief/history?date=${encodeURIComponent(historicalDate)}`
      : "/daily-brief/current", { cache: "no-store" });
    const data = await response.json();
    if (version !== briefLoadVersion) return null;
    if (!response.ok) throw new Error(data.message || "Brief indisponible.");
    // The server owns today's date; historical content never becomes current implicitly.
    const brief = historicalDate ? data.brief : data.current?.date === data.date ? data.current : null;
    const generating = !historicalDate && data.generationActive === true;
    const status = historicalDate ? "HISTORICAL" : generating ? "GENERATING"
      : brief ? (data.status === "partial" ? "PARTIAL" : "READY")
        : data.status === "failed" ? "FAILED" : "MISSING";
    const label = historicalDate ? `Brief historique — ${historicalDate}`
      : generating ? "Génération en cours…"
        : brief ? (status === "PARTIAL" ? "Brief partiel" : "Brief prêt")
          : status === "FAILED" ? `Le brief du jour (${data.date}) n’a pas pu être généré. ${data.error || ""}`
            : `Le brief du jour (${data.date}) n’a pas été généré.`;
    briefState.textContent = personalBriefState.textContent = label;
    personalBriefState.dataset.state = status;
    personalBriefState.setAttribute(
      "aria-label",
      status === "READY"
        ? "Brief du jour prêt"
        : status === "PARTIAL"
          ? "Brief du jour partiel, certaines sources sont indisponibles"
          : status === "GENERATING"
            ? "Génération du brief en cours"
            : status === "FAILED"
              ? "Échec de génération du brief"
              : status === "HISTORICAL"
                ? "Brief historique"
                : "Brief du jour indisponible"
    );
    // V3-L2d : ouverture du Brief du jour (vue affichée), pour le journal local d'usage.
    if (!historicalDate && brief && currentView === "brief" && document.visibilityState !== "hidden") {
      void fetch("/daily-brief/opened", { method: "POST", headers: { "Content-Type": "application/json", "X-Noon-Request": "1" }, body: JSON.stringify({ date: brief.date }) }).catch(() => {});
    }
    briefContent.textContent = "";
    window.NoonUiUtils.renderDailyBriefStructured(briefStructuredContent, brief);
    window.NoonUiUtils.renderBriefMarkdown(personalBriefContent, brief?.content || "");
    briefGeneratedAt.textContent = brief?.generatedAt
      ? `${historicalDate ? "Historique" : "Brief du jour"} · ${
          new Intl.DateTimeFormat("fr-FR", {
            timeZone: "Europe/Paris",
            weekday: "long",
            day: "numeric",
            month: "long",
          }).format(new Date(`${brief.date}T12:00:00Z`))
        } · généré à ${
          new Intl.DateTimeFormat("fr-FR", {
            timeZone: "Europe/Paris",
            hour: "2-digit",
            minute: "2-digit",
          }).format(new Date(brief.generatedAt))
        }`
      : "";
    if (!historicalDate) {
      briefHistorySelect.replaceChildren();
      const currentOption = document.createElement("option"); currentOption.value = ""; currentOption.textContent = "Brief du jour";
      briefHistorySelect.append(currentOption);
      for (const item of data.historical || []) {
        const option = document.createElement("option"); option.value = item.date; option.textContent = `Brief précédent — ${item.date}`;
        briefHistorySelect.append(option);
      }
      briefHistorySelect.value = "";
      briefRefreshTimer = window.setTimeout(() => {
        if (currentView === "brief" && !briefHistorySelect.value) void loadCreativeBrief();
      }, generating ? 1500 : 60000);
    }
    briefSourceStates.replaceChildren();
    for (const source of brief?.sources || []) {
      const badge = document.createElement("span"); badge.className = "brief-source-state"; badge.dataset.status = source.status;
      badge.textContent = `${source.id} · ${source.label}`; briefSourceStates.append(badge);
    }
    briefScheduledBlocks.replaceChildren();
    for (const block of brief?.scheduledBlocks || []) {
      const badge = document.createElement("span"); badge.className = "brief-scheduled-block";
      const label = document.createElement("span"); label.textContent = block.status === "created" || block.status === "already-exists" ? `${block.title} · ${new Date(block.start).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` : `${block.title || "Planification"} · Non ajouté à l’agenda`;
      const feedback = document.createElement("button"); feedback.type = "button"; feedback.textContent = "Reporter";
      feedback.addEventListener("click", () => fetch("/planning/preferences", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "add", preference: { text: `Reporter plus tard les blocs similaires à : ${block.title}`, source: "brief-feedback", confidence: 1, locked: true } }) }).then(() => updateActivity("Préférence de report enregistrée.")));
      badge.append(label, feedback);
      briefScheduledBlocks.append(badge);
    }
    briefDrafts.replaceChildren();
    for (const draft of brief?.drafts || []) {
      const badge = document.createElement("span"); badge.className = "brief-scheduled-block";
      const label = document.createElement("span"); label.textContent = draft.status === "created" ? `Brouillon : ${draft.subject}` : `Brouillon non créé : ${draft.subject || "e-mail"}`;
      if (draft.status === "created") { const link = document.createElement("a"); link.href = "https://mail.google.com/mail/u/0/#drafts"; link.target = "_blank"; link.rel = "noopener noreferrer"; link.textContent = "Ouvrir le brouillon"; badge.append(label, link); }
      else badge.append(label);
      briefDrafts.append(badge);
    }
    briefSources.replaceChildren();
    for (const source of brief?.webSources || []) { try { const url = new URL(source.url); if (url.protocol !== "https:") continue; const link = document.createElement("a"); link.href = url.href; link.target = "_blank"; link.rel = "noopener noreferrer"; link.textContent = source.title || url.hostname; briefSources.append(link); } catch {} }
    generateBriefButton.textContent = brief ? "Actualiser le brief" : "Générer maintenant";
    readBriefButton.disabled = !brief; stopBriefReadingButton.disabled = true;
    return brief || null;
  } catch (error) {
    if (version !== briefLoadVersion) return null;
    briefState.textContent = personalBriefState.textContent = navigator.onLine ? error.message : "Brief indisponible : absence de connexion.";
    personalBriefState.dataset.state = "FAILED";
    personalBriefState.setAttribute("aria-label", "Échec de chargement du brief");
    return null;
  }
}

async function generateCreativeBrief(force = false) {
  briefHistorySelect.value = "";
  briefState.textContent = personalBriefState.textContent = "Chargement…"; generateBriefButton.disabled = true;
  try { const response = await fetch("/daily-brief/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ force }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.message); await loadCreativeBrief(); }
  catch (error) { briefState.textContent = personalBriefState.textContent = error.message || "La génération a échoué. Réessayez."; personalBriefState.dataset.state = "FAILED"; }
  finally { generateBriefButton.disabled = false; }
}

generateBriefButton.addEventListener("click", async () => { const existing = Boolean(personalBriefContent.textContent.trim()); if (existing && !window.confirm("Actualiser le brief entraînera un nouvel appel API. Continuer ?")) return; await generateCreativeBrief(existing); });
testCreativeBriefButton.addEventListener("click", () => generateCreativeBrief(false));
readBriefButton.addEventListener("click", async () => {
  const combinedBrief = personalBriefContent.textContent;
  if (!combinedBrief) return;

  readBriefButton.dataset.reading = "true";
  readBriefButton.setAttribute("aria-pressed", "true");
  stopBriefReadingButton.disabled = false;

  try {
    await speakNoon(
      prepareTextForSpeech(
        combinedBrief.replace(/https?:\/\/\S+/g, " Sources disponibles à l’écran. ")
      )
    );
  } finally {
    readBriefButton.dataset.reading = "false";
    readBriefButton.setAttribute("aria-pressed", "false");
    stopBriefReadingButton.disabled = true;
  }
});

stopBriefReadingButton.addEventListener("click", () => {
  interruptNoonSpeech();
  readBriefButton.dataset.reading = "false";
  readBriefButton.setAttribute("aria-pressed", "false");
  stopBriefReadingButton.disabled = true;
});

async function loadCreativeBriefPreferences() {
  if (!window.noon?.getPreferences) return;
  const preferences = await window.noon.getPreferences();
  creativeBriefEnabledInput.checked = preferences.creativeBriefEnabled !== false;
  creativeBriefTimeInput.value = preferences.creativeBriefTime || "07:00";
  creativeBriefNotificationsInput.checked = preferences.creativeBriefNotifications !== false;
  launchAtLoginInput.checked = preferences.launchAtLogin !== false;
}

async function savePlanningSettings() {
  const settings = {
    enabled: autoPlanningEnabledInput.checked,
    createGmailDrafts: autoDraftsEnabledInput.checked,
    learningEnabled: planningLearningEnabledInput.checked,
    workdayStart: workdayStartInput.value,
    workdayEnd: workdayEndInput.value,
    minimumSlotMinutes: Number(minimumSlotMinutesInput.value),
    maximumFocusMinutes: Number(maximumFocusMinutesInput.value),
    bufferMinutes: Number(planningBufferMinutesInput.value),
    workingDays: planningWorkingDaysInput.value.split(",").map(Number).filter((day) => day >= 0 && day <= 6),
    busyCalendarIds: busyCalendarIdsInput.value.split(",").map((value) => value.trim()).filter(Boolean),
    targetCalendarId: targetCalendarIdInput.value.trim() || "primary",
  };
  const response = await fetch("/planning/preferences", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "settings", settings }) });
  const data = await response.json(); if (!response.ok) throw new Error(data.message || "Réglages d’organisation indisponibles.");
  updateActivity("Réglages d’organisation enregistrés.");
}

async function loadPlanningSettings() {
  try {
    const response = await fetch("/planning/preferences", { cache: "no-store" }); const data = await response.json();
    if (!response.ok) throw new Error(data.message);
    const settings = data.settings || {};
    autoPlanningEnabledInput.checked = settings.enabled !== false;
    autoDraftsEnabledInput.checked = settings.createGmailDrafts !== false;
    planningLearningEnabledInput.checked = settings.learningEnabled !== false;
    workdayStartInput.value = settings.workdayStart || "09:00"; workdayEndInput.value = settings.workdayEnd || "18:30";
    minimumSlotMinutesInput.value = String(settings.minimumSlotMinutes || 25); maximumFocusMinutesInput.value = String(settings.maximumFocusMinutes || 90);
    planningBufferMinutesInput.value = String(settings.bufferMinutes ?? 10);
    planningWorkingDaysInput.value = (settings.workingDays || [1, 2, 3, 4, 5]).join(",");
    busyCalendarIdsInput.value = (settings.busyCalendarIds || ["primary"]).join(",");
    targetCalendarIdInput.value = settings.targetCalendarId || "primary";
    planningPreferenceList.replaceChildren();
    if (!(data.preferences || []).length) planningPreferenceList.textContent = "Aucune préférence apprise.";
    for (const preference of data.preferences || []) {
      const item = document.createElement("div"); item.className = "memory-item";
      const text = document.createElement("span"); text.textContent = `${preference.text} · confiance ${Math.round(preference.confidence * 100)} %`;
      const lock = document.createElement("button"); lock.type = "button"; lock.textContent = preference.locked ? "Déverrouiller" : "Verrouiller";
      lock.addEventListener("click", async () => { await fetch("/planning/preferences", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "update", id: preference.id, changes: { locked: !preference.locked } }) }); await loadPlanningSettings(); });
      const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "Supprimer";
      remove.addEventListener("click", async () => { await fetch("/planning/preferences", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", id: preference.id }) }); await loadPlanningSettings(); });
      item.append(text, lock, remove); planningPreferenceList.append(item);
    }
  } catch (error) { updateActivity(error.message || "Réglages d’organisation indisponibles."); }
}

for (const field of [autoPlanningEnabledInput, autoDraftsEnabledInput, planningLearningEnabledInput, workdayStartInput, workdayEndInput, minimumSlotMinutesInput, maximumFocusMinutesInput, planningBufferMinutesInput, planningWorkingDaysInput, busyCalendarIdsInput, targetCalendarIdInput]) {
  field.addEventListener("change", () => savePlanningSettings().catch((error) => updateActivity(error.message)));
}

async function memoryAction(action, payload = {}) {
  const response = await fetch("/memory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...payload }) });
  const data = await response.json(); if (!response.ok) throw new Error(data.message || "Mémoire indisponible."); return data.result;
}
async function loadLongTermMemories() {
  try { const response = await fetch("/memory", { cache: "no-store" }); const data = await response.json(); if (!response.ok) throw new Error(data.message); longTermMemoryEnabledInput.checked = data.enabled !== false; memoryList.replaceChildren();
    if (!data.memories.length) memoryList.textContent = "Aucun souvenir durable.";
    for (const memory of data.memories) { const item = document.createElement("div"); item.className = "memory-item"; const editor = document.createElement("textarea"); editor.value = memory.text; editor.maxLength = 1000; const actions = document.createElement("div"); actions.className = "memory-item__actions"; const save = document.createElement("button"); save.type = "button"; save.textContent = "✓"; save.title = "Enregistrer"; save.addEventListener("click", async () => { await memoryAction("update", { id: memory.id, text: editor.value }); updateActivity("Souvenir corrigé."); }); const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "×"; remove.title = "Supprimer"; remove.addEventListener("click", async () => { await memoryAction("delete", { id: memory.id }); await loadLongTermMemories(); }); actions.append(save, remove); item.append(editor, actions); memoryList.append(item); }
  } catch (error) { memoryList.textContent = error.message; }
}
longTermMemoryEnabledInput.addEventListener("change", () => memoryAction("enable", { enabled: longTermMemoryEnabledInput.checked }).then(loadLongTermMemories));
addMemoryButton.addEventListener("click", async () => { if (!newMemoryTextInput.value.trim()) return; await memoryAction("add", { text: newMemoryTextInput.value }); newMemoryTextInput.value = ""; await loadLongTermMemories(); updateActivity("Souvenir ajouté."); });
clearMemoriesButton.addEventListener("click", async () => { if (!window.confirm("Vider toute la mémoire durable de Noon ?")) return; await memoryAction("clear"); await loadLongTermMemories(); updateActivity("Mémoire durable vidée."); });

function statusLabel(status) {
  return ({ confirmed: "Confirmé", candidate: "Candidat", pending_review: "À vérifier", historical: "Historique", superseded: "Remplacé", deleted: "Supprimé", inferred: "J’en déduis · à confirmer", temporary: "Information temporaire", blocked: "Information bloquée", expired: "Expirée", rejected: "Refusée" })[status] || status;
}
let privateMemoryShowAll = false;
let visiblePrivateMemoryIds = new Set();
let hiddenPrivateMemoryIds = new Set();
let loadedPrivateMemories = [];
let privateMemoryAuthResolver = null;
let privateMemoryPasswordConfigured = false;

function finishPrivateMemoryAuthentication(authenticated) {
  const resolve = privateMemoryAuthResolver;
  privateMemoryAuthResolver = null;
  privateMemoryPasswordInput.value = "";
  if (privateMemoryAuthDialog.open) privateMemoryAuthDialog.close();
  resolve?.(authenticated);
}

function showPrivateMemoryAuthError(message) {
  privateMemoryAuthError.textContent = message;
  privateMemoryAuthError.hidden = false;
}

async function requestPrivateMemoryAuthentication() {
  if (!window.noon?.getPrivateMemoryProtection || !window.noon?.authenticatePrivateMemory) {
    updateActivity("Protection de la mémoire privée indisponible.");
    return false;
  }
  let status;
  try { status = await window.noon.getPrivateMemoryProtection(); }
  catch { updateActivity("Impossible de vérifier la protection de la mémoire privée."); return false; }
  privateMemoryPasswordConfigured = Boolean(status.passwordConfigured);
  privateMemoryTouchIdButton.hidden = !status.touchIdAvailable;
  privateMemoryPasswordPanel.hidden = false;
  privateMemoryPasswordLabel.textContent = privateMemoryPasswordConfigured ? "Mot de passe Noon" : "Créer un mot de passe Noon";
  privateMemoryPasswordInput.autocomplete = privateMemoryPasswordConfigured ? "current-password" : "new-password";
  privateMemoryPasswordHelp.textContent = privateMemoryPasswordConfigured
    ? "Utilisez Touch ID ou votre mot de passe Noon."
    : "Créez un mot de passe local de 8 caractères minimum. Il sera protégé dans le coffre macOS.";
  privateMemoryPasswordSubmit.textContent = privateMemoryPasswordConfigured ? "Confirmer" : "Créer et afficher";
  privateMemoryAuthError.hidden = true;
  privateMemoryAuthError.textContent = "";
  privateMemoryPasswordInput.value = "";
  return new Promise((resolve) => {
    privateMemoryAuthResolver = resolve;
    privateMemoryAuthDialog.showModal();
    if (!status.touchIdAvailable) privateMemoryPasswordInput.focus();
  });
}

function isPrivateMemoryVisible(memoryId) {
  return privateMemoryShowAll
    ? !hiddenPrivateMemoryIds.has(memoryId)
    : visiblePrivateMemoryIds.has(memoryId);
}

function updatePrivateMemoryVisibilityControl() {
  privateMemoryVisibilityButton.setAttribute("aria-pressed", String(privateMemoryShowAll));
  privateMemoryVisibilityButton.setAttribute("aria-label", privateMemoryShowAll ? "Masquer toutes les données privées" : "Afficher toutes les données privées");
  privateMemoryVisibilityButton.textContent = privateMemoryShowAll ? "Masquer les données" : "Afficher les données";
}

function renderStructuredMemories(memories = loadedPrivateMemories) {
  personalMemoryList.replaceChildren();
  if (!memories.length) { const empty=document.createElement("p");empty.className="personal-empty";empty.textContent="Aucune information dans ce filtre.";personalMemoryList.append(empty);return; }
  const groups = new Map();
  for (const memory of memories) {
    const category = privateMemoryCategoryLabel(memory.category);
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(memory);
  }
  for (const [category, categoryMemories] of groups) {
    const group=document.createElement("section");group.className="private-memory-category";
    const groupTitle=document.createElement("h2");groupTitle.className="private-memory-category__title";groupTitle.textContent=category;
    const groupList=document.createElement("div");groupList.className="private-memory-category__list";
    for (const memory of categoryMemories) {
      const visible = isPrivateMemoryVisible(memory.id);
      const card=document.createElement("article");card.className="personal-card private-memory-card";card.dataset.status=memory.status;
      const head=document.createElement("div");head.className="personal-card__head";const title=document.createElement("strong");title.textContent="Information privée";const badge=document.createElement("span");badge.className="personal-card__status";badge.textContent=statusLabel(memory.status);head.append(title,badge);
      const valueRow=document.createElement("div");valueRow.className="private-memory-value-row";
      const value=document.createElement("p");value.className="private-memory-value";value.textContent=visible?memory.statement:maskPrivateMemoryValue(memory.statement);
      const reveal=document.createElement("button");reveal.type="button";reveal.className="private-memory-reveal";reveal.textContent=visible?"Masquer":"Afficher";reveal.setAttribute("aria-pressed",String(visible));reveal.setAttribute("aria-label",`${visible?"Masquer":"Afficher"} cette information privée`);
      reveal.addEventListener("click",async()=>{const targetSet=privateMemoryShowAll?hiddenPrivateMemoryIds:visiblePrivateMemoryIds;if(!visible&&!await requestPrivateMemoryAuthentication())return;if(targetSet.has(memory.id))targetSet.delete(memory.id);else targetSet.add(memory.id);renderStructuredMemories();});
      valueRow.append(value,reveal);
      const meta=document.createElement("p");meta.className="personal-card__meta";meta.textContent=`Confiance ${Math.round(memory.confidence*100)} % · ${memory.sensitivity} · ${memory.apiPolicy} · Source : ${memory.sourceType}${memory.expiresAt?` · Expire le ${new Date(memory.expiresAt).toLocaleDateString("fr-FR")}`:""}`;
      const actions=document.createElement("div");actions.className="personal-card__actions";
      const addAction=(label,handler)=>{const button=document.createElement("button");button.type="button";button.textContent=label;button.addEventListener("click",async()=>{try{await handler();await loadStructuredMemories();}catch(error){updateActivity(error.message);}});actions.append(button);};
      if(["candidate","pending_review"].includes(memory.status))addAction("Valider",()=>privateMemoryAction("confirm",{id:memory.id}));
      addAction("Corriger",async()=>{const corrected=window.prompt("Corriger cette information",memory.statement);if(corrected===null)return;await privateMemoryAction("update",{id:memory.id,changes:{statement:corrected},reason:"correction explicite"});});
      addAction("Oublier",()=>privateMemoryAction("forget",{id:memory.id}));
      card.append(head,valueRow,meta,actions);groupList.append(card);
    }
    group.append(groupTitle,groupList);personalMemoryList.append(group);
  }
}

function resetPrivateMemoryVisibility({ render = true } = {}) {
  privateMemoryShowAll = false;
  visiblePrivateMemoryIds = new Set();
  hiddenPrivateMemoryIds = new Set();
  updatePrivateMemoryVisibilityControl();
  if (render) renderStructuredMemories();
}

async function loadStructuredMemories() {
  const subjectId = privateMemoryProfiles.querySelector(".active")?.dataset.memorySubject || "arnaud";
  const params = new URLSearchParams({ subjectId }); if (personalMemorySearch.value.trim()) params.set("q", personalMemorySearch.value.trim()); if (personalMemoryStatus.value) params.set("status", personalMemoryStatus.value); if (personalMemorySensitivity.value) params.set("sensitivity", personalMemorySensitivity.value);
  const response = await fetch(`/private-memory?${params}`, { cache: "no-store" }); const data = await response.json(); if (!response.ok) throw new Error(data.message);
  privateMemoryEnabled.checked = data.settings.enabled;
  privateMemorySensitiveApi.checked = data.settings.sensitiveApiAllowed;
  const profilesResponse = await fetch("/private-memory/profiles", { cache: "no-store" });
  const profilesData = await profilesResponse.json();
  privateProfileEnabled.checked = profilesData.profiles?.find((profile) => profile.id === subjectId)?.enabled !== false;
  loadedPrivateMemories = data.memories;
  renderStructuredMemories();
}

async function privateMemoryAction(action, payload = {}) {
  const response = await fetch("/private-memory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...payload }) });
  const data = await response.json(); if (!response.ok) throw new Error(data.message); return data.result;
}

async function updatePrivateMemorySettings() {
  await privateMemoryAction("settings", { settings: { enabled: privateMemoryEnabled.checked, sensitiveApiAllowed: privateMemorySensitiveApi.checked } });
  updateActivity("Préférences de mémoire enregistrées localement.");
}

async function loadLivingProjects() {
  const response=await fetch("/personal-intelligence/projects",{cache:"no-store"});const data=await response.json();if(!response.ok)throw new Error(data.message);livingProjectsList.replaceChildren();
  if(!data.projects.length){livingProjectsList.textContent="Aucune fiche projet structurée.";return;}
  for(const project of data.projects){const card=document.createElement("article");card.className="personal-card";card.dataset.status=project.status;const head=document.createElement("div");head.className="personal-card__head";const title=document.createElement("strong");title.textContent=project.name;const badge=document.createElement("span");badge.className="personal-card__status";badge.textContent=project.status;head.append(title,badge);const next=document.createElement("p");next.textContent=`Prochaine action : ${project.nextAction||"à définir"}`;const meta=document.createElement("p");meta.className="personal-card__meta";meta.textContent=`Priorité ${project.priority}/100${project.deadline?` · Échéance ${new Date(project.deadline).toLocaleDateString("fr-FR")}`:""}`;card.append(head,next,meta);for(const signal of project.signals||[]){const warning=document.createElement("p");warning.className="personal-card__meta";warning.textContent=`J’ai détecté · ${signal.message} · confiance ${Math.round(signal.confidence*100)} %`;card.append(warning);}livingProjectsList.append(card);}
}
async function loadPersonalInbox() {
  const params=new URLSearchParams();if(personalInboxFilter.value)params.set("status",personalInboxFilter.value);const response=await fetch(`/personal-intelligence/inbox?${params}`,{cache:"no-store"});const data=await response.json();if(!response.ok)throw new Error(data.message);personalInboxList.replaceChildren();if(!data.items.length){personalInboxList.textContent="Aucun élément nécessitant votre attention.";return;}for(const item of data.items){const card=document.createElement("article");card.className="personal-card";card.dataset.status=item.status;const title=document.createElement("strong");title.textContent=item.title;const action=document.createElement("p");action.textContent=item.action||"À examiner";const meta=document.createElement("p");meta.className="personal-card__meta";meta.textContent=`${item.sourceType} · importance ${Math.round(item.importance*100)} %${item.sourceStale?" · données hors ligne potentiellement anciennes":""}`;card.append(title,action,meta);personalInboxList.append(card);}
}
async function sendRecommendationFeedback(hash,value) { const response=await fetch("/personal-intelligence/feedback",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({recommendationHash:hash,value})});if(!response.ok)throw new Error("Retour indisponible.");updateActivity("Retour enregistré localement."); }
async function loadRecommendations() {
  const response=await fetch("/personal-intelligence/recommendations",{cache:"no-store"});const data=await response.json();if(!response.ok)throw new Error(data.message);personalRecommendationList.replaceChildren();if(!data.recommendations.length){personalRecommendationList.textContent=data.protectedBreak?"Pause protégée : aucune notification non urgente.":"Aucune nouvelle recommandation utile.";return;}for(const recommendation of data.recommendations){const card=document.createElement("article");card.className="personal-card";const head=document.createElement("div");head.className="personal-card__head";const title=document.createElement("strong");title.textContent=recommendation.proposal;const score=document.createElement("span");score.className="recommendation-score";score.textContent=`${recommendation.score}/100`;head.append(title,score);const reasons=document.createElement("ul");reasons.className="recommendation-explanation";for(const text of [`Je sais : ${(recommendation.known||[]).join(", ")||"aucun fait supplémentaire"}`,`J’ai détecté : ${(recommendation.detected||[]).join(", ")}`,`J’en déduis : ${(recommendation.inferred||[]).join(", ")||"classement déterministe"}`,`Validation : ${recommendation.validationRequired?"nécessaire":"non requise"}`,`Confiance : ${Math.round(recommendation.confidence*100)} %`]){const li=document.createElement("li");li.textContent=text;reasons.append(li);}const actions=document.createElement("div");actions.className="personal-card__actions";for(const [label,value] of [["Utile","useful"],["Pas utile","not_useful"],["Plus tard","later"],["Ne plus rappeler","dont_remind"]]){const button=document.createElement("button");button.type="button";button.textContent=label;button.addEventListener("click",()=>sendRecommendationFeedback(recommendation.hash,value).catch(error=>updateActivity(error.message)));actions.append(button);}card.append(head,reasons,actions);personalRecommendationList.append(card);}
}
async function loadPersonalMetrics() { const [metricsResponse,backgroundResponse]=await Promise.all([fetch("/personal-intelligence/metrics",{cache:"no-store"}),fetch("/background-analyses",{cache:"no-store"})]);const metricsData=await metricsResponse.json();const backgroundData=await backgroundResponse.json();personalMetrics.replaceChildren();const values={"Taux d’acceptation":`${Math.round((metricsData.metrics?.acceptanceRate||0)*100)} %`,"Taux de réalisation":`${Math.round((metricsData.metrics?.completionRate||0)*100)} %`,"Propositions":metricsData.metrics?.values?.recommendations_generated||0,"Répétitions évitées":metricsData.metrics?.values?.repetitions_avoided||0};for(const [label,value] of Object.entries(values)){const card=document.createElement("div");card.className="metric-card";const text=document.createElement("span");text.textContent=label;const strong=document.createElement("strong");strong.textContent=String(value);card.append(text,strong);personalMetrics.append(card);}backgroundAnalysisList.replaceChildren();if(!backgroundData.enabled){backgroundAnalysisList.textContent="Analyses longues désactivées par configuration.";return;}for(const task of backgroundData.tasks||[]){const card=document.createElement("article");card.className="personal-card";const title=document.createElement("strong");title.textContent=task.kind;const status=document.createElement("span");status.textContent=`État : ${task.status}`;card.append(title,status);if(["queued","in_progress"].includes(task.status)){const cancel=document.createElement("button");cancel.type="button";cancel.textContent="Annuler";cancel.addEventListener("click",async()=>{await fetch(`/background-analyses/${encodeURIComponent(task.id)}/cancel`,{method:"POST"});await loadPersonalMetrics();});card.append(cancel);}backgroundAnalysisList.append(card);} }
async function loadPersonalIntelligence() { try { const profileResponse=await fetch("/personal-intelligence/profile",{cache:"no-store"});const profileData=await profileResponse.json();if(!profileResponse.ok)throw new Error(profileData.message);personalDatabaseStatus.textContent=`${profileData.database==="sqlite"?"SQLite local":"Mode dégradé JSON"}${profileData.ftsAvailable?" · recherche FTS5":" · recherche exacte"}`;await Promise.all([loadStructuredMemories(),loadLivingProjects(),loadPersonalInbox(),loadRecommendations(),loadPersonalMetrics()]); } catch(error){personalDatabaseStatus.textContent=error.message;updateActivity(error.message);} }

personalTabs.forEach((button)=>button.addEventListener("click",()=>{const leavingKnowledge=button.dataset.personalTab!=="knowledge";resetPrivateMemoryVisibility();personalTabs.forEach(item=>{const active=item===button;item.classList.toggle("active",active);item.setAttribute("aria-pressed",String(active));});personalPanels.forEach(panel=>{const active=panel.dataset.personalPanel===button.dataset.personalTab;panel.classList.toggle("active",active);panel.hidden=!active;});if(!leavingKnowledge)void loadStructuredMemories().catch(error=>updateActivity(error.message));}));
let personalMemorySearchTimer=null;personalMemorySearch.addEventListener("input",()=>{clearTimeout(personalMemorySearchTimer);personalMemorySearchTimer=setTimeout(()=>loadStructuredMemories().catch(error=>updateActivity(error.message)),250);});personalMemoryStatus.addEventListener("change",()=>loadStructuredMemories().catch(error=>updateActivity(error.message)));personalInboxFilter.addEventListener("change",()=>loadPersonalInbox().catch(error=>updateActivity(error.message)));
personalMemorySensitivity.addEventListener("change",()=>loadStructuredMemories().catch(error=>updateActivity(error.message)));
privateMemoryVisibilityButton.addEventListener("click",async()=>{if(!privateMemoryShowAll&&!await requestPrivateMemoryAuthentication())return;privateMemoryShowAll=!privateMemoryShowAll;visiblePrivateMemoryIds.clear();hiddenPrivateMemoryIds.clear();updatePrivateMemoryVisibilityControl();renderStructuredMemories();});
privateMemoryTouchIdButton.addEventListener("click",async()=>{privateMemoryAuthError.hidden=true;try{const result=await window.noon.authenticatePrivateMemory({method:"touch-id"});if(result?.authenticated)finishPrivateMemoryAuthentication(true);}catch{showPrivateMemoryAuthError("Touch ID annulé ou non reconnu.");}});
privateMemoryAuthForm.addEventListener("submit",async(event)=>{event.preventDefault();privateMemoryAuthError.hidden=true;const password=privateMemoryPasswordInput.value;if(password.length<8){showPrivateMemoryAuthError("Le mot de passe doit contenir au moins 8 caractères.");return;}try{const result=privateMemoryPasswordConfigured?await window.noon.authenticatePrivateMemory({method:"password",password}):await window.noon.setPrivateMemoryPassword(password);if(result?.authenticated||result?.configured)finishPrivateMemoryAuthentication(true);}catch(error){showPrivateMemoryAuthError(error?.message||"Confirmation refusée.");privateMemoryPasswordInput.select();}});
privateMemoryAuthCancel.addEventListener("click",()=>finishPrivateMemoryAuthentication(false));
privateMemoryAuthDialog.addEventListener("cancel",(event)=>{event.preventDefault();finishPrivateMemoryAuthentication(false);});
privateMemoryProfiles.addEventListener("click",(event)=>{const button=event.target.closest("[data-memory-subject]");if(!button)return;privateMemoryProfiles.querySelectorAll("button").forEach((item)=>item.classList.toggle("active",item===button));void loadStructuredMemories().catch(error=>updateActivity(error.message));});
privateMemoryEnabled.addEventListener("change",()=>void updatePrivateMemorySettings().catch(error=>updateActivity(error.message)));
privateMemorySensitiveApi.addEventListener("change",()=>void updatePrivateMemorySettings().catch(error=>updateActivity(error.message)));
privateProfileEnabled.addEventListener("change",async()=>{try{const subjectId=privateMemoryProfiles.querySelector(".active")?.dataset.memorySubject||"arnaud";await privateMemoryAction("profile-settings",{subjectId,enabled:privateProfileEnabled.checked});updateActivity("Préférence du profil enregistrée.");}catch(error){updateActivity(error.message);}});
privateMemoryExportButton.addEventListener("click",async()=>{try{const subjectId=privateMemoryProfiles.querySelector(".active")?.dataset.memorySubject||"arnaud";const response=await fetch(`/private-memory/export?subjectId=${encodeURIComponent(subjectId)}`,{cache:"no-store"});const data=await response.json();if(!response.ok)throw new Error(data.message);const url=URL.createObjectURL(new Blob([JSON.stringify(data.export,null,2)],{type:"application/json"}));const link=document.createElement("a");link.href=url;link.download=`noon-memoire-${subjectId}.private.json`;link.click();URL.revokeObjectURL(url);updateActivity("Export privé créé.");}catch(error){updateActivity(error.message);}});
privateMemoryPurgeButton.addEventListener("click",async()=>{const subjectId=privateMemoryProfiles.querySelector(".active")?.dataset.memorySubject||"arnaud";if(!window.confirm(`Purger définitivement toute la mémoire du profil ${subjectId} ?`))return;if(!window.confirm("Cette suppression est irréversible. Confirmer une seconde fois ?"))return;try{await privateMemoryAction("purge",{subjectId});await loadStructuredMemories();updateActivity("Profil purgé définitivement.");}catch(error){updateActivity(error.message);}});
privateMemoryImportButton.addEventListener("click",()=>{const picker=document.createElement("input");picker.type="file";picker.accept=".json,application/json";picker.addEventListener("change",async()=>{const file=picker.files?.[0];if(!file)return;try{const seed=JSON.parse(await file.text());const previewResponse=await fetch("/private-memory/import/preview",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({seed})});const previewData=await previewResponse.json();if(!previewResponse.ok||!previewData.result?.valid)throw new Error(previewData.message||(previewData.result?.errors||[]).join(" "));const selectedIndexes=[];for(const entry of previewData.result.entries){if(entry.duplicate||entry.expired)continue;const accepted=window.confirm(`Importer dans ${entry.subjectId} ?\n\n${entry.statementPreview}\n\nStatut : ${entry.status} · Sensibilité : ${entry.sensitivity}`);if(accepted)selectedIndexes.push(entry.index);}if(!selectedIndexes.length){updateActivity("Import annulé : aucune entrée validée.");return;}const importResponse=await fetch("/private-memory/import",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({seed,selectedIndexes})});const imported=await importResponse.json();if(!importResponse.ok)throw new Error(imported.message);await loadStructuredMemories();updateActivity(`${imported.result.importedCount} souvenir(s) chiffré(s). Supprimez le fichier source privé si vous n’en avez plus besoin.`);}catch(error){updateActivity(`Import refusé : ${error.message}`);}});picker.click();});
updatePrivateMemoryVisibilityControl();
for (const [element, key, value] of [[creativeBriefEnabledInput, "creativeBriefEnabled", () => creativeBriefEnabledInput.checked], [creativeBriefTimeInput, "creativeBriefTime", () => creativeBriefTimeInput.value], [creativeBriefNotificationsInput, "creativeBriefNotifications", () => creativeBriefNotificationsInput.checked], [launchAtLoginInput, "launchAtLogin", () => launchAtLoginInput.checked]]) element.addEventListener("change", () => window.noon?.setPreference(key, value()));

function setVisualState(nextState) {
  if (typeof window.setNoonState === "function") {
    window.setNoonState(nextState);
  }
}

function startSpeechAnimation() {
  clearInterval(speechAnimationTimer);
  speechAnimationTimer = setInterval(() => {
    if (typeof window.setAudioLevel === "function") {
      window.setAudioLevel(0.25 + Math.random() * 0.55);
    }
  }, 70);
}

function stopSpeechAnimation() {
  clearInterval(speechAnimationTimer);
  speechAnimationTimer = null;
  if (typeof window.setAudioLevel === "function") window.setAudioLevel(0);
}

function prepareTextForSpeech(text) {
  if (!text) return "";

  let spokenText = text
    .replace(
      /```[\s\S]*?```/g,
      " J’ai affiché le code dans la conversation. "
    )
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/[*_~>]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const maxLength = 700;

  if (spokenText.length > maxLength) {
    const excerpt = spokenText.slice(0, maxLength);
    const lastSentence = Math.max(
      excerpt.lastIndexOf("."),
      excerpt.lastIndexOf("!"),
      excerpt.lastIndexOf("?")
    );

    spokenText =
      lastSentence > 250
        ? excerpt.slice(0, lastSentence + 1)
        : excerpt.trim();

    spokenText +=
      " La réponse complète est affichée à l’écran.";
  }

  return spokenText;
}

function notifyAnswerReady(answer) {
  if (!notificationsEnabled) return;
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  // L’alerte est inutile lorsque la fenêtre Noon est déjà consultée.
  if (!document.hidden && document.hasFocus()) return;

  const spokenPreview = prepareTextForSpeech(answer);
  const notification = new Notification("Noon — réponse prête", {
    body:
      spokenPreview.slice(0, 180) ||
      "La réponse est disponible.",
    tag: "noon-answer",
  });

  notification.addEventListener("click", () => {
    window.focus();
    notification.close();
  });
}


async function reportVoiceMetrics(executionId) {
  if (!executionId || !window.noonVoiceMetrics) return;
  try {
    await fetch("/api/diagnostics/voice", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Noon-Request": "1" },
      body: JSON.stringify({ executionId, metrics: window.noonVoiceMetrics }),
    });
  } catch {
    // L'observabilité audio ne doit jamais interrompre la réponse.
  }
}

async function speakNoon(text, executionId = null) {
  interruptNoonSpeech(false);
  const sessionId = ++speechSessionId;
  classicSpeechController = new AbortController();
  const ttsRequestedAt = performance.now();
  window.noonVoiceMetrics ||= {};

  try {
    const identityResponse = await fetch("/voice/identity?pipeline=tts", { cache: "no-store" });
    const policy = await identityResponse.json();
    if (!identityResponse.ok || !policy.resolved.activeVoice) {
      document.getElementById("noonVoicePolicy").dataset.state = "VoiceUnavailable";
      updateActivity(`Voix Noon : ${policy.resolved?.displayName || "Arbor"} — ${policy.resolved?.statusMessage || "indisponible"}. Réponse textuelle uniquement.`);
      return;
    }
    const response = await fetch("/tts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Noon-Request": "1",
      },
      body: JSON.stringify({
        text,
        language: localStorage.getItem("noonVoiceLanguage") || "fr-FR",
        accent: localStorage.getItem("noonVoiceAccent") || "none",
        mode: currentMode,
      }),
      signal: classicSpeechController.signal,
    });

    if (!response.ok || !response.body) {
      throw new Error("Voix OpenAI indisponible");
    }
    window.noonVoiceMetrics.voiceIdentity = response.headers.get("X-Noon-Voice-Identity") || "noon-default";
    window.noonVoiceMetrics.voice = response.headers.get("X-Noon-Voice") || null;
    window.noonVoiceMetrics.voiceIdentityResolveMs = Number(response.headers.get("X-Voice-Identity-Resolve-Ms")) || 0;
    window.noonVoiceMetrics.ttsStartMs = Number(response.headers.get("X-TTS-Start-Ms")) || Math.round(performance.now() - ttsRequestedAt);
    window.noonVoiceMetrics.fallbackCount = response.headers.get("X-Noon-Voice-Fallback") === "true" ? 1 : 0;

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    classicAudioContext = new AudioContextClass({ sampleRate: 24000 });
    if (preferredAudioOutputId && typeof classicAudioContext.setSinkId === "function") {
      await classicAudioContext.setSinkId(preferredAudioOutputId);
    }
    await classicAudioContext.resume();
    const reader = response.body.getReader();
    let nextStartTime = classicAudioContext.currentTime + 0.08;
    let trailingByte = null;
    let started = false;

    currentSpeech = { type: "openai-tts", sessionId };

    while (true) {
      const { done, value } = await reader.read();
      if (done || sessionId !== speechSessionId) break;

      let bytes = value;
      if (trailingByte !== null) {
        const joined = new Uint8Array(value.length + 1);
        joined[0] = trailingByte;
        joined.set(value, 1);
        bytes = joined;
        trailingByte = null;
      }
      if (bytes.length % 2 === 1) {
        trailingByte = bytes[bytes.length - 1];
        bytes = bytes.subarray(0, bytes.length - 1);
      }
      if (bytes.length === 0) continue;

      const samples = new Float32Array(bytes.length / 2);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      for (let index = 0; index < samples.length; index += 1) {
        samples[index] = view.getInt16(index * 2, true) / 32768;
      }
      const audioBuffer = classicAudioContext.createBuffer(1, samples.length, 24000);
      audioBuffer.copyToChannel(samples, 0);
      const source = classicAudioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.playbackRate.value = voiceRate;
      source.connect(classicAudioContext.destination);
      source.addEventListener("ended", () => classicAudioSources.delete(source));
      classicAudioSources.add(source);
      source.start(nextStartTime);
      nextStartTime += audioBuffer.duration / voiceRate;

      if (!started) {
        started = true;
        window.noonVoiceMetrics.timeToFirstAudioMs = Math.round(performance.now() - ttsRequestedAt);
        updateActivity("Noon parle…");
        setVisualState("speaking");
        startSpeechAnimation();
      }
    }

    const remainingMs = Math.max(
      0,
      (nextStartTime - classicAudioContext.currentTime) * 1000
    );
    await new Promise((resolve) => window.setTimeout(resolve, remainingMs));
    if (sessionId === speechSessionId) {
      window.noonVoiceMetrics.ttsTotalMs = Math.round(performance.now() - ttsRequestedAt);
      await reportVoiceMetrics(executionId);
      stopSpeechAnimation();
      currentSpeech = null;
      updateActivity("En attente.");
      setVisualState("idle");
    }
  } catch (error) {
    if (error.name === "AbortError" || sessionId !== speechSessionId) return;
    window.noonVoiceMetrics.fallbackCount = (window.noonVoiceMetrics.fallbackCount || 0) + 1;
    stopSpeechAnimation();
    currentSpeech = null;
    updateActivity("Voix Noon indisponible. Réponse textuelle uniquement.");
    setVisualState("idle");
  }
}

function interruptNoonSpeech(announce = true) {
  speechSessionId += 1;
  classicSpeechController?.abort();
  classicSpeechController = null;
  for (const source of classicAudioSources) {
    try { source.stop(); } catch { /* Source déjà arrêtée. */ }
  }
  classicAudioSources.clear();
  classicAudioContext?.close().catch(() => {});
  classicAudioContext = null;
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();

  if (typeof stopSpeechAnimation === "function") {
    stopSpeechAnimation();
  }

  currentSpeech = null;
  if (announce) updateActivity("Réponse interrompue.");

  if (typeof window.setAudioLevel === "function") {
    window.setAudioLevel(0);
  }

  setVisualState("idle");
}

async function loadBudget() {
  try {
    const response = await fetch("/budget");
    const data = await response.json();

    if (!response.ok || !data.budget) {
      throw new Error("Budget indisponible");
    }

    const { costUSD, monthlyBudgetUSD, mode } = data.budget;
    const percent = Math.min(100, (costUSD / monthlyBudgetUSD) * 100);

    budgetValue.textContent = `${costUSD.toFixed(4)} € / ${monthlyBudgetUSD.toFixed(2)} €`;
    budgetMode.textContent = mode;
    budgetProgress.style.width = `${percent}%`;
  } catch {
    budgetValue.textContent = "Indisponible";
    budgetMode.textContent = "—";
    budgetProgress.style.width = "0%";
  }
}

function updateFocusFromQuestion(question) {
  const command = parseFocusCommand(question);
  if (!command) return;
  if (command.action === "clear") {
    setFocus(null);
    return;
  }
  const requestedName = command.name.toLocaleLowerCase("fr-FR");
  const option = [...document.querySelectorAll(".focus-option")].find(
    (candidate) =>
      !candidate.disabled &&
      candidate.dataset.focus?.trim().toLocaleLowerCase("fr-FR") === requestedName
  );
  if (!option) {
    updateActivity(`Focus introuvable : ${command.name}`);
    return;
  }

  setFocus({
    id: option.dataset.focusId || "",
    displayName: option.dataset.focus,
    resolvedPath: option.dataset.focusPath || "",
    available: true,
  });
}

// Verrouille les commandes coûteuses et affiche le temps d’attente courant.
function startRequestTimer() {
  clearInterval(requestTimerInterval);

  requestStartedAt = Date.now();
  requestTimer.hidden = false;
  requestTimer.textContent = "0 s";

  requestTimerInterval = setInterval(() => {
    const elapsedSeconds = Math.floor(
      (Date.now() - requestStartedAt) / 1000
    );

    requestTimer.textContent = `${elapsedSeconds} s`;
  }, 1000);
}

function stopRequestTimer() {
  clearInterval(requestTimerInterval);
  requestTimerInterval = null;
  requestStartedAt = null;
  requestTimer.hidden = true;
  requestTimer.textContent = "0 s";
}

function updateActionButtons() {
  const disabled =
    requestInProgress || rateLimitCooldownActive;

  sendButton.disabled = disabled;
  attachButton.disabled = disabled;
  micButton.disabled = disabled;
  webSearchButton.disabled =
    disabled || remainingWebSearches <= 0;
}

function setRequestInProgress(inProgress) {
  requestInProgress = inProgress;
  updateActionButtons();
  stopRequestButton.hidden = !inProgress;

  if (inProgress) {
    startRequestTimer();
  } else {
    stopRequestTimer();
  }
}

function startRateLimitCooldown(seconds) {
  clearInterval(rateLimitCooldownTimer);

  const safeSeconds = Math.min(
    Math.max(Number(seconds) || 20, 5),
    300
  );
  const jitter = Math.ceil(Math.random() * 2);
  const cooldownEnd =
    Date.now() + (safeSeconds + jitter) * 1000;

  rateLimitCooldownActive = true;
  retryButton.hidden = true;
  updateActionButtons();

  function updateCooldown() {
    const remainingSeconds = Math.max(
      0,
      Math.ceil((cooldownEnd - Date.now()) / 1000)
    );

    if (remainingSeconds > 0) {
      updateActivity(
        `Limite API atteinte. Réessai possible dans ${remainingSeconds} s.`
      );
      return;
    }

    clearInterval(rateLimitCooldownTimer);
    rateLimitCooldownTimer = null;
    rateLimitCooldownActive = false;
    updateActionButtons();
    retryButton.hidden = !lastFailedQuestion;
    updateActivity("Tu peux maintenant réessayer.");
  }

  updateCooldown();
  rateLimitCooldownTimer = setInterval(updateCooldown, 1000);
}

async function saveQuickCapture(question, text, displayUserMessage = true) {
  if (displayUserMessage) addMessage("Vous", question, "user", true);
  promptInput.value = "";
  resizePromptInput();
  try {
    const response = await fetch("/capture", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Noon-Request": "1" },
      body: JSON.stringify({ text, origin: "chat" }),
    });
    let data;
    try { data = await response.json(); } catch { data = {}; }
    if (!response.ok) throw new Error(data.message || "Note non enregistrée.");
    addMessage("Noon", `Noté : « ${data.capture.text} ». Je la garde dans ta boîte de réception pour le tri du Brief.`, "noon", true);
    updateActivity("Note enregistrée.");
  } catch (error) {
    addMessage("Noon", `Je n'ai pas pu enregistrer la note : ${error.message}`, "noon", true);
    updateActivity("Note non enregistrée.");
  }
}

// V3-L2b : point de reprise local (aucun appel au modèle).
async function showResumeBriefing(question, displayUserMessage = true) {
  if (displayUserMessage) addMessage("Vous", question, "user", true);
  promptInput.value = "";
  resizePromptInput();
  try {
    const query = new URLSearchParams();
    if (currentFocusId) query.set("focusId", currentFocusId);
    if (currentFocusPath) query.set("focusPath", currentFocusPath);
    const response = await fetch(`/resume?${query}`, { cache: "no-store" });
    let data;
    try { data = await response.json(); } catch { data = {}; }
    if (!response.ok) throw new Error(data.message || "Point de reprise indisponible.");
    addMessage("Noon", data.text, "noon", true);
    updateActivity("Point de reprise prêt.");
  } catch (error) {
    addMessage("Noon", `Je n'ai pas pu retrouver où tu en étais : ${error.message}`, "noon", true);
  }
}

// V3-L2c : « Je dois faire X » → une première action de 2 à 5 min, enregistrable en un clic.
async function showFirstStep(question, task, displayUserMessage = true) {
  if (displayUserMessage) addMessage("Vous", question, "user", true);
  promptInput.value = "";
  resizePromptInput();
  requestInProgress = true;
  updateActivity("Noon cherche un premier pas…");
  try {
    const response = await fetch("/first-step", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Noon-Request": "1" },
      body: JSON.stringify({ task }),
    });
    let data;
    try { data = await response.json(); } catch { data = {}; }
    if (!response.ok) throw new Error(data.message || "Premier pas indisponible.");
    const message = addMessage("Noon", data.text, "noon", true);
    const actions = document.createElement("div");
    actions.className = "message-actions first-step-actions";
    const save = document.createElement("button");
    save.type = "button";
    save.textContent = "Enregistrer comme prochaine action";
    save.addEventListener("click", async () => {
      save.disabled = true;
      try {
        const saveResponse = await fetch("/first-step/save", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Noon-Request": "1" },
          body: JSON.stringify({ task: data.result.task, step: data.result.step, focusId: currentFocusId || null, focusPath: currentFocusPath || null }),
        });
        let saved;
        try { saved = await saveResponse.json(); } catch { saved = {}; }
        if (!saveResponse.ok) throw new Error(saved.message || "Enregistrement impossible.");
        save.textContent = saved.saved.savedTo === "project" ? `Enregistrée pour ${saved.saved.projectName}` : "Enregistrée dans ta boîte de réception";
        updateActivity("Prochaine action enregistrée.");
      } catch (error) {
        save.disabled = false;
        updateActivity(`Prochaine action non enregistrée : ${error.message}`);
      }
    });
    actions.append(save);
    message.append(actions);
    updateActivity("Premier pas prêt.");
  } catch (error) {
    addMessage("Noon", `Je n'ai pas pu proposer de premier pas : ${error.message}`, "noon", true);
    updateActivity("Premier pas indisponible.");
  } finally {
    requestInProgress = false;
  }
}

async function sendQuestion(question, options = {}) {
  if (requestInProgress) {
    updateActivity("Noon traite déjà une demande.");
    return;
  }

  if (rateLimitCooldownActive) {
    updateActivity("Le délai avant réessai est encore actif.");
    return;
  }

  const {
    displayUserMessage = true,
    skipWebSuggestion = false,
    webSearchForbidden = false,
  } = options;
  const filesToSend = [...selectedFiles];
  const attachmentMetadata =
    createAttachmentMetadata(filesToSend);

  if (!question && filesToSend.length === 0) return;

  // V3-L2a : « Noon, note ça : … » est enregistré localement, sans appel au modèle.
  const captureCommand = filesToSend.length === 0 ? parseCaptureCommand(question) : null;
  if (captureCommand) {
    await saveQuickCapture(question, captureCommand.text, displayUserMessage);
    return;
  }
  if (filesToSend.length === 0 && isResumeCommand(question)) {
    await showResumeBriefing(question, displayUserMessage);
    return;
  }
  const firstStepCommand = filesToSend.length === 0 ? parseFirstStepCommand(question) : null;
  if (firstStepCommand) {
    await showFirstStep(question, firstStepCommand.task, displayUserMessage);
    return;
  }

  if (
    !skipWebSuggestion &&
    !webSearchEnabled &&
    shouldSuggestWebSearch(question)
  ) {
    showWebSearchSuggestion();
    return;
  }

  hideWebSearchSuggestion();

  const finalQuestion =
    question ||
    "Analyse ce fichier et explique-moi les points importants.";

  setRequestInProgress(true);

  let attachments = [];

  if (filesToSend.length > 0) {
    try {
      attachments = await Promise.all(
        filesToSend.map((file) => buildAttachment(file))
      );
    } catch {
      updateActivity("Impossible de lire le fichier.");
      setRequestInProgress(false);
      return;
    }
  }

  currentSpeech = null;
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  stopSpeechAnimation();

  if (displayUserMessage) {
    addMessage(
      "Vous",
      finalQuestion,
      "user",
      true,
      attachmentMetadata
    );
  }
  updateFocusFromQuestion(finalQuestion);
  promptInput.value = "";
  resizePromptInput();
  updateActivity("Noon réfléchit…");
  setVisualState("thinking");
  startActivityPolling();

  try {
    activeRequestController = new AbortController();

    const streamedMessage = addMessage(
      "Noon",
      "",
      "noon streaming-message",
      false
    );

    const streamedParagraph =
      streamedMessage.querySelector("p");

    const progressElement =
      document.createElement("div");

    progressElement.className =
      "message-progress";

    progressElement.hidden = true;

    streamedMessage.append(
      progressElement
    );

    let streamedText = "";
    const response = await fetch("/ai/stream", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(createChatRequestPayload({
        question: finalQuestion,
        focus: currentFocus,
        focusPath: currentFocusPath,
        focusId: currentFocusId,
        mode: currentMode,
        sessionId: currentSessionId,
        attachments,
        visualDetail,
        webSearchEnabled,
        webSearchForbidden,
        intelligenceProfile,
        runtimeNetworkState: navigator.onLine ? "ONLINE" : "OFFLINE",
      })),
      signal: activeRequestController.signal,
    });
    const data =
      await readNoonEventStream(
        response,

        (delta) => {
          streamedText += delta;

          streamedParagraph.textContent = streamedText;

          conversation.scrollTop =
            conversation.scrollHeight;
        },

        (progress) => {
          updateChatProgress(
            progressElement,
            progress
          );

          conversation.scrollTop =
            conversation.scrollHeight;
        }
      );
    streamedMessage.remove();

    stopActivityPolling();
    addMessage(
      "Noon",
      data.answer,
      "noon",
      true,
      [],
      Array.isArray(data.sources) ? data.sources : [],
      Array.isArray(data.artifacts) ? data.artifacts : []
    );
    if (data.status === "approval_required" && data.approval) {
      addApprovalCard(data.approval);
      void loadPendingApprovals();
    }
    notifyAnswerReady(data.answer);
    if (data.memoryContext && privateMemoryWhy) {
      privateMemoryWhy.textContent = data.memoryContext.reason || "Aucune mémoire privée utilisée.";
    }
    hideWebSearchSuggestion();
    webSearchEnabled = false;
    updateWebSearchButton();
    updateWebSearchUsage(data.webSearchUsage);
    lastFailedQuestion = null;
    retryButton.hidden = true;
    retryButton.disabled = false;
    clearSavedDraft();
    void loadConversationIndex();
    updateActivity("Réponse reçue.");

    if (attachments.length > 0) {
      clearSelectedFile(false);
    }

    if (voiceEnabled && currentView !== "chat") {
      const spokenAnswer = prepareTextForSpeech(data.answer);

      if (spokenAnswer) {
        speakNoon(spokenAnswer, data.executionId || null);
      }
    } else {
      updateActivity("Réponse affichée.");
      setVisualState("idle");
    }

    loadBudget();
  } catch (error) {
    conversation.querySelector(".streaming-message")?.remove();
    stopActivityPolling();

    if (error.name === "AbortError") {
      hideWebSearchSuggestion();
      updateActivity("Demande interrompue.");
      promptInput.value = finalQuestion;
      resizePromptInput();
      saveCurrentDraft();
      lastFailedQuestion = null;
      retryButton.hidden = true;
      setVisualState("idle");
      return;
    }

    if (error.status === 429) {
      promptInput.value = finalQuestion;
      resizePromptInput();
      saveCurrentDraft();
      lastFailedQuestion = finalQuestion;

      if (error.code === "WEB_SEARCH_DAILY_LIMIT") {
        updateWebSearchUsage({ used: 10, limit: 10 });
      }

      if (error.retryable) {
        startRateLimitCooldown(error.retryAfter);
      } else {
        retryButton.hidden = true;

        const messagesByCode = {
          credit_balance_exhausted:
            "Les crédits API sont épuisés.",
          organization_spend_limit_exceeded:
            "Le plafond de dépenses de l’organisation est atteint.",
          project_spend_limit_exceeded:
            "Le plafond de dépenses du projet est atteint.",
          organization_usage_limit_exceeded:
            "La limite d’utilisation de l’organisation est atteinte.",
          WEB_SEARCH_DAILY_LIMIT:
            "La limite quotidienne de 10 recherches Internet est atteinte.",
        };

        updateActivity(
          messagesByCode[error.code] ||
          "Limite API atteinte. Vérifie la facturation OpenAI."
        );
      }

      setVisualState("idle");
      return;
    }

    addMessage("Noon", error.message, "noon");
    lastFailedQuestion = finalQuestion;
    retryButton.hidden = false;
    retryButton.disabled = false;
    updateActivity("Échec de l’envoi. La question est conservée.");
    promptInput.value = finalQuestion;
    resizePromptInput();
    saveCurrentDraft();
    promptInput.focus();
    promptInput.setSelectionRange(
      promptInput.value.length,
      promptInput.value.length
    );
    setVisualState("idle");
    checkNoonConnection();
  } finally {
    activeRequestController = null;
    stopRequestButton.disabled = false;
    setRequestInProgress(false);
  }
}

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const question = promptInput.value.trim();
  if (/^(contrôle (?:le )?projet|où en est|quelle est la prochaine étape|qu['’]est-ce qui bloque)/i.test(question)) {
    promptInput.value = "";
    resizePromptInput();
    await controlActiveProject();
    return;
  }
  if (/^(fin de session|termine cette session|enregistre où nous en sommes|fais le bilan du projet)/i.test(question)) {
    promptInput.value = "";
    resizePromptInput();
    await endActiveProjectSession();
    return;
  }
  await sendQuestion(question);
});

viewButtons.forEach((button) => {
  button.addEventListener("click", () => switchView(button.dataset.view));
});

newConversationButton.addEventListener("click", async () => {
  if (requestInProgress) {
    updateActivity(
      "Attends la fin de la réponse avant de changer de conversation."
    );
    return;
  }

  if (
    mediaRecorder &&
    mediaRecorder.state === "recording"
  ) {
    updateActivity("Arrête d’abord l’enregistrement vocal.");
    return;
  }

  newConversationButton.disabled = true;
  hideWebSearchSuggestion();
  interruptNoonSpeech();
  updateActivity("Création d’une conversation…");

  try {
    await createNewConversation();
  } catch (error) {
    updateActivity(error.message);
  } finally {
    newConversationButton.disabled = false;
  }
});

shareConversationButton.addEventListener("click", (event) => {
  event.stopPropagation();
  shareConversationMenu.hidden = !shareConversationMenu.hidden;
  shareConversationButton.setAttribute("aria-expanded", String(!shareConversationMenu.hidden));
});

shareConversationMenu.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-share-target]")?.dataset.shareTarget;
  if (!target) return;
  const messages = loadSavedMessages();

  if (messages.length === 0) {
    updateActivity("Aucune conversation à partager.");
    return;
  }

  const markdown = createConversationMarkdown(messages);
  const date = new Date().toISOString().slice(0, 10);
  shareConversationMenu.hidden = true;
  shareConversationButton.setAttribute("aria-expanded", "false");
  try {
    const result = await window.noon.shareConversation({
      target,
      markdown,
      suggestedName: `conversation-noon-${date}.md`,
    });
    updateActivity(result?.message || "Conversation prête à être partagée.");
  } catch (error) {
    updateActivity(error.message);
  }
});

stopRequestButton.addEventListener("click", () => {
  if (!activeRequestController) return;

  updateActivity("Interruption de la demande…");
  stopRequestButton.disabled = true;
  activeRequestController.abort();
});

retryButton.addEventListener("click", async () => {
  if (!lastFailedQuestion) {
    retryButton.hidden = true;
    return;
  }

  if (!navigator.onLine) {
    updateActivity("Connexion Internet toujours indisponible.");
    checkNoonConnection();
    return;
  }

  retryButton.disabled = true;
  updateActivity("Nouvelle tentative…");

  await sendQuestion(lastFailedQuestion, {
    displayUserMessage: false,
  });
});

clearChatButton.addEventListener("click", async () => {
  if (requestInProgress) return;
  await createNewConversation();
});

const MAX_RECORDING_MS = 20_000;

let mediaStream = null;
