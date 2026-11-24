"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveFuturesDepthSweep } = require("../lib/futures-depth-sweep");

const NOW = Date.parse("2026-11-23T05:00:00.000Z");
const book = {
  instrumentKey: "NSE_FO|NIFTY26NOVFUT",
  timestampMs: NOW - 1000,
  bids: [
    { pricePaise: 10000, quantity: 40 },
    { pricePaise: 9995, quantity: 35 },
    { pricePaise: 9990, quantity: 25 }
  ],
  asks: [
    { pricePaise: 10005, quantity: 40 },
    { pricePaise: 10010, quantity: 35 },
    { pricePaise: 10015, quantity: 25 }
  ]
};
const run = (overrides = {}) => resolveFuturesDepthSweep({
  quote: book, expectedInstrumentKey: book.instrumentKey, side: "BUY",
  quantity: 100, tickSizePaise: 5, nowMs: NOW, ...overrides
});

test("BUY sweeps asks in ascending order and preserves immutable per-level fills", () => {
  const result = run();
  assert.deepEqual(result.fills.map(x => [x.pricePaise, x.quantity]), [
    [10005, 40], [10010, 35], [10015, 25]
  ]);
  assert.equal(result.grossPaise, 1000925);
  assert.equal(result.vwapPaise, 10009);
  assert.equal(result.vwapNumeratorPaiseQty, "1000925");
  assert.equal(result.vwapDenominatorQuantity, 100);
  assert.equal(result.partialFillAllowed, false);
  assert.match(result.snapshotHash, /^[a-f0-9]{64}$/);
  assert.equal(result.snapshotHash, run().snapshotHash);
  assert.notEqual(result.snapshotHash, run({ quote: { ...book, timestampMs: book.timestampMs + 1 } }).snapshotHash);
  assert.equal(result.simulationOnly, true);
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.fills) && Object.isFrozen(result.fills[0]));
});

test("SELL sweeps bids in descending order and records only consumed quantities", () => {
  const result = run({ side: "SELL", quantity: 60 });
  assert.deepEqual(result.fills.map(x => [x.pricePaise, x.quantity]), [
    [10000, 40], [9995, 20]
  ]);
  assert.equal(result.grossPaise, 599900);
  assert.equal(result.vwapPaise, 9998);
});

test("single-level execution is represented as one exact fill", () => {
  const result = run({
    quote: { ...book, asks: [{ pricePaise: 10005, quantity: 100 }] }
  });
  assert.deepEqual(result.fills.map(x => [x.pricePaise, x.quantity]), [[10005, 100]]);
  assert.equal(result.grossPaise, 1000500);
  assert.equal(result.vwapPaise, 10005);
});

test("insufficient aggregate depth rejects instead of returning a partial execution", () => {
  assert.throws(() => run({ quantity: 101 }), { status: 409 });
});

test("rejects mismatched instruments, stale/future snapshots and crossed books", () => {
  assert.throws(() => run({ expectedInstrumentKey: "NSE_FO|OTHER" }), { status: 409 });
  assert.throws(() => run({ nowMs: NOW + 20000 }), { status: 409 });
  assert.throws(() => run({ quote: { ...book, timestampMs: NOW + 1 } }), { status: 409 });
  assert.throws(() => run({ quote: { ...book, bids: [{ pricePaise: 10010, quantity: 1 }] } }), { status: 409 });
});

test("rejects malformed, duplicate, unordered, off-tick and non-positive levels", () => {
  const badBooks = [
    { asks: [{ pricePaise: 10005, quantity: 10 }, { pricePaise: 10005, quantity: 20 }] },
    { asks: [{ pricePaise: 10010, quantity: 10 }, { pricePaise: 10005, quantity: 20 }] },
    { asks: [{ pricePaise: 10006, quantity: 10 }] },
    { asks: [{ pricePaise: 10005, quantity: 0 }] },
    { asks: [{ pricePaise: Number.MAX_SAFE_INTEGER + 1, quantity: 1 }] }
  ];
  for (const bad of badBooks) {
    assert.throws(() => run({ quote: { ...book, ...bad } }), { status: 409 });
  }
  assert.throws(() => run({ quote: { ...book, bids: [] } }), { status: 409 });
});

test("rejects invalid request bounds and unsafe aggregate turnover", () => {
  assert.throws(() => run({ quantity: 0 }), { status: 409 });
  assert.throws(() => run({ tickSizePaise: 0 }), { status: 409 });
  assert.throws(() => run({
    quantity: Number.MAX_SAFE_INTEGER,
    quote: { ...book, asks: [{ pricePaise: Number.MAX_SAFE_INTEGER, quantity: Number.MAX_SAFE_INTEGER }] },
    tickSizePaise: 1
  }), { status: 409 });
});
