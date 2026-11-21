"use strict";

function reportContent(record, format) {
  if (!record?.analysis || record.analysis.stale || record.analysis.transcriptRevision !== record.transcript?.revision) {
    throw new Error("Analyse absente ou périmée. Vérifie la transcription et relance l'analyse.");
  }
  const { summary, claims } = record.analysis;
  if (format === "xlsx") {
    const cell = (value) => `"${String(value || "").replaceAll('"', '""').replace(/\r?\n/g, " ")}"`;
    return [
      ["Type", "Proposition à vérifier", "Citation exacte", "Statut"].map(cell).join(","),
      ...claims.map((claim) => [claim.type, claim.text, claim.quote, "À vérifier"].map(cell).join(",")),
    ].join("\n");
  }
  if (format === "pptx") {
    const summarySlides = summary.match(/[\s\S]{1,850}/g) || [""];
    const slides = summarySlides.map((part, i) => `Synthèse ${i + 1}\n${part}`);
    for (let i = 0; i < claims.length; i += 2) {
      slides.push(`Propositions à vérifier\n${claims.slice(i, i + 2).map((claim) =>
        `${claim.type.toUpperCase()} : ${claim.text}\nSource : « ${claim.quote} »`).join("\n\n")}`);
    }
    if (slides.length > 40) throw new Error("Analyse trop longue pour une présentation de 40 diapositives.");
    return slides.join("\n---\n");
  }
  const sections = [
    "Synthèse — brouillon à vérifier", summary,
    "Décisions, actions et questions à vérifier",
    ...claims.map((claim) => `[${claim.type}] ${claim.text}\nCitation exacte : « ${claim.quote} »\nStatut : à vérifier`),
    "Transcription corrigée", record.transcript.text,
  ];
  return sections.join("\n\n");
}

module.exports = { reportContent };
