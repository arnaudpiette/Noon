"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createPersonalDatabase } = require("../services/persistence/database");
const { createSyncRepository } = require("../services/sync/sync-repository");
const { createSyncPolicy } = require("../services/sync/sync-policy");
const { createDeviceIdentity, canonical } = require("../services/sync/sync-crypto");
const { createDeviceRegistry } = require("../services/sync/device-registry");
const { SYNC_PROTOCOL_VERSION } = require("../services/sync/sync-schema");
const { createRemoteRepository } = require("../services/remote/remote-repository");
const { createRemotePresenceService } = require("../services/remote/remote-presence-service");
const { createMockRemoteTransport, createRemoteTransportRouter } = require("../services/remote/remote-transport-router");
const { createRemoteStreamService } = require("../services/remote/remote-stream-service");
const { createHandoffService } = require("../services/remote/handoff-service");
const { createRemoteResponsePolicy } = require("../services/remote/remote-response-policy");
const { createRemoteInteractionEngine } = require("../services/remote/remote-interaction-engine");
const { createRemoteMediaService } = require("../services/remote/remote-media-service");
const { createRemoteApprovalService } = require("../services/remote/remote-approval-service");
const { REMOTE_PROTOCOL_VERSION } = require("../services/remote/remote-schema");
const { signRemoteInput } = require("../services/remote/remote-auth");

const ALL_SCOPES = ["CONVERSATIONS", "REMOTE_TEXT", "REMOTE_JOBS", "REMOTE_MEDIA", "REMOTE_APPROVALS", "REMOTE_VOICE"];
function fixture({ now = () => Date.now(), mode = "ON" } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noon-remote-")); const database = createPersonalDatabase(path.join(root, "remote.sqlite"));
  const syncRepository = createSyncRepository(database); const remoteRepository = createRemoteRepository(database, { now }); const mobile = createDeviceIdentity({ deviceId: "iphone", deviceType: "IPHONE", displayName: "iPhone test" });
  syncRepository.saveDevice({ ...mobile, protocolVersion: SYNC_PROTOCOL_VERSION, status: "ACTIVE", capabilities: ["TEXT", "VOICE", "IMAGE_UPLOAD", "APPROVAL_UI", "JOB_STATUS"], syncScopes: ALL_SCOPES, createdAt: new Date(now()).toISOString() });
  const deviceRegistry = createDeviceRegistry({ repository: syncRepository, now }); const presence = createRemotePresenceService({ now, presenceTtlMs: 1000 }); presence.open({ deviceSessionId: "device-session-1", deviceId: "iphone", channelCapabilities: ["TEXT", "VOICE"] });
  const lan = createMockRemoteTransport("LOCAL_NETWORK"); const relay = createMockRemoteTransport("SECURE_RELAY"); const mailbox = createMockRemoteTransport("SYNC_MAILBOX"); const router = createRemoteTransportRouter({ transports: { LOCAL_NETWORK: lan, SECURE_RELAY: relay, SYNC_MAILBOX: mailbox } });
  const persisted = []; const stream = createRemoteStreamService({ repository: remoteRepository, transportRouter: router, conversationStore: { appendAssistant(message) { persisted.push(message); return { messageId: message.messageId }; } }, now });
  const sessions = new Map(); const sessionContinuityEngine = { resolveSession({ conversationId, workspaceId, channel }) { const value = sessions.get(conversationId) || { id: `logical-${conversationId}`, conversationId, workspaceId, channel }; sessions.set(conversationId, value); return value; }, contextForRequest(id) { return { sessionId: id }; } };
  const intents = []; const intentCommandEngine = { async parse(channel, input, context) { const intent = { intentId: `intent-${intents.length + 1}`, type: /^continue/i.test(input.text || input.transcript || "") ? "CONTINUE" : "ASK", action: "answer", sourceChannel: channel, origin: "EXPLICIT_USER_REMOTE_DEVICE", deviceId: input.metadata.deviceId, context }; intents.push(intent); return intent; } };
  const handoff = createHandoffService({ repository: remoteRepository, sessionContinuityEngine, now }); let executions = 0;
  const engine = createRemoteInteractionEngine({ repository: remoteRepository, deviceRegistry, presenceService: presence, handoffService: handoff, streamService: stream, responsePolicy: createRemoteResponsePolicy({ syncPolicy: createSyncPolicy() }), intentCommandEngine, sessionContinuityEngine, mode, now, async handleIntent({ intent, onDelta }) { executions += 1; onDelta?.("Bon"); onDelta?.("jour"); return { answer: "Bonjour", messageId: `assistant-${intent.intentId}`, classification: "NORMAL" }; } });
  function input(overrides = {}) { const value = { remoteInputId: `input-${crypto.randomUUID()}`, deviceId: "iphone", deviceSessionId: "device-session-1", channel: "TEXT", conversationId: "conversation-1", workspaceId: "workspace-1", payload: { text: "Bonjour" }, timestamp: new Date(now()).toISOString(), expiresAt: new Date(now() + 60_000).toISOString(), sequence: 1, requestId: `request-${crypto.randomUUID()}`, nonce: crypto.randomBytes(16).toString("hex"), protocolVersion: REMOTE_PROTOCOL_VERSION, ...overrides }; value.signature = signRemoteInput(value, mobile.privateSigningKey); return value; }
  return { root, database, syncRepository, remoteRepository, mobile, deviceRegistry, presence, lan, relay, mailbox, router, stream, handoff, engine, intents, persisted, input, executions: () => executions, close() { database.close(); fs.rmSync(root, { recursive: true, force: true }); } };
}

