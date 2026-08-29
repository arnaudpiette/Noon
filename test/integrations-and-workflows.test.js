"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { ApprovalManager } = require("../services/approvals/approval-manager");
const { createTokenStore } = require("../services/security/token-store");
const { redactSecrets } = require("../services/security/redaction");
const { parseFigmaUrl } = require("../services/connectors/figma");
const { runGitReadOnly, FORBIDDEN_GIT_ACTIONS } = require("../services/connectors/github");
const { runNoonReminderShortcut, SHORTCUT_NAME } = require("../services/connectors/apple-reminders");
const { createAutomationRegistry } = require("../services/automations/scheduler");
const { createGmailConnector } = require("../services/connectors/gmail");
const { buildCreativeAxes } = require("../services/workflows/da-workflow");
const { buildDiagnosticPlan, validateProposedDiff } = require("../services/workflows/dev-workflow");
const { nextVersionedPath } = require("../services/production/versioning");

test("une autorisation expire, ne se rejoue pas et est liée au contenu exact", () => {
  let now = 1_000;
  const manager = new ApprovalManager({ ttlMs: 100, now: () => now });
  const input = { provider: "gmail", action: "send_email", target: "a@example.com", payload: { body: "Bonjour" } };
  const approval = manager.requestApproval(input);
  manager.confirm(approval.id);
  assert.throws(() => manager.consumeApproval(approval.id, { ...input, target: "b@example.com" }), /changé/);
  assert.equal(manager.consumeApproval(approval.id, input), true);
  assert.throws(() => manager.consumeApproval(approval.id, input), /invalide/);
  const expired = manager.requestApproval(input); now += 101;
  assert.throws(() => manager.confirm(expired.id), /expirée/);
});

test("commit et push exigent deux autorisations distinctes et le force push est bloqué", () => {
  const manager = new ApprovalManager();
  const commit = manager.requestApproval({ provider: "github", action: "commit", target: "repo", payload: { diff: "a" } });
  const push = manager.requestApproval({ provider: "github", action: "push", target: "repo", payload: { commit: "abc" } });
  assert.notEqual(commit.payloadHash, push.payloadHash);
  assert.equal(FORBIDDEN_GIT_ACTIONS.has("push_force"), true);
  assert.throws(() => manager.requestApproval({ provider: "github", action: "git_push_force", target: "repo", payload: {} }), /bloquée/);
});

test("le coffre reste en mémoire si le chiffrement système est indisponible", () => {
  const store = createTokenStore({ filePath: path.join(os.tmpdir(), "unused-token.json") });
  assert.equal(store.set("google", { access_token: "secret" }).persistent, false);
  assert.equal(store.get("google").access_token, "secret");
  assert.equal(store.persistent, false);
});

test("Gmail autorise uniquement la lecture et la création de brouillons", () => {
  const tokenStore = createTokenStore({ filePath: path.join(os.tmpdir(), "unused-gmail-token.json") });
  const gmail = createGmailConnector({ tokenStore });
  assert.deepEqual(gmail.scopes, ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.compose"]);
  assert.deepEqual(gmail.writeCapabilities, ["create_draft"]);
  assert.ok(gmail.readCapabilities.includes("message_content"));
  assert.equal(gmail.writeCapabilities.includes("send"), false);
});

test("les secrets sont masqués sans être recopiés", () => {
  const output = redactSecrets("OPENAI api_token=abcde12345 et sk-abcdefghijklmno");
  assert.doesNotMatch(output, /sk-abcdefgh/);
  assert.doesNotMatch(output, /abcde12345/);
});

test("Figma accepte uniquement ses URL HTTPS et extrait le node", () => {
  assert.deepEqual(parseFigmaUrl("https://www.figma.com/design/ABC_123/Test?node-id=1-2"), { fileKey: "ABC_123", nodeId: "1-2" });
  assert.equal(parseFigmaUrl("http://figma.com/file/ABC/Test"), null);
  assert.equal(parseFigmaUrl("https://evil.test/file/ABC"), null);
});

test("GitHub local n’exécute qu’une commande de lecture prédéfinie", async () => {
  const calls = [];
  const runner = (command, args, options, callback) => { calls.push([command, args]); callback(null, "main"); };
  assert.equal(await runGitReadOnly("/tmp", "branch", runner), "main");
  assert.deepEqual(calls[0], ["git", ["branch", "--show-current"]]);
  await assert.rejects(runGitReadOnly("/tmp", "push", runner), /non autorisée/);
});

test("le raccourci Apple transmet l’entrée comme donnée stdin", async () => {
  let observed;
  const runner = (command, args, options, callback) => {
    const child = { stdin: { end(value) { observed = { command, args, value }; callback(null, "ok"); } } };
    return child;
  };
  await runNoonReminderShortcut("Rappelle-moi Kasa demain", runner);
  assert.deepEqual(observed.args, ["run", SHORTCUT_NAME]);
  assert.equal(observed.value, "Rappelle-moi Kasa demain");
});

test("le brief de 7 h reste unique et intègre le lundi", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noon-auto-"));
  const registry = createAutomationRegistry(path.join(directory, "automations.json"));
  registry.ensureDefaults(); registry.ensureDefaults();
  const routines = registry.load().routines;
  assert.equal(routines.filter((item) => item.dedupeKey === "daily-brief-0700").length, 1);
  assert.equal(routines[0].includesMondayVision, true);
  assert.equal(routines.some((item) => /vendredi/i.test(item.name)), false);
});

test("DA produit trois axes distincts et DEV diagnostique avant le diff", () => {
  const axes = buildCreativeAxes({ objective: "Lancer", target: "Étudiants" });
  assert.equal(new Set(axes.map((axis) => axis.idea)).size, 3);
  assert.equal(buildDiagnosticPlan({ id: "kasa" }).steps[0], "Reproduire");
  assert.throws(() => validateProposedDiff({ files: [] }), /Diff exact/);
});

test("la production crée des noms versionnés sans écraser", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noon-prod-"));
  const first = nextVersionedPath(directory, "Kasa", "Rapport", "pdf", new Date("2026-08-23"));
  fs.writeFileSync(first, "test");
  const second = nextVersionedPath(directory, "Kasa", "Rapport", "pdf", new Date("2026-08-23"));
  assert.match(first, /_v001_/); assert.match(second, /_v002_/);
});
