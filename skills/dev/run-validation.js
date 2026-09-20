"use strict";

module.exports = {
  category: "dev", modelVisible: false,
  definition: { type: "function", name: "noon_dev_run_validation", description: "Validation interne allowlistée du Noon Dev Core.", strict: true,
    parameters: { type: "object", properties: { command: { type: "string" }, iteration: { type: "number" } }, required: ["command", "iteration"], additionalProperties: false } },
  permissions: { level: "read", explicitOrderRequired: true, confirmationRequired: false, destructive: false, networkAccess: false },
  async execute(args, context) { return context.handlers.runValidation(args); },
};
