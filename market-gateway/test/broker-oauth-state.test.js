"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createBrokerOAuthState, verifyBrokerOAuthState, TTL_MS } = require("../lib/broker-oauth-state");
const SECRET = "test-secret-with-at-least-32-bytes-long";
test("state is signed, user-bound, broker-bound and short-lived", () => {
  const now = 1800000000000;
  const state = createBrokerOAuthState({ brokerId: "fyers", userId: "user-1", secret: SECRET, now, nonce: "abcdefghijklmnopqrstuvwx" });
  assert.equal(verifyBrokerOAuthState(state, { brokerId: "fyers", userId: "user-1", secret: SECRET, now: now + 1 }).expiresAt, now + TTL_MS);
  assert.equal(verifyBrokerOAuthState(state, { brokerId: "upstox", userId: "user-1", secret: SECRET, now }), null);
  assert.equal(verifyBrokerOAuthState(state, { brokerId: "fyers", userId: "user-2", secret: SECRET, now }), null);
});
test("tampered, expired and malformed state are rejected", () => {
  const now = 1800000000000;
  const state = createBrokerOAuthState({ brokerId: "upstox", userId: "u", secret: SECRET, now, nonce: "abcdefghijklmnopqrstuvwx" });
  assert.equal(verifyBrokerOAuthState(state + "x", { brokerId: "upstox", userId: "u", secret: SECRET, now }), null);
  assert.equal(verifyBrokerOAuthState(state, { brokerId: "upstox", userId: "u", secret: SECRET, now: now + TTL_MS }), null);
  assert.equal(verifyBrokerOAuthState("bad", { brokerId: "upstox", userId: "u", secret: SECRET, now }), null);
});
test("weak signing secret and unsupported broker are rejected", () => {
  assert.throws(() => createBrokerOAuthState({ brokerId: "fyers", userId: "u", secret: "weak" }));
  assert.throws(() => createBrokerOAuthState({ brokerId: "dhan", userId: "u", secret: SECRET }));
});
