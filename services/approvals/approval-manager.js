"use strict";

// Compatibilité : l'ancien nom pointe désormais vers l'unique Approval Engine.
const engine = require("./approval-engine");

module.exports = { ...engine, ApprovalManager: engine.ApprovalEngine };
