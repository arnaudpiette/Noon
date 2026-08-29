"use strict";

// Registre des agents spécialisés et règles qui choisissent l’agent adapté à une demande.

const AGENT_PROFILES = Object.freeze([
  { id: "mail", name: "Agent Mail", role: "E-mails et correspondance", allowedTools: ["gmail_read", "gmail_draft"], forbiddenTools: ["send_without_approval"], defaultMode: "DA", maxTurns: 3, budgetPolicy: "shared", approvalPolicy: "external-write" },
  { id: "planning", name: "Agent Planning", role: "Agenda et organisation", allowedTools: ["calendar_read", "reminders_prepare"], forbiddenTools: ["calendar_write_without_approval"], defaultMode: "DA", maxTurns: 3, budgetPolicy: "shared", approvalPolicy: "external-write" },
  { id: "openclassrooms", name: "Agent OpenClassrooms", role: "Projets et soutenances", allowedTools: ["read_file", "browse_directory"], forbiddenTools: ["external_write"], defaultMode: "DEV", maxTurns: 3, budgetPolicy: "shared", approvalPolicy: "external-write" },
  { id: "dev", name: "Agent DEV", role: "Code, tests et débogage", allowedTools: ["read_file", "browse_directory", "search_files"], forbiddenTools: ["push_without_approval"], defaultMode: "DEV", maxTurns: 3, budgetPolicy: "shared", approvalPolicy: "external-write" },
  { id: "design", name: "Agent Design/DA", role: "Direction artistique et design", allowedTools: ["read_file", "browse_directory"], forbiddenTools: ["external_write"], defaultMode: "DA", maxTurns: 3, budgetPolicy: "shared", approvalPolicy: "external-write" },
]);

function routeNoonRequest(request, context = {}) {
  const text = String(request?.question || request || "").toLowerCase();
  const rules = [
    ["mail", /\b(mail|email|gmail|répondre|destinataire)\b/],
    ["planning", /\b(agenda|calendrier|planning|rendez-vous|rappel)\b/],
    ["openclassrooms", /\b(openclassrooms|soutenance|projet\s*\d+)\b/],
    ["dev", /\b(bug|code|test|api|serveur|router|composant)\b/],
  ];
  const selectedId = rules.find(([, pattern]) => pattern.test(text))?.[0] ||
    (context.mode === "DEV" ? "dev" : "design");
  return AGENT_PROFILES.find((profile) => profile.id === selectedId);
}

module.exports = { AGENT_PROFILES, routeNoonRequest };
