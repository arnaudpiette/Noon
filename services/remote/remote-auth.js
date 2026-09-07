"use strict";

const crypto = require("node:crypto");
const { canonical } = require("../sync/sync-crypto");

function signable(envelope) { const { signature: _signature, ...value } = envelope; return Buffer.from(JSON.stringify(canonical(value))); }
function signRemoteInput(envelope, privateSigningKey) { return crypto.sign(null, signable(envelope), crypto.createPrivateKey(privateSigningKey)).toString("base64"); }
function verifyRemoteInput(envelope, publicSigningKey) {
  try { return crypto.verify(null, signable(envelope), crypto.createPublicKey(publicSigningKey), Buffer.from(String(envelope.signature || ""), "base64")); }
  catch { return false; }
}

module.exports = { signRemoteInput, verifyRemoteInput };
