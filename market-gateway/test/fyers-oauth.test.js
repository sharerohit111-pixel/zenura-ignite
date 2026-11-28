"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { isUsableFyersTokenResponse, isValidFyersRedirectUri, nextFyersTokenExpiry } = require("../lib/fyers-oauth");

test("FYERS token response must be successful and contain a bounded access token", () => {
  assert.equal(isUsableFyersTokenResponse({ s: "ok", code: 200, access_token: "token" }), true);
  assert.equal(isUsableFyersTokenResponse({ s: "error", code: 401, access_token: "token" }), false);
  assert.equal(isUsableFyersTokenResponse({ s: "ok", code: 200, access_token: "" }), false);
  assert.equal(isUsableFyersTokenResponse({ s: "ok", code: 200, access_token: "bad\nvalue" }), false);
  assert.equal(isUsableFyersTokenResponse(null), false);
});

test("FYERS access-token expiry is the next 06:30 India time boundary", () => {
  const before = Date.parse("2026-11-28T00:59:00.000Z");
  const after = Date.parse("2026-11-28T01:01:00.000Z");
  assert.equal(nextFyersTokenExpiry(before).toISOString(), "2026-11-28T01:00:00.000Z");
  assert.equal(nextFyersTokenExpiry(after).toISOString(), "2026-11-29T01:00:00.000Z");
  assert.throws(() => nextFyersTokenExpiry(-1));
});

test("FYERS callback must be an exact clean HTTPS endpoint", () => {
  assert.equal(isValidFyersRedirectUri("https://gateway.example/fyers/oauth/callback"), true);
  assert.equal(isValidFyersRedirectUri("http://gateway.example/fyers/oauth/callback"), false);
  assert.equal(isValidFyersRedirectUri("https://gateway.example/fyers/oauth/callback?next=x"), false);
  assert.equal(isValidFyersRedirectUri("https://gateway.example/other"), false);
});
