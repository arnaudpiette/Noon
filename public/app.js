// Contrôleur principal de l’interface Noon.
// Il gère la conversation, le Focus, la voix, les fichiers et les préférences locales.

// Références DOM partagées par les différents modules de l’interface.
const chatForm = document.getElementById("chatForm");
const promptInput = document.getElementById("prompt");
const conversationMessages = document.getElementById(
  "conversationMessages"
);
const conversation = conversationMessages;
const activity = document.getElementById("activity");
const coreActivity = document.getElementById("coreActivity");
const budgetValue = document.getElementById("budgetValue");
const budgetMode = document.getElementById("budgetMode");
const budgetProgress = document.getElementById("budgetProgress");
const focusProject = document.getElementById("focusProject");
const focusToggle = document.getElementById("focusToggle");
const focusMenu = document.getElementById("focusMenu");
const focusList = document.getElementById("focusList");
const conversationTitle = document.getElementById("conversationTitle");
const clearChatButton = document.getElementById("clearChat");
const newConversationButton = document.getElementById(
  "newConversationButton"
);
const exportConversationButton = document.getElementById(
  "exportConversationButton"
);
const connectionStatus = document.getElementById("connectionStatus");
const connectionStatusText = document.getElementById(
  "connectionStatusText"
);
const retryButton = document.getElementById("retryButton");
const micButton = document.getElementById("micButton");
const sendButton = document.getElementById("sendButton");
const requestTimer = document.getElementById("requestTimer");
const stopRequestButton = document.getElementById(
  "stopRequestButton"
);
const modeButtons = document.querySelectorAll(".mode-btn");
const viewButtons = document.querySelectorAll(".view-btn");
const views = document.querySelectorAll(".view");
const sidebarToggle = document.getElementById("sidebarToggle");
const sidebarBackdrop = document.getElementById("sidebarBackdrop");
const settingsButton = document.getElementById("settingsButton");
const quickSettings = document.getElementById("quickSettings");
const voiceEnabledInput = document.getElementById("voiceEnabled");
const notificationsEnabledInput = document.getElementById(
  "notificationsEnabled"
);
const voiceRateSelect = document.getElementById("voiceRate");
const visualDetailSelect = document.getElementById("visualDetail");
const attachButton = document.getElementById("attachButton");
const webSearchButton = document.querySelector("#web-search-button");
const webSearchCounter = document.querySelector(
  "#web-search-counter"
);
const webSearchSuggestion = document.querySelector(
  "#web-search-suggestion"
);
const webSearchSuggestionText = document.querySelector(
  "#web-search-suggestion-text"
);
const webSearchSuggestionUse = document.querySelector(
  "#web-search-suggestion-use"
);
const webSearchSuggestionIgnore = document.querySelector(
  "#web-search-suggestion-ignore"
);
const fileInput = document.getElementById("fileInput");
const attachmentsPreview = document.querySelector(
  "#attachments-preview"
);
const attachmentsList = document.querySelector("#attachments-list");
const attachmentsSummary = document.querySelector(
  "#attachments-summary"
);
const clearAttachmentsButton = document.querySelector(
  "#clear-attachments-button"
);
const composerDropZone = document.getElementById("composerDropZone");

