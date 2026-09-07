"use strict";

const { createDeviceIdentity } = require("./sync-crypto");

function createDeviceIdentityStore({ secureStore, storageKey = "noon-sync-device-identity", defaults = {} } = {}) {
  if (!secureStore?.get || !secureStore?.set) throw new TypeError("Stockage sécurisé requis pour l'identité appareil.");
  function loadOrCreate() {
    const saved = secureStore.get(storageKey);
    if (saved) return JSON.parse(saved);
    const identity = createDeviceIdentity(defaults); secureStore.set(storageKey, JSON.stringify(identity)); return identity;
  }
  function publicIdentity() { const { privateSigningKey: _sign, privateEncryptionKey: _encrypt, ...visible } = loadOrCreate(); return visible; }
  return { loadOrCreate, publicIdentity };
}

module.exports = { createDeviceIdentityStore };
