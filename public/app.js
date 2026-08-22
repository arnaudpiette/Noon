// Éléments conservés pour rester compatible avec les routes et fonctions existantes.
const chatForm = document.getElementById("chatForm");
const promptInput = document.getElementById("prompt");
const conversation = document.getElementById("conversation");
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
const micButton = document.getElementById("micButton");
const modeButtons = document.querySelectorAll(".mode-btn");
const viewButtons = document.querySelectorAll(".view-btn");
const views = document.querySelectorAll(".view");
const sidebarToggle = document.getElementById("sidebarToggle");
const sidebarBackdrop = document.getElementById("sidebarBackdrop");

let currentSpeech = null;
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

function updateActivity(text) {
  activity.textContent = text;
  coreActivity.textContent = text;
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

function addMessage(author, text, className) {
  const message = document.createElement("div");
  const authorLabel = document.createElement("span");
  const paragraph = document.createElement("p");

  message.className = `message ${className}`;
  authorLabel.className = "author";
  authorLabel.textContent = author;
  paragraph.textContent = text;
  message.append(authorLabel, paragraph);

  conversation.appendChild(message);
  conversation.scrollTop = conversation.scrollHeight;
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

function speakNoon(text) {
  if (!("speechSynthesis" in window)) {
    updateActivity("Synthèse vocale indisponible.");
    setVisualState("idle");
    return;
  }

  currentSpeech = null;
  window.speechSynthesis.cancel();
  stopSpeechAnimation();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "fr-FR";
  utterance.rate = 1;
  utterance.pitch = 0.92;
  utterance.volume = 1;

  const voices = window.speechSynthesis.getVoices();
  const frenchVoice = voices.find((voice) => voice.lang.toLowerCase().startsWith("fr")) || voices[0];
  if (frenchVoice) utterance.voice = frenchVoice;

  utterance.addEventListener("start", () => {
    updateActivity("Noon parle…");
    setVisualState("speaking");
    startSpeechAnimation();
  });

  utterance.addEventListener("end", () => {
    if (currentSpeech !== utterance) return;
    stopSpeechAnimation();
    currentSpeech = null;
    updateActivity("En attente.");
    setVisualState("idle");
  });

  utterance.addEventListener("error", () => {
    if (currentSpeech !== utterance) return;
    stopSpeechAnimation();
    currentSpeech = null;
    updateActivity("Erreur de synthèse vocale.");
    setVisualState("idle");
  });

  currentSpeech = utterance;
  window.speechSynthesis.speak(utterance);
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

async function sendQuestion(question) {
  if (!question) return;

  currentSpeech = null;
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  stopSpeechAnimation();
  addMessage("Vous", question, "user");
  updateFocusFromQuestion(question);
  promptInput.value = "";
  promptInput.style.height = "auto";
  updateActivity("Noon réfléchit…");
  setVisualState("thinking");
  startActivityPolling();

  try {
    const params = new URLSearchParams({
      q: question,
      mode: currentMode,
    });

    params.set("sessionId", currentSessionId);

    if (currentFocus) {
      params.set("focus", currentFocus);
    }

    if (currentFocusPath) {
      params.set("focusPath", currentFocusPath);
    }

    const response = await fetch(`/ai?${params.toString()}`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "Erreur Noon");
    }

    stopActivityPolling();
    addMessage("Noon", data.answer, "noon");
    updateActivity("Réponse reçue.");
    speakNoon(data.answer);
    loadBudget();
  } catch (error) {
    stopActivityPolling();
    addMessage("Noon", error.message, "noon");
    updateActivity("Erreur.");
    setVisualState("idle");
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

clearChatButton.addEventListener("click", async () => {
  conversation.innerHTML = `
    <div class="message noon">
      <span class="author">Noon</span>
      <p>Nouvelle session. Je suis prêt.</p>
    </div>
  `;

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
        window.clearTimeout(recordingTimer);

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

    isListening = true;
    recordingStartedAt = Date.now();

    micButton.classList.add("active");
    micButton.setAttribute("aria-pressed", "true");

    updateActivity(
      "À l’écoute — recliquez pour envoyer."
    );

    setVisualState("listening");

    recordingTimer = window.setTimeout(
      stopRecording,
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

function stopRecording() {
  if (
    !mediaRecorder ||
    mediaRecorder.state !== "recording"
  ) {
    return;
  }

  isListening = false;
  micButton.classList.remove("active");
  micButton.setAttribute("aria-pressed", "false");

  updateActivity("Traitement de la voix…");

  mediaRecorder.stop();
}

micButton.addEventListener("click", async () => {
  if (isListening) {
    stopRecording();
    return;
  }

  await startRecording();
});

promptInput.addEventListener("input", () => {
  promptInput.style.height = "auto";
  promptInput.style.height = `${Math.min(promptInput.scrollHeight, 100)}px`;
});

promptInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
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
loadConversationHistory();

function stopNoonAudio() {
  discardRecording = true;

  window.clearTimeout(recordingTimer);

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
