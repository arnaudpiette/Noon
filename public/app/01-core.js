// Contrôleur principal de l’interface Noon.
// Il gère la conversation, le Focus, la voix, les fichiers et les préférences locales.

// Références DOM partagées par les différents modules de l’interface.
const {
  escapeHtml,
  isResumeCommand,
  parseCaptureCommand,
  parseFirstStepCommand,
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

