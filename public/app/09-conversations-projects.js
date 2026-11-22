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

