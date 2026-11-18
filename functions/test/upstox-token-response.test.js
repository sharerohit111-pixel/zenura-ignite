"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {isUsableUpstoxTokenResponse} = require("../lib/upstox-token-response");

test("accepts a non-empty access token", () => {
  assert.equal(isUsableUpstoxTokenResponse({access_token:"opaque-token"}), true);
});
test("rejects missing, empty, and malformed token responses", () => {
  for (const value of [null, undefined, [], {}, {access_token:""}, {access_token:42}, {access_token:"x".repeat(16385)}]) {
    assert.equal(isUsableUpstoxTokenResponse(value), false);
  }
});
test("does not require optional provider fields", () => {
  assert.equal(isUsableUpstoxTokenResponse({access_token:"opaque-token",token_type:"Bearer"}), true);
});
