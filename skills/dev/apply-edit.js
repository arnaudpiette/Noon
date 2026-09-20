"use strict";

module.exports = {
  category: "dev", modelVisible: false,
  definition: { type: "function", name: "noon_dev_apply_edit", description: "Opération interne bornée du Noon Dev Core.", strict: true,
    parameters: { type: "object", properties: {
      type: { type: "string", enum: ["CREATE", "MODIFY", "DELETE"] }, path: { type: "string" }, expectedHash: { type: ["string", "null"] },
      search: { type: ["string", "null"] }, replacement: { type: ["string", "null"] }, content: { type: ["string", "null"] }, iteration: { type: "number" },
    }, required: ["type", "path", "expectedHash", "search", "replacement", "content", "iteration"], additionalProperties: false } },
  permissions: { level: "write", explicitOrderRequired: true, confirmationRequired: false, destructive: false, networkAccess: false },
  async execute(args, context) { return context.handlers.applyEdit(args); },
};
