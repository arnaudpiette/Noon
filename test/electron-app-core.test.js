"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isSafeExternalUrl,
  isValidAccelerator,
  parseNoonDeepLink,
} = require("../electron/app-core");

test("accepte uniquement les deep links Noon explicitement autorisés", () => {
  assert.deepEqual(parseNoonDeepLink("noon://open"), { action: "open" });
  assert.deepEqual(parseNoonDeepLink("noon://mode?value=dev"), { action: "mode", value: "DEV" });
  assert.deepEqual(parseNoonDeepLink("noon://focus?id=kasa"), { action: "focus", id: "kasa" });
  assert.equal(parseNoonDeepLink("noon://focus?id=../../secret"), null);
  assert.equal(parseNoonDeepLink("noon://shell?command=rm"), null);
  assert.equal(parseNoonDeepLink("https://example.com"), null);
});

test("refuse les navigations externes qui ne sont pas HTTPS", () => {
  assert.equal(isSafeExternalUrl("https://openai.com/docs"), true);
  assert.equal(isSafeExternalUrl("http://openai.com"), false);
  assert.equal(isSafeExternalUrl("javascript:alert(1)"), false);
  assert.equal(isSafeExternalUrl("file:///tmp/test"), false);
});

test("valide les raccourcis configurables", () => {
  assert.equal(isValidAccelerator("Control+Option+N"), true);
  assert.equal(isValidAccelerator("N"), false);
  assert.equal(isValidAccelerator(""), false);
});
