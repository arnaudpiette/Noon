const SESSION_STORAGE_KEY = "noonSessionId";
const CONVERSATION_STORAGE_KEY = "noonDisplayedConversation";
const DRAFT_STORAGE_KEY = "noonDraft";
const MAX_DRAFT_LENGTH = 10_000;

let draftSaveTimer = null;
let lastFailedQuestion = null;
let requestInProgress = false;
let requestTimerInterval = null;
let requestStartedAt = null;
let activeRequestController = null;
let rateLimitCooldownActive = false;
let rateLimitCooldownTimer = null;

// Une session stable permet au serveur de retrouver la mémoire correspondante.
let currentSessionId = localStorage.getItem(
  SESSION_STORAGE_KEY
);

if (!currentSessionId) {
  currentSessionId =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `noon-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2)}`;

  localStorage.setItem(
    SESSION_STORAGE_KEY,
    currentSessionId
  );
}

function conversationStorageKey(sessionId = currentSessionId) {
  return `${CONVERSATION_STORAGE_KEY}:${sessionId}`;
}

const legacyDisplayedConversation = localStorage.getItem(CONVERSATION_STORAGE_KEY);
if (legacyDisplayedConversation && !localStorage.getItem(conversationStorageKey())) {
  localStorage.setItem(conversationStorageKey(), legacyDisplayedConversation);
  localStorage.removeItem(CONVERSATION_STORAGE_KEY);
}

