"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ProviderHealthRegistry } = require("../lib/provider-health-registry");

test("opens circuit after threshold and rejects requests during cooldown", () => {
  let now = 1000;
  const registry = new ProviderHealthRegistry({
    failureThreshold: 2, cooldownMs: 5000, clock: () => now,
  });
  assert.equal(registry.isAvailable("upstox"), true);
  registry.recordFailure("upstox", "timeout");
  assert.equal(registry.isAvailable("upstox"), true);
  registry.recordFailure("upstox", "timeout");
  assert.equal(registry.snapshot("upstox").state, "open");
  assert.equal(registry.isAvailable("upstox"), false);
  now += 4999;
  assert.equal(registry.isAvailable("upstox"), false);
});

test("allows exactly one half-open probe after cooldown", () => {
  let now = 1000;
  const registry = new ProviderHealthRegistry({
    failureThreshold: 1, cooldownMs: 1000, clock: () => now,
  });
  registry.recordFailure("dhan", "upstream_503");
  assert.equal(registry.isAvailable("dhan"), false);
  now += 1000;
  assert.equal(registry.isAvailable("dhan"), true);
  assert.equal(registry.snapshot("dhan").state, "half_open");
  assert.equal(registry.isAvailable("dhan"), false);
});

test("successful half-open probe closes circuit and clears failure streak", () => {
  let now = 1000;
  const registry = new ProviderHealthRegistry({
    failureThreshold: 1, cooldownMs: 100, clock: () => now,
  });
  registry.recordFailure("fyers", "timeout");
  now += 100;
  assert.equal(registry.isAvailable("fyers"), true);
  const result = registry.recordSuccess("fyers");
  assert.equal(result.state, "closed");
  assert.equal(result.consecutiveFailures, 0);
  assert.equal(registry.isAvailable("fyers"), true);
});

test("failed half-open probe reopens circuit and records failure reason", () => {
  let now = 1000;
  const registry = new ProviderHealthRegistry({
    failureThreshold: 1, cooldownMs: 100, clock: () => now,
  });
  registry.recordFailure("kite", "timeout");
  now += 100;
  assert.equal(registry.isAvailable("kite"), true);
  const result = registry.recordFailure("kite", "feed_stale");
  assert.equal(result.state, "open");
  assert.equal(result.lastFailureCode, "feed_stale");
  assert.equal(registry.isAvailable("kite"), false);
});
