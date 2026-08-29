"use strict";
module.exports = {
  category: "personal-intelligence", deferred: true,
  definition: { type: "function", name: "list_noon_inbox", description: "Liste les éléments normalisés de la boîte d’entrée locale Noon sans modifier leurs sources.", parameters: { type: "object", properties: { status: { type: ["string", "null"], enum: ["detected", "clarification_needed", "ready", "proposed", "accepted", "snoozed", "dismissed", "completed", "expired", null] } }, required: ["status"], additionalProperties: false }, strict: true },
  permissions: { level: "read", explicitOrderRequired: false, confirmationRequired: false, destructive: false, networkAccess: false },
  async execute(args, context) { return context.handlers.listNoonInbox(args.status); },
};
