"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  REQUIRED_MARKET_DATA_METHODS,
  assertMarketDataProvider,
  normalizeMarketDataSnapshot,
} = require("../lib/market-data-provider-contract");
const {
  REQUIRED_BROKER_EXECUTION_METHODS,
  assertBrokerExecutionProvider,
  assertLiveExecutionExplicitlyAuthorized,
} = require("../lib/broker-execution-provider-contract");

const NOW = 1_800_000_000_000;
function snapshot(overrides = {}) {
  return {
    providerId: "upstox",
    instrumentId: "NSE_EQ|INE002A01018",
    exchange: "NSE",
    lastPricePaise: 123450,
    receivedAtMs: NOW - 100,
    exchangeTimestampMs: NOW - 200,
    lastTradeTimestampMs: NOW - 250,
    sourceSequence: "tick-0001",
    entitlementReference: "rights-record-2026-001",
    attribution: { displayName: "Upstox" },
    ...overrides,
  };
}

test("market-data provider interface requires every independent capability", () => {
  const provider = Object.fromEntries(REQUIRED_MARKET_DATA_METHODS.map(name => [name, async () => null]));
  provider.providerId = "upstox";
  assert.equal(assertMarketDataProvider(provider), provider);
  for (const missing of REQUIRED_MARKET_DATA_METHODS) {
    const broken = { ...provider };
    delete broken[missing];
    assert.throws(() => assertMarketDataProvider(broken), new RegExp(missing));
  }
});

test("normalizes a fresh attributed snapshot using integer paise", () => {
  const result = normalizeMarketDataSnapshot(snapshot(), {
    expectedProviderId: "upstox",
    expectedInstrumentId: "NSE_EQ|INE002A01018",
    nowMs: NOW,
    maxAgeMs: 15000,
  });
  assert.equal(result.lastPricePaise, 123450);
  assert.equal(result.providerId, "upstox");
  assert.equal(result.attribution.displayName, "Upstox");
  assert.ok(Object.isFrozen(result));
});

test("rejects provider or instrument mismatch", () => {
  assert.throws(() => normalizeMarketDataSnapshot(snapshot({ providerId: "dhan" }), {
    expectedProviderId: "upstox", expectedInstrumentId: "NSE_EQ|INE002A01018", nowMs: NOW,
  }), /provider attribution/);
  assert.throws(() => normalizeMarketDataSnapshot(snapshot({ instrumentId: "NSE_EQ|WRONG" }), {
    expectedProviderId: "upstox", expectedInstrumentId: "NSE_EQ|INE002A01018", nowMs: NOW,
  }), /instrument identity/);
});

test("rejects stale, future-dated and malformed timestamps", () => {
  for (const overrides of [
    { receivedAtMs: NOW - 15001 },
    { receivedAtMs: NOW + 1 },
    { exchangeTimestampMs: NOW - 15001 },
    { exchangeTimestampMs: NOW + 1 },
    { lastTradeTimestampMs: NOW + 1 },
    { lastPricePaise: 1.5 },
    { sourceSequence: "" },
    { entitlementReference: "" },
    { attribution: null },
  ]) {
    assert.throws(() => normalizeMarketDataSnapshot(snapshot(overrides), {
      expectedProviderId: "upstox",
      expectedInstrumentId: "NSE_EQ|INE002A01018",
      nowMs: NOW,
      maxAgeMs: 15000,
    }));
  }
});

test("broker execution interface remains separate from market-data provider interface", () => {
  const broker = Object.fromEntries(REQUIRED_BROKER_EXECUTION_METHODS.map(name => [name, async () => null]));
  broker.providerId = "upstox";
  assert.equal(assertBrokerExecutionProvider(broker), broker);
  assert.throws(() => assertBrokerExecutionProvider({
    providerId: "upstox",
    getQuote: async () => null,
  }), /placeOrder/);
});

test("live broker execution is denied without every explicit authorization gate", () => {
  for (const config of [
    {},
    { environment: "production", liveExecutionEnabled: true },
    { environment: "production", liveExecutionEnabled: true, ownerApprovalReference: "approved" },
    { environment: "test", liveExecutionEnabled: true, ownerApprovalReference: "approved", brokerEntitlementReference: "broker-rights" },
  ]) assert.throws(() => assertLiveExecutionExplicitlyAuthorized(config), { code: "live_execution_not_authorized" });

  assert.equal(assertLiveExecutionExplicitlyAuthorized({
    environment: "production",
    liveExecutionEnabled: true,
    ownerApprovalReference: "owner-approval-2026-01",
    brokerEntitlementReference: "broker-rights-2026-01",
  }), true);
});
