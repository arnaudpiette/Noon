"use strict";

const fs = require("fs");

function createStartupDiagnostics({ filePath, now = () => new Date(), monotonicNow = () => process.hrtime.bigint() }) {
  function record(phase, status, details = {}) {
    const entry = {
      timestamp: now().toISOString(),
      phase,
      status,
      ...details,
    };
    try {
      fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o600 });
    } catch {
      // Le diagnostic ne doit jamais modifier le comportement de démarrage.
    }
  }

  async function measure(phase, operation) {
    const startedAt = monotonicNow();
    record(phase, "start");
    try {
      const result = await operation();
      const durationMs = Number(monotonicNow() - startedAt) / 1_000_000;
      record(phase, "ok", { durationMs: Math.round(durationMs * 10) / 10 });
      return result;
    } catch (error) {
      const durationMs = Number(monotonicNow() - startedAt) / 1_000_000;
      record(phase, "error", {
        durationMs: Math.round(durationMs * 10) / 10,
        errorCode: String(error?.code || error?.name || "ERROR").slice(0, 80),
      });
      throw error;
    }
  }

  return { measure, record };
}

function startOptionalStartupPhase({ operation, onResolved = () => {}, onRejected = () => {} }) {
  const promise = Promise.resolve().then(operation);
  void promise.then(onResolved, onRejected);
  return promise;
}

function createDeferredOptionalLoader({ operation } = {}) {
  if (typeof operation !== "function") throw new TypeError("Opération optionnelle requise.");
  let state = "DEFERRED";
  let promise = null;
  return {
    state: () => state,
    ensureSync() {
      if (state === "READY") return undefined;
      state = "LOADING";
      try { const value = operation(); state = "READY"; return value; }
      catch (error) { state = "UNAVAILABLE"; throw error; }
    },
    ensure() {
      if (!promise) {
        state = "LOADING";
        promise = Promise.resolve().then(operation).then(
          (value) => { state = "READY"; return value; },
          (error) => { state = "UNAVAILABLE"; throw error; }
        );
      }
      return promise;
    },
  };
}

module.exports = { createDeferredOptionalLoader, createStartupDiagnostics, startOptionalStartupPhase };