// Formats et limites appliqués avant toute lecture d’une pièce jointe.
const TEXT_EXTENSIONS = [
  ".txt",
  ".md",
  ".html",
  ".css",
  ".scss",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".json",
  ".yaml",
  ".yml",
  ".xml",
];
const IMAGE_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
];
const PDF_EXTENSIONS = [".pdf"];
const DOCUMENT_EXTENSIONS = [
  ".doc",
  ".docx",
  ".odt",
  ".rtf",
  ".ppt",
  ".pptx",
];
const SPREADSHEET_EXTENSIONS = [
  ".csv",
  ".tsv",
  ".xls",
  ".xlsx",
];
const SPREADSHEET_MIME_TYPES = {
  ".csv": "text/csv",
  ".tsv": "text/tsv",
  ".xls": "application/vnd.ms-excel",
  ".xlsx":
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};
const DOCUMENT_MIME_TYPES = {
  ".doc": "application/msword",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".odt": "application/vnd.oasis.opendocument.text",
  ".rtf": "application/rtf",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
const MAX_TEXT_ATTACHMENT_SIZE = 20 * 1024;
const MAX_IMAGE_ATTACHMENT_SIZE = 2 * 1024 * 1024;
const MAX_PDF_ATTACHMENT_SIZE = 3 * 1024 * 1024;
const MAX_DOCUMENT_ATTACHMENT_SIZE = 3 * 1024 * 1024;
const MAX_SPREADSHEET_ATTACHMENT_SIZE = 3 * 1024 * 1024;
let selectedFiles = [];
let webSearchEnabled = false;
let remainingWebSearches = 10;
const MAX_ATTACHMENT_FILES = 3;
const MAX_ATTACHMENTS_TOTAL_SIZE = 5 * 1024 * 1024;
const WEB_SEARCH_SUGGESTION_PATTERNS = [
  /\b(aujourd['’]hui|ce soir|cette semaine|ce mois-ci)\b/i,
  /\b(en ce moment|actuellement|maintenant)\b/i,
  /\b(actualité|actualités|news|dernière nouvelle)\b/i,
  /\b(dernier|dernière|derniers|dernières)\s+(résultat|version|mise à jour|annonce|sortie|classement)\b/i,
  /\b(météo|prévisions météo|température demain)\b/i,
  /\b(horaires?|résultats?|classement|score|disponibilité)\b/i,
  /\b(prix|tarif|cours|cotation).*\b(actuel|actuelle|maintenant|aujourd['’]hui)\b/i,
  /\b(nouveauté|nouveautés|récent|récente|récemment)\b/i,
  /\b(qui est|quel est|quelle est).*\b(président|premier ministre|ministre|pdg|ceo|directeur)\b/i,
  /https?:\/\/\S+/i,
];

// Préférences utilisateur persistantes entre deux lancements.
let voiceEnabled =
  localStorage.getItem("noonVoiceEnabled") !== "false";
let notificationsEnabled =
  localStorage.getItem("noonNotificationsEnabled") === "true";
let voiceRate =
  Number(localStorage.getItem("noonVoiceRate")) || 1;
const allowedVisualDetails = ["low", "high"];
let visualDetail =
  localStorage.getItem("noonVisualDetail") || "low";

if (!allowedVisualDetails.includes(visualDetail)) {
  visualDetail = "low";
}

voiceEnabledInput.checked = voiceEnabled;
notificationsEnabledInput.checked = notificationsEnabled;
voiceRateSelect.value = String(voiceRate);
visualDetailSelect.value = visualDetail;

let currentSpeech = null;
let speechSessionId = 0;
let speechAnimationTimer = null;
let activityPollingId = null;
const MODE_STORAGE_KEY = "noonMode";
const ALLOWED_MODES = ["DA", "DEV"];
let currentMode =
  localStorage.getItem(MODE_STORAGE_KEY) || "DA";
const FOCUS_STORAGE_KEY = "noonFocus";
const FOCUS_PATH_STORAGE_KEY = "noonFocusPath";

let currentFocus = localStorage.getItem(FOCUS_STORAGE_KEY);
let currentFocusPath = localStorage.getItem(
  FOCUS_PATH_STORAGE_KEY
);

const SESSION_STORAGE_KEY = "noonSessionId";
const CONVERSATION_STORAGE_KEY = "noonDisplayedConversation";
const DRAFT_STORAGE_KEY = "noonDraft";
const MAX_SAVED_MESSAGES = 20;
const MAX_SAVED_MESSAGE_LENGTH = 12_000;
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

function setSidebar(open, persist = true) {
  document.body.classList.toggle("sidebar-collapsed", !open);
  sidebarToggle.setAttribute("aria-expanded", String(open));
  sidebarToggle.setAttribute("aria-label", open ? "Replier le menu latéral" : "Déplier le menu latéral");
  if (persist) localStorage.setItem("noon-sidebar-open", String(open));
}

sidebarToggle.addEventListener("click", () => {
  setSidebar(document.body.classList.contains("sidebar-collapsed"));
});

sidebarBackdrop.addEventListener("click", () => setSidebar(false));

settingsButton.addEventListener("click", (event) => {
  event.stopPropagation();
  quickSettings.hidden = !quickSettings.hidden;
  settingsButton.setAttribute(
    "aria-expanded",
    String(!quickSettings.hidden)
  );
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

document.addEventListener("click", (event) => {
  if (
    !quickSettings.contains(event.target) &&
    event.target !== settingsButton
  ) {
    quickSettings.hidden = true;
    settingsButton.setAttribute("aria-expanded", "false");
  }
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
  fileInput.click();
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

  if (
    !isTextFile &&
    !isImageFile &&
    !isPdfFile &&
    !isDocumentFile &&
    !isSpreadsheetFile
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

  if (file.size > maximumSize) {
    if (isSpreadsheetFile) {
      updateActivity("Tableur trop volumineux : maximum 3 Mo.");
    } else if (isDocumentFile) {
      updateActivity("Document trop volumineux : maximum 3 Mo.");
    } else if (isPdfFile) {
      updateActivity("PDF trop volumineux : maximum 3 Mo.");
    } else if (isImageFile) {
      updateActivity("Image trop volumineuse : maximum 2 Mo.");
    } else {
      updateActivity(
        "Fichier texte trop volumineux : maximum 20 Ko."
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

  // Le collage de texte continue normalement.
  if (!imageItem) return;

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
  promptInput.style.height = "auto";
  promptInput.style.height =
    `${Math.min(promptInput.scrollHeight, 100)}px`;
  updateActivity("Brouillon précédent restauré.");
}

function setConnectionStatus(state, text) {
  connectionStatus.dataset.state = state;
  connectionStatusText.textContent = text;
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
    const modeLabel =
      data.budgetMode === "NORMAL"
        ? "Noon prêt"
        : `Noon prêt · ${data.budgetMode}`;

    setConnectionStatus("online", modeLabel);
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
}

modeButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    setMode(button.dataset.mode);

    await loadConversationHistory();
  });
});

// Restaure le mode au chargement.
setMode(currentMode, false);

function setFocus(project) {
  const projectName =
    typeof project === "string"
      ? project.trim()
      : project?.name?.trim() || "";

  const projectPath =
    typeof project === "object"
      ? project?.path?.trim() || ""
      : "";

  currentFocus = projectName || null;
  currentFocusPath = projectPath || null;

  if (currentFocus) {
    localStorage.setItem(FOCUS_STORAGE_KEY, currentFocus);
    focusProject.textContent = currentFocus;

    if (currentFocusPath) {
      localStorage.setItem(
        FOCUS_PATH_STORAGE_KEY,
        currentFocusPath
      );
    } else {
      localStorage.removeItem(FOCUS_PATH_STORAGE_KEY);
    }

    updateActivity(`Focus : ${currentFocus}`);
  } else {
    localStorage.removeItem(FOCUS_STORAGE_KEY);
    localStorage.removeItem(FOCUS_PATH_STORAGE_KEY);
    focusProject.textContent = "Aucun projet";
    updateActivity("Focus désactivé.");
  }

  updateFocusSelection();
}

if (currentFocus) {
  focusProject.textContent = currentFocus;
}

function closeFocusMenu() {
  focusMenu.hidden = true;
  focusToggle.setAttribute("aria-expanded", "false");
}

function updateFocusSelection() {
  const options = document.querySelectorAll(".focus-option");

  options.forEach((option) => {
    const optionFocus = option.dataset.focus || null;
    const optionPath = option.dataset.focusPath || null;

    const isSelected = currentFocusPath
      ? optionPath === currentFocusPath
      : optionFocus === currentFocus;

    option.classList.toggle("active", isSelected);
  });
}

function createFocusOption(project) {
  const button = document.createElement("button");
  const name = document.createElement("span");
  const projectPath = document.createElement("span");

  button.type = "button";
  button.className = "focus-option";
  button.dataset.focus = project?.name || "";
  button.dataset.focusPath = project?.path || "";

  name.className = "focus-option-name";
  name.textContent = project?.name || "Aucun projet";

  projectPath.className = "focus-option-path";
  projectPath.textContent = project?.path || "Désactiver le Focus";

  button.append(name, projectPath);

  button.addEventListener("click", async () => {
    setFocus(project || null);
    closeFocusMenu();

    await loadConversationHistory();
  });

  return button;
}

async function loadLocalProjects() {
  try {
    const response = await fetch("/projects");
    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.message || "Impossible de charger les projets."
      );
    }

    focusList.replaceChildren();
    focusList.appendChild(createFocusOption(null));

    for (const project of data.projects) {
      focusList.appendChild(createFocusOption(project));
    }

    updateFocusSelection();
  } catch (error) {
    focusList.textContent = error.message;
    updateActivity("Erreur de chargement des projets.");
  }
}

focusToggle.addEventListener("click", () => {
  const isOpen = focusToggle.getAttribute("aria-expanded") === "true";

  focusMenu.hidden = isOpen;
  focusToggle.setAttribute("aria-expanded", String(!isOpen));
});

document.addEventListener("click", (event) => {
  const clickedInsideFocus =
    focusToggle.contains(event.target) ||
    focusMenu.contains(event.target);

  if (!clickedInsideFocus) {
    closeFocusMenu();
  }
});

function loadSavedMessages() {
  try {
    const savedValue = localStorage.getItem(
      CONVERSATION_STORAGE_KEY
    );

    if (!savedValue) return [];

    const messages = JSON.parse(savedValue);

    if (!Array.isArray(messages)) {
      return [];
    }

    return messages
      .filter(
        (message) =>
          message &&
          typeof message.author === "string" &&
          typeof message.text === "string" &&
          typeof message.type === "string"
      )
      .slice(-MAX_SAVED_MESSAGES);
  } catch {
    return [];
  }
}

function saveConversationMessage(
  author,
  text,
  type,
  attachments = [],
  sources = []
) {
  const messages = loadSavedMessages();

  messages.push({
    author,
    text: String(text).slice(0, MAX_SAVED_MESSAGE_LENGTH),
    type,
    attachments: attachments.map((attachment) => ({
      name: String(attachment.name || "").slice(0, 150),
      type: String(attachment.type || "").slice(0, 100),
      size: Math.max(0, Number(attachment.size) || 0),
    })),
    sources: sources
      .filter(
        (source) =>
          source &&
          typeof source.url === "string" &&
          typeof source.title === "string"
      )
      .slice(0, 8),
    savedAt: Date.now(),
  });

  const recentMessages = messages.slice(-MAX_SAVED_MESSAGES);

  try {
    localStorage.setItem(
      CONVERSATION_STORAGE_KEY,
      JSON.stringify(recentMessages)
    );
  } catch {
    localStorage.setItem(
      CONVERSATION_STORAGE_KEY,
      JSON.stringify(recentMessages.slice(-10))
    );
  }
}

// Transforme les messages affichés en document lisible et portable.
function createConversationMarkdown(messages) {
  const exportedAt = new Date().toLocaleString("fr-FR");
  const sections = messages.map((message) => {
    const author = message.type === "user" ? "Vous" : "Noon";
    const attachmentLines = Array.isArray(message.attachments) &&
      message.attachments.length > 0
      ? [
          "",
          "Fichiers utilisés :",
          "",
          ...message.attachments.map(
            (attachment) =>
              `- ${attachment.name} (${formatFileSize(
                attachment.size || 0
              )})`
          ),
        ]
      : [];

    return [
      `## ${author}`,
      "",
      message.text,
      ...attachmentLines,
      "",
      "---",
    ].join("\n");
  });

  return [
    "# Conversation avec Noon",
    "",
    `Exportée le ${exportedAt}`,
    "",
    ...sections,
    "",
  ].join("\n");
}

function addMessage(
  author,
  text,
  className,
  shouldSave = true,
  attachments = [],
  sources = []
) {
  const message = document.createElement("div");
  const authorLabel = document.createElement("span");
  const paragraph = document.createElement("p");

  message.className = `message ${className}`;
  authorLabel.className = "author";
  authorLabel.textContent = author;
  paragraph.textContent = text;
  message.append(authorLabel, paragraph);

  if (attachments.length > 0) {
    const attachmentsContainer = document.createElement("div");
    attachmentsContainer.className = "message-attachments";

    attachments.forEach((attachment) => {
      const item = document.createElement("div");
      item.className = "message-attachment";

      const icon = document.createElement("span");
      icon.className = "message-attachment__icon";
      icon.textContent = getAttachmentIcon(attachment);

      const information = document.createElement("div");
      information.className = "message-attachment__information";

      const name = document.createElement("span");
      name.className = "message-attachment__name";
      name.textContent = attachment.name;
      name.title = attachment.name;

      const size = document.createElement("span");
      size.className = "message-attachment__size";
      size.textContent = formatFileSize(attachment.size || 0);

      information.append(name, size);
      item.append(icon, information);
      attachmentsContainer.append(item);
    });

    message.append(attachmentsContainer);
  }

  if (sources.length > 0) {
    const sourcesContainer = document.createElement("div");
    sourcesContainer.className = "message-sources";

    const sourcesTitle = document.createElement("strong");
    sourcesTitle.textContent = "Sources";
    sourcesContainer.append(sourcesTitle);

    sources.forEach((source) => {
      try {
        const url = new URL(source.url);

        if (url.protocol !== "https:") return;

        const link = document.createElement("a");
        link.href = url.href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = source.title || url.hostname;
        sourcesContainer.append(link);
      } catch {
        // Une source incorrecte n’est pas affichée.
      }
    });

    if (sourcesContainer.childElementCount > 1) {
      message.append(sourcesContainer);
    }
  }

  conversation.appendChild(message);
  conversation.scrollTop = conversation.scrollHeight;

  if (shouldSave) {
    saveConversationMessage(
      author,
      text,
      className,
      attachments,
      sources
    );
  }
}

function restoreDisplayedConversation() {
  const savedMessages = loadSavedMessages();

  if (savedMessages.length === 0) {
    return;
  }

  conversation.replaceChildren();

  savedMessages.forEach((message) => {
    addMessage(
      message.author,
      message.text,
      message.type,
      false,
      Array.isArray(message.attachments)
        ? message.attachments
        : [],
      Array.isArray(message.sources) ? message.sources : []
    );
  });

  updateActivity("Conversation précédente restaurée.");
}

async function loadConversationHistory() {
  const params = new URLSearchParams({
    sessionId: currentSessionId,
    mode: currentMode,
  });

  if (currentFocus) {
    params.set("focus", currentFocus);
  }

  if (currentFocusPath) {
    params.set("focusPath", currentFocusPath);
  }

  updateActivity("Chargement de la conversation…");

  try {
    const response = await fetch(
      `/session/history?${params.toString()}`
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.message ||
        "Impossible de charger la conversation."
      );
    }

    conversation.replaceChildren();
    localStorage.removeItem(CONVERSATION_STORAGE_KEY);

    if (data.history.length === 0) {
      addMessage(
        "Noon",
        "Nouvelle session. Je suis prêt.",
        "noon"
      );

      updateActivity("En attente.");
      return;
    }

    for (const message of data.history) {
      const isUser = message.role === "user";

      addMessage(
        isUser ? "Vous" : "Noon",
        message.content,
        isUser ? "user" : "noon"
      );
    }

    updateActivity(
      `${data.history.length / 2} échange(s) restauré(s).`
    );
  } catch (error) {
    conversation.replaceChildren();

    addMessage(
      "Noon",
      "Je n'ai pas pu restaurer la conversation.",
      "noon"
    );

    updateActivity(error.message);
  }
}

function switchView(viewName) {
  viewButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.view === viewName);
  });

  views.forEach((view) => {
    view.classList.toggle("active", view.id === `${viewName}View`);
  });
}

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
    .replace(/[\*_~>]/g, "")
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

function speakNoon(text) {
  if (!("speechSynthesis" in window)) {
    updateActivity("Synthèse vocale indisponible.");
    setVisualState("idle");
    return;
  }

  currentSpeech = null;
  window.speechSynthesis.cancel();
  stopSpeechAnimation();

  const sessionId = ++speechSessionId;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "fr-FR";
  utterance.rate = voiceRate;
  utterance.pitch = 0.92;
  utterance.volume = 1;

  const voices = window.speechSynthesis.getVoices();
  const frenchVoice = voices.find((voice) => voice.lang.toLowerCase().startsWith("fr")) || voices[0];
  if (frenchVoice) utterance.voice = frenchVoice;

  utterance.addEventListener("start", () => {
    if (sessionId !== speechSessionId) return;

    updateActivity("Noon parle…");
    setVisualState("speaking");
    startSpeechAnimation();
  });

  utterance.addEventListener("end", () => {
    if (sessionId !== speechSessionId) return;
    if (currentSpeech !== utterance) return;

    stopSpeechAnimation();
    currentSpeech = null;
    updateActivity("En attente.");
    setVisualState("idle");
  });

  utterance.addEventListener("error", () => {
    if (sessionId !== speechSessionId) return;
    if (currentSpeech !== utterance) return;

    stopSpeechAnimation();
    currentSpeech = null;
    updateActivity("Erreur de synthèse vocale.");
    setVisualState("idle");
  });

  currentSpeech = utterance;
  window.speechSynthesis.speak(utterance);
}

function interruptNoonSpeech() {
  if (!("speechSynthesis" in window)) {
    return;
  }

  speechSessionId += 1;
  window.speechSynthesis.cancel();

  if (typeof stopSpeechAnimation === "function") {
    stopSpeechAnimation();
  }

  currentSpeech = null;
  updateActivity("Réponse interrompue.");

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

    budgetValue.textContent = `$${costUSD.toFixed(4)} / $${monthlyBudgetUSD.toFixed(2)}`;
    budgetMode.textContent = mode;
    budgetProgress.style.width = `${percent}%`;
  } catch {
    budgetValue.textContent = "Indisponible";
    budgetMode.textContent = "—";
    budgetProgress.style.width = "0%";
  }
}

function updateFocusFromQuestion(question) {
  const projectMatch = question.match(/(?:projet|focus|analyse)\s+([\wÀ-ÿ-]+)/i);

  if (!projectMatch) return;

  const projectName = projectMatch[1].replace(/[.,!?;:]$/, "");
  setFocus(projectName);
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
  } = options;
  const filesToSend = [...selectedFiles];
  const attachmentMetadata =
    createAttachmentMetadata(filesToSend);

  if (!question && filesToSend.length === 0) return;

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
  promptInput.style.height = "auto";
  updateActivity("Noon réfléchit…");
  setVisualState("thinking");
  startActivityPolling();

  try {
    activeRequestController = new AbortController();

    const response = await fetch("/ai", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        question: finalQuestion,
        focus: currentFocus,
        focusPath: currentFocusPath,
        mode: currentMode,
        sessionId: currentSessionId,
        attachments,
        visualDetail,
        webSearchEnabled,
      }),
      signal: activeRequestController.signal,
    });
    const data = await response.json();

    if (!response.ok) {
      const requestError = new Error(
        data.message || "Erreur Noon"
      );

      requestError.status = response.status;
      requestError.code = data.errorCode;
      requestError.retryable = data.retryable === true;
      requestError.retryAfter =
        Number(
          data.retryAfter ||
          response.headers.get("Retry-After")
        ) || 20;

      throw requestError;
    }

    stopActivityPolling();
    addMessage(
      "Noon",
      data.answer,
      "noon",
      true,
      [],
      Array.isArray(data.sources) ? data.sources : []
    );
    notifyAnswerReady(data.answer);
    hideWebSearchSuggestion();
    webSearchEnabled = false;
    updateWebSearchButton();
    updateWebSearchUsage(data.webSearchUsage);
    lastFailedQuestion = null;
    retryButton.hidden = true;
    retryButton.disabled = false;
    clearSavedDraft();
    updateActivity("Réponse reçue.");

    if (attachments.length > 0) {
      clearSelectedFile(false);
    }

    if (voiceEnabled) {
      const spokenAnswer = prepareTextForSpeech(data.answer);

      if (spokenAnswer) {
        speakNoon(spokenAnswer);
      }
    } else {
      updateActivity("Réponse affichée.");
      setVisualState("idle");
    }

    loadBudget();
  } catch (error) {
    stopActivityPolling();

    if (error.name === "AbortError") {
      hideWebSearchSuggestion();
      updateActivity("Demande interrompue.");
      promptInput.value = finalQuestion;
      saveCurrentDraft();
      lastFailedQuestion = null;
      retryButton.hidden = true;
      setVisualState("idle");
      return;
    }

    if (error.status === 429) {
      promptInput.value = finalQuestion;
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
    promptInput.style.height = "auto";
    promptInput.style.height =
      `${Math.min(promptInput.scrollHeight, 100)}px`;
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

  const confirmed = window.confirm(
    "Commencer une nouvelle conversation ?\n\n" +
      "Les messages affichés et les cinq échanges " +
      "mémorisés seront supprimés."
  );

  if (!confirmed) return;

  newConversationButton.disabled = true;
  hideWebSearchSuggestion();
  interruptNoonSpeech();
  updateActivity("Réinitialisation de la conversation…");

  try {
    const response = await fetch("/conversation/reset", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Noon-Request": "1",
      },
      body: JSON.stringify({
        sessionId: currentSessionId,
      }),
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.message ||
          "Impossible de réinitialiser la conversation."
      );
    }

    localStorage.removeItem(CONVERSATION_STORAGE_KEY);
    conversationMessages.replaceChildren();
    promptInput.value = "";
    clearSavedDraft();
    promptInput.style.height = "auto";
    lastFailedQuestion = null;
    retryButton.hidden = true;
    retryButton.disabled = false;

    if (selectedFiles.length > 0) {
      clearSelectedFile(false);
    }

    addMessage(
      "Noon",
      "Nouvelle conversation. Comment puis-je t’aider ?",
      "noon",
      false
    );

    updateActivity("Nouvelle conversation prête.");
    setVisualState("idle");
    promptInput.focus();
  } catch (error) {
    updateActivity(error.message);
  } finally {
    newConversationButton.disabled = false;
  }
});

