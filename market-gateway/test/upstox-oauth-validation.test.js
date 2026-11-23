"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {isUsableUpstoxOAuthCallback} = require("../../functions/lib/upstox-oauth-callback-input");
const {isUsableUpstoxTokenResponse} = require("../../functions/lib/upstox-token-response");

test("accepts an opaque authorization code with a cryptographically sized hex state", () => {
  assert.equal(isUsableUpstoxOAuthCallback("opaque-provider-code", "a".repeat(64)), true);
});

test("rejects missing, oversized, control-character, and malformed callback parameters", () => {
  const state = "a".repeat(64);
  for (const code of [undefined, "", "x".repeat(4097), "bad\ncode", "bad\u0000code"]) {
    assert.equal(isUsableUpstoxOAuthCallback(code, state), false);
  }
  for (const invalidState of [undefined, "", "a".repeat(63), "A".repeat(64), "g".repeat(64), "a".repeat(64) + "a"]) {
    assert.equal(isUsableUpstoxOAuthCallback("provider-code", invalidState), false);
  }
  assert.equal(isUsableUpstoxOAuthCallback(["code", "injected"], state), false);
  assert.equal(isUsableUpstoxOAuthCallback(["provider-code"], state), false);
  assert.equal(isUsableUpstoxOAuthCallback("provider-code", [state]), false);
});

test("accepts a minimally valid Upstox access-token response", () => {
  assert.equal(isUsableUpstoxTokenResponse({access_token:"opaque-token"}), true);
  assert.equal(isUsableUpstoxTokenResponse({access_token:"opaque-token",token_type:"Bearer"}), true);
});

test("rejects malformed token responses and unsafe token types", () => {
  for (const payload of [
    null, [], "token", {}, {access_token:""}, {access_token:"x".repeat(16385)},
    {access_token:"bad\nsecret"}, {access_token:"token",token_type:""},
    {access_token:"token",token_type:"Bearer\nInjected"},
    {access_token:"token",token_type:"Bearer Token"},
    {access_token:"token",token_type:42}
  ]) {
    assert.equal(isUsableUpstoxTokenResponse(payload), false);
  }
});
