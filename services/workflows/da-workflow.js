"use strict";
function analyzeBrief(brief = {}) {
  const required = ["objective", "target", "message", "constraints", "deliverables"];
  return { ...brief, missing: required.filter((key) => !brief[key]), questions: required.filter((key) => !brief[key]).map((key) => `Préciser : ${key}`) };
}
function buildCreativeAxes(brief) {
  return [
    { name: "Système radical", idea: "Réduire le langage visuel à une structure forte et mémorable.", tone: "direct", typography: "grotesque contrastée", palette: "noir, blanc, accent fluorescent", risk: "peut sembler austère" },
    { name: "Narration humaine", idea: "Construire l’identité autour des usages et des personnes.", tone: "chaleureux", typography: "humaniste", palette: "neutres chauds et accent vivant", risk: "demande des visuels authentiques" },
    { name: "Mouvement modulaire", idea: "Exprimer la transformation par des modules évolutifs.", tone: "prospectif", typography: "variable", palette: "base sombre et gradients contrôlés", risk: "animation à maîtriser" },
  ].map((axis) => ({ ...axis, justification: brief?.objective || "À relier au brief", composition: "grille structurée", iconography: "cohérente", animation: "optionnelle", strengths: ["distinctif"], targetFit: brief?.target || "à préciser" }));
}
module.exports = { analyzeBrief, buildCreativeAxes };