exportConversationButton.addEventListener("click", () => {
  const messages = loadSavedMessages();

  if (messages.length === 0) {
    updateActivity("Aucune conversation à exporter.");
    return;
  }

  const markdown = createConversationMarkdown(messages);
  const blob = new Blob([markdown], {
    type: "text/markdown;charset=utf-8",
  });
  const downloadUrl = URL.createObjectURL(blob);
  const date = new Date().toISOString().slice(0, 10);
  const link = document.createElement("a");

  link.href = downloadUrl;
  link.download = `conversation-noon-${date}.md`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(downloadUrl);
  updateActivity("Conversation exportée en Markdown.");
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
  localStorage.removeItem(CONVERSATION_STORAGE_KEY);
  conversation.innerHTML = `
    <div class="message noon">
      <span class="author">Noon</span>
      <p>Nouvelle session. Je suis prêt.</p>
    </div>
  `;
  saveConversationMessage(
    "Noon",
    "Nouvelle session. Je suis prêt.",
    "noon"
  );

  updateActivity("Réinitialisation de la mémoire…");

  try {
    await fetch(
      `/session/clear?sessionId=${encodeURIComponent(
        currentSessionId
      )}`,
      {
        method: "POST",
      }
    );

    updateActivity("Nouvelle session.");
  } catch {
    updateActivity(
      "Interface réinitialisée, mais mémoire indisponible."
    );
  }
});

