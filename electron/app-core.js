"use strict";

// Fonctions pures de sécurité Electron : validation des liens, raccourcis et navigations.

const ALLOWED_DEEP_LINKS = new Set(["open", "live", "wake", "brief", "focus", "mode", "new-conversation", "settings", "diagnostic"]);

function parseNoonDeepLink(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "noon:") return null;
    const action = url.hostname || url.pathname.replace(/^\/+/, "");
    if (!ALLOWED_DEEP_LINKS.has(action)) return null;
    if (action === "mode") {
      const value = String(url.searchParams.get("value") || "").toUpperCase();
      return new Set(["DA", "DEV", "SOUTENANCE"]).has(value) ? { action, value } : null;
    }
    if (action === "focus") {
      const id = String(url.searchParams.get("id") || "").trim();
      return /^[a-zA-Z0-9_-]{1,80}$/.test(id) ? { action, id } : null;
    }
    return { action };
  } catch {
    return null;
  }
}

function isSafeExternalUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "https:" && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function isValidAccelerator(value) {
  return typeof value === "string" && value.length <= 80 &&
    /^(?=.*(?:Command|Cmd|Control|Ctrl|Alt|Option|Shift))[-+A-Za-z0-9]+(?:\+[-+A-Za-z0-9]+)+$/.test(value);
}

module.exports = { isSafeExternalUrl, isValidAccelerator, parseNoonDeepLink };
