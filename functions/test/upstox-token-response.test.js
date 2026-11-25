"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {isUsableUpstoxTokenResponse} = require("../lib/upstox-token-response");

test("accepts a non-empty access token and valid optional token type", () => {
  assert.equal(isUsableUpstoxTokenResponse({access_token:"opaque-token"}), true);
  assert.equal(isUsableUpstoxTokenResponse({access_token:"opaque-token",token_type:"Bearer"}), true);
});
test("rejects missing, empty, malformed, oversized, or control-character token values", () => {
  for (const value of [null, undefined, [], {}, {access_token:""}, {access_token:42},
    {access_token:"x".repeat(16385)}, {access_token:"bad\ntoken"}]) {
    assert.equal(isUsableUpstoxTokenResponse(value), false);
  }
});
test("rejects malformed optional token type without requiring it", () => {
  for (const token_type of ["", 42, "x".repeat(65), "Bearer\nInjected", "bad type"]) {
    assert.equal(isUsableUpstoxTokenResponse({access_token:"opaque-token",token_type}), false);
  }
});