function createSessionId() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `noon-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function setSidebar(open, persist = true) {
  document.body.classList.toggle("sidebar-collapsed", !open);
  sidebarToggle.setAttribute("aria-expanded", String(open));
  const sidebarActionLabel = open
    ? "Fermer la barre latérale"
    : "Ouvrir la barre latérale";
  sidebarToggle.setAttribute("aria-label", sidebarActionLabel);
  sidebarToggle.dataset.tooltip = sidebarActionLabel;
  if (persist) localStorage.setItem("noon-sidebar-open", String(open));
}

sidebarToggle.addEventListener("click", () => {
  setSidebar(document.body.classList.contains("sidebar-collapsed"));
});

sidebarBackdrop.addEventListener("click", () => setSidebar(false));

// Le rail compact conserve les raccourcis principaux lorsque la sidebar est repliée.
collapsedSidebarRail.addEventListener("click", (event) => {
  const actionButton = event.target.closest("[data-rail-action]");
  if (!actionButton) {
    setSidebar(true);
    return;
  }

  const action = actionButton.dataset.railAction;
  if (action === "new") {
    setSidebar(true);
    newConversationButton.click();
    return;
  }

  setSidebar(true);

  if (action === "projects") {
    conversationProjects.open = true;
    requestAnimationFrame(() => conversationProjects.scrollIntoView({ block: "start" }));
  } else if (action === "chats") {
    conversationHistory.open = true;
    requestAnimationFrame(() => conversationHistory.scrollIntoView({ block: "start" }));
  }
});

settingsButton.addEventListener("click", (event) => {
  event.stopPropagation();
  quickSettings.hidden = !quickSettings.hidden;
  settingsButton.setAttribute(
    "aria-expanded",
    String(!quickSettings.hidden)
  );
});

systemStatusButton.addEventListener("click", async () => {
  systemStatusButton.disabled = true;
  updateActivity("Vérification de l’état de Noon…");
  await checkNoonConnection();
  updateActivity(connectionStatusText.textContent);
  systemStatusButton.disabled = false;
  await window.NoonControlCenter?.open?.();
});

voiceEnabledInput.addEventListener("change", () => {
  voiceEnabled = voiceEnabledInput.checked;
  localStorage.setItem(
    "noonVoiceEnabled",
    String(voiceEnabled)
  );

  if (!voiceEnabled) {
    interruptNoonSpeech();
    updateActivity("Voix désactivée.");
  } else {
    updateActivity("Voix activée.");
  }
});

notificationsEnabledInput.addEventListener("change", async () => {
  if (!("Notification" in window)) {
    notificationsEnabledInput.checked = false;
    updateActivity("Notifications indisponibles.");
    return;
  }

  if (notificationsEnabledInput.checked) {
    let permission = Notification.permission;

    if (permission === "default") {
      permission = await Notification.requestPermission();
    }

    if (permission !== "granted") {
      notificationsEnabledInput.checked = false;
      notificationsEnabled = false;
      localStorage.setItem(
        "noonNotificationsEnabled",
        "false"
      );
      updateActivity("Autorisation de notification refusée.");
      return;
    }
  }

  notificationsEnabled = notificationsEnabledInput.checked;
  localStorage.setItem(
    "noonNotificationsEnabled",
    String(notificationsEnabled)
  );
  updateActivity(
    notificationsEnabled
      ? "Notifications activées."
      : "Notifications désactivées."
  );
});

voiceRateSelect.addEventListener("change", () => {
  voiceRate = Number(voiceRateSelect.value);
  localStorage.setItem("noonVoiceRate", String(voiceRate));
  updateActivity("Vitesse vocale enregistrée.");
});

function replaceAudioDeviceOptions(select, devices, defaultLabel, selectedId) {
  select.replaceChildren();
  const systemDefault = document.createElement("option");
  systemDefault.value = "";
  systemDefault.textContent = defaultLabel;
  select.append(systemDefault);
  devices.forEach((device, index) => {
    const option = document.createElement("option");
    option.value = device.deviceId;
    option.textContent = device.label || `${defaultLabel} ${index + 1}`;
    select.append(option);
  });
  select.value = devices.some(({ deviceId }) => deviceId === selectedId)
    ? selectedId
    : "";
}

async function refreshAudioDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter(({ kind }) => kind === "audioinput");
    const outputs = devices.filter(({ kind }) => kind === "audiooutput");
    replaceAudioDeviceOptions(
      audioInputDeviceSelect,
      inputs,
      "Microphone système par défaut",
      preferredAudioInputId
    );
    replaceAudioDeviceOptions(
      audioOutputDeviceSelect,
      outputs,
      "Sortie système par défaut",
      preferredAudioOutputId
    );
    if (audioInputDeviceSelect.value !== preferredAudioInputId) {
      preferredAudioInputId = "";
      localStorage.removeItem(AUDIO_INPUT_STORAGE_KEY);
    }
    if (audioOutputDeviceSelect.value !== preferredAudioOutputId) {
      preferredAudioOutputId = "";
      localStorage.removeItem(AUDIO_OUTPUT_STORAGE_KEY);
    }
  } catch {
    updateActivity("Impossible d’actualiser les périphériques audio.");
  }
}

function getNoonAudioConstraints() {
  return {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
    ...(preferredAudioInputId
      ? { deviceId: { exact: preferredAudioInputId } }
      : {}),
  };
}

audioInputDeviceSelect.addEventListener("change", () => {
  preferredAudioInputId = audioInputDeviceSelect.value;
  if (preferredAudioInputId) localStorage.setItem(AUDIO_INPUT_STORAGE_KEY, preferredAudioInputId);
  else localStorage.removeItem(AUDIO_INPUT_STORAGE_KEY);
  updateActivity("Microphone sélectionné.");
});

audioOutputDeviceSelect.addEventListener("change", () => {
  preferredAudioOutputId = audioOutputDeviceSelect.value;
  if (preferredAudioOutputId) localStorage.setItem(AUDIO_OUTPUT_STORAGE_KEY, preferredAudioOutputId);
  else localStorage.removeItem(AUDIO_OUTPUT_STORAGE_KEY);
  updateActivity("Sortie audio sélectionnée.");
  window.dispatchEvent(new CustomEvent("noon-audio-device-change"));
});

openMicrophoneSettingsButton.addEventListener("click", async () => {
  await window.noon?.openSystemSettings?.("microphone");
  updateActivity("Réglages microphone macOS ouverts.");
});

navigator.mediaDevices?.addEventListener?.("devicechange", () => {
  void refreshAudioDevices();
});

visualDetailSelect.addEventListener("change", () => {
  const selectedDetail = visualDetailSelect.value;

  if (!allowedVisualDetails.includes(selectedDetail)) {
    return;
  }

  visualDetail = selectedDetail;
  localStorage.setItem("noonVisualDetail", visualDetail);
  updateActivity(
    visualDetail === "high"
      ? "Analyse visuelle détaillée activée."
      : "Analyse visuelle économique activée."
  );
});
intelligenceProfileSelect.addEventListener("change", () => {
  intelligenceProfile = ["economical", "balanced", "maximum"].includes(intelligenceProfileSelect.value)
    ? intelligenceProfileSelect.value
    : "balanced";
  localStorage.setItem("noonIntelligenceProfile", intelligenceProfile);
  updateActivity(`Intelligence ${intelligenceProfileSelect.selectedOptions[0].textContent} activée.`);
});

async function refreshWakeWordSettings() {
  if (!window.noon?.getWakeWordStatus) {
    wakeWordStatus.textContent = "Disponible uniquement dans l’application macOS.";
    wakeWordEnabledInput.disabled = true;
    return;
  }
  try {
    const [status, preferences] = await Promise.all([
      window.noon.getWakeWordStatus(),
      window.noon.getPreferences(),
    ]);
    wakeWordEnabledInput.checked = Boolean(preferences.wakeWordEnabled);
    resumeWakeAfterUnlockInput.checked = preferences.resumeWakeAfterUnlock !== false;
    wakeWordSensitivityInput.value = String(preferences.wakeWordSensitivity ?? 0.5);
    wakeWordSensitivityValue.textContent = Number(wakeWordSensitivityInput.value).toLocaleString("fr-FR", { minimumFractionDigits: 2 });
    wakeWordDeviceSelect.replaceChildren(new Option("Microphone par défaut", "-1"));
    for (const device of status.devices || []) wakeWordDeviceSelect.add(new Option(device.name, String(device.index)));
    wakeWordDeviceSelect.value = String(preferences.wakeWordDeviceIndex ?? -1);
    wakeWordStatus.textContent = `${status.text || "Réveil vocal désactivé."} · ${status.detections || 0} détection(s).${status.configured ? " Configuré." : " Configuration requise."}`;
  } catch (error) {
    wakeWordStatus.textContent = error.message;
  }
}

async function refreshOpenAIKeyStatus() {
  if (!window.noon?.getOpenAIKeyStatus) {
    openAIKeyStatus.textContent = "Disponible uniquement dans l’application macOS.";
    return;
  }
  try {
    const status = await window.noon.getOpenAIKeyStatus();
    openAIKeyStatus.textContent = status.configured
      ? "Clé API configurée dans le coffre macOS."
      : "Clé API absente.";
  } catch (error) { openAIKeyStatus.textContent = error.message; }
}

async function refreshLocalFolderPermissions() {
  localFolderPermissions.replaceChildren();
  if (!window.noon?.listLocalPermissions) {
    localFolderPermissions.textContent = "Disponible uniquement dans l’application macOS.";
    addLocalFolderButton.disabled = true;
    return;
  }
  const state = await window.noon.listLocalPermissions();
  for (const permission of state.roots || []) {
    const item = document.createElement("div"); item.className = "memory-item";
    const text = document.createElement("span"); text.textContent = `${permission.path} · ${permission.mode === "read-write" ? "lecture et création" : "lecture seule"}`;
    const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "Retirer"; remove.addEventListener("click", async () => { if (!window.confirm(`Retirer l’autorisation pour « ${permission.path} » ?`)) return; await window.noon.removeLocalPermission(permission.path); await refreshLocalFolderPermissions(); updateActivity("Autorisation retirée."); });
    item.append(text, remove); localFolderPermissions.append(item);
  }
  if (!(state.roots || []).length) localFolderPermissions.textContent = "Aucun dossier ajouté manuellement.";
}

addLocalFolderButton.addEventListener("click", async () => {
  const result = await window.noon?.addLocalPermission?.({ mode: localFolderModeSelect.value });
  if (result?.canceled) return;
  await refreshLocalFolderPermissions(); await loadLocalProjects();
  updateActivity("Dossier local autorisé.");
});

saveOpenAIKeyButton.addEventListener("click", async () => {
  try {
    await window.noon.setOpenAIKey(openAIKeyInput.value);
    openAIKeyInput.value = "";
    await refreshOpenAIKeyStatus();
    updateActivity("Clé OpenAI enregistrée de manière sécurisée.");
  } catch (error) { openAIKeyStatus.textContent = error.message; }
});

wakeWordEnabledInput.addEventListener("change", async () => {
  try {
    await window.noon.setPreference("wakeWordEnabled", wakeWordEnabledInput.checked);
    await refreshWakeWordSettings();
  } catch (error) {
    wakeWordEnabledInput.checked = false;
    wakeWordStatus.textContent = error.message;
  }
});
savePicovoiceKeyButton.addEventListener("click", async () => {
  try {
    await window.noon.setPicovoiceKey(picovoiceAccessKey.value);
    picovoiceAccessKey.value = "";
    wakeWordStatus.textContent = "AccessKey enregistrée dans le coffre macOS.";
    await refreshWakeWordSettings();
  } catch (error) { wakeWordStatus.textContent = error.message; }
});
async function importWakeFile(kind) {
  try {
    await window.noon.importWakeModel(kind);
    await refreshWakeWordSettings();
  } catch (error) { wakeWordStatus.textContent = error.message; }
}
importWakeKeywordButton.addEventListener("click", () => { void importWakeFile("keyword"); });
importWakeModelButton.addEventListener("click", () => { void importWakeFile("model"); });
wakeWordSensitivityInput.addEventListener("input", () => {
  wakeWordSensitivityValue.textContent = Number(wakeWordSensitivityInput.value).toLocaleString("fr-FR", { minimumFractionDigits: 2 });
});
wakeWordSensitivityInput.addEventListener("change", async () => {
  try { await window.noon.setPreference("wakeWordSensitivity", Number(wakeWordSensitivityInput.value)); }
  catch (error) { wakeWordStatus.textContent = error.message; }
});
wakeWordDeviceSelect.addEventListener("change", async () => {
  try { await window.noon.setPreference("wakeWordDeviceIndex", Number(wakeWordDeviceSelect.value)); }
  catch (error) { wakeWordStatus.textContent = error.message; }
});
resumeWakeAfterUnlockInput.addEventListener("change", async () => {
  try { await window.noon.setPreference("resumeWakeAfterUnlock", resumeWakeAfterUnlockInput.checked); }
  catch (error) { wakeWordStatus.textContent = error.message; }
});
testWakeWordButton.addEventListener("click", async () => {
  try {
    await window.noon.setPreference("wakeWordEnabled", true);
    wakeWordEnabledInput.checked = true;
    wakeWordStatus.textContent = "Dites « Salut Noon » près du microphone.";
    window.setTimeout(refreshWakeWordSettings, 1000);
  } catch (error) { wakeWordStatus.textContent = error.message; }
});
resetWakeWordButton.addEventListener("click", async () => {
  if (!window.confirm("Réinitialiser la configuration Salut Noon ?")) return;
  try { await window.noon.resetWakeWord(); await refreshWakeWordSettings(); }
  catch (error) { wakeWordStatus.textContent = error.message; }
});

document.addEventListener("click", (event) => {
  if (
    !quickSettings.contains(event.target) &&
    event.target !== settingsButton
  ) {
    quickSettings.hidden = true;
    settingsButton.setAttribute("aria-expanded", "false");
  }
  if (
    !shareConversationMenu.contains(event.target) &&
    event.target !== shareConversationButton
  ) {
    shareConversationMenu.hidden = true;
    shareConversationButton.setAttribute("aria-expanded", "false");
  }
});

document.addEventListener("keydown", (event) => {
  if (!activeConversationContextMenu) return;
  if (event.key === "Escape") { event.preventDefault(); closeConversationContextMenu(); return; }
  if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
  const keyboardMenu = document.activeElement?.closest?.(".conversation-context-menu") || activeConversationContextMenu;
  const items = [...keyboardMenu.querySelectorAll(':scope > [role="menuitem"]')];
  if (!items.length) return;
  event.preventDefault();
  const current = Math.max(0, items.indexOf(document.activeElement));
  items[(current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus();
});

function formatFileSize(size) {
  if (size < 1024) {
    return `${size} octets`;
  }

  if (size < 1024 * 1024) {
    return `${Math.round(size / 1024)} Ko`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} Mo`;
}

