"use strict";

const {
  app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage,
  Notification, powerMonitor, safeStorage, screen, session, shell,
  systemPreferences, Tray,
} = require("electron");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const { isSafeExternalUrl, isSafeGoogleAuthorizationUrl, isValidAccelerator, parseNoonDeepLink } = require("./app-core");
const {
  createTrustedIpcRegistrar,
  readPreviousStartupState,
  resolveBuildProfile,
  writeStartupState,
} = require("./production-hardening");
const { createRotatingLogger, migrateLegacyData } = require("../lib/internal-data");
const { FOCUS_CATALOG } = require("../lib/focus-catalog");
const { WakeWordService } = require("../services/wake-word-service");
const { isDueToday, nextRunAt } = require("../lib/creative-brief");
const { createLocalPermissionStore } = require("../lib/local-permissions");
const { createPasswordVerifier, verifyPassword } = require("../services/security/local-password-verifier");
const { executeBenchmarkControlCommand, parseBenchmarkControlCommand, publicCommandError } = require("./benchmark-control-client");
const { createDeferredOptionalLoader, createStartupDiagnostics, startOptionalStartupPhase } = require("./startup-diagnostics");

const smokeArgument = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const smokeModeFromArguments = process.argv.includes("--noon-smoke-test");
const NOON_PORT = process.env.NOON_SMOKE_TEST === "1" || smokeModeFromArguments
  ? Math.max(1024, Math.min(65535, Number(process.env.NOON_SMOKE_PORT || smokeArgument("noon-smoke-port")) || 43127))
  : 3000;
const NOON_ORIGIN = `http://127.0.0.1:${NOON_PORT}`;
const PROCESS_STARTED_AT = Date.now();
const DEFAULT_SHORTCUT = "Control+Option+N";
const DEFAULT_LIVE_SHORTCUT = "Control+Option+Shift+N";
const buildProfile = resolveBuildProfile({ packaged: app.isPackaged });
const safeModeRequested = process.argv.includes("--safe-mode") || process.env.NOON_SAFE_MODE === "1";
const smokeTestRequested = process.env.NOON_SMOKE_TEST === "1" || smokeModeFromArguments;
const smokeUserData = process.env.NOON_SMOKE_USER_DATA || smokeArgument("noon-smoke-user-data");
let benchmarkControlCommand = null;
let benchmarkControlCommandError = null;
try { benchmarkControlCommand = parseBenchmarkControlCommand(process.argv); }
catch (error) { benchmarkControlCommandError = error; }
if (smokeTestRequested && smokeUserData) {
  app.setPath("userData", path.resolve(smokeUserData));
}
// Le smoke test utilise un profil et un port isolés ; il ne doit pas réveiller l'instance quotidienne.
const hasSingleInstanceLock = benchmarkControlCommand || benchmarkControlCommandError ? true : smokeTestRequested || app.requestSingleInstanceLock();
let mainWindow = null;
let tray = null;
let serverController = null;
let localAuthSecret = null;
let pendingDeepLink = null;
let isQuitting = false;
let liveVoiceActive = false;
let logNoonEvent = () => {};
let wakeWordService = null;
let resumeWakeTimer = null;
let creativeBriefTimer = null;
let briefRetryTimer = null;
let creativeBriefRunning = false;
let microphonePermission = "unknown";
let privateMemoryAuthFailures = 0;
let privateMemoryAuthLockedUntil = 0;
let serverStartedLatencyMs = null;
let startupTimingLoggerReady = false;
const startupPhaseTimings = [];
let startupDiagnostics = null;
let deferredOpenAISecret = null;
let deferredGeminiSecret = null;

async function measureStartupPhase(phase, operation) {
  return startupDiagnostics.measure(phase, async () => {
    const startedAt = process.hrtime.bigint();
    let status = "ok";
    let errorCode = null;
    try {
      return await operation();
    } catch (error) {
      status = "error";
      errorCode = String(error?.code || error?.name || "ERROR").slice(0, 80);
      throw error;
    } finally {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const timing = {
        phase,
        durationMs: Math.round(durationMs * 10) / 10,
        status,
        ...(errorCode ? { errorCode } : {}),
      };
      if (startupTimingLoggerReady) logNoonEvent("info", "startup-phase", JSON.stringify(timing));
      else startupPhaseTimings.push(timing);
    }
  });
}

function flushStartupPhaseTimings() {
  for (const timing of startupPhaseTimings.splice(0)) {
    logNoonEvent("info", "startup-phase", JSON.stringify(timing));
  }
}

function recordSkippedStartupPhase(phase) {
  startupPhaseTimings.push({ phase, durationMs: 0, status: "skipped" });
}

if (!hasSingleInstanceLock) app.quit();

