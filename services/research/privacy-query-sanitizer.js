"use strict";

const crypto = require("node:crypto");

const LOCAL_PATH = /(?:\/(?:Users|home|private|Volumes|var|tmp)\/[^\s"']+|[A-Za-z]:\\[^\s"']+)/g;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE = /(?:\+\d{1,3}[ .-]?)?(?:\d[ .-]?){8,14}\d/g;

function fingerprint(value) { return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 20); }
function escaped(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function sanitizePublicQuery(input = {}) {
  const raw = String(input.query || "").replace(/[\0\r]+/g, " ").trim().slice(0, 4000);
  const explicit = new Set((input.userProvidedPublicTerms || []).map((item) => String(item).trim()).filter(Boolean));
  const forbidden = [];
  for (const item of input.privateTerms || []) {
    if (!item || explicit.has(String(item).trim())) continue;
    forbidden.push(String(item));
  }
  for (const item of input.evidence || []) {
    if (item?.localOnly || item?.allowedForRemoteModel === false || item?.sensitivity === "restricted" || item?.protectedProfile) {
      if (item.content) forbidden.push(String(item.content));
      if (item.value) forbidden.push(String(item.value));
    }
  }
  let query = raw; let removed = 0;
  for (const value of [...new Set(forbidden)].sort((a, b) => b.length - a.length)) {
    if (value.length < 3) continue;
    const pattern = new RegExp(escaped(value), "gi");
    if (pattern.test(query)) { query = query.replace(pattern, " "); removed += 1; }
  }
  for (const pattern of [LOCAL_PATH, EMAIL, PHONE]) {
    query = query.replace(pattern, () => { removed += 1; return " "; });
  }
  query = query.replace(/\s+/g, " ").trim();
  if (!query) throw Object.assign(new Error("La requête publique ne contient plus aucun terme sûr après minimisation."), { code: "PUBLIC_QUERY_EMPTY_AFTER_SANITIZATION" });
  return Object.freeze({ query, sanitized: query !== raw, privateTermsRemoved: removed, localOnlyBlocked: forbidden.length, queryFingerprint: fingerprint(query), provenance: { derivedFromUserInput: true, derivedFromPublicContext: false, sanitized: query !== raw } });
}

module.exports = { sanitizePublicQuery };
