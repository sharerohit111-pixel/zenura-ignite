"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  calculateKnownAccessExpiry,
  getConnectionState,
  getReconnectPresentation,
  resolveTokenExpiry,
} = require("../lib/token-expiry-policy");

test("Upstox token expiry is calculated at next 03:30 IST", () => {
  const now = new Date("2026-11-28T18:00:00.000Z"); // 23:30 IST
  assert.equal(calculateKnownAccessExpiry("upstox", now).toISOString(), "2026-11-28T22:00:00.000Z");
});

test("FYERS token expiry is calculated at next 06:30 IST", () => {
  const now = new Date("2026-11-28T18:00:00.000Z"); // 23:30 IST
  assert.equal(calculateKnownAccessExpiry("fyers", now).toISOString(), "2026-11-29T01:00:00.000Z");
});

test("provider expiry response takes precedence over estimated schedule", () => {
  const expiry = resolveTokenExpiry({
    providerId: "angel_one",
    expiresAt: "2026-11-29T02:00:00.000Z",
    now: new Date("2026-11-28T18:00:00.000Z"),
  });
  assert.equal(expiry.toISOString(), "2026-11-29T02:00:00.000Z");
});

test("unknown provider expiry is not fabricated", () => {
  assert.equal(resolveTokenExpiry({
    providerId: "angel_one",
    now: new Date("2026-11-28T18:00:00.000Z"),
  }), null);
  assert.equal(getConnectionState({
    providerId: "angel_one",
    now: new Date("2026-11-28T18:00:00.000Z"),
  }).status, "expiry_unknown");
});

test("expired broker returns reconnect action instead of generic error", () => {
  const state = getConnectionState({
    providerId: "upstox",
    expiresAt: "2026-11-28T17:00:00.000Z",
    now: new Date("2026-11-28T18:00:00.000Z"),
  });
  assert.equal(state.status, "expired");
  assert.equal(state.action, "reconnect_broker");
});

test("no broker connected always has Demo / Replay fallback", () => {
  assert.equal(getReconnectPresentation({ hasAnyBroker: false }).primaryAction, "continue_demo_replay");
});

test("unsupported broker policy is rejected", () => {
  assert.throws(() => resolveTokenExpiry({ providerId: "dhan" }), /Unsupported/);
});
