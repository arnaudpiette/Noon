// Contrôleur principal de l’interface Noon.
// Il gère la conversation, le Focus, la voix, les fichiers et les préférences locales.

// Références DOM partagées par les différents modules de l’interface.
const {
  escapeHtml,
  parseFocusCommand,
  shouldConvertPastedText,
  createPastedTextFileName,
  createChatRequestPayload,
  maskPrivateMemoryValue,
  privateMemoryCategoryLabel,
  normalizeSafeChatUrl,
  renderChatMarkdown,
  presentDevProgress,
} = window.NoonUiUtils;
const chatForm = document.getElementById("chatForm");
const promptInput = document.getElementById("prompt");
const expandPromptButton = document.getElementById("expandPromptButton");
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
const focusCatalogStatus = document.getElementById("focusCatalogStatus");
const focusAvailability = document.getElementById("focusAvailability");
const refreshProjectsButton = document.getElementById("refreshProjectsButton");
const conversationTitle = document.getElementById("conversationTitle");
const chatView = document.getElementById("chatView");
const devTerminalPanel = document.getElementById("devTerminalPanel");
const devTerminalProject = document.getElementById("devTerminalProject");
const devTerminalMeta = document.getElementById("devTerminalMeta");
const devTerminalTabs = document.getElementById("devTerminalTabs");
const devTerminalOutput = document.getElementById("devTerminalOutput");
const devTerminalJumpBottomButton = document.getElementById(
  "devTerminalJumpBottom"
);
const devTerminalForm = document.getElementById("devTerminalForm");
const devTerminalInput = document.getElementById("devTerminalInput");
const devTerminalRun = document.getElementById("devTerminalRun");
const devTerminalAddButton = document.getElementById("devTerminalAdd");
const devTerminalCopyOutputButton = document.getElementById(
  "devTerminalCopyOutput"
);
const devTerminalExportOutputButton = document.getElementById(
  "devTerminalExportOutput"
);
const devWorkspaceAgentState = document.getElementById("devWorkspaceAgentState");
const devWorkspaceAgentRun = document.getElementById("devWorkspaceAgentRun");
const devWorkspaceAgentCancel = document.getElementById("devWorkspaceAgentCancel");
const devTerminalCollapseButton = document.getElementById(
  "devTerminalCollapse"
);
const devTerminalMaximizeButton = document.getElementById(
  "devTerminalMaximize"
);
const devTerminalResizeHandle = document.getElementById(
  "devTerminalResizeHandle"
);
const devTerminalStatus = document.getElementById("devTerminalStatus");
const devProblemsPanel = document.getElementById("devProblemsPanel");
const devProblemsTotal = document.getElementById("devProblemsTotal");
const devProblemsErrors = document.getElementById("devProblemsErrors");
const devProblemsWarnings = document.getElementById("devProblemsWarnings");
const devProblemsInfos = document.getElementById("devProblemsInfos");
const devProblemsState = document.getElementById("devProblemsState");
const devProblemsList = document.getElementById("devProblemsList");
const devProblemsTruncated = document.getElementById("devProblemsTruncated");
const devSourceControlToggle =
  document.getElementById(
    "devSourceControlToggle"
  );
const devSourceControlPanel =
  document.getElementById(
    "devSourceControlPanel"
  );
const devSourceControlRefresh =
  document.getElementById(
    "devSourceControlRefresh"
  );
const devSourceControlBranch =
  document.getElementById(
    "devSourceControlBranch"
  );
const devSourceControlTotal =
  document.getElementById(
    "devSourceControlTotal"
  );
const devSourceControlStaged =
  document.getElementById(
    "devSourceControlStaged"
  );
const devSourceControlUnstaged =
  document.getElementById(
    "devSourceControlUnstaged"
  );
const devSourceControlUntracked =
  document.getElementById(
    "devSourceControlUntracked"
  );
const devSourceControlConflicted =
  document.getElementById(
    "devSourceControlConflicted"
  );
const devSourceControlFiles =
  document.getElementById(
    "devSourceControlFiles"
  );
const devSourceControlSelected =
  document.getElementById(
    "devSourceControlSelected"
  );
const devSourceControlWorktree =
  document.getElementById(
    "devSourceControlWorktree"
  );
const devSourceControlStagedScope =
  document.getElementById(
    "devSourceControlStagedScope"
  );
const devSourceControlPatch =
  document.getElementById(
    "devSourceControlPatch"
  );
const devSourceControlState =
  document.getElementById(
    "devSourceControlState"
  );
const devSourceControlTruncated =
  document.getElementById(
    "devSourceControlTruncated"
  );
const devProjectRulesToggle = document.getElementById("devProjectRulesToggle");
const devProjectRulesPanel = document.getElementById("devProjectRulesPanel");
const devProjectRulesProject = document.getElementById("devProjectRulesProject");
const devProjectRulesAdd = document.getElementById("devProjectRulesAdd");
const devProjectRulesReadOnly = document.getElementById("devProjectRulesReadOnly");
const devProjectRulesList = document.getElementById("devProjectRulesList");
const devProjectRulesForm = document.getElementById("devProjectRulesForm");
const devProjectRulesInput = document.getElementById("devProjectRulesInput");
const devProjectRulesPreview = document.getElementById("devProjectRulesPreview");
const devProjectRulesSave = document.getElementById("devProjectRulesSave");
const devProjectRulesCancel = document.getElementById("devProjectRulesCancel");
const devProjectRulesStatus = document.getElementById("devProjectRulesStatus");
const devTerminalExecutionProfileLabel = document.getElementById("devTerminalExecutionProfileLabel");
const devTerminalExecutionProfile = document.getElementById("devTerminalExecutionProfile");
const devTerminalExecutionProfileStatus = document.getElementById("devTerminalExecutionProfileStatus");
const devUiValidationProject = document.getElementById("devUiValidationProject");
const devUiValidationProjectLabel = document.getElementById("devUiValidationProjectLabel");
// DEV_TERMINAL_BUTTON_METRICS_START
/*
 * Le premier bouton "Noon" est la référence visuelle
 * de tous les contrôles principaux du Terminal DEV.
 *
 * On lit son style calculé afin d'éviter plusieurs
 * tailles de texte, hauteurs ou paddings concurrents.
 */
function syncDevTerminalButtonMetrics() {
  const panel =
    document.getElementById(
      "devTerminalPanel"
    );

  const reference =
    document.getElementById(
      "devWorkspaceAgentRun"
    );

  if (
    !panel ||
    !reference
  ) {
    return;
  }

  const style =
    window.getComputedStyle(
      reference
    );

  const px = (value) => {
    const parsed =
      Number.parseFloat(
        value
      );

    return Number.isFinite(parsed)
      ? parsed
      : 0;
  };

  const fontSize =
    Math.max(
      1,
      px(style.fontSize)
    );

  const lineHeight =
    style.lineHeight === "normal"
      ? fontSize * 1.2
      : Math.max(
          fontSize,
          px(style.lineHeight)
        );

  const calculatedHeight =
    lineHeight +
    px(style.paddingTop) +
    px(style.paddingBottom) +
    px(style.borderTopWidth) +
    px(style.borderBottomWidth);

  const referenceHeight =
    Math.max(
      px(style.height),
      px(style.minHeight),
      calculatedHeight
    );

  const horizontalPadding =
    Math.max(
      px(style.paddingLeft),
      px(style.paddingRight)
    );

  panel.style.setProperty(
    "--dev-terminal-control-height",
    `${Math.round(
      referenceHeight
    )}px`
  );

  panel.style.setProperty(
    "--dev-terminal-control-padding-x",
    `${horizontalPadding}px`
  );

  panel.style.setProperty(
    "--dev-terminal-control-font-size",
    style.fontSize
  );

  panel.style.setProperty(
    "--dev-terminal-control-font-weight",
    style.fontWeight
  );

  panel.style.setProperty(
    "--dev-terminal-control-font-family",
    style.fontFamily
  );

  panel.style.setProperty(
    "--dev-terminal-control-letter-spacing",
    style.letterSpacing
  );

  panel.style.setProperty(
    "--dev-terminal-control-radius",
    style.borderRadius
  );
}

syncDevTerminalButtonMetrics();

window.addEventListener(
  "resize",
  syncDevTerminalButtonMetrics
);

document.fonts?.ready
  ?.then(
    syncDevTerminalButtonMetrics
  )
  .catch(
    () => {}
  );
// DEV_TERMINAL_BUTTON_METRICS_END

const clearChatButton = document.getElementById("clearChat");
const newConversationButton = document.getElementById(
  "newConversationButton"
);
const conversationHistory = document.getElementById("conversationHistory");
const conversationHistoryCount = document.getElementById("conversationHistoryCount");
const conversationHistoryList = document.getElementById("conversationHistoryList");
const conversationProjects = document.getElementById("conversationProjects");
const conversationProjectsList = document.getElementById("conversationProjectsList");
const createConversationProjectButton = document.getElementById("createConversationProject");
const shareConversationButton = document.getElementById("shareConversationButton");
const shareConversationMenu = document.getElementById("shareConversationMenu");
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
let currentView = "core";
const sidebarToggle = document.getElementById("sidebarToggle");
const sidebarBackdrop = document.getElementById("sidebarBackdrop");
const collapsedSidebarRail = document.getElementById("collapsedSidebarRail");
const settingsButton = document.getElementById("settingsButton");
const systemStatusButton = document.getElementById("systemStatusButton");
const quickSettings = document.getElementById("quickSettings");
const wakeWordEnabledInput = document.getElementById("wakeWordEnabled");
const wakeWordStatus = document.getElementById("wakeWordStatus");
const picovoiceAccessKey = document.getElementById("picovoiceAccessKey");
const savePicovoiceKeyButton = document.getElementById("savePicovoiceKey");
const importWakeKeywordButton = document.getElementById("importWakeKeyword");
const importWakeModelButton = document.getElementById("importWakeModel");
const wakeWordDeviceSelect = document.getElementById("wakeWordDevice");
const wakeWordSensitivityInput = document.getElementById("wakeWordSensitivity");
const wakeWordSensitivityValue = document.getElementById("wakeWordSensitivityValue");
const resumeWakeAfterUnlockInput = document.getElementById("resumeWakeAfterUnlock");
const testWakeWordButton = document.getElementById("testWakeWord");
const resetWakeWordButton = document.getElementById("resetWakeWord");
const openAIKeyStatus = document.getElementById("openAIKeyStatus");
const openAIKeyInput = document.getElementById("openAIKeyInput");
const saveOpenAIKeyButton = document.getElementById("saveOpenAIKey");
const localFolderModeSelect = document.getElementById("localFolderMode");
const addLocalFolderButton = document.getElementById("addLocalFolderButton");
const localFolderPermissions = document.getElementById("localFolderPermissions");
const voiceEnabledInput = document.getElementById("voiceEnabled");
const notificationsEnabledInput = document.getElementById(
  "notificationsEnabled"
);
const voiceRateSelect = document.getElementById("voiceRate");
const audioInputDeviceSelect = document.getElementById("audioInputDevice");
const audioOutputDeviceSelect = document.getElementById("audioOutputDevice");
const openMicrophoneSettingsButton = document.getElementById("openMicrophoneSettings");
const visualDetailSelect = document.getElementById("visualDetail");
const intelligenceProfileSelect = document.getElementById("intelligenceProfile");
const creativeBriefEnabledInput = document.getElementById("creativeBriefEnabled");
const creativeBriefTimeInput = document.getElementById("creativeBriefTime");
const creativeBriefNotificationsInput = document.getElementById("creativeBriefNotifications");
const launchAtLoginInput = document.getElementById("launchAtLogin");
const testCreativeBriefButton = document.getElementById("testCreativeBrief");
const briefState = document.getElementById("briefState");
const briefContent = document.getElementById("briefContent");
const personalBriefState = document.getElementById("personalBriefState");
const personalBriefContent = document.getElementById("personalBriefContent");
const briefStructuredContent = document.getElementById("briefStructuredContent");
const briefSources = document.getElementById("briefSources");
const briefGeneratedAt = document.getElementById("briefGeneratedAt");
const generateBriefButton = document.getElementById("generateBriefButton");
const readBriefButton = document.getElementById("readBriefButton");
const stopBriefReadingButton = document.getElementById("stopBriefReadingButton");
const briefSourceStates = document.getElementById("briefSourceStates");
const briefScheduledBlocks = document.getElementById("briefScheduledBlocks");
const briefDrafts = document.getElementById("briefDrafts");
const autoPlanningEnabledInput = document.getElementById("autoPlanningEnabled");
const autoDraftsEnabledInput = document.getElementById("autoDraftsEnabled");
const planningLearningEnabledInput = document.getElementById("planningLearningEnabled");
const workdayStartInput = document.getElementById("workdayStart");
const workdayEndInput = document.getElementById("workdayEnd");
const minimumSlotMinutesInput = document.getElementById("minimumSlotMinutes");
const maximumFocusMinutesInput = document.getElementById("maximumFocusMinutes");
const planningBufferMinutesInput = document.getElementById("planningBufferMinutes");
const planningWorkingDaysInput = document.getElementById("planningWorkingDays");
const busyCalendarIdsInput = document.getElementById("busyCalendarIds");
const targetCalendarIdInput = document.getElementById("targetCalendarId");
const planningPreferenceList = document.getElementById("planningPreferenceList");
const longTermMemoryEnabledInput = document.getElementById("longTermMemoryEnabled");
const newMemoryTextInput = document.getElementById("newMemoryText");
const addMemoryButton = document.getElementById("addMemoryButton");
const memoryList = document.getElementById("memoryList");
const clearMemoriesButton = document.getElementById("clearMemoriesButton");
const personalDatabaseStatus = document.getElementById("personalDatabaseStatus");
const personalMemorySearch = document.getElementById("personalMemorySearch");
const personalMemoryStatus = document.getElementById("personalMemoryStatus");
const personalMemorySensitivity = document.getElementById("personalMemorySensitivity");
const personalMemoryList = document.getElementById("personalMemoryList");
const privateMemoryVisibilityButton = document.getElementById("privateMemoryVisibilityButton");
const privateMemoryProfiles = document.getElementById("privateMemoryProfiles");
const privateMemoryEnabled = document.getElementById("privateMemoryEnabled");
const privateProfileEnabled = document.getElementById("privateProfileEnabled");
const privateMemorySensitiveApi = document.getElementById("privateMemorySensitiveApi");
const privateMemoryImportButton = document.getElementById("privateMemoryImportButton");
const privateMemoryExportButton = document.getElementById("privateMemoryExportButton");
const privateMemoryPurgeButton = document.getElementById("privateMemoryPurgeButton");
const privateMemoryWhy = document.getElementById("privateMemoryWhy");
const privateMemoryAuthDialog = document.getElementById("privateMemoryAuthDialog");
const privateMemoryAuthForm = document.getElementById("privateMemoryAuthForm");
const privateMemoryTouchIdButton = document.getElementById("privateMemoryTouchIdButton");
const privateMemoryPasswordPanel = document.getElementById("privateMemoryPasswordPanel");
const privateMemoryPasswordLabel = document.getElementById("privateMemoryPasswordLabel");
const privateMemoryPasswordInput = document.getElementById("privateMemoryPasswordInput");
const privateMemoryPasswordHelp = document.getElementById("privateMemoryPasswordHelp");
const privateMemoryPasswordSubmit = document.getElementById("privateMemoryPasswordSubmit");
const privateMemoryAuthCancel = document.getElementById("privateMemoryAuthCancel");
const privateMemoryAuthError = document.getElementById("privateMemoryAuthError");
const livingProjectsList = document.getElementById("livingProjectsList");
const personalInboxFilter = document.getElementById("personalInboxFilter");
const personalInboxList = document.getElementById("personalInboxList");
const personalRecommendationList = document.getElementById("personalRecommendationList");
const personalMetrics = document.getElementById("personalMetrics");
const backgroundAnalysisList = document.getElementById("backgroundAnalysisList");
const personalTabs = document.querySelectorAll(".personal-tab");
const personalPanels = document.querySelectorAll(".personal-panel");
const attachButton = document.getElementById("attachButton");
const composerMenuButton = document.getElementById("composerMenuButton");
const composerMenu = document.getElementById("composerMenu");
const composerSettingsButton = document.getElementById(
  "composerSettingsButton"
);
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
const projectJournalPanel = document.getElementById("projectJournalPanel");
const projectJournalName = document.getElementById("projectJournalName");
const projectJournalStatus = document.getElementById("projectJournalStatus");
const projectJournalMode = document.getElementById("projectJournalMode");
const projectJournalDate = document.getElementById("projectJournalDate");
const projectJournalNext = document.getElementById("projectJournalNext");
const projectJournalBlockers = document.getElementById("projectJournalBlockers");
const projectJournalDetailContent = document.getElementById("projectJournalDetailContent");
const controlProjectButton = document.getElementById("controlProjectButton");
const endProjectSessionButton = document.getElementById("endProjectSessionButton");
const gmailAutoDraftsInput = document.getElementById("gmailAutoDrafts");
const integrationsList = document.getElementById("integrationsList");
const integrationsSecurityStatus = document.getElementById("integrationsSecurityStatus");
const approvalsList = document.getElementById("approvalsList");
const automationsList = document.getElementById("automationsList");

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
const AUDIO_EXTENSIONS = [".webm", ".wav", ".mp3", ".m4a"];
const AUDIO_MIME_TYPES = {
  ".webm": "audio/webm", ".wav": "audio/wav",
  ".mp3": "audio/mpeg", ".m4a": "audio/mp4",
};
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
const MAX_TEXT_ATTACHMENT_SIZE = 1024 * 1024;
const MAX_IMAGE_ATTACHMENT_SIZE = 2 * 1024 * 1024;
const MAX_PDF_ATTACHMENT_SIZE = 3 * 1024 * 1024;
const MAX_DOCUMENT_ATTACHMENT_SIZE = 3 * 1024 * 1024;
const MAX_SPREADSHEET_ATTACHMENT_SIZE = 3 * 1024 * 1024;
const MAX_AUDIO_ATTACHMENT_SIZE = 5 * 1024 * 1024;
let selectedFiles = [];
let webSearchEnabled = false;
let remainingWebSearches = 10;
const MAX_ATTACHMENT_FILES = 3;
const MAX_ATTACHMENTS_TOTAL_SIZE = 5 * 1024 * 1024;
const MAX_PROMPT_HEIGHT = 320;
const MAX_EXPANDED_PROMPT_HEIGHT = 720;
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
const AUDIO_INPUT_STORAGE_KEY = "noonAudioInputDevice";
const AUDIO_OUTPUT_STORAGE_KEY = "noonAudioOutputDevice";
let preferredAudioInputId = localStorage.getItem(AUDIO_INPUT_STORAGE_KEY) || "";
let preferredAudioOutputId = localStorage.getItem(AUDIO_OUTPUT_STORAGE_KEY) || "";
const allowedVisualDetails = ["low", "high"];
let visualDetail =
  localStorage.getItem("noonVisualDetail") || "low";
let intelligenceProfile = localStorage.getItem("noonIntelligenceProfile") || "balanced";
if (!["economical", "balanced", "maximum"].includes(intelligenceProfile)) intelligenceProfile = "balanced";

if (!allowedVisualDetails.includes(visualDetail)) {
  visualDetail = "low";
}

voiceEnabledInput.checked = voiceEnabled;
notificationsEnabledInput.checked = notificationsEnabled;
voiceRateSelect.value = String(voiceRate);
visualDetailSelect.value = visualDetail;
intelligenceProfileSelect.value = intelligenceProfile;
gmailAutoDraftsInput.checked = localStorage.getItem("noonGmailAutoDrafts") !== "false";

gmailAutoDraftsInput.addEventListener("change", () => {
  localStorage.setItem("noonGmailAutoDrafts", String(gmailAutoDraftsInput.checked));
  updateActivity(gmailAutoDraftsInput.checked
    ? "Création automatique des brouillons Gmail activée. Aucun envoi automatique."
    : "Création automatique des brouillons Gmail désactivée.");
});

let currentSpeech = null;
let speechSessionId = 0;
let speechAnimationTimer = null;
let classicSpeechController = null;
let classicAudioContext = null;
const classicAudioSources = new Set();
let activityPollingId = null;
const MODE_STORAGE_KEY = "noonMode";
const ALLOWED_MODES = ["DA", "DEV", "SOUTENANCE"];
let currentMode =
  localStorage.getItem(MODE_STORAGE_KEY) || "DA";
const FOCUS_STORAGE_KEY = "noonFocus";
const FOCUS_PATH_STORAGE_KEY = "noonFocusPath";
const FOCUS_ID_STORAGE_KEY = "noonFocusId";

let currentFocus = localStorage.getItem(FOCUS_STORAGE_KEY);
let currentFocusPath = localStorage.getItem(
  FOCUS_PATH_STORAGE_KEY
);
let currentFocusId = localStorage.getItem(FOCUS_ID_STORAGE_KEY);

// DEV_PREVIEW_UI_START
// Le contenu Web n'entre jamais dans le renderer Noon.
// Ce bloc ne manipule que le chrome UI et les coordonnées
// transmises à la vue native sandboxée du main process.

const devPreviewPanel =
  document.getElementById(
    "devPreviewPanel"
  );

const devPreviewProject =
  document.getElementById(
    "devPreviewProject"
  );

const devPreviewForm =
  document.getElementById(
    "devPreviewForm"
  );

const devPreviewUrlInput =
  document.getElementById(
    "devPreviewUrl"
  );

const devPreviewOpenButton =
  document.getElementById(
    "devPreviewOpen"
  );

const devPreviewBackButton =
  document.getElementById(
    "devPreviewBack"
  );

const devPreviewForwardButton =
  document.getElementById(
    "devPreviewForward"
  );

const devPreviewReloadButton =
  document.getElementById(
    "devPreviewReload"
  );

