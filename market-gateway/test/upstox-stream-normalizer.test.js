"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeUpstoxFeedQuotes, rupeesToPaise } = require("../lib/upstox-stream-normalizer");
const { normalizeMarketDataSnapshot } = require("../lib/market-data-provider-contract");

const NOW = Date.parse("2026-11-24T04:30:00Z");
const key = "NSE_EQ|INE002A01018";
const mapping = {
  [key]: {
    nativeInstrumentKey: key,
    instrumentId: "NSE_EQ|INE002A01018",
    exchange: "NSE",
    entitlementReference: "entitlement-1",
  },
};
function frame(overrides = {}) {
  return {
    currentTs: String(NOW - 100),
    feeds: {
      [key]: {
        ltpc: { ltp: 123.45, ltt: String(NOW - 200), ltq: "5", cp: 122.5 },
      },
    },
    ...overrides,
  };
}

test("normalizes Upstox LTPC into an attributed integer-paise snapshot", () => {
  const [snapshot] = normalizeUpstoxFeedQuotes(frame(), { instrumentMap: mapping, now: NOW });
  assert.equal(snapshot.providerId, "upstox");
  assert.equal(snapshot.instrumentId, key);
  assert.equal(snapshot.exchange, "NSE");
  assert.equal(snapshot.lastPricePaise, 12345);
  assert.equal(snapshot.receivedAtMs, NOW);
  assert.equal(snapshot.exchangeTimestampMs, NOW - 100);
  assert.equal(snapshot.lastTradeTimestampMs, NOW - 200);
  assert.equal(snapshot.entitlementReference, "entitlement-1");
  assert.equal(snapshot.attribution.displayName, "Upstox");
  assert.ok(snapshot.sourceSequence);
  const accepted = normalizeMarketDataSnapshot(snapshot, {
    expectedProviderId: "upstox", expectedInstrumentId: key, nowMs: NOW, maxAgeMs: 15000,
  });
  assert.equal(accepted.lastPricePaise, 12345);
});

test("accepts Map mappings and Full-feed market LTPC", () => {
  const payload = frame({
    feeds: {
      [key]: { fullFeed: { marketFF: { ltpc: { ltp: 125, ltt: String(NOW - 100) } } } },
    },
  });
  const result = normalizeUpstoxFeedQuotes(payload, {
    instrumentMap: new Map([[key, mapping[key]]]), now: NOW,
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].lastPricePaise, 12500);
});

test("drops unknown instruments and mappings for a different native key", () => {
  const payload = frame({
    feeds: {
      ...frame().feeds,
      "NSE_EQ|UNKNOWN": { ltpc: { ltp: 10, ltt: String(NOW - 100) } },
    },
  });
  const result = normalizeUpstoxFeedQuotes(payload, {
    instrumentMap: { ...mapping, "NSE_EQ|UNKNOWN": { instrumentId: "wrong", exchange: "NSE" } },
    now: NOW,
  });
  assert.equal(result.length, 1);
});

test("drops stale and future feed/trade timestamps and invalid prices", () => {
  const staleFrame = frame({ currentTs: String(NOW - 16000) });
  assert.deepEqual(normalizeUpstoxFeedQuotes(staleFrame, { instrumentMap: mapping, now: NOW }), []);

  const badEntries = frame({
    feeds: {
      [key]: { ltpc: { ltp: 123.45, ltt: String(NOW + 1) } },
      "NSE_EQ|INE002A01019": { ltpc: { ltp: 123.456, ltt: String(NOW - 100) } },
    },
  });
  assert.deepEqual(normalizeUpstoxFeedQuotes(badEntries, {
    instrumentMap: { ...mapping, "NSE_EQ|INE002A01019": { ...mapping[key], instrumentId: "other" } },
    now: NOW,
  }), []);
});

test("rejects malformed frames and invalid freshness configuration", () => {
  assert.throws(() => normalizeUpstoxFeedQuotes(null, { instrumentMap: mapping, now: NOW }));
  assert.throws(() => normalizeUpstoxFeedQuotes(frame(), { instrumentMap: mapping, now: NOW, maxAgeMs: 0 }));
});

test("converts only exact positive paise precision", () => {
  assert.equal(rupeesToPaise(123.45), 12345);
  assert.equal(rupeesToPaise(123.456), null);
  assert.equal(rupeesToPaise(0), null);
});

test("accepts the initial Upstox V3 market_info control frame without emitting a quote", () => {
  const control = {
    type: "market_info",
    currentTs: String(NOW - 100),
    marketInfo: {
      segmentStatus: { NSE_EQ: "NORMAL_OPEN", BSE_EQ: "NORMAL_OPEN" },
      casMarketStatus: {},
      preOpenSessionStatus: {},
    },
  };
  assert.deepEqual(normalizeUpstoxFeedQuotes(control, { instrumentMap: mapping, now: NOW }), []);
  assert.throws(() => normalizeUpstoxFeedQuotes({
    type: "market_info", currentTs: String(NOW), marketInfo: {},
  }, { instrumentMap: mapping, now: NOW }), /market-info control frame is malformed/);
});
