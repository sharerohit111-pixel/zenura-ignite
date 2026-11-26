"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { MarketDataProviderRouter, validateProviderPlan } = require("../lib/market-data-provider-router");
const { ProviderRateLimitPolicy } = require("../lib/provider-rate-limit");

const NOW = 1_800_000_000_000;
process.env.MARKET_DATA_RIGHTS_APPROVED = "true";
process.env.MARKET_DATA_RIGHTS_REFERENCE = "test-only-provider-rights";
process.env.MARKET_DATA_REGULATORY_APPROVED = "true";
process.env.MARKET_DATA_REGULATORY_REFERENCE = "test-only-product-clearance";
const plan = {
  quote: ["upstox", "angelone"],
  candles: ["upstox"],
  depth: ["upstox", "angelone"],
  instrumentMaster: ["upstox"],
  stream: ["upstox", "angelone"],
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
    entitlementReference: "entitlement-" + providerId,
    attribution: { displayName: providerId.toUpperCase() },
    ...overrides,
  };
}
function provider(providerId, getQuote) {
  return {
    providerId,
    getQuote,
    getCandles: async () => ({ providerId, instrumentId: "NSE_EQ|INE002A01018", exchange: "NSE", entitlementReference: "entitlement-" + providerId, attribution: { displayName: providerId } }),
    getDepth: async () => ({ providerId, instrumentId: "NSE_EQ|INE002A01018", exchange: "NSE", entitlementReference: "entitlement-" + providerId, attribution: { displayName: providerId } }),
    getInstrumentMaster: async () => ({ providerId, instrumentId: "NSE_EQ|INE002A01018", exchange: "NSE", entitlementReference: "entitlement-" + providerId, attribution: { displayName: providerId } }),
    openStream: async () => ({ providerId, instrumentId: "NSE_EQ|INE002A01018", exchange: "NSE", entitlementReference: "entitlement-" + providerId, attribution: { displayName: providerId } }),
    getHealth: async () => ({ healthy: true }),
  };
}
function makeRouter(providers, entitlementResolver = async ({ providerId }) => ({ approved: true, paperTradingAllowed: true, redistributionAllowed: true, reference: "entitlement-" + providerId, rightsApprovalReference: "written-rights-" + providerId, regulatoryApprovalReference: "regulatory-" + providerId })) {
  return new MarketDataProviderRouter({
    providers: new Map(providers),
    plan,
    entitlementResolver,
    clock: () => NOW,
  });
}
const request = { userId: "user-1", instrumentId: "NSE_EQ|INE002A01018", exchange: "NSE" };


test("global dual approval gate cannot be replaced by a caller-supplied no-op", async () => {
  const previous = {
    rights: process.env.MARKET_DATA_RIGHTS_APPROVED,
    rightsReference: process.env.MARKET_DATA_RIGHTS_REFERENCE,
    regulatory: process.env.MARKET_DATA_REGULATORY_APPROVED,
    regulatoryReference: process.env.MARKET_DATA_REGULATORY_REFERENCE,
  };
  process.env.MARKET_DATA_RIGHTS_APPROVED = "false";
  let resolverCalls = 0;
  let providerCalls = 0;
  const upstream = provider("upstox", async () => { providerCalls += 1; return quote("upstox"); });
  const router = new MarketDataProviderRouter({
    providers: new Map([["upstox", upstream]]),
    plan,
    entitlementResolver: async () => { resolverCalls += 1; return { approved: true, paperTradingAllowed: true, redistributionAllowed: true, reference: "fabricated", rightsApprovalReference: "fabricated", regulatoryApprovalReference: "fabricated" }; },
    rightsGate: () => ({ rightsReference: "caller-supplied", regulatoryReference: "caller-supplied" }),
    clock: () => NOW,
  });
  try {
    await assert.rejects(router.route("quote", {}, request), { code: "market_data_rights_not_approved", status: 503 });
    assert.equal(resolverCalls, 0);
    assert.equal(providerCalls, 0);
  } finally {
    process.env.MARKET_DATA_RIGHTS_APPROVED = previous.rights;
    process.env.MARKET_DATA_RIGHTS_REFERENCE = previous.rightsReference;
    process.env.MARKET_DATA_REGULATORY_APPROVED = previous.regulatory;
    process.env.MARKET_DATA_REGULATORY_REFERENCE = previous.regulatoryReference;
  }
});

