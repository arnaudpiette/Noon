"use strict";

const EXPLICIT_PATTERNS = [
  /\bje pr[eé]f[eè]re\s+(.{3,300})/i,
  /\bma pr[eé]f[eé]rence (?:est|:)\s*(.{3,300})/i,
  /\bretiens que\s+(.{3,300})/i,
  /\bsouviens-toi que\s+(.{3,300})/i,
];

function extractExplicitMemoryCandidates(text) {
  const source = String(text || "").replace(/[\r\n]+/g, " ").trim();
  for (const pattern of EXPLICIT_PATTERNS) {
    const match = source.match(pattern);
    if (!match) continue;
    return [{ subjectId: "arnaud", category: /pr[eé]f/i.test(match[0]) ? "preference" : "general", statement: match[1].replace(/[.!?]+$/, "").trim(), sensitivity: "low", status: "candidate", confidence: 1, apiPolicy: "contextual", sourceType: "explicit-user-message" }];
  }
  return [];
}

module.exports = { extractExplicitMemoryCandidates };
