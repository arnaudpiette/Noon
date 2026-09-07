"use strict";

function createContextSignalRegistry({ now = () => new Date() } = {}) {
  const signals = new Map();
  function purge() {
    const timestamp = now().getTime();
    for (const [id, signal] of signals) if (Date.parse(signal.expiresAt) <= timestamp) signals.delete(id);
  }
  return {
    upsert(signal) { purge(); for (const [id, current] of signals) if (current.signalType === signal.signalType && current.scope === signal.scope) signals.delete(id); signals.set(signal.signalId, signal); return signal; },
    list() { purge(); return [...signals.values()].map((item) => structuredClone(item)); },
    clear() { const count = signals.size; signals.clear(); return count; },
    remove(id) { return signals.delete(id); },
    purge,
  };
}

module.exports = { createContextSignalRegistry };