test("un appareil non appairé, révoqué ou une mauvaise signature sont rejetés", async () => {
  const f = fixture(); const unknown = createDeviceIdentity({ deviceId: "unknown", deviceType: "IPHONE" }); const bad = f.input({ deviceId: "unknown" }); bad.signature = signRemoteInput(bad, unknown.privateSigningKey);
  await assert.rejects(f.engine.receive(bad), { code: "DEVICE_NOT_ACTIVE" }); const tampered = f.input(); tampered.payload.text = "texte altéré"; await assert.rejects(f.engine.receive(tampered), { code: "REMOTE_SIGNATURE_INVALID" }); f.deviceRegistry.revoke("iphone"); await assert.rejects(f.engine.receive(f.input()), { code: "DEVICE_NOT_ACTIVE" }); assert.equal(f.executions(), 0); f.close();
});

test("texte distant suit Intent puis handler, persiste le final et reprend le stream", async () => {
  const f = fixture(); const value = f.input(); const result = await f.engine.receive(value);
  assert.equal(result.intent.origin, "EXPLICIT_USER_REMOTE_DEVICE"); assert.equal(f.executions(), 1); assert.equal(f.persisted.length, 1); const outputs = f.engine.resume(value.requestId, 1);
  assert.deepEqual(outputs.map((item) => item.type), ["TEXT_DELTA", "TEXT_FINAL"]); assert.equal(outputs.at(-1).payloadRef.messageId, "assistant-intent-1"); f.close();
});

test("retry et reconnexion gardent une seule requête logique", async () => {
  const f = fixture(); const value = f.input(); await f.engine.receive(value); const duplicate = await f.engine.receive(value);
  assert.equal(duplicate.deduplicated, true); assert.equal(f.executions(), 1); assert.equal(f.remoteRepository.stats().remoteRequests, 1); f.close();
});

test("bascule LAN vers relay sans changer requestId ni dupliquer", async () => {
  const f = fixture(); const value = f.input(); await f.engine.receive(value); f.lan.setAvailable(false); const route = f.router.select({ deviceSessionId: value.deviceSessionId, channel: "TEXT" });
  assert.equal(route.name, "SECURE_RELAY"); const duplicate = await f.engine.receive(value); assert.equal(duplicate.deduplicated, true); assert.equal(f.executions(), 1); f.close();
});

