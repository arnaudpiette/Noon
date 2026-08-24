"use strict";

(() => {
  const bridge = window.NoonAppBridge;
  const core = window.NoonLiveVoiceCore;
  if (!bridge || !core || typeof RTCPeerConnection === "undefined") return;

  const elements = {
    button: document.getElementById("liveVoiceButton"),
    status: document.getElementById("liveVoiceStatus"),
    dot: document.getElementById("liveVoiceDot"),
    quality: document.getElementById("liveVoiceQuality"),
    language: document.getElementById("liveVoiceLanguage"),
    accent: document.getElementById("liveVoiceAccent"),
    mute: document.getElementById("liveVoiceMute"),
    end: document.getElementById("liveVoiceEnd"),
    context: document.getElementById("liveVoiceContext"),
    cost: document.getElementById("liveVoiceCost"),
    audio: document.getElementById("liveVoiceAudio"),
  };

  const STORAGE = {
    quality: "noonVoiceQuality",
    language: "noonVoiceLanguage",
    accent: "noonVoiceAccent",
  };
  const STATE_LABELS = {
    disconnected: "Déconnecté",
    connecting: "Connexion…",
    listening: "Écoute",
    thinking: "Réflexion…",
    speaking: "Noon parle",
    muted: "Micro coupé",
    reconnecting: "Reconnexion…",
    error: "Erreur réseau",
  };

  class NoonLiveVoice {
    constructor() {
      this.peer = null;
      this.channel = null;
      this.stream = null;
      this.connected = false;
      this.intentionalClose = false;
      this.reconnectAttempts = 0;
      this.reconnectTimer = null;
      this.idleTimer = null;
      this.maxTimer = null;
      this.idleTimeoutMs = 2 * 60 * 1000;
      this.maxSessionMs = 20 * 60 * 1000;
      this.model = "gpt-realtime-2.1-mini";
      this.pendingUsers = [];
      this.seenUserItems = new Set();
      this.seenAssistantItems = new Set();
      this.processedToolCalls = new Set();
      this.state = "disconnected";
      this.cleaningUp = false;

      const savedQuality = localStorage.getItem(STORAGE.quality);
      elements.quality.value = savedQuality === "max" ? "max" : "mini";
      elements.language.value = localStorage.getItem(STORAGE.language) || "auto";
      elements.accent.value = localStorage.getItem(STORAGE.accent) || "";
      this.bindEvents();
      this.refreshContext();
      this.refreshBudget();
      this.setState("disconnected");
    }

    bindEvents() {
      elements.button.addEventListener("click", () => {
        if (this.connected || this.state === "connecting") {
          this.disconnect();
        } else {
          this.connect();
        }
      });
      elements.end.addEventListener("click", () => this.disconnect());
      elements.mute.addEventListener("click", () => this.toggleMute());
      elements.language.addEventListener("change", () => {
        localStorage.setItem(STORAGE.language, elements.language.value);
        this.updateSessionInstructions();
      });
      elements.accent.addEventListener("change", () => {
        localStorage.setItem(STORAGE.accent, elements.accent.value.trim() || "none");
        this.updateSessionInstructions();
      });
      elements.quality.addEventListener("change", () => {
        localStorage.setItem(STORAGE.quality, elements.quality.value);
        if (this.connected) {
          bridge.updateActivity(
            "La nouvelle qualité sera utilisée à la prochaine session Live."
          );
        }
      });
      window.addEventListener("online", () => {
        if (this.state === "error" && !this.intentionalClose) this.scheduleReconnect();
      });
      window.addEventListener("offline", () => {
        if (this.connected) {
          this.setState("error", "Connexion Internet absente.");
          this.scheduleReconnect();
        }
      });
      window.addEventListener("noon-context-change", () => {
        this.refreshContext();
        this.updateSessionInstructions();
      });
      window.addEventListener("noon-audio-device-change", () => {
        void this.applyOutputDevice();
        if (this.connected) {
          bridge.updateActivity(
            "Le nouveau microphone sera utilisé à la prochaine session Live."
          );
        }
      });
    }

    async applyOutputDevice() {
      const outputId = bridge.getAudioDevices?.().outputId || "";
      if (typeof elements.audio.setSinkId !== "function") return;
      try {
        await elements.audio.setSinkId(outputId);
      } catch {
        bridge.updateActivity("Le casque sélectionné n’est plus disponible.");
      }
    }

    setState(state, message = STATE_LABELS[state]) {
      this.state = state;
      elements.status.textContent = message;
      elements.dot.dataset.state = state;
      elements.button.textContent = this.connected
        ? "Conversation Live active"
        : state === "connecting" || state === "reconnecting"
          ? "Connexion…"
          : "Conversation Live";
      elements.mute.disabled = !this.connected;
      elements.end.disabled = !this.connected && state !== "connecting";
      if (["listening", "muted"].includes(state)) bridge.setVisualState("listening");
      if (state === "thinking") bridge.setVisualState("thinking");
      if (state === "speaking") bridge.setVisualState("speaking");
      if (["disconnected", "error"].includes(state)) bridge.setVisualState("idle");
      window.noon?.setLiveActive(
        !["disconnected", "error"].includes(state)
      ).catch(() => {});
    }

    refreshContext() {
      const context = bridge.getContext();
      elements.context.textContent =
        `${context.mode} · ${context.focus || "Aucun Focus"}`;
    }

    async refreshBudget() {
      try {
        const response = await fetch("/realtime/budget", { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) return;
        elements.cost.textContent =
          `${data.budget.costUSD.toFixed(2)} $ / ${data.budget.budgetUSD.toFixed(0)} $`;
        elements.cost.dataset.state = data.budget.state.toLowerCase();
      } catch {
        // Le budget texte reste disponible si cet indicateur échoue.
      }
    }

    buildInstructions() {
      const context = bridge.getContext();
      const language = elements.language.value;
      const accent = elements.accent.value.trim() || "none";
      return [
        "Tu es Noon, avec une voix d’homme chaleureuse, calme, vive et naturelle. Réponds oralement avec des phrases courtes et fluides.",
        language === "auto"
          ? "Détecte la langue parlée et réponds dans cette langue."
          : `Réponds dans la langue ${language} jusqu'à nouvel ordre.`,
        accent === "none"
          ? "Prononciation naturelle sans accent particulier."
          : `Accent ${accent}, léger, intelligible et non caricatural.`,
        context.mode === "DEV"
          ? "Mode DEV : code, architecture, tests, sécurité et débogage."
          : "Mode DA : direction artistique, UI/UX, accessibilité et cohérence visuelle.",
        context.focus
          ? `Focus actif : ${context.focus}. Utilise les outils avant toute affirmation sur ses fichiers.`
          : "Aucun Focus actif.",
        "Confirme brièvement les changements de réglages et arrête-toi immédiatement si l'utilisateur t'interrompt.",
      ].join(" ");
    }

    send(event) {
      if (this.channel?.readyState === "open") {
        this.channel.send(JSON.stringify(event));
        return true;
      }
      return false;
    }

    updateSessionInstructions() {
      bridge.setVoiceStyle(elements.language.value, elements.accent.value.trim() || "none");
      this.send({
        type: "session.update",
        session: {
          type: "realtime",
          instructions: this.buildInstructions(),
        },
      });
    }

    async connect({ reconnecting = false } = {}) {
      if (this.peer || this.state === "connecting") return;
      const quality = elements.quality.value === "max" ? "max" : "mini";
      let confirmMax = reconnecting && quality === "max";

      if (quality === "max" && !reconnecting) {
        confirmMax = window.confirm(
          "La Qualité Max consomme nettement plus de budget vocal. Démarrer cette session en Max ?"
        );
        if (!confirmMax) {
          elements.quality.value = "mini";
          localStorage.setItem(STORAGE.quality, "mini");
          return;
        }
      }

      this.intentionalClose = false;
      this.setState(reconnecting ? "reconnecting" : "connecting");

      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: bridge.getAudioConstraints?.() || true,
          video: false,
        });
        this.peer = new RTCPeerConnection();
        this.peer.ontrack = (event) => {
          elements.audio.srcObject = event.streams[0];
          void this.applyOutputDevice();
          elements.audio.play().catch(() => {});
        };
        this.peer.onconnectionstatechange = () => {
          if (["failed", "disconnected"].includes(this.peer?.connectionState)) {
            this.handleNetworkFailure();
          }
        };
        this.stream.getTracks().forEach((track) => this.peer.addTrack(track, this.stream));
        this.channel = this.peer.createDataChannel("oai-events");
        this.channel.addEventListener("open", () => {
          this.connected = true;
          this.reconnectAttempts = 0;
          this.setState("listening");
          this.touchActivity();
          this.updateSessionInstructions();
        });
        this.channel.addEventListener("message", (event) => this.handleEvent(event));
        this.channel.addEventListener("close", () => {
          if (!this.intentionalClose) this.handleNetworkFailure();
        });

        const offer = await this.peer.createOffer();
        await this.peer.setLocalDescription(offer);
        const context = bridge.getContext();
        const params = new URLSearchParams({
          quality,
          confirmMax: String(confirmMax),
          sessionId: context.sessionId,
          mode: context.mode,
          language: elements.language.value,
          accent: elements.accent.value.trim() || "none",
        });
        if (context.focus) params.set("focus", context.focus);
        if (context.focusPath) params.set("focusPath", context.focusPath);
        if (context.focusId) params.set("focusId", context.focusId);
        const response = await fetch(`/realtime/session?${params}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/sdp",
            "X-Noon-Request": "1",
          },
          body: offer.sdp,
        });
        const answerText = await response.text();
        if (!response.ok) {
          let message = "Connexion Live impossible.";
          try { message = JSON.parse(answerText).message || message; } catch { /* SDP ou texte simple. */ }
          throw new Error(message);
        }
        this.model = response.headers.get("X-Noon-Voice-Model") ||
          (quality === "max" ? "gpt-realtime-2.1" : "gpt-realtime-2.1-mini");
        this.maxSessionMs = Number(response.headers.get("X-Noon-Max-Session-Ms")) || this.maxSessionMs;
        this.idleTimeoutMs = Number(response.headers.get("X-Noon-Idle-Timeout-Ms")) || this.idleTimeoutMs;
        await this.peer.setRemoteDescription({ type: "answer", sdp: answerText });
        this.maxTimer = window.setTimeout(() => {
          this.disconnect({ message: "Durée maximale de vingt minutes atteinte." });
        }, this.maxSessionMs);
      } catch (error) {
        this.cleanupConnection();
        this.setState("error", error.message || "Erreur réseau");
        if (error?.name !== "NotAllowedError") this.scheduleReconnect();
      }
    }

    touchActivity() {
      window.clearTimeout(this.idleTimer);
      this.idleTimer = window.setTimeout(() => {
        this.disconnect({ message: "Session Live fermée après deux minutes d’inactivité." });
      }, this.idleTimeoutMs);
    }

    async handleEvent(messageEvent) {
      let event;
      try { event = JSON.parse(messageEvent.data); } catch { return; }
      this.touchActivity();

      if (event.type === "session.created" || event.type === "session.updated") {
        if (this.connected) this.setState("listening");
        return;
      }
      if (event.type === "input_audio_buffer.speech_started") {
        this.setState("listening");
        return;
      }
      if (event.type === "input_audio_buffer.speech_stopped") {
        this.setState("thinking");
        return;
      }
      if (event.type === "response.created" || event.type === "response.output_audio.delta") {
        this.setState("speaking");
        return;
      }
      if (event.type === "conversation.item.input_audio_transcription.completed") {
        const text = String(event.transcript || "").trim();
        const itemId = event.item_id || `user-${Date.now()}`;
        if (text && !this.seenUserItems.has(itemId)) {
          this.seenUserItems.add(itemId);
          this.pendingUsers.push({ itemId, text });
          bridge.addLiveMessage("Vous", text, "user");
        }
        return;
      }
      if (event.type === "response.output_audio_transcript.done") {
        const text = String(event.transcript || "").trim();
        const itemId = event.item_id || event.response_id || `assistant-${Date.now()}`;
        if (text && !this.seenAssistantItems.has(itemId)) {
          this.seenAssistantItems.add(itemId);
          bridge.addLiveMessage("Noon", text, "noon");
          const user = this.pendingUsers.shift();
          if (user) this.rememberTurn(event.response_id || itemId, user.text, text);
        }
        return;
      }
      if (event.type === "response.done") {
        await this.handleResponseDone(event.response || {});
        if (this.connected) this.setState("listening");
        return;
      }
      if (event.type === "error") {
        const message = event.error?.message || "Erreur Realtime";
        if (/semantic_vad/i.test(message)) {
          this.send({
            type: "session.update",
            session: {
              type: "realtime",
              audio: {
                input: {
                  turn_detection: {
                    type: "server_vad",
                    threshold: 0.5,
                    prefix_padding_ms: 300,
                    silence_duration_ms: 700,
                    create_response: true,
                    interrupt_response: true,
                  },
                },
              },
            },
          });
          return;
        }
        this.setState("error", message);
      }
    }

    async handleResponseDone(response) {
      if (response.id && response.usage) {
        try {
          await fetch("/realtime/usage", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Noon-Request": "1",
            },
            body: JSON.stringify({
              sessionId: bridge.getContext().sessionId,
              responseId: response.id,
              model: this.model,
              usage: response.usage,
            }),
          });
          this.refreshBudget();
        } catch {
          // Le même response.id pourra être renvoyé sans double comptage.
        }
      }

      const calls = (response.output || []).filter((item) => item.type === "function_call");
      for (const call of calls) {
        if (this.processedToolCalls.has(call.call_id)) continue;
        this.processedToolCalls.add(call.call_id);
        await this.executeTool(call);
      }
    }

    async executeTool(call) {
      let args = {};
      try { args = JSON.parse(call.arguments || "{}"); } catch { /* Validation backend. */ }
      try {
        const context = bridge.getContext();
        const response = await fetch("/realtime/tool", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Noon-Request": "1",
          },
          body: JSON.stringify({
            name: call.name,
            arguments: args,
            ...context,
          }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || "Outil vocal indisponible.");
        this.applyClientAction(result.clientAction);
        this.send({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: call.call_id,
            output: JSON.stringify(result),
          },
        });
        this.send({ type: "response.create" });
      } catch (error) {
        this.send({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: call.call_id,
            output: JSON.stringify({ error: error.message }),
          },
        });
        this.send({ type: "response.create" });
      }
    }

    applyClientAction(action) {
      if (!action) return;
      if (action.type === "setMode") bridge.setMode(action.mode);
      if (action.type === "setFocus") bridge.setFocus(action.project);
      if (action.type === "setVoiceStyle") {
        elements.language.value = action.language;
        elements.accent.value = action.accent === "none" ? "" : action.accent;
        localStorage.setItem(STORAGE.language, action.language);
        localStorage.setItem(STORAGE.accent, action.accent);
        bridge.setVoiceStyle(action.language, action.accent);
        this.updateSessionInstructions();
      }
      if (action.type === "brainAnswer") {
        bridge.addLiveMessage("Noon", action.answer, "noon", action.sources || []);
      }
      if (action.type === "refreshProjects") {
        void bridge.refreshProjects();
      }
      if (action.type === "projectControl") {
        bridge.showProjectControl(action.control);
      }
      if (action.type === "projectSessionEnded") {
        bridge.finishProjectSession(action.summary);
      }
      this.refreshContext();
    }

    async rememberTurn(turnId, question, answer) {
      try {
        await fetch("/realtime/turn", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Noon-Request": "1",
          },
          body: JSON.stringify({
            turnId,
            question,
            answer,
            ...bridge.getContext(),
          }),
        });
      } catch {
        // La conversation visible reste disponible localement.
      }
    }

    toggleMute() {
      const track = this.stream?.getAudioTracks()[0];
      if (!track) return;
      track.enabled = !track.enabled;
      elements.mute.textContent = track.enabled ? "Couper le micro" : "Réactiver le micro";
      this.setState(track.enabled ? "listening" : "muted");
    }

    handleNetworkFailure() {
      if (this.intentionalClose || this.cleaningUp) return;
      this.cleanupConnection();
      this.setState("error", "Connexion Live interrompue.");
      this.scheduleReconnect();
    }

    scheduleReconnect() {
      const delay = core.reconnectDelay(this.reconnectAttempts);
      if (this.intentionalClose || delay === null) {
        this.setState(
          "error",
          "Connexion impossible. Continue en texte ou avec le micro classique."
        );
        return;
      }
      window.clearTimeout(this.reconnectTimer);
      this.reconnectAttempts += 1;
      this.setState("reconnecting", `Reconnexion ${this.reconnectAttempts}/2…`);
      this.reconnectTimer = window.setTimeout(
        () => this.connect({ reconnecting: true }),
        delay
      );
    }

    cleanupConnection() {
      if (this.cleaningUp) return;
      this.cleaningUp = true;
      window.clearTimeout(this.idleTimer);
      window.clearTimeout(this.maxTimer);
      this.idleTimer = null;
      this.maxTimer = null;
      core.cleanupRealtimeResources({
        channel: this.channel,
        peer: this.peer,
        stream: this.stream,
        audio: elements.audio,
      });
      this.channel = null;
      this.peer = null;
      this.stream = null;
      this.connected = false;
      this.cleaningUp = false;
    }

    disconnect({ announce = true, message = "Conversation Live terminée." } = {}) {
      this.intentionalClose = true;
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
      this.cleanupConnection();
      this.setState("disconnected", announce ? message : "Déconnecté");
      if (announce) bridge.updateActivity(message);
    }
  }

  window.noonLiveVoice = new NoonLiveVoice();

  window.noon?.onSystemState((message) => {
    const state = typeof message === "string" ? message : message?.state;
    if (state === "stop-live" || state === "suspend") {
      window.noonLiveVoice.disconnect({
        announce: false,
        message: "Conversation Live suspendue.",
      });
    }
    if (state === "toggle-mute") {
      window.noonLiveVoice.toggleMute();
    }
    if (state === "voice-quality") {
      elements.quality.value = message?.value === "max" ? "max" : "mini";
      localStorage.setItem(STORAGE.quality, elements.quality.value);
    }
    if (state === "resume") {
      bridge.updateActivity(
        "Mac réveillé. Le microphone reste arrêté jusqu’à votre action."
      );
    }
  });
})();