const MAX_RECORDING_MS = 20_000;

let mediaStream = null;
let mediaRecorder = null;
let audioChunks = [];
let recordingTimer = null;
let recordingStartedAt = 0;
let isListening = false;
let discardRecording = false;
let silenceAudioContext = null;
let silenceAnalyser = null;
let silenceSource = null;
let silenceAnimationFrame = null;
let speechDetected = false;
let silenceStartedAt = null;

const SILENCE_THRESHOLD = 0.018;
const SILENCE_DURATION_MS = 1400;

function getSupportedAudioType() {
  const audioTypes = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
  ];

  return (
    audioTypes.find((audioType) =>
      MediaRecorder.isTypeSupported(audioType)
    ) || ""
  );
}

function releaseMicrophone() {
  if (mediaStream) {
    mediaStream
      .getTracks()
      .forEach((track) => track.stop());
  }

  mediaStream = null;
}

function finishVoiceRecording() {
  if (
    mediaRecorder &&
    mediaRecorder.state === "recording"
  ) {
    isListening = false;
    micButton.classList.remove("active");
    micButton.setAttribute("aria-pressed", "false");
    updateActivity("Noon transcrit…");
    mediaRecorder.stop();
  }
}

function startSilenceDetection(stream) {
  const AudioContextClass =
    window.AudioContext || window.webkitAudioContext;

  silenceAudioContext = new AudioContextClass();
  silenceAnalyser = silenceAudioContext.createAnalyser();
  silenceSource =
    silenceAudioContext.createMediaStreamSource(stream);

  silenceAnalyser.fftSize = 2048;
  silenceAnalyser.smoothingTimeConstant = 0.8;

  silenceSource.connect(silenceAnalyser);

  const audioData = new Float32Array(
    silenceAnalyser.fftSize
  );

  speechDetected = false;
  silenceStartedAt = null;

  function analyseMicrophone() {
    if (
      !mediaRecorder ||
      mediaRecorder.state !== "recording"
    ) {
      return;
    }

    silenceAnalyser.getFloatTimeDomainData(audioData);

    let total = 0;

    for (const sample of audioData) {
      total += sample * sample;
    }

    const volume = Math.sqrt(
      total / audioData.length
    );

    if (typeof window.setAudioLevel === "function") {
      window.setAudioLevel(Math.min(volume * 12, 1));
    }

    if (volume > SILENCE_THRESHOLD) {
      speechDetected = true;
      silenceStartedAt = null;
    } else if (speechDetected) {
      if (!silenceStartedAt) {
        silenceStartedAt = Date.now();
      }

      const silenceDuration =
        Date.now() - silenceStartedAt;

      if (silenceDuration >= SILENCE_DURATION_MS) {
        finishVoiceRecording();
        return;
      }
    }

    silenceAnimationFrame =
      requestAnimationFrame(analyseMicrophone);
  }

  analyseMicrophone();
}

