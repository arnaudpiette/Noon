"use strict";

// Cycle de vie du mot-clé « Salut Noon » : microphone, modèle Porcupine et événements d’activation.

const { EventEmitter } = require("events");
const fs = require("fs");

const DEFAULT_ANTI_REPEAT_MS = 2500;

class WakeWordService extends EventEmitter {
  constructor({ getAccessKey, logger = () => {}, antiRepeatMs = DEFAULT_ANTI_REPEAT_MS } = {}) {
    super();
    this.getAccessKey = getAccessKey;
    this.logger = logger;
    this.antiRepeatMs = antiRepeatMs;
    this.engine = null;
    this.recorder = null;
    this.running = false;
    this.generation = 0;
    this.lastDetectionAt = 0;
    this.status = { state: "disabled", text: "Réveil vocal désactivé.", detections: 0 };
  }

  setStatus(state, text, extra = {}) {
    this.status = { ...this.status, state, text, ...extra };
    this.emit("status", this.getStatus());
  }

  getStatus() {
    return { ...this.status, running: this.running };
  }

  static listDevices() {
    try {
      const { PvRecorder } = require("@picovoice/pvrecorder-node");
      return PvRecorder.getAvailableDevices().map((name, index) => ({ index, name }));
    } catch {
      return [];
    }
  }

  validateConfig(config) {
    if (!config?.keywordPath || !config?.modelPath) {
      throw new Error("Importez le mot-clé .ppn et le modèle français .pv.");
    }
    if (!fs.existsSync(config.keywordPath) || !fs.existsSync(config.modelPath)) {
      throw new Error("Un fichier Picovoice importé est introuvable.");
    }
    const sensitivity = Number(config.sensitivity);
    if (!Number.isFinite(sensitivity) || sensitivity < 0 || sensitivity > 1) {
      throw new Error("La sensibilité doit être comprise entre 0 et 1.");
    }
  }

  async start(config) {
    if (this.running) return this.getStatus();
    this.validateConfig(config);
    const accessKey = await this.getAccessKey?.();
    if (!accessKey) throw new Error("Ajoutez votre AccessKey Picovoice.");

    const { Porcupine } = require("@picovoice/porcupine-node");
    const { PvRecorder } = require("@picovoice/pvrecorder-node");
    this.setStatus("starting", "Initialisation de Salut Noon…");
    this.engine = new Porcupine(
      accessKey,
      [config.keywordPath],
      [Number(config.sensitivity)],
      { modelPath: config.modelPath }
    );
    this.recorder = new PvRecorder(this.engine.frameLength, Number(config.deviceIndex ?? -1));
    this.recorder.start();
    this.running = true;
    const generation = ++this.generation;
    this.setStatus("listening", "Écoute locale : Salut Noon");
    void this.captureLoop(generation);
    return this.getStatus();
  }

  async captureLoop(generation) {
    try {
      while (this.running && generation === this.generation) {
        const frame = await this.recorder.read();
        if (!this.running || generation !== this.generation) break;
        if (this.engine.process(frame) < 0) continue;
        const now = Date.now();
        if (now - this.lastDetectionAt < this.antiRepeatMs) continue;
        this.lastDetectionAt = now;
        this.status.detections += 1;
        this.setStatus("detected", "Salut Noon détecté.");
        this.emit("detected", { detectedAt: new Date(now).toISOString() });
        await this.stop({ preserveStatus: true });
      }
    } catch (error) {
      this.logger("error", "wake-word", String(error?.message || error));
      await this.stop({ preserveStatus: true });
      this.setStatus("error", "Réveil vocal indisponible.", { error: error?.message || String(error) });
    }
  }

  async stop({ preserveStatus = false } = {}) {
    this.running = false;
    this.generation += 1;
    try { if (this.recorder?.isRecording) this.recorder.stop(); } catch {}
    try { this.recorder?.release(); } catch {}
    try { this.engine?.release(); } catch {}
    this.recorder = null;
    this.engine = null;
    if (!preserveStatus) this.setStatus("disabled", "Réveil vocal désactivé.");
    return this.getStatus();
  }
}

module.exports = { WakeWordService };