const devPreviewExternalButton =
  document.getElementById(
    "devPreviewExternal"
  );

const devPreviewCloseButton =
  document.getElementById(
    "devPreviewClose"
  );

const devPreviewViewport =
  document.getElementById(
    "devPreviewViewport"
  );

const devPreviewPlaceholder =
  document.getElementById(
    "devPreviewPlaceholder"
  );

const devPreviewStatus =
  document.getElementById(
    "devPreviewStatus"
  );

const devWorkspaceComposer =
  document.querySelector(
    ".composer"
  );

// DEV_WORKSPACE_CONSERVATIVE_V5_START

const devPreviewResizeHandle =
  document.getElementById(
    "devPreviewResizeHandle"
  );

const devWorkspaceChatHeader =
  chatView.querySelector(
    ".chat-header"
  );

const DEV_PREVIEW_WIDTH_STORAGE_KEY =
  "noonDevPreviewWidth";

const DEV_PREVIEW_MIN_WIDTH = 300;
const DEV_LEFT_MIN_WIDTH = 320;
const DEV_PREVIEW_SPLITTER_WIDTH = 12;
const DEV_PREVIEW_GAP = 12;
const DEV_WORKSPACE_COMPOSER_GAP = 40;

let devPreviewWidth = null;

const devPreviewResizeState = {
  active: false,
  startX: 0,
  startWidth: 0,
  nativeWasVisible: false,
};

// DEV_WORKSPACE_CONSERVATIVE_V5_END

const DEV_PREVIEW_URL_STORAGE_KEY =
  "noonDevPreviewUrl";

const devPreviewState = {
  contextKey: null,
  syncSerial: 0,
  boundsTimer: null,

  native: {
    status: "CLOSED",
    url: null,
    title: null,
    loading: false,
    canGoBack: false,
    canGoForward: false,
    visible: false,
    error: null,
  },
};

devPreviewUrlInput.value =
  localStorage.getItem(
    DEV_PREVIEW_URL_STORAGE_KEY
  ) || "";

function devPreviewHorizontalInset() {
  return window.matchMedia(
    "(max-width: 1100px)"
  ).matches
    ? 12
    : 26;
}

function devPreviewAvailableWidth() {
  const rect =
    chatView.getBoundingClientRect();

  const inset =
    devPreviewHorizontalInset();

  return Math.max(
    640,
    rect.width -
      inset * 2
  );
}

function maxDevPreviewWidth() {
  return Math.max(
    DEV_PREVIEW_MIN_WIDTH,
    devPreviewAvailableWidth() -
      DEV_LEFT_MIN_WIDTH -
      DEV_PREVIEW_SPLITTER_WIDTH -
      DEV_PREVIEW_GAP
  );
}

function defaultDevPreviewWidth() {
  return Math.round(
    devPreviewAvailableWidth() *
      0.52
  );
}

function clampDevPreviewWidth(value) {
  const numeric =
    Number(value);

  const candidate =
    Number.isFinite(numeric)
      ? numeric
      : defaultDevPreviewWidth();

  return Math.min(
    maxDevPreviewWidth(),
    Math.max(
      DEV_PREVIEW_MIN_WIDTH,
      Math.round(candidate)
    )
  );
}

function loadDevPreviewWidth() {
  return clampDevPreviewWidth(
    localStorage.getItem(
      DEV_PREVIEW_WIDTH_STORAGE_KEY
    ) ||
    defaultDevPreviewWidth()
  );
}

function applyDevPreviewWidth(
  width,
  persist = true
) {
  devPreviewWidth =
    clampDevPreviewWidth(
      width
    );

  chatView.style.setProperty(
    "--dev-preview-width",
    `${devPreviewWidth}px`
  );

  devPreviewResizeHandle
    .setAttribute(
      "aria-valuemin",
      String(
        DEV_PREVIEW_MIN_WIDTH
      )
    );

  devPreviewResizeHandle
    .setAttribute(
      "aria-valuemax",
      String(
        maxDevPreviewWidth()
      )
    );

  devPreviewResizeHandle
    .setAttribute(
      "aria-valuenow",
      String(
        devPreviewWidth
      )
    );

  if (persist) {
    localStorage.setItem(
      DEV_PREVIEW_WIDTH_STORAGE_KEY,
      String(devPreviewWidth)
    );
  }

  scheduleDevPreviewBounds();

  return devPreviewWidth;
}

function devPreviewApiAvailable() {
  return Boolean(
    window.noon?.devPreviewOpen &&
    window.noon?.devPreviewClose &&
    window.noon?.devPreviewSetBounds
  );
}

function currentDevPreviewContextKey() {
  if (
    currentMode !== "DEV" ||
    !currentFocusId ||
    !currentFocusPath
  ) {
    return null;
  }

  return `${currentFocusId}:${currentFocusPath}`;
}

function syncDevPreviewResizeHandle() {
  const enabled =
    currentMode === "DEV" &&
    Boolean(
      currentFocusId &&
      currentFocusPath
    ) &&
    !devPreviewPanel.hidden;

  devPreviewResizeHandle.hidden =
    !enabled;

  devPreviewResizeHandle
    .setAttribute(
      "aria-hidden",
      enabled
        ? "false"
        : "true"
    );
}

function devPreviewIsOpen() {
  const state =
    devPreviewState.native;

  return (
    state.status !== "CLOSED" &&
    (
      Boolean(state.url) ||
      state.status === "LOADING" ||
      state.status === "READY" ||
      state.status === "ERROR"
    )
  );
}

function setDevPreviewStatus(
  message,
  state = "idle"
) {
  devPreviewStatus.textContent =
    String(message || "");

  devPreviewStatus.dataset.state =
    state;
}

function renderDevPreviewState() {
  const state =
    devPreviewState.native;

  const open =
    devPreviewIsOpen();

  devPreviewBackButton.disabled =
    !open ||
    !state.canGoBack;

  devPreviewForwardButton.disabled =
    !open ||
    !state.canGoForward;

  devPreviewReloadButton.disabled =
    !open;

  devPreviewExternalButton.disabled =
    !state.url;

  devPreviewCloseButton.disabled =
    !open;

  if (
    state.url &&
    document.activeElement !==
      devPreviewUrlInput
  ) {
    devPreviewUrlInput.value =
      state.url;

    localStorage.setItem(
      DEV_PREVIEW_URL_STORAGE_KEY,
      state.url
    );
  }

  devPreviewViewport.dataset.state =
    state.status ||
    "CLOSED";

  if (open) {
    devPreviewPlaceholder.hidden =
      true;
  } else {
    devPreviewPlaceholder.hidden =
      false;
  }

  if (
    state.status === "LOADING" ||
    state.loading
  ) {
    setDevPreviewStatus(
      "Chargement…",
      "running"
    );

    return;
  }

  if (
    state.status === "ERROR"
  ) {
    setDevPreviewStatus(
      state.error?.message ||
        "Preview indisponible",
      "error"
    );

    return;
  }

  if (
    state.status === "READY"
  ) {
    setDevPreviewStatus(
      "Preview actif",
      "ready"
    );

    return;
  }

  if (
    state.status === "IDLE"
  ) {
    setDevPreviewStatus(
      "Prêt",
      "ready"
    );

    return;
  }

  setDevPreviewStatus(
    "En attente",
    "idle"
  );
}

function applyDevPreviewState(state) {
  if (
    !state ||
    typeof state !== "object"
  ) {
    return;
  }

  devPreviewState.native = {
    ...devPreviewState.native,
    ...state,
  };

  renderDevPreviewState();

  if (devPreviewIsOpen()) {
    scheduleDevPreviewBounds();
  }
}

let devTerminalWorkspaceClampFrame =
  null;

function scheduleDevTerminalWorkspaceClamp() {
  if (
    devTerminalWorkspaceClampFrame !==
    null
  ) {
    return;
  }

  devTerminalWorkspaceClampFrame =
    window.requestAnimationFrame(
      () => {
        devTerminalWorkspaceClampFrame =
          null;

        setDevTerminalHeight(
          devTerminalState.height,
          false
        );
      }
    );
}

function syncDevWorkspaceBottomInset() {
  if (
    !devWorkspaceComposer ||
    !chatView
  ) {
    return;
  }

  const composerRect =
    devWorkspaceComposer
      .getBoundingClientRect();

  const chatRect =
    chatView
      .getBoundingClientRect();

  const inset =
    Math.max(
      104,
      Math.ceil(
        chatRect.bottom -
        composerRect.top +
        DEV_WORKSPACE_COMPOSER_GAP
      )
    );

  chatView.style.setProperty(
    "--dev-workspace-bottom",
    `${inset}px`
  );

  scheduleDevPreviewBounds();
  scheduleDevTerminalWorkspaceClamp();
}

function devPreviewBounds() {
  if (
    devPreviewPanel.hidden ||
    !devPreviewViewport
  ) {
    return null;
  }

  const rect =
    devPreviewViewport
      .getBoundingClientRect();

  const bounds = {
    x:
      Math.max(
        0,
        Math.round(rect.left)
      ),

    y:
      Math.max(
        0,
        Math.round(rect.top)
      ),

    width:
      Math.max(
        0,
        Math.round(rect.width)
      ),

    height:
      Math.max(
        0,
        Math.round(rect.height)
      ),
  };

  if (
    bounds.width < 120 ||
    bounds.height < 90
  ) {
    return null;
  }

  return bounds;
}

function scheduleDevPreviewBounds() {
  if (
    !devPreviewIsOpen() ||
    !devPreviewApiAvailable() ||
    devPreviewPanel.hidden ||
    !chatView.classList.contains(
      "active"
    ) ||
    chatView.classList.contains(
      "dev-terminal-maximized"
    )
  ) {
    return;
  }

  if (
    devPreviewState.boundsTimer !==
    null
  ) {
    return;
  }

  // Le registrar IPC est volontairement borné.
  // On plafonne donc le resize à ~8 appels/s.
  devPreviewState.boundsTimer =
    window.setTimeout(
      async () => {
        devPreviewState.boundsTimer =
          null;

        const bounds =
          devPreviewBounds();

        if (!bounds) {
          return;
        }

        try {
          await window.noon
            .devPreviewSetBounds(
              bounds
            );
        } catch (error) {
          setDevPreviewStatus(
            error.message,
            "error"
          );
        }
      },
      125
    );
}

async function syncDevPreviewNativeVisibility() {
  if (
    !devPreviewApiAvailable() ||
    !devPreviewIsOpen() ||
    !window.noon
      ?.devPreviewSetVisible
  ) {
    return;
  }

  const visible =
    chatView.classList.contains(
      "active"
    ) &&
    !devPreviewPanel.hidden &&
    !chatView.classList.contains(
      "dev-terminal-maximized"
    );

  try {
    const state =
      await window.noon
        .devPreviewSetVisible(
          visible
        );

    applyDevPreviewState(
      state
    );

    if (visible) {
      scheduleDevPreviewBounds();
    }
  } catch (error) {
    setDevPreviewStatus(
      error.message,
      "error"
    );
  }
}

async function closeDevPreview() {
  if (
    !devPreviewApiAvailable()
  ) {
    devPreviewState.native = {
      ...devPreviewState.native,
      status: "CLOSED",
      url: null,
      visible: false,
      loading: false,
      error: null,
    };

    renderDevPreviewState();
    return;
  }

  try {
    const state =
      await window.noon
        .devPreviewClose();

    applyDevPreviewState(
      state
    );
  } catch (error) {
    setDevPreviewStatus(
      error.message,
      "error"
    );
  }
}

async function syncDevPreviewPanel() {
  const serial =
    ++devPreviewState.syncSerial;

  const nextContextKey =
    currentDevPreviewContextKey();

  const contextChanged =
    Boolean(
      devPreviewState.contextKey &&
      devPreviewState.contextKey !==
        nextContextKey
    );

  if (
    !nextContextKey ||
    contextChanged
  ) {
    await closeDevPreview();

    if (
      serial !==
      devPreviewState.syncSerial
    ) {
      return;
    }
  }

  devPreviewState.contextKey =
    nextContextKey;

  const active =
    Boolean(nextContextKey);

  devPreviewPanel.hidden =
    !active;

  chatView.classList.toggle(
    "dev-preview-active",
    active
  );

  syncDevPreviewResizeHandle();

  if (!active) {
    return;
  }

  devPreviewProject.textContent =
    currentFocus ||
    "Projet DEV";

  if (
    !devPreviewApiAvailable()
  ) {
    setDevPreviewStatus(
      "Preview natif indisponible",
      "error"
    );

    devPreviewOpenButton.disabled =
      true;

    return;
  }

  devPreviewOpenButton.disabled =
    false;

  renderDevPreviewState();

  await syncDevPreviewNativeVisibility();
}

devPreviewForm.addEventListener(
  "submit",
  async (event) => {
    event.preventDefault();

    const url =
      devPreviewUrlInput.value.trim();

    if (!url) {
      setDevPreviewStatus(
        "Saisis une URL locale.",
        "error"
      );

      devPreviewUrlInput.focus();
      return;
    }

    if (
      !devPreviewApiAvailable()
    ) {
      setDevPreviewStatus(
        "Preview natif indisponible",
        "error"
      );

      return;
    }

    const bounds =
      devPreviewBounds();

    if (!bounds) {
      setDevPreviewStatus(
        "Zone Preview trop petite.",
        "error"
      );

      return;
    }

    devPreviewOpenButton.disabled =
      true;

    setDevPreviewStatus(
      "Ouverture…",
      "running"
    );

    try {
      localStorage.setItem(
        DEV_PREVIEW_URL_STORAGE_KEY,
        url
      );

      const state =
        await window.noon
          .devPreviewOpen({
            url,
            bounds,
          });

      applyDevPreviewState(
        state
      );

      scheduleDevPreviewBounds();
    } catch (error) {
      setDevPreviewStatus(
        error.message,
        "error"
      );
    } finally {
      devPreviewOpenButton.disabled =
        false;
    }
  }
);

devPreviewBackButton.addEventListener(
  "click",
  async () => {
    try {
      applyDevPreviewState(
        await window.noon
          .devPreviewBack()
      );
    } catch (error) {
      setDevPreviewStatus(
        error.message,
        "error"
      );
    }
  }
);

devPreviewForwardButton.addEventListener(
  "click",
  async () => {
    try {
      applyDevPreviewState(
        await window.noon
          .devPreviewForward()
      );
    } catch (error) {
      setDevPreviewStatus(
        error.message,
        "error"
      );
    }
  }
);

devPreviewReloadButton.addEventListener(
  "click",
  async () => {
    try {
      applyDevPreviewState(
        await window.noon
          .devPreviewReload()
      );
    } catch (error) {
      setDevPreviewStatus(
        error.message,
        "error"
      );
    }
  }
);

devPreviewCloseButton.addEventListener(
  "click",
  () => {
    void closeDevPreview();
  }
);

devPreviewExternalButton.addEventListener(
  "click",
  async () => {
    const url =
      devPreviewState.native.url ||
      devPreviewUrlInput.value.trim();

    if (
      !url ||
      !window.noon
        ?.devPreviewOpenExternal
    ) {
      return;
    }

    try {
      await window.noon
        .devPreviewOpenExternal(
          url
        );
    } catch (error) {
      setDevPreviewStatus(
        error.message,
        "error"
      );
    }
  }
);

devPreviewResizeHandle.addEventListener(
  "pointerdown",
  async (event) => {
    if (
      devPreviewResizeHandle.hidden ||
      chatView.classList.contains(
        "dev-terminal-maximized"
      )
    ) {
      return;
    }

    event.preventDefault();

    devPreviewResizeState.active =
      true;

    devPreviewResizeState.startX =
      event.clientX;

    devPreviewResizeState.startWidth =
      devPreviewWidth;

    devPreviewResizeState.nativeWasVisible =
      Boolean(
        devPreviewIsOpen() &&
        devPreviewState.native.visible
      );

    devPreviewResizeHandle
      .setPointerCapture?.(
        event.pointerId
      );

    document.body.classList.add(
      "dev-preview-resizing"
    );

    if (
      devPreviewResizeState
        .nativeWasVisible &&
      window.noon
        ?.devPreviewSetVisible
    ) {
      try {
        await window.noon
          .devPreviewSetVisible(
            false
          );
      } catch {
        // Le resize du chrome reste utilisable.
      }
    }
  }
);

window.addEventListener(
  "pointermove",
  (event) => {
    if (
      !devPreviewResizeState.active
    ) {
      return;
    }

    const delta =
      devPreviewResizeState.startX -
      event.clientX;

    applyDevPreviewWidth(
      devPreviewResizeState
        .startWidth +
        delta,
      false
    );
  }
);

async function finishDevPreviewResize() {
  if (
    !devPreviewResizeState.active
  ) {
    return;
  }

  devPreviewResizeState.active =
    false;

  document.body.classList.remove(
    "dev-preview-resizing"
  );

  applyDevPreviewWidth(
    devPreviewWidth,
    true
  );

  if (
    devPreviewResizeState
      .nativeWasVisible &&
    window.noon
      ?.devPreviewSetVisible
  ) {
    try {
      await window.noon
        .devPreviewSetVisible(
          true
        );

      scheduleDevPreviewBounds();
    } catch {
      // L'état Preview sera resynchronisé ensuite.
    }
  }

  devPreviewResizeState
    .nativeWasVisible = false;
}

window.addEventListener(
  "pointerup",
  () => {
    void finishDevPreviewResize();
  }
);

window.addEventListener(
  "pointercancel",
  () => {
    void finishDevPreviewResize();
  }
);

devPreviewResizeHandle.addEventListener(
  "keydown",
  (event) => {
    if (
      ![
        "ArrowLeft",
        "ArrowRight",
      ].includes(
        event.key
      ) ||
      devPreviewResizeHandle.hidden
    ) {
      return;
    }

    event.preventDefault();

    const step =
      event.shiftKey
        ? 80
        : 30;

    applyDevPreviewWidth(
      devPreviewWidth +
        (
          event.key ===
          "ArrowLeft"
            ? step
            : -step
        )
    );
  }
);

window.noon
  ?.onDevPreviewState?.(
    (state) => {
      if (
        !devPreviewState.contextKey
      ) {
        return;
      }

      applyDevPreviewState(
        state
      );
    }
  );

window.addEventListener(
  "resize",
  () => {
    syncDevWorkspaceBottomInset();

    applyDevPreviewWidth(
      devPreviewWidth,
      false
    );

    setDevTerminalHeight(
      devTerminalState.height,
      false
    );

    scheduleDevPreviewBounds();
  }
);

if (
  typeof ResizeObserver ===
  "function" &&
  devWorkspaceComposer
) {
  const composerObserver =
    new ResizeObserver(
      () => {
        syncDevWorkspaceBottomInset();
      }
    );

  composerObserver.observe(
    devWorkspaceComposer
  );
}

if (
  typeof ResizeObserver ===
  "function"
) {
  const observer =
    new ResizeObserver(
      () => {
        scheduleDevPreviewBounds();
      }
    );

  observer.observe(
    devPreviewViewport
  );
}

const devPreviewLayoutObserver =
  new MutationObserver(
    () => {
      void syncDevPreviewNativeVisibility();
      scheduleDevPreviewBounds();
    }
  );

devPreviewLayoutObserver.observe(
  chatView,
  {
    attributes: true,
    attributeFilter: [
      "class",
    ],
  }
);

window.addEventListener(
  "noon-context-change",
  () => {
    syncDevWorkspaceBottomInset();
    void syncDevPreviewPanel();
  }
);

window.addEventListener(
  "pagehide",
  () => {
    void window.noon
      ?.devPreviewClose?.();
  }
);

devPreviewWidth =
  loadDevPreviewWidth();

applyDevPreviewWidth(
  devPreviewWidth,
  false
);

syncDevWorkspaceBottomInset();
syncDevPreviewResizeHandle();

// DEV_PREVIEW_UI_END

// DEV_TERMINAL_UI_START
// Le renderer n'exécute aucune commande directement.
// Toutes les opérations passent par l'API locale sécurisée,
// qui force elle-même owner/origin à USER.

// DEV_TERMINAL_V2_START
const DEV_TERMINAL_HEIGHT_STORAGE_KEY =
  "noonDevTerminalHeight";

const DEV_TERMINAL_HISTORY_STORAGE_KEY =
  "noonDevTerminalHistory";

const DEV_TERMINAL_MIN_HEIGHT = 220;
const DEV_TERMINAL_MAX_HISTORY = 100;

function defaultDevTerminalHeight() {
  return window.matchMedia(
    "(max-width: 720px)"
  ).matches
    ? 285
    : 330;
}

function maxDevTerminalHeight() {
  const composerRect =
    devWorkspaceComposer
      ?.getBoundingClientRect?.();

  const headerRect =
    devWorkspaceChatHeader
      ?.getBoundingClientRect?.();

  if (
    composerRect &&
    headerRect &&
    Number.isFinite(
      composerRect.top
    ) &&
    Number.isFinite(
      headerRect.bottom
    )
  ) {
    const available =
      Math.floor(
        composerRect.top -
        DEV_WORKSPACE_COMPOSER_GAP -
        headerRect.bottom -
        14
      );

    return Math.max(
      DEV_TERMINAL_MIN_HEIGHT,
      available
    );
  }

  return Math.max(
    DEV_TERMINAL_MIN_HEIGHT,
    window.innerHeight - 175
  );
}

function clampDevTerminalHeight(value) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return defaultDevTerminalHeight();
  }

  return Math.min(
    maxDevTerminalHeight(),
    Math.max(
      DEV_TERMINAL_MIN_HEIGHT,
      Math.round(numeric)
    )
  );
}

function loadDevTerminalHeight() {
  return clampDevTerminalHeight(
    localStorage.getItem(
      DEV_TERMINAL_HEIGHT_STORAGE_KEY
    ) ||
    defaultDevTerminalHeight()
  );
}