function stopSilenceDetection() {
  if (silenceAnimationFrame) {
    cancelAnimationFrame(silenceAnimationFrame);
  }

  silenceSource?.disconnect();

  if (silenceAudioContext) {
    silenceAudioContext.close().catch(() => {});
  }

  silenceAnimationFrame = null;
  silenceSource = null;
  silenceAnalyser = null;
  silenceAudioContext = null;
  speechDetected = false;
  silenceStartedAt = null;

  if (typeof window.setAudioLevel === "function") {
    window.setAudioLevel(0);
  }
}

async function transcribeRecording(
  audioBlob,
  durationMs
) {
  updateActivity("Transcription…");
  setVisualState("thinking");

  const response = await fetch("/transcribe", {
    method: "POST",

    headers: {
      "Content-Type":
        audioBlob.type || "audio/webm",

      "X-Audio-Duration-Ms":
        String(durationMs),
    },

    body: audioBlob,
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data.message ||
      "Erreur de transcription."
    );
  }

  return data.text.trim();
}

async function startRecording() {
  if (
    !navigator.mediaDevices?.getUserMedia ||
    typeof MediaRecorder === "undefined"
  ) {
    updateActivity(
      "Enregistrement vocal indisponible."
    );

    return;
  }

  try {
    discardRecording = false;

    mediaStream =
      await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },

        video: false,
      });

    const audioType = getSupportedAudioType();

    mediaRecorder = audioType
      ? new MediaRecorder(mediaStream, {
          mimeType: audioType,
        })
      : new MediaRecorder(mediaStream);

    audioChunks = [];

    mediaRecorder.addEventListener(
      "dataavailable",
      (event) => {
        if (event.data.size > 0) {
          audioChunks.push(event.data);
        }
      }
    );

    mediaRecorder.addEventListener(
      "stop",
      async () => {
        stopSilenceDetection();
        window.clearTimeout(recordingTimer);

        isListening = false;
        micButton.classList.remove("active");
        micButton.setAttribute("aria-pressed", "false");

        const durationMs =
          Date.now() - recordingStartedAt;

        const mimeType =
          mediaRecorder?.mimeType ||
          audioType ||
          "audio/webm";

        const audioBlob = new Blob(
          audioChunks,
          {
            type: mimeType,
          }
        );

        releaseMicrophone();
        mediaRecorder = null;
        audioChunks = [];

        if (discardRecording) return;

        try {
          const transcript =
            await transcribeRecording(
              audioBlob,
              durationMs
            );

          promptInput.value = transcript;

          updateActivity(
            `Entendu : ${transcript}`
          );

          await sendQuestion(transcript);
        } catch (error) {
          updateActivity(error.message);
          setVisualState("idle");
        }
      }
    );

    mediaRecorder.start();
    startSilenceDetection(mediaStream);

    isListening = true;
    recordingStartedAt = Date.now();

    micButton.classList.add("active");
    micButton.setAttribute("aria-pressed", "true");

    updateActivity(
      "Noon écoute…"
    );

    setVisualState("listening");

    recordingTimer = window.setTimeout(
      finishVoiceRecording,
      MAX_RECORDING_MS
    );
  } catch (error) {
    releaseMicrophone();

    isListening = false;
    micButton.classList.remove("active");
    micButton.setAttribute("aria-pressed", "false");

    updateActivity(
      `Microphone indisponible : ${error.message}`
    );
  }
}