function getAttachmentIcon(file) {
  const fileName = String(file.name || "");
  const fileType = String(file.type || "");
  const extension = fileName.includes(".")
    ? `.${fileName.split(".").pop().toLowerCase()}`
    : "";

  if (fileType.startsWith("image/")) return "🖼️";
  if (fileType.startsWith("audio/") || AUDIO_EXTENSIONS.includes(extension)) return "🎙️";
  if (extension === ".pdf") return "📕";
  if (SPREADSHEET_EXTENSIONS.includes(extension)) return "📈";
  if ([".ppt", ".pptx"].includes(extension)) return "📊";
  if (DOCUMENT_EXTENSIONS.includes(extension)) return "📘";
  return "📄";
}

function clearSelectedFile(showActivity = true) {
  selectedFiles = [];
  fileInput.value = "";
  renderAttachmentsPreview();

  if (showActivity) {
    updateActivity("Pièces jointes supprimées.");
  }
}

function renderAttachmentsPreview() {
  attachmentsList.replaceChildren();

  if (selectedFiles.length === 0) {
    attachmentsPreview.hidden = true;
    attachmentsSummary.textContent = "";
    return;
  }

  attachmentsPreview.hidden = false;

  selectedFiles.forEach((file, index) => {
    const item = document.createElement("div");
    item.className = "attachment-item";

    const icon = document.createElement("span");
    icon.className = "attachment-item__icon";
    icon.textContent = getAttachmentIcon(file);

    const information = document.createElement("div");
    information.className = "attachment-item__information";

    const name = document.createElement("span");
    name.className = "attachment-item__name";
    name.textContent = file.name;
    name.title = file.name;

    const size = document.createElement("span");
    size.className = "attachment-item__size";
    size.textContent = formatFileSize(file.size);

    information.append(name, size);

    const removeButton = document.createElement("button");
    removeButton.className = "attachment-item__remove";
    removeButton.type = "button";
    removeButton.textContent = "×";
    removeButton.title = `Retirer ${file.name}`;
    removeButton.setAttribute(
      "aria-label",
      `Retirer le fichier ${file.name}`
    );
    removeButton.addEventListener("click", () => {
      removeSelectedFile(index);
    });

    item.append(icon, information, removeButton);
    attachmentsList.append(item);
  });

  const totalSize = selectedFiles.reduce(
    (total, file) => total + file.size,
    0
  );

  attachmentsSummary.textContent =
    `${selectedFiles.length}/${MAX_ATTACHMENT_FILES} fichier(s)` +
    ` • ${formatFileSize(totalSize)}`;
}

