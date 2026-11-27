"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { aggregateCashEquityStt } = require("../lib/cash-equity-stt-aggregation");

const trade = (tradeId, overrides = {}) => ({
  tradeId,
  clientId: "client-a",
  securityId: "INFY",
  settlementId: "NSE-2026-11-27",
  tradeDate: "2026-11-27",
  settlementType: "NETTED",
  side: "BUY",
  quantity: 100,
  tradeValuePaise: 100_000_000,
  ...overrides
});

test("netted settlement nets quantities and uses client-security VWAP", () => {
  const result = aggregateCashEquityStt([
    trade("buy", { side: "BUY", quantity: 100, tradeValuePaise: 10_000_000 }),
    trade("sell", { side: "SELL", quantity: 40, tradeValuePaise: 4_400_000 })
  ]);
  const g = result.groups[0];
  // VWAP = (₹1,00,000 + ₹44,000) / 140 = ₹1,028.57
  assert.equal(g.deliveryBuyQty, 60);
  assert.equal(g.deliverySellQty, 0);
  assert.equal(g.nonDeliverySellQty, 40);
  assert.equal(g.deliveryBuyValuePaise, 6_171_420);
  assert.equal(g.nonDeliverySellValuePaise, 4_114_280);
  assert.equal(g.deliveryBuySttPaise, 6_171);
  assert.equal(g.nonDeliverySellSttPaise, 1_029);
  assert.equal(g.groupSttPaise, 7_200);
});

test("netted sell excess creates delivery sell STT plus non-delivery sell STT", () => {
  const result = aggregateCashEquityStt([
    trade("buy", { side: "BUY", quantity: 25, tradeValuePaise: 2_500_000 }),
    trade("sell", { side: "SELL", quantity: 100, tradeValuePaise: 10_500_000 })
  ]);
  const g = result.groups[0];
  assert.equal(g.deliveryBuyQty, 0);
  assert.equal(g.deliverySellQty, 75);
  assert.equal(g.nonDeliverySellQty, 25);
  assert.ok(g.deliverySellSttPaise > 0);
  assert.ok(g.nonDeliverySellSttPaise > 0);
});

test("non-netted settlement treats all buys and sells as delivery", () => {
  const result = aggregateCashEquityStt([
    trade("buy", { settlementType: "NON_NETTED", side: "BUY", quantity: 10, tradeValuePaise: 1_000_000 }),
    trade("sell", { settlementType: "NON_NETTED", side: "SELL", quantity: 5, tradeValuePaise: 600_000 })
  ]);
  const g = result.groups[0];
  assert.equal(g.deliveryBuyQty, 10);
  assert.equal(g.deliverySellQty, 5);
  assert.equal(g.nonDeliverySellQty, 0);
  assert.equal(g.deliveryBuySttPaise, 1_000);
  assert.equal(g.deliverySellSttPaise, 600);
  assert.equal(g.nonDeliverySellSttPaise, 0);
});

test("client daily STT is aggregated across securities and settlements then rounded once", () => {
  const result = aggregateCashEquityStt([
    trade("t1", { securityId: "AAA", settlementId: "S1", settlementType: "NON_NETTED", side: "BUY", quantity: 1, tradeValuePaise: 25_000 }),
    trade("t2", { securityId: "BBB", settlementId: "S2", settlementType: "NON_NETTED", side: "BUY", quantity: 1, tradeValuePaise: 25_000 })
  ]);
  assert.equal(result.groups.length, 2);
  assert.equal(result.clients.length, 1);
  assert.equal(result.clients[0].totalSttPaise, 50);
  assert.equal(result.clients[0].payableSttRupees, 1);
});

test("separates clients, securities, settlement numbers and dates", () => {
  const result = aggregateCashEquityStt([
    trade("t1"),
    trade("t2", { clientId: "client-b" }),
    trade("t3", { securityId: "TCS" }),
    trade("t4", { settlementId: "NSE-OTHER" })
  ]);
  assert.equal(result.groups.length, 4);
  assert.equal(result.clients.length, 2);
});

test("NSE delivery rate 0.10 percent applies to buy and sell legs", () => {
  const result = aggregateCashEquityStt([
    trade("buy", { settlementType: "NON_NETTED", side: "BUY", quantity: 1, tradeValuePaise: 100_000 }),
    trade("sell", { settlementType: "NON_NETTED", side: "SELL", quantity: 1, tradeValuePaise: 100_000 })
  ]);
  const g = result.groups[0];
  assert.equal(g.deliveryBuySttPaise, 100);
  assert.equal(g.deliverySellSttPaise, 100);
});

test("rejects duplicate trades, invalid side, settlement type, date and amount", () => {
  assert.throws(() => aggregateCashEquityStt([trade("dup"), trade("dup")]), /Duplicate tradeId/);
  assert.throws(() => aggregateCashEquityStt([trade("x", { side: "HOLD" })]), /side/);
  assert.throws(() => aggregateCashEquityStt([trade("x", { settlementType: "UNKNOWN" })]), /settlementType/);
  assert.throws(() => aggregateCashEquityStt([trade("x", { tradeDate: "2026-02-30" })]), /valid YYYY-MM-DD/);
  assert.throws(() => aggregateCashEquityStt([trade("x", { tradeValuePaise: -1 })]), /tradeValuePaise/);
  assert.throws(() => aggregateCashEquityStt([trade("x", { quantity: 0 })]), /quantity/);
});

test("rejects duplicate or empty client/security/settlement identity", () => {
  assert.throws(() => aggregateCashEquityStt([trade("x", { clientId: "" })]), /clientId/);
  assert.throws(() => aggregateCashEquityStt([trade("x", { securityId: "" })]), /securityId/);
  assert.throws(() => aggregateCashEquityStt([trade("x", { settlementId: "" })]), /settlementId/);
});

test("unsupported dates fail closed instead of applying a stale STT schedule", () => {
  assert.throws(() => aggregateCashEquityStt([trade("old", { tradeDate: "2026-03-31" })]), /No verified cash STT schedule/);
  assert.throws(() => aggregateCashEquityStt([trade("future", { tradeDate: "2026-11-28" })]), /No verified cash STT schedule/);
});

test("client STT is rounded separately per trading day, not across dates", () => {
  const result = aggregateCashEquityStt([
    trade("day-1", {
      tradeDate: "2026-11-26",
      settlementId: "S-26",
      settlementType: "NON_NETTED",
      side: "BUY",
      quantity: 1,
      tradeValuePaise: 25_000
    }),
    trade("day-2", {
      tradeDate: "2026-11-27",
      settlementId: "S-27",
      settlementType: "NON_NETTED",
      side: "BUY",
      quantity: 1,
      tradeValuePaise: 25_000
    })
  ]);
  assert.equal(result.clients.length, 2);
  assert.deepEqual(result.clients.map(x => x.payableSttRupees), [0, 0]);
});

test("empty input returns no groups or client liabilities", () => {
  assert.deepEqual(aggregateCashEquityStt([]), { groups: [], clients: [] });
});
