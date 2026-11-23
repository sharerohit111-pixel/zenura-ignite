"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {isUpstoxAccessTokenUsable, DEFAULT_EXPIRY_SAFETY_BUFFER_MS} = require("../lib/upstox-token-validity");

const NOW = 1_800_000_000_000;

test("accepts tokens with more than the safety buffer remaining", () => {
  assert.equal(isUpstoxAccessTokenUsable(NOW + DEFAULT_EXPIRY_SAFETY_BUFFER_MS + 1, NOW), true);
});

test("rejects expired, exactly-at-buffer and near-expiry tokens", () => {
  for (const expiry of [NOW - 1, NOW, NOW + 1, NOW + DEFAULT_EXPIRY_SAFETY_BUFFER_MS]) {
    assert.equal(isUpstoxAccessTokenUsable(expiry, NOW), false);
  }
});

test("rejects malformed timestamps and invalid safety buffers", () => {
  for (const expiry of [undefined, null, "1800000001000", NaN, Infinity, -1]) {
    assert.equal(isUpstoxAccessTokenUsable(expiry, NOW), false);
  }
  assert.equal(isUpstoxAccessTokenUsable(NOW + 100_000, NOW, -1), false);
});
