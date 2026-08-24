"use strict";

const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]{12,}/g,
  /(?:ghp|github_pat)_[A-Za-z0-9_]{12,}/g,
  /Bearer\s+[A-Za-z0-9._~+/-]+=*/gi,
  /(?:access|refresh|api)[_-]?token["'=:\s]+[^\s,"']+/gi,
  /mongodb(?:\+srv)?:\/\/[^\s]+/gi,
];

function redactSecrets(value) {
  let text = String(value ?? "");
  for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, "[SECRET_REDACTED]");
  return text.slice(0, 10_000);
}

function sanitizeAuditDetails(details = {}) {
  return JSON.parse(redactSecrets(JSON.stringify(details)));
}

module.exports = { redactSecrets, sanitizeAuditDetails };
