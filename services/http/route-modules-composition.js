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

// Imports statiques des modules de routes : mêmes modules que server.js, donc mêmes objets
// (cache de require). Fournis tels quels, sans accesseur, et jamais aussi par server.js.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { PRIORITY_DIRECTORIES } = require("../../config");
const { modelForQuality, normalizeAccent, normalizeLanguage, normalizeVoiceQuality } = require("../../lib/voice-utils");
const { buildFocusCatalog } = require("../../lib/focus-catalog");
const { resolveProject } = require("../../lib/projects-registry");
const { findCodexExecutable } = require("../../lib/codex-bridge");
const { normalizeIntelligenceProfile } = require("../../lib/noon-intelligence");
const { DIALS: CHARACTER_DIALS } = require("../character/character-charter");
const { GENERAL_FOLDER_ID, MAX_FOLDERS, MAX_CONVERSATIONS_PER_FOLDER, createFolder, renameFolder, updateConversation, deleteFolder } = require("../../lib/conversation-index");
const { REALTIME_MODELS } = require("../voice/openai-voice-provider");
const { assertRemoteVoiceAvailable } = require("../voice/realtime-config");
const { renderResumeBriefing } = require("../resume/resume-briefing-service");
const { renderFirstStep } = require("../first-step/first-step-service");
const { DEFAULT_WEIGHTS } = require("../personal-intelligence/priority-engine");
const { GOAL_MODE_DEV_HTTP_PREFIX } = require("../goals/goal-mode-dev-http-routes");
const { assertGenericApprovalAllowed, genericApprovals } = require("../approvals/goal-mode-dev-approval-guard");
const { goalDevRetryHttpStatus, normalizeGoalDevRetryPrepareRequest, normalizeGoalDevRetryResumeRequest, projectGoalDevRetryPermitResponse, projectGoalDevRetryResumeResponse } = require("../goals/goal-dev-retry-http-contract");
const { assertDevTaskIdNotReserved, isReservedGoalModeDevTaskId } = require("../dev/dev-task-id-namespace");
const { toChatProgressEvent } = require("../observability/chat-progress-event");
const { WEB_SEARCH_PRICE_PER_CALL } = require("../observability/model-pricing");
const { getErrorHeader, readJsonBody, readTextBody, validateAttachment } = require("./request-utils");
const { resolveChatResearchPlan } = require("../research/chat-research-gate");

const STATIC_ROUTE_DEPENDENCIES = Object.freeze({
  fs,
  path,
  crypto,
  PRIORITY_DIRECTORIES,
  modelForQuality,
  normalizeAccent,
  normalizeLanguage,
  normalizeVoiceQuality,
  buildFocusCatalog,
  resolveProject,
  findCodexExecutable,
  normalizeIntelligenceProfile,
  CHARACTER_DIALS,
  GENERAL_FOLDER_ID,
  MAX_FOLDERS,
  MAX_CONVERSATIONS_PER_FOLDER,
  createFolder,
  renameFolder,
  updateConversation,
  deleteFolder,
  REALTIME_MODELS,
  assertRemoteVoiceAvailable,
  renderResumeBriefing,
  renderFirstStep,
  DEFAULT_WEIGHTS,
  GOAL_MODE_DEV_HTTP_PREFIX,
  assertGenericApprovalAllowed,
  genericApprovals,
  goalDevRetryHttpStatus,
  normalizeGoalDevRetryPrepareRequest,
  normalizeGoalDevRetryResumeRequest,
  projectGoalDevRetryPermitResponse,
  projectGoalDevRetryResumeResponse,
  assertDevTaskIdNotReserved,
  isReservedGoalModeDevTaskId,
  toChatProgressEvent,
  WEB_SEARCH_PRICE_PER_CALL,
  getErrorHeader,
  readJsonBody,
  readTextBody,
  validateAttachment,
  resolveChatResearchPlan,
});
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

// `source` : objet d’accesseurs de server.js (dépendances vivantes). Les imports statiques
// sont ajoutés par-dessus, sans lire `source` : ses accesseurs restent relus à chaque accès.
function createHttpRouteModules(source) {
  for (const name of Object.keys(STATIC_ROUTE_DEPENDENCIES)) {
    if (name in source) throw new TypeError(`Dépendance fournie deux fois : ${name}`);
  }
  const combined = Object.create(source, Object.fromEntries(
    Object.entries(STATIC_ROUTE_DEPENDENCIES).map(([name, value]) => [name, { value, enumerable: true }])
  ));
  const modules = {};
  for (const [name, factory, dependencies] of ROUTE_MODULES) modules[name] = factory(pickDependencies(combined, dependencies));
  return modules;
}

// Union des DEPENDENCIES, et la part que l’objet d’accesseurs de server.js doit exposer.
const HTTP_ROUTE_DEPENDENCIES = Object.freeze([...new Set(ROUTE_MODULES.flatMap(([, , dependencies]) => dependencies))].sort());
const HTTP_ROUTE_LIVE_DEPENDENCIES = Object.freeze(HTTP_ROUTE_DEPENDENCIES.filter((name) => !(name in STATIC_ROUTE_DEPENDENCIES)));

module.exports = { HTTP_ROUTE_DEPENDENCIES, HTTP_ROUTE_LIVE_DEPENDENCIES, ROUTE_MODULES, STATIC_ROUTE_DEPENDENCIES, createHttpRouteModules };
