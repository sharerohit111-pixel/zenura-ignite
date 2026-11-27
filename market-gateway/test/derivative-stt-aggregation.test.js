"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { aggregateDerivativeStt } = require("../lib/derivative-stt-aggregation");

const event = (eventId, overrides = {}) => ({
  eventId,
  clientId: "client-01",
  contractId: "NIFTY-2026-12-01-26000-CE",
  tradeDate: "2026-11-27",
  eventType: "OPTIONS_SELL",
  taxableValuePaise: 1_000_000,
  ...overrides
});

test("option sell aggregates premium across fills at client + contract + trade date", () => {
  const rows = aggregateDerivativeStt([
    event("fill-1", { taxableValuePaise: 1_000_000 }),
    event("fill-2", { taxableValuePaise: 1_000_000 })
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].eventCount, 2);
  assert.equal(rows[0].taxableValuePaise, 2_000_000);
  assert.equal(rows[0].taxableValueRupees, 20_000);
  assert.equal(rows[0].rateNumerator, 15);
  assert.equal(rows[0].rateDenominator, 10_000);
  assert.equal(rows[0].sttRupees, 30);
  assert.equal(rows[0].sttPaise, 3_000);
  assert.equal(rows[0].payableBy, "SELLER");
  assert.equal(rows[0].taxableBasis, "OPTION_PREMIUM");
});

test("futures sell applies 0.05 percent to aggregated actual traded value", () => {
  const rows = aggregateDerivativeStt([
    event("fut-1", { eventType: "FUTURES_SELL", taxableValuePaise: 1_000_000 }),
    event("fut-2", { eventType: "FUTURES_SELL", taxableValuePaise: 1_000_000 })
  ]);
  assert.equal(rows[0].taxableBasis, "ACTUAL_TRADE_VALUE");
  assert.equal(rows[0].rateNumerator, 5);
  assert.equal(rows[0].sttRupees, 10);
});

test("option exercise STT uses intrinsic value and is payable by purchaser", () => {
  const rows = aggregateDerivativeStt([
    event("exercise-1", {
      eventType: "OPTIONS_EXERCISE_BUY",
      taxableValuePaise: 10_000_000
    })
  ]);
  assert.equal(rows[0].taxableBasis, "INTRINSIC_VALUE");
  assert.equal(rows[0].payableBy, "PURCHASER");
  assert.equal(rows[0].sttRupees, 150);
});

test("STT aggregation prevents rounding each fill separately", () => {
  const rows = aggregateDerivativeStt([
    event("f-1", { eventType: "FUTURES_SELL", taxableValuePaise: 100_000 }),
    event("f-2", { eventType: "FUTURES_SELL", taxableValuePaise: 100_000 })
  ]);
  // Each ₹1,000 fill would produce ₹0.50 STT; the combined ₹2,000 contract
  // turnover produces ₹1.00 STT once, not ₹2.00.
  assert.equal(rows[0].taxableValueRupees, 2_000);
  assert.equal(rows[0].sttRupees, 1);
});

test("separates clients, contracts, dates and event types", () => {
  const rows = aggregateDerivativeStt([
    event("a1"),
    event("a2", { clientId: "client-02" }),
    event("a3", { contractId: "NIFTY-2026-12-01-26100-CE" }),
    event("a4", { tradeDate: "2026-11-26" }),
    event("a5", { eventType: "FUTURES_SELL" })
  ]);
  assert.equal(rows.length, 5);
});

test("rounds taxable transaction value and STT to nearest rupee, half up", () => {
  const rows = aggregateDerivativeStt([
    event("half-up", {
      eventType: "FUTURES_SELL",
      taxableValuePaise: 200_100 // ₹2,001.00, 0.05% = ₹1.0005
    })
  ]);
  assert.equal(rows[0].taxableValueRupees, 2_001);
  assert.equal(rows[0].sttRupees, 1);
});

test("rejects duplicate event IDs to prevent double-counting", () => {
  assert.throws(() => aggregateDerivativeStt([
    event("duplicate"), event("duplicate")
  ]), /Duplicate eventId/);
});

test("rejects unsupported physical delivery STT until settlement data is implemented", () => {
  assert.throws(() => aggregateDerivativeStt([
    event("physical", { eventType: "PHYSICAL_DELIVERY_BUY" })
  ]), /physical delivery requires a separate settlement calculation/);
});

test("rejects historical dates outside the verified rate master", () => {
  assert.throws(() => aggregateDerivativeStt([
    event("old", { tradeDate: "2026-03-31" })
  ]), /No verified F&O STT rate schedule/);
});

test("rejects invalid event, identity, date and negative taxable values", () => {
  assert.throws(() => aggregateDerivativeStt([event("")]), /eventId/);
  assert.throws(() => aggregateDerivativeStt([event("x", { clientId: "" })]), /clientId/);
  assert.throws(() => aggregateDerivativeStt([event("x", { contractId: "" })]), /contractId/);
  assert.throws(() => aggregateDerivativeStt([event("x", { tradeDate: "2026-02-30" })]), /valid YYYY-MM-DD/);
  assert.throws(() => aggregateDerivativeStt([event("x", { taxableValuePaise: -1 })]), /non-negative/);
  assert.throws(() => aggregateDerivativeStt([
    event("x1", { taxableValuePaise: Number.MAX_SAFE_INTEGER }),
    event("x2", { taxableValuePaise: 1 })
  ]), /Aggregated taxable value/);
});

test("zero intrinsic value creates zero exercise STT", () => {
  const rows = aggregateDerivativeStt([
    event("otm", { eventType: "OPTIONS_EXERCISE_BUY", taxableValuePaise: 0 })
  ]);
  assert.equal(rows[0].sttRupees, 0);
  assert.equal(rows[0].sttPaise, 0);
});