function removeSelectedFile(index) {
  selectedFiles.splice(index, 1);
  renderAttachmentsPreview();
}

attachButton.addEventListener("click", () => {
  composerMenu.hidden = true;
  composerMenuButton.setAttribute("aria-expanded", "false");
  fileInput.click();
});

composerMenuButton.addEventListener("click", (event) => {
  event.stopPropagation();
  composerMenu.hidden = !composerMenu.hidden;
  composerMenuButton.setAttribute(
    "aria-expanded",
    String(!composerMenu.hidden)
  );
});

composerMenu.addEventListener("click", (event) => {
  event.stopPropagation();
});

composerSettingsButton.addEventListener("click", () => {
  composerMenu.hidden = true;
  composerMenuButton.setAttribute("aria-expanded", "false");
  settingsButton.click();
});

document.addEventListener("click", (event) => {
  if (
    !composerMenu.hidden &&
    !composerMenu.contains(event.target) &&
    event.target !== composerMenuButton
  ) {
    composerMenu.hidden = true;
    composerMenuButton.setAttribute("aria-expanded", "false");
  }
});

function updateWebSearchButton() {
  webSearchButton.classList.toggle(
    "is-active",
    webSearchEnabled
  );
  webSearchButton.setAttribute(
    "aria-pressed",
    String(webSearchEnabled)
  );
  webSearchButton.title = webSearchEnabled
    ? "Recherche Internet activée"
    : "Rechercher sur Internet";
}

