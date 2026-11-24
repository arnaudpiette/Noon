// @ts-check
"use strict";

const { createConnector, providerFetch } = require("./base-connector");
/** @param {string} rawUrl */
function parseFigmaUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" || !["figma.com", "www.figma.com"].includes(url.hostname)) return null;
    const match = url.pathname.match(/^\/(?:file|design)\/([A-Za-z0-9_-]+)/);
    return match ? { fileKey: match[1], nodeId: url.searchParams.get("node-id") } : null;
  } catch { return null; }
}
/** @param {import("./base-connector").ConnectorDependencies & { tokenStore: NonNullable<import("./base-connector").ConnectorDependencies["tokenStore"]> }} deps */
function createFigmaConnector(deps) {
  const base = createConnector({ id: "figma", displayName: "Figma",
    capabilities: ["file", "nodes", "images", "comments", "analysis"],
    readCapabilities: ["file", "nodes", "images", "comments"], writeCapabilities: ["comment_with_approval"],
    scopes: ["file_content:read", "file_metadata:read", "file_comments:read"],
  }, deps);
  const token = () => deps.tokenStore.get("figma")?.access_token;
  /** @param {string} path */
  const api = (path) => providerFetch(`https://api.figma.com${path}`, { token: token() });
  return { ...base, parseFigmaUrl,
    getFigmaFile: (/** @type {string} */ key, depth = 2) => api(`/v1/files/${encodeURIComponent(key)}?depth=${Math.min(4, Math.max(1, depth))}`),
    getFigmaNodes: (/** @type {string} */ key, /** @type {string[]} */ ids) => api(`/v1/files/${encodeURIComponent(key)}/nodes?ids=${encodeURIComponent(ids.slice(0, 50).join(","))}`),
    getFigmaImages: (/** @type {string} */ key, /** @type {string[]} */ ids) => api(`/v1/images/${encodeURIComponent(key)}?ids=${encodeURIComponent(ids.slice(0, 50).join(","))}`),
    getFigmaComments: (/** @type {string} */ key) => api(`/v1/files/${encodeURIComponent(key)}/comments`),
    analyzeFigmaDesign: (/** @type {string} */ url) => ({ parsed: parseFigmaUrl(url), mode: "local-analysis" }),
    compareFigmaWithLocalProject: (/** @type {string} */ url, /** @type {string} */ projectId) => ({ parsed: parseFigmaUrl(url), projectId }) };
}
module.exports = { createFigmaConnector, parseFigmaUrl };
