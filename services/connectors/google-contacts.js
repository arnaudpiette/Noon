"use strict";

const { createConnector, providerFetch } = require("./base-connector");
function createContactsConnector(deps) {
  const base = createConnector({ id: "google-contacts", credentialId: "google", displayName: "Google Contacts",
    capabilities: ["search", "resolve_recipient"], readCapabilities: ["contacts"], writeCapabilities: [],
    scopes: ["https://www.googleapis.com/auth/contacts.readonly"] }, deps);
  const token = () => deps.tokenStore.get("google")?.access_token;
  async function searchContacts(query) {
    const params = new URLSearchParams({ query: String(query).slice(0, 150), readMask: "names,emailAddresses", pageSize: "20" });
    return providerFetch(`https://people.googleapis.com/v1/people:searchContacts?${params}`, { token: token() });
  }
  function resolveRecipient(results) {
    const candidates = (results?.results || []).flatMap((item) =>
      (item.person?.emailAddresses || []).map((email) => ({ name: item.person?.names?.[0]?.displayName || "", email: email.value })));
    if (candidates.length !== 1) return { status: candidates.length ? "ambiguous" : "not_found", candidates };
    return { status: "resolved", recipient: candidates[0] };
  }
  return { ...base, searchContacts, resolveRecipient };
}
module.exports = { createContactsConnector };
