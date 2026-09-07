"use strict";

const { defineExtension } = require("../extension-sdk");
const object = (properties, required = []) => ({ type: "object", additionalProperties: false, properties, required });
const manifest = {
  id: "com.noon.example.search", name: "Noon Example Search", version: "1.0.0", apiVersion: "1", type: "SEARCH_PROVIDER",
  entrypoint: "./noon-example-search.js", capabilities: ["example.search"], permissions: ["READ"], supportedPlatforms: ["darwin"], minimumNoonVersion: "1.0.0",
  skills: [{ id: "com.noon.example.search.query", description: "Recherche déterministe de démonstration.", permissionLevel: "READ", timeoutMs: 1000,
    inputSchema: object({ query: { type: "string", maxLength: 500 } }, ["query"]),
    outputSchema: object({ results: { type: "array", maxItems: 5, items: object({ title: { type: "string" }, provenance: { type: "string" } }, ["title", "provenance"]) } }, ["results"]) }],
};
module.exports = defineExtension({ manifest, activate() { return { skills: { "com.noon.example.search.query": async ({ query }) => ({ results: [{ title: `Résultat local : ${query}`, provenance: "bundled_example" }] }) } }; }, healthCheck: async () => ({ ok: true }) });
