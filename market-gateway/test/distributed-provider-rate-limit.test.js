"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createDistributedProviderRateLimiter } = require("../lib/distributed-provider-rate-limit");

const userId = "8c7b6a5d-4e3f-4210-9a8b-7c6d5e4f3210";

test("requires a server-side RPC client", () => {
  assert.throws(() => createDistributedProviderRateLimiter({}), /service client/);
  assert.throws(() => createDistributedProviderRateLimiter({ serviceDb: {} }), /service client/);
});

test("calls the atomic database quota RPC with provider, operation and verified user", async () => {
  let call;
  const limiter = createDistributedProviderRateLimiter({
    serviceDb: { rpc: async (...args) => {
      call = args;
      return { data: { allowed: true, retry_after_ms: 0, provider_remaining: 8, user_remaining: 3 }, error: null };
    } },
  });
  const result = await limiter.consume("upstox", "quote", { userId, cost: 2 });
  assert.deepEqual(call, ["consume_market_data_provider_quota", {
    p_provider_id: "upstox", p_operation: "quote", p_user_id: userId, p_cost: 2,
  }]);
  assert.equal(result.remaining, 3);
  assert.equal(result.providerRemaining, 8);
  assert.equal(result.userRemaining, 3);
});

test("rejects provider and user quota exhaustion with retry information", async () => {
  const limiter = createDistributedProviderRateLimiter({
    serviceDb: { rpc: async () => ({
      data: { allowed: false, retry_after_ms: 1200, provider_remaining: 0, user_remaining: 4 },
      error: null,
    }) },
  });
  await assert.rejects(
    limiter.consume("upstox", "quote", { userId }),
    error => error.status === 429 && error.code === "provider_rate_limited" && error.retryAfterMs === 1200
  );
});

test("fails closed if policy RPC is missing or unavailable", async () => {
  const limiter = createDistributedProviderRateLimiter({
    serviceDb: { rpc: async () => ({ data: null, error: { code: "55000" } }) },
  });
  await assert.rejects(limiter.consume("upstox", "quote", { userId }), {
    status: 503, code: "55000",
  });
  const thrown = createDistributedProviderRateLimiter({
    serviceDb: { rpc: async () => { throw new Error("network"); } },
  });
  await assert.rejects(thrown.consume("upstox", "quote", { userId }), {
    status: 503, code: "provider_quota_unavailable",
  });
});

test("rejects malformed input and malformed RPC payloads", async () => {
  const limiter = createDistributedProviderRateLimiter({
    serviceDb: { rpc: async () => ({ data: { allowed: true }, error: null }) },
  });
  await assert.rejects(limiter.consume("upstox", "quote", { userId: "not-a-uuid" }), TypeError);
  await assert.rejects(limiter.consume("upstox", "quote", { userId }), {
    status: 503, code: "provider_quota_invalid_response",
  });
});