micButton.addEventListener("click", async () => {
  const noonIsSpeaking =
    "speechSynthesis" in window &&
    (window.speechSynthesis.speaking ||
      window.speechSynthesis.pending);

  if (noonIsSpeaking) {
    interruptNoonSpeech();
  }

  if (
    mediaRecorder &&
    mediaRecorder.state === "recording"
  ) {
    finishVoiceRecording();
    return;
  }

  await startRecording();
});

promptInput.addEventListener("input", () => {
  hideWebSearchSuggestion();
  promptInput.style.height = "auto";
  promptInput.style.height = `${Math.min(promptInput.scrollHeight, 100)}px`;

  window.clearTimeout(draftSaveTimer);
  draftSaveTimer = window.setTimeout(() => {
    saveCurrentDraft();
  }, 300);

  if (
    lastFailedQuestion &&
    promptInput.value.trim() !== lastFailedQuestion.trim()
  ) {
    retryButton.hidden = true;
  }
});

promptInput.addEventListener("keydown", (event) => {
  const commandKey = event.metaKey || event.ctrlKey;

  if (commandKey && event.key === "Enter") {
    event.preventDefault();
    chatForm.requestSubmit();
    return;
  }

  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});

document.addEventListener("keydown", (event) => {
  const commandKey = event.metaKey || event.ctrlKey;
  const pressedKey = event.key.toLowerCase();

  if (commandKey && pressedKey === "k") {
    event.preventDefault();
    promptInput.focus();
    promptInput.select();
    updateActivity("Champ de saisie activé.");
    return;
  }

  if (
    commandKey &&
    event.shiftKey &&
    pressedKey === "m"
  ) {
    event.preventDefault();

    if (!event.repeat) {
      micButton.click();
    }

    return;
  }

  if (event.key === "Escape") {
    if (
      mediaRecorder &&
      mediaRecorder.state === "recording"
    ) {
      finishVoiceRecording();
      return;
    }

    const noonIsSpeaking =
      "speechSynthesis" in window &&
      (window.speechSynthesis.speaking ||
        window.speechSynthesis.pending);

    if (noonIsSpeaking) {
      interruptNoonSpeech();
      return;
    }

    if (!quickSettings.hidden) {
      quickSettings.hidden = true;
      settingsButton.setAttribute("aria-expanded", "false");
      updateActivity("Réglages fermés.");
      return;
    }

    closeFocusMenu();
    switchView("core");
    setSidebar(false);
  }
});

