"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createCanonicalEntityResolver } = require("../services/context/canonical-entity-resolver");

function fixture(overrides = {}) {
  const events = [];
  const resolver = createCanonicalEntityResolver({
    projectProvider: () => [
      { id: "portfolio", name: "Portfolio", aliases: ["Projet 8", "site portfolio", "site"] },
      { id: "website", name: "Website", aliases: ["site", "site web"] },
    ],
    focusProvider: () => [{ id: "focus-portfolio", displayName: "Portfolio Focus", aliases: ["focus portfolio"] }],
    workspaceProvider: () => [{ id: "workspace-portfolio", name: "Portfolio Workspace", status: "active" }],
    peopleProvider: () => [{ id: "alexandra", name: "Alexandra", aliases: ["Alex"] }, { id: "alexis", name: "Alexis", aliases: ["Alex"] }],
    observability: (event, metadata) => events.push({ event, metadata }),
    ...overrides,
  });
  return { resolver, events };
}

test("résout le nom canonique, un alias, casse et espaces", () => {
  const { resolver } = fixture();
  for (const query of ["Portfolio", "  PORTFOLIO  ", "Projet 8"]) {
    const result = resolver.resolveEntity({ query, expectedType: "PROJECT" });
    assert.equal(result.status, "RESOLVED"); assert.equal(result.entity.id, "portfolio");
  }
});

test("tolère une faute mineure sans fuzzy matching large", () => {
  const { resolver } = fixture();
  assert.equal(resolver.resolveEntity({ query: "Portfoli", expectedType: "PROJECT" }).entity.id, "portfolio");
  assert.equal(resolver.resolveEntity({ query: "foobar-inexistant", expectedType: "PROJECT" }).status, "NOT_FOUND");
});

test("une ambiguïté n'est jamais choisie silencieusement", () => {
  const { resolver } = fixture();
  const result = resolver.resolveEntity({ query: "site", expectedType: "PROJECT" });
  assert.equal(result.status, "AMBIGUOUS"); assert.equal(result.candidates.length, 2);
});

test("le projet actif désambiguïse seulement des candidats déjà trouvés", () => {
  const { resolver } = fixture();
  const result = resolver.resolveEntity({ query: "continue le site", expectedType: "PROJECT", projectId: "portfolio" });
  assert.equal(result.status, "RESOLVED"); assert.equal(result.entity.id, "portfolio");
  assert.equal(resolver.resolveEntity({ query: "continue les cartes", expectedType: "PROJECT", projectId: "portfolio" }).status, "NOT_FOUND");
});

test("le contexte récent est borné, le changement explicite gagne et ne fuit pas entre conversations", () => {
  const { resolver } = fixture();
  const recent = [{ entityType: "project", entityId: "portfolio", expiresAt: new Date(Date.now() + 60_000).toISOString() }];
  assert.equal(resolver.resolveEntity({ query: "ajoute maintenant les cards", expectedType: "PROJECT", recentEntities: recent }).entity.id, "portfolio");
  assert.equal(resolver.resolveEntity({ query: "Website", expectedType: "PROJECT", recentEntities: recent }).entity.id, "website");
  assert.equal(resolver.resolveEntity({ query: "ajoute maintenant les cards", expectedType: "PROJECT", recentEntities: [] }).status, "NOT_FOUND");
});

test("les types sont filtrés et les personnes ambiguës ne sont jamais fuzzy-matchées", () => {
  const { resolver } = fixture();
  assert.equal(resolver.resolveEntity({ query: "Portfolio", expectedType: "PERSON" }).status, "NOT_FOUND");
  assert.equal(resolver.resolveEntity({ query: "Alex", expectedType: "PERSON" }).status, "AMBIGUOUS");
  assert.equal(resolver.resolveEntity({ query: "Alec", expectedType: "PERSON" }).status, "NOT_FOUND");
});

test("fonctionne sans provider et les événements ne contiennent ni requête ni alias", () => {
  const { resolver, events } = fixture(); const query = "Alias privé fictif";
  const result = resolver.resolveEntity({ query, expectedType: "PROJECT" });
  assert.equal(result.status, "NOT_FOUND");
  assert.equal(events.some((item) => JSON.stringify(item).includes(query)), false);
  assert.deepEqual(events.map((item) => item.event), ["entity_resolution_started", "entity_resolution_completed"]);
});
