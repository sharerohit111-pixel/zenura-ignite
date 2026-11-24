"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createUpstoxFuturesMarketDataAdapter } = require("../lib/upstox-futures-market-data-adapter");

const adapter = createUpstoxFuturesMarketDataAdapter();
const NOW = Date.UTC(2026, 10, 24, 10, 0, 0);
const KEY = "NSE_FO|NIFTY26NOVFUT";
function payload({ buy, sell, timestamp = new Date(NOW - 1000).toISOString(), key = KEY } = {}) {
  return { status: "success", data: { [key]: {
    instrument_token: key, timestamp,
    depth: {
      buy: buy || [{ price: 25000, quantity: 100 }, { price: 24999.95, quantity: 80 }],
      sell: sell || [{ price: 25000.05, quantity: 90 }, { price: 25000.10, quantity: 70 }]
    }
  } } };
}
const options = { instrumentKey: KEY, tickSizePaise: 5, nowMs: NOW, maxAgeMs: 15000 };

test("exposes a provider-specific market-data adapter without broker execution methods", () => {
  assert.equal(adapter.providerId, "UPSTOX");
  assert.equal(typeof adapter.normalizeInstrumentMaster, "function");
  assert.equal(typeof adapter.normalizeDepthSnapshot, "function");
  assert.equal("placeOrder" in adapter, false);
  assert.equal("modifyOrder" in adapter, false);
  assert.equal("cancelOrder" in adapter, false);
});

test("normalizes every depth level into canonical integer paise", () => {
  const result = adapter.normalizeDepthSnapshot(payload(), options);
  assert.equal(result.instrumentKey, KEY);
  assert.equal(result.providerId, "UPSTOX");
  assert.equal(result.bids.length, 2);
  assert.equal(result.asks.length, 2);
  assert.deepEqual(result.asks[0], { pricePaise: 2500005, quantity: 90 });
  assert.deepEqual(result.bids[1], { pricePaise: 2499995, quantity: 80 });
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.asks));
});

test("rejects mismatched instrument, stale/future snapshots and malformed payload", () => {
  assert.throws(() => adapter.normalizeDepthSnapshot(payload({ key: "NSE_FO|OTHER" }), options), /does not contain/);
  assert.throws(() => adapter.normalizeDepthSnapshot(payload({ timestamp: new Date(NOW - 15001).toISOString() }), options), /stale/);
  assert.throws(() => adapter.normalizeDepthSnapshot(payload({ timestamp: new Date(NOW + 1).toISOString() }), options), /future-dated/);
  assert.throws(() => adapter.normalizeDepthSnapshot({}, options), /Invalid Upstox/);
});

test("rejects crossed books, malformed levels and off-tick prices", () => {
  assert.throws(() => adapter.normalizeDepthSnapshot(payload({
    buy: [{ price: 25001, quantity: 10 }]
  }), options), /crossed/);
  assert.throws(() => adapter.normalizeDepthSnapshot(payload({
    sell: [{ price: 25000.051, quantity: 10 }]
  }), options), /invalid price/);
  assert.throws(() => adapter.normalizeDepthSnapshot(payload({
    buy: [{ price: 25000, quantity: 0 }]
  }), options), /invalid price/);
});

test("rejects unordered sides and excessive level counts", () => {
  assert.throws(() => adapter.normalizeDepthSnapshot(payload({
    buy: [{ price: 24999, quantity: 10 }, { price: 25000, quantity: 10 }]
  }), options), /not in executable price order/);
  const tooMany = Array.from({ length: 21 }, (_, i) => ({ price: 25001 + i * 0.05, quantity: 1 }));
  assert.throws(() => adapter.normalizeDepthSnapshot(payload({ sell: tooMany }), options), /20-level limit/);
});

test("does not merge levels or snapshots and retains the single source timestamp", () => {
  const result = adapter.normalizeDepthSnapshot(payload(), options);
  assert.equal(result.timestampMs, NOW - 1000);
  assert.equal(result.asks.reduce((sum, level) => sum + level.quantity, 0), 160);
});
