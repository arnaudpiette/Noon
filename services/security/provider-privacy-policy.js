"use strict";

const DATA_CLASSES = Object.freeze(["PUBLIC", "PERSONAL", "PRIVATE", "HIGHLY_SENSITIVE", "LOCAL_ONLY"]);
const DECISIONS = Object.freeze(["ALLOW", "DENY", "REDACT_REQUIRED", "LOCAL_ONLY"]);
const PROVIDER_POLICIES = Object.freeze({
  openai: Object.freeze({ remote: true, allowedClasses: Object.freeze(["PUBLIC", "PERSONAL", "PRIVATE"]) }),
  anthropic: Object.freeze({ remote: true, allowedClasses: Object.freeze([]) }),
  google_ai: Object.freeze({ remote: true, allowedClasses: Object.freeze(["PUBLIC"]) }),
  local: Object.freeze({ remote: false, allowedClasses: Object.freeze([]) }),
});
const REASON_CODES = Object.freeze({
  ALLOWED: "PROVIDER_EGRESS_ALLOWED",
  PROVIDER_UNKNOWN: "PROVIDER_UNKNOWN",
  PROVIDER_NOT_CONFIGURED: "PROVIDER_NOT_CONFIGURED",
  CLASSIFICATION_UNKNOWN: "DATA_CLASSIFICATION_UNKNOWN",
  PROVIDER_RESTRICTED: "PROVIDER_RESTRICTED",
  LOCAL_ONLY: "LOCAL_ONLY_DATA",
  HIGHLY_SENSITIVE: "HIGHLY_SENSITIVE_DATA",
  SECRET_DETECTED: "SECRET_DETECTED",
  REDACTION_REQUIRED: "DETERMINISTIC_REDACTION_REQUIRED",
  POLICY_REQUIRED: "REMOTE_PROVIDER_POLICY_REQUIRED",
});

class ProviderPrivacyError extends Error {
  constructor(code = REASON_CODES.POLICY_REQUIRED) {
    super("La politique de confidentialité interdit cet appel fournisseur.");
    this.name = "ProviderPrivacyError";
    this.code = code;
  }
}

