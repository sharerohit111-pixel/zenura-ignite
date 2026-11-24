"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { MarketDataProviderRouter, validateProviderPlan } = require("../lib/market-data-provider-router");
const { ProviderRateLimitPolicy } = require("../lib/provider-rate-limit");

const NOW = 1_800_000_000_000;
const plan = {
  quote: ["upstox", "dhan"],
  candles: ["upstox"],
  depth: ["upstox", "dhan"],
  instrumentMaster: ["upstox"],
  stream: ["upstox", "dhan"],
};
function quote(providerId, overrides = {}) {
  return {
    providerId,
    instrumentId: "NSE_EQ|INE002A01018",
    exchange: "NSE",
    lastPricePaise: 123450,
    receivedAtMs: NOW - 100,
    exchangeTimestampMs: NOW - 200,
    lastTradeTimestampMs: NOW - 250,
    sourceSequence: providerId + "-tick-1",
    entitlementReference: "rights-" + providerId,
    attribution: { displayName: providerId.toUpperCase() },
    ...overrides,
  };
}
function provider(providerId, getQuote) {
  return {
    providerId,
    getQuote,
    getCandles: async () => ({ providerId, instrumentId: "NSE_EQ|INE002A01018", exchange: "NSE", entitlementReference: "rights-" + providerId, attribution: { displayName: providerId } }),
    getDepth: async () => ({ providerId, instrumentId: "NSE_EQ|INE002A01018", exchange: "NSE", entitlementReference: "rights-" + providerId, attribution: { displayName: providerId } }),
    getInstrumentMaster: async () => ({ providerId, instrumentId: "NSE_EQ|INE002A01018", exchange: "NSE", entitlementReference: "rights-" + providerId, attribution: { displayName: providerId } }),
    openStream: async () => ({ providerId, instrumentId: "NSE_EQ|INE002A01018", exchange: "NSE", entitlementReference: "rights-" + providerId, attribution: { displayName: providerId } }),
    getHealth: async () => ({ healthy: true }),
  };
}
function makeRouter(providers, entitlementResolver = async ({ providerId }) => ({ approved: true, reference: "rights-" + providerId })) {
  return new MarketDataProviderRouter({
    providers: new Map(providers),
    plan,
    entitlementResolver,
    clock: () => NOW,
  });
}
const request = { userId: "user-1", instrumentId: "NSE_EQ|INE002A01018", exchange: "NSE" };

test("provider plan requires ordered, non-empty, unique provider ids", () => {
  assert.deepEqual(validateProviderPlan(plan).quote, ["upstox", "dhan"]);
  assert.throws(() => validateProviderPlan({ ...plan, quote: [] }));
  assert.throws(() => validateProviderPlan({ ...plan, quote: ["upstox", "upstox"] }));
});

test("routes to first authorized and healthy provider with attribution", async () => {
  const router = makeRouter([
    ["upstox", provider("upstox", async () => quote("upstox"))],
    ["dhan", provider("dhan", async () => quote("dhan"))],
  ]);
  const result = await router.route("quote", {}, request);
  assert.equal(result.providerId, "upstox");
  assert.equal(result.entitlementReference, "rights-upstox");
});

test("fails over after upstream outage to independently entitled provider", async () => {
  const first = provider("upstox", async () => { throw Object.assign(new Error("timeout"), { status: 503 }); });
  const second = provider("dhan", async () => quote("dhan"));
  const router = makeRouter([["upstox", first], ["dhan", second]]);
  const result = await router.route("quote", {}, request);
  assert.equal(result.providerId, "dhan");
});

test("does not use a provider without explicit per-user entitlement", async () => {
  const router = makeRouter(
    [["upstox", provider("upstox", async () => quote("upstox"))]],
    async () => ({ approved: false })
  );
  await assert.rejects(router.route("quote", {}, request), { code: "market_data_unavailable" });
});

test("stale first provider is rejected and only fresh authorized fallback can serve", async () => {
  const stale = provider("upstox", async () => quote("upstox", { exchangeTimestampMs: NOW - 16000 }));
  const fresh = provider("dhan", async () => quote("dhan"));
  const router = makeRouter([["upstox", stale], ["dhan", fresh]]);
  const result = await router.route("quote", {}, request);
  assert.equal(result.providerId, "dhan");
});

test("fails closed when all sources are stale or unhealthy", async () => {
  const stale = provider("upstox", async () => quote("upstox", { receivedAtMs: NOW - 20000 }));
  const down = provider("dhan", async () => quote("dhan"));
  down.getHealth = async () => ({ healthy: false });
  const router = makeRouter([["upstox", stale], ["dhan", down]]);
  await assert.rejects(router.route("quote", {}, request), { code: "market_data_unavailable", status: 503 });
});

test("does not silently accept a provider response for a different instrument", async () => {
  const wrong = provider("upstox", async () => quote("upstox", { instrumentId: "NSE_EQ|WRONG" }));
  const router = makeRouter([["upstox", wrong]]);
  await assert.rejects(router.route("quote", {}, request), { code: "market_data_unavailable" });
});

test("rate-limit policy enforces per-provider, operation and user windows", () => {
  let now = NOW;
  const policy = new ProviderRateLimitPolicy({
    limits: { "upstox:quote": { capacity: 2, windowMs: 1000 } },
    clock: () => now,
  });
  assert.equal(policy.consume("upstox", "quote", { userId: "u1" }).remaining, 1);
  assert.equal(policy.consume("upstox", "quote", { userId: "u1" }).remaining, 0);
  assert.throws(() => policy.consume("upstox", "quote", { userId: "u1" }), { code: "provider_rate_limited", status: 429 });
  assert.equal(policy.consume("upstox", "quote", { userId: "u2" }).remaining, 1);
  now += 1000;
  assert.equal(policy.consume("upstox", "quote", { userId: "u1" }).remaining, 1);
});


test("distributed quota denial skips that provider and never calls its upstream adapter", async () => {
  let primaryCalls = 0;
  let fallbackCalls = 0;
  const primary = provider("upstox", async () => { primaryCalls += 1; return quote("upstox"); });
  const fallback = provider("dhan", async () => { fallbackCalls += 1; return quote("dhan"); });
  const rateLimiter = {
    consume: async (providerId) => {
      if (providerId === "upstox") throw Object.assign(new Error("quota"), { status: 429 });
      return { remaining: 5 };
    },
  };
  const router = new MarketDataProviderRouter({
    providers: new Map([["upstox", primary], ["dhan", fallback]]),
    plan, rateLimiter,
    entitlementResolver: async ({ providerId }) => ({ approved: true, reference: "rights-" + providerId }),
    clock: () => NOW,
  });
  const result = await router.route("quote", {}, request);
  assert.equal(result.providerId, "dhan");
  assert.equal(primaryCalls, 0);
  assert.equal(fallbackCalls, 1);
});

test("distributed quota service failure fails closed when no other provider is configured", async () => {
  let providerCalls = 0;
  const primary = provider("upstox", async () => { providerCalls += 1; return quote("upstox"); });
  const router = new MarketDataProviderRouter({
    providers: new Map([["upstox", primary]]),
    plan: { ...plan, quote: ["upstox"] },
    rateLimiter: { consume: async () => { throw Object.assign(new Error("quota db down"), { status: 503 }); } },
    entitlementResolver: async () => ({ approved: true, reference: "rights-upstox" }),
    clock: () => NOW,
  });
  await assert.rejects(router.route("quote", {}, request), { code: "market_data_unavailable", status: 503 });
  assert.equal(providerCalls, 0);
});
