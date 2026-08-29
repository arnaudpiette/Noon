"use strict";

const crypto = require("crypto");

function normalize(value) {
  return String(value || "").toLocaleLowerCase("fr").normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function matches(query, ...values) {
  const queryTokens = normalize(query).match(/[a-z0-9]{2,}/g) || [];
  if (!queryTokens.length) return false;
  const haystack = normalize(values.join(" "));
  return queryTokens.some((token) => haystack.includes(token));
}

function versionHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 20);
}

function createConversationAdapter({ indexProvider, transcriptProvider, summaryProvider }) {
  return {
    version() {
      const index = indexProvider();
      return versionHash((index.conversations || []).map(({ id, updatedAt, title }) => [id, updatedAt, title]));
    },
    search(request) {
      const conversations = [...(indexProvider().conversations || [])]
        .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
        .slice(0, 60);
      const results = [];
      for (const conversation of conversations) {
        const summary = summaryProvider(conversation.id) || "";
        const transcript = transcriptProvider(conversation.id).slice(-20);
        const matchedMessageIndex = transcript.findIndex((message) => matches(request.query, message.content));
        if (!matches(request.query, conversation.title, summary) && matchedMessageIndex < 0) continue;
        const message = matchedMessageIndex >= 0 ? transcript[matchedMessageIndex] : null;
        results.push({
          sourceId: conversation.id,
          title: conversation.title || "Conversation Noon",
          snippet: String(message?.content || summary || conversation.title || "").slice(0, 1000),
          timestamp: conversation.updatedAt || message?.savedAt || null,
          profileScope: request.profileScope,
          projectId: conversation.projectId || null,
          locator: { conversationId: conversation.id, ...(matchedMessageIndex >= 0 ? { messageIndex: matchedMessageIndex } : {}) },
          provenance: { label: `Conversation — ${conversation.title || conversation.id}`, status: "current" },
        });
      }
      return results;
    },
  };
}

function createMemoryAdapter({ memoryEngine }) {
  return {
    version: () => versionHash(memoryEngine.lastUsage?.() || {}),
    search(request) {
      return memoryEngine.search({
        query: request.query,
        profileScope: request.profileScope,
        includeHistorical: request.intent === "HISTORY_LOOKUP",
        limit: request.resultsPerSource,
      }).map((memory) => ({
        sourceId: memory.id,
        title: memory.status === "candidate" ? "Mémoire candidate" : "Mémoire personnelle",
        snippet: memory.statement,
        timestamp: memory.timestamp,
        profileScope: memory.profileScope,
        sensitivity: memory.sensitivity,
        localOnly: memory.localOnly,
        allowedForRemoteModel: memory.allowedForRemoteModel,
        derivedFrom: memory.derivedFrom,
        locator: { memoryId: memory.id, version: memory.version },
        provenance: { label: memory.source || "Mémoire Noon", status: memory.status, version: memory.version },
        canonicalKey: `memory:${normalize(memory.statement)}`,
      }));
    },
  };
}

function createProjectAdapter({ projectsProvider }) {
  return {
    version: () => versionHash(projectsProvider().map(({ id, updatedAt, lastActivityAt }) => [id, updatedAt, lastActivityAt])),
    search(request) {
      return projectsProvider().filter((project) => matches(request.query,
        project.name, project.title, project.description, project.objective,
        project.nextAction, ...(project.blockers || []), ...(project.signals || []).map((signal) => signal.message)))
        .slice(0, request.resultsPerSource).map((project) => ({
          sourceId: project.id || project.path || project.name,
          title: project.name || project.title || "Projet Noon",
          snippet: project.nextAction || project.objective || project.description ||
            project.signals?.[0]?.message || `Projet ${project.status || "actif"}`,
          timestamp: project.updatedAt || project.lastActivityAt || null,
          projectId: project.id || project.name,
          profileScope: request.profileScope,
          locator: { projectId: project.id || null, ...(project.path || project.rootPath ? { path: project.path || project.rootPath } : {}) },
          provenance: { label: `Projet — ${project.name || project.title || project.id}`, status: project.status || "current" },
        }));
    },
  };
}

function createSimpleLocalAdapter({ sourceType, list, id = "id", title = "title", content = "content", timestamp = "updatedAt" }) {
  return {
    version: () => "source-native",
    isAuthorized: () => process.platform === "darwin",
    async search(request) {
      const items = await list();
      return items.filter((item) => matches(request.query, item[title], item[content], item.dueAt))
        .slice(0, request.resultsPerSource).map((item) => ({
          sourceId: item[id], title: item[title] || sourceType,
          snippet: String(item[content] || item.dueAt || item[title] || "").slice(0, 1000),
          timestamp: item[timestamp] || item.dueAt || null,
          profileScope: request.profileScope,
          locator: { [`${sourceType}Id`]: item[id] },
          provenance: { label: `${sourceType} — ${item[title] || item[id]}`, status: "current" },
        }));
    },
  };
}

function createEmailAdapter({ connector, account }) {
  return {
    version: () => connector.connected ? "connected" : "disconnected",
    isAuthorized: () => connector.connected,
    async search(request) {
      const found = await connector.searchGmailMessages(request.query, { maxResults: request.resultsPerSource });
      const messages = await Promise.all((found.messages || []).slice(0, request.resultsPerSource)
        .map(({ id }) => connector.getGmailMessageMetadata(id)));
      return messages.map((message) => ({
        sourceId: message.id,
        title: message.subject || "E-mail",
        snippet: message.snippet || "",
        timestamp: message.date || null,
        profileScope: request.profileScope,
        locator: { account, messageId: message.id, threadId: message.threadId || null },
        provenance: { label: `Gmail — ${message.from || account}`, status: "current" },
      }));
    },
  };
}

function createCalendarAdapter({ connector }) {
  return {
    version: () => connector.connected ? "connected" : "disconnected",
    isAuthorized: () => connector.connected,
    async search(request) {
      const start = request.timeRange?.from ? new Date(request.timeRange.from) : new Date(Date.now() - 90 * 86_400_000);
      const end = request.timeRange?.to ? new Date(request.timeRange.to) : new Date(Date.now() + 30 * 86_400_000);
      const data = await connector.listCalendarEvents({ timeMin: start.toISOString(), timeMax: end.toISOString() });
      return (data.items || []).filter((event) => matches(request.query, event.summary, event.description, event.location,
        ...(event.attendees || []).map((attendee) => attendee.email)))
        .slice(0, request.resultsPerSource).map((event) => ({
          sourceId: event.id,
          title: event.summary || "Événement",
          snippet: event.description || event.location || event.summary || "",
          timestamp: event.start?.dateTime || event.start?.date || null,
          profileScope: request.profileScope,
          locator: { calendarId: "primary", eventId: event.id },
          provenance: { label: `Agenda — ${event.summary || event.id}`, status: event.status || "current" },
        }));
    },
  };
}

module.exports = {
  createCalendarAdapter,
  createConversationAdapter,
  createEmailAdapter,
  createMemoryAdapter,
  createProjectAdapter,
  createSimpleLocalAdapter,
  matches,
};