const SECRET_PATTERNS = Object.freeze([
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\b(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{16,}\b/,
  /\bBearer\s+[A-Za-z0-9._~+\/-]{12,}=*\b/i,
  /\b(?:client_secret|access_token|refresh_token|authorization_code|code_verifier|password|session_secret)\b\s*[:=]\s*[^\s,;]{6,}/i,
  /\bsafe_?storage_?payload\b\s*[:=]\s*[^\s,;]{6,}/i,
  /(?:^|[\\/])(?:\.env(?:\.[^\\/]+)?|credentials?(?:\.json)?|token-store(?:\.json)?)(?:$|[\\/])/i,
]);

function normalizeClassification(value) {
  const normalized = String(value || "").toUpperCase();
  return DATA_CLASSES.includes(normalized) ? normalized : null;
}

function containsSecret(value) {
  if (typeof value !== "string") {
    try { value = JSON.stringify(value ?? ""); } catch { value = ""; }
  }
  return SECRET_PATTERNS.some((pattern) => pattern.test(value));
}

function sanitizeFragment(fragment = {}) {
  const classification = normalizeClassification(fragment.classification);
  return Object.freeze({
    source: String(fragment.source || "unknown").slice(0, 80),
    classification,
    localOnly: fragment.localOnly === true || classification === "LOCAL_ONLY",
    providerRestrictions: Object.freeze([...(fragment.providerRestrictions || [])].map(String).slice(0, 10)),
    secretDetected: fragment.secretDetected === true || containsSecret(fragment.content),
    redactionRequired: fragment.redactionRequired === true,
  });
}

function createProviderPrivacyPolicy({ providerRegistry = {}, providerTiers = {}, observability = null } = {}) {
  const permissions = new WeakMap();

  function inspectContextFragment(fragment) { return sanitizeFragment(fragment); }

  function evaluateProviderAccess({ provider, contextMetadata = {}, requestPolicy = {} } = {}) {
    const providerId = String(provider || "");
    const providerDefinition = providerRegistry[providerId];
    const providerPolicy = PROVIDER_POLICIES[providerId];
    const providerTier = String(requestPolicy.providerTier || providerTiers[providerId] || "UNKNOWN").toUpperCase();
    const fragments = Array.isArray(contextMetadata.fragments) ? contextMetadata.fragments.map(sanitizeFragment) : [];
    const classificationCounts = Object.fromEntries(DATA_CLASSES.map((classification) => [classification, 0]));
    for (const fragment of fragments) if (fragment.classification) classificationCounts[fragment.classification] += 1;
    const reasons = [];
    let decision = "ALLOW";
    if (!providerDefinition || !providerPolicy) reasons.push(REASON_CODES.PROVIDER_UNKNOWN);
    else if (providerDefinition.status !== "ENABLED") reasons.push(REASON_CODES.PROVIDER_NOT_CONFIGURED);
    else if (!providerPolicy.allowedClasses.length) reasons.push(REASON_CODES.PROVIDER_RESTRICTED);
    if (providerId === "google_ai" && requestPolicy.providerConfigured !== true) reasons.push(REASON_CODES.PROVIDER_NOT_CONFIGURED);
    if (providerId === "google_ai" && !["FREE", "PAID"].includes(providerTier)) reasons.push(REASON_CODES.PROVIDER_RESTRICTED);
    if (fragments.length === 0) reasons.push(REASON_CODES.CLASSIFICATION_UNKNOWN);
    if (requestPolicy.localOnly === true || fragments.some((item) => item.localOnly)) reasons.push(REASON_CODES.LOCAL_ONLY);
    if (fragments.some((item) => !item.classification)) reasons.push(REASON_CODES.CLASSIFICATION_UNKNOWN);
    const effectiveAllowedClasses = providerId === "google_ai" && providerTier === "PAID"
      ? ["PUBLIC", "PERSONAL", ...(requestPolicy.allowPrivate === true ? ["PRIVATE"] : [])]
      : providerPolicy?.allowedClasses || [];
    if (providerPolicy && fragments.some((item) => item.classification && !effectiveAllowedClasses.includes(item.classification))) {
      reasons.push(REASON_CODES.PROVIDER_RESTRICTED);
    }
    if (fragments.some((item) => item.classification === "HIGHLY_SENSITIVE")) reasons.push(REASON_CODES.HIGHLY_SENSITIVE);
    if (requestPolicy.secretDetected === true || fragments.some((item) => item.secretDetected)) reasons.push(REASON_CODES.SECRET_DETECTED);
    if (fragments.some((item) => item.providerRestrictions.length && !item.providerRestrictions.includes(providerId))) reasons.push(REASON_CODES.PROVIDER_RESTRICTED);
    if (reasons.includes(REASON_CODES.LOCAL_ONLY)) decision = "LOCAL_ONLY";
    else if (reasons.length) decision = "DENY";
    else if (fragments.some((item) => item.redactionRequired)) {
      decision = "REDACT_REQUIRED";
      reasons.push(REASON_CODES.REDACTION_REQUIRED);
    } else reasons.push(REASON_CODES.ALLOWED);
    const diagnostic = Object.freeze({
      provider: providerId || "unknown", decision,
      reasonCodes: Object.freeze([...new Set(reasons)]),
      classificationCounts: Object.freeze(classificationCounts),
      sources: Object.freeze([...new Set(fragments.map((item) => item.source))]),
      allowedSources: Object.freeze(decision === "ALLOW" ? [...new Set(fragments.map((item) => item.source))] : []),
      blockedSources: Object.freeze(decision === "ALLOW" ? [] : [...new Set(fragments.map((item) => item.source))]),
    });
    observability?.("provider_privacy.evaluated", {
      provider: diagnostic.provider,
      decision: diagnostic.decision,
      classificationCounts: diagnostic.classificationCounts,
      reasonCodes: diagnostic.reasonCodes,
    });
    if (decision !== "ALLOW") return Object.freeze({ ...diagnostic, permissionToken: null });
    const permissionToken = Object.freeze({});
    permissions.set(permissionToken, providerId);
    return Object.freeze({ ...diagnostic, permissionToken });
  }

  function assertAccess(permissionToken, provider) {
    if (!permissionToken || permissions.get(permissionToken) !== String(provider || "")) throw new ProviderPrivacyError();
    return true;
  }

  return Object.freeze({ inspectContextFragment, evaluateProviderAccess, assertAccess, containsSecret });
}

module.exports = { DATA_CLASSES, DECISIONS, PROVIDER_POLICIES, REASON_CODES, ProviderPrivacyError, containsSecret, createProviderPrivacyPolicy };
