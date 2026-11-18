"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {isUsableUpstoxOAuthCallback} = require("../lib/upstox-oauth-callback-input");
const state = "a".repeat(64);

test("accepts a bounded authorization code and 256-bit hex state", () => {
  assert.equal(isUsableUpstoxOAuthCallback("auth-code", state), true);
});
test("rejects missing, oversized, and control-character authorization codes", () => {
  for (const code of ["", null, undefined, "x".repeat(4097), "code\nforged"]) {
    assert.equal(isUsableUpstoxOAuthCallback(code, state), false);
  }
});
test("rejects malformed state values and non-string query parameters", () => {
  for (const value of ["", "a".repeat(63), "g".repeat(64), ["a".repeat(64)], null]) {
    assert.equal(isUsableUpstoxOAuthCallback("auth-code", value), false);
  }
});
