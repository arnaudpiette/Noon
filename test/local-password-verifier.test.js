"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createPasswordVerifier, verifyPassword } = require("../services/security/local-password-verifier");

test("le vérificateur accepte uniquement le bon mot de passe sans le conserver", () => {
  const password = "correct horse battery staple";
  const verifier = createPasswordVerifier(password);
  assert.equal(verifyPassword(password, verifier), true);
  assert.equal(verifyPassword("wrong password", verifier), false);
  assert.doesNotMatch(JSON.stringify(verifier), /correct horse battery staple/);
});

test("deux créations utilisent des sels distincts", () => {
  const first = createPasswordVerifier("abcdefgh");
  const second = createPasswordVerifier("abcdefgh");
  assert.notEqual(first.salt, second.salt);
  assert.notEqual(first.hash, second.hash);
});

test("un mot de passe hors limites est refusé", () => {
  assert.throws(() => createPasswordVerifier("short"), { code: "PRIVATE_MEMORY_PASSWORD_INVALID" });
  assert.equal(verifyPassword("short", { version: 1, salt: "bad", hash: "bad" }), false);
});