function loadDevTerminalHistory() {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(
        DEV_TERMINAL_HISTORY_STORAGE_KEY
      ) || "[]"
    );

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter(
        (command) =>
          typeof command === "string" &&
          command.trim()
      )
      .slice(
        -DEV_TERMINAL_MAX_HISTORY
      );
  } catch {
    return [];
  }
}
// DEV_TERMINAL_V2_END

const DEV_TERMINAL_LAYOUT_STORAGE_PREFIX =
  "noon-dev-terminal-layout:";

const DEV_TERMINAL_RESTORE_MAX = 9;

function devTerminalLayoutStorageKey(
  contextKey
) {
  if (!contextKey) {
    return null;
  }

  return (
    DEV_TERMINAL_LAYOUT_STORAGE_PREFIX +
    contextKey
  );
}

function getUserDevTerminals() {
  return [
    ...devTerminalState.terminals.values(),
  ].filter((terminal) =>
    /^USER \d+$/.test(
      String(terminal?.title || "")
    )
  );
}

function persistDevTerminalLayout() {
  const contextKey =
    devTerminalState.contextKey;

  const key =
    devTerminalLayoutStorageKey(
      contextKey
    );

  if (!key) {
    return;
  }

  const userTerminals =
    getUserDevTerminals();

  if (!userTerminals.length) {
    localStorage.removeItem(key);
    return;
  }

  const foundActiveIndex =
    userTerminals.findIndex(
      (terminal) =>
        terminal.id ===
        devTerminalState.activeTerminalId
    );

  const activeIndex =
    foundActiveIndex >= 0
      ? foundActiveIndex
      : 0;

  try {
    localStorage.setItem(
      key,
      JSON.stringify({
        userCount: Math.min(
          userTerminals.length,
          DEV_TERMINAL_RESTORE_MAX
        ),
        activeIndex: Math.min(
          activeIndex,
          DEV_TERMINAL_RESTORE_MAX - 1
        ),
      })
    );
  } catch {
    // Persistance uniquement ergonomique.
  }
}

function loadDevTerminalLayout(
  contextKey
) {
  const key =
    devTerminalLayoutStorageKey(
      contextKey
    );

  if (!key) {
    return {
      userCount: 1,
      activeIndex: 0,
    };
  }

  try {
    const parsed =
      JSON.parse(
        localStorage.getItem(key) ||
        "{}"
      );

    const userCount =
      Math.max(
        1,
        Math.min(
          DEV_TERMINAL_RESTORE_MAX,
          Number(parsed.userCount) || 1
        )
      );

    const activeIndex =
      Math.max(
        0,
        Math.min(
          userCount - 1,
          Number(parsed.activeIndex) || 0
        )
      );

    return {
      userCount,
      activeIndex,
    };
  } catch {
    return {
      userCount: 1,
      activeIndex: 0,
    };
  }
}

const devTerminalState = {
  session: null,
  problems: null,
  terminals: new Map(),
  outputByTerminal: new Map(),
  offsetByTerminal: new Map(),
  scrollByTerminal: new Map(),
  followOutputByTerminal: new Map(),
  pendingOutputByTerminal: new Map(),
  activeTerminalId: null,
  contextKey: null,
  lastAuthorizedValidationCommand: null,
  lastAuthorizedValidationSessionId: null,
  lastAuthorizedValidationContextKey: null,
  pollTimer: null,
  problemsRefreshPending: false,
  syncSerial: 0,
  collapsed: false,
  maximized: false,
  height: loadDevTerminalHeight(),
  history: loadDevTerminalHistory(),
  historyIndex: null,
  historyDraft: "",
  completionItems: [],
  completionIndex: -1,
  completionQuery: "",
  resizing: false,
  resizeStartY: 0,
  resizeStartHeight: 0,
};

let uiValidationMode = window.noon?.uiValidationMode === true;
let uiValidationProjects = [];
const uiValidationBlockedMessage = "Validation UI isolée : le terminal, l’agent, les commandes et Source Control sont désactivés. Seules les règles des projets synthétiques sont disponibles.";

function uiValidationContext() {
  const selected = uiValidationProjects.find((project) => project.workspaceId === devUiValidationProject?.value);
  return selected ? { workspaceId: selected.workspaceId, contextKey: `ui-validation:${selected.workspaceId}`, projectName: selected.name } : null;
}

function renderUiValidationProjects() {
  if (!devUiValidationProject || !devUiValidationProjectLabel) return;
  devUiValidationProject.replaceChildren();
  for (const project of uiValidationProjects) {
    const option = document.createElement("option"); option.value = project.workspaceId; option.textContent = project.name; devUiValidationProject.append(option);
  }
  devUiValidationProjectLabel.hidden = !uiValidationMode || !uiValidationProjects.length;
}

const devProjectRulesUi = window.NoonDevProjectRulesUi?.mountDevProjectRulesUi({
  elements: { toggle: devProjectRulesToggle, panel: devProjectRulesPanel, project: devProjectRulesProject, add: devProjectRulesAdd, readOnly: devProjectRulesReadOnly, list: devProjectRulesList, form: devProjectRulesForm, input: devProjectRulesInput, preview: devProjectRulesPreview, save: devProjectRulesSave, cancel: devProjectRulesCancel, status: devProjectRulesStatus },
  bridge: window.noon,
  getContext: () => uiValidationMode ? uiValidationContext() : ({ workspaceId: devTerminalState.session?.workspaceId || null, contextKey: devTerminalState.contextKey, projectName: devTerminalState.session?.projectName || currentFocus || "Projet DEV" }),
  getUnavailableReason: () => uiValidationMode && !uiValidationContext() ? "Validation UI isolée : aucun projet synthétique autorisé n’est disponible." : null,
});

if (!devProjectRulesUi && devProjectRulesToggle && devProjectRulesPanel && devProjectRulesStatus) {
  devProjectRulesToggle.addEventListener("click", () => {
    devProjectRulesPanel.hidden = false;
    devProjectRulesToggle.setAttribute("aria-expanded", "true");
    devProjectRulesStatus.textContent = "Le module des règles DEV n’a pas pu être chargé. Recharge l’application isolée.";
    devProjectRulesStatus.dataset.state = "error";
  });
}


const devTerminalProfileUi = window.NoonDevTerminalProfileUi?.createDevTerminalProfileController({
  elements: {
    label: devTerminalExecutionProfileLabel,
    select: devTerminalExecutionProfile,
    status: devTerminalExecutionProfileStatus,
  },
  bridge: window.noon,
  getContext: () => uiValidationMode
    ? uiValidationContext()
    : ({
        workspaceId: devTerminalState.session?.workspaceId || null,
        contextKey: devTerminalState.contextKey,
        projectName: devTerminalState.session?.projectName || currentFocus || "Projet DEV",
      }),
});

void window.noon?.getStatus?.().then((status) => {
  uiValidationMode = status?.uiValidationMode === true;
  uiValidationProjects = Array.isArray(status?.uiValidationProjects) ? status.uiValidationProjects.filter((project) => typeof project?.workspaceId === "string" && typeof project?.name === "string") : [];
  renderUiValidationProjects();
  if (uiValidationMode && currentMode === "DEV") void syncDevTerminalPanel();
}).catch(() => {});

devUiValidationProject?.addEventListener("change", () => {
  if (uiValidationMode && !devProjectRulesPanel.hidden) void devProjectRulesUi?.refresh();
  if (uiValidationMode) void devTerminalProfileUi?.refresh();
});

// DEV_PROBLEMS_UI_START

const DEV_PROBLEMS_STATUSES =
  new Set([
    "EMPTY",
    "RUNNING",
    "READY",
    "CANCELLED",
    "UNRESOLVED",
  ]);

const DEV_PROBLEM_SEVERITIES =
  new Set([
    "error",
    "warning",
    "info",
  ]);

function emptyDevProblems() {
  return {
    status: "EMPTY",
    counts: {
      total: 0,
      error: 0,
      warning: 0,
      info: 0,
    },
    truncated: false,
    problems: [],
  };
}

function positiveDevProblemInteger(value) {
  const number = Number(value);

  return Number.isSafeInteger(number) &&
    number > 0
    ? number
    : null;
}

function safeDevProblemFile(value) {
  const file =
    String(value || "")
      .trim()
      .replace(/\\/g, "/");

  if (
    !file ||
    file.startsWith("/") ||
    /^[A-Za-z]:\//.test(file) ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(
      file
    ) ||
    file.split("/").includes("..")
  ) {
    return null;
  }

  return file;
}

function clearDevProblemsPanel() {
  devTerminalState.problems =
    emptyDevProblems();
  devTerminalState.problemsRefreshPending =
    false;

  devProblemsPanel.hidden = true;
  devProblemsTotal.textContent = "0";
  devProblemsErrors.textContent =
    "0 erreur";
  devProblemsWarnings.textContent =
    "0 warning";
  devProblemsInfos.textContent =
    "0 info";
  devProblemsState.textContent =
    "Aucun problème détecté";
  devProblemsState.dataset.state =
    "EMPTY";
  devProblemsList.replaceChildren();
  devProblemsTruncated.hidden = true;
  devProblemsTruncated.textContent = "";
}

function devProblemsPanelIsAllowed() {
  if (
    currentMode !== "DEV" ||
    !currentFocusId ||
    !currentFocusPath ||
    !devTerminalState.session ||
    !devTerminalState.contextKey
  ) {
    return false;
  }

  return (
    devTerminalState.contextKey ===
    `${currentFocusId}:${currentFocusPath}`
  );
}

function renderDevProblems(problems) {
  if (!devProblemsPanelIsAllowed()) {
    clearDevProblemsPanel();
    return;
  }

  const value =
    problems &&
    typeof problems === "object"
      ? problems
      : emptyDevProblems();

  const status =
    DEV_PROBLEMS_STATUSES.has(
      value.status
    )
      ? value.status
      : "UNRESOLVED";

  const diagnostics =
    status === "READY" &&
    Array.isArray(value.problems)
      ? value.problems
          .slice(0, 200)
          .map((problem) => {
            const file =
              safeDevProblemFile(
                problem?.file
              );

            const line =
              positiveDevProblemInteger(
                problem?.line
              );

            if (!file || !line) {
              return null;
            }

            const severity =
              DEV_PROBLEM_SEVERITIES.has(
                problem?.severity
              )
                ? problem.severity
                : "error";

            return {
              problem,
              file,
              line,
              column:
                positiveDevProblemInteger(
                  problem?.column
                ) || 1,
              severity,
            };
          })
          .filter(Boolean)
      : [];

  const severityCount = (severity) =>
    diagnostics.filter(
      (diagnostic) =>
        diagnostic.severity === severity
    ).length;

  const total = diagnostics.length;
  const errors = severityCount("error");
  const warnings = severityCount("warning");
  const infos = severityCount("info");

  devTerminalState.problems = value;
  devTerminalState.problemsRefreshPending =
    status === "RUNNING";
  devProblemsPanel.hidden = false;
  devProblemsPanel.dataset.state = status;
  devProblemsTotal.textContent =
    String(total);
  devProblemsErrors.textContent =
    `${errors} erreur${
      errors === 1 ? "" : "s"
    }`;
  devProblemsWarnings.textContent =
    `${warnings} warning${
      warnings === 1 ? "" : "s"
    }`;
  devProblemsInfos.textContent =
    `${infos} info${
      infos === 1 ? "" : "s"
    }`;

  const stateMessages = {
    RUNNING: "Validation en cours",
    EMPTY: "Aucun problème détecté",
    READY: total
      ? "Diagnostics de validation"
      : "Aucun problème détecté",
    CANCELLED:
      "Validation arrêtée par l’utilisateur",
    UNRESOLVED:
      "Validation échouée sans diagnostic localisable",
  };

  devProblemsState.textContent =
    stateMessages[status];
  devProblemsState.dataset.state = status;

  const fragment =
    document.createDocumentFragment();

  let displayed = 0;

  if (status === "READY") {
    for (const diagnostic of diagnostics) {
      const {
        problem,
        file,
        line,
        column,
        severity,
      } = diagnostic;

      const item =
        document.createElement("article");

      item.className =
        `dev-problem dev-problem--${severity}`;
      item.setAttribute(
        "role",
        "listitem"
      );

      const severityLabel =
        document.createElement("span");
      severityLabel.className =
        "dev-problem-severity";
      severityLabel.textContent =
        severity.toUpperCase();

      const location =
        document.createElement("span");
      location.className =
        "dev-problem-location";
      location.textContent =
        `${file}:${line}:${column}`;

      const message =
        document.createElement("span");
      message.className =
        "dev-problem-message";
      message.textContent =
        String(
          problem?.message ||
          "Erreur de validation."
        ).slice(0, 600);

      const meta =
        document.createElement("span");
      meta.className =
        "dev-problem-meta";

      const source =
        String(problem?.source || "")
          .slice(0, 40);

      const code =
        String(problem?.code || "")
          .slice(0, 100);

      meta.textContent =
        [code, source]
          .filter(Boolean)
          .join(" · ");

      item.append(
        severityLabel,
        location,
        message
      );

      if (meta.textContent) {
        item.append(meta);
      }

      fragment.append(item);
      displayed += 1;
    }
  }

  devProblemsList.replaceChildren(
    fragment
  );

  devProblemsTruncated.hidden =
    value.truncated !== true;

  devProblemsTruncated.textContent =
    value.truncated === true
      ? `Liste tronquée · ${displayed} résultat${
          displayed === 1 ? "" : "s"
        } affiché${
          displayed === 1 ? "" : "s"
        }`
      : "";
}

async function refreshDevProblems() {
  const sessionId =
    devTerminalState.session?.id ||
    null;

  const contextKey =
    devTerminalState.contextKey;

  const syncSerial =
    devTerminalState.syncSerial;

  if (
    !sessionId ||
    !contextKey ||
    !devProblemsPanelIsAllowed()
  ) {
    clearDevProblemsPanel();
    return;
  }

  try {
    const data =
      await devTerminalRequest(
        `/api/dev/workspace-terminal/sessions/${
          encodeURIComponent(sessionId)
        }`
      );

    if (
      currentMode !== "DEV" ||
      !currentFocusId ||
      !currentFocusPath ||
      syncSerial !==
        devTerminalState.syncSerial ||
      contextKey !==
        devTerminalState.contextKey ||
      contextKey !==
        `${currentFocusId}:${currentFocusPath}` ||
      sessionId !==
        devTerminalState.session?.id ||
      data.session?.id !== sessionId
    ) {
      return;
    }

    renderDevProblems(
      data.session.problems
    );
  } catch (error) {
    if (
      currentMode !== "DEV" ||
      !currentFocusId ||
      !currentFocusPath ||
      syncSerial !==
        devTerminalState.syncSerial ||
      contextKey !==
        devTerminalState.contextKey ||
      contextKey !==
        `${currentFocusId}:${currentFocusPath}` ||
      sessionId !==
        devTerminalState.session?.id
    ) {
      return;
    }

    if (
      error.code ===
      "DEV_WORKSPACE_NOT_FOUND"
    ) {
      clearDevProblemsPanel();
    }
  }
}

function shouldRefreshDevProblems() {
  return (
    devTerminalState
      .problemsRefreshPending === true ||
    devTerminalState.problems?.status ===
      "RUNNING"
  );
}

// DEV_PROBLEMS_UI_END


// DEV_SOURCE_CONTROL_UI_START

const DEV_SOURCE_CONTROL_SCOPES =
  new Set([
    "WORKTREE",
    "STAGED",
  ]);

const devSourceControlView = {
  open: false,
  inventory: null,
  selectedFile: null,
  scope: "WORKTREE",
  refreshSerial: 0,
  patchSerial: 0,
};

function emptyDevSourceControl() {
  return {
    status: "EMPTY",
    branch: null,
    detached: false,
    counts: {
      total: 0,
      staged: 0,
      unstaged: 0,
      untracked: 0,
      conflicted: 0,
    },
    truncated: false,
    unsafeOmitted: 0,
    files: [],
  };
}

function safeDevSourceControlFile(value) {
  const file =
    String(value ?? "");

  if (
    !file ||
    file.includes("\0") ||
    file.includes("\n") ||
    file.includes("\r") ||
    file.startsWith("/") ||
    file.includes("\\") ||
    /^[A-Za-z]:\//.test(file) ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(
      file
    ) ||
    file.split("/").includes("..")
  ) {
    return null;
  }

  return file;
}

function devSourceControlIsAllowed() {
  return (
    currentMode === "DEV" &&
    Boolean(currentFocusId) &&
    Boolean(currentFocusPath) &&
    Boolean(
      devTerminalState.session?.id
    ) &&
    Boolean(
      devTerminalState.contextKey
    ) &&
    devTerminalState.contextKey ===
      `${currentFocusId}:${currentFocusPath}`
  );
}

function setDevSourceControlState(
  message,
  state = "idle"
) {
  devSourceControlState.textContent =
    message;

  devSourceControlState.dataset.state =
    state;
}

function sourceControlEntry(file) {
  const inventory =
    devSourceControlView.inventory;

  if (
    !inventory ||
    !Array.isArray(inventory.files)
  ) {
    return null;
  }

  return (
    inventory.files.find(
      (entry) =>
        entry.file === file
    ) || null
  );
}

function defaultSourceControlScope(entry) {
  if (
    entry?.unstaged ||
    entry?.untracked
  ) {
    return "WORKTREE";
  }

  if (entry?.staged) {
    return "STAGED";
  }

  return "WORKTREE";
}

function sourceControlScopeAvailable(
  entry,
  scope
) {
  if (!entry) return false;

  if (scope === "STAGED") {
    return entry.staged === true;
  }

  return (
    entry.unstaged === true ||
    entry.untracked === true
  );
}

function syncDevSourceControlScopes() {
  const entry =
    sourceControlEntry(
      devSourceControlView.selectedFile
    );

  if (
    !sourceControlScopeAvailable(
      entry,
      devSourceControlView.scope
    )
  ) {
    devSourceControlView.scope =
      defaultSourceControlScope(entry);
  }

  for (const [
    button,
    scope,
  ] of [
    [
      devSourceControlWorktree,
      "WORKTREE",
    ],
    [
      devSourceControlStagedScope,
      "STAGED",
    ],
  ]) {
    button.disabled =
      !sourceControlScopeAvailable(
        entry,
        scope
      );

    button.setAttribute(
      "aria-pressed",
      String(
        devSourceControlView.scope ===
          scope
      )
    );
  }
}

function clearDevSourceControl({
  close = false,
} = {}) {
  devSourceControlView.refreshSerial += 1;
  devSourceControlView.patchSerial += 1;
  devSourceControlView.inventory =
    emptyDevSourceControl();
  devSourceControlView.selectedFile =
    null;
  devSourceControlView.scope =
    "WORKTREE";

  devSourceControlBranch.textContent =
    "—";
  devSourceControlTotal.textContent =
    "0 fichier";
  devSourceControlStaged.textContent =
    "0 staged";
  devSourceControlUnstaged.textContent =
    "0 modifié";
  devSourceControlUntracked.textContent =
    "0 untracked";
  devSourceControlConflicted.textContent =
    "0 conflit";

  devSourceControlFiles.replaceChildren();

  devSourceControlSelected.textContent =
    "Aucun fichier";

  devSourceControlPatch.textContent =
    "Sélectionne un fichier.";

  devSourceControlTruncated.hidden = true;
  devSourceControlTruncated.textContent =
    "";

  setDevSourceControlState(
    "Source Control prêt"
  );

  syncDevSourceControlScopes();

  if (close) {
    devSourceControlView.open =
      false;

    devSourceControlPanel.hidden =
      true;

    devTerminalPanel.classList.remove(
      "is-source-control"
    );

    devSourceControlToggle.setAttribute(
      "aria-pressed",
      "false"
    );

    devSourceControlToggle.title =
      "Source Control";

    devSourceControlToggle.setAttribute(
      "aria-label",
      "Afficher Source Control"
    );
  }
}

function renderDevSourceControlFiles() {
  const inventory =
    devSourceControlView.inventory ||
    emptyDevSourceControl();

  const files =
    Array.isArray(inventory.files)
      ? inventory.files
      : [];

  const fragment =
    document.createDocumentFragment();

  for (const entry of files) {
    const file =
      safeDevSourceControlFile(
        entry?.file
      );

    if (!file) continue;

    const button =
      document.createElement("button");

    button.type = "button";
    button.className =
      "dev-source-control-file";

    button.dataset.active =
      String(
        file ===
          devSourceControlView
            .selectedFile
      );

    const name =
      document.createElement("span");

    name.className =
      "dev-source-control-file-name";

    name.textContent =
      entry.originalFile &&
      entry.originalFile !== file
        ? `${entry.originalFile} → ${file}`
        : file;

    const badge =
      document.createElement("span");

    badge.className =
      "dev-source-control-file-status";

    badge.textContent =
      entry.conflicted
        ? "CONFLICT"
        : entry.untracked
          ? "U"
          : `${
              entry.staged
                ? "S"
                : ""
            }${
              entry.unstaged
                ? "M"
                : ""
            }` || "M";

    if (entry.sensitive) {
      badge.textContent += " · PRIVATE";
    }

    button.append(
      name,
      badge
    );

    button.addEventListener(
      "click",
      () => {
        devSourceControlView
          .selectedFile = file;

        devSourceControlView.scope =
          defaultSourceControlScope(
            entry
          );

        renderDevSourceControlFiles();
        syncDevSourceControlScopes();

        void loadDevSourceControlPatch();
      }
    );

    fragment.append(button);
  }

  devSourceControlFiles.replaceChildren(
    fragment
  );
}