test("handoff par références conserve la conversation et un Continue ambigu demande clarification", async () => {
  const f = fixture(); f.handoff.createHandoff({ conversationId: "conversation-handoff", sessionId: "logical-handoff", sourceDeviceId: "mac", targetDeviceId: "iphone", workspaceId: "w", recentMessageRef: { id: "m1" } });
  const value = f.input({ conversationId: null, payload: { text: "Continue" } }); const result = await f.engine.receive(value); assert.equal(result.result ? true : false, true); assert.equal(f.persisted[0].conversationId, "conversation-handoff");
  f.handoff.createHandoff({ conversationId: "conversation-other", sessionId: "logical-other", sourceDeviceId: "mac", targetDeviceId: "iphone" }); f.handoff.createHandoff({ conversationId: "conversation-third", sessionId: "logical-third", sourceDeviceId: "ipad", targetDeviceId: "iphone" });
  const ambiguous = await f.engine.receive(f.input({ conversationId: null, payload: { text: "Continue" } })); assert.equal(ambiguous.clarificationRequired, true); f.close();
});

test("présence devient STALE sans devenir une autorisation", () => {
  let time = Date.now(); const f = fixture({ now: () => time }); assert.equal(f.presence.get("device-session-1").presenceState, "ACTIVE"); time += 1001; assert.equal(f.presence.get("device-session-1").presenceState, "STALE"); assert.equal(f.deviceRegistry.get("iphone").status, "ACTIVE"); f.close();
});

test("la politique bloque local_only, dérivé local_only et profils protégés", () => {
  const f = fixture(); const policy = createRemoteResponsePolicy({ syncPolicy: createSyncPolicy() }); const device = f.deviceRegistry.get("iphone");
  assert.equal(policy.evaluate({ classification: "LOCAL_ONLY", device }).allowed, false); assert.equal(policy.evaluate({ classification: "NORMAL", device, sourceRefs: [{ classification: "LOCAL_ONLY_DERIVED" }] }).allowed, false); assert.equal(policy.evaluate({ classification: "NORMAL", profileScope: "sinan", device }).allowed, false); f.close();
});

test("média explicitement partagé est hashé avant analyse et aucun scan implicite n'est permis", async () => {
  const f = fixture(); let analyses = 0; const media = createRemoteMediaService({ repository: f.remoteRepository, tempStore: { async write({ transferId }) { return { assetId: transferId }; } }, multimodalEngine: { async analyzeRemote() { analyses += 1; return { evidencePackId: "pack" }; } } }); const bytes = Buffer.from("image fictive"); const hash = crypto.createHash("sha256").update(bytes).digest("hex");
  await assert.rejects(media.receive({ transferId: "m0", requestId: "r", deviceId: "iphone", mediaType: "IMAGE", expectedHash: hash, bytes }), { code: "REMOTE_MEDIA_EXPLICIT_SELECTION_REQUIRED" });
  await assert.rejects(media.receive({ transferId: "m1", requestId: "r", deviceId: "iphone", mediaType: "IMAGE", expectedHash: "bad", bytes, explicitSelection: true }), { code: "REMOTE_MEDIA_HASH_MISMATCH" }); assert.equal(analyses, 0);
  const result = await media.receive({ transferId: "m2", requestId: "r", deviceId: "iphone", mediaType: "IMAGE", expectedHash: hash, bytes, explicitSelection: true }); assert.equal(result.state, "READY"); assert.equal(analyses, 1); f.close();
});

test("approval mobile vérifie scope, signature, empreinte, expiration et replay", () => {
  let time = Date.now(); const f = fixture({ now: () => time }); let approvals = 0; const record = { id: "approval-1", fingerprint: "fp-1", expiresAt: new Date(time + 5000).toISOString() };
  const approvalEngine = { get: () => record, approve() { approvals += 1; return { status: "approved" }; }, reject() { return { status: "rejected" }; } }; const service = createRemoteApprovalService({ repository: f.remoteRepository, deviceRegistry: f.deviceRegistry, approvalEngine, now: () => time });
  const response = { approvalId: "approval-1", decision: "APPROVE", deviceId: "iphone", respondedAt: new Date(time).toISOString(), nonce: "approval-nonce", fingerprint: "fp-1" }; response.signature = crypto.sign(null, Buffer.from(JSON.stringify(canonical(response))), crypto.createPrivateKey(f.mobile.privateSigningKey)).toString("base64");
  assert.equal(service.verify(response).status, "approved"); assert.equal(approvals, 1); assert.throws(() => service.verify(response), { code: "REMOTE_APPROVAL_REPLAY" }); f.close();
});

