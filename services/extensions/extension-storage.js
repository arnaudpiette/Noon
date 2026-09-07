"use strict";

function createExtensionStorage({ quotaBytes = 1024 * 1024 } = {}) {
  const namespaces = new Map();
  function namespace(extensionId) {
    if (!namespaces.has(extensionId)) namespaces.set(extensionId, new Map());
    const values = namespaces.get(extensionId);
    const size = () => Buffer.byteLength(JSON.stringify(Object.fromEntries(values)), "utf8");
    return Object.freeze({
      get: (key) => structuredClone(values.get(String(key))),
      set(key, value) { const previous = values.get(String(key)); values.set(String(key), structuredClone(value)); if (size() > quotaBytes) { if (previous === undefined) values.delete(String(key)); else values.set(String(key), previous); throw Object.assign(new Error("Quota extension dépassé."), { code: "EXTENSION_STORAGE_QUOTA" }); } },
      delete: (key) => values.delete(String(key)), keys: () => [...values.keys()], usageBytes: size,
    });
  }
  return { namespace, removeData: (extensionId) => namespaces.delete(extensionId), hasData: (extensionId) => namespaces.has(extensionId) };
}
module.exports = { createExtensionStorage };
