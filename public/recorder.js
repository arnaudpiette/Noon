"use strict";

(() => {
  const bridge = window.noon?.recorder;
  const dialog = document.getElementById("recorderDialog");
  const open = document.getElementById("openRecorder");
  const close = document.getElementById("closeRecorder");
  const startButton = document.getElementById("recorderStart");
  const pauseButton = document.getElementById("recorderPause");
  const stopButton = document.getElementById("recorderStop");
  const name = document.getElementById("recorderName");
  const input = document.getElementById("recorderInput");
  const status = document.getElementById("recorderStatus");
  const library = document.getElementById("recorderLibrary");
  const elapsed = document.getElementById("recorderElapsed");
  const player = document.getElementById("recorderPlayback");
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
      label.textContent = `${item.title} · ${new Date(item.createdAt).toLocaleString("fr-FR")} · ${formatDuration(item.durationMs)} · ${item.state === "interrupted" ? "interrompu, segments récupérés" : item.state}${item.missingSegments ? ` · ${item.missingSegments} segment(s) manquant(s)` : ""}`;
      const play = document.createElement("button");
      play.type = "button";
      play.textContent = "Écouter";
      play.disabled = item.chunks.length === 0;
      play.addEventListener("click", async () => {
        play.disabled = true;
        try {
          const parts = [];
          for (const entry of item.chunks) {
            const chunk = await bridge.chunk(item.id, entry.index);
            const raw = atob(chunk.data);
            const bytes = Uint8Array.from(raw, (character) => character.charCodeAt(0));
            parts.push(bytes);
          }
          if (playbackUrl) URL.revokeObjectURL(playbackUrl);
          playbackUrl = URL.createObjectURL(new Blob(parts, { type: item.mimeType }));
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
      library.append(row);
    }
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
  close.addEventListener("click", () => dialog.close());
  startButton.addEventListener("click", () => { void begin(); });
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
})();