function renderDevSourceControlInventory(
  value
) {
  if (
    !devSourceControlView.open ||
    !devSourceControlIsAllowed()
  ) {
    return;
  }

  const inventory =
    value &&
    typeof value === "object"
      ? value
      : emptyDevSourceControl();

  const files =
    Array.isArray(inventory.files)
      ? inventory.files
          .slice(0, 250)
          .filter(
            (entry) =>
              safeDevSourceControlFile(
                entry?.file
              )
          )
      : [];

  devSourceControlView.inventory = {
    ...inventory,
    files,
  };

  const counts =
    inventory.counts || {};

  const total =
    Math.max(
      0,
      Number(counts.total) || 0
    );

  const staged =
    Math.max(
      0,
      Number(counts.staged) || 0
    );

  const unstaged =
    Math.max(
      0,
      Number(counts.unstaged) || 0
    );

  const untracked =
    Math.max(
      0,
      Number(counts.untracked) || 0
    );

  const conflicted =
    Math.max(
      0,
      Number(counts.conflicted) || 0
    );

  devSourceControlBranch.textContent =
    inventory.branch
      ? `${
          inventory.detached
            ? "detached · "
            : ""
        }${inventory.branch}`
      : "Git";

  devSourceControlTotal.textContent =
    `${total} fichier${
      total === 1 ? "" : "s"
    }`;

  devSourceControlStaged.textContent =
    `${staged} staged`;

  devSourceControlUnstaged.textContent =
    `${unstaged} modifié${
      unstaged === 1 ? "" : "s"
    }`;

  devSourceControlUntracked.textContent =
    `${untracked} untracked`;

  devSourceControlConflicted.textContent =
    `${conflicted} conflit${
      conflicted === 1 ? "" : "s"
    }`;

  const unsafeOmitted =
    Math.max(
      0,
      Number(
        inventory.unsafeOmitted
      ) || 0
    );

  const notices = [];

  if (inventory.truncated === true) {
    notices.push(
      "Liste tronquée à 250 fichiers"
    );
  }

  if (unsafeOmitted > 0) {
    notices.push(
      `${unsafeOmitted} entrée${
        unsafeOmitted === 1 ? "" : "s"
      } masquée${
        unsafeOmitted === 1 ? "" : "s"
      } pour sécurité`
    );
  }

  devSourceControlTruncated.hidden =
    notices.length === 0;

  devSourceControlTruncated.textContent =
    notices.join(" · ");

  const selectedStillExists =
    files.some(
      (entry) =>
        entry.file ===
        devSourceControlView
          .selectedFile
    );

  if (!selectedStillExists) {
    devSourceControlView.selectedFile =
      files[0]?.file || null;

    devSourceControlView.scope =
      defaultSourceControlScope(
        files[0]
      );
  }

  renderDevSourceControlFiles();
  syncDevSourceControlScopes();

  if (!files.length) {
    devSourceControlSelected.textContent =
      "Aucun fichier";

    devSourceControlPatch.textContent =
      "Aucune modification Git.";

    setDevSourceControlState(
      "Working tree propre",
      "ready"
    );
  }
}

function renderDevSourceControlPatch(
  diff
) {
  const entry =
    sourceControlEntry(
      devSourceControlView.selectedFile
    );

  if (!entry) {
    devSourceControlSelected.textContent =
      "Aucun fichier";

    devSourceControlPatch.textContent =
      "Aucune modification Git.";

    return;
  }

  devSourceControlSelected.textContent =
    entry.originalFile &&
    entry.originalFile !== entry.file
      ? `${entry.originalFile} → ${entry.file}`
      : entry.file;

  const status =
    String(
      diff?.status || "EMPTY"
    );

  if (status === "REDACTED") {
    devSourceControlPatch.textContent =
      "Contenu masqué : fichier sensible.";

    setDevSourceControlState(
      "Diff masqué pour protéger les données privées",
      "ready"
    );

    return;
  }

  if (status === "UNTRACKED") {
    devSourceControlPatch.textContent =
      "Fichier non suivi.\n\nSon contenu n’est pas lu automatiquement.";

    setDevSourceControlState(
      "Fichier untracked · contenu non chargé",
      "ready"
    );

    return;
  }

  if (status === "EMPTY") {
    devSourceControlPatch.textContent =
      "Aucune différence pour ce scope.";

    setDevSourceControlState(
      `${devSourceControlView.scope} · aucune différence`,
      "ready"
    );

    return;
  }

  const patch =
    typeof diff?.patch === "string"
      ? diff.patch
      : "";

  if (diff?.binary === true && !patch) {
    devSourceControlPatch.textContent =
      "Fichier binaire modifié.";
  } else {
    devSourceControlPatch.textContent =
      patch ||
      "Aucune différence.";
  }

  const additions =
    Number.isFinite(
      Number(diff?.additions)
    )
      ? Number(diff.additions)
      : null;

  const deletions =
    Number.isFinite(
      Number(diff?.deletions)
    )
      ? Number(diff.deletions)
      : null;

  const stats = [
    devSourceControlView.scope,
    additions === null
      ? null
      : `+${additions}`,
    deletions === null
      ? null
      : `-${deletions}`,
    diff?.binary
      ? "binaire"
      : null,
    diff?.truncated
      ? "patch tronqué"
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  setDevSourceControlState(
    stats || "Diff prêt",
    "ready"
  );
}

function devSourceControlContextValid({
  sessionId,
  contextKey,
  syncSerial,
} = {}) {
  return (
    devSourceControlView.open === true &&
    currentMode === "DEV" &&
    Boolean(currentFocusId) &&
    Boolean(currentFocusPath) &&
    syncSerial ===
      devTerminalState.syncSerial &&
    contextKey ===
      devTerminalState.contextKey &&
    contextKey ===
      `${currentFocusId}:${currentFocusPath}` &&
    sessionId ===
      devTerminalState.session?.id
  );
}

async function loadDevSourceControlPatch() {
  const file =
    safeDevSourceControlFile(
      devSourceControlView.selectedFile
    );

  const scope =
    DEV_SOURCE_CONTROL_SCOPES.has(
      devSourceControlView.scope
    )
      ? devSourceControlView.scope
      : "WORKTREE";

  const sessionId =
    devTerminalState.session?.id ||
    null;

  const contextKey =
    devTerminalState.contextKey;

  const syncSerial =
    devTerminalState.syncSerial;

  const patchSerial =
    ++devSourceControlView.patchSerial;

  if (
    !file ||
    !sessionId ||
    !contextKey ||
    !devSourceControlIsAllowed()
  ) {
    return;
  }

  setDevSourceControlState(
    "Chargement du diff…",
    "running"
  );

  try {
    const data =
      await devTerminalRequest(
        `/api/dev/workspace-terminal/sessions/${
          encodeURIComponent(sessionId)
        }/git-diff/file?file=${
          encodeURIComponent(file)
        }&scope=${
          encodeURIComponent(scope)
        }`
      );

    if (
      patchSerial !==
        devSourceControlView.patchSerial ||
      !devSourceControlContextValid({
        sessionId,
        contextKey,
        syncSerial,
      }) ||
      file !==
        devSourceControlView.selectedFile ||
      scope !==
        devSourceControlView.scope
    ) {
      return;
    }

    renderDevSourceControlPatch(
      data.diff
    );
  } catch (error) {
    if (
      patchSerial !==
        devSourceControlView.patchSerial ||
      !devSourceControlContextValid({
        sessionId,
        contextKey,
        syncSerial,
      })
    ) {
      return;
    }

    devSourceControlPatch.textContent =
      "Impossible de charger ce diff.";

    setDevSourceControlState(
      error.message,
      "error"
    );
  }
}

async function refreshDevSourceControl() {
  const sessionId =
    devTerminalState.session?.id ||
    null;

  const contextKey =
    devTerminalState.contextKey;

  const syncSerial =
    devTerminalState.syncSerial;

  const refreshSerial =
    ++devSourceControlView.refreshSerial;

  devSourceControlView.patchSerial += 1;

  if (
    !sessionId ||
    !contextKey ||
    !devSourceControlIsAllowed()
  ) {
    clearDevSourceControl({
      close: true,
    });

    return;
  }

  setDevSourceControlState(
    "Lecture du dépôt…",
    "running"
  );

  devSourceControlRefresh.disabled =
    true;

  try {
    const data =
      await devTerminalRequest(
        `/api/dev/workspace-terminal/sessions/${
          encodeURIComponent(sessionId)
        }/git-diff`
      );

    if (
      refreshSerial !==
        devSourceControlView.refreshSerial ||
      !devSourceControlContextValid({
        sessionId,
        contextKey,
        syncSerial,
      })
    ) {
      return;
    }

    renderDevSourceControlInventory(
      data.gitDiff
    );

    if (
      devSourceControlView.selectedFile
    ) {
      await loadDevSourceControlPatch();
    }
  } catch (error) {
    if (
      refreshSerial !==
        devSourceControlView.refreshSerial ||
      !devSourceControlContextValid({
        sessionId,
        contextKey,
        syncSerial,
      })
    ) {
      return;
    }

    if (
      error.code ===
      "DEV_WORKSPACE_NOT_FOUND"
    ) {
      clearDevSourceControl({
        close: true,
      });

      return;
    }

    setDevSourceControlState(
      error.message,
      "error"
    );

    devSourceControlPatch.textContent =
      "Source Control indisponible.";
  } finally {
    if (
      refreshSerial ===
        devSourceControlView.refreshSerial
    ) {
      devSourceControlRefresh.disabled =
        false;
    }
  }
}

function setDevSourceControlOpen(open) {
  const next =
    Boolean(open);

  if (
    next &&
    !devSourceControlIsAllowed()
  ) {
    setDevTerminalStatus(
      "Sélectionne un Focus DEV avant d’ouvrir Source Control.",
      "error"
    );

    return false;
  }

  devSourceControlView.open =
    next;

  if (
    next &&
    devTerminalState.collapsed
  ) {
    devTerminalState.collapsed =
      false;

    applyDevTerminalLayoutState();
  }

  devSourceControlPanel.hidden =
    !next;

  devTerminalPanel.classList.toggle(
    "is-source-control",
    next
  );

  devSourceControlToggle.setAttribute(
    "aria-pressed",
    String(next)
  );

  const sourceControlToggleLabel =
    next
      ? "Retour au Terminal"
      : "Afficher Source Control";

  devSourceControlToggle.title =
    sourceControlToggleLabel;

  devSourceControlToggle.setAttribute(
    "aria-label",
    sourceControlToggleLabel
  );

  if (!next) {
    devTerminalInput.focus();
  }

  return true;
}

devSourceControlToggle.addEventListener(
  "click",
  () => {
    const next =
      !devSourceControlView.open;

    if (
      !setDevSourceControlOpen(next)
    ) {
      return;
    }

    if (next) {
      void refreshDevSourceControl();
    }
  }
);

devSourceControlRefresh.addEventListener(
  "click",
  () => {
    void refreshDevSourceControl();
  }
);

for (const [
  button,
  scope,
] of [
  [
    devSourceControlWorktree,
    "WORKTREE",
  ],
  [
    devSourceControlStagedScope,
    "STAGED",
  ],
]) {
  button.addEventListener(
    "click",
    () => {
      const entry =
        sourceControlEntry(
          devSourceControlView
            .selectedFile
        );

      if (
        !sourceControlScopeAvailable(
          entry,
          scope
        )
      ) {
        return;
      }

      devSourceControlView.scope =
        scope;

      syncDevSourceControlScopes();

      void loadDevSourceControlPatch();
    }
  );
}

// DEV_SOURCE_CONTROL_UI_END

function setDevTerminalStatus(message, state = "idle") {
  devTerminalStatus.textContent = message;
  devTerminalStatus.dataset.state = state;
}

function clearLastAuthorizedDevValidation() {
  devTerminalState.lastAuthorizedValidationCommand = null;
  devTerminalState.lastAuthorizedValidationSessionId = null;
  devTerminalState.lastAuthorizedValidationContextKey = null;
}

function lastAuthorizedDevValidationForActiveSession() {
  const sessionId = devTerminalState.session?.id || null;
  if (!sessionId ||
    devTerminalState.lastAuthorizedValidationSessionId !== sessionId ||
    devTerminalState.lastAuthorizedValidationContextKey !== devTerminalState.contextKey) return null;
  return devTerminalState.lastAuthorizedValidationCommand;
}

async function devTerminalRequest(
  route,
  {
    method = "GET",
    body,
  } = {}
) {
  const headers = {
    "X-Noon-Request": "1",
  };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(route, {
    method,
    headers,
    cache: "no-store",
    body:
      body === undefined
        ? undefined
        : JSON.stringify(body),
  });

  let data = null;

  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    const error = new Error(
      data?.message ||
      "Terminal DEV indisponible."
    );

    error.code =
      data?.code ||
      "DEV_TERMINAL_REQUEST_FAILED";

    error.httpStatus =
      response.status;

    throw error;
  }

  return data;
}

function stopDevTerminalPolling() {
  if (devTerminalState.pollTimer !== null) {
    window.clearInterval(
      devTerminalState.pollTimer
    );

    devTerminalState.pollTimer = null;
  }
}

function setDevTerminalHeight(
  height,
  persist = true
) {
  devTerminalState.height =
    clampDevTerminalHeight(height);

  const value =
    `${devTerminalState.height}px`;

  devTerminalPanel.style.setProperty(
    "--dev-terminal-height",
    value
  );

  chatView.style.setProperty(
    "--dev-terminal-height",
    value
  );

  if (persist) {
    localStorage.setItem(
      DEV_TERMINAL_HEIGHT_STORAGE_KEY,
      String(devTerminalState.height)
    );
  }
}

function applyDevTerminalLayoutState() {
  devTerminalPanel.classList.toggle(
    "is-collapsed",
    devTerminalState.collapsed
  );

  devTerminalPanel.classList.toggle(
    "is-maximized",
    devTerminalState.maximized
  );

  chatView.classList.toggle(
    "dev-terminal-collapsed",
    devTerminalState.collapsed
  );

  chatView.classList.toggle(
    "dev-terminal-maximized",
    devTerminalState.maximized
  );

  devTerminalCollapseButton.setAttribute(
    "aria-expanded",
    String(!devTerminalState.collapsed)
  );

  devTerminalCollapseButton.setAttribute(
    "aria-label",
    devTerminalState.collapsed
      ? "Restaurer le terminal"
      : "Réduire le terminal"
  );

  devTerminalCollapseButton.title =
    devTerminalState.collapsed
      ? "Restaurer le terminal"
      : "Réduire le terminal";

  devTerminalCollapseButton.textContent =
    devTerminalState.collapsed
      ? "⌃"
      : "⌄";

  devTerminalMaximizeButton.setAttribute(
    "aria-pressed",
    String(devTerminalState.maximized)
  );

  devTerminalMaximizeButton.setAttribute(
    "aria-label",
    devTerminalState.maximized
      ? "Restaurer la taille du terminal"
      : "Maximiser le terminal"
  );

  devTerminalMaximizeButton.title =
    devTerminalState.maximized
      ? "Restaurer la taille du terminal"
      : "Maximiser le terminal";

  devTerminalMaximizeButton.textContent =
    devTerminalState.maximized
      ? "↙"
      : "□";
}

function setDevTerminalCollapsed(collapsed) {
  devTerminalState.collapsed =
    Boolean(collapsed);

  if (devTerminalState.collapsed) {
    devTerminalState.maximized = false;
  }

  applyDevTerminalLayoutState();

  if (!devTerminalState.collapsed) {
    requestAnimationFrame(() => {
      devTerminalInput.focus();
    });
  }
}

function toggleDevTerminalCollapsed() {
  setDevTerminalCollapsed(
    !devTerminalState.collapsed
  );
}

function toggleDevTerminalMaximized() {
  devTerminalState.maximized =
    !devTerminalState.maximized;

  if (devTerminalState.maximized) {
    devTerminalState.collapsed = false;
  }

  applyDevTerminalLayoutState();

  requestAnimationFrame(() => {
    devTerminalInput.focus();
  });
}

const DEV_TERMINAL_STATIC_COMPLETIONS = [
  "npm test",
  "npm run dev",
  "npm run build",
  "npm run lint",
  "npm run start",
  "npm run preview",
  "npm install",
  "npm ci",
  "node --test",
  "git status",
  "git diff",
  "git diff --staged",
  "git log --oneline -10",
  "git branch",
  "git switch",
  "git checkout",
  "git restore",
  "git show",
  "git fetch",
  "git pull",
  "git add",
  "git commit",
  "git push",
  "pwd",
  "ls",
  "ls -la",
];

const devTerminalCompletionPopup =
  document.createElement("div");

devTerminalCompletionPopup.className =
  "dev-terminal-completion";

devTerminalCompletionPopup.hidden =
  true;

devTerminalCompletionPopup.setAttribute(
  "role",
  "listbox"
);

devTerminalCompletionPopup.setAttribute(
  "aria-label",
  "Suggestions de commandes"
);

devTerminalForm.append(
  devTerminalCompletionPopup
);

function closeDevTerminalCompletion() {
  devTerminalState.completionItems = [];
  devTerminalState.completionIndex = -1;
  devTerminalState.completionQuery = "";

  devTerminalCompletionPopup.hidden =
    true;

  devTerminalCompletionPopup.replaceChildren();
}

function devTerminalCompletionCandidates(
  query
) {
  const normalized =
    String(query || "").trim();

  if (!normalized) {
    return [];
  }

  const lower =
    normalized.toLowerCase();

  const values = [
    ...[...devTerminalState.history].reverse(),
    ...DEV_TERMINAL_STATIC_COMPLETIONS,
  ];

  const seen =
    new Set();

  const results = [];

  for (const value of values) {
    const candidate =
      String(value || "").trim();

    if (
      !candidate ||
      candidate === normalized ||
      !candidate
        .toLowerCase()
        .startsWith(lower)
    ) {
      continue;
    }

    const key =
      candidate.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    results.push(candidate);

    if (results.length >= 8) {
      break;
    }
  }

  return results;
}

function renderDevTerminalCompletion() {
  devTerminalCompletionPopup.replaceChildren();

  const items =
    devTerminalState.completionItems;

  if (!items.length) {
    devTerminalCompletionPopup.hidden =
      true;
    return;
  }

  items.forEach(
    (value, index) => {
      const option =
        document.createElement("button");

      option.type = "button";
      option.className =
        "dev-terminal-completion-item";

      option.dataset.active =
        String(
          index ===
            devTerminalState.completionIndex
        );

      option.setAttribute(
        "role",
        "option"
      );

      option.setAttribute(
        "aria-selected",
        String(
          index ===
            devTerminalState.completionIndex
        )
      );

      option.textContent =
        value;

      option.addEventListener(
        "pointerdown",
        (event) => {
          event.preventDefault();

          devTerminalInput.value =
            value;

          closeDevTerminalCompletion();

          devTerminalInput.focus();
        }
      );

      devTerminalCompletionPopup.append(
        option
      );
    }
  );

  devTerminalCompletionPopup.hidden =
    false;

  const active =
    devTerminalCompletionPopup.querySelector(
      '[data-active="true"]'
    );

  active?.scrollIntoView({
    block: "nearest",
  });
}

async function fetchDevTerminalProjectCompletions(
  query
) {
  const sessionId =
    devTerminalState.session?.id;

  if (
    !sessionId ||
    !query
  ) {
    return [];
  }

  try {
    const data =
      await devTerminalRequest(
        `/api/dev/workspace-terminal/sessions/${
          encodeURIComponent(
            sessionId
          )
        }/completions?q=${
          encodeURIComponent(
            query
          )
        }`
      );

    return Array.isArray(
      data.completions
    )
      ? data.completions
          .filter(
            (item) =>
              typeof item ===
                "string" &&
              item.trim()
          )
          .slice(0, 40)
      : [];
  } catch {
    // L'autocomplétion ne doit jamais
    // empêcher l'usage normal du terminal.
    return [];
  }
}

function applyDevTerminalCompletionValue() {
  const selected =
    devTerminalState.completionItems[
      devTerminalState.completionIndex
    ];

  if (!selected) {
    return;
  }

  devTerminalInput.value =
    selected;

  devTerminalInput.setSelectionRange(
    selected.length,
    selected.length
  );

  renderDevTerminalCompletion();
}

async function cycleDevTerminalCompletion(
  direction = 1
) {
  const currentQuery =
    devTerminalInput.value;

  const currentPathToken =
    String(currentQuery || "")
      .trim()
      .split(/\s+/)
      .at(-1) || "";

  const currentHasParentTraversal =
    currentPathToken
      .split("/")
      .includes("..");

  if (currentHasParentTraversal) {
    closeDevTerminalCompletion();
    return false;
  }

  // Popup déjà ouverte :
  // on navigue dans les résultats existants.
  if (
    !devTerminalCompletionPopup.hidden &&
    devTerminalState.completionItems.length
  ) {
    const length =
      devTerminalState.completionItems.length;

    devTerminalState.completionIndex =
      (
        devTerminalState.completionIndex +
        direction +
        length
      ) % length;

    applyDevTerminalCompletionValue();

    return true;
  }

  const query =
    devTerminalInput.value;

  const pathToken =
    String(query || "")
      .trim()
      .split(/\s+/)
      .at(-1) || "";

  const hasParentTraversal =
    pathToken
      .split("/")
      .includes("..");

  const localItems =
    hasParentTraversal
      ? []
      : devTerminalCompletionCandidates(
          query
        );

  const projectItems =
    hasParentTraversal
      ? []
      : await fetchDevTerminalProjectCompletions(
          query
        );

  const seen =
    new Set();

  const items = [];

  for (
    const item of [
      ...projectItems,
      ...localItems,
    ]
  ) {
    const value =
      String(item || "").trim();

    const key =
      value.toLowerCase();

    if (
      !value ||
      seen.has(key)
    ) {
      continue;
    }

    seen.add(key);
    items.push(value);

    if (items.length >= 12) {
      break;
    }
  }

  if (!items.length) {
    closeDevTerminalCompletion();
    return false;
  }

  devTerminalState.completionItems =
    items;

  devTerminalState.completionQuery =
    query;

  devTerminalState.completionIndex =
    direction < 0
      ? items.length - 1
      : 0;

  applyDevTerminalCompletionValue();

  return true;
}