function updateWebSearchUsage(usage) {
  if (!usage) return;

  const used = Math.max(0, Number(usage.used) || 0);
  const limit = Math.max(1, Number(usage.limit) || 10);

  remainingWebSearches = Math.max(0, limit - used);
  webSearchCounter.textContent = `${used}/${limit}`;

  if (remainingWebSearches === 0) {
    webSearchEnabled = false;
    updateWebSearchButton();
    webSearchButton.title = "Limite quotidienne atteinte";
  }

  updateActionButtons();
}

function shouldSuggestWebSearch(question) {
  const normalizedQuestion = String(question || "").trim();

  return Boolean(normalizedQuestion) &&
    WEB_SEARCH_SUGGESTION_PATTERNS.some((pattern) =>
      pattern.test(normalizedQuestion)
    );
}

function showWebSearchSuggestion() {
  const limitReached = remainingWebSearches <= 0;

  webSearchSuggestion.hidden = false;
  webSearchSuggestionUse.disabled = limitReached;
  webSearchSuggestionText.textContent = limitReached
    ? "Cette question semble nécessiter Internet, mais la limite quotidienne est atteinte."
    : "Cette question semble nécessiter des informations récentes. Activer Internet ?";
}

function hideWebSearchSuggestion() {
  webSearchSuggestion.hidden = true;
}

webSearchButton.addEventListener("click", () => {
  if (remainingWebSearches <= 0) {
    updateActivity(
      "La limite quotidienne de recherches Internet est atteinte."
    );
    return;
  }

  webSearchEnabled = !webSearchEnabled;
  updateWebSearchButton();
  hideWebSearchSuggestion();
  composerMenu.hidden = true;
  composerMenuButton.setAttribute("aria-expanded", "false");
});

webSearchSuggestionUse.addEventListener("click", async () => {
  if (remainingWebSearches <= 0) {
    updateActivity(
      "La limite quotidienne de recherches Internet est atteinte."
    );
    return;
  }

  webSearchEnabled = true;
  updateWebSearchButton();
  hideWebSearchSuggestion();
  await sendQuestion(promptInput.value.trim(), {
    skipWebSuggestion: true,
  });
});

webSearchSuggestionIgnore.addEventListener("click", async () => {
  hideWebSearchSuggestion();
  await sendQuestion(promptInput.value.trim(), {
    skipWebSuggestion: true,
    webSearchForbidden: true,
  });
});

updateWebSearchButton();

function getFileExtension(fileName) {
  const lastDot = fileName.lastIndexOf(".");

  return lastDot >= 0
    ? fileName.slice(lastDot).toLowerCase()
    : "";
}

