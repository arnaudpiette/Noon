"use strict";

(() => {
  const bridge = window.noon?.recorder;
  const dialog = document.getElementById("recorderDialog");
  const open = document.getElementById("openRecorder");
  const close = document.getElementById("closeRecorder");
  const startButton = document.getElementById("recorderStart");
  const importButton = document.getElementById("recorderImport");
  const pauseButton = document.getElementById("recorderPause");
  const stopButton = document.getElementById("recorderStop");
  const name = document.getElementById("recorderName");
  const input = document.getElementById("recorderInput");
  const testInput = document.getElementById("recorderTestInput");
  const status = document.getElementById("recorderStatus");
  const library = document.getElementById("recorderLibrary");
  const elapsed = document.getElementById("recorderElapsed");
  const player = document.getElementById("recorderPlayback");
  const transcriptSection = document.getElementById("recorderTranscriptSection");
  const transcriptEditor = document.getElementById("recorderTranscript");
  const saveTranscriptButton = document.getElementById("recorderSaveTranscript");
  const analysisSection = document.getElementById("recorderAnalysisSection");
  const analysisContent = document.getElementById("recorderAnalysis");
  const analyzeButton = document.getElementById("recorderAnalyze");
  let selectedRecordingId = null;
  let session = null;
  let opening = false;
  let media = null;
  let stream = null;
  let writes = Promise.resolve();
  let pausePending = false;
  let stopping = false;
  let deviceLost = false;
  let pausedAt = 0;
  let pausedMs = 0;
  let startedAt = 0;
  let savedDuration = 0;
  let nextIndex = 0;
  let playbackUrl = null;
  const message = (text) => { status.textContent = text; };
  function controls(active, paused = false) {
    startButton.disabled = active;
    importButton.disabled = active;
    pauseButton.disabled = !active;
    pauseButton.textContent = paused ? "Reprendre" : "Pause";
    stopButton.disabled = !active;
    name.disabled = active;
    input.disabled = active;
  }
  function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  }
  setInterval(() => {
    if (!session) return;
    elapsed.textContent = formatDuration(Date.now() - startedAt - pausedMs - (pausedAt ? Date.now() - pausedAt : 0));
  }, 500);
  async function refreshInputs() {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const current = input.value;
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(({ kind }) => kind === "audioinput");
    input.replaceChildren(new Option("Microphone système", ""));
    devices.forEach(({ deviceId, label }, index) => input.add(new Option(label || `Microphone ${index + 1}`, deviceId)));
    if (current && devices.some(({ deviceId }) => deviceId === current)) input.value = current;
    else if (current) message("Le microphone choisi est introuvable. Sélectionne une autre entrée.");
    if (!devices.length) message("Aucun microphone détecté. Le micro interne du Mac est peut-être introuvable.");
  }
  navigator.mediaDevices?.addEventListener?.("devicechange", () => {
    if (session && input.value) {
      const selected = input.value;
      navigator.mediaDevices.enumerateDevices().then((devices) => {
        if (!devices.some(({ kind, deviceId }) => kind === "audioinput" && deviceId === selected)) {
          deviceLost = true;
          message("Le microphone sélectionné a disparu. Termine la capture avant de choisir une autre entrée.");
          if (media?.state !== "inactive") media.stop();
        }
      }).catch(() => {});
    }
    if (!session) void refreshInputs().catch(() => {});
  });
  async function renderLibrary() {
    const recordings = await bridge.list();
    library.replaceChildren();
    for (const item of recordings) {
      const row = document.createElement("div");
      row.className = "recorder-item";
      const label = document.createElement("span");
      label.textContent = `${item.title} · ${new Date(item.createdAt).toLocaleString("fr-FR")} · ${item.inputLabel === "Fichier importé" ? "durée à déterminer" : formatDuration(item.durationMs)} · ${item.state === "interrupted" ? "interrompu, segments récupérés" : item.state}${item.missingSegments ? ` · ${item.missingSegments} segment(s) manquant(s)` : ""}`;
      const play = document.createElement("button");
      play.type = "button";
      play.textContent = "Écouter";
      play.disabled = item.chunks.length === 0;
      play.addEventListener("click", async () => {
        play.disabled = true;
        try {
          const blob = await loadAudio(item, 150 * 1024 * 1024);
          if (playbackUrl) URL.revokeObjectURL(playbackUrl);
          playbackUrl = URL.createObjectURL(blob);
          player.src = playbackUrl;
          await player.play();
        } catch (error) { message(`Lecture impossible : ${error.message}`); }
        finally { play.disabled = false; }
      });
      row.append(label, play);
      const exportButton = document.createElement("button");
      exportButton.type = "button";
      exportButton.textContent = "Exporter l'audio";
      exportButton.disabled = item.chunks.length === 0;
      exportButton.addEventListener("click", async () => {
        try {
          const result = await bridge.exportAudio(item.id);
          if (!result.canceled) message(`Audio exporté : ${result.name}`);
        } catch (error) { message(`Export impossible : ${error.message}`); }
      });
      row.append(exportButton);
      const rename = document.createElement("button");
      rename.type = "button";
      rename.textContent = "Renommer";
      rename.addEventListener("click", async () => {
        const title = window.prompt("Nouveau titre de l'enregistrement", item.title);
        if (title === null) return;
        try { await bridge.rename(item.id, title); await renderLibrary(); }
        catch (error) { message(`Renommage impossible : ${error.message}`); }
      });
      row.append(rename);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Supprimer";
      remove.addEventListener("click", async () => {
        if (!window.confirm(`Supprimer définitivement « ${item.title} » et ses segments locaux ? Les copies déjà exportées resteront sur le disque.`)) return;
        try {
          await bridge.delete(item.id);
          if (selectedRecordingId === item.id) {
            selectedRecordingId = null;
            transcriptSection.hidden = true;
            analysisSection.hidden = true;
            player.removeAttribute("src");
          }
          message("Enregistrement local supprimé.");
          await renderLibrary();
        } catch (error) { message(`Suppression impossible : ${error.message}`); }
      });
      row.append(remove);
      const transcribe = document.createElement("button");
      transcribe.type = "button";
      transcribe.textContent = "Transcrire";
      transcribe.disabled = item.chunks.length === 0 || Boolean(item.missingSegments);
      transcribe.addEventListener("click", async () => {
        if (!window.confirm("Envoyer cet enregistrement audio à OpenAI pour transcription ? Le contenu sortira de ton Mac. Les frais et la conservation dépendent du service. Annuler conserve l'audio local.")) return;
        transcribe.disabled = true;
        try {
          const blob = await loadAudio(item, 10 * 1024 * 1024);
          message("Transcription en cours…");
          const response = await fetch("/transcribe", {
            method: "POST", headers: { "Content-Type": item.mimeType, "X-Audio-Duration-Ms": String(item.durationMs) }, body: blob,
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.message || "Service de transcription indisponible.");
          const text = String(result.text || "").trim();
          await bridge.saveTranscript(item.id, text, "openai");
          selectedRecordingId = item.id;
          transcriptSection.hidden = false;
          transcriptEditor.value = text;
          message("Transcription disponible. Corrige le texte avant de l'utiliser.");
        } catch (error) { message(`Transcription impossible : ${error.message}`); }
        finally { transcribe.disabled = false; }
      });
      row.append(transcribe);
      if (item.transcript) {
        const edit = document.createElement("button");
        edit.type = "button";
        edit.textContent = "Corriger le texte";
        edit.addEventListener("click", () => {
          selectedRecordingId = item.id;
          transcriptSection.hidden = false;
          transcriptEditor.value = item.transcript.text;
        });
        row.append(edit);
      }
      if (item.analysis) {
        const view = document.createElement("button");
        view.type = "button";
        view.textContent = item.analysis.stale ? "Analyse périmée" : "Voir l'analyse";
        view.addEventListener("click", () => {
          selectedRecordingId = item.id;
          showAnalysis(item.analysis);
        });
        row.append(view);
      }
      library.append(row);
    }
  }
  function showAnalysis(analysis) {
    analysisSection.hidden = false;
    analysisContent.replaceChildren();
    const summary = document.createElement("p");
    summary.textContent = analysis.stale
      ? `Cette analyse utilise une ancienne transcription. Relance l'analyse. \n${analysis.summary}`
      : analysis.summary;
    analysisContent.append(summary);
    for (const claim of analysis.claims) {
      const paragraph = document.createElement("p");
      paragraph.textContent = `${claim.type} · ${claim.text} · Source : « ${claim.quote} » · À vérifier`;
      analysisContent.append(paragraph);
    }
  }
  async function loadAudio(item, limit) {
    const bytes = item.chunks.reduce((sum, chunk) => sum + chunk.bytes, 0);
    if (bytes > limit) throw new Error("Audio trop volumineux pour cette opération. Exporte le fichier audio.");
    if (item.missingSegments) throw new Error("Certains segments manquent ; l'audio complet n'est plus disponible.");
    const parts = [];
    for (const entry of item.chunks) {
      const chunk = await bridge.chunk(item.id, entry.index);
      const raw = atob(chunk.data);
      parts.push(Uint8Array.from(raw, (character) => character.charCodeAt(0)));
    }
    return new Blob(parts, { type: item.mimeType });
  }
  async function finish() {
    try {
      await writes;
      await bridge.state(session.id, deviceLost ? "interrupted" : "available");
      message(deviceLost ? "Microphone perdu. Les segments déjà écrits restent disponibles." : "Enregistrement disponible.");
    } catch (error) {
      message(`Enregistrement interrompu : ${error.message}. Les segments déjà écrits restent récupérables.`);
      try { await bridge.state(session.id, "interrupted"); } catch {}
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      media = null;
      session = null;
      pausePending = false;
      stopping = false;
      controls(false);
      await renderLibrary().catch(() => {});
    }
  }
  function enqueueChunk(blob) {
    if (!blob.size || !session) return;
    const duration = Math.max(0, Date.now() - startedAt - pausedMs - (pausedAt ? Date.now() - pausedAt : 0) - savedDuration);
    savedDuration += duration;
    writes = writes.then(async () => {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 8192) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
      }
      const data = btoa(binary);
      await bridge.append(session.id, { index: nextIndex, durationMs: duration, data });
      nextIndex += 1;
    }).catch((error) => {
      deviceLost = true;
      message(`Écriture audio impossible : ${error.message}. Capture arrêtée.`);
      if (media?.state !== "inactive") media.stop();
      throw error;
    });
  }
  async function begin() {
    if (!bridge || session || opening) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return message("Enregistrement indisponible dans cet environnement.");
    opening = true;
    startButton.disabled = true;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: input.value ? { deviceId: { exact: input.value } } : true, video: false,
      });
      const track = stream.getAudioTracks()[0];
      if (!track || track.readyState !== "live") throw new Error("Aucune entrée micro active.");
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((type) => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error("Format audio non pris en charge.");
      media = new MediaRecorder(stream, { mimeType });
      session = await bridge.create({ title: name.value || "Nouvel enregistrement", inputLabel: track.label, mimeType });
      startedAt = Date.now();
      savedDuration = 0; pausedMs = 0; pausedAt = 0; nextIndex = 0;
      writes = Promise.resolve(); pausePending = false; stopping = false; deviceLost = false;
      track.addEventListener("ended", () => {
        if (session && !stopping) {
          deviceLost = true;
          message("Microphone déconnecté. Les segments enregistrés seront conservés.");
          if (media?.state !== "inactive") media.stop();
        }
      }, { once: true });
      media.addEventListener("dataavailable", (event) => {
        enqueueChunk(event.data);
        if (pausePending) {
          pausePending = false;
          writes = writes.then(() => bridge.state(session.id, "paused")).then(() => {
            controls(true, true);
            message("Enregistrement en pause.");
          }).catch((error) => { deviceLost = true; message(error.message); if (media?.state !== "inactive") media.stop(); });
        }
      });
      media.addEventListener("stop", () => { void finish(); }, { once: true });
      media.start(4000);
      controls(true);
      message(`Enregistrement actif : ${track.label || "microphone système"}.`);
      void refreshInputs().catch(() => {});
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      if (session) {
        try { await bridge.state(session.id, "interrupted"); } catch {}
        session = null;
      }
      message(error.name === "NotAllowedError" ? "Accès au microphone refusé dans macOS."
        : error.name === "NotFoundError" || error.name === "OverconstrainedError"
          ? "Microphone introuvable. Vérifie le micro interne du Mac ou choisis un micro externe."
          : `Enregistrement impossible : ${error.message}`);
      controls(false);
    } finally {
      opening = false;
    }
  }
  open.addEventListener("click", () => {
    if (!bridge) return message("Le Dictaphone nécessite l'application Noon pour macOS.");
    dialog.showModal();
    void refreshInputs().catch((error) => message(error.message));
    void renderLibrary().catch((error) => message(error.message));
  });
  testInput.addEventListener("click", async () => {
    if (session || opening) return;
    testInput.disabled = true;
    let testStream;
    let context;
    try {
      testStream = await navigator.mediaDevices.getUserMedia({
        audio: input.value ? { deviceId: { exact: input.value } } : true, video: false,
      });
      context = new AudioContext();
      const source = context.createMediaStreamSource(testStream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      let peak = 0;
      message("Parle maintenant pour tester le microphone…");
      for (let tick = 0; tick < 20; tick += 1) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        analyser.getFloatTimeDomainData(samples);
        const level = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
        peak = Math.max(peak, level);
      }
      message(peak > 0.012
        ? `Signal détecté sur ${testStream.getAudioTracks()[0]?.label || "le microphone"}.`
        : "Aucun signal détecté pendant le test. Vérifie Réglages > Son > Entrée ou essaie un autre micro ; le silence ne prouve pas une panne.");
    } catch (error) {
      message(error.name === "NotFoundError" || error.name === "OverconstrainedError"
        ? "Microphone introuvable. Le micro interne du Mac n'est peut-être pas détecté ; choisis une autre entrée."
        : error.name === "NotAllowedError" ? "Autorisation du microphone refusée." : `Test impossible : ${error.message}`);
    } finally {
      testStream?.getTracks().forEach((track) => track.stop());
      await context?.close().catch(() => {});
      testInput.disabled = false;
    }
  });
  close.addEventListener("click", () => dialog.close());
  startButton.addEventListener("click", () => { void begin(); });
  importButton.addEventListener("click", async () => {
    if (!bridge || session || opening) return;
    importButton.disabled = true;
    try {
      const result = await bridge.importAudio();
      if (!result.canceled) {
        message("Audio importé localement. Vérifie sa lecture avant de le transcrire.");
        await renderLibrary();
      }
    } catch (error) { message(`Import impossible : ${error.message}`); }
    finally { importButton.disabled = false; }
  });
  pauseButton.addEventListener("click", async () => {
    if (!session || !media) return;
    if (media.state === "recording") {
      pauseButton.disabled = true;
      pausePending = true;
      media.requestData();
      media.pause();
      pausedAt = Date.now();
    } else if (media.state === "paused" && !pausePending) {
      try {
        await writes;
        await bridge.state(session.id, "recording");
        pausedMs += Date.now() - pausedAt;
        pausedAt = 0;
        media.resume();
        controls(true);
        message("Enregistrement repris.");
      } catch (error) { message(error.message); }
    }
  });
  stopButton.addEventListener("click", () => {
    if (!media || media.state === "inactive") return;
    stopping = true;
    controls(true);
    pauseButton.disabled = true; stopButton.disabled = true;
    message("Finalisation de l'audio…");
    media.stop();
  });
  saveTranscriptButton.addEventListener("click", async () => {
    if (!selectedRecordingId) return;
    try {
      await bridge.saveTranscript(selectedRecordingId, transcriptEditor.value, "manual");
      message("Correction de la transcription enregistrée localement.");
      await renderLibrary();
      analysisSection.hidden = true;
    } catch (error) { message(`Correction impossible : ${error.message}`); }
  });
  analyzeButton.addEventListener("click", async () => {
    if (!selectedRecordingId) return;
    const item = (await bridge.list()).find(({ id }) => id === selectedRecordingId);
    if (!item?.transcript || transcriptEditor.value !== item.transcript.text) {
      message("Enregistre d'abord tes corrections avant l'analyse."); return;
    }
    if (!window.confirm("Envoyer la transcription à OpenAI pour une synthèse ? Le texte sortira de ton Mac. Les propositions devront être vérifiées avant toute action.")) return;
    analyzeButton.disabled = true;
    try {
      message("Analyse en cours…");
      const response = await fetch("/recorder/analyze", {
        method: "POST", headers: { "Content-Type": "application/json", "X-Noon-Request": "1" },
        body: JSON.stringify({ transcript: item.transcript.text }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Analyse indisponible.");
      const analysis = await bridge.saveAnalysis(item.id, result.analysis, item.transcript.revision);
      showAnalysis(analysis);
      message("Brouillon d'analyse disponible. Vérifie les citations avant de l'utiliser.");
      await renderLibrary();
    } catch (error) { message(`Analyse impossible : ${error.message}`); }
    finally { analyzeButton.disabled = false; }
  });
  document.getElementById("recorderExportReport").addEventListener("click", async () => {
    if (!selectedRecordingId) return;
    try {
      const format = document.getElementById("recorderReportFormat").value;
      const result = await bridge.exportReport(selectedRecordingId, format);
      if (!result.canceled) message(`Brouillon exporté : ${result.name}. Vérifie les propositions et citations.`);
    } catch (error) { message(`Export du rapport impossible : ${error.message}`); }
  });
  for (const [elementId, format] of [["recorderExportText", "txt"], ["recorderExportMarkdown", "md"]]) {
    document.getElementById(elementId).addEventListener("click", async () => {
      if (!selectedRecordingId) return;
      try {
        if (transcriptEditor.value !== (await bridge.list()).find(({ id }) => id === selectedRecordingId)?.transcript?.text) {
          message("Enregistre d'abord tes corrections avant l'export.");
          return;
        }
        const result = await bridge.exportTranscript(selectedRecordingId, format);
        if (!result.canceled) message(`Transcription exportée : ${result.name}`);
      } catch (error) { message(`Export impossible : ${error.message}`); }
    });
  }
})();