switchView("core");
const savedSidebarState = localStorage.getItem("noon-sidebar-open");
setSidebar(savedSidebarState === null ? window.innerWidth > 720 : savedSidebarState !== "false", false);
loadBudget();
loadLocalProjects();
restoreDisplayedConversation();
restoreSavedDraft();
checkNoonConnection();

window.addEventListener("online", checkNoonConnection);
window.addEventListener("offline", () => {
  setConnectionStatus("offline", "Hors connexion");
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    checkNoonConnection();
  }
});
window.setInterval(checkNoonConnection, 30_000);

function stopNoonAudio() {
  discardRecording = true;

  window.clearTimeout(recordingTimer);
  stopSilenceDetection();

  if (
    mediaRecorder?.state === "recording"
  ) {
    mediaRecorder.stop();
  }

  releaseMicrophone();

  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }

  isListening = false;
  micButton?.classList.remove("active");
  micButton?.setAttribute("aria-pressed", "false");

  if (typeof window.setAudioLevel === "function") {
    window.setAudioLevel(0);
  }

  if (typeof window.setNoonState === "function") {
    window.setNoonState("idle");
  }
}

window.addEventListener(
  "beforeunload",
  stopNoonAudio
);

window.addEventListener("beforeunload", () => {
  saveCurrentDraft();
});