function persistDevTerminalHistory() {
  localStorage.setItem(
    DEV_TERMINAL_HISTORY_STORAGE_KEY,
    JSON.stringify(
      devTerminalState.history.slice(
        -DEV_TERMINAL_MAX_HISTORY
      )
    )
  );
}

function rememberDevTerminalCommand(command) {
  const value =
    String(command || "").trim();

  if (!value) return;

  const last =
    devTerminalState.history.at(-1);

  if (last !== value) {
    devTerminalState.history.push(
      value
    );

    if (
      devTerminalState.history.length >
      DEV_TERMINAL_MAX_HISTORY
    ) {
      devTerminalState.history.splice(
        0,
        devTerminalState.history.length -
          DEV_TERMINAL_MAX_HISTORY
      );
    }

    persistDevTerminalHistory();
  }

  devTerminalState.historyIndex = null;
  devTerminalState.historyDraft = "";
}

function navigateDevTerminalHistory(direction) {
  const history =
    devTerminalState.history;

  if (!history.length) {
    return false;
  }

  if (
    devTerminalState.historyIndex ===
    null
  ) {
    devTerminalState.historyDraft =
      devTerminalInput.value;

    devTerminalState.historyIndex =
      history.length;
  }

  const nextIndex =
    Math.max(
      0,
      Math.min(
        history.length,
        devTerminalState.historyIndex +
          direction
      )
    );

  devTerminalState.historyIndex =
    nextIndex;

  if (
    nextIndex === history.length
  ) {
    devTerminalInput.value =
      devTerminalState.historyDraft;
  } else {
    devTerminalInput.value =
      history[nextIndex];
  }

  requestAnimationFrame(() => {
    const end =
      devTerminalInput.value.length;

    devTerminalInput.setSelectionRange(
      end,
      end
    );
  });

  return true;
}

setDevTerminalHeight(
  devTerminalState.height,
  false
);

applyDevTerminalLayoutState();

function devTerminalBuffer(terminalId) {
  if (
    !devTerminalState.outputByTerminal.has(
      terminalId
    )
  ) {
    devTerminalState.outputByTerminal.set(
      terminalId,
      []
    );
  }

  return devTerminalState.outputByTerminal.get(
    terminalId
  );
}

function formatDevTerminalEvent(event) {
  const text = String(event?.text || "");

  if (event?.type === "command") {
    return `$ ${text}\n`;
  }

  return text;
}

let devTerminalSelectingOutput = false;

function hasActiveDevTerminalSelection() {
  const selection =
    window.getSelection();

  if (
    !selection ||
    selection.isCollapsed ||
    selection.rangeCount === 0
  ) {
    return false;
  }

  const anchorInside =
    selection.anchorNode &&
    devTerminalOutput.contains(
      selection.anchorNode
    );

  const focusInside =
    selection.focusNode &&
    devTerminalOutput.contains(
      selection.focusNode
    );

  return Boolean(
    anchorInside ||
    focusInside
  );
}

function isDevTerminalNearBottom() {
  const remaining =
    devTerminalOutput.scrollHeight -
    devTerminalOutput.scrollTop -
    devTerminalOutput.clientHeight;

  return remaining <= 24;
}

function rememberDevTerminalScrollState() {
  const terminalId =
    devTerminalState.activeTerminalId;

  if (!terminalId) return;

  devTerminalState.scrollByTerminal.set(
    terminalId,
    devTerminalOutput.scrollTop
  );

  devTerminalState.followOutputByTerminal.set(
    terminalId,
    isDevTerminalNearBottom()
  );
}

function devTerminalPendingOutputCount(
  terminalId =
    devTerminalState.activeTerminalId
) {
  if (!terminalId) {
    return 0;
  }

  return (
    devTerminalState.pendingOutputByTerminal.get(
      terminalId
    ) || 0
  );
}

function renderDevTerminalJumpBottom() {
  const terminalId =
    devTerminalState.activeTerminalId;

  if (
    !terminalId ||
    !devTerminalJumpBottomButton
  ) {
    return;
  }

  const following =
    devTerminalState.followOutputByTerminal.get(
      terminalId
    ) !== false;

  const count =
    devTerminalPendingOutputCount(
      terminalId
    );

  devTerminalJumpBottomButton.hidden =
    following;

  devTerminalJumpBottomButton.textContent =
    count > 0
      ? `↓ ${count} nouvelle${
          count > 1
            ? "s"
            : ""
        } sortie${
          count > 1
            ? "s"
            : ""
        }`
      : "↓ Revenir en bas";
}

function resetDevTerminalPendingOutput(
  terminalId =
    devTerminalState.activeTerminalId
) {
  if (!terminalId) {
    return;
  }

  devTerminalState.pendingOutputByTerminal.set(
    terminalId,
    0
  );

  renderDevTerminalJumpBottom();
}

function followDevTerminalOutput() {
  const terminalId =
    devTerminalState.activeTerminalId;

  if (!terminalId) {
    return;
  }

  devTerminalState.followOutputByTerminal.set(
    terminalId,
    true
  );

  devTerminalState.scrollByTerminal.set(
    terminalId,
    devTerminalOutput.scrollHeight
  );

  resetDevTerminalPendingOutput(
    terminalId
  );

  renderDevTerminalOutput();

  devTerminalOutput.scrollTop =
    devTerminalOutput.scrollHeight;

  rememberDevTerminalScrollState();
}

function getActiveDevTerminalOutputText() {
  const terminalId =
    devTerminalState.activeTerminalId;

  if (!terminalId) {
    return "";
  }

  return devTerminalBuffer(terminalId)
    .map((event) =>
      formatDevTerminalEvent(event)
    )
    .join("");
}

function safeDevTerminalLogName() {
  const terminal =
    devTerminalState.terminals.get(
      devTerminalState.activeTerminalId
    );

  const title =
    String(
      terminal?.title ||
      "terminal"
    )
      .normalize("NFKD")
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, "-")
      .replace(/[^a-zA-Z0-9._-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) ||
    "terminal";

  const stamp =
    new Date()
      .toISOString()
      .replace(/[:.]/g, "-");

  return `noon-${title}-${stamp}.log`;
}

async function copyActiveDevTerminalOutput() {
  const text =
    getActiveDevTerminalOutputText();

  if (!text) {
    setDevTerminalStatus(
      "Aucune sortie à copier",
      "idle"
    );

    return;
  }

  try {
    await navigator.clipboard.writeText(
      text
    );

    setDevTerminalStatus(
      "Sortie copiée",
      "ready"
    );
  } catch {
    setDevTerminalStatus(
      "Copie impossible",
      "error"
    );
  }
}

function exportActiveDevTerminalOutput() {
  const text =
    getActiveDevTerminalOutputText();

  if (!text) {
    setDevTerminalStatus(
      "Aucune sortie à exporter",
      "idle"
    );

    return;
  }

  const url =
    URL.createObjectURL(
      new Blob(
        [text],
        {
          type: "text/plain;charset=utf-8",
        }
      )
    );

  const link =
    document.createElement("a");

  link.href = url;
  link.download =
    safeDevTerminalLogName();

  document.body.append(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);

  setDevTerminalStatus(
    "Log exporté",
    "ready"
  );
}

function renderDevTerminalOutput() {
  if (
    devTerminalSelectingOutput ||
    hasActiveDevTerminalSelection()
  ) {
    return;
  }

  const terminalId =
    devTerminalState.activeTerminalId;

  if (!terminalId) {
    devTerminalOutput.textContent =
      "Aucun terminal ouvert.\nClique sur + pour en créer un.";

    return;
  }

  const shouldFollow =
    devTerminalState.followOutputByTerminal.get(
      terminalId
    ) !== false;

  const savedScrollTop =
    devTerminalState.scrollByTerminal.get(
      terminalId
    ) || 0;

  const buffer =
    devTerminalBuffer(terminalId);

  if (!buffer.length) {
    devTerminalOutput.textContent =
      "Terminal prêt.\n";

    devTerminalOutput.scrollTop = 0;

    return;
  }

  const fragment =
    document.createDocumentFragment();

  for (const event of buffer) {
    const line =
      document.createElement("span");

    const type =
      String(
        event?.type ||
        "stdout"
      ).toLowerCase();

    line.className =
      `dev-terminal-output-chunk dev-terminal-output-chunk--${type}`;

    line.textContent =
      formatDevTerminalEvent(event);

    fragment.append(line);
  }

  devTerminalOutput.replaceChildren(
    fragment
  );

  if (shouldFollow) {
    devTerminalOutput.scrollTop =
      devTerminalOutput.scrollHeight;

    devTerminalState.pendingOutputByTerminal.set(
      terminalId,
      0
    );
  } else {
    devTerminalOutput.scrollTop =
      savedScrollTop;
  }

  renderDevTerminalJumpBottom();
}

devTerminalOutput.addEventListener(
  "scroll",
  () => {
    rememberDevTerminalScrollState();

    if (isDevTerminalNearBottom()) {
      resetDevTerminalPendingOutput();
    } else {
      renderDevTerminalJumpBottom();
    }
  },
  {
    passive: true,
  }
);

devTerminalJumpBottomButton.addEventListener(
  "click",
  () => {
    followDevTerminalOutput();
  }
);

devTerminalOutput.addEventListener(
  "pointerdown",
  () => {
    devTerminalSelectingOutput = true;
  }
);

window.addEventListener(
  "pointerup",
  () => {
    if (!devTerminalSelectingOutput) {
      return;
    }

    devTerminalSelectingOutput = false;

    if (!hasActiveDevTerminalSelection()) {
      renderDevTerminalOutput();
    }
  }
);
function updateDevTerminalHeader() {
  const session =
    devTerminalState.session;

  if (!session) {
    devTerminalProject.textContent =
      currentFocus ||
      "Aucun Focus";

    devTerminalMeta.textContent =
      currentFocusPath
        ? "Session terminal non ouverte."
        : "Sélectionne un projet Focus.";

    return;
  }

  devTerminalProject.textContent =
    session.projectName ||
    currentFocus ||
    "Projet DEV";

  const branch =
    session.branch
      ? `branche ${session.branch}`
      : "sans dépôt Git";

  const dirty =
    session.dirty === true
      ? " · modifications locales"
      : session.dirty === false
        ? " · Git propre"
        : "";

  devTerminalMeta.textContent =
    `${branch}${dirty}`;
}

function devTerminalIds() {
  return [
    ...devTerminalState.terminals.keys(),
  ];
}

function activateDevTerminal(
  terminalId,
  {
    focusTab = false,
  } = {}
) {
  if (
    !terminalId ||
    !devTerminalState.terminals.has(
      terminalId
    )
  ) {
    return false;
  }

  if (
    devTerminalState.activeTerminalId &&
    devTerminalState.activeTerminalId !==
      terminalId
  ) {
    rememberDevTerminalScrollState();
  }

  devTerminalState.activeTerminalId =
    terminalId;

  persistDevTerminalLayout();

  renderDevTerminalTabs();
  renderDevTerminalOutput();

  void pollActiveDevTerminal();

  if (focusTab) {
    const activeTab =
      devTerminalTabs.querySelector(
        '.dev-terminal-tab[data-active="true"]'
      );

    activeTab?.focus();
  }

  return true;
}

function moveDevTerminalSelection(
  direction,
  {
    focusTab = false,
  } = {}
) {
  const ids =
    devTerminalIds();

  if (!ids.length) {
    return false;
  }

  const currentIndex =
    Math.max(
      0,
      ids.indexOf(
        devTerminalState.activeTerminalId
      )
    );

  let nextIndex;

  if (direction === "first") {
    nextIndex = 0;
  } else if (direction === "last") {
    nextIndex =
      ids.length - 1;
  } else {
    const delta =
      direction < 0
        ? -1
        : 1;

    nextIndex =
      (
        currentIndex +
        delta +
        ids.length
      ) %
      ids.length;
  }

  return activateDevTerminal(
    ids[nextIndex],
    {
      focusTab,
    }
  );
}

function renderDevTerminalTabs() {
  devTerminalTabs.replaceChildren();

  for (
    const terminal of
    devTerminalState.terminals.values()
  ) {
    const wrapper =
      document.createElement("div");

    wrapper.className =
      "dev-terminal-tab-shell";

    const select =
      document.createElement("button");

    select.type = "button";
    select.className =
      "dev-terminal-tab";

    select.dataset.active =
      String(
        terminal.id ===
        devTerminalState.activeTerminalId
      );

    select.setAttribute(
      "role",
      "tab"
    );

    select.setAttribute(
      "aria-selected",
      String(
        terminal.id ===
        devTerminalState.activeTerminalId
      )
    );

    select.dataset.terminalId =
      terminal.id;

    select.tabIndex =
      terminal.id ===
      devTerminalState.activeTerminalId
        ? 0
        : -1;

    select.addEventListener(
      "keydown",
      (event) => {
        if (
          event.key === "ArrowLeft"
        ) {
          event.preventDefault();

          moveDevTerminalSelection(
            -1,
            {
              focusTab: true,
            }
          );

          return;
        }

        if (
          event.key === "ArrowRight"
        ) {
          event.preventDefault();

          moveDevTerminalSelection(
            1,
            {
              focusTab: true,
            }
          );

          return;
        }

        if (
          event.key === "Home"
        ) {
          event.preventDefault();

          moveDevTerminalSelection(
            "first",
            {
              focusTab: true,
            }
          );

          return;
        }

        if (
          event.key === "End"
        ) {
          event.preventDefault();

          moveDevTerminalSelection(
            "last",
            {
              focusTab: true,
            }
          );
        }
      }
    );

    const state =
      terminal.running
        ? "RUNNING"
        : terminal.status;

    select.textContent =
      `${terminal.title} · ${state}`;

    select.addEventListener(
      "click",
      () => {
        activateDevTerminal(
          terminal.id
        );
      }
    );

    const close =
      document.createElement("button");

    close.type = "button";
    close.className =
      "dev-terminal-tab-close";

    close.textContent = "×";

    close.setAttribute(
      "aria-label",
      `Fermer ${terminal.title}`
    );

    close.addEventListener(
      "click",
      async (event) => {
        event.stopPropagation();

        await closeDevTerminal(
          terminal.id
        );
      }
    );

    wrapper.append(
      select,
      close
    );

    devTerminalTabs.append(wrapper);
  }
}

function applyDevTerminal(terminal) {
  if (!terminal?.id) return;

  devTerminalState.terminals.set(
    terminal.id,
    terminal
  );

  if (
    !devTerminalState.activeTerminalId
  ) {
    devTerminalState.activeTerminalId =
      terminal.id;
  }

  renderDevTerminalTabs();

  if (
    terminal.id ===
    devTerminalState.activeTerminalId
  ) {
    setDevTerminalStatus(
      terminal.running
        ? "Commande en cours"
        : terminal.status === "EXITED"
          ? `Terminé${
              terminal.exitCode === null
                ? ""
                : ` · code ${terminal.exitCode}`
            }`
          : "Prêt",
      terminal.running
        ? "running"
        : terminal.exitCode
          ? "error"
          : "ready"
    );
  }
}

async function createDevTerminal() {
  if (!devTerminalState.session) {
    setDevTerminalStatus(
      "Aucune session DEV.",
      "error"
    );

    return null;
  }

  const number =
    devTerminalState.terminals.size + 1;

  const data =
    await devTerminalRequest(
      `/api/dev/workspace-terminal/sessions/${
        encodeURIComponent(
          devTerminalState.session.id
        )
      }/terminals`,
      {
        method: "POST",
        body: {
          title: `USER ${number}`,
        },
      }
    );

  const terminal =
    data.terminal;

  devTerminalState.terminals.set(
    terminal.id,
    terminal
  );

  devTerminalState.outputByTerminal.set(
    terminal.id,
    []
  );

  devTerminalState.offsetByTerminal.set(
    terminal.id,
    0
  );

  devTerminalState.activeTerminalId =
    terminal.id;

  applyDevTerminal(terminal);
  renderDevTerminalOutput();

  persistDevTerminalLayout();

  devTerminalInput.focus();

  return terminal;
}

async function pollActiveDevTerminal() {
  const session =
    devTerminalState.session;

  const terminalId =
    devTerminalState.activeTerminalId;

  if (
    !session ||
    !terminalId
  ) {
    return;
  }

  const from =
    devTerminalState.offsetByTerminal.get(
      terminalId
    ) || 0;

  try {
    const data =
      await devTerminalRequest(
        `/api/dev/workspace-terminal/sessions/${
          encodeURIComponent(session.id)
        }/terminals/${
          encodeURIComponent(terminalId)
        }/output?from=${
          encodeURIComponent(from)
        }`
      );

    if (
      Array.isArray(data.output) &&
      data.output.length
    ) {
      const publicOutput =
        data.output.filter(
          (event) =>
            event?.type !== "input"
        );

      devTerminalBuffer(
        terminalId
      ).push(
        ...publicOutput
      );

      const following =
        devTerminalState.followOutputByTerminal.get(
          terminalId
        ) !== false;

      if (
        publicOutput.length &&
        !following
      ) {
        devTerminalState.pendingOutputByTerminal.set(
          terminalId,
          devTerminalPendingOutputCount(
            terminalId
          ) + publicOutput.length
        );
      }
    }

    devTerminalState.offsetByTerminal.set(
      terminalId,
      Number(data.next) || 0
    );

    applyDevTerminal(
      data.terminal
    );

    renderDevTerminalOutput();

    if (shouldRefreshDevProblems()) {
      await refreshDevProblems();
    }

    if (devWorkspaceAgentExecutionId) {
      await refreshDevWorkspaceAgent();
    }
  } catch (error) {
    if (
      error.code ===
      "TERMINAL_NOT_FOUND"
    ) {
      devTerminalState.terminals.delete(
        terminalId
      );

      devTerminalState.activeTerminalId =
        [...devTerminalState.terminals.keys()][0] ||
        null;

      renderDevTerminalTabs();
      renderDevTerminalOutput();

      return;
    }

    setDevTerminalStatus(
      error.message,
      "error"
    );
  }
}

function startDevTerminalPolling() {
  stopDevTerminalPolling();

  devTerminalState.pollTimer =
    window.setInterval(
      () => {
        void pollActiveDevTerminal();
      },
      750
    );
}

async function closeDevTerminal(
  terminalId
) {
  const session =
    devTerminalState.session;

  if (
    !session ||
    !terminalId
  ) {
    return;
  }

  try {
    await devTerminalRequest(
      `/api/dev/workspace-terminal/sessions/${
        encodeURIComponent(session.id)
      }/terminals/${
        encodeURIComponent(terminalId)
      }/close`,
      {
        method: "POST",
        body: {},
      }
    );
  } catch (error) {
    setDevTerminalStatus(
      error.message,
      "error"
    );

    return;
  }

  devTerminalState.terminals.delete(
    terminalId
  );

  devTerminalState.outputByTerminal.delete(
    terminalId
  );

  devTerminalState.offsetByTerminal.delete(
    terminalId
  );

  if (
    devTerminalState.activeTerminalId ===
    terminalId
  ) {
    devTerminalState.activeTerminalId =
      [...devTerminalState.terminals.keys()][0] ||
      null;
  }

  renderDevTerminalTabs();
  renderDevTerminalOutput();

  if (
    devTerminalState.activeTerminalId
  ) {
    void pollActiveDevTerminal();
  } else {
    setDevTerminalStatus(
      "Aucun terminal",
      "idle"
    );
  }
}

async function closeDevTerminalSession({
  silent = true,
} = {}) {
  const sessionId =
    devTerminalState.session?.id ||
    null;

  stopDevTerminalPolling();
  clearDevProblemsPanel();
  clearDevSourceControl({
    close: true,
  });
  devProjectRulesUi?.reset();
  clearDevWorkspaceAgent();

  persistDevTerminalLayout();

  devTerminalState.session = null;
  devTerminalState.terminals.clear();
  devTerminalState.outputByTerminal.clear();
  devTerminalState.offsetByTerminal.clear();
  devTerminalState.scrollByTerminal.clear();
  devTerminalState.followOutputByTerminal.clear();
  devTerminalState.pendingOutputByTerminal.clear();
  devTerminalState.activeTerminalId = null;
  devTerminalState.contextKey = null;
  clearLastAuthorizedDevValidation();

  renderDevTerminalTabs();
  renderDevTerminalOutput();
  updateDevTerminalHeader();

  if (!sessionId) return;

  try {
    await devTerminalRequest(
      `/api/dev/workspace-terminal/sessions/${
        encodeURIComponent(sessionId)
      }/close`,
      {
        method: "POST",
        body: {},
      }
    );
  } catch (error) {
    if (!silent) {
      setDevTerminalStatus(
        error.message,
        "error"
      );
    }
  }
}

async function openDevTerminalSession(
  expectedSerial
) {
  const data =
    await devTerminalRequest(
      "/api/dev/workspace-terminal/sessions",
      {
        method: "POST",
        body: {
          focusId:
            currentFocusId,
          focusName:
            currentFocus,
          repositoryRoot:
            currentFocusPath,
        },
      }
    );

  if (
    expectedSerial !==
    devTerminalState.syncSerial
  ) {
    try {
      await devTerminalRequest(
        `/api/dev/workspace-terminal/sessions/${
          encodeURIComponent(
            data.session.id
          )
        }/close`,
        {
          method: "POST",
          body: {},
        }
      );
    } catch {}

    return;
  }

  devTerminalState.session =
    data.session;

  devTerminalState.contextKey =
    `${currentFocusId}:${currentFocusPath}`;

  void devTerminalProfileUi?.refresh();

  if (!devProjectRulesPanel.hidden) void devProjectRulesUi?.refresh();

  updateDevTerminalHeader();

  renderDevProblems(
    data.session.problems
  );

  const restoredLayout =
    loadDevTerminalLayout(
      devTerminalState.contextKey
    );

  const restoredUserTerminals =
    [];

  for (
    let index = 0;
    index < restoredLayout.userCount;
    index += 1
  ) {
    const terminal =
      await createDevTerminal();

    if (terminal) {
      restoredUserTerminals.push(
        terminal
      );
    }
  }

  const restoredActiveTerminal =
    restoredUserTerminals[
      restoredLayout.activeIndex
    ] ||
    restoredUserTerminals[0] ||
    null;

  if (restoredActiveTerminal) {
    devTerminalState.activeTerminalId =
      restoredActiveTerminal.id;

    persistDevTerminalLayout();

    renderDevTerminalTabs();
    renderDevTerminalOutput();
  }

  startDevTerminalPolling();

  setDevTerminalStatus(
    "Terminal prêt",
    "ready"
  );
}

