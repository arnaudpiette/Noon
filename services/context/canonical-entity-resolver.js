"use strict";

const ENTITY_TYPES = Object.freeze(["PROJECT", "WORKSPACE", "FOCUS", "PERSON"]);
const RESOLUTION_STATUSES = Object.freeze(["RESOLVED", "AMBIGUOUS", "NOT_FOUND"]);
const AMBIGUITY_MARGIN = 0.15;

function normalizeEntityLookup(value) {
  return String(value || "").toLocaleLowerCase("fr").normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ").trim();
}
function levenshtein(left, right) {
  const a = String(left); const b = String(right);
  if (Math.abs(a.length - b.length) > 1) return 2;
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1)); previous = current;
    }
  }
  return row[b.length];
}
function bounded(value, max = 20) { return Array.isArray(value) ? value.slice(0, max) : []; }
function entity(type, value, source) {
  const canonicalName = String(value.canonicalName || value.name || value.displayName || value.label || value.id || "").trim();
  return { id: String(value.id), type, canonicalName, aliases: [...new Set([canonicalName, ...(value.aliases || [])].map(String).filter(Boolean))].slice(0, 30), source };
}
function result(status, query, candidates = [], extra = {}) {
  return { status, query: String(query || ""), candidates: candidates.map(({ aliases: _aliases, score: _score, ...item }) => item), ...extra };
}

function createCanonicalEntityResolver({
  projectProvider = () => [], focusProvider = () => [], workspaceProvider = () => [],
  peopleProvider = () => [], observability = null, now = () => Date.now(),
} = {}) {
  const emit = (event, metadata) => { try { observability?.(event, metadata); } catch {} };
  function candidatesFor(expectedType) {
    const allowed = expectedType ? [expectedType] : ENTITY_TYPES;
    const candidates = [];
    if (allowed.includes("PROJECT")) for (const item of bounded(projectProvider(), 500)) if (item?.id) candidates.push(entity("PROJECT", item, "project_registry"));
    if (allowed.includes("FOCUS")) for (const item of bounded(focusProvider(), 200)) if (item?.id) candidates.push(entity("FOCUS", { ...item, canonicalName: item.displayName }, "focus_catalog"));
    if (allowed.includes("WORKSPACE")) for (const item of bounded(workspaceProvider(), 200)) if (item?.id && item.status !== "archived") candidates.push(entity("WORKSPACE", item, "workspace_engine"));
    if (allowed.includes("PERSON")) for (const item of bounded(peopleProvider(), 20)) if (item?.id) candidates.push(entity("PERSON", item, "explicit_people"));
    return candidates;
  }
  function resolveEntity(input = {}) {
    const started = now(); const query = String(input.query || "").trim(); const lookup = normalizeEntityLookup(query);
    const expectedType = String(input.expectedType || "").toUpperCase() || null;
    if (expectedType && !ENTITY_TYPES.includes(expectedType)) throw new TypeError("Type d’entité attendu invalide.");
    emit("entity_resolution_started", { expectedType: expectedType || "ANY" });
    if (!lookup) return complete(result("NOT_FOUND", query), started, expectedType, "none");
    const activeProjectId = String(input.projectId || input.activeProjectId || "");
    const recent = bounded(input.recentEntities, 20).filter((item) => item && (!item.expiresAt || Date.parse(item.expiresAt) > now()));
    const scored = candidatesFor(expectedType).map((candidate) => {
      const canonical = normalizeEntityLookup(candidate.canonicalName); const aliases = candidate.aliases.map(normalizeEntityLookup);
      let score = 0; let matchedBy = null; let matchedValue = null;
      if (lookup === canonical || lookup === normalizeEntityLookup(candidate.id)) { score = 1; matchedBy = "canonical"; matchedValue = candidate.canonicalName; }
      else if (aliases.includes(lookup)) { score = 0.96; matchedBy = "alias"; matchedValue = candidate.aliases[aliases.indexOf(lookup)]; }
      else {
        const alias = aliases.find((value) => value.length >= 3 && (` ${lookup} `).includes(` ${value} `));
        if (alias) { score = 0.82; matchedBy = "alias_in_query"; matchedValue = candidate.aliases[aliases.indexOf(alias)]; }
        else if (candidate.type !== "PERSON" && !lookup.includes(" ") && lookup.length >= 5) {
          const fuzzy = aliases.find((value) => value.length >= 5 && levenshtein(lookup, value) <= 1);
          if (fuzzy) { score = 0.7; matchedBy = "minor_typo"; matchedValue = candidate.aliases[aliases.indexOf(fuzzy)]; }
        }
      }
      if (score && candidate.type === "PROJECT" && candidate.id === activeProjectId) score += 0.2;
      return score ? { ...candidate, score, matchedBy, matchedValue } : null;
    }).filter(Boolean);
    if (!scored.length && (!expectedType || expectedType === "PROJECT")) {
      const recentProjects = recent.filter((item) => String(item.entityType || item.type || "").toUpperCase() === "PROJECT");
      if (recentProjects.length === 1) {
        const ref = recentProjects[0];
        const candidate = candidatesFor("PROJECT").find((item) => item.id === String(ref.entityId || ref.id));
        if (candidate) scored.push({ ...candidate, score: 0.8, matchedBy: "recent_context", matchedValue: null });
      }
    }
    scored.sort((left, right) => right.score - left.score || left.type.localeCompare(right.type) || left.id.localeCompare(right.id));
    if (!scored.length) return complete(result("NOT_FOUND", query), started, expectedType, "none");
    const top = scored[0]; const next = scored[1];
    if (next && top.score - next.score < AMBIGUITY_MARGIN) return complete(result("AMBIGUOUS", query, scored.slice(0, 10)), started, expectedType, "ambiguous");
    return complete(result("RESOLVED", query, [top], {
      entity: { id: top.id, type: top.type, canonicalName: top.canonicalName }, matchedBy: top.matchedBy,
      matchedValue: top.matchedValue, confidence: Math.min(1, Number(top.score.toFixed(2))), sources: [top.source],
    }), started, expectedType, top.matchedBy);
  }
  function complete(value, started, expectedType, method) {
    emit("entity_resolution_completed", { status: value.status, candidateCount: value.candidates.length, entityType: value.entity?.type || expectedType || "NONE", matchMethod: method, durationMs: Math.max(0, now() - started) });
    return value;
  }
  return Object.freeze({ resolveEntity, ambiguityMargin: AMBIGUITY_MARGIN, normalizeEntityLookup });
}

module.exports = { AMBIGUITY_MARGIN, ENTITY_TYPES, RESOLUTION_STATUSES, createCanonicalEntityResolver, normalizeEntityLookup };
