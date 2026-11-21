"use strict";

// Dictaphone — traitement audio pur (sans DOM ni réseau), testable sous Node :
// mixage mono, découpe en parties coupées au silence, encodage WAV PCM 16 bits,
// repères horaires [hh:mm:ss] et position d'une citation dans la transcription.
(function attachRecorderAudio(global) {
  const SAMPLE_RATE = 16_000;
  const TARGET_PART_SECONDS = 240;   // ≈ 7,7 Mo en WAV 16 kHz mono : sous la limite de 10 Mo.
  const SILENCE_SEARCH_SECONDS = 20; // fenêtre de recherche du silence avant la coupe cible.
  const FRAME_MS = 300;
  const MAX_DURATION_SECONDS = 2 * 3600;

  function mixToMono(channels) {
    if (!Array.isArray(channels) || !channels.length) throw new Error("Audio vide.");
    if (channels.length === 1) return channels[0];
    const length = Math.min(...channels.map((channel) => channel.length));
    const mono = new Float32Array(length);
    for (const channel of channels) for (let index = 0; index < length; index += 1) mono[index] += channel[index] / channels.length;
    return mono;
  }

  function rms(samples, start, end) {
    let sum = 0;
    for (let index = start; index < end; index += 1) sum += samples[index] * samples[index];
    return Math.sqrt(sum / Math.max(1, end - start));
  }

  // Parties contiguës [start, end) en échantillons : coupe au cadre le plus silencieux
  // des SILENCE_SEARCH_SECONDS qui précèdent la cible, jamais au-delà de la cible.
  function planSegments(samples, sampleRate = SAMPLE_RATE, { targetSeconds = TARGET_PART_SECONDS, searchSeconds = SILENCE_SEARCH_SECONDS, frameMs = FRAME_MS } = {}) {
    const total = samples.length;
    if (!total) return [];
    const target = Math.floor(targetSeconds * sampleRate);
    const search = Math.min(Math.floor(searchSeconds * sampleRate), Math.floor(target / 2));
    const frame = Math.max(1, Math.floor((frameMs / 1000) * sampleRate));
    const parts = [];
    let start = 0;
    while (start < total) {
      if (total - start <= target) { parts.push({ start, end: total }); break; }
      const limit = start + target;
      let cut = limit;
      let quietest = Infinity;
      for (let frameEnd = limit; frameEnd - frame >= limit - search; frameEnd -= frame) {
        const level = rms(samples, frameEnd - frame, frameEnd);
        if (level < quietest) { quietest = level; cut = frameEnd - Math.floor(frame / 2); }
      }
      parts.push({ start, end: cut });
      start = cut;
    }
    return parts.map(({ start: from, end }) => ({ start: from, end, startMs: Math.round((from / sampleRate) * 1000), endMs: Math.round((end / sampleRate) * 1000) }));
  }

  function encodeWav(samples, sampleRate = SAMPLE_RATE) {
    const dataBytes = samples.length * 2;
    const buffer = new ArrayBuffer(44 + dataBytes);
    const view = new DataView(buffer);
    const ascii = (offset, text) => { for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index)); };
    ascii(0, "RIFF"); view.setUint32(4, 36 + dataBytes, true); ascii(8, "WAVE");
    ascii(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    ascii(36, "data"); view.setUint32(40, dataBytes, true);
    for (let index = 0; index < samples.length; index += 1) {
      const value = Math.max(-1, Math.min(1, samples[index]));
      view.setInt16(44 + index * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true);
    }
    return new Uint8Array(buffer);
  }

  function formatTimestamp(ms) {
    const total = Math.max(0, Math.floor(Number(ms) / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    const two = (value) => String(value).padStart(2, "0");
    return hours ? `${hours}:${two(minutes)}:${two(seconds)}` : `${two(minutes)}:${two(seconds)}`;
  }

  // Transcription découpée : chaque partie commence par son repère [mm:ss].
  function assembleTranscript(parts) {
    return parts.map((part) => `[${formatTimestamp(part.startMs)}] ${String(part.text || "").trim()}`).join("\n\n");
  }

  const MARKER = /\[(?:(\d+):)?(\d{2}):(\d{2})\]/g;

  // Secondes du dernier repère [mm:ss] qui précède la citation exacte (null sans repère).
  function timestampForQuote(transcript, quote) {
    const text = String(transcript || "");
    const position = text.indexOf(String(quote || ""));
    if (!quote || position < 0) return null;
    let seconds = null;
    for (const match of text.matchAll(MARKER)) {
      if (match.index > position) break;
      seconds = Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3]);
    }
    return seconds;
  }

  global.NoonRecorderAudio = Object.freeze({
    FRAME_MS, MAX_DURATION_SECONDS, SAMPLE_RATE, SILENCE_SEARCH_SECONDS, TARGET_PART_SECONDS,
    assembleTranscript, encodeWav, formatTimestamp, mixToMono, planSegments, timestampForQuote,
  });
})(typeof window !== "undefined" ? window : globalThis);
