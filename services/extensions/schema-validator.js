"use strict";

function fail(path, message) { throw Object.assign(new TypeError(`${path}: ${message}`), { code: "EXTENSION_SCHEMA_VALIDATION_FAILED" }); }
function validateValue(schema, value, path = "$", { rejectUnknown = true } = {}) {
  if (!schema || typeof schema !== "object") fail(path, "schéma absent");
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail(path, "objet attendu");
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) fail(`${path}.${key}`, "champ obligatoire absent");
    if (rejectUnknown && schema.additionalProperties === false) for (const key of Object.keys(value)) if (!Object.hasOwn(schema.properties || {}, key)) fail(`${path}.${key}`, "champ inconnu");
    for (const [key, child] of Object.entries(schema.properties || {})) if (Object.hasOwn(value, key)) validateValue(child, value[key], `${path}.${key}`, { rejectUnknown });
  } else if (schema.type === "array") {
    if (!Array.isArray(value)) fail(path, "tableau attendu");
    if (schema.maxItems != null && value.length > schema.maxItems) fail(path, "trop d’éléments");
    value.forEach((item, index) => validateValue(schema.items, item, `${path}[${index}]`, { rejectUnknown }));
  } else if (schema.type === "string") {
    if (typeof value !== "string") fail(path, "chaîne attendue");
    if (schema.maxLength != null && value.length > schema.maxLength) fail(path, "chaîne trop longue");
    if (schema.enum && !schema.enum.includes(value)) fail(path, "valeur non autorisée");
  } else if (schema.type === "number" || schema.type === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value) || (schema.type === "integer" && !Number.isInteger(value))) fail(path, "nombre attendu");
  } else if (schema.type === "boolean" && typeof value !== "boolean") fail(path, "booléen attendu");
  return true;
}
module.exports = { validateValue };
