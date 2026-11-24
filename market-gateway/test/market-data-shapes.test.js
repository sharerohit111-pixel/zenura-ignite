"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  validateDepthResult,
  validateCandlesResult,
  validateInstrumentMasterResult,
  validateStreamResult,
} = require("../lib/market-data-provider-router");

const NOW = 1_800_000_000_000;

test("accepts a fresh ordered non-crossed depth book", () => {
  assert.doesNotThrow(() => validateDepthResult({
    timestampMs: NOW - 100,
    sourceSequence: "seq-1",
    bids: [{ pricePaise: 10000, quantity: 10 }, { pricePaise: 9990, quantity: 20 }],
    asks: [{ pricePaise: 10010, quantity: 15 }, { pricePaise: 10020, quantity: 30 }],
  }, NOW, 15000));
});

test("rejects stale, crossed, unordered and incomplete depth", () => {
  const valid = {
    timestampMs: NOW - 100, sourceSequence: "seq-1",
    bids: [{ pricePaise: 10000, quantity: 10 }],
    asks: [{ pricePaise: 10010, quantity: 10 }],
  };
  for (const invalid of [
    { ...valid, timestampMs: NOW - 16000 },
    { ...valid, asks: [{ pricePaise: 9990, quantity: 10 }] },
    { ...valid, bids: [{ pricePaise: 10000, quantity: 10 }, { pricePaise: 10005, quantity: 1 }] },
    { ...valid, asks: [] },
    { ...valid, sourceSequence: "" },
  ]) assert.throws(() => validateDepthResult(invalid, NOW, 15000), { code: "invalid_market_data" });
});

test("accepts chronological integer-paise OHLC candles", () => {
  assert.doesNotThrow(() => validateCandlesResult({
    candles: [
      { timestampMs: NOW - 60000, openPaise: 100, highPaise: 120, lowPaise: 90, closePaise: 110, volume: 1000 },
      { timestampMs: NOW - 30000, openPaise: 110, highPaise: 130, lowPaise: 100, closePaise: 125, volume: 1200 },
    ],
  }, NOW));
});

test("rejects malformed, non-chronological and future candles", () => {
  const valid = { timestampMs: NOW - 60000, openPaise: 100, highPaise: 120, lowPaise: 90, closePaise: 110, volume: 1000 };
  for (const candles of [
    [{ ...valid, highPaise: 105 }],
    [{ ...valid, lowPaise: 115 }],
    [{ ...valid, volume: -1 }],
    [{ ...valid, timestampMs: NOW + 1 }],
    [valid, { ...valid, timestampMs: NOW - 90000 }],
    [],
  ]) assert.throws(() => validateCandlesResult({ candles }, NOW), { code: "invalid_market_data" });
});

test("rejects stale or duplicate instrument master identities", () => {
  const valid = {
    generatedAtMs: NOW - 1000,
    sourceReference: "official-master-2026-11-24",
    instruments: [{ instrumentId: "NSE_EQ|AAA", exchange: "NSE" }],
  };
  assert.doesNotThrow(() => validateInstrumentMasterResult(valid, NOW));
  assert.throws(() => validateInstrumentMasterResult({ ...valid, generatedAtMs: NOW + 1 }, NOW), { code: "invalid_market_data" });
  assert.throws(() => validateInstrumentMasterResult({
    ...valid,
    instruments: [...valid.instruments, ...valid.instruments],
  }, NOW), { code: "invalid_market_data" });
});

test("requires a safely closable provider stream", () => {
  assert.doesNotThrow(() => validateStreamResult({ stream: { close() {}, subscribe() {} } }));
  assert.throws(() => validateStreamResult({ stream: {} }), { code: "invalid_market_data" });
});