const dataPath = (name) => path.join(app.getPath("userData"), name);
startupDiagnostics = createStartupDiagnostics({ filePath: dataPath("startup-diagnostics.jsonl") });
deferredOpenAISecret = createDeferredOptionalLoader({ operation: () => loadEncryptedOpenAIKey() });
deferredGeminiSecret = createDeferredOptionalLoader({ operation: () => loadEncryptedGeminiKey() });
startupDiagnostics.record("main-module", "ready", { elapsedMs: Date.now() - PROCESS_STARTED_AT });
const localPermissionStore = createLocalPermissionStore(dataPath("local-permissions.json"));
function readJson(name, fallback) {
  try { return JSON.parse(fs.readFileSync(dataPath(name), "utf8")); }
  catch { return fallback; }
}
function writeJson(name, value) {
  const destination = dataPath(name);
  const temporary = `${destination}.tmp`;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, destination);
}
function loadPreferences() {
  const preferences = {
    launchAtLogin: true,
    creativeBriefEnabled: true,
    creativeBriefTime: "07:00",
    creativeBriefNotifications: true,
    shortcut: DEFAULT_SHORTCUT,
    liveShortcut: DEFAULT_LIVE_SHORTCUT,
    wakeWordEnabled: false,
    wakeWordSensitivity: 0.5,
    wakeWordDeviceIndex: -1,
    wakeWordKeywordPath: null,
    wakeWordModelPath: null,
    resumeWakeAfterUnlock: true,
    showInDock: true,
    ...readJson("preferences.json", {}),
  };
  return safeModeRequested
    ? { ...preferences, wakeWordEnabled: false, creativeBriefEnabled: false }
    : preferences;
}
function encryptedSecretPath(name) { return dataPath(`${name}.bin`); }
function saveEncryptedSecret(name, value) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Le coffre macOS est indisponible.");
  const destination = encryptedSecretPath(name);
  if (!value) { try { fs.unlinkSync(destination); } catch {} return; }
  fs.writeFileSync(destination, safeStorage.encryptString(String(value)), { mode: 0o600 });
}
function loadEncryptedSecret(name) {
  if (!safeStorage.isEncryptionAvailable()) return null;
  try { return safeStorage.decryptString(fs.readFileSync(encryptedSecretPath(name))); }
  catch { return null; }
}
function privateMemoryPasswordVerifier() {
  const encoded = loadEncryptedSecret("private-memory-display-password");
  if (!encoded) return null;
  try { return JSON.parse(encoded); } catch { return null; }
}
function canPromptPrivateMemoryTouchId() {
  try { return process.platform === "darwin" && systemPreferences.canPromptTouchID(); }
  catch { return false; }
}
function privateMemoryProtectionStatus() {
  return {
    touchIdAvailable: canPromptPrivateMemoryTouchId(),
    passwordConfigured: Boolean(privateMemoryPasswordVerifier()),
  };
}
function getOrCreateLocalSecret() {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Le coffre macOS est indisponible.");
  const secretPath = dataPath("local-auth.bin");
  try { return safeStorage.decryptString(fs.readFileSync(secretPath)); }
  catch {
    const secret = crypto.randomBytes(32).toString("base64url");
    fs.writeFileSync(secretPath, safeStorage.encryptString(secret), { mode: 0o600 });
    return secret;
  }
}
function loadExistingLocalSecret() {
  if (!safeStorage.isEncryptionAvailable()) throw Object.assign(new Error("Coffre indisponible."), { code: "NOON_AUTH_UNAVAILABLE" });
  try { return safeStorage.decryptString(fs.readFileSync(dataPath("local-auth.bin"))); }
  catch { throw Object.assign(new Error("Authentification locale indisponible."), { code: "NOON_AUTH_UNAVAILABLE" }); }
}
function loadEncryptedOpenAIKey() {
  if (process.env.OPENAI_API_KEY || !safeStorage.isEncryptionAvailable()) return;
  try {
    process.env.OPENAI_API_KEY = safeStorage.decryptString(
      fs.readFileSync(dataPath("openai-api-key.bin"))
    );
  } catch {
    // Migration locale unique : le .env n'est jamais inclus dans l'application.
    const candidates = [
      path.join(app.getPath("home"), "Noon", ".env"),
      path.join(__dirname, "..", ".env"),
    ];
    for (const candidate of candidates) {
      try {
        const contents = fs.readFileSync(candidate, "utf8");
        const match = contents.match(/^\s*(?:export\s+)?OPENAI_API_KEY\s*=\s*(.+?)\s*$/m);
        if (!match) continue;
        const value = match[1].replace(/^(['"])(.*)\1$/, "$2").trim();
        if (!value) continue;
        saveEncryptedSecret("openai-api-key", value);
        process.env.OPENAI_API_KEY = value;
        return;
      } catch {
        // Le fichier est absent ou illisible : poursuivre sans révéler son chemin.
      }
    }
  }
}
function loadEncryptedGeminiKey() {
  if (process.env.GEMINI_API_KEY) {
    if (app.isPackaged && safeStorage.isEncryptionAvailable()) {
      try { saveEncryptedSecret("gemini-api-key", process.env.GEMINI_API_KEY); } catch {}
    }
    return "ENV";
  }
  const encrypted = loadEncryptedSecret("gemini-api-key");
  if (encrypted) {
    process.env.GEMINI_API_KEY = encrypted;
    return "SAFESTORAGE";
  }
  const candidates = [path.join(app.getPath("home"), "Noon", ".env"), path.join(__dirname, "..", ".env")];
  for (const candidate of candidates) {
    try {
      const contents = fs.readFileSync(candidate, "utf8");
      const match = contents.match(/^\s*(?:export\s+)?GEMINI_API_KEY\s*=\s*(.+?)\s*$/m);
      if (!match) continue;
      const value = match[1].replace(/^(['"])(.*)\1$/, "$2").trim();
      if (!value) continue;
      saveEncryptedSecret("gemini-api-key", value);
      process.env.GEMINI_API_KEY = value;
      return "SAFESTORAGE";
    } catch {
      // Secret local absent ou coffre indisponible : rester désactivé sans journaliser de détail.
    }
  }
  return "NONE";
}
function loadLocalIntegrationEnvironment() {
  const candidates = [
    path.join(app.getPath("home"), "Noon", ".env"),
    path.join(__dirname, "..", ".env"),
  ];
  const allowedNames = new Set([
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "GOOGLE_OAUTH_REDIRECT_URI",
  ]);
  for (const candidate of candidates) {
    try {
      const contents = fs.readFileSync(candidate, "utf8");
      for (const line of contents.split(/\r?\n/)) {
        const match = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
        if (!match || !allowedNames.has(match[1]) || process.env[match[1]]) continue;
        const value = match[2].replace(/^(['"])(.*)\1$/, "$2").trim();
        if (value) process.env[match[1]] = value;
      }
      if (process.env.GOOGLE_OAUTH_CLIENT_ID) return;
    } catch {
      // La configuration locale reste optionnelle tant que Gmail n'est pas connecté.
    }
  }
}
function isTrustedNoonOrigin(rawUrl) {
  try { return new URL(rawUrl).origin === NOON_ORIGIN; }
  catch { return false; }
}
function configureSessionSecurity() {
  const noonSession = session.defaultSession;
  noonSession.webRequest.onBeforeSendHeaders({ urls: [`${NOON_ORIGIN}/*`] }, (details, callback) => {
    callback({ requestHeaders: { ...details.requestHeaders, "X-Noon-Local-Auth": localAuthSecret } });
  });
  noonSession.setPermissionCheckHandler((webContents, permission, origin, details) => {
    const requestingUrl = details?.requestingUrl || details?.securityOrigin || origin || webContents?.getURL() || "";
    if (!isTrustedNoonOrigin(requestingUrl)) return false;
    if (permission === "notifications") return true;
    return permission === "media" && details?.mediaType !== "video";
  });
  noonSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const requestingUrl = details?.requestingUrl || details?.securityOrigin || webContents?.getURL() || "";
    const types = Array.isArray(details?.mediaTypes) ? details.mediaTypes : [];
    const audioOnly = types.length === 0 || types.every((type) => type === "audio");
    callback(isTrustedNoonOrigin(requestingUrl) &&
      (permission === "notifications" || (permission === "media" && audioOnly)));
  });
}
async function requestMicrophoneAccess() {
  if (smokeTestRequested) {
    microphonePermission = "skipped-smoke-test";
    return false;
  }
  if (process.platform !== "darwin") {
    microphonePermission = "granted";
    return true;
  }
  microphonePermission = systemPreferences.getMediaAccessStatus("microphone");
  if (microphonePermission === "not-determined") {
    const granted = await systemPreferences.askForMediaAccess("microphone");
    microphonePermission = granted ? "granted" : "denied";
  }
  return microphonePermission === "granted";
}
async function initializeWakeWordConfiguration(preferences) {
  const configured = Boolean(
    loadEncryptedSecret("picovoice-access-key") &&
    preferences.wakeWordKeywordPath &&
    preferences.wakeWordModelPath &&
    fs.existsSync(preferences.wakeWordKeywordPath) &&
    fs.existsSync(preferences.wakeWordModelPath)
  );
  if (configured && preferences.wakeWordStartupVersion !== 2) {
    await measureStartupPhase("wake-word-preferences", async () => {
      writeJson("preferences.json", {
        ...preferences,
        wakeWordEnabled: true,
        wakeWordStartupVersion: 2,
      });
    });
  }
  return configured;
}
async function openExternalUrl(rawUrl) {
  if (!isSafeExternalUrl(rawUrl)) return false;
  await shell.openExternal(rawUrl);
  return true;
}
function boundsAreVisible(bounds) {
  return screen.getAllDisplays().some(({ workArea }) =>
    bounds.x < workArea.x + workArea.width && bounds.x + bounds.width > workArea.x &&
    bounds.y < workArea.y + workArea.height && bounds.y + bounds.height > workArea.y);
}
function showMainWindow() {
  if (!mainWindow) return createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}
function dispatchDeepLink(rawUrl) {
  const parsed = parseNoonDeepLink(rawUrl);
  if (!parsed) return false;
  pendingDeepLink = parsed;
  showMainWindow();
  if (mainWindow && !mainWindow.webContents.isLoading()) {
    mainWindow.webContents.send("noon:deep-link", parsed);
    pendingDeepLink = null;
  }
  return true;
}
function sendSystemState(state, payload = null) {
  if (!mainWindow || mainWindow.webContents.isDestroyed()) return;
  mainWindow.webContents.send("noon:system-state", payload ? { state, ...payload } : state);
}
function scheduleWakeWordResume(delay = 1800) {
  clearTimeout(resumeWakeTimer);
  resumeWakeTimer = setTimeout(() => { void syncWakeWordState(); }, delay);
}
async function syncWakeWordState() {
  if (!wakeWordService) return;
  const preferences = loadPreferences();
  if (!preferences.wakeWordEnabled || liveVoiceActive) {
    await wakeWordService.stop();
    rebuildTrayMenu();
    return;
  }
  if (microphonePermission !== "granted") {
    await wakeWordService.stop();
    const denied = microphonePermission === "denied" || microphonePermission === "restricted";
    wakeWordService.setStatus(
      denied ? "unavailable" : "waiting-permission",
      denied ? "Autorisation microphone indisponible." : "En attente de l’autorisation microphone."
    );
    rebuildTrayMenu();
    return;
  }
  try {
    await wakeWordService.start({
      keywordPath: preferences.wakeWordKeywordPath,
      modelPath: preferences.wakeWordModelPath,
      sensitivity: preferences.wakeWordSensitivity,
      deviceIndex: preferences.wakeWordDeviceIndex,
    });
  } catch (error) {
    wakeWordService.setStatus("error", error.message);
  }
  rebuildTrayMenu();
}
function createWindow() {
  if (mainWindow) return showMainWindow();
  const saved = readJson("window-state.json", null);
  const bounds = saved && boundsAreVisible(saved) ? saved : { width: 1440, height: 900 };
  mainWindow = new BrowserWindow({
    title: "Noon", ...bounds, minWidth: 1000, minHeight: 700,
    backgroundColor: "#fdfdfc", show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"), contextIsolation: true,
      nodeIntegration: false, sandbox: true, webSecurity: true,
      allowRunningInsecureContent: false, webviewTag: false,
      devTools: buildProfile === "development" || buildProfile === "test",
    },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void openExternalUrl(url); return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url === `${NOON_ORIGIN}/app`) return;
    event.preventDefault(); void openExternalUrl(url);
  });
  mainWindow.webContents.on("render-process-gone", () => { liveVoiceActive = false; });
  mainWindow.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    if (liveVoiceActive) {
      const choice = dialog.showMessageBoxSync(mainWindow, {
        type: "warning", buttons: ["Annuler", "Terminer et masquer"], defaultId: 0,
        message: "Une Conversation Live est active.",
        detail: "Le microphone sera arrêté avant de masquer Noon.",
      });
      if (choice === 0) return;
      mainWindow.webContents.send("noon:system-state", "stop-live");
      liveVoiceActive = false;
    }
    writeJson("window-state.json", mainWindow.getBounds());
    mainWindow.hide();
  });
  mainWindow.on("closed", () => { mainWindow = null; });
  mainWindow.loadURL(`${NOON_ORIGIN}/app`);
  mainWindow.once("ready-to-show", () => {
    logNoonEvent("info", "startup-window-ready", JSON.stringify({
      elapsedMs: Date.now() - PROCESS_STARTED_AT,
      profile: buildProfile,
      safeMode: safeModeRequested,
    }));
    if (!app.getLoginItemSettings().wasOpenedAtLogin) mainWindow.show();
    if (pendingDeepLink) {
      mainWindow.webContents.send("noon:deep-link", pendingDeepLink);
      pendingDeepLink = null;
    }
  });
  return mainWindow;
}
function rebuildTrayMenu() {
  if (!tray) return;
  const preferences = loadPreferences();
  const wakeStatus = wakeWordService?.getStatus() || { state: "disabled", running: false };
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Ouvrir Noon", click: showMainWindow },
    { label: "Masquer Noon", enabled: Boolean(mainWindow?.isVisible()), click: () => mainWindow?.hide() },
    { label: "Nouvelle conversation", click: () => dispatchDeepLink("noon://new-conversation") },
    { label: "Brief Noon", click: () => dispatchDeepLink("noon://brief") },
    { type: "separator" },
    { label: "Salut Noon", type: "checkbox", checked: preferences.wakeWordEnabled,
      click: (item) => { void setPreference("wakeWordEnabled", item.checked).then(syncWakeWordState); } },
    { label: liveVoiceActive ? "Activer/désactiver le microphone" : "Microphone inactif", enabled: liveVoiceActive,
      click: () => sendSystemState("toggle-mute") },
    { label: wakeStatus.running ? "Écoute locale active" : `Réveil : ${wakeStatus.state}`, enabled: false },
    { type: "separator" },
    { label: "Mode Mini", type: "radio", checked: true, click: () => sendSystemState("voice-quality", { value: "mini" }) },
    { label: "Mode Max", type: "radio", click: () => sendSystemState("voice-quality", { value: "max" }) },
    { label: "Mode DA", click: () => dispatchDeepLink("noon://mode?value=DA") },
    { label: "Mode DEV", click: () => dispatchDeepLink("noon://mode?value=DEV") },
    { label: "Mode Soutenance", click: () => dispatchDeepLink("noon://mode?value=SOUTENANCE") },
    { label: "Focus", submenu: [
      { label: "Aucun focus", click: () => dispatchDeepLink("noon://focus?id=none") },
      ...FOCUS_CATALOG.map((entry) => ({
        label: entry.displayName,
        click: () => dispatchDeepLink(`noon://focus?id=${encodeURIComponent(entry.id)}`),
      })),
    ] },
    { type: "separator" },
    { label: "État des connexions", click: showMainWindow },
    { label: "Paramètres", click: () => dispatchDeepLink("noon://settings") },
    { label: "Lancer Noon à l’ouverture de session", type: "checkbox", checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => { void setPreference("launchAtLogin", item.checked); } },
    { label: "Afficher Noon dans le Dock", type: "checkbox", checked: preferences.showInDock,
      click: (item) => { void setPreference("showInDock", item.checked); } },
    { label: "Diagnostic", click: () => dispatchDeepLink("noon://diagnostic") },
    { type: "separator" },
    { label: "Quitter complètement Noon", click: () => { isQuitting = true; app.quit(); } },
  ]));
}
function createTray() {
  const iconPath = path.join(__dirname, "..", "assets", "icons", "noonTemplate.png");
  const icon = nativeImage.createFromPath(iconPath);
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip("Noon"); rebuildTrayMenu();
  tray.on("click", () => mainWindow?.isVisible() && mainWindow.isFocused() ? mainWindow.hide() : showMainWindow());
}
function registerShortcuts() {
  globalShortcut.unregisterAll();
  const preferences = loadPreferences();
  const register = (accelerator, callback) => isValidAccelerator(accelerator) &&
    globalShortcut.register(accelerator, callback);
  return {
    window: register(preferences.shortcut, () => mainWindow?.isVisible() ? mainWindow.hide() : showMainWindow()),
    live: register(preferences.liveShortcut, () => dispatchDeepLink("noon://live")),
  };
}
async function setPreference(key, value) {
  const allowed = new Set(["launchAtLogin", "shortcut", "liveShortcut", "wakeWordEnabled", "wakeWordSensitivity", "wakeWordDeviceIndex", "resumeWakeAfterUnlock", "showInDock", "creativeBriefEnabled", "creativeBriefTime", "creativeBriefNotifications"]);
  if (!allowed.has(key)) throw new Error("Préférence refusée.");
  if (["shortcut", "liveShortcut"].includes(key) && !isValidAccelerator(value)) throw new Error("Raccourci clavier invalide.");
  if (key === "wakeWordSensitivity" && (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 1)) throw new Error("Sensibilité invalide.");
  if (key === "creativeBriefTime" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(value))) throw new Error("Heure du brief invalide.");
  const preferences = { ...loadPreferences(), [key]: value };
  writeJson("preferences.json", preferences);
  if (key === "launchAtLogin") app.setLoginItemSettings({ openAtLogin: Boolean(value), openAsHidden: true });
  if (key === "showInDock" && app.dock) value ? app.dock.show() : app.dock.hide();
  if (["shortcut", "liveShortcut"].includes(key)) registerShortcuts();
  if (["wakeWordEnabled", "wakeWordSensitivity", "wakeWordDeviceIndex"].includes(key)) {
    scheduleWakeWordResume(50);
  }
  if (["creativeBriefEnabled", "creativeBriefTime"].includes(key)) scheduleCreativeBrief();
  rebuildTrayMenu();
  return { preferences, loginItem: app.getLoginItemSettings() };
}

