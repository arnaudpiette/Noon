"use strict";

function validateObjectSchema(schema, location = "parameters") {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    throw new Error(`Schéma invalide pour ${location}.`);
  }
  if (schema.type === "object") {
    if (schema.additionalProperties !== false) {
      throw new Error(`additionalProperties doit valoir false pour ${location}.`);
    }
    if (!schema.properties || typeof schema.properties !== "object") {
      throw new Error(`Propriétés absentes pour ${location}.`);
    }
    if (!Array.isArray(schema.required)) {
      throw new Error(`Liste required absente pour ${location}.`);
    }
    for (const [name, property] of Object.entries(schema.properties)) {
      validateNestedSchemas(property, `${location}.${name}`);
    }
  }
}

function validateNestedSchemas(schema, location) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return;
  if (schema.type === "object") validateObjectSchema(schema, location);
  if (schema.type === "array" && schema.items) validateNestedSchemas(schema.items, `${location}[]`);
  for (const keyword of ["anyOf", "oneOf", "allOf"]) {
    if (Array.isArray(schema[keyword])) {
      schema[keyword].forEach((entry, index) => validateNestedSchemas(entry, `${location}.${keyword}[${index}]`));
    }
  }
}

function validateSkill(skill) {
  if (!skill?.definition || !skill?.permissions || typeof skill.execute !== "function") {
    throw new Error("Skill incomplet : definition, permissions et execute sont obligatoires.");
  }
  const definition = skill.definition;
  if (definition.type !== "function" || !definition.name || definition.strict !== true) {
    throw new Error(`Définition invalide pour ${definition.name || "skill sans nom"}.`);
  }
  validateObjectSchema(definition.parameters);
  return true;
}

module.exports = { validateObjectSchema, validateSkill };
