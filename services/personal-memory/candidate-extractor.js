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
    const rawStatement = match[1].replace(/[.!?]+$/, "").trim();
    if (/\b(?:tout\s+ce\s+qui\s+est\s+(?:important|utile|pertinent)|ce\s+(?:dossier|document|fichier)|la\s+pi[eè]ce\s+jointe|les\s+fichiers?|ce\s+que\s+je\s+viens\s+de)\b/i.test(rawStatement)) {
      continue;
    }
    return [{ subjectId: "arnaud", category: /pr[eé]f/i.test(match[0]) ? "preference" : "general", statement: rawStatement, sensitivity: "low", status: "candidate", confidence: 1, apiPolicy: "contextual", sourceType: "explicit-user-message" }];
  }
  return [];
}

module.exports = { extractExplicitMemoryCandidates };