async function runCreativeBrief({ force = false, notify = true } = {}) {
  if (creativeBriefRunning) return null;
  creativeBriefRunning = true;
  try {
    const dailyResponse = await fetch(`${NOON_ORIGIN}/daily-brief/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Noon-Local-Auth": localAuthSecret },
      body: JSON.stringify({ force }),
    });
    const dailyData = await dailyResponse.json();
    if (!dailyResponse.ok) {
      throw new Error(dailyData.message || "Échec du Daily Brief.");
    }
    const preferences = loadPreferences();
    if (notify && preferences.creativeBriefNotifications && Notification.isSupported()) {
      const notification = new Notification({ title: "Votre brief matinal Noon est prêt", body: "Votre journée analysée et vos priorités sont disponibles." });
      notification.on("click", () => dispatchDeepLink("noon://brief")); notification.show();
    }
    clearTimeout(briefRetryTimer); briefRetryTimer = null;
    return dailyData.brief;
  } catch (error) {
    if (notify && Notification.isSupported()) new Notification({ title: "Brief Noon momentanément indisponible", body: "Noon réessaiera automatiquement dans quinze minutes." }).show();
    logNoonEvent("error", "morning-brief", error.message);
    clearTimeout(briefRetryTimer); briefRetryTimer = setTimeout(() => { void checkCreativeBriefDue(); }, 15 * 60 * 1000);
    return null;
  } finally { creativeBriefRunning = false; scheduleCreativeBrief(); }
}

async function checkCreativeBriefDue() {
  const preferences = loadPreferences();
  if (!preferences.creativeBriefEnabled) return scheduleCreativeBrief();
  const response = await fetch(`${NOON_ORIGIN}/daily-brief/current?catchUp=false`, { headers: { "X-Noon-Local-Auth": localAuthSecret } }).catch(() => null);
  const state = response?.ok ? await response.json() : {};
  const dailyIsDue = state.catchUpAllowed === true;
  if (dailyIsDue) await runCreativeBrief();
  else scheduleCreativeBrief();
}

function scheduleCreativeBrief() {
  clearTimeout(creativeBriefTimer); creativeBriefTimer = null;
  const preferences = loadPreferences(); if (!preferences.creativeBriefEnabled) return;
  const next = nextRunAt({ time: preferences.creativeBriefTime });
  void fetch(`${NOON_ORIGIN}/daily-brief/schedule`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Noon-Local-Auth": localAuthSecret },
    body: JSON.stringify({ nextScheduledAt: next.toISOString() }),
  }).catch(() => {});
  creativeBriefTimer = setTimeout(() => { void checkCreativeBriefDue(); }, Math.min(next.getTime() - Date.now(), 2_147_000_000));
}
function registerIpc() {
  const registerTrustedHandler = createTrustedIpcRegistrar({
    ipcMain,
    trustedOrigin: NOON_ORIGIN,
  });
  registerTrustedHandler("noon:get-status", () => ({
    platform: process.platform, arch: process.arch, packaged: app.isPackaged,
    buildProfile, safeMode: safeModeRequested,
    liveVoiceActive, microphonePermission,
    shortcuts: registerShortcuts(), loginItem: app.getLoginItemSettings(),
  }));
  registerTrustedHandler("noon:get-preferences", loadPreferences);
  registerTrustedHandler("noon:set-preference", (_event, payload) => setPreference(payload?.key, payload?.value));
  registerTrustedHandler("noon:show-window", showMainWindow);
  registerTrustedHandler("noon:hide-window", () => mainWindow?.hide());
  registerTrustedHandler("noon:get-private-memory-protection", privateMemoryProtectionStatus);
  registerTrustedHandler("noon:set-private-memory-password", async (_event, password) => {
    if (privateMemoryPasswordVerifier()) throw Object.assign(new Error("Un mot de passe Noon est déjà configuré."), { code: "PRIVATE_MEMORY_PASSWORD_ALREADY_CONFIGURED" });
    if (privateMemoryProtectionStatus().touchIdAvailable) await systemPreferences.promptTouchID("autoriser la création du mot de passe de la mémoire privée");
    saveEncryptedSecret("private-memory-display-password", JSON.stringify(createPasswordVerifier(password)));
    return { configured: true };
  });
  registerTrustedHandler("noon:authenticate-private-memory", async (_event, payload = {}) => {
    if (Date.now() < privateMemoryAuthLockedUntil) throw Object.assign(new Error("Trop de tentatives. Réessayez dans quelques instants."), { code: "PRIVATE_MEMORY_AUTH_LOCKED" });
    if (payload.method === "touch-id") {
      if (!privateMemoryProtectionStatus().touchIdAvailable) throw Object.assign(new Error("Touch ID n’est pas disponible sur ce Mac."), { code: "PRIVATE_MEMORY_TOUCH_ID_UNAVAILABLE" });
      await systemPreferences.promptTouchID("afficher les données de la mémoire privée");
      privateMemoryAuthFailures = 0;
      return { authenticated: true, method: "touch-id" };
    }
    const verifier = privateMemoryPasswordVerifier();
    const authenticated = Boolean(verifier) && verifyPassword(payload.password, verifier);
    if (!authenticated) {
      privateMemoryAuthFailures += 1;
      if (privateMemoryAuthFailures >= 5) { privateMemoryAuthLockedUntil = Date.now() + 30_000; privateMemoryAuthFailures = 0; }
      throw Object.assign(new Error("Mot de passe Noon incorrect."), { code: "PRIVATE_MEMORY_AUTH_FAILED" });
    }
    privateMemoryAuthFailures = 0;
    return { authenticated: true, method: "password" };
  });
  registerTrustedHandler("noon:open-google-authorization", async (_event, rawUrl) => {
    if (!isSafeGoogleAuthorizationUrl(rawUrl)) {
      const error = new Error("URL d’autorisation Google invalide.");
      error.code = "GOOGLE_OAUTH_AUTHORIZATION_URL_INVALID";
      throw error;
    }
    await shell.openExternal(String(rawUrl));
    return true;
  });
  registerTrustedHandler("noon:set-live-active", (_event, active) => {
    liveVoiceActive = Boolean(active);
    if (liveVoiceActive) void wakeWordService?.stop(); else scheduleWakeWordResume();
    rebuildTrayMenu(); return liveVoiceActive;
  });
  registerTrustedHandler("noon:get-wake-word-status", () => ({
    ...wakeWordService?.getStatus(),
    configured: Boolean(loadEncryptedSecret("picovoice-access-key") && loadPreferences().wakeWordKeywordPath && loadPreferences().wakeWordModelPath),
    devices: WakeWordService.listDevices(),
  }));
  registerTrustedHandler("noon:get-openai-key-status", () => ({
    configured: Boolean(process.env.OPENAI_API_KEY || fs.existsSync(encryptedSecretPath("openai-api-key"))),
    available: Boolean(process.env.OPENAI_API_KEY),
    state: process.env.OPENAI_API_KEY ? "READY" : deferredOpenAISecret.state(),
  }));
  registerTrustedHandler("noon:set-openai-key", (_event, value) => {
    if (typeof value !== "string" || value.length > 500) throw new Error("Clé OpenAI invalide.");
    const normalized = value.trim();
    if (normalized && !/^sk-[A-Za-z0-9_-]{12,}$/.test(normalized)) {
      throw new Error("Le format de la clé OpenAI semble incorrect.");
    }
    saveEncryptedSecret("openai-api-key", normalized);
    if (normalized) process.env.OPENAI_API_KEY = normalized;
    else delete process.env.OPENAI_API_KEY;
    return { configured: Boolean(normalized) };
  });
  registerTrustedHandler("noon:set-picovoice-key", (_event, value) => {
    if (typeof value !== "string" || value.length > 500) throw new Error("Clé Picovoice invalide.");
    saveEncryptedSecret("picovoice-access-key", value.trim());
    return { configured: Boolean(value.trim()) };
  });
  registerTrustedHandler("noon:import-wake-model", async (_event, kind) => {
    const extension = kind === "keyword" ? ".ppn" : kind === "model" ? ".pv" : null;
    if (!extension) throw new Error("Type de modèle refusé.");
    const result = await dialog.showOpenDialog(mainWindow, { properties: ["openFile"], filters: [{ name: extension, extensions: [extension.slice(1)] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    const sourcePath = result.filePaths[0];
    if (path.extname(sourcePath).toLowerCase() !== extension) throw new Error("Extension de modèle incorrecte.");
    const directory = dataPath("wake-word");
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const destination = path.join(directory, kind === "keyword" ? "salut-noon.ppn" : "francais.pv");
    fs.copyFileSync(sourcePath, destination);
    const key = kind === "keyword" ? "wakeWordKeywordPath" : "wakeWordModelPath";
    const preferences = { ...loadPreferences(), [key]: destination };
    writeJson("preferences.json", preferences);
    if (preferences.wakeWordEnabled) scheduleWakeWordResume(50);
    return { imported: true, name: path.basename(destination) };
  });
  registerTrustedHandler("noon:reset-wake-word", async () => {
    await wakeWordService?.stop();
    saveEncryptedSecret("picovoice-access-key", "");
    const preferences = { ...loadPreferences(), wakeWordEnabled: false, wakeWordKeywordPath: null, wakeWordModelPath: null, wakeWordSensitivity: 0.5, wakeWordDeviceIndex: -1 };
    writeJson("preferences.json", preferences);
    return wakeWordService?.getStatus();
  });
  registerTrustedHandler("noon:share-conversation", async (_event, payload) => {
    const target = payload?.target;
    const markdown = typeof payload?.markdown === "string" ? payload.markdown : "";
    const suggestedName = typeof payload?.suggestedName === "string" &&
      /^[a-zA-Z0-9._-]{1,120}$/.test(payload.suggestedName)
      ? payload.suggestedName
      : "conversation-noon.md";
    if (!new Set(["mail", "whatsapp", "save"]).has(target)) throw new Error("Mode de partage refusé.");
    if (!markdown || markdown.length > 240000) throw new Error("Conversation vide ou trop volumineuse.");

    if (target === "save") {
      const result = await dialog.showSaveDialog(mainWindow, {
        title: "Enregistrer la conversation Noon",
        defaultPath: path.join(app.getPath("documents"), suggestedName),
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (result.canceled || !result.filePath) return { message: "Enregistrement annulé." };
      fs.writeFileSync(result.filePath, markdown, { encoding: "utf8", mode: 0o600 });
      return { message: "Conversation enregistrée dans le dossier choisi." };
    }

    const excerpt = markdown.slice(0, target === "mail" ? 12000 : 6000);
    if (target === "mail") {
      const mailUrl = `mailto:?subject=${encodeURIComponent("Conversation avec Noon")}&body=${encodeURIComponent(excerpt)}`;
      await shell.openExternal(mailUrl);
      return { message: "E-mail préparé. Aucun message n’a été envoyé automatiquement." };
    }

    const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(excerpt)}`;
    await shell.openExternal(whatsappUrl);
    return { message: "WhatsApp ouvert. Aucun message n’a été envoyé automatiquement." };
  });
  registerTrustedHandler("noon:open-system-settings", async (_event, section) => {
    const allowed = {
      microphone: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
      notifications: "x-apple.systempreferences:com.apple.preference.notifications",
    };
    if (!allowed[section]) return false;
    await shell.openExternal(allowed[section]); return true;
  });
  registerTrustedHandler("noon:list-local-permissions", () => localPermissionStore.load());
  registerTrustedHandler("noon:add-local-permission", async (_event, payload) => {
    const mode = payload?.mode === "read-write" ? "read-write" : "read-only";
    const result = await dialog.showOpenDialog(mainWindow, { title: "Autoriser un dossier pour Noon", properties: ["openDirectory", "createDirectory"] });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    return { canceled: false, permission: localPermissionStore.add({ path: result.filePaths[0], mode, output: payload?.output === true }) };
  });
  registerTrustedHandler("noon:remove-local-permission", (_event, targetPath) => {
    localPermissionStore.remove(String(targetPath || ""));
    return { status: "ok" };
  });
  registerTrustedHandler("noon:open-artifact", async (_event, targetPath) => {
    const realPath = fs.realpathSync(String(targetPath || ""));
    if (!localPermissionStore.roots("read-write").some((root) => realPath === root || realPath.startsWith(`${root}${path.sep}`))) throw new Error("Livrable hors d’un dossier autorisé.");
    const errorMessage = await shell.openPath(realPath); if (errorMessage) throw new Error(errorMessage); return true;
  });
  registerTrustedHandler("noon:reveal-artifact", (_event, targetPath) => {
    const realPath = fs.realpathSync(String(targetPath || ""));
    if (!localPermissionStore.roots("read-write").some((root) => realPath === root || realPath.startsWith(`${root}${path.sep}`))) throw new Error("Livrable hors d’un dossier autorisé.");
    shell.showItemInFolder(realPath); return true;
  });
  registerTrustedHandler("noon:preview-artifact", async (_event, targetPath) => {
    const realPath = fs.realpathSync(String(targetPath || ""));
    const previewRoot = fs.realpathSync(dataPath("creative-image-previews"));
    if (realPath !== previewRoot && !realPath.startsWith(`${previewRoot}${path.sep}`)) throw new Error("Aperçu temporaire non autorisé.");
    const metadata = await sharp(realPath).metadata();
    if (metadata.format !== "png") throw new Error("Aperçu non pris en charge.");
    const preview = await sharp(realPath)
      .resize({ width: 720, height: 720, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    return `data:image/webp;base64,${preview.toString("base64")}`;
  });
  registerTrustedHandler("noon:download-artifact", async (_event, targetPath) => {
    const realPath = fs.realpathSync(String(targetPath || ""));
    const previewRoot = fs.realpathSync(dataPath("creative-image-previews"));
    if (realPath !== previewRoot && !realPath.startsWith(`${previewRoot}${path.sep}`)) throw new Error("Aperçu temporaire non autorisé.");
    if ((await sharp(realPath).metadata()).format !== "png") throw new Error("Image temporaire invalide.");
    const selection = await dialog.showSaveDialog(mainWindow, {
      title: "Enregistrer l’image générée",
      defaultPath: path.join(app.getPath("downloads"), path.basename(realPath)),
      filters: [{ name: "Image PNG", extensions: ["png"] }],
      properties: ["showOverwriteConfirmation", "createDirectory"],
    });
    if (selection.canceled || !selection.filePath) return { canceled: true };
    const destination = selection.filePath.toLowerCase().endsWith(".png")
      ? selection.filePath
      : `${selection.filePath}.png`;
    fs.copyFileSync(realPath, destination);
    return { canceled: false, path: destination, name: path.basename(destination) };
  });
}
async function startNoon() {
  const userDataDirectory = app.getPath("userData");
  process.env.NOON_DATA_DIR = userDataDirectory;
  process.env.NOON_BUILD_PROFILE = buildProfile;
  if (safeModeRequested) process.env.NOON_SAFE_MODE = "1";
  const startupMarker = dataPath("startup-state.json");
  const previousStartupState = await measureStartupPhase("startup-state", async () => {
    const previous = readPreviousStartupState(startupMarker);
    writeStartupState(startupMarker, "starting", { profile: buildProfile, previousStartupState: previous });
    return previous;
  });
  const migratedPreferences = await measureStartupPhase("preferences", async () => {
    const savedPreferences = readJson("preferences.json", {});
    if (
      savedPreferences.creativeBriefTime === "08:00" &&
      savedPreferences.creativeBriefScheduleVersion !== 2
    ) {
      writeJson("preferences.json", {
        ...savedPreferences,
        creativeBriefTime: "07:00",
        creativeBriefScheduleVersion: 2,
      });
    }
    return readJson("preferences.json", {});
  });
  if (safeModeRequested) {
    recordSkippedStartupPhase("wake-word-config");
  }
  if (smokeTestRequested) {
    // Le smoke valide le cœur local et ne doit ni importer ni déchiffrer des
    // secrets provider dans son profil jetable avant d'atteindre /health.
    recordSkippedStartupPhase("openai-secret");
    recordSkippedStartupPhase("gemini-secret");
    recordSkippedStartupPhase("integration-environment");
  } else {
    startupDiagnostics.record("openai-secret", "deferred", { reasonCode: "OPTIONAL_SECRET_ON_DEMAND" });
    recordSkippedStartupPhase("openai-secret");
    startupDiagnostics.record("gemini-secret", "deferred", { reasonCode: "OPTIONAL_SECRET_ON_DEMAND" });
    recordSkippedStartupPhase("gemini-secret");
    await measureStartupPhase("integration-environment", async () => loadLocalIntegrationEnvironment());
  }
  await measureStartupPhase("logger", async () => {
    logNoonEvent = createRotatingLogger(userDataDirectory);
  });
  startupTimingLoggerReady = true;
  flushStartupPhaseTimings();
  logNoonEvent("info", "startup-begin", JSON.stringify({
    profile: buildProfile,
    safeMode: safeModeRequested,
    previousStartupState,
  }));
  await measureStartupPhase("wake-word-service", async () => {
    wakeWordService = new WakeWordService({ getAccessKey: () => loadEncryptedSecret("picovoice-access-key"), logger: logNoonEvent });
    wakeWordService.on("status", () => rebuildTrayMenu());
    wakeWordService.on("detected", () => {
      shell.beep();
      dispatchDeepLink("noon://wake");
      scheduleWakeWordResume(90_000);
    });
  });
  const migration = await measureStartupPhase("legacy-data-migration", async () => (
    migrateLegacyData(path.join(__dirname, ".."), userDataDirectory)
  ));
  logNoonEvent("audit", "data-migration", JSON.stringify({
    migrated: migration.migrated,
    skipped: migration.skipped,
  }));
  localAuthSecret = await measureStartupPhase("local-auth", async () => (
    smokeTestRequested
      ? crypto.randomBytes(32).toString("base64url")
      : getOrCreateLocalSecret()
  ));
  await measureStartupPhase("session-security", async () => configureSessionSecurity());
  serverController = await measureStartupPhase("server-composition", async () => (
    require(path.join(__dirname, "..", "server.js"))
  ));
  try {
    await measureStartupPhase("server-start", async () => (
      serverController.startNoonServer({ authSecret: localAuthSecret, port: NOON_PORT, loadOpenAIKey: () => deferredOpenAISecret.ensureSync(), loadGeminiKey: () => deferredGeminiSecret.ensureSync() })
    ));
    serverStartedLatencyMs = Date.now() - PROCESS_STARTED_AT;
    logNoonEvent("info", "server-started", `127.0.0.1:${NOON_PORT}`);
  }
  catch (error) {
    if (error.code !== "EADDRINUSE") throw error;
    const response = await fetch(`${NOON_ORIGIN}/health`).catch(() => null);
    if (!response?.ok || (await response.json()).service !== "Noon") {
      logNoonEvent("error", "port-conflict", "Port local 3000 indisponible");
      throw new Error("Le port 3000 est occupé par une autre application.");
    }
  }
  if (!safeModeRequested) {
    startOptionalStartupPhase({
      operation: () => measureStartupPhase(
        "wake-word-config",
        async () => initializeWakeWordConfiguration(migratedPreferences)
      ),
      onResolved: () => { void syncWakeWordState(); },
      onRejected: (error) => {
        wakeWordService?.setStatus("unavailable", "Réveil vocal indisponible.", {
          error: String(error?.code || error?.name || "ERROR"),
        });
      },
    });
  }
  microphonePermission = smokeTestRequested ? "skipped-smoke-test" : "waiting-permission";
  startOptionalStartupPhase({
    operation: () => measureStartupPhase("microphone-access", async () => requestMicrophoneAccess()),
    onResolved: () => { void syncWakeWordState(); },
    onRejected: (error) => {
      microphonePermission = "unavailable";
      logNoonEvent("error", "microphone-access", String(error?.code || error?.name || "ERROR"));
      void syncWakeWordState();
    },
  });
  flushStartupPhaseTimings();
  writeStartupState(startupMarker, "running", { profile: buildProfile });
  logNoonEvent("info", "startup-server-ready", JSON.stringify({ elapsedMs: Date.now() - PROCESS_STARTED_AT }));
}

app.on("open-url", (event, url) => { event.preventDefault(); dispatchDeepLink(url); });
app.on("second-instance", (_event, argv) => {
  showMainWindow();
  const link = argv.find((value) => value.startsWith("noon://"));
  if (link) dispatchDeepLink(link);
});

startupDiagnostics.record("app-when-ready", "start");
if (benchmarkControlCommandError) {
  app.whenReady().then(() => {
    console.log(JSON.stringify(publicCommandError(benchmarkControlCommandError)));
    app.exit(2);
  });
} else if (benchmarkControlCommand) {
  app.whenReady().then(async () => {
    const result = await executeBenchmarkControlCommand(benchmarkControlCommand, { loadAuthSecret: loadExistingLocalSecret });
    console.log(JSON.stringify(result));
    app.exit(0);
  }).catch((error) => {
    console.log(JSON.stringify(publicCommandError(error)));
    app.exit(1);
  });
} else if (hasSingleInstanceLock) {
  app.whenReady().then(async () => {
    startupDiagnostics.record("app-when-ready", "ok", { elapsedMs: Date.now() - PROCESS_STARTED_AT });
    app.setAsDefaultProtocolClient("noon");
    registerIpc();
    await startNoon();
    if (smokeTestRequested) {
      const response = await fetch(`${NOON_ORIGIN}/health`, {
        headers: { "X-Noon-Local-Auth": localAuthSecret },
      });
      if (!response.ok || (await response.json()).service !== "Noon") {
        throw new Error("Le smoke test packagé n'a pas atteint /health.");
      }
      writeJson("smoke-result.json", {
        status: "ok",
        smoke: "packaged-startup",
        profile: buildProfile,
        serverStartedObserved: true,
        serverStartedLatencyMs,
        healthReadyLatencyMs: Date.now() - PROCESS_STARTED_AT,
        elapsedMs: Date.now() - PROCESS_STARTED_AT,
      });
      console.log(JSON.stringify({ status: "ok", smoke: "packaged-startup", profile: buildProfile }));
      isQuitting = true;
      app.quit();
      return;
    }
    createWindow(); createTray(); registerShortcuts();
    if (loadPreferences().launchAtLogin && !app.getLoginItemSettings().openAtLogin) {
      app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true });
    }
    void checkCreativeBriefDue();
    if (!loadPreferences().showInDock) app.dock?.hide();
    await syncWakeWordState();
    for (const eventName of ["lock-screen", "suspend"]) {
      powerMonitor.on(eventName, () => {
        liveVoiceActive = false;
        void wakeWordService?.stop();
        sendSystemState("suspend"); rebuildTrayMenu();
      });
    }
    powerMonitor.on("unlock-screen", () => { if (loadPreferences().resumeWakeAfterUnlock) scheduleWakeWordResume(); });
    powerMonitor.on("resume", () => { sendSystemState("resume"); scheduleWakeWordResume(); void checkCreativeBriefDue(); });
    app.on("activate", showMainWindow);
  }).catch((error) => {
    // Conserve la cause exacte même si la boîte macOS est fermée immédiatement.
    try {
      fs.writeFileSync(
        dataPath("startup-error.log"),
        `${new Date().toISOString()}\n${error?.stack || error?.message || error}\n`,
        { mode: 0o600 }
      );
    } catch {}
    dialog.showErrorBox("Noon ne peut pas démarrer", error.message);
    isQuitting = true; app.quit();
  });
}

app.on("window-all-closed", () => {});
app.on("before-quit", () => { isQuitting = true; });
app.on("will-quit", async (event) => {
  clearTimeout(resumeWakeTimer);
  clearTimeout(briefRetryTimer);
  clearTimeout(creativeBriefTimer);
  await wakeWordService?.stop();
  globalShortcut.unregisterAll(); tray?.destroy(); tray = null;
  try { writeStartupState(dataPath("startup-state.json"), "clean", { profile: buildProfile }); } catch {}
  if (serverController?.server?.listening) {
    event.preventDefault();
    try { await serverController.stopNoonServer(); } finally { app.exit(0); }
  }
});
