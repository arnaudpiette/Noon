"use strict";

const PROVIDER_ERROR_CODES = Object.freeze([
  "AUTH_ERROR",
  "RATE_LIMIT",
  "TIMEOUT",
  "NETWORK_ERROR",
  "MODEL_UNAVAILABLE",
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_ERROR",
  "INVALID_RESPONSE",
]);

class ModelProviderError extends Error {
  constructor(code, message, { provider = null, status = null, cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "ModelProviderError";
    this.code = PROVIDER_ERROR_CODES.includes(code) ? code : "PROVIDER_ERROR";
    this.provider = provider;
    this.status = Number(status) || null;
  }
}

function assertModelProviderAdapter(adapter) {
  if (!adapter || typeof adapter !== "object") throw new TypeError("ModelProviderAdapter requis.");
  for (const method of ["execute", "stream", "createToolResult", "capabilities"]) {
    if (typeof adapter[method] !== "function") throw new TypeError(`ModelProviderAdapter.${method} requis.`);
  }
  if (!adapter.provider || typeof adapter.provider !== "string") throw new TypeError("Provider ID requis.");
  return adapter;
}

module.exports = { ModelProviderError, PROVIDER_ERROR_CODES, assertModelProviderAdapter };
