"use strict";

// Convertit le schéma d'entrée d'un outil MCP en schéma strict accepté par le
// registre Noon (additionalProperties:false, toutes les propriétés requises).
// Une propriété optionnelle devient nullable ; la valeur null est retirée avant
// l'appel au serveur MCP. Un schéma non convertible rend l'outil invisible.

const DROPPED_KEYWORDS = new Set(["$schema", "$id", "$defs", "definitions", "default", "examples", "title", "readOnly", "writeOnly", "deprecated", "$comment"]);
const MAX_DEPTH = 8;

class McpSchemaError extends Error {
  constructor(message) { super(message); this.name = "McpSchemaError"; this.code = "MCP_SCHEMA_UNSUPPORTED"; }
}

function cleanKeywords(schema) {
  return Object.fromEntries(Object.entries(schema).filter(([key]) => !DROPPED_KEYWORDS.has(key)));
}

function nullable(schema) {
  if (typeof schema.type === "string") return { ...schema, type: [schema.type, "null"] };
  if (Array.isArray(schema.type)) return schema.type.includes("null") ? schema : { ...schema, type: [...schema.type, "null"] };
  return { anyOf: [schema, { type: "null" }] };
}

function convert(schema, depth, location) {
  if (depth > MAX_DEPTH) throw new McpSchemaError(`Schéma trop profond (${location}).`);
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) throw new McpSchemaError(`Schéma invalide (${location}).`);
  if (schema.$ref) throw new McpSchemaError(`Référence $ref non prise en charge (${location}).`);
  const base = cleanKeywords(schema);
  for (const keyword of ["anyOf", "oneOf", "allOf"]) {
    if (Array.isArray(base[keyword])) base[keyword] = base[keyword].map((entry, index) => convert(entry, depth + 1, `${location}.${keyword}[${index}]`));
  }
  const isObject = base.type === "object" || (Array.isArray(base.type) && base.type.includes("object")) || (!base.type && base.properties);
  if (isObject) {
    const properties = base.properties && typeof base.properties === "object" ? base.properties : {};
    if (Object.keys(properties).length === 0 && base.additionalProperties !== false && depth > 0) {
      throw new McpSchemaError(`Objet libre non pris en charge (${location}).`);
    }
    const required = new Set(Array.isArray(base.required) ? base.required : []);
    const converted = {};
    for (const [name, property] of Object.entries(properties)) {
      const child = convert(property, depth + 1, `${location}.${name}`);
      converted[name] = required.has(name) ? child : nullable(child);
    }
    return { ...base, type: base.type || "object", properties: converted, required: Object.keys(converted), additionalProperties: false };
  }
  if (base.type === "array" || (Array.isArray(base.type) && base.type.includes("array"))) {
    if (base.items) base.items = convert(base.items, depth + 1, `${location}[]`);
  }
  return base;
}

function toStrictSchema(inputSchema) {
  const schema = inputSchema && typeof inputSchema === "object" ? inputSchema : { type: "object", properties: {} };
  if (schema.type && schema.type !== "object") throw new McpSchemaError("Le schéma racine doit être un objet.");
  const strict = convert({ ...schema, type: "object" }, 0, "input");
  return { strict, optional: Object.keys(schema.properties || {}).filter((name) => !(schema.required || []).includes(name)) };
}

// Retire les null ajoutés par la conversion stricte sur les champs optionnels de premier niveau.
function stripNullOptionals(args, optional = []) {
  const value = { ...(args || {}) };
  for (const name of optional) if (value[name] === null) delete value[name];
  return value;
}

module.exports = { McpSchemaError, toStrictSchema, stripNullOptionals };
