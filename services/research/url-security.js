"use strict";

const net = require("node:net");

function isPrivateIp(hostname) {
  const value = String(hostname || "").replace(/^\[|\]$/g, "").toLowerCase();
  if (["localhost", "localhost.localdomain", "0.0.0.0", "::", "::1"].includes(value) || value.endsWith(".local")) return true;
  if (net.isIP(value) === 4) {
    const [a, b] = value.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  if (net.isIP(value) === 6) return value === "::1" || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea") || value.startsWith("feb");
  return false;
}

function normalizePublicUrl(rawUrl, { allowHttp = false } = {}) {
  let url;
  try { url = new URL(String(rawUrl || "")); } catch { throw Object.assign(new Error("URL publique invalide."), { code: "PUBLIC_URL_INVALID" }); }
  if (url.username || url.password || (!allowHttp && url.protocol !== "https:") || (allowHttp && !["https:", "http:"].includes(url.protocol))) throw Object.assign(new Error("Schéma URL public interdit."), { code: "PUBLIC_URL_SCHEME_BLOCKED" });
  if (!url.hostname || isPrivateIp(url.hostname)) throw Object.assign(new Error("Adresse locale ou privée bloquée."), { code: "PUBLIC_URL_PRIVATE_HOST" });
  for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$|mc_)/i.test(key)) url.searchParams.delete(key);
  url.hash = "";
  return url.href;
}

function validateRedirectChain(urls = [], options) { return urls.map((url) => normalizePublicUrl(url, options)); }

module.exports = { isPrivateIp, normalizePublicUrl, validateRedirectChain };
