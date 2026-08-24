"use strict";

const { createConnector, providerFetch } = require("./base-connector");

function createGmailConnector(deps) {
  const base = createConnector({ id: "gmail", credentialId: "google", displayName: "Gmail",
    capabilities: ["search", "threads", "drafts", "send_with_approval"],
    readCapabilities: ["search", "threads"], writeCapabilities: ["create_draft", "send_email"],
    scopes: ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.compose"],
  }, deps);
  const token = () => deps.tokenStore.get("google")?.access_token;
  async function searchGmailMessages(query, options = {}) {
    const params = new URLSearchParams({ q: String(query).slice(0, 500), maxResults: String(Math.min(50, options.maxResults || 20)) });
    return providerFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`, { token: token() });
  }
  async function getGmailThread(threadId) {
    return providerFetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}?format=metadata`, { token: token() });
  }
  function classifyGmailMessage(message) {
    const subject = String(message?.subject || "");
    return { important: /urgent|important|échéance|deadline/i.test(subject), awaitingReply: !/^re:/i.test(subject) };
  }
  function prepareEmailReply(input) {
    if (!input?.to || !/^\S+@\S+\.\S+$/.test(input.to)) throw new Error("Destinataire vérifié obligatoire.");
    return { kind: "gmail_draft", to: input.to, subject: String(input.subject || "").slice(0, 300), body: String(input.body || "").slice(0, 20_000), attachments: input.attachments || [] };
  }
  function previewGmailSend(draft) {
    return deps.approvals.requestApproval({ provider: "gmail", action: "send_email", target: draft.to, payload: draft,
      preview: draft, consequences: "Enverra cet e-mail au destinataire affiché." });
  }
  async function sendGmailDraftWithApproval(draft, approvalId) {
    deps.approvals.consumeApproval(approvalId, { provider: "gmail", action: "send_email", target: draft.to, payload: draft });
    if (deps.dryRun) return { dryRun: true, sent: false };
    throw new Error("Envoi Gmail réel non activé dans cette version.");
  }
  return { ...base, searchGmailMessages, getGmailThread, summarizeGmailThread: getGmailThread,
    getImportantUnreadMessages: () => searchGmailMessages("is:unread is:important"),
    getMessagesAwaitingReply: () => searchGmailMessages("is:unread -category:promotions -category:social"),
    getRecentMessagesForContact: (contact) => searchGmailMessages(`from:${contact} OR to:${contact}`),
    classifyGmailMessage, prepareEmailReply, createGmailDraft: prepareEmailReply,
    updateGmailDraft: prepareEmailReply, previewGmailSend, sendGmailDraftWithApproval };
}
module.exports = { createGmailConnector };
