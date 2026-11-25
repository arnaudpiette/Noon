"use strict";

// Recorder V1 (V3-L8), tranche E.1 + E.5 : panneau « Enregistreur » du Control Center et voyant
// dans la barre du haut. L'audio reste sur le Mac : un morceau est sauvegardé toutes les
// CHUNK_MS millisecondes, dans l'ordre. Toutes les valeurs serveur sont rendues en texte.
(function attachRecorderUi(global) {
  const BASE = "/api/recorder/sessions";
  const CHUNK_MS = 5000;
  const MAX_DURATION_MS = 4 * 60 * 60 * 1000;
  const MIME_CANDIDATES = Object.freeze(["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]);
  const STATUS_LABELS = Object.freeze({ recording: "En cours", paused: "En pause", stopped: "Terminé", interrupted: "Interrompu" });
  const ERROR_MESSAGES = Object.freeze({
    RECORDER_DISABLED: "Enregistreur désactivé.",
    RECORDER_ALREADY_ACTIVE: "Un enregistrement est déjà en cours.",
    RECORDER_CONSENT_REQUIRED: "Préviens d'abord les participants que la réunion est enregistrée.",
    RECORDER_FORMAT_UNSUPPORTED: "Ce Mac ne propose pas de format audio compatible.",
    RECORDER_SEQ_GAP: "Sauvegarde interrompue : un morceau audio manque.",
    RECORDER_TOO_LARGE: "Enregistrement trop long : arrête-le et lance-en un nouveau.",
    RECORDER_STILL_ACTIVE: "Arrête d'abord l'enregistrement.",
    MIC_PERMISSION_DENIED: "Autorisation du micro refusée : autorise Noon dans Réglages Système → Confidentialité → Micro.",
    MIC_DEVICE_UNAVAILABLE: "Micro sélectionné indisponible. Noon n'en choisit pas un autre à ta place.",
  });

  const messageFor = (error) => ERROR_MESSAGES[String(error?.code || "")] || "Erreur de l'enregistreur.";

  function formatDuration(ms) {
    const total = Math.max(0, Math.floor(Number(ms || 0) / 1000));
    const hours = Math.floor(total / 3600); const minutes = Math.floor((total % 3600) / 60); const seconds = total % 60;
    const pad = (value) => String(value).padStart(2, "0");
    return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
  }
  function formatBytes(bytes) {
    const value = Number(bytes || 0);
    return value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1).replace(".", ",")} Mo` : `${Math.ceil(value / 1024)} Ko`;
  }
  function pickMimeType(isSupported) {
    return MIME_CANDIDATES.find((type) => { try { return isSupported(type); } catch { return false; } }) || null;
  }

  function createRecorderApi({ fetchImpl }) {
    async function request(method, path, { json, body, headers = {} } = {}) {
      const options = { method, cache: "no-store", headers: { ...headers } };
      if (method !== "GET") options.headers["X-Noon-Request"] = "1";
      if (json !== undefined) { options.headers["Content-Type"] = "application/json"; options.body = JSON.stringify(json); }
      if (body !== undefined) options.body = body;
      const response = await fetchImpl(path, options);
      let payload; try { payload = await response.json(); } catch { payload = {}; }
      if (!response.ok) throw Object.assign(new Error(String(payload?.message || "Erreur de l'enregistreur.")), { code: String(payload?.code || (response.status === 404 ? "RECORDER_DISABLED" : "RECORDER_ERROR")), status: response.status });
      return payload;
    }
    const at = (id, action = "") => `${BASE}/${encodeURIComponent(id)}${action ? `/${action}` : ""}`;
    return Object.freeze({
      list: () => request("GET", BASE),
      create: (input) => request("POST", BASE, { json: input }),
      chunk: (id, seq, blob, type) => request("POST", at(id, "chunks"), { body: blob, headers: { "Content-Type": String(type || "application/octet-stream").split(";")[0], "X-Recorder-Seq": String(seq) } }),
      pause: (id) => request("POST", at(id, "pause")),
      resume: (id) => request("POST", at(id, "resume")),
      stop: (id) => request("POST", at(id, "stop")),
      remove: (id) => request("DELETE", at(id)),
      audioUrl: (id) => at(id, "audio"),
    });
  }

  function createRecorderController({ elements, api, media = global.navigator?.mediaDevices, MediaRecorderImpl = global.MediaRecorder, getAudioConstraints = () => true, confirmImpl = null, now = () => Date.now(), setIntervalImpl = (fn, ms) => global.setInterval(fn, ms), clearIntervalImpl = (id) => global.clearInterval(id) }) {
    const root = elements?.root; const indicator = elements?.indicator;
    if (!root || !api) throw new TypeError("root et api requis.");
    const doc = root.ownerDocument || global.document;
    const ask = typeof confirmImpl === "function" ? confirmImpl : (text) => (typeof global.confirm === "function" ? global.confirm(text) : false);
    let available = false; let busy = false; let notice = null; let sessions = [];
    const draft = { title: "", multiParticipant: false, informed: false };
    // Enregistrement en cours dans cette fenêtre.
    let live = null; // { id, recorder, stream, seq, queue, status, startedAt, pausedMs, pauseAt, timer, failed }

    const el = (tag, className = "", text = null) => { const node = doc.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = String(text); return node; };
    function button(label, onClick, { disabled = false, className = "" } = {}) {
      const node = el("button", className, label); node.type = "button"; node.disabled = busy || disabled;
      node.addEventListener("click", () => { void onClick(); });
      return node;
    }
    const setNotice = (text, kind = "info") => { notice = text ? { text: String(text), kind } : null; };

    function elapsedMs() {
      if (!live) return 0;
      const pausedNow = live.status === "paused" ? now() - live.pauseAt : 0;
      return now() - live.startedAt - live.pausedMs - pausedNow;
    }

    async function refresh() {
      const data = await api.list();
      sessions = Array.isArray(data.sessions) ? data.sessions : [];
      render();
      return sessions;
    }

    // Les morceaux partent un par un, dans l'ordre ; un échec arrête proprement l'enregistrement.
    function enqueueChunk(blob) {
      if (!live || !blob || !blob.size) return;
      const target = live; const seq = target.seq; target.seq += 1;
      target.queue = target.queue.then(async () => {
        if (target.failed) return;
        try { await api.chunk(target.id, seq, blob, target.mimeType); }
        catch {
          try { await api.chunk(target.id, seq, blob, target.mimeType); }
          catch (error) { target.failed = error; setNotice(`Sauvegarde interrompue : l'audio est conservé jusqu'à ${formatDuration(elapsedMs())}. ${messageFor(error)}`, "error"); void stop({ afterFailure: true }); }
        }
      });
    }

    async function start() {
      if (live || busy) return;
      if (draft.multiParticipant && !draft.informed) { setNotice(ERROR_MESSAGES.RECORDER_CONSENT_REQUIRED, "error"); render(); return; }
      const mimeType = MediaRecorderImpl ? pickMimeType((type) => MediaRecorderImpl.isTypeSupported(type)) : null;
      if (!mimeType || !media?.getUserMedia) { setNotice(ERROR_MESSAGES.RECORDER_FORMAT_UNSUPPORTED, "error"); render(); return; }
      busy = true; render();
      let stream = null;
      try {
        try { stream = await media.getUserMedia({ audio: getAudioConstraints(), video: false }); }
        catch (error) { throw Object.assign(new Error("micro"), { code: error?.name === "NotAllowedError" ? "MIC_PERMISSION_DENIED" : "MIC_DEVICE_UNAVAILABLE" }); }
        const { session } = await api.create({ title: draft.title.trim(), mimeType, multiParticipant: draft.multiParticipant, participantsInformed: draft.informed });
        const recorder = new MediaRecorderImpl(stream, { mimeType });
        live = { id: session.id, title: session.title, recorder, stream, mimeType, seq: 0, queue: Promise.resolve(), status: "recording", startedAt: now(), pausedMs: 0, pauseAt: 0, timer: null, failed: null };
        recorder.addEventListener("dataavailable", (event) => enqueueChunk(event.data));
        recorder.start(CHUNK_MS);
        live.timer = setIntervalImpl(() => { if (elapsedMs() >= MAX_DURATION_MS) void stop(); renderIndicator(); }, 1000);
        Object.assign(draft, { title: "", multiParticipant: false, informed: false });
        setNotice("Enregistrement en cours. Il est sauvegardé sur ce Mac toutes les 5 secondes.");
      } catch (error) {
        stream?.getTracks?.().forEach((track) => track.stop());
        setNotice(messageFor(error), "error");
      } finally { busy = false; }
      await refresh().catch(() => render());
    }

    async function togglePause() {
      if (!live) return;
      try {
        if (live.status === "recording") { live.recorder.pause(); live.recorder.requestData?.(); await api.pause(live.id); live.status = "paused"; live.pauseAt = now(); }
        else { await api.resume(live.id); live.recorder.resume(); live.pausedMs += now() - live.pauseAt; live.status = "recording"; }
      } catch (error) { setNotice(messageFor(error), "error"); }
      render();
    }

    async function stop({ afterFailure = false } = {}) {
      if (!live || live.stopping) return;
      const target = live; target.stopping = true;
      await new Promise((resolve) => {
        if (target.recorder.state === "inactive") return resolve();
        target.recorder.addEventListener("stop", () => resolve(), { once: true });
        try { target.recorder.stop(); } catch { resolve(); }
      });
      target.stream.getTracks().forEach((track) => track.stop());
      clearIntervalImpl(target.timer);
      await target.queue;
      try { await api.stop(target.id); if (!afterFailure) setNotice(`« ${target.title} » enregistré (${formatDuration(elapsedMs())}).`); }
      catch (error) { if (!afterFailure) setNotice(messageFor(error), "error"); }
      live = null;
      await refresh().catch(() => render());
    }

    async function remove(session) {
      if (!ask(`Supprimer définitivement « ${session.title} » ? L'audio sera effacé de ce Mac.`)) return;
      try { await api.remove(session.id); setNotice("Enregistrement supprimé."); } catch (error) { setNotice(messageFor(error), "error"); }
      await refresh().catch(() => render());
    }

    function renderIndicator() {
      if (!indicator) return;
      indicator.hidden = !live;
      if (!live) { indicator.replaceChildren(); return; }
      const dot = el("span", "recorder-indicator__dot"); dot.dataset.state = live.status;
      const time = el("span", "recorder-indicator__time", `${live.status === "paused" ? "En pause" : "Enregistrement"} · ${formatDuration(elapsedMs())}`);
      indicator.replaceChildren(dot, time,
        button(live.status === "paused" ? "Reprendre" : "Pause", togglePause, { className: "recorder-indicator__action" }),
        button("Arrêter", () => stop(), { className: "recorder-indicator__action" }));
    }

    function renderStartForm() {
      const card = el("article", "control-card recorder__start");
      card.append(el("h3", "", "Nouvel enregistrement"));
      const titleLabel = el("label", "recorder__field");
      const title = el("input"); title.type = "text"; title.maxLength = 120; title.placeholder = "Ex. Point client Corsaire"; title.value = draft.title; title.disabled = busy || Boolean(live);
      title.addEventListener("input", () => { draft.title = title.value; });
      titleLabel.append(el("span", "", "Titre"), title);
      const multi = el("label", "recorder__check"); const multiBox = el("input"); multiBox.type = "checkbox"; multiBox.checked = draft.multiParticipant; multiBox.disabled = busy || Boolean(live);
      multi.append(multiBox, el("span", "", "Plusieurs personnes participent"));
      const consent = el("div", "recorder__consent"); consent.hidden = !draft.multiParticipant;
      consent.append(el("p", "", "Avant d'enregistrer une réunion, préviens chaque participant et obtiens son accord. L'enregistrement reste sur ce Mac."));
      const informed = el("label", "recorder__check"); const informedBox = el("input"); informedBox.type = "checkbox"; informedBox.checked = draft.informed; informedBox.disabled = busy || Boolean(live);
      informed.append(informedBox, el("span", "", "J'ai prévenu les participants, et ils sont d'accord"));
      consent.append(informed);
      const startButton = button("Démarrer l'enregistrement", start, { disabled: Boolean(live) || (draft.multiParticipant && !draft.informed), className: "recorder__start-button" });
      multiBox.addEventListener("change", () => { draft.multiParticipant = multiBox.checked; if (!draft.multiParticipant) draft.informed = false; render(); });
      informedBox.addEventListener("change", () => { draft.informed = informedBox.checked; startButton.disabled = busy || Boolean(live) || (draft.multiParticipant && !draft.informed); });
      const actions = el("div", "control-card__actions"); actions.append(startButton);
      card.append(titleLabel, multi, consent, actions);
      if (live) card.append(el("p", "recorder__hint", "Un enregistrement est en cours : utilise le voyant en haut de la fenêtre pour le mettre en pause ou l'arrêter."));
      return card;
    }

    function renderSession(session) {
      const card = el("article", "control-card recorder__session");
      const head = el("div", "control-card__head");
      const pill = el("span", "control-status-pill", STATUS_LABELS[session.status] || session.status);
      pill.dataset.state = session.status === "stopped" ? "HEALTHY" : session.status === "interrupted" ? "DEGRADED" : "ACTIVE";
      head.append(el("h3", "", session.title), pill);
      const meta = el("div", "control-card__meta");
      let when; try { when = new Date(session.createdAt).toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "medium", timeStyle: "short" }); } catch { when = ""; }
      meta.append(el("span", "", when), el("span", "", formatDuration(session.durationMs)), el("span", "", formatBytes(session.bytes)));
      if (session.multiParticipant) meta.append(el("span", "", "Participants prévenus"));
      card.append(head, meta);
      if (session.status === "interrupted") card.append(el("p", "recorder__hint", "Noon s'est arrêté pendant l'enregistrement : l'audio est conservé jusqu'au dernier morceau sauvegardé."));
      if (!["recording", "paused"].includes(session.status) && session.bytes > 0) {
        const audio = el("audio", "recorder__audio"); audio.controls = true; audio.preload = "none"; audio.src = api.audioUrl(session.id);
        card.append(audio);
      }
      if (!["recording", "paused"].includes(session.status)) {
        const actions = el("div", "control-card__actions"); actions.append(button("Supprimer", () => remove(session)));
        card.append(actions);
      }
      return card;
    }

    function render() {
      renderIndicator();
      if (!available) { root.hidden = true; return; }
      root.hidden = false;
      const header = el("header", "control-section__header"); const title = el("div");
      title.append(el("h2", "", "Enregistreur"), el("p", "", "Enregistre une réunion sur ce Mac, avec pause et reprise. Rien n'est envoyé : la transcription viendra dans une prochaine étape."));
      header.append(title);
      const nodes = [header];
      if (notice) { const box = el("p", "control-center__notice", notice.text); box.setAttribute("role", notice.kind === "error" ? "alert" : "status"); box.dataset.kind = notice.kind; nodes.push(box); }
      const grid = el("div", "control-center__grid"); grid.append(renderStartForm());
      for (const session of sessions) grid.append(renderSession(session));
      nodes.push(grid);
      root.replaceChildren(...nodes);
    }

    async function init() {
      try { available = true; await refresh(); return true; }
      catch { available = false; render(); return false; }
    }

    return Object.freeze({ init, refresh, render, start, stop, togglePause, isAvailable: () => available, isRecording: () => Boolean(live), draft });
  }

  global.NoonRecorderUi = Object.freeze({ CHUNK_MS, ERROR_MESSAGES, MAX_DURATION_MS, createRecorderApi, createRecorderController, formatBytes, formatDuration, pickMimeType });
})(typeof window !== "undefined" ? window : globalThis);
