"use strict";

// Dictaphone — découpage des longs audios, WAV, repères horaires (module pur, sans navigateur).

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const PUBLIC = path.join(__dirname, "..", "public");
const context = { Float32Array, Uint8Array, ArrayBuffer, DataView, Math, Number, String, Array, Object, Error, Infinity };
context.window = context;
vm.runInNewContext(fs.readFileSync(path.join(PUBLIC, "recorder-audio.js"), "utf8"), context);
const audio = context.window.NoonRecorderAudio;
const RATE = 16_000;

// Parole simulée (sinus) avec un silence d'1 s centré sur `silenceAt` secondes.
function speechWithSilence(seconds, silences = []) {
  const samples = new Float32Array(seconds * RATE);
  for (let index = 0; index < samples.length; index += 1) samples[index] = 0.5 * Math.sin(index / 7);
  for (const at of silences) samples.fill(0, Math.floor((at - 0.5) * RATE), Math.floor((at + 0.5) * RATE));
  return samples;
}

test("découpage : parties contiguës, ≤ 4 min, coupées dans le silence le plus proche avant la cible", () => {
  const samples = speechWithSilence(600, [230, 470]);
  const parts = audio.planSegments(samples, RATE);
  assert.equal(parts.length, 3);
  assert.equal(parts[0].start, 0);
  for (let index = 1; index < parts.length; index += 1) assert.equal(parts[index].start, parts[index - 1].end, "contiguës, sans trou ni chevauchement");
  assert.equal(parts.at(-1).end, samples.length);
  for (const part of parts) assert.ok(part.end - part.start <= audio.TARGET_PART_SECONDS * RATE);
  assert.ok(Math.abs(parts[0].endMs - 230_000) <= 500, `coupe au silence (${parts[0].endMs} ms)`);
  assert.ok(Math.abs(parts[1].endMs - 470_000) <= 500, `coupe au silence (${parts[1].endMs} ms)`);
});

test("découpage : sans silence, coupe à la cible au plus tard ; audio court = une seule partie", () => {
  const parts = audio.planSegments(speechWithSilence(500), RATE);
  for (const part of parts) assert.ok(part.end - part.start <= 240 * RATE);
  assert.equal(audio.planSegments(speechWithSilence(30), RATE).length, 1);
  assert.deepEqual(Array.from(audio.planSegments(new Float32Array(0), RATE)), []);
});

test("WAV : en-tête PCM 16 bits mono 16 kHz, une partie de 4 min tient sous la limite de 10 Mo", () => {
  const wav = audio.encodeWav(new Float32Array([0, 1, -1, 2]), RATE);
  const view = new DataView(wav.buffer);
  assert.equal(String.fromCharCode(...wav.slice(0, 4)), "RIFF");
  assert.equal(String.fromCharCode(...wav.slice(8, 12)), "WAVE");
  assert.equal(view.getUint16(22, true), 1, "mono");
  assert.equal(view.getUint32(24, true), RATE);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getInt16(46, true), 32767);
  assert.equal(view.getInt16(48, true), -32768);
  assert.equal(view.getInt16(50, true), 32767, "valeur saturée, pas de débordement");
  assert.ok(44 + audio.TARGET_PART_SECONDS * RATE * 2 < 10 * 1024 * 1024);
});

test("mixage mono : moyenne des canaux", () => {
  const mono = audio.mixToMono([new Float32Array([1, 0]), new Float32Array([0, 1])]);
  assert.deepEqual(Array.from(mono), [0.5, 0.5]);
  assert.throws(() => audio.mixToMono([]), /Audio vide/);
});

test("repères : transcription assemblée en [mm:ss], citation retrouvée dans la bonne partie", () => {
  const text = audio.assembleTranscript([
    { startMs: 0, text: "On commence par le budget." },
    { startMs: 230_000, text: "Décision : on lance le projet en mars." },
    { startMs: 3_725_000, text: "Question : qui valide ?" },
  ]);
  assert.match(text, /^\[00:00\] On commence/);
  assert.match(text, /\[03:50\] Décision/);
  assert.match(text, /\[1:02:05\] Question/);
  assert.equal(audio.timestampForQuote(text, "on lance le projet en mars"), 230);
  assert.equal(audio.timestampForQuote(text, "qui valide"), 3725);
  assert.equal(audio.timestampForQuote(text, "absent"), null);
  assert.equal(audio.timestampForQuote("Transcription courte sans repère.", "courte"), null);
  assert.equal(audio.formatTimestamp(59_999), "00:59");
});

test("contrat source : accord unique avant décodage, aucune sauvegarde si une partie échoue, module chargé avant recorder.js", () => {
  const recorder = fs.readFileSync(path.join(PUBLIC, "recorder.js"), "utf8");
  const handler = recorder.slice(recorder.indexOf('transcribe.addEventListener("click"'), recorder.indexOf("row.append(transcribe);"));
  assert.ok(handler.indexOf("window.confirm(") < handler.indexOf("transcribeInParts(item)"), "accord avant tout traitement");
  assert.ok(handler.indexOf("transcribeInParts(item)") < handler.indexOf("bridge.saveTranscript("), "sauvegarde seulement après toutes les parties");
  assert.equal(/innerHTML/.test(recorder), false);
  const index = fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8");
  assert.ok(index.indexOf('<script src="recorder-audio.js"></script>') < index.indexOf('<script src="recorder.js"></script>'));
  assert.match(fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8"), /req\.url === "\/recorder-audio\.js"/);
});