async function syncDevTerminalPanel() {
  const serial =
    ++devTerminalState.syncSerial;

  const devMode =
    currentMode === "DEV";

  devTerminalPanel.hidden =
    !devMode;

  chatView.classList.toggle(
    "dev-terminal-active",
    devMode
  );

  applyDevTerminalLayoutState();

  if (!devMode) {
    await closeDevTerminalSession({
      silent: true,
    });

    return;
  }

  if (uiValidationMode) {
    await closeDevTerminalSession({
      silent: true,
    });
    if (serial !== devTerminalState.syncSerial) return;
    const context = uiValidationContext();
    devTerminalProject.textContent = context?.projectName || "Profil isolé";
    devTerminalMeta.textContent = context ? "Projet synthétique sélectionné pour la validation des règles." : "Aucun workspace personnel n’est chargé dans ce profil.";
    for (const control of [devWorkspaceAgentRun, devWorkspaceAgentCancel, devTerminalAddButton, devTerminalRun, devSourceControlToggle, devSourceControlRefresh]) {
      if (!control) continue;
      control.disabled = true;
      control.title = uiValidationBlockedMessage;
    }
    setDevTerminalStatus(uiValidationBlockedMessage, "idle");
    devTerminalOutput.textContent = uiValidationBlockedMessage;
    return;
  }

  devTerminalProject.textContent =
    currentFocus ||
    "Aucun Focus";

  if (
    !currentFocusId ||
    !currentFocusPath
  ) {
    await closeDevTerminalSession({
      silent: true,
    });

    if (
      serial !==
      devTerminalState.syncSerial
    ) {
      return;
    }

    devTerminalPanel.hidden = false;

    devTerminalProject.textContent =
      currentFocus ||
      "Aucun Focus";

    devTerminalMeta.textContent =
      "Sélectionne un projet Focus disposant d’un dossier local.";

    setDevTerminalStatus(
      "Focus DEV requis",
      "idle"
    );

    renderDevTerminalOutput();

    return;
  }

  const contextKey =
    `${currentFocusId}:${currentFocusPath}`;

  if (
    devTerminalState.session &&
    devTerminalState.contextKey ===
      contextKey
  ) {
    updateDevTerminalHeader();
    startDevTerminalPolling();

    return;
  }

  await closeDevTerminalSession({
    silent: true,
  });

  if (
    serial !==
    devTerminalState.syncSerial
  ) {
    return;
  }

  setDevTerminalStatus(
    "Ouverture du workspace…",
    "running"
  );

  devTerminalMeta.textContent =
    "Vérification des permissions locales…";

  try {
    await openDevTerminalSession(
      serial
    );
  } catch (error) {
    if (
      serial !==
      devTerminalState.syncSerial
    ) {
      return;
    }

    updateDevTerminalHeader();

    setDevTerminalStatus(
      error.message,
      "error"
    );

    devTerminalOutput.textContent =
      [
        "Impossible d’ouvrir le terminal DEV.",
        "",
        error.message,
        "",
        "Le dossier du projet doit être autorisé en lecture et création dans Noon.",
      ].join("\n");
  }
}

devTerminalAddButton.addEventListener(
  "click",
  async () => {
    try {
      await createDevTerminal();
    } catch (error) {
      setDevTerminalStatus(
        error.message,
        "error"
      );
    }
  }
);

devTerminalCopyOutputButton.addEventListener(
  "click",
  () => {
    void copyActiveDevTerminalOutput();
  }
);

devTerminalExportOutputButton.addEventListener(
  "click",
  () => {
    exportActiveDevTerminalOutput();
  }
);

devTerminalForm.addEventListener(
  "submit",
  async (event) => {
    event.preventDefault();

    const command =
      devTerminalInput.value.trim();

    const session =
      devTerminalState.session;

    const terminalId =
      devTerminalState.activeTerminalId;

    const contextKey =
      devTerminalState.contextKey;

    if (!command) return;

    closeDevTerminalCompletion();

    if (
      !session ||
      !terminalId
    ) {
      setDevTerminalStatus(
        "Ouvre d’abord un terminal.",
        "error"
      );

      return;
    }

    rememberDevTerminalCommand(
      command
    );

    devTerminalBuffer(
      terminalId
    ).push({
      type: "command",
      text: command,
    });

    renderDevTerminalOutput();

    devTerminalInput.value = "";
    devTerminalInput.disabled = true;
    devTerminalRun.disabled = true;

    setDevTerminalStatus(
      "Commande en cours",
      "running"
    );

    try {
      const data =
        await devTerminalRequest(
          `/api/dev/workspace-terminal/sessions/${
            encodeURIComponent(session.id)
          }/terminals/${
            encodeURIComponent(terminalId)
          }/run`,
          {
            method: "POST",
            body: {
              command,
            },
          }
        );

      applyDevTerminal(
        data.result?.terminal
      );

      if (
        data.result?.classification ===
        "SAFE_READ"
      ) {
        if (session.id === devTerminalState.session?.id && contextKey === devTerminalState.contextKey) {
          devTerminalState.lastAuthorizedValidationCommand = command;
          devTerminalState.lastAuthorizedValidationSessionId = session.id;
          devTerminalState.lastAuthorizedValidationContextKey = contextKey;
        }
        devTerminalState.problemsRefreshPending =
          true;
      }

      await pollActiveDevTerminal();

      if (
        devSourceControlView.open
      ) {
        await refreshDevSourceControl();
      }
    } catch (error) {
      devTerminalBuffer(
        terminalId
      ).push({
        type: "stderr",
        text:
          `Commande refusée : ${error.message}\n`,
      });

      renderDevTerminalOutput();

      setDevTerminalStatus(
        error.message,
        "error"
      );
    } finally {
      devTerminalInput.disabled = false;
      devTerminalRun.disabled = false;
      devTerminalInput.focus();
    }
  }
);

devTerminalCollapseButton.addEventListener(
  "click",
  () => {
    toggleDevTerminalCollapsed();
  }
);

devTerminalMaximizeButton.addEventListener(
  "click",
  () => {
    toggleDevTerminalMaximized();
  }
);

devTerminalInput.addEventListener(
  "keydown",
  (event) => {
    if (
      event.key === "Tab" &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      event.preventDefault();

      void cycleDevTerminalCompletion(
        event.shiftKey
          ? -1
          : 1
      );

      return;
    }

    if (
      event.key === "Escape" &&
      !devTerminalCompletionPopup.hidden
    ) {
      event.preventDefault();
      closeDevTerminalCompletion();
      return;
    }

    if (
      event.key === "ArrowUp" &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      closeDevTerminalCompletion();

      if (
        navigateDevTerminalHistory(-1)
      ) {
        event.preventDefault();
      }

      return;
    }

    if (
      event.key === "ArrowDown" &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      closeDevTerminalCompletion();

      if (
        navigateDevTerminalHistory(1)
      ) {
        event.preventDefault();
      }
    }
  }
);

devTerminalInput.addEventListener(
  "input",
  () => {
    if (
      !devTerminalCompletionPopup.hidden
    ) {
      closeDevTerminalCompletion();
    }
  }
);

devTerminalResizeHandle.addEventListener(
  "pointerdown",
  (event) => {
    if (
      devTerminalState.collapsed ||
      devTerminalState.maximized
    ) {
      return;
    }

    event.preventDefault();

    devTerminalState.resizing = true;
    devTerminalState.resizeStartY =
      event.clientY;
    devTerminalState.resizeStartHeight =
      devTerminalState.height;

    devTerminalResizeHandle.setPointerCapture?.(
      event.pointerId
    );

    document.body.classList.add(
      "dev-terminal-resizing"
    );
  }
);

window.addEventListener(
  "pointermove",
  (event) => {
    if (
      !devTerminalState.resizing
    ) {
      return;
    }

    const delta =
      devTerminalState.resizeStartY -
      event.clientY;

    setDevTerminalHeight(
      devTerminalState.resizeStartHeight +
        delta,
      false
    );
  }
);

function finishDevTerminalResize() {
  if (
    !devTerminalState.resizing
  ) {
    return;
  }

  devTerminalState.resizing = false;

  document.body.classList.remove(
    "dev-terminal-resizing"
  );

  setDevTerminalHeight(
    devTerminalState.height,
    true
  );
}

window.addEventListener(
  "pointerup",
  finishDevTerminalResize
);

window.addEventListener(
  "pointercancel",
  finishDevTerminalResize
);

devTerminalResizeHandle.addEventListener(
  "keydown",
  (event) => {
    if (
      !["ArrowUp", "ArrowDown"].includes(
        event.key
      ) ||
      devTerminalState.collapsed ||
      devTerminalState.maximized
    ) {
      return;
    }

    event.preventDefault();

    const step =
      event.shiftKey
        ? 50
        : 20;

    setDevTerminalHeight(
      devTerminalState.height +
        (
          event.key === "ArrowUp"
            ? step
            : -step
        )
    );
  }
);

window.addEventListener(
  "resize",
  () => {
    setDevTerminalHeight(
      devTerminalState.height,
      false
    );
  }
);

// Navigation globale entre terminaux.
// Ctrl+Tab : terminal suivant
// Ctrl+Shift+Tab : terminal précédent
document.addEventListener(
  "keydown",
  (event) => {
    if (
      !event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.key !== "Tab" ||
      currentMode !== "DEV" ||
      devTerminalPanel.hidden
    ) {
      return;
    }

    event.preventDefault();

    moveDevTerminalSelection(
      event.shiftKey
        ? -1
        : 1
    );
  }
);

// Accès direct aux terminaux.
// Cmd+1 à Cmd+9 sélectionne le terminal correspondant.
document.addEventListener(
  "keydown",
  (event) => {
    if (
      !event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.shiftKey ||
      currentMode !== "DEV" ||
      devTerminalPanel.hidden
    ) {
      return;
    }

    const match =
      event.code.match(
        /^Digit([1-9])$/
      );

    if (!match) {
      return;
    }

    const terminalIndex =
      Number(match[1]) - 1;

    const ids =
      devTerminalIds();

    const terminalId =
      ids[terminalIndex];

    if (!terminalId) {
      return;
    }

    event.preventDefault();

    activateDevTerminal(
      terminalId
    );
  }
);

// Raccourci inspiré des IDE : affiche/réduit
// le panneau sans fermer ses terminaux.
document.addEventListener(
  "keydown",
  (event) => {
    const commandKey =
      event.metaKey ||
      event.ctrlKey;

    if (
      !commandKey ||
      event.key.toLowerCase() !== "j" ||
      currentMode !== "DEV"
    ) {
      return;
    }

    event.preventDefault();

    if (devTerminalPanel.hidden) {
      void syncDevTerminalPanel();
      return;
    }

    toggleDevTerminalCollapsed();
  }
);

window.addEventListener(
  "noon-context-change",
  () => {
    void syncDevTerminalPanel();
  }
);

window.addEventListener(
  "pagehide",
  () => {
    const sessionId =
      devTerminalState.session?.id;

    if (!sessionId) return;

    void fetch(
      `/api/dev/workspace-terminal/sessions/${
        encodeURIComponent(sessionId)
      }/close`,
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",
          "X-Noon-Request": "1",
        },
        body: "{}",
        keepalive: true,
      }
    ).catch(() => {});
  }
);

// DEV_WORKSPACE_AGENT_UI_START
let devWorkspaceAgentExecutionId = null;
let devWorkspaceAgentSerial = 0;

function clearDevWorkspaceAgent() {
  devWorkspaceAgentSerial += 1;
  devWorkspaceAgentExecutionId = null;
  devWorkspaceAgentState.textContent = "Noon prêt";
  devWorkspaceAgentState.dataset.state = "idle";
  devWorkspaceAgentRun.disabled = false;
  devWorkspaceAgentCancel.disabled = true;
}

function renderDevWorkspaceAgent(
  execution,
  progress = null
) {
  if (
    !execution ||
    execution.executionId !==
      devWorkspaceAgentExecutionId
  ) {
    return;
  }

  const presentation =
    presentDevProgress(
      progress,
      execution
    );

  const terminal =
    [
      "COMPLETED",
      "FAILED",
      "BLOCKED",
      "CANCELLED",
    ].includes(
      execution.status
    );

  devWorkspaceAgentState
    .textContent =
    presentation.label;

  devWorkspaceAgentState
    .dataset.state =
    presentation.state;

  devWorkspaceAgentState
    .title =
    presentation.label;

  devWorkspaceAgentState
    .setAttribute(
      "aria-label",
      presentation.label
    );

  devWorkspaceAgentRun.disabled =
    !terminal;

  devWorkspaceAgentCancel.disabled =
    terminal;

  if (terminal) {
    devWorkspaceAgentExecutionId =
      null;
  }
}

async function showDevWorkspaceAgentTerminal(execution, sessionId, serial) {
  const terminalId = execution?.terminalExecutionRefs?.at(-1)?.terminalSessionId;
  if (!terminalId || devTerminalState.terminals.has(terminalId)) return;
  const data = await devTerminalRequest(`/api/dev/workspace-terminal/sessions/${encodeURIComponent(sessionId)}`);
  if (serial !== devWorkspaceAgentSerial || sessionId !== devTerminalState.session?.id || execution.executionId !== devWorkspaceAgentExecutionId) return;
  const terminal = data.session?.terminalSessions?.find((item) => item.id === terminalId);
  if (!terminal) return;
  devTerminalState.offsetByTerminal.set(terminal.id, 0);
  devTerminalState.activeTerminalId = terminal.id;
  applyDevTerminal(terminal);
  renderDevTerminalOutput();
  await pollActiveDevTerminal();
}

async function refreshDevWorkspaceAgent() {
  const executionId = devWorkspaceAgentExecutionId;
  const serial = devWorkspaceAgentSerial;
  const sessionId = devTerminalState.session?.id || null;
  const contextKey = devTerminalState.contextKey;
  if (!executionId || !sessionId || !contextKey) return;
  try {
    const data = await devTerminalRequest(`/api/dev/workspace-agent/executions/${encodeURIComponent(executionId)}`);
    if (serial !== devWorkspaceAgentSerial || executionId !== devWorkspaceAgentExecutionId ||
      sessionId !== devTerminalState.session?.id || contextKey !== devTerminalState.contextKey || currentMode !== "DEV") return;
    await showDevWorkspaceAgentTerminal(data.execution, sessionId, serial);
    renderDevWorkspaceAgent(data.execution, data.progress);
  } catch {
    if (serial === devWorkspaceAgentSerial) clearDevWorkspaceAgent();
  }
}

devWorkspaceAgentRun.addEventListener("click", async () => {
  const command = lastAuthorizedDevValidationForActiveSession();
  const sessionId = devTerminalState.session?.id || null;
  if (!command || !sessionId || currentMode !== "DEV") {
    setDevTerminalStatus("Exécute d’abord une validation autorisée pour Noon.", "error");
    return;
  }
  const serial = ++devWorkspaceAgentSerial;
  devWorkspaceAgentRun.disabled = true;
  devWorkspaceAgentState.textContent = "Planning…";
  try {
    const data = await devTerminalRequest("/api/dev/workspace-agent/executions", {
      method: "POST",
      body: {
        workspaceSessionId: sessionId,
        task: `Valider le Workspace avec ${command}`,
        validationCommand: command,
        previewObservation: {
          url: devPreviewState.native.url || null,
          status: devPreviewIsOpen() ? "READY" : "CLOSED",
          loadState: devPreviewState.native.loading ? "LOADING" : "IDLE",
        },
      },
    });
    if (serial !== devWorkspaceAgentSerial || sessionId !== devTerminalState.session?.id) return;
    devWorkspaceAgentExecutionId = data.execution.executionId;
    renderDevWorkspaceAgent(data.execution, data.progress);
    void refreshDevWorkspaceAgent();
  } catch {
    if (serial === devWorkspaceAgentSerial) clearDevWorkspaceAgent();
  }
});

devWorkspaceAgentCancel.addEventListener("click", async () => {
  const executionId = devWorkspaceAgentExecutionId;
  if (!executionId) return;
  devWorkspaceAgentCancel.disabled = true;
  devWorkspaceAgentState.textContent = "Stopping…";
  devWorkspaceAgentState.dataset.state = "cancelling";
  try {
    await devTerminalRequest(`/api/dev/workspace-agent/executions/${encodeURIComponent(executionId)}/cancel`, { method: "POST", body: {} });
  } finally {
    if (executionId === devWorkspaceAgentExecutionId) clearDevWorkspaceAgent();
  }
});
// DEV_WORKSPACE_AGENT_UI_END

// DEV_TERMINAL_UI_END

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
  await refreshLocalFolderPermissions(); await loadFocusProjects();
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

// Restaure le mode au chargement.
setMode(currentMode, false);

function setFocus(project) {
  conversationIndexNavigationSerial += 1;
  const projectName =
    typeof project === "string"
      ? project.trim()
      : (project?.displayName || project?.name)?.trim() || "";

  const projectPath =
    typeof project === "object"
      ? (project?.resolvedPath || project?.path)?.trim() || ""
      : "";
  const projectId =
    typeof project === "object" ? project?.id?.trim() || "" : "";

  currentFocus = projectName || null;
  currentFocusPath = projectPath || null;
  currentFocusId = projectId || null;

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
    if (currentFocusId) {
      localStorage.setItem(FOCUS_ID_STORAGE_KEY, currentFocusId);
    } else {
      localStorage.removeItem(FOCUS_ID_STORAGE_KEY);
    }

    updateActivity(`Focus : ${currentFocus}`);
  } else {
    localStorage.removeItem(FOCUS_STORAGE_KEY);
    localStorage.removeItem(FOCUS_PATH_STORAGE_KEY);
    localStorage.removeItem(FOCUS_ID_STORAGE_KEY);
    focusProject.textContent = "Aucun Focus";
    updateActivity("Focus désactivé.");
  }

  updateFocusSelection();
  window.dispatchEvent(new CustomEvent("noon-context-change"));
  void loadProjectJournalPanel();
}

