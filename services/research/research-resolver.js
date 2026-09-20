"use strict";

const CURRENT = /\b(actuel(?:le)?s?|actuellement|aujourd['’ ]?hui|derni[eè]re? version|r[eé]cents?|nouveaut[eé]s?|prix|tarif|202[4-9]|news|actualit[eé]s?|maintenant)\b/i;
const PUBLIC = /\b(internet|web|en ligne|source(?:s)? publique(?:s)?|cherche sur|recherche approfondie|documentation officielle|actualit[eé]|derni[eè]re? version|v[eé]rifie)\b/i;
const PERSONAL = /\b(mon|ma|mes|notre|nos|on avait|conversation|m[eé]moire|focus|projet|fichier|gmail|agenda|note|rappel)\b/i;
const NO_WEB = /\b(sans (?:internet|web)|ne cherche pas (?:sur )?(?:internet|le web)|hors ligne uniquement)\b/i;
const FIND_REQUEST = /\b(?:trouve|cherche|recherche)(?:-moi|\s+moi)?\b/i;
const LOCAL_LOOKUP = /\b(?:fichier|dossier|r[eé]pertoire|controller|contr[oô]leur|code|conversation|m[eé]moire|souvenir|ce que tu sais|dans (?:mon|ma|mes)|projet (?:local|fictif))\b/i;

function resolveResearchScope(input = {}) {
  const text = String(input.query || "");
  if (input.scope && ["PERSONAL", "PUBLIC", "MIXED"].includes(input.scope)) return { scope: input.scope, explicit: true, reasonCodes: ["explicit_scope"] };
  if (NO_WEB.test(text) || input.webAllowed === false) return { scope: "PERSONAL", explicit: true, reasonCodes: ["user_disabled_web"] };
  const publicNeeded = input.webRequested === true || PUBLIC.test(text) || CURRENT.test(text) || (FIND_REQUEST.test(text) && !LOCAL_LOOKUP.test(text));
  const personalNeeded = input.personalRequested === true || PERSONAL.test(text);
  if (publicNeeded && personalNeeded) return { scope: "MIXED", explicit: input.webRequested === true, reasonCodes: ["public_and_personal_required"] };
  if (publicNeeded) return { scope: "PUBLIC", explicit: input.webRequested === true, reasonCodes: [CURRENT.test(text) ? "current_information" : "public_research"] };
  return { scope: "PERSONAL", explicit: false, reasonCodes: ["no_public_dependency"] };
}

function resolveExecutableResearchScope({ requestedScope } = {}) {
  const scope = ["PERSONAL", "PUBLIC", "MIXED"].includes(requestedScope)
    ? requestedScope
    : "PERSONAL";
  if (scope !== "MIXED") return { scope, mixedEnabled: false, reasonCodes: [] };
  return {
    scope: "PUBLIC",
    mixedEnabled: false,
    reasonCodes: ["mixed_disabled_until_personal_fusion"],
  };
}

function inferResearchMode(query, requestedMode) {
  if (["QUICK", "STANDARD", "DEEP", "VERIFY", "COMPARE", "CURRENT_STATE"].includes(requestedMode)) return requestedMode;
  const text = String(query || "");
  if (/\b(recherche approfondie|deep research|[eé]tude approfondie)\b/i.test(text)) return "DEEP";
  if (/\b(v[eé]rifie|est-ce vrai|confirme|fact.?check)\b/i.test(text)) return "VERIFY";
  if (/\b(compare|comparatif|versus|\bvs\b)\b/i.test(text)) return "COMPARE";
  if (CURRENT.test(text)) return "CURRENT_STATE";
  return text.length < 180 ? "QUICK" : "STANDARD";
}

function inferFreshness(query, mode) {
  const text = String(query || "");
  if (/\b(en direct|live|maintenant|cours actuel|score)\b/i.test(text)) return "LIVE";
  if (/\b(cette semaine|r[eé]cent|actualit[eé]|news)\b/i.test(text)) return "RECENT";
  if (mode === "CURRENT_STATE" || CURRENT.test(text)) return "CURRENT";
  if (/\b(histoire|historique|en 19\d{2}|en 20[0-2]\d)\b/i.test(text)) return "HISTORICAL";
  return "EVERGREEN";
}

module.exports = {
  inferFreshness, inferResearchMode,
  resolveExecutableResearchScope, resolveResearchScope,
};
