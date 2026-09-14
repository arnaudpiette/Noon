"use strict";

const crypto = require("node:crypto");

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

function validatePassword(password) {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    const error = new Error("Le mot de passe Noon doit contenir entre 8 et 128 caractères.");
    error.code = "PRIVATE_MEMORY_PASSWORD_INVALID";
    throw error;
  }
  return password;
}

function createPasswordVerifier(password, salt = crypto.randomBytes(16)) {
  validatePassword(password);
  const normalizedSalt = Buffer.from(salt);
  const hash = crypto.scryptSync(password, normalizedSalt, 64);
  return { version: 1, salt: normalizedSalt.toString("base64"), hash: hash.toString("base64") };
}

function verifyPassword(password, verifier) {
  if (typeof password !== "string" || !verifier?.salt || !verifier?.hash) return false;
  try {
    const expected = Buffer.from(verifier.hash, "base64");
    const actual = crypto.scryptSync(password, Buffer.from(verifier.salt, "base64"), expected.length);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

module.exports = { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, createPasswordVerifier, validatePassword, verifyPassword };
