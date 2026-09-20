"use strict";

const COMMAND_CLASSES = Object.freeze(["SAFE_READ", "WORKSPACE_WRITE", "PACKAGE_INSTALL", "GIT_LOCAL", "REMOTE", "SYSTEM", "DESTRUCTIVE"]);
const SAFE_VALIDATIONS = Object.freeze({
  "npm test": ["npm", ["test"]],
  "npm run lint": ["npm", ["run", "lint"]],
  "npm run typecheck": ["npm", ["run", "typecheck"]],
  "npm run build": ["npm", ["run", "build"]],
  "git diff --check": ["git", ["diff", "--check"]],
});

function safeRelativeArgs(values) {
  return values.length > 0 && values.every((value) =>
    value && !value.startsWith("-") && !value.startsWith("/") && !value.includes("..") && /^[A-Za-z0-9_./-]+$/.test(value)
  );
}

function classifyDevCommand(command) {
  const value = String(command || "").trim();
  if (/^(?:sudo\b|su\b)|(?:^|\s)(?:rm\s+-[^\s]*r|git\s+(?:reset\s+--hard|clean\b|push\b|branch\s+-D|rebase\b|checkout\s+--|restore\b)|npm\s+(?:install|i|add|ci)\b|pnpm\s+(?:add|install)\b|yarn\s+(?:add|install)\b)/i.test(value)) {
    if (/git\s+push|https?:\/\//i.test(value)) return { classification: "REMOTE", allowed: false, reasonCode: "GIT_REMOTE_DENIED" };
    if (/install|\s+i\s|\s+add\s/i.test(value)) return { classification: "PACKAGE_INSTALL", allowed: false, reasonCode: "PACKAGE_INSTALL_APPROVAL_REQUIRED" };
    return { classification: /sudo|\bsu\b/.test(value) ? "SYSTEM" : "DESTRUCTIVE", allowed: false, reasonCode: "COMMAND_DENIED" };
  }
  if (SAFE_VALIDATIONS[value]) return { classification: value.startsWith("git") ? "SAFE_READ" : "SAFE_READ", allowed: true, reasonCode: "AUTHORIZED_VALIDATION", execution: SAFE_VALIDATIONS[value] };
  const nodeTest = value.match(/^node --test (.+)$/);
  if (nodeTest) {
    const files = nodeTest[1].trim().split(/\s+/);
    if (safeRelativeArgs(files)) return { classification: "SAFE_READ", allowed: true, reasonCode: "AUTHORIZED_TARGETED_VALIDATION", execution: ["node", ["--test", ...files]] };
  }
  const npmTest = value.match(/^npm test -- (.+)$/);
  if (npmTest) {
    const files = npmTest[1].trim().split(/\s+/);
    if (safeRelativeArgs(files)) return { classification: "SAFE_READ", allowed: true, reasonCode: "AUTHORIZED_TARGETED_VALIDATION", execution: ["npm", ["test", "--", ...files]] };
  }
  return { classification: "SYSTEM", allowed: false, reasonCode: "COMMAND_NOT_ALLOWLISTED" };
}

module.exports = { COMMAND_CLASSES, SAFE_VALIDATIONS, classifyDevCommand, safeRelativeArgs };
