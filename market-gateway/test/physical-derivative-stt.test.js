"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { aggregatePhysicalDerivativeStt } = require("../lib/physical-derivative-stt");

const event = (eventId, overrides = {}) => ({
  eventId,
  clientId: "client-a",
  contractId: "RELIANCE-2026-11-26-FUT",
  settlementDate: "2026-11-27",
  side: "BUY",
  quantity: 10,
  settlementPricePaise: 250_000,
  ...overrides
});

test("physical settlement STT applies 0.10 percent to purchaser/receiver", () => {
  const result = aggregatePhysicalDerivativeStt([event("buy")]);
  const row = result.groups[0];
  assert.equal(row.settlementValuePaise, 2_500_000);
  assert.equal(row.sttPaise, 2_500);
  assert.equal(row.payableBy, "PURCHASER_RECEIVER");
});

test("physical settlement STT applies 0.10 percent to seller/giver", () => {
  const result = aggregatePhysicalDerivativeStt([
    event("sell", { side: "SELL" })
  ]);
  const row = result.groups[0];
  assert.equal(row.sttPaise, 2_500);
  assert.equal(row.payableBy, "SELLER_GIVER");
});

test("aggregates partial physical delivery events per client contract settlement and side", () => {
  const result = aggregatePhysicalDerivativeStt([
    event("b1", { quantity: 4 }),
    event("b2", { quantity: 6 })
  ]);
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].quantity, 10);
  assert.equal(result.groups[0].eventCount, 2);
  assert.equal(result.groups[0].settlementValuePaise, 2_500_000);
});

test("buyer and seller are separately charged and both appear in client totals", () => {
  const result = aggregatePhysicalDerivativeStt([
    event("b", { side: "BUY" }),
    event("s", { side: "SELL" })
  ]);
  assert.equal(result.groups.length, 2);
  assert.equal(result.groups.find(x => x.side === "BUY").sttPaise, 2_500);
  assert.equal(result.groups.find(x => x.side === "SELL").sttPaise, 2_500);
});

test("client STT is aggregated across physical delivery contracts then rupee-rounded", () => {
  const result = aggregatePhysicalDerivativeStt([
    event("a", { contractId: "CONTRACT-A", quantity: 1, settlementPricePaise: 25_000 }),
    event("b", { contractId: "CONTRACT-B", quantity: 1, settlementPricePaise: 25_000 })
  ]);
  assert.equal(result.groups.length, 2);
  assert.equal(result.clients[0].totalSttPaise, 50);
  assert.equal(result.clients[0].payableSttRupees, 1);
});

test("does not merge different clients, settlement dates or contracts", () => {
  const result = aggregatePhysicalDerivativeStt([
    event("a"),
    event("b", { clientId: "client-b" }),
    event("c", { settlementDate: "2026-11-26" }),
    event("d", { contractId: "TCS-2026-11-26-FUT" })
  ]);
  assert.equal(result.groups.length, 4);
});

test("rejects duplicate IDs, invalid side, date, identity and amounts", () => {
  assert.throws(() => aggregatePhysicalDerivativeStt([event("dup"), event("dup")]), /Duplicate eventId/);
  assert.throws(() => aggregatePhysicalDerivativeStt([event("x", { side: "HOLD" })]), /side/);
  assert.throws(() => aggregatePhysicalDerivativeStt([event("x", { settlementDate: "2026-02-30" })]), /No verified/);
  assert.throws(() => aggregatePhysicalDerivativeStt([event("x", { clientId: "" })]), /clientId/);
  assert.throws(() => aggregatePhysicalDerivativeStt([event("x", { quantity: 0 })]), /quantity/);
  assert.throws(() => aggregatePhysicalDerivativeStt([event("x", { settlementPricePaise: -1 })]), /settlementPricePaise/);
});

test("rejects unsupported schedule dates instead of using an unverified rate", () => {
  assert.throws(() => aggregatePhysicalDerivativeStt([
    event("old", { settlementDate: "2018-07-25" })
  ]), /No verified physical-delivery STT schedule/);
  assert.throws(() => aggregatePhysicalDerivativeStt([
    event("future", { settlementDate: "2026-11-28" })
  ]), /No verified physical-delivery STT schedule/);
});

test("empty input returns no charges", () => {
  assert.deepEqual(aggregatePhysicalDerivativeStt([]), { groups: [], clients: [] });
});
