let mediaRecorder = null;
let audioChunks = [];
let recordingTimer = null;
let recordingStartedAt = 0;
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
    // B3a : les approbations Goal Mode DEV ont leur carte dédiée (filtre défensif).
    for (const approval of data.approvals.filter((item) => item.skillName !== "goal_mode_dev")) {
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
// B3a : UI Goal Mode DEV, masquée tant que goals.mode-dev est OFF (404).
const goalModeDevPanel = document.getElementById("goalModeDevPanel");
if (goalModeDevPanel && window.NoonGoalModeDevUi) {
  const goalModeDevUi = window.NoonGoalModeDevUi.createGoalModeDevController({
    elements: { root: goalModeDevPanel },
    api: window.NoonGoalModeDevUi.createGoalModeDevApi({ fetchImpl: window.fetch.bind(window) }),
  });
  // B4b : l'entrée « Goal Mode DEV » du Control Center n'apparaît que flag actif.
  void goalModeDevUi.init().then((available) => window.NoonControlCenter?.setGoalModeDevAvailable?.(available === true));
}
// Connecteurs MCP : entrée du Control Center visible seulement si connectors.mcp est actif (sinon 404).
const mcpConnectorsPanel = document.getElementById("mcpConnectorsPanel");
if (mcpConnectorsPanel && window.NoonMcpConnectorsUi) {
  const mcpConnectorsUi = window.NoonMcpConnectorsUi.createMcpConnectorsController({
    elements: { root: mcpConnectorsPanel },
    api: window.NoonMcpConnectorsUi.createMcpConnectorsApi({ fetchImpl: window.fetch.bind(window) }),
    openExternal: window.noon?.openExternal ? (url) => window.noon.openExternal(url) : null,
  });
  window.NoonMcpConnectors = Object.freeze({ refresh: () => mcpConnectorsUi.refresh() });
  void mcpConnectorsUi.init().then((available) => window.NoonControlCenter?.setMcpAvailable?.(available === true));
}
// SelfDev : entrée du Control Center visible seulement si selfdev.v1 est actif (sinon 404).
const selfDevPanel = document.getElementById("selfDevPanel");
if (selfDevPanel && window.NoonSelfDevUi) {
  const selfDevUi = window.NoonSelfDevUi.createSelfDevController({
    elements: { root: selfDevPanel },
    api: window.NoonSelfDevUi.createSelfDevApi({ fetchImpl: window.fetch.bind(window) }),
  });
  window.NoonSelfDev = Object.freeze({ refresh: () => selfDevUi.refresh() });
  void selfDevUi.init().then((available) => window.NoonControlCenter?.setSelfDevAvailable?.(available === true));
}
// Caractère (V3-L1) : cadrans de la charte dans les réglages rapides.
const characterSettings = document.getElementById("characterSettings");
if (characterSettings && window.NoonCharacterUi) {
  const characterUi = window.NoonCharacterUi.createCharacterController({
    elements: { root: characterSettings },
    api: window.NoonCharacterUi.createCharacterApi({ fetchImpl: window.fetch.bind(window) }),
  });
  void characterUi.init();
}
// Compagnon iPhone : entrée visible seulement si remote.lan est actif (sinon 404).
const iphoneCompanionPanel = document.getElementById("iphoneCompanionPanel");
if (iphoneCompanionPanel && window.NoonIphoneCompanionUi) {
  const iphoneCompanionUi = window.NoonIphoneCompanionUi.createIphoneCompanionController({
    elements: { root: iphoneCompanionPanel },
    api: window.NoonIphoneCompanionUi.createIphoneCompanionApi({ fetchImpl: window.fetch.bind(window) }),
  });
  window.NoonIphoneCompanion = Object.freeze({ refresh: () => iphoneCompanionUi.refresh() });
  void iphoneCompanionUi.init().then((available) => window.NoonControlCenter?.setIphoneCompanionAvailable?.(available === true));
}
// Missions DEV (V3-L5d) : entrée visible seulement si dev.missions est actif (sinon 404).
const devMissionsPanel = document.getElementById("devMissionsPanel");
if (devMissionsPanel && window.NoonDevMissionsUi) {
  const devMissionsUi = window.NoonDevMissionsUi.createDevMissionsController({
    elements: { root: devMissionsPanel },
    api: window.NoonDevMissionsUi.createDevMissionsApi({ fetchImpl: window.fetch.bind(window) }),
  });
  window.NoonDevMissions = Object.freeze({ refresh: () => devMissionsUi.refresh() });
  void devMissionsUi.init().then((available) => window.NoonControlCenter?.setDevMissionsAvailable?.(available === true));
}
// Santé de Noon (V3-L6) : bilan local en lecture seule, sans flag.
const noonHealthPanel = document.getElementById("noonHealthPanel");
if (noonHealthPanel && window.NoonHealthUi) {
  const noonHealthUi = window.NoonHealthUi.createNoonHealthController({
    elements: { root: noonHealthPanel },
    api: window.NoonHealthUi.createNoonHealthApi({ fetchImpl: window.fetch.bind(window) }),
  });
  window.NoonHealth = Object.freeze({ refresh: () => noonHealthUi.refresh() });
  void noonHealthUi.init().then((available) => window.NoonControlCenter?.setHealthAvailable?.(available === true));
}
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
  if (link.action === "resume") {
    switchView("chat");
    void showResumeBriefing("Où j'en étais ?");
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
