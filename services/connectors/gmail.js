"use strict";

const { createConnector, providerFetch } = require("./base-connector");

function createGmailConnector(deps) {
  const base = createConnector({ id: "gmail", credentialId: "google", displayName: "Gmail",
    capabilities: ["search", "threads", "message_content", "drafts"],
    readCapabilities: ["search", "threads", "message_content"], writeCapabilities: ["create_draft"],
    scopes: ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.compose"],
  }, deps);
  const token = async () => deps.getGoogleAccessToken
    ? deps.getGoogleAccessToken()
    : deps.tokenStore.get("google")?.access_token;
  async function searchGmailMessages(query, options = {}) {
    const params = new URLSearchParams({ q: String(query).slice(0, 500), maxResults: String(Math.min(50, options.maxResults || 20)) });
    return base.run(async () => providerFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`, { token: await token() }), { idempotent: true });
  }
  async function getGmailMessage(messageId) {
    return base.run(async () => providerFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=full`, { token: await token() }), { idempotent: true });
  }
  async function getGmailMessageMetadata(messageId) {
    const params = new URLSearchParams({ format: "metadata" });
    for (const header of ["Subject", "From", "Date"]) params.append("metadataHeaders", header);
    const message = await base.run(async () => providerFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?${params}`, { token: await token() }), { idempotent: true });
    const headers = Object.fromEntries((message?.payload?.headers || []).map((entry) => [String(entry.name || "").toLowerCase(), String(entry.value || "")]));
    return { id: message.id, threadId: message.threadId, subject: headers.subject || "(Sans objet)",
      from: headers.from || null, date: headers.date || null, snippet: String(message.snippet || "").slice(0, 500) };
  }
  async function getGmailThread(threadId) {
    return base.run(async () => providerFetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}?format=full`, { token: await token() }), { idempotent: true });
  }
  function classifyGmailMessage(message) {
    const subject = String(message?.subject || "");
    return { important: /urgent|important|échéance|deadline/i.test(subject), awaitingReply: !/^re:/i.test(subject) };
  }
  function prepareEmailReply(input) {
    if (!input?.to || !/^\S+@\S+\.\S+$/.test(input.to)) throw new Error("Destinataire vérifié obligatoire.");
    return { kind: "gmail_draft", to: input.to, subject: String(input.subject || "").slice(0, 300), body: String(input.body || "").slice(0, 20_000), attachments: input.attachments || [] };
  }
  async function createGmailDraft(input) {
    const draft = prepareEmailReply(input);
    const subject = draft.subject.replace(/[\r\n]/g, " ");
    const recipient = draft.to.replace(/[\r\n]/g, "");
    const rawMessage = [`To: ${recipient}`, `Subject: ${subject}`, "Content-Type: text/plain; charset=UTF-8", "", draft.body].join("\r\n");
    const raw = Buffer.from(rawMessage, "utf8").toString("base64url");
    return base.run(async () => providerFetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
      token: await token(), method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: { raw } }),
    }), { idempotent: false, destructive: true, unknownOutcome: true });
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
  return { ...base, searchGmailMessages, getGmailMessage, getGmailMessageMetadata, getGmailThread, summarizeGmailThread: getGmailThread,
    getImportantUnreadMessages: () => searchGmailMessages("is:unread is:important"),
    getMessagesAwaitingReply: () => searchGmailMessages("is:unread -category:promotions -category:social"),
    getRecentMessagesForContact: (contact) => searchGmailMessages(`from:${contact} OR to:${contact}`),
    classifyGmailMessage, prepareEmailReply, createGmailDraft,
    updateGmailDraft: prepareEmailReply, previewGmailSend, sendGmailDraftWithApproval };
}
module.exports = { createGmailConnector };
