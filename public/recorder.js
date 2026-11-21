"use strict";

// L'audio reste local tant que l'utilisateur n'autorise pas sa transcription distante.
(() => {
  const $ = id => document.getElementById(id);
  const els = {
    consent: $("recorderConsent"), cloudConsent: $("recorderCloudConsent"), start: $("recorderStart"),
    pause: $("recorderPause"), stop: $("recorderStop"), status: $("recorderStatus"),
    list: $("recorderList"), detail: $("recorderDetail"), title: $("recorderTitle"),
    audio: $("recorderAudio"), transcript: $("recorderTranscript"), detailStatus: $("recorderDetailStatus"),
    transcribe: $("recorderTranscribe"), save: $("recorderSaveTranscript"), export: $("recorderExportText"),
    remove: $("recorderDelete"), import: $("recorderImport"), analyze: $("recorderAnalyze"),
    analysis: $("recorderAnalysis"), analysisType: $("recorderAnalysisType"), exportFormat: $("recorderExportFormat"),
    speakerMode: $("recorderSpeakerMode"), segments: $("recorderSegments"),
  };
  let recorder = null;
  let stream = null;
  let active = null;
  let selected = null;
  let nextIndex = 0;
  let uploadQueue = Promise.resolve();
  let uploadError = null;
  let startedAt = 0;
  let pauseStartedAt = 0;
  let totalPauseMs = 0;
  let audioUrl = null;
  const MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];

  function setStatus(message) { els.status.textContent = message; }
  function detailStatus(message) { els.detailStatus.textContent = message; }
  function toggleRecording(state) {
    $("openRecorderButton").textContent = state === "recording" ? "● Dictaphone · en cours" : state === "paused" ? "◉ Dictaphone · pause" : "● Dictaphone";
    els.start.disabled = state !== "idle";
    els.pause.disabled = state === "idle" || state === "stopping";
    els.stop.disabled = state === "idle" || state === "stopping";
    els.pause.textContent = state === "paused" ? "Reprendre" : "Pause";
  }
  async function api(path, options = {}) {
    const response = await fetch(`/recorder${path}`, {
      ...options, headers: { "X-Noon-Request": "1", ...(options.body instanceof Blob ? { "Content-Type": options.body.type } : options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.message || "Dictaphone indisponible.");
    return value;
  }
  function fail(error) { setStatus(error.message || String(error)); }
  async function refresh() {
    const { recordings } = await api("");
    els.list.replaceChildren();
    if (!recordings.length) els.list.textContent = "Aucun enregistrement.";
    for (const item of recordings) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `${item.state === "recording" ? "◉ À récupérer · " : "▶ "}${item.title} · ${new Date(item.createdAt).toLocaleString("fr-FR")}`;
      button.setAttribute("aria-current", String(selected?.id === item.id));
      button.addEventListener("click", () => void select(item).catch(fail));
      els.list.append(button);
    }
  }
  async function select(item) {
    item = (await api(`/${item.id}`)).recording;
    selected = item;
    els.detail.hidden = false;
    els.title.textContent = item.title;
    els.transcript.value = item.transcript || "";
    renderAnalysis(item.analysis);
    renderSegments(item);
    els.cloudConsent.checked = false;
    els.transcribe.disabled = item.state !== "ready";
    els.save.disabled = item.state !== "ready";
    els.analyze.disabled = !item.transcript;
    detailStatus(item.state === "recording" ? "Capture interrompue : les fragments sauvegardés sont lisibles. Une nouvelle session doit être créée pour continuer." :
      `${item.chunkCount} fragment(s) sauvegardé(s) · transcription version ${item.transcriptRevision}.`);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    els.audio.removeAttribute("src");
    if (item.chunkCount) {
      const response = await fetch(`/recorder/${item.id}/audio`, { headers: { "X-Noon-Request": "1" } });
      if (!response.ok) throw new Error("Audio indisponible ou endommagé.");
      audioUrl = URL.createObjectURL(await response.blob());
      els.audio.src = audioUrl;
    }
    await refresh();
  }
  function stopTracks() {
    stream?.getTracks().forEach(track => track.stop());
    stream = null;
  }
  function enqueueChunk(blob) {
    if (!blob.size || !active) return;
    const index = nextIndex++;
    const id = active.id;
    uploadQueue = uploadQueue.then(async () => {
      const { recording } = await api(`/${id}/chunk?index=${index}`, { method: "POST", body: blob });
      active = recording;
      setStatus(`● Enregistrement · ${recording.chunkCount} fragment(s) sauvegardé(s)`);
    }).catch(error => { uploadError = error; throw error; });
    uploadQueue.catch(fail);
  }
  async function start() {
    if (recorder) return;
    if (!els.consent.checked) return setStatus("Confirme d'abord l'information et les accords des participants.");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return setStatus("Microphone ou MediaRecorder indisponible.");
    let created = null;
    try {
      const type = MIME_TYPES.find(MediaRecorder.isTypeSupported);
      if (!type) throw new Error("Aucun format d'enregistrement audio compatible.");
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const media = new MediaRecorder(stream, { mimeType: type });
      created = (await api("", { method: "POST", body: JSON.stringify({ mimeType: type.split(";")[0], consent: true }) })).recording;
      active = created;
      recorder = media;
      nextIndex = 0;
      uploadError = null;
      uploadQueue = Promise.resolve();
      startedAt = Date.now(); totalPauseMs = 0; pauseStartedAt = 0;
      media.addEventListener("dataavailable", event => enqueueChunk(event.data));
      media.addEventListener("error", event => { fail(new Error(event.error?.message || "Capture audio interrompue.")); stopTracks(); });
      media.addEventListener("stop", async () => {
        try {
          await uploadQueue;
          if (uploadError) throw uploadError;
          const durationMs = Date.now() - startedAt - totalPauseMs;
          const { recording } = await api(`/${created.id}/finish`, { method: "POST", body: JSON.stringify({ durationMs }) });
          setStatus("Enregistrement sauvegardé localement.");
          await select(recording);
        } catch (error) { fail(error); await refresh().catch(() => {}); }
        finally { stopTracks(); recorder = null; active = null; toggleRecording("idle"); }
      }, { once: true });
      media.start(2000);
      toggleRecording("recording");
      setStatus("● Enregistrement en cours · microphone actif");
    } catch (error) { stopTracks(); recorder = null; active = null; toggleRecording("idle"); fail(error); }
  }
  function pauseOrResume() {
    if (!recorder) return;
    if (recorder.state === "recording") {
      recorder.requestData();
      recorder.pause();
      pauseStartedAt = Date.now();
      toggleRecording("paused");
      setStatus("Pause · microphone toujours autorisé, aucune capture active");
    } else if (recorder.state === "paused") {
      totalPauseMs += Date.now() - pauseStartedAt;
      recorder.resume();
      toggleRecording("recording");
      setStatus("● Enregistrement repris");
    }
  }
  function stop() {
    if (!recorder || recorder.state === "inactive") return;
    if (recorder.state === "paused") totalPauseMs += Date.now() - pauseStartedAt;
    toggleRecording("stopping");
    setStatus("Finalisation des fragments audio…");
    recorder.stop();
    stopTracks();
  }
  async function importAudio(file) {
    if (!file) return;
    if (recorder) throw new Error("Termine d'abord la capture en cours.");
    const mimeType = file.type === "audio/x-m4a" ? "audio/mp4" : file.type.split(";")[0];
    if (!["audio/webm", "audio/mp4", "audio/ogg"].includes(mimeType)) throw new Error("Format audio non pris en charge.");
    if (file.size > 512 * 1024 * 1024) throw new Error("Fichier supérieur à 512 Mo.");
    if (!els.consent.checked) throw new Error("Confirme les accords nécessaires avant l'import.");
    const { recording } = await api("", { method: "POST", body: JSON.stringify({ title: file.name, mimeType, consent: true }) });
    try {
      for (let index = 0, offset = 0; offset < file.size; index++, offset += 2 * 1024 * 1024) {
        await api(`/${recording.id}/chunk?index=${index}`, { method: "POST", body: file.slice(offset, offset + 2 * 1024 * 1024, mimeType) });
        setStatus(`Import en cours : ${Math.round(Math.min(100, 100 * (offset + 2 * 1024 * 1024) / file.size))} %`);
      }
      const finished = (await api(`/${recording.id}/finish`, { method: "POST", body: JSON.stringify({ durationMs: 0 }) })).recording;
      await select(finished);
      setStatus("Audio importé localement.");
    } catch (error) { await refresh().catch(() => {}); throw error; }
  }
  function renderSegments(recording) {
    els.segments.replaceChildren();
    if (!recording.segments?.length) return;
    const heading = document.createElement("h3"); heading.textContent = "Passages horodatés · cliquer pour écouter";
    els.segments.append(heading);
    const speakers = new Set();
    recording.segments.forEach(segment => {
      const button = document.createElement("button"); button.type = "button";
      const label = segment.speaker ? (recording.speakers?.[segment.speaker] || `Intervenant ${segment.speaker}`) : "Intervenant inconnu";
      button.textContent = `${Math.floor(segment.start / 60)}:${String(Math.floor(segment.start % 60)).padStart(2, "0")} · ${label} · ${segment.text}`;
      button.addEventListener("click", () => { els.audio.currentTime = segment.start; void els.audio.play(); });
      els.segments.append(button);
      if (segment.speaker) speakers.add(segment.speaker);
    });
    for (const speaker of speakers) {
      const label = document.createElement("label"); label.textContent = `Nom de l'intervenant ${speaker} (facultatif) `;
      const input = document.createElement("input"); input.type = "text"; input.maxLength = 80;
      input.value = recording.speakers?.[speaker] || "";
      const save = document.createElement("button"); save.type = "button"; save.textContent = "Confirmer le nom";
      save.addEventListener("click", async () => {
        try { const { recording: updated } = await api(`/${recording.id}/speaker`, { method: "POST", body: JSON.stringify({ speaker, name: input.value, expectedRevision: recording.transcriptRevision }) }); await select(updated); }
        catch (error) { detailStatus(error.message); }
      });
      label.append(input, save); els.segments.append(label);
    }
  }
  function renderAnalysis(analysis) {
    els.analysis.replaceChildren();
    if (!analysis) return;
    const heading = document.createElement("h3"); heading.textContent = "Analyse à vérifier"; els.analysis.append(heading);
    const summary = document.createElement("p"); summary.textContent = analysis.summary; els.analysis.append(summary);
    for (const point of analysis.points) {
      const card = document.createElement("div"); card.className = "recorder-point";
      const label = document.createElement("strong"); label.textContent = `${point.kind} · ${point.text}`;
      const quote = document.createElement("p"); quote.textContent = `Citation vérifiée dans le texte : « ${point.quote} »`;
      card.append(label, quote);
      if (point.kind === "action") { const owner = document.createElement("small"); owner.textContent = `Responsable : ${point.owner} · Échéance : ${point.due} · à valider avant toute création de tâche`; card.append(owner); }
      els.analysis.append(card);
    }
    const warning = document.createElement("p"); warning.textContent = "Vérifie chaque citation en écoutant l’audio. Les passages horodatés, s’ils existent, proviennent du moteur de transcription et peuvent contenir des erreurs."; els.analysis.append(warning);
  }
  async function analyze() {
    if (!selected || !els.cloudConsent.checked) return detailStatus("Autorise explicitement l'envoi du texte à OpenAI pour l'analyse.");
    els.analyze.disabled = true;
    detailStatus("Analyse en cours…");
    try {
      const { recording } = await api(`/${selected.id}/analyze`, { method: "POST", body: JSON.stringify({ cloudConsent: true, expectedRevision: selected.transcriptRevision, type: els.analysisType.value }) });
      await select(recording);
      detailStatus("Analyse proposée : vérifie ses citations et ses conclusions.");
    } catch (error) { detailStatus(error.message); }
    finally { els.analyze.disabled = false; els.cloudConsent.checked = false; }
  }
  async function transcribe() {
    if (!selected || !els.cloudConsent.checked) return detailStatus("Autorise explicitement l'envoi audio pour transcrire.");
    const id = selected.id, expectedRevision = selected.transcriptRevision;
    els.transcribe.disabled = true;
    detailStatus("Transcription distante en cours…");
    try {
      const { recording } = await api(`/${id}/transcribe`, { method: "POST", body: JSON.stringify({ cloudConsent: true, expectedRevision, speakerMode: els.speakerMode.checked }) });
      await select(recording);
      detailStatus("Transcription enregistrée. Vérifie et corrige le texte avant de l'utiliser.");
    } catch (error) { detailStatus(error.message); }
    finally { els.transcribe.disabled = false; els.cloudConsent.checked = false; }
  }
  async function saveTranscript() {
    if (!selected) return;
    try {
      const { recording } = await api(`/${selected.id}/transcript`, { method: "POST", body: JSON.stringify({ text: els.transcript.value, expectedRevision: selected.transcriptRevision }) });
      await select(recording);
      detailStatus("Correction sauvegardée.");
    } catch (error) { detailStatus(error.message); }
  }
  async function exportText() {
    if (!selected?.transcript) return detailStatus("Aucune transcription à exporter.");
    try {
      const format = els.exportFormat.value;
      const response = await fetch(`/recorder/${selected.id}/export?format=${encodeURIComponent(format)}`, { headers: { "X-Noon-Request": "1" } });
      if (!response.ok) throw new Error((await response.json()).message || "Export indisponible.");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url; link.download = `noon-${selected.id}.${format}`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      detailStatus(`Export ${format.toUpperCase()} prêt. Vérifie le fichier avant diffusion.`);
    } catch (error) { detailStatus(error.message); }
  }
  async function remove() {
    if (!selected || selected.id === active?.id) return detailStatus("Termine d'abord la capture.");
    if (!window.confirm("Supprimer cet enregistrement, ses fragments et sa transcription locale ?")) return;
    try {
      await api(`/${selected.id}`, { method: "DELETE" });
      selected = null; els.detail.hidden = true;
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      els.audio.removeAttribute("src"); audioUrl = null;
      await refresh();
    } catch (error) { detailStatus(error.message); }
  }
  els.start.addEventListener("click", () => void start());
  els.pause.addEventListener("click", pauseOrResume);
  els.stop.addEventListener("click", stop);
  els.import.addEventListener("change", () => { void importAudio(els.import.files[0]).catch(fail).finally(() => { els.import.value = ""; }); });
  els.transcribe.addEventListener("click", () => void transcribe());
  els.analyze.addEventListener("click", () => void analyze());
  els.save.addEventListener("click", () => void saveTranscript());
  els.export.addEventListener("click", () => void exportText());
  els.remove.addEventListener("click", () => void remove());
  window.addEventListener("noon:recorder-open", () => void refresh().catch(fail));
})();
