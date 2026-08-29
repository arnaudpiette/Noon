"use strict";
module.exports = {
  category: "personal-intelligence", deferred: true,
  definition: { type: "function", name: "suggest_time_slots", description: "Recherche jusqu’à trois créneaux Calendar libres en lecture seule. Ne crée aucun événement.", parameters: { type: "object", properties: { duration_minutes: { type: "integer", minimum: 15, maximum: 240 }, mode: { type: "string", enum: ["DA", "DEV", "SOUTENANCE", "FOCUS"] } }, required: ["duration_minutes", "mode"], additionalProperties: false }, strict: true },
  permissions: { level: "read", explicitOrderRequired: false, confirmationRequired: false, destructive: false, networkAccess: true },
  async execute(args, context) { return context.handlers.suggestTimeSlots(args.duration_minutes, args.mode); },
};
