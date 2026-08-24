"use strict";

const { createGmailConnector } = require("./gmail");
const { createCalendarConnector } = require("./google-calendar");
const { createDriveConnector } = require("./google-drive");
const { createGitHubConnector } = require("./github");
const { createFigmaConnector } = require("./figma");
const { createAppleConnector } = require("./apple-reminders");
const { createContactsConnector } = require("./google-contacts");
const { createConnector } = require("./base-connector");

function createConnectorRegistry(deps) {
  const connectors = [
    createGmailConnector(deps), createCalendarConnector(deps),
    createContactsConnector(deps),
    createDriveConnector(deps), createGitHubConnector(deps), createFigmaConnector(deps),
    createAppleConnector(deps),
    createConnector({ id: "apple-shortcuts", displayName: "Raccourcis Apple", capabilities: ["list", "run_fixed"], readCapabilities: ["list"], writeCapabilities: ["run_fixed"], scopes: ["macOS Shortcuts"] }, deps),
  ];
  const byId = new Map(connectors.map((connector) => [connector.id, connector]));
  return { list: () => connectors.map((connector) => connector.status), get: (id) => byId.get(id) || null,
    disconnect: (id) => { const connector = byId.get(id); if (!connector) return false; connector.disconnect(); return true; } };
}
module.exports = { createConnectorRegistry };