test("provider plan requires ordered, non-empty, unique provider ids", () => {
  assert.deepEqual(validateProviderPlan(plan).quote, ["upstox", "angelone"]);
  assert.throws(() => validateProviderPlan({ ...plan, quote: [] }));
  assert.throws(() => validateProviderPlan({ ...plan, quote: ["upstox", "upstox"] }));
});

test("routes to first authorized and healthy provider with attribution", async () => {
  const router = makeRouter([
    ["upstox", provider("upstox", async () => quote("upstox"))],
    ["angelone", provider("angelone", async () => quote("angelone"))],
  ]);
  const result = await router.route("quote", {}, request);
  assert.equal(result.providerId, "upstox");
  assert.equal(result.entitlementReference, "entitlement-upstox");
});

test("fails over after upstream outage to independently entitled provider", async () => {
  const first = provider("upstox", async () => { throw Object.assign(new Error("timeout"), { status: 503 }); });
  const second = provider("angelone", async () => quote("angelone"));
  const router = makeRouter([["upstox", first], ["angelone", second]]);
  const result = await router.route("quote", {}, request);
  assert.equal(result.providerId, "angelone");
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
  const fresh = provider("angelone", async () => quote("angelone"));
  const router = makeRouter([["upstox", stale], ["angelone", fresh]]);
  const result = await router.route("quote", {}, request);
  assert.equal(result.providerId, "angelone");
});

test("fails closed when all sources are stale or unhealthy", async () => {
  const stale = provider("upstox", async () => quote("upstox", { receivedAtMs: NOW - 20000 }));
  const down = provider("angelone", async () => quote("angelone"));
  down.getHealth = async () => ({ healthy: false });
  const router = makeRouter([["upstox", stale], ["angelone", down]]);
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
  const fallback = provider("angelone", async () => { fallbackCalls += 1; return quote("angelone"); });
  const rateLimiter = {
    consume: async (providerId) => {
      if (providerId === "upstox") throw Object.assign(new Error("quota"), { status: 429 });
      return { remaining: 5 };
    },
  };
  const router = new MarketDataProviderRouter({
    providers: new Map([["upstox", primary], ["angelone", fallback]]),
    plan, rateLimiter,
    entitlementResolver: async ({ providerId }) => ({ approved: true, paperTradingAllowed: true, redistributionAllowed: true, reference: "entitlement-" + providerId, rightsApprovalReference: "written-rights-" + providerId, regulatoryApprovalReference: "regulatory-" + providerId }),
    clock: () => NOW,
  });
  const result = await router.route("quote", {}, request);
  assert.equal(result.providerId, "angelone");
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
    entitlementResolver: async () => ({ approved: true, paperTradingAllowed: true, redistributionAllowed: true, reference: "entitlement-upstox", rightsApprovalReference: "written-rights-upstox", regulatoryApprovalReference: "regulatory-upstox" }),
    clock: () => NOW,
  });
  await assert.rejects(router.route("quote", {}, request), { code: "market_data_unavailable", status: 503 });
  assert.equal(providerCalls, 0);
});

test("requires explicit paper-trading and redistribution rights, not a generic API entitlement", async () => {
  let calls = 0;
  const upstream = provider("upstox", async () => { calls += 1; return quote("upstox"); });
  const router = makeRouter([["upstox", upstream]], async () => ({
    approved: true, reference: "broker-api-access-only",
  }));
  await assert.rejects(router.route("quote", {}, request), { code: "market_data_unavailable" });
  assert.equal(calls, 0);
});

test("hard-blocks providers whose published terms/support prohibit live-data paper trading", async () => {
  let calls = 0;
  const dhan = provider("dhan", async () => { calls += 1; return quote("dhan"); });
  const router = makeRouter([["dhan", dhan]]);
  await assert.rejects(router.route("quote", {}, request), { code: "market_data_unavailable" });
  assert.equal(calls, 0);
});