function renderJournalList(title, items) {
  const safeItems = Array.isArray(items) ? items : [];
  return `<strong>${title}</strong><ul>${(safeItems.length ? safeItems : ["Aucun"])
    .map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

async function loadProjectJournalPanel() {
  if (!currentFocusId?.startsWith("project-")) {
    projectJournalPanel.hidden = true;
    return;
  }
  projectJournalPanel.hidden = false;
  projectJournalName.textContent = currentFocus;
  projectJournalMode.textContent = currentMode;
  try {
    const response = await fetch(`/projects/${encodeURIComponent(currentFocusId)}/journal`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "Journal indisponible.");
    const journal = data.journal;
    projectJournalStatus.textContent = journal.currentStatus;
    projectJournalDate.textContent = journal.lastSessionAt
      ? new Date(journal.lastSessionAt).toLocaleDateString("fr-FR") : "Aucune";
    projectJournalNext.textContent = journal.nextActions[0] || "À définir";
    projectJournalBlockers.textContent = String(journal.blockers.length);
    projectJournalDetailContent.innerHTML = [
      journal.objective ? `<p><strong>Objectif</strong><br>${escapeHtml(journal.objective)}</p>` : "",
      renderJournalList("Terminé", journal.completed),
      renderJournalList("En cours", journal.inProgress),
      renderJournalList("Décisions", journal.decisions),
      renderJournalList("Blocages", journal.blockers),
      renderJournalList("Fichiers importants", journal.importantFiles),
    ].join("");
  } catch (error) {
    projectJournalStatus.textContent = "Indisponible";
    updateActivity(error.message);
  }
}

function formatProjectControl(control) {
  const { project, journal, git } = control;
  const gitText = git.available
    ? `${git.modified} fichier(s) modifié(s), ${git.untracked} non suivi(s), branche ${git.branch}`
    : "Aucun dépôt Git détecté";
  return `Contrôle projet — ${project.name}\n\nÉtat : ${journal.currentStatus}\nDernière session : ${journal.lastSessionAt ? new Date(journal.lastSessionAt).toLocaleDateString("fr-FR") : "aucune"}\nTerminé : ${journal.completed.join(", ") || "—"}\nEn cours : ${journal.inProgress.join(", ") || "—"}\nBlocage : ${journal.blockers.join(", ") || "aucun"}\nProchaine action : ${journal.nextActions[0] || "à définir"}\nGit : ${gitText}`;
}

async function controlActiveProject() {
  if (!currentFocusId?.startsWith("project-")) {
    updateActivity("Sélectionne d’abord un projet Focus.");
    return;
  }
  controlProjectButton.disabled = true;
  try {
    const response = await fetch(`/projects/${encodeURIComponent(currentFocusId)}/control`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message);
    addMessage("Noon", formatProjectControl(data.control), "noon");
    updateActivity("Contrôle projet terminé.");
    await loadProjectJournalPanel();
  } catch (error) { updateActivity(error.message); }
  finally { controlProjectButton.disabled = false; }
}

async function endActiveProjectSession() {
  if (!currentFocusId?.startsWith("project-")) {
    updateActivity("Sélectionne d’abord un projet Focus afin que je sache dans quel journal enregistrer cette session.");
    return;
  }
  if (!window.confirm("Enregistrer le bilan puis vider cette conversation de travail ?")) return;
  endProjectSessionButton.disabled = true;
  try {
    const response = await fetch(`/projects/${encodeURIComponent(currentFocusId)}/session/end`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Noon-Request": "1" },
      body: JSON.stringify({ sessionId: currentSessionId, mode: currentMode }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message);
    localStorage.removeItem(conversationStorageKey());
    conversation.replaceChildren();
    addMessage("Noon", `Session enregistrée.\n\n${data.summary.summary}\n\nProchaine action : ${data.summary.nextAction || "à définir"}`, "noon", false);
    updateActivity("Journal projet enregistré.");
    await loadProjectJournalPanel();
  } catch (error) { updateActivity(error.message); }
  finally { endProjectSessionButton.disabled = false; }
}

controlProjectButton.addEventListener("click", controlActiveProject);
endProjectSessionButton.addEventListener("click", endActiveProjectSession);

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
    const optionId = option.dataset.focusId || null;

    const isSelected = currentFocusId
      ? optionId === currentFocusId
      : currentFocusPath
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
  const displayName = project?.displayName || project?.name || "";
  const resolvedPath = project?.resolvedPath || project?.path || "";
  button.dataset.focus = displayName;
  button.dataset.focusPath = resolvedPath;
  button.dataset.focusId = project?.id || "";

  name.className = "focus-option-name";
  name.textContent = displayName || "Retirer le Focus";

  projectPath.className = "focus-option-path";
  if (!project) {
    projectPath.textContent = "Aucun focus actif";
  } else if (project.status === "ambiguous") {
    projectPath.textContent = "Plusieurs emplacements — sélection nécessaire";
    button.disabled = true;
    button.classList.add("unavailable");
  } else if (!project.available) {
    projectPath.textContent = "Introuvable";
    button.disabled = true;
    button.classList.add("unavailable");
  } else {
    projectPath.textContent = resolvedPath;
  }

  button.append(name, projectPath);

  button.addEventListener("click", async () => {
    void reportStructuredIntent({
      action: "switch_workspace",
      workspace: displayName || "Aucun Focus",
    });
    setFocus(project || null);
    closeFocusMenu();

    await loadConversationHistory();
  });

  if (project?.status !== "ambiguous") return button;

  const group = document.createElement("div");
  group.className = "focus-option-group";
  group.appendChild(button);
  for (const match of project.matches || []) {
    const locationButton = document.createElement("button");
    locationButton.type = "button";
    locationButton.className = "focus-location-option focus-option";
    locationButton.dataset.focus = displayName;
    locationButton.dataset.focusId = project.id;
    locationButton.dataset.focusPath = match;
    locationButton.textContent = match;
    locationButton.addEventListener("click", async () => {
      void reportStructuredIntent({
        action: "switch_workspace",
        workspace: displayName,
      });
      setFocus({
        id: project.id,
        displayName,
        resolvedPath: match,
        available: true,
      });
      closeFocusMenu();
      await loadConversationHistory();
    });
    group.appendChild(locationButton);
  }
  return group;
}

async function loadLocalProjects() {
  try {
    const [focusResponse, projectsResponse] = await Promise.all([
      fetch("/focus/catalog", { cache: "no-store" }),
      fetch("/projects/catalog", { cache: "no-store" }),
    ]);
    const data = await focusResponse.json();
    const projectData = await projectsResponse.json();

    if (!focusResponse.ok || !projectsResponse.ok) {
      throw new Error(
        data.message || projectData.message || "Impossible de charger les projets."
      );
    }

    focusList.replaceChildren();
    focusList.appendChild(createFocusOption(null));

    const foldersHeading = document.createElement("span");
    foldersHeading.className = "focus-group-label";
    foldersHeading.textContent = "Dossiers";
    focusList.appendChild(foldersHeading);

    focusCatalogStatus.textContent = "Focus";
    focusAvailability.textContent =
      `${data.availableCount}/${data.count} dossiers disponibles`;

    for (const project of data.catalog) {
      focusList.appendChild(createFocusOption(project));
    }

    const projectsHeading = document.createElement("span");
    projectsHeading.className = "focus-group-label";
    projectsHeading.textContent = "Projets détectés";
    focusList.appendChild(projectsHeading);

    if (projectData.projects.length === 0) {
      const empty = document.createElement("span");
      empty.className = "focus-empty-projects";
      empty.textContent = "Aucun projet détecté — utilise Actualiser";
      focusList.appendChild(empty);
    } else {
      for (const project of projectData.projects) {
        focusList.appendChild(createFocusOption({
          ...project,
          displayName: project.name,
          resolvedPath: project.rootPath,
          available: true,
          status: "available",
        }));
      }
    }

    if (currentFocusId) {
      const registeredEntries = projectData.projects.map((project) => ({
        ...project,
        displayName: project.name,
        resolvedPath: project.rootPath,
        available: true,
        status: "available",
      }));
      const catalogEntry = [...data.catalog, ...registeredEntries].find(
        (project) => project.id === currentFocusId
      );
      const restored = catalogEntry?.available
        ? catalogEntry
        : catalogEntry?.status === "ambiguous" &&
            catalogEntry.matches.includes(currentFocusPath)
          ? {
              ...catalogEntry,
              available: true,
              resolvedPath: currentFocusPath,
              status: "available",
            }
          : null;
      if (restored) {
        setFocus(restored);
      } else {
        setFocus(null);
      }
    }

    updateFocusSelection();
  } catch (error) {
    focusList.textContent = error.message;
    updateActivity("Erreur de chargement des projets.");
  }
}

refreshProjectsButton.addEventListener("click", async () => {
  refreshProjectsButton.disabled = true;
  updateActivity("Analyse des dossiers autorisés…");
  try {
    const response = await fetch("/projects/scan", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Noon-Request": "1",
      },
      body: JSON.stringify({}),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "Analyse impossible.");
    const activeStillExists = !currentFocusId ||
      data.projects.some((project) => project.id === currentFocusId) ||
      !currentFocusId.startsWith("project-");
    await loadLocalProjects();
    updateActivity(activeStillExists
      ? `${data.count} projet(s) détecté(s).`
      : "Le projet Focus actif a été déplacé ou supprimé.");
  } catch (error) {
    updateActivity(error.message);
  } finally {
    refreshProjectsButton.disabled = false;
  }
});

focusToggle.addEventListener("click", () => {
  const isOpen = focusToggle.getAttribute("aria-expanded") === "true";

  focusMenu.hidden = isOpen;
  focusToggle.setAttribute("aria-expanded", String(!isOpen));
});

focusMenu.addEventListener("keydown", (event) => {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const options = [...focusMenu.querySelectorAll(".focus-option:not(:disabled)")];
  if (options.length === 0) return;
  event.preventDefault();
  const currentIndex = options.indexOf(document.activeElement);
  const nextIndex = event.key === "Home" ? 0
    : event.key === "End" ? options.length - 1
      : event.key === "ArrowDown" ? (currentIndex + 1 + options.length) % options.length
        : (currentIndex - 1 + options.length) % options.length;
  options[nextIndex].focus();
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
      conversationStorageKey()
    );

    if (!savedValue) return [];

    const messages = JSON.parse(savedValue);

    if (!Array.isArray(messages)) {
      return [];
    }

    return messages.filter(
        (message) =>
          message &&
          typeof message.author === "string" &&
          typeof message.text === "string" &&
          typeof message.type === "string"
      );
  } catch {
    return [];
  }
}

function saveConversationMessage(
  author,
  text,
  type,
  attachments = [],
  sources = [],
  artifacts = []
) {
  const messages = loadSavedMessages();

  messages.push({
    author,
    text: String(text),
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
    artifacts: artifacts.map((artifact) => ({ name: String(artifact.name || ""), type: String(artifact.type || ""), format: String(artifact.format || ""), size: Number(artifact.size) || 0, path: String(artifact.path || ""), creative: artifact.creative === true, temporary: artifact.temporary === true, model: String(artifact.model || ""), width: Number(artifact.width) || 0, height: Number(artifact.height) || 0, quality: String(artifact.quality || "") })),
    savedAt: Date.now(),
  });

  try {
    localStorage.setItem(
      conversationStorageKey(),
      JSON.stringify(messages)
    );
  } catch {
    // Le serveur conserve l’historique complet : le cache d’affichage peut
    // être abandonné si le quota localStorage du renderer est atteint.
    localStorage.removeItem(conversationStorageKey());
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
  sources = [],
  artifacts = []
) {
  const message = document.createElement("div");
  const authorLabel = document.createElement("span");
  const paragraph = document.createElement("p");

  message.className = `message ${className}`;
  authorLabel.className = "author";
  authorLabel.textContent = author;
  renderChatMarkdown(paragraph, text);
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
        const safeUrl = normalizeSafeChatUrl(source.url);
        if (!safeUrl) return;
        const url = new URL(safeUrl);

        const link = document.createElement("a");
        link.href = url.href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = source.title || url.hostname;
        const card = document.createElement("div");
        card.className = "message-source-card";
        const metadata = document.createElement("small");
        const sourceDate = source.updatedAt || source.publishedAt || source.retrievedAt;
        metadata.textContent = [source.source || source.domain || url.hostname, sourceDate ? new Date(sourceDate).toLocaleDateString("fr-FR") : null]
          .filter(Boolean).join(" · ");
        card.append(link);
        if (metadata.textContent) card.append(metadata);
        if (source.snippet) {
          const snippet = document.createElement("p");
          snippet.className = "message-source-card__snippet";
          snippet.textContent = String(source.snippet).slice(0, 500);
          card.append(snippet);
        }
        sourcesContainer.append(card);
      } catch {
        // Une source incorrecte n’est pas affichée.
      }
    });

    if (sourcesContainer.childElementCount > 1) {
      message.append(sourcesContainer);
    }
  }

  if (artifacts.length > 0) {
    const container = document.createElement("div"); container.className = "artifact-cards";
    for (const artifact of artifacts) {
      const card = document.createElement("article"); card.className = "artifact-card";
      if (artifact.creative === true && artifact.format === "png" && window.noon?.previewArtifact) {
        card.classList.add("artifact-card--creative");
        const preview = document.createElement("img");
        preview.className = "artifact-card__preview";
        preview.alt = `Aperçu de ${artifact.name}`;
        window.noon.previewArtifact(artifact.path)
          .then((dataUrl) => { preview.src = dataUrl; })
          .catch(() => { preview.remove(); });
        card.append(preview);
      }
      const information = document.createElement("div"); information.className = "artifact-card__info"; const name = document.createElement("strong"); name.textContent = artifact.name; const details = document.createElement("span"); details.textContent = `${String(artifact.format || artifact.type || "fichier").toUpperCase()} · ${formatFileSize(artifact.size || 0)}`; information.append(name, details);
      const actions = document.createElement("div"); actions.className = "artifact-card__actions";
      if (artifact.creative === true && artifact.temporary === true) {
        const download = document.createElement("button");
        download.type = "button";
        download.className = "artifact-card__download";
        download.textContent = "↓ Télécharger";
        download.addEventListener("click", async () => {
          download.disabled = true;
          try {
            const saved = await window.noon?.downloadArtifact?.(artifact.path);
            if (saved && !saved.canceled) {
              download.textContent = "✓ Enregistrée";
              updateActivity(`Image enregistrée : ${saved.name}`);
            }
          } catch (error) {
            updateActivity(error.message || "Impossible d’enregistrer l’image.");
          } finally {
            download.disabled = false;
          }
        });
        actions.append(download);
      } else {
        const open = document.createElement("button"); open.type = "button"; open.textContent = "Ouvrir"; open.addEventListener("click", () => window.noon?.openArtifact?.(artifact.path));
        const reveal = document.createElement("button"); reveal.type = "button"; reveal.textContent = "Finder"; reveal.addEventListener("click", () => window.noon?.revealArtifact?.(artifact.path));
        const copy = document.createElement("button"); copy.type = "button"; copy.textContent = "Copier le chemin"; copy.addEventListener("click", async () => { await navigator.clipboard.writeText(artifact.path); updateActivity("Chemin copié."); });
        actions.append(open, reveal, copy);
      }
      card.append(information, actions); container.append(card);
    }
    message.append(container);
  }

  conversation.appendChild(message);
  conversation.scrollTop = conversation.scrollHeight;

  if (shouldSave) {
    saveConversationMessage(
      author,
      text,
      className,
      attachments,
      sources,
      artifacts
    );
  }
  return message;
}

function addApprovalCard(approval) {
  if (!approval?.id) return null;
  const card = document.createElement("article");
  card.className = "message-approval";
  card.dataset.approvalId = approval.id;
  const title = document.createElement("strong");
  title.textContent = approval.title || "Validation requise";
  const summary = document.createElement("p");
  summary.textContent = approval.summary || "Cette action exacte nécessite votre validation.";
  const meta = document.createElement("small");
  meta.textContent = `${approval.permissionLevel || "action externe"} · expire à ${new Date(approval.expiresAt).toLocaleTimeString("fr-FR")}`;
  const actions = document.createElement("div");
  actions.className = "message-approval__actions";
  for (const [decision, label] of [["approve", "Confirmer exactement"], ["reject", "Refuser"]]) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", async () => {
      actions.querySelectorAll("button").forEach((item) => { item.disabled = true; });
      try {
        const response = await fetch("/orchestrator/approval", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Noon-Request": "1" },
          body: JSON.stringify({
            executionId: approval.executionId,
            approvalId: approval.id,
            resumeToken: approval.resumeToken,
            decision,
          }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || "Reprise impossible.");
        card.dataset.status = decision === "approve" ? "consumed" : "rejected";
        actions.replaceChildren();
        const status = document.createElement("span");
        status.textContent = decision === "approve" ? "Action validée et exécutée une seule fois." : "Action refusée.";
        actions.append(status);
        if (data.answer) addMessage("Noon", data.answer, "noon");
        await loadPendingApprovals();
      } catch (error) {
        updateActivity(error.message);
        actions.querySelectorAll("button").forEach((item) => { item.disabled = false; });
      }
    });
    actions.append(button);
  }
  card.append(title, summary, meta, actions);
  conversation.append(card);
  conversation.scrollTop = conversation.scrollHeight;
  return card;
}

function chatProgressPresentation(
  progress
) {
  const state =
    String(
      progress?.state || ""
    ).toUpperCase();

  const phase =
    String(
      progress?.phase || ""
    ).toUpperCase();

  const source =
    String(
      progress?.source || ""
    ).toLowerCase();

  const reasonCode =
    String(
      progress?.reasonCode || ""
    ).toUpperCase();

  const rootExecution =
    source === "orchestrator" ||
    source === "native_dev";

  if (
    state === "WAITING" &&
    (
      phase === "APPROVAL" ||
      reasonCode ===
        "APPROVAL_REQUIRED"
    )
  ) {
    return {
      label: "Validation requise",
      state,
    };
  }

  if (state === "BLOCKED") {
    return {
      label:
        phase === "RECOVERY"
          ? "Récupération en attente…"
          : "En attente…",
      state,
    };
  }

  if (state === "CANCELLED") {
    return {
      label: "Interrompu",
      state,
    };
  }

  if (state === "FAILED") {
    return {
      label:
        rootExecution
          ? "Échec"
          : "Traitement de l’étape…",
      state,
    };
  }

  if (state === "SUCCEEDED") {
    return {
      label:
        rootExecution
          ? "Terminé"
          : "Étape terminée…",
      state,
    };
  }

  const labels = {
    PLAN: "Planification…",
    ACTION: "Exécution en cours…",
    TOOL: "Exécution en cours…",
    VALIDATION: "Vérification…",
    APPROVAL: "Validation requise",
    RECOVERY: "Récupération…",
    FINALIZE: "Finalisation…",
  };

  return {
    label:
      labels[phase] ||
      "Traitement en cours…",

    state:
      state || "RUNNING",
  };
}

function updateChatProgress(
  element,
  progress
) {
  if (
    !element ||
    !progress
  ) {
    return;
  }

  const presentation =
    chatProgressPresentation(
      progress
    );

  element.textContent =
    presentation.label;

  element.dataset.state =
    presentation.state;

  element.hidden = false;
}

async function readNoonEventStream(response, onDelta, onProgress = null) {
  if (!response.ok) { const data = await response.json().catch(() => ({})); const error = new Error(data.message || "Erreur Noon"); error.status = response.status; throw error; }
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ""; let finalData = null;
  while (true) { const { done, value } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); const blocks = buffer.split("\n\n"); buffer = blocks.pop() || "";
    for (const block of blocks) { let eventName = "message"; let dataText = ""; for (const line of block.split("\n")) { if (line.startsWith("event:")) eventName = line.slice(6).trim(); if (line.startsWith("data:")) dataText += line.slice(5).trim(); } if (!dataText) continue; const data = JSON.parse(dataText); if (eventName === "delta") onDelta(data.delta || ""); else if (eventName === "progress") onProgress?.(data.progress || null); else if (eventName === "final") finalData = data; else if (eventName === "error") { const error = new Error(data.message || "Erreur Noon"); error.code = data.errorCode; error.retryable = data.retryable; error.retryAfter = data.retryAfter; throw error; } }
  }
  if (!finalData) throw new Error("Le flux Noon s’est terminé sans réponse finale."); return finalData;
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
      Array.isArray(message.sources) ? message.sources : [],
      Array.isArray(message.artifacts) ? message.artifacts : []
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
  if (currentFocusId) {
    params.set("focusId", currentFocusId);
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
    localStorage.removeItem(conversationStorageKey());

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
        isUser ? "user" : "noon",
        true,
        [],
        [],
        Array.isArray(message.artifacts) ? message.artifacts : []
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

async function registerConversation(sessionId, title = "", folderId = "general") {
  const response = await fetch("/conversations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Noon-Request": "1",
    },
    body: JSON.stringify({ sessionId, title, folderId }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "Conversation indisponible.");
  return data.conversation;
}

// SIDEBAR_FIRST_CLICK_GUARD_START
let conversationIndexNavigationSerial = 0;

async function switchConversation(sessionId) {
  conversationIndexNavigationSerial += 1;
  if (requestInProgress || sessionId === currentSessionId) return;
  currentSessionId = sessionId;
  localStorage.setItem(SESSION_STORAGE_KEY, currentSessionId);
  lastFailedQuestion = null;
  retryButton.hidden = true;
  promptInput.value = "";
  clearSavedDraft();
  await loadConversationHistory();
  await loadConversationIndex();
  switchView("chat");
  promptInput.focus();
}

async function createNewConversation() {
  const previousConversation = conversationIndexState.conversations.find((item) => item.id === currentSessionId);
  const targetFolderId = previousConversation?.folderId || "general";
  currentSessionId = createSessionId();
  localStorage.setItem(SESSION_STORAGE_KEY, currentSessionId);
  conversation.replaceChildren();
  promptInput.value = "";
  resizePromptInput();
  clearSavedDraft();
  lastFailedQuestion = null;
  retryButton.hidden = true;
  retryButton.disabled = false;
  if (selectedFiles.length > 0) clearSelectedFile(false);
  addMessage(
    "Noon",
    "Nouvelle conversation. Comment puis-je t’aider ?",
    "noon",
    false
  );
  await registerConversation(currentSessionId, "", targetFolderId);
  await loadConversationIndex();
  updateActivity("Nouvelle conversation prête.");
  setVisualState("idle");
  switchView("chat");
  promptInput.focus();
}

let conversationIndexState = { folders: [], conversations: [] };

let activeConversationContextMenu = null;

function closeConversationContextMenu() {
  activeConversationContextMenu?.remove();
  activeConversationContextMenu = null;
}

async function updateIndexedConversation(conversationId, changes) {
  const response = await fetch(`/conversations/${encodeURIComponent(conversationId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "X-Noon-Request": "1" },
    body: JSON.stringify(changes),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "Déplacement impossible.");
  return data;
}