function validateSelectedFile(file) {
  if (!file) return false;

  const fileName = file.name.toLowerCase();

  if (
    fileName.startsWith(".env") ||
    fileName.endsWith(".key") ||
    fileName.endsWith(".pem")
  ) {
    updateActivity(
      "Ce fichier peut contenir des informations secrètes."
    );
    return false;
  }

  const isTextFile = TEXT_EXTENSIONS.some((extension) =>
    fileName.endsWith(extension)
  );
  const isImageFile = IMAGE_EXTENSIONS.some((extension) =>
    fileName.endsWith(extension)
  );
  const isPdfFile = PDF_EXTENSIONS.some((extension) =>
    fileName.endsWith(extension)
  );
  const isDocumentFile = DOCUMENT_EXTENSIONS.some((extension) =>
    fileName.endsWith(extension)
  );
  const isSpreadsheetFile = SPREADSHEET_EXTENSIONS.some(
    (extension) => fileName.endsWith(extension)
  );
  const isAudioFile = AUDIO_EXTENSIONS.some((extension) => fileName.endsWith(extension));

  if (
    !isTextFile &&
    !isImageFile &&
    !isPdfFile &&
    !isDocumentFile &&
    !isSpreadsheetFile &&
    !isAudioFile
  ) {
    updateActivity("Ce type de fichier n’est pas accepté.");
    return false;
  }

  let maximumSize = MAX_TEXT_ATTACHMENT_SIZE;

  if (isImageFile) {
    maximumSize = MAX_IMAGE_ATTACHMENT_SIZE;
  }

  if (isPdfFile) {
    maximumSize = MAX_PDF_ATTACHMENT_SIZE;
  }

  if (isDocumentFile) {
    maximumSize = MAX_DOCUMENT_ATTACHMENT_SIZE;
  }

  if (isSpreadsheetFile) {
    maximumSize = MAX_SPREADSHEET_ATTACHMENT_SIZE;
  }
  if (isAudioFile) maximumSize = MAX_AUDIO_ATTACHMENT_SIZE;

  if (file.size > maximumSize) {
    if (isAudioFile) {
      updateActivity("Audio trop volumineux : maximum 5 Mo.");
    } else if (isSpreadsheetFile) {
      updateActivity("Tableur trop volumineux : maximum 3 Mo.");
    } else if (isDocumentFile) {
      updateActivity("Document trop volumineux : maximum 3 Mo.");
    } else if (isPdfFile) {
      updateActivity("PDF trop volumineux : maximum 3 Mo.");
    } else if (isImageFile) {
      updateActivity("Image trop volumineuse : maximum 2 Mo.");
    } else {
      updateActivity(
        "Fichier texte trop volumineux : maximum 1 Mo."
      );
    }

    return false;
  }

  return true;
}

function handleSelectedFiles(fileList) {
  const incomingFiles = Array.from(fileList || []);
  const uniqueIncomingFiles = incomingFiles.filter((incomingFile) => {
    return !selectedFiles.some((selectedFile) => {
      return (
        selectedFile.name === incomingFile.name &&
        selectedFile.size === incomingFile.size &&
        selectedFile.lastModified === incomingFile.lastModified
      );
    });
  });

  if (uniqueIncomingFiles.length === 0) {
    updateActivity("Ces fichiers sont déjà sélectionnés.");
    return false;
  }

  if (
    selectedFiles.length + uniqueIncomingFiles.length >
    MAX_ATTACHMENT_FILES
  ) {
    updateActivity("Maximum 3 fichiers par question.");
    return false;
  }

  if (!uniqueIncomingFiles.every(validateSelectedFile)) {
    return false;
  }

  const newFiles = [...selectedFiles, ...uniqueIncomingFiles];
  const totalSize = newFiles.reduce(
    (total, file) => total + file.size,
    0
  );

  if (totalSize > MAX_ATTACHMENTS_TOTAL_SIZE) {
    updateActivity(
      "La taille totale des fichiers ne doit pas dépasser 5 Mo."
    );
    return false;
  }

  selectedFiles = newFiles;
  renderAttachmentsPreview();
  updateActivity(
    `${selectedFiles.length} fichier(s) prêt(s).`
  );
  return true;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.addEventListener("load", () => {
      resolve(reader.result);
    });

    reader.addEventListener("error", () => {
      reject(new Error("Impossible de lire l’image."));
    });

    reader.readAsDataURL(file);
  });
}

async function fileToDataUrlWithMime(file, mimeType) {
  const originalDataUrl = await fileToDataUrl(file);

  return originalDataUrl.replace(
    /^data:[^;]*;base64,/,
    `data:${mimeType};base64,`
  );
}

