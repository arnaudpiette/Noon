"use strict";

function createRecentEntityContext({ ttlMs = 30 * 60 * 1000, maxPerSession = 20, now = () => Date.now() } = {}) {
  const sessions = new Map();
  function remember(sessionId, entity) {
    if (!sessionId || !entity?.type || !entity?.id) return null;
    const items = (sessions.get(sessionId) || []).filter((item) => now() - item.rememberedAt <= ttlMs && !(item.type === entity.type && item.id === entity.id));
    const value = { type: String(entity.type), id: String(entity.id), label: entity.label ? String(entity.label).slice(0, 160) : null, workspaceId: entity.workspaceId || null, rememberedAt: now() };
    sessions.set(sessionId, [value, ...items].slice(0, maxPerSession)); return value;
  }
  function list(sessionId, type = null) { const items = (sessions.get(sessionId) || []).filter((item) => now() - item.rememberedAt <= ttlMs && (!type || item.type === type)); sessions.set(sessionId, items); return items.map((item) => ({ ...item })); }
  function resolve(sessionId, type = null) { const matches = list(sessionId, type); return matches.length === 1 ? { status: "resolved", entity: matches[0], candidates: matches } : matches.length > 1 ? { status: "ambiguous", candidates: matches } : { status: "not_found", candidates: [] }; }
  function clear(sessionId) { return sessions.delete(sessionId); }
  return { clear, list, remember, resolve };
}

module.exports = { createRecentEntityContext };