async function renameConversationProject(projectId, title) {
  const response = await fetch(`/conversation-folders/${encodeURIComponent(projectId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "X-Noon-Request": "1" },
    body: JSON.stringify({ title }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "Projet indisponible.");
}

async function beginConversationProjectRename(projectId) {
  const project = conversationIndexState.folders.find((item) => item.id === projectId);
  const projectRow = Array.from(conversationProjectsList.querySelectorAll("[data-conversation-project]"))
    .find((item) => item.dataset.conversationProject === projectId);
  const name = projectRow?.querySelector(".conversation-project__name");
  if (!project || !name) return;
  const input = document.createElement("input");
  input.className = "conversation-project__rename";
  input.value = project.title;
  input.maxLength = 60;
  input.setAttribute("aria-label", "Nom du projet");
  name.replaceWith(input);
  input.focus();
  input.select();
  let finished = false;
  const finish = async (save) => {
    if (finished) return;
    finished = true;
    const title = input.value.trim();
    try {
      if (save && title && title !== project.title) await renameConversationProject(projectId, title);
    } catch (error) { updateActivity(error.message); }
    await loadConversationIndex();
  };
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); void finish(true); }
    if (event.key === "Escape") { event.preventDefault(); void finish(false); }
  });
  input.addEventListener("blur", () => void finish(true));
}

async function beginIndexedConversationRename(conversationId) {
  const conversationItem = conversationIndexState.conversations.find((item) => item.id === conversationId);
  const row = Array.from(document.querySelectorAll("[data-conversation-id]"))
    .find((item) => item.dataset.conversationId === conversationId);
  const openButton = row?.querySelector(".conversation-history__open");
  if (!conversationItem || !openButton) return;
  const input = document.createElement("input");
  input.className = "conversation-history__rename";
  input.value = conversationItem.title || "";
  input.maxLength = 72;
  input.setAttribute("aria-label", "Nom de la conversation");
  openButton.replaceWith(input);
  row.draggable = false;
  input.focus();
  input.select();
  let finished = false;
  const finish = async (save) => {
    if (finished) return;
    finished = true;
    const title = input.value.trim();
    try {
      if (save && title && title !== conversationItem.title) {
        await updateIndexedConversation(conversationId, { title });
        updateActivity("Conversation renommée.");
      }
    } catch (error) {
      updateActivity(error.message);
    }
    await loadConversationIndex();
  };
  input.addEventListener("click", (event) => event.stopPropagation());
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); void finish(true); }
    if (event.key === "Escape") { event.preventDefault(); void finish(false); }
  });
  input.addEventListener("blur", () => void finish(true));
}

async function createConversationProject({ conversationId = null } = {}) {
  const response = await fetch("/conversation-folders", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Noon-Request": "1" },
    body: JSON.stringify({ title: "Nouveau projet" }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "Création du projet impossible.");
  if (conversationId) await updateIndexedConversation(conversationId, { folderId: data.folder.id });
  conversationProjects.open = true;
  await loadConversationIndex();
  await beginConversationProjectRename(data.folder.id);
}

async function deleteConversationProject(project) {
  if (!window.confirm(`Supprimer le projet « ${project.title} » ? Les conversations resteront dans Chats.`)) return;
  const response = await fetch(`/conversation-folders/${encodeURIComponent(project.id)}?destinationFolderId=general`, {
    method: "DELETE",
    headers: { "X-Noon-Request": "1" },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "Suppression du projet impossible.");
  await loadConversationIndex();
}

async function moveConversationToProject(conversationItem, projectId) {
  await updateIndexedConversation(conversationItem.id, { folderId: projectId });
  await loadConversationIndex();
  updateActivity(projectId === "general" ? "Conversation replacée dans Chats." : "Conversation déplacée dans le projet.");
}

function openMoveConversationSubmenu(parentItem, conversationItem, menu) {
  menu.querySelector(".conversation-context-submenu")?.remove();
  const submenu = document.createElement("div");
  submenu.className = "conversation-context-menu conversation-context-submenu";
  submenu.setAttribute("role", "menu");
  submenu.setAttribute("aria-label", "Choisir un projet");
  const projects = conversationIndexState.folders.filter((folder) => folder.id !== "general");
  const choices = [
    ...projects.map((project) => ({ id: project.id, label: project.title })),
    { id: "general", label: "Aucun projet / Chats", separated: true },
    { id: "new", label: "+ Nouveau projet", separated: true },
  ];
  for (const choice of choices) {
    if (choice.separated) {
      const separator = document.createElement("span");
      separator.className = "conversation-context-menu__separator";
      separator.setAttribute("aria-hidden", "true");
      submenu.append(separator);
    }
    const button = document.createElement("button");
    button.type = "button";
    button.role = "menuitem";
    button.className = "conversation-context-menu__item";
    const marker = document.createElement("span");
    marker.className = "conversation-context-menu__check";
    marker.textContent = choice.id === conversationItem.folderId ? "✓" : "";
    const label = document.createElement("span");
    label.textContent = choice.label;
    button.append(marker, label);
    button.addEventListener("click", async () => {
      closeConversationContextMenu();
      try {
        if (choice.id === "new") await createConversationProject({ conversationId: conversationItem.id });
        else await moveConversationToProject(conversationItem, choice.id);
      } catch (error) { updateActivity(error.message); }
    });
    submenu.append(button);
  }
  menu.append(submenu);
  const parentRect = parentItem.getBoundingClientRect();
  const submenuRect = submenu.getBoundingClientRect();
  const opensLeft = parentRect.right + submenuRect.width + 12 > window.innerWidth;
  submenu.style.left = opensLeft ? `${-submenuRect.width - 4}px` : `${parentRect.width + 4}px`;
  submenu.style.top = `${Math.max(0, Math.min(menu.getBoundingClientRect().height - submenuRect.height, parentItem.offsetTop))}px`;
  parentItem.setAttribute("aria-expanded", "true");
  submenu.querySelector("button")?.focus();
}

async function deleteIndexedConversation(conversationItem) {
  if (!window.confirm(`Supprimer la conversation « ${conversationItem.title} » ?`)) return;
  const response = await fetch(`/conversations/${encodeURIComponent(conversationItem.id)}`, {
    method: "DELETE",
    headers: { "X-Noon-Request": "1" },
  });
  const data = await response.json();
  if (!response.ok) {
    updateActivity(data.message || "Suppression impossible.");
    return;
  }
  localStorage.removeItem(conversationStorageKey(conversationItem.id));
  if (conversationItem.id === currentSessionId) await createNewConversation();
  else await loadConversationIndex();
}

function openConversationContextMenu(anchor, conversationItem) {
  closeConversationContextMenu();

  const menu = document.createElement("div");
  menu.className = "conversation-context-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", `Actions pour ${conversationItem.title}`);

  const actions = [
    { id: "share", label: "Partager", icon: "share" },
    { id: "rename", label: "Renommer", icon: "rename" },
    { id: "move", label: "Déplacer vers le projet", icon: "folder" },
    { id: "delete", label: "Supprimer", icon: "trash", destructive: true, separated: true },
  ];

  for (const action of actions) {
    if (action.separated) {
      const separator = document.createElement("span");
      separator.className = "conversation-context-menu__separator";
      separator.setAttribute("aria-hidden", "true");
      menu.append(separator);
    }

    const button = document.createElement("button");
    button.type = "button";
    button.role = "menuitem";
    button.className = "conversation-context-menu__item";
    if (action.id === "move") {
      button.setAttribute("aria-haspopup", "menu");
      button.setAttribute("aria-expanded", "false");
    }
    if (action.destructive) button.classList.add("is-destructive");
    const icon = document.createElement("span");
    icon.className = "conversation-context-menu__icon";
    icon.setAttribute("aria-hidden", "true");
    icon.classList.add(`conversation-context-menu__icon--${action.icon}`);
    const label = document.createElement("span");
    label.textContent = action.label;
    button.append(icon, label);
    if (action.id === "move") {
      const chevron = document.createElement("span");
      chevron.className = "conversation-context-menu__chevron";
      chevron.textContent = "›";
      button.append(chevron);
    }

    button.addEventListener("click", async () => {
      if (action.id === "move") {
        openMoveConversationSubmenu(button, conversationItem, menu);
        return;
      }
      closeConversationContextMenu();
      if (action.id === "share") {
        if (conversationItem.id !== currentSessionId) await switchConversation(conversationItem.id);
        shareConversationButton.click();
      } else if (action.id === "rename") {
        await beginIndexedConversationRename(conversationItem.id);
      } else if (action.id === "delete") {
        await deleteIndexedConversation(conversationItem);
      }
    });
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

function renderConversationIndex(conversations = []) {
  conversationHistoryList.replaceChildren();
  const chatConversations = conversations.filter((item) => !item.folderId || item.folderId === "general");
  conversationHistoryCount.textContent = `${chatConversations.length} chat${chatConversations.length === 1 ? "" : "s"}`;
  renderConversationProjects(conversations);

  if (chatConversations.length === 0) {
    const empty = document.createElement("span");
    empty.className = "conversation-history__empty";
    empty.textContent = "Aucune conversation.";
    conversationHistoryList.append(empty);
    return;
  }

  const sortedConversations = [...chatConversations].sort(
    (left, right) => new Date(right.updatedAt) - new Date(left.updatedAt)
  );

  let previousDateGroup = null;
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  for (const conversationItem of sortedConversations) {
    const updatedAt = new Date(conversationItem.updatedAt);
    const conversationDay = new Date(
      updatedAt.getFullYear(),
      updatedAt.getMonth(),
      updatedAt.getDate()
    );
    const ageInDays = Math.floor((todayStart - conversationDay) / 86_400_000);
    const dateGroup = ageInDays <= 0
      ? "Aujourd’hui"
      : ageInDays === 1
        ? "Hier"
        : "7 jours";

    if (dateGroup !== previousDateGroup) {
      const heading = document.createElement("span");
      heading.className = "conversation-history__group";
      heading.textContent = dateGroup;
      conversationHistoryList.append(heading);
      previousDateGroup = dateGroup;
    }

    const item = document.createElement("div");
    item.className = "conversation-history__item";
    item.draggable = true;
    item.dataset.conversationId = conversationItem.id;
    item.classList.toggle("active", conversationItem.id === currentSessionId);
    item.addEventListener("dragstart", (event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/x-noon-conversation", conversationItem.id); item.classList.add("is-dragging"); });
    item.addEventListener("dragend", () => item.classList.remove("is-dragging"));

    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = "conversation-history__open";

    const title = document.createElement("span");
    title.className = "conversation-history__title";
    title.textContent = conversationItem.title || "Nouvelle conversation";
    openButton.append(title);
    openButton.addEventListener("click", () => void switchConversation(conversationItem.id));
    title.addEventListener("dblclick", (event) => {
      event.stopPropagation();
      void beginIndexedConversationRename(conversationItem.id);
    });

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "conversation-history__delete conversation-history__more";
    deleteButton.setAttribute("aria-label", `Plus d’actions pour ${conversationItem.title}`);
    deleteButton.setAttribute("aria-haspopup", "menu");
    deleteButton.textContent = "⋮";
    deleteButton.addEventListener("click", (event) => {
      event.stopPropagation();
      openConversationContextMenu(deleteButton, conversationItem);
    });

    item.append(openButton, deleteButton);
    conversationHistoryList.append(item);

  }
}

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

function memoryValueLabel(memory) {
  if (typeof memory.value === "string") return memory.value;
  if (memory.value?.text) return String(memory.value.text);
  if (memory.value?.rule) return String(memory.value.rule);
  return JSON.stringify(memory.value || {});
}
function statusLabel(status) {
  return ({ confirmed: "Confirmé", candidate: "Candidat", pending_review: "À vérifier", historical: "Historique", superseded: "Remplacé", deleted: "Supprimé", inferred: "J’en déduis · à confirmer", temporary: "Information temporaire", blocked: "Information bloquée", expired: "Expirée", rejected: "Refusée" })[status] || status;
}
async function structuredMemoryAction(action, payload = {}) {
  const response = await fetch("/personal-intelligence/memories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...payload }) });
  const data = await response.json(); if (!response.ok) throw new Error(data.message || "Mémoire structurée indisponible."); return data.result;
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

async function loadPrivateMemoryWhy() {
  const response = await fetch("/private-memory/why", { cache: "no-store" }); const data = await response.json();
  if (response.ok) privateMemoryWhy.textContent = data.reason || "Aucune mémoire privée utilisée.";
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
  window.noonVoiceMetrics ||= {};
  window.noonVoiceMetrics.transcriptionMs = Number(response.headers.get("X-Transcription-Ms")) || 0;

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
        audio: getNoonAudioConstraints(),

        video: false,
      });

    await refreshAudioDevices();

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

    const microphoneMessage = error.name === "NotAllowedError"
      ? "Accès au microphone refusé. Ouvre Réglages > Microphone dans les paramètres Noon."
      : error.name === "NotFoundError"
        ? "Aucun microphone détecté. Vérifie la connexion du casque puis réessaie."
        : error.name === "OverconstrainedError"
          ? "Le microphone sélectionné n’est plus disponible. Repasse sur le microphone système."
          : `Microphone indisponible : ${error.message}`;
    updateActivity(microphoneMessage);
  }
}

micButton.addEventListener("click", async () => {
  const noonIsSpeaking =
    Boolean(currentSpeech) ||
    ("speechSynthesis" in window &&
      (window.speechSynthesis.speaking ||
        window.speechSynthesis.pending));

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
  resizePromptInput();

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
    if (!composerMenu.hidden) {
      composerMenu.hidden = true;
      composerMenuButton.setAttribute("aria-expanded", "false");
      return;
    }

    if (
      mediaRecorder &&
      mediaRecorder.state === "recording"
    ) {
      finishVoiceRecording();
      return;
    }

    const noonIsSpeaking =
      Boolean(currentSpeech) ||
      ("speechSynthesis" in window &&
        (window.speechSynthesis.speaking ||
          window.speechSynthesis.pending));

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

document.querySelectorAll(".operations-toggle").forEach((button) => {
  button.addEventListener("click", () => {
    const panel = document.getElementById(button.dataset.panel);
    panel.hidden = !panel.hidden;
    button.setAttribute("aria-expanded", String(!panel.hidden));
  });
});

async function callIntegration(provider, action) {
  const response = await fetch(`/integrations/${encodeURIComponent(provider)}/${action}`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Noon-Request": "1" },
    body: "{}",
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "Intégration indisponible.");
  if (data.authorizationUrl) await window.noon.openGoogleAuthorization(data.authorizationUrl);
  await loadIntegrations();
}

async function loadIntegrations() {
  try {
    const response = await fetch("/integrations/status", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message);
    integrationsSecurityStatus.innerHTML = data.dryRunExternalWrites
      ? '<span class="dry-run-badge">Mode sécurisé : écritures externes simulées</span>'
      : "Écritures externes activables avec autorisation";
    integrationsList.replaceChildren();
    if (!data.integrations?.length) {
      integrationsList.textContent = "Aucune intégration disponible.";
      return;
    }
    for (const integration of data.integrations) {
      const card = document.createElement("article");
      card.className = "integration-card";
      card.innerHTML = `<div class="integration-card__head"><strong>${escapeHtml(integration.displayName)}</strong><span class="permission-indicator" data-connected="${integration.connected}">${integration.connected ? "Connecté" : "Non connecté"}</span></div><small>Lecture : ${escapeHtml(integration.readCapabilities.join(", ") || "—")}</small><small>Écriture : ${escapeHtml(integration.writeCapabilities.join(", ") || "—")}</small><small>${integration.lastError ? `Erreur : ${escapeHtml(integration.lastError)}` : "Aucune erreur"}</small>`;
      const actions = document.createElement("div");
      actions.className = "integration-card__actions";
      const connect = document.createElement("button");
      connect.type = "button";
      connect.textContent = integration.connected ? "Reconnecter" : "Connecter";
      connect.addEventListener("click", () => callIntegration(integration.id, "connect").catch((error) => updateActivity(error.message)));
      const health = document.createElement("button");
      health.type = "button"; health.textContent = "Tester";
      health.addEventListener("click", async () => {
        const result = await fetch(`/integrations/${integration.id}/health`, { cache: "no-store" });
        updateActivity(result.ok ? `Test ${integration.displayName} terminé en lecture seule.` : `Test ${integration.displayName} impossible.`);
      });
      const disconnect = document.createElement("button");
      disconnect.type = "button"; disconnect.textContent = "Déconnecter"; disconnect.disabled = !integration.connected;
      disconnect.addEventListener("click", () => {
        if (window.confirm(`Déconnecter ${integration.displayName} sans supprimer de donnée distante ?`)) {
          callIntegration(integration.id, "disconnect").catch((error) => updateActivity(error.message));
        }
      });
      actions.append(connect, health, disconnect); card.append(actions); integrationsList.append(card);
    }
  } catch (error) {
    integrationsSecurityStatus.textContent = error.message;
    integrationsList.textContent = "Aucune intégration disponible.";
  }
}

async function loadPendingApprovals() {
  try {
    const response = await fetch("/approvals", { cache: "no-store" });
    const data = await response.json(); approvalsList.replaceChildren();
    if (!data.approvals?.length) { approvalsList.textContent = "Aucune action en attente."; return; }
    for (const approval of data.approvals) {
      const card = document.createElement("article"); card.className = "approval-card";
      card.innerHTML = `<strong>${escapeHtml(approval.provider)} · ${escapeHtml(approval.action)}</strong><span>Cible : ${escapeHtml(approval.target)}</span><small>${escapeHtml(approval.consequences)}</small><small>Expire : ${new Date(approval.expiresAt).toLocaleTimeString("fr-FR")}</small>`;
      for (const action of ["confirm", "reject"]) {
        const button = document.createElement("button"); button.type = "button"; button.textContent = action === "confirm" ? "Confirmer exactement" : "Refuser";
        button.addEventListener("click", async () => {
          await fetch(`/approvals/${approval.id}/${action}`, { method: "POST", headers: { "X-Noon-Request": "1" } });
          await loadPendingApprovals();
        }); card.append(button);
      }
      approvalsList.append(card);
    }
  } catch { approvalsList.textContent = "Actions indisponibles."; }
}

async function loadAutomations() {
  try {
    const response = await fetch("/automations", { cache: "no-store" });
    const data = await response.json(); automationsList.replaceChildren();
    for (const routine of data.routines || []) {
      const card = document.createElement("article"); card.className = "automation-card";
      card.innerHTML = `<strong>${escapeHtml(routine.name)}</strong><span>${escapeHtml(routine.schedule)} · ${escapeHtml(routine.timezone)}</span><small>${routine.enabled ? "Activée" : "Désactivée"}${routine.includesMondayVision ? " · Vision du lundi incluse" : ""}</small>`;
      automationsList.append(card);
    }
  } catch { automationsList.textContent = "Automatisations indisponibles."; }
}

switchView("core");
const savedSidebarState = localStorage.getItem("noon-sidebar-open");
setSidebar(savedSidebarState === null ? window.innerWidth > 720 : savedSidebarState !== "false", false);
loadBudget();
restoreDisplayedConversation();

async function initializeSidebarNavigation() {
  /*
   * Le démarrage est maintenant déterministe :
   * projets -> conversation courante -> index.
   *
   * Plus de rendu concurrent susceptible
   * d'écraser le premier clic utilisateur.
   */
  await loadLocalProjects();

  const firstSavedQuestion =
    loadSavedMessages()
      .find(
        (message) =>
          message.type === "user"
      )
      ?.text || "";

  try {
    await registerConversation(
      currentSessionId,
      firstSavedQuestion
    );
  } catch (error) {
    updateActivity(
      error.message
    );
  }

  await loadConversationIndex();
}

void initializeSidebarNavigation()
  .catch(
    (error) =>
      updateActivity(
        error.message
      )
  );

restoreSavedDraft();

// SIDEBAR_FIRST_CLICK_GUARD_END
checkNoonConnection();
loadIntegrations();
loadPendingApprovals();
loadAutomations();
refreshWakeWordSettings();
refreshOpenAIKeyStatus();
refreshLocalFolderPermissions();
loadCreativeBriefPreferences();
loadPlanningSettings();
loadLongTermMemories();

async function greetArnaudWithDailyBrief() {
  switchView("brief");
  const brief = await loadCreativeBrief();
  const spokenDailyBrief = brief?.content || "";
  const greeting = spokenDailyBrief
    ? `Bonjour Arnaud. Voici votre brief matinal. ${prepareTextForSpeech(spokenDailyBrief.replace(/https?:\/\/\S+/g, " Sources disponibles à l’écran. "))}`
    : "Bonjour Arnaud. Le point du jour n’est pas encore disponible. Je vous préviendrai dès qu’il sera prêt.";

  activity.textContent = spokenDailyBrief
    ? "Lecture du brief matinal…"
    : "Point du jour indisponible.";

  if (voiceEnabled) {
    await speakNoon(greeting);
  }
}

window.noon?.onDeepLink((link) => {
  if (!link || typeof link.action !== "string") return;
  if (link.action === "open") {
    promptInput.focus();
    return;
  }
  if (link.action === "wake") {
    void greetArnaudWithDailyBrief();
    return;
  }
  if (link.action === "live") {
    document.getElementById("liveVoiceButton")?.click();
    return;
  }
  if (link.action === "new-conversation") {
    newConversationButton.click();
    return;
  }
  if (link.action === "settings" || link.action === "diagnostic") {
    quickSettings.hidden = false;
    settingsButton.setAttribute("aria-expanded", "true");
    return;
  }
  if (link.action === "brief") {
    switchView("brief");
    return;
  }
  if (link.action === "mode") {
    void reportStructuredIntent({ action: "set_mode", mode: link.value }, "shortcut");
    setMode(link.value);
    return;
  }
  if (link.action === "focus") {
    const option = document.querySelector(
      `.focus-option[data-focus-id="${CSS.escape(link.id)}"]`
    );
    option?.click();
  }
});

window.addEventListener("online", checkNoonConnection);
window.addEventListener("offline", () => {
  setConnectionStatus("offline", "Hors connexion");
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    checkNoonConnection();
    loadIntegrations();
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

  interruptNoonSpeech(false);

  if (window.noonLiveVoice) {
    window.noonLiveVoice.disconnect({ announce: false });
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

// Surface minimale utilisée par le contrôleur WebRTC isolé du renderer.
window.NoonAppBridge = {
  getContext() {
    return {
      sessionId: currentSessionId,
      mode: currentMode,
      focus: currentFocus,
      focusPath: currentFocusPath,
      focusId: currentFocusId,
    };
  },
  getAudioDevices() {
    return {
      inputId: preferredAudioInputId,
      outputId: preferredAudioOutputId,
    };
  },
  getAudioConstraints: getNoonAudioConstraints,
  setMode(mode) {
    setMode(mode);
  },
  setFocus(project) {
    setFocus(project);
  },
  setVoiceStyle(language, accent) {
    localStorage.setItem("noonVoiceLanguage", language || "auto");
    localStorage.setItem("noonVoiceAccent", accent || "none");
  },
  refreshProjects() {
    return loadLocalProjects();
  },
  addLiveMessage(author, text, type, sources = [], artifacts = []) {
    addMessage(author, text, type, true, [], sources, artifacts);
    void loadConversationIndex();
  },
  addApproval(approval) {
    addApprovalCard(approval);
    void loadPendingApprovals();
  },
  updateActivity,
  setVisualState,
  showProjectControl(control) {
    addMessage("Noon", formatProjectControl(control), "noon");
    void loadProjectJournalPanel();
  },
  finishProjectSession(summary) {
    localStorage.removeItem(conversationStorageKey());
    conversation.replaceChildren();
    addMessage("Noon", `Session enregistrée.\n\n${summary.summary}\n\nProchaine action : ${summary.nextAction || "à définir"}`, "noon", false);
    void loadProjectJournalPanel();
  },
};

void refreshAudioDevices();
