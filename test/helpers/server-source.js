"use strict";

// V3-L7 — les routes HTTP et les grandes fonctions sortent progressivement de server.js vers des
// modules. Les tests de câblage lisent ici server.js suivi de ces modules, pour garder leurs vérifications.
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
const ROUTE_MODULES = Object.freeze([
  "services/http/static-assets.js",
  "services/memory/memory-http-routes.js",
  "services/personal-intelligence/personal-intelligence-http-routes.js",
  "services/dev/dev-http-routes.js",
  "services/workspaces/projects-http-routes.js",
  "services/sessions/conversation-http-routes.js",
  "services/voice/voice-http-routes.js",
  "services/control-center/system-http-routes.js",
  "services/goals/goals-http-routes.js",
  "services/voice/transcription-http-routes.js",
  "services/planning/day-http-routes.js",
  "services/workspaces/workspace-http-routes.js",
  "services/search/local-files-http-routes.js",
  "services/models/budget-http-routes.js",
  "services/capture/capture-http-routes.js",
  "services/jobs/jobs-http-routes.js",
  "services/memory/legacy-memory-http-routes.js",
  "services/daily-brief/brief-http-routes.js",
  "services/approvals/approvals-http-routes.js",
  "services/orchestration/ai-http-routes.js",
  "services/config/config-status-http-routes.js",
  "services/runtime/runtime-status-http-routes.js",
  "services/orchestration/ask-ai.js",
  "services/models/usage-tracking.js",
  "services/context/local-projects.js",
  "services/context/personal-context-composition.js",
  "services/memory/personal-memory-composition.js",
  "services/sessions/conversation-store.js",
  "services/connectors/google-account.js",
  "services/models/configured-model-route.js",
  "services/daily-brief/daily-brief-composition.js",
  "services/control-center/control-center-composition.js",
  "services/models/model-response.js",
  "services/intents/intent-context.js",
  "services/delegation/chat-delegation-composition.js",
  "services/orchestration/chat-orchestration-composition.js",
  "services/dev/dev-runtime-composition.js",
  "services/dev/dev-auxiliary-composition.js",
  "services/http/noon-http-server.js",
  "services/voice/session-activity-and-transcription.js",
  "services/http/route-modules-composition.js",
  "services/reliability/core-reliability-components.js",
  "services/search/personal-search-composition.js",
  "services/lifecycle/lifecycle-composition.js",
  "services/personal-intelligence/personal-intelligence-composition.js",
]);

function readServerSource() {
  return [path.join(ROOT, "server.js"), ...ROUTE_MODULES.map((file) => path.join(ROOT, file))]
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n");
}

module.exports = { ROUTE_MODULES, readServerSource };
