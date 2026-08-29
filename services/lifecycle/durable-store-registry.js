"use strict";

const CRITICALITY = Object.freeze(["CRITICAL", "IMPORTANT", "REBUILDABLE", "EPHEMERAL"]);

function createDurableStoreRegistry(stores = []) {
  const entries = new Map();
  for (const store of stores) {
    if (!store?.storeId || entries.has(store.storeId) || !CRITICALITY.includes(store.criticality)) throw new TypeError(`Store durable invalide : ${store?.storeId || "missing"}`);
    entries.set(store.storeId, Object.freeze({ canonical: true, sensitive: false, encrypted: false, rebuildable: false, backup: true, ...store }));
  }
  return { get: (id) => entries.get(id) || null, list: () => [...entries.values()], backupStores: () => [...entries.values()].filter((item) => item.backup && !["REBUILDABLE", "EPHEMERAL"].includes(item.criticality)) };
}

module.exports = { CRITICALITY, createDurableStoreRegistry };
