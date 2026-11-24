"use strict";

// V3-L7 — construction groupée des modules de routes HTTP, sortie de server.js. Chaque module
// reçoit uniquement ses DEPENDENCIES, lues à chaque accès dans l’objet d’accesseurs fourni par
// server.js (pickDependencies). Les fabriques n’ont aucun effet de bord à la construction : elles
// vérifient leurs dépendances puis renvoient un gestionnaire ; l’ordre d’aiguillage des requêtes
// reste celui de services/http/noon-http-server.js.

const { pickDependencies } = require("./route-dependencies");
const { DEPENDENCIES: personalIntelligenceDependencies, createPersonalIntelligenceHttpRoutes } = require("../personal-intelligence/personal-intelligence-http-routes");
const { DEPENDENCIES: devDependencies, createDevHttpRoutes } = require("../dev/dev-http-routes");
const { DEPENDENCIES: projectsDependencies, createProjectsHttpRoutes } = require("../workspaces/projects-http-routes");
const { DEPENDENCIES: conversationDependencies, createConversationHttpRoutes } = require("../sessions/conversation-http-routes");
const { DEPENDENCIES: voiceDependencies, createVoiceHttpRoutes } = require("../voice/voice-http-routes");
const { DEPENDENCIES: systemDependencies, createSystemHttpRoutes } = require("../control-center/system-http-routes");
const { DEPENDENCIES: goalsDependencies, createGoalsHttpRoutes } = require("../goals/goals-http-routes");
const { DEPENDENCIES: transcriptionDependencies, createTranscriptionHttpRoutes } = require("../voice/transcription-http-routes");
const { DEPENDENCIES: dayDependencies, createDayHttpRoutes } = require("../planning/day-http-routes");
const { DEPENDENCIES: workspaceDependencies, createWorkspaceHttpRoutes } = require("../workspaces/workspace-http-routes");
const { DEPENDENCIES: localFilesDependencies, createLocalFilesHttpRoutes } = require("../search/local-files-http-routes");
const { DEPENDENCIES: budgetDependencies, createBudgetHttpRoutes } = require("../models/budget-http-routes");
const { DEPENDENCIES: captureDependencies, createCaptureHttpRoutes } = require("../capture/capture-http-routes");
const { DEPENDENCIES: jobsDependencies, createJobsHttpRoutes } = require("../jobs/jobs-http-routes");
const { DEPENDENCIES: legacyMemoryDependencies, createLegacyMemoryHttpRoutes } = require("../memory/legacy-memory-http-routes");
const { DEPENDENCIES: briefDependencies, createBriefHttpRoutes } = require("../daily-brief/brief-http-routes");
const { DEPENDENCIES: approvalsDependencies, createApprovalsHttpRoutes } = require("../approvals/approvals-http-routes");
const { DEPENDENCIES: aiDependencies, createAiHttpRoutes } = require("../orchestration/ai-http-routes");
const { DEPENDENCIES: configStatusDependencies, createConfigStatusHttpRoutes } = require("../config/config-status-http-routes");
const { DEPENDENCIES: runtimeStatusDependencies, createRuntimeStatusHttpRoutes } = require("../runtime/runtime-status-http-routes");

// Ordre de construction : celui de server.js avant l’extraction.
const ROUTE_MODULES = Object.freeze([
  ["personalIntelligenceHttpRoutes", createPersonalIntelligenceHttpRoutes, personalIntelligenceDependencies],
  ["devHttpRoutes", createDevHttpRoutes, devDependencies],
  ["projectsHttpRoutes", createProjectsHttpRoutes, projectsDependencies],
  ["conversationHttpRoutes", createConversationHttpRoutes, conversationDependencies],
  ["voiceHttpRoutes", createVoiceHttpRoutes, voiceDependencies],
  ["systemHttpRoutes", createSystemHttpRoutes, systemDependencies],
  ["goalsHttpRoutes", createGoalsHttpRoutes, goalsDependencies],
  ["transcriptionHttpRoutes", createTranscriptionHttpRoutes, transcriptionDependencies],
  ["dayHttpRoutes", createDayHttpRoutes, dayDependencies],
  ["workspaceHttpRoutes", createWorkspaceHttpRoutes, workspaceDependencies],
  ["localFilesHttpRoutes", createLocalFilesHttpRoutes, localFilesDependencies],
  ["budgetHttpRoutes", createBudgetHttpRoutes, budgetDependencies],
  ["captureHttpRoutes", createCaptureHttpRoutes, captureDependencies],
  ["jobsHttpRoutes", createJobsHttpRoutes, jobsDependencies],
  ["legacyMemoryHttpRoutes", createLegacyMemoryHttpRoutes, legacyMemoryDependencies],
  ["briefHttpRoutes", createBriefHttpRoutes, briefDependencies],
  ["approvalsHttpRoutes", createApprovalsHttpRoutes, approvalsDependencies],
  ["aiHttpRoutes", createAiHttpRoutes, aiDependencies],
  ["configStatusHttpRoutes", createConfigStatusHttpRoutes, configStatusDependencies],
  ["runtimeStatusHttpRoutes", createRuntimeStatusHttpRoutes, runtimeStatusDependencies],
]);

function createHttpRouteModules(source) {
  const modules = {};
  for (const [name, factory, dependencies] of ROUTE_MODULES) modules[name] = factory(pickDependencies(source, dependencies));
  return modules;
}

// Noms que l’objet d’accesseurs de server.js doit exposer (union des DEPENDENCIES).
const HTTP_ROUTE_DEPENDENCIES = Object.freeze([...new Set(ROUTE_MODULES.flatMap(([, , dependencies]) => dependencies))].sort());

module.exports = { HTTP_ROUTE_DEPENDENCIES, ROUTE_MODULES, createHttpRouteModules };