async function buildAttachment(file) {
  const extension = getFileExtension(file.name);

  if (
    ["image/png", "image/jpeg", "image/webp"].includes(
      file.type
    )
  ) {
    return {
      kind: "image",
      name: file.name,
      mimeType: file.type,
      dataUrl: await fileToDataUrl(file),
    };
  }

  if (extension === ".pdf") {
    return {
      kind: "pdf",
      name: file.name,
      mimeType: "application/pdf",
      dataUrl: await fileToDataUrlWithMime(
        file,
        "application/pdf"
      ),
    };
  }

  if (AUDIO_EXTENSIONS.includes(extension)) {
    const mimeType = AUDIO_MIME_TYPES[extension];
    return {
      kind: "audio", name: file.name, mimeType,
      dataUrl: await fileToDataUrlWithMime(file, mimeType),
    };
  }

  if (SPREADSHEET_EXTENSIONS.includes(extension)) {
    const mimeType = SPREADSHEET_MIME_TYPES[extension];

    return {
      kind: "spreadsheet",
      name: file.name,
      mimeType,
      dataUrl: await fileToDataUrlWithMime(file, mimeType),
    };
  }

  if (DOCUMENT_EXTENSIONS.includes(extension)) {
    const mimeType = DOCUMENT_MIME_TYPES[extension];

    return {
      kind: "document",
      name: file.name,
      mimeType,
      dataUrl: await fileToDataUrlWithMime(file, mimeType),
    };
  }

  return {
    kind: "text",
    name: file.name,
    content: await file.text(),
  };
}

function createAttachmentMetadata(files) {
  return files.map((file) => ({
    name: file.name,
    type: file.type,
    size: file.size,
  }));
}

fileInput.addEventListener("change", () => {
  handleSelectedFiles(fileInput.files);
  fileInput.value = "";
});

clearAttachmentsButton.addEventListener("click", () => {
  selectedFiles = [];
  fileInput.value = "";
  renderAttachmentsPreview();
  updateActivity("Pièces jointes supprimées.");
});

composerDropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  composerDropZone.classList.add("drag-over");
  updateActivity("Dépose le fichier dans Noon.");
});

composerDropZone.addEventListener("dragleave", (event) => {
  if (!composerDropZone.contains(event.relatedTarget)) {
    composerDropZone.classList.remove("drag-over");
  }
});

composerDropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  composerDropZone.classList.remove("drag-over");

  handleSelectedFiles(event.dataTransfer.files);
});

window.addEventListener("dragover", (event) => {
  if (event.dataTransfer?.types.includes("Files")) {
    event.preventDefault();
  }
});

window.addEventListener("drop", (event) => {
  if (event.dataTransfer?.types.includes("Files")) {
    event.preventDefault();
  }
});

document.addEventListener("paste", (event) => {
  const clipboardItems = Array.from(
    event.clipboardData?.items || []
  );
  const imageItem = clipboardItems.find(
    (item) =>
      item.kind === "file" &&
      item.type.startsWith("image/")
  );

  if (!imageItem) {
    const pastedText = event.clipboardData?.getData("text/plain") || "";

    if (event.target !== promptInput || !shouldConvertPastedText(pastedText)) {
      return;
    }

    event.preventDefault();
    const textFile = new File(
      [pastedText],
      createPastedTextFileName(),
      { type: "text/plain", lastModified: Date.now() }
    );

    if (handleSelectedFiles([textFile])) {
      updateActivity("Texte long ajouté comme fichier texte.");
      promptInput.focus();
    }
    return;
  }

  event.preventDefault();

  const imageBlob = imageItem.getAsFile();

  if (!imageBlob) {
    updateActivity("Impossible de récupérer l’image copiée.");
    return;
  }

  const extensionByType = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
  };
  const extension = extensionByType[imageBlob.type] || "png";
  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-");
  const imageFile = new File(
    [imageBlob],
    `capture-${timestamp}.${extension}`,
    {
      type: imageBlob.type,
      lastModified: Date.now(),
    }
  );

  if (handleSelectedFiles([imageFile])) {
    updateActivity("Capture d’écran ajoutée.");
    promptInput.focus();
  }
});

function updateActivity(text) {
  activity.textContent = text;
  coreActivity.textContent = text;
}

let promptExpanded = false;

function resizePromptInput() {
  promptInput.style.height = "auto";
  const hasMultipleLines = promptInput.scrollHeight > 28;
  if (!hasMultipleLines) promptExpanded = false;
  const expandedLimit = Math.min(
    MAX_EXPANDED_PROMPT_HEIGHT,
    Math.max(MAX_PROMPT_HEIGHT, window.innerHeight - 180)
  );
  const heightLimit = promptExpanded ? expandedLimit : MAX_PROMPT_HEIGHT;
  const nextHeight = Math.min(promptInput.scrollHeight, heightLimit);
  promptInput.style.height = `${Math.max(nextHeight, 20)}px`;
  promptInput.style.overflowY =
    promptInput.scrollHeight > heightLimit ? "auto" : "hidden";
  composerDropZone.classList.toggle("is-multiline", hasMultipleLines);
  composerDropZone.classList.toggle("is-expanded", promptExpanded);
  expandPromptButton.hidden = !hasMultipleLines;
  expandPromptButton.setAttribute("aria-pressed", String(promptExpanded));
  expandPromptButton.setAttribute(
    "aria-label",
    promptExpanded ? "Réduire le champ de saisie" : "Agrandir le champ de saisie"
  );
}