test("approval expirée ou appareil sans scope ne peut rien valider", () => {
  let time = Date.now(); const f = fixture({ now: () => time }); let effects = 0; const approval = { id: "approval-expired", fingerprint: "fp-expired", expiresAt: new Date(time - 1).toISOString() };
  const service = createRemoteApprovalService({ repository: f.remoteRepository, deviceRegistry: f.deviceRegistry, approvalEngine: { get: () => approval, approve() { effects += 1; } }, now: () => time });
  const response = { approvalId: approval.id, decision: "APPROVE", deviceId: "iphone", respondedAt: new Date(time).toISOString(), nonce: "expired-nonce", fingerprint: approval.fingerprint }; response.signature = crypto.sign(null, Buffer.from(JSON.stringify(canonical(response))), crypto.createPrivateKey(f.mobile.privateSigningKey)).toString("base64");
  assert.throws(() => service.verify(response), { code: "APPROVAL_EXPIRED" }); assert.equal(effects, 0);
  const device = f.deviceRegistry.get("iphone"); f.syncRepository.saveDevice({ ...device, syncScopes: device.syncScopes.filter((scope) => scope !== "REMOTE_APPROVALS") }); assert.throws(() => service.verify({ ...response, nonce: "other" }), { code: "DEVICE_SCOPE_MISSING" }); f.close();
});

test("voix push-to-talk réutilise la session logique et l'origine distante", async () => {
  const f = fixture(); const result = await f.engine.receive(f.input({ channel: "VOICE", payload: { transcript: "Où en est le job ?" } }));
  assert.equal(result.intent.sourceChannel, "voice"); assert.equal(result.intent.origin, "EXPLICIT_USER_REMOTE_DEVICE"); assert.equal(f.executions(), 1); f.close();
});

test("protocole incompatible et absence de transport échouent sans dupliquer l'intention", async () => {
  const f = fixture(); const incompatible = f.input({ protocolVersion: 999 }); await assert.rejects(f.engine.receive(incompatible), { code: "REMOTE_PROTOCOL_INCOMPATIBLE" });
  f.lan.setAvailable(false); f.relay.setAvailable(false); f.mailbox.setAvailable(false); const route = f.router.select({ deviceSessionId: "device-session-1", channel: "TEXT" }); assert.equal(route.status, "OFFLINE"); assert.equal(f.executions(), 0); f.close();
});

test("job status et annulation passent par BackgroundJobEngine, pas par le transport", async () => {
  const f = fixture(); let cancellations = 0; const jobs = { get: (id) => ({ id, state: "RUNNING" }), cancel: (id) => { cancellations += 1; return { id, state: "CANCEL_REQUESTED" }; } };
  const engine = createRemoteInteractionEngine({ repository: f.remoteRepository, deviceRegistry: f.deviceRegistry, presenceService: f.presence, handoffService: f.handoff, streamService: f.stream, responsePolicy: createRemoteResponsePolicy({ syncPolicy: createSyncPolicy() }), intentCommandEngine: { parse: async () => ({}) }, sessionContinuityEngine: { resolveSession: () => ({}), contextForRequest: () => ({}) }, handleIntent: async () => ({}), backgroundJobEngine: jobs, mode: "ON" });
  const status = await engine.receive(f.input({ channel: "JOB_CONTROL", payload: { action: "STATUS", jobId: "job-1" } })); assert.equal(status.output.output.payloadRef.state, "RUNNING"); await engine.receive(f.input({ channel: "JOB_CONTROL", payload: { action: "CANCEL", jobId: "job-1" } })); assert.equal(cancellations, 1); f.close();
});

test("mode SHADOW normalise sans appeler la logique métier", async () => {
  const f = fixture({ mode: "SHADOW" }); const result = await f.engine.receive(f.input()); assert.equal(result.shadow, true); assert.equal(result.executed, false); assert.equal(f.executions(), 0); f.close();
});