expandPromptButton.addEventListener("click", () => {
  promptExpanded = !promptExpanded;
  resizePromptInput();
  promptInput.focus();
});

window.addEventListener("resize", resizePromptInput);

function saveCurrentDraft() {
  const draft = promptInput.value.slice(0, MAX_DRAFT_LENGTH);

  if (draft.trim()) {
    localStorage.setItem(DRAFT_STORAGE_KEY, draft);
  } else {
    localStorage.removeItem(DRAFT_STORAGE_KEY);
  }
}

function clearSavedDraft() {
  localStorage.removeItem(DRAFT_STORAGE_KEY);
}

function restoreSavedDraft() {
  const savedDraft = localStorage.getItem(DRAFT_STORAGE_KEY);

  if (!savedDraft || promptInput.value) {
    return;
  }

  promptInput.value = savedDraft;
  resizePromptInput();
  updateActivity("Brouillon précédent restauré.");
}

function setConnectionStatus(state, text) {
  connectionStatus.dataset.state = state;
  connectionStatusText.textContent = text;
  systemStatusButton.dataset.state = state;
  systemStatusButton.title = text;
  systemStatusButton.setAttribute("aria-label", `État de Noon : ${text}. Ouvrir le Control Center.`);
}

// Contrôle uniquement le serveur local ; cette requête ne contacte pas OpenAI.
async function checkNoonConnection() {
  if (!navigator.onLine) {
    setConnectionStatus("offline", "Hors connexion");
    return;
  }

  setConnectionStatus("checking", "Vérification…");

  const controller = new AbortController();
  const timeout = window.setTimeout(() => {
    controller.abort();
  }, 3000);

  try {
    const response = await fetch("/health", {
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error("Serveur indisponible");
    }

    const data = await response.json();
    const readiness = data.reliability?.readiness;
    const readinessLabel = readiness === "NOT_READY"
      ? "Noon indisponible"
      : readiness === "DEGRADED_READY"
        ? "Noon dégradé"
        : "Noon prêt";
    const modeLabel = data.budgetMode === "NORMAL"
      ? readinessLabel
      : `${readinessLabel} · ${data.budgetMode}`;

    setConnectionStatus(
      readiness === "NOT_READY" ? "server-error" : readiness === "DEGRADED_READY" ? "offline" : "online",
      modeLabel
    );
    updateWebSearchUsage(data.webSearchUsage);
  } catch {
    setConnectionStatus("server-error", "Serveur local arrêté");
  } finally {
    window.clearTimeout(timeout);
  }
}

async function refreshNoonActivity() {
  try {
    const params = new URLSearchParams({
      sessionId: currentSessionId,
    });

    const response = await fetch(
      `/session/activity?${params.toString()}`
    );

    const data = await response.json();

    if (!response.ok) {
      return;
    }

    updateActivity(data.activity.text);

    if (
      typeof window.setNoonState === "function" &&
      data.activity.state !== "done"
    ) {
      window.setNoonState("thinking");
    }
  } catch {
    // Une erreur de suivi ne doit pas bloquer Noon.
  }
}

function startActivityPolling() {
  stopActivityPolling();

  refreshNoonActivity();

  activityPollingId = window.setInterval(
    refreshNoonActivity,
    500
  );
}

function stopActivityPolling() {
  if (activityPollingId !== null) {
    window.clearInterval(activityPollingId);
    activityPollingId = null;
  }
}

function setMode(mode, announce = true) {
  if (!ALLOWED_MODES.includes(mode)) {
    mode = "DA";
  }

  currentMode = mode;
  localStorage.setItem(MODE_STORAGE_KEY, currentMode);

  modeButtons.forEach((button) => {
    button.classList.toggle(
      "active",
      button.dataset.mode === currentMode
    );
  });

  conversationTitle.textContent = `Mode ${currentMode}`;

  if (announce) {
    updateActivity(`Mode ${currentMode} activé.`);
  }

  window.dispatchEvent(new CustomEvent("noon-context-change"));
  void loadProjectJournalPanel();
}

// Enregistre en shadow les commandes structurées de l'interface. Le parseur
// local n'exécute aucune action : l'ancien comportement reste la référence
// pendant la période de migration.
async function reportStructuredIntent(uiAction, channel = "ui") {
  try {
    await fetch("/intents/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel,
        sessionId: currentSessionId,
        uiAction,
      }),
    });
  } catch {
    // L'observabilité des intentions ne doit jamais bloquer l'interface.
  }
}

modeButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    void reportStructuredIntent({
      action: "set_mode",
      mode: button.dataset.mode,
    });
    setMode(button.dataset.mode);

    await loadConversationHistory();
  });
});

