"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_DP_CHARGE_PAISE,
  aggregateDpChargesByScripDay
} = require("../lib/dp-charge-aggregation");

const sell = (accountId, isin, tradeDate, id) => ({
  accountId, isin, tradeDate, id,
  side: "SELL",
  segment: "EQUITY_DELIVERY"
});

test("same client, ISIN and trade date incur one DP charge despite multiple fills/orders", () => {
  const rows = aggregateDpChargesByScripDay([
    sell("acct-a", "INE002A01018", "2026-11-27", "fill-1"),
    sell("acct-a", "ine002a01018", "2026-11-27", "fill-2"),
    sell("acct-a", "INE002A01018", "2026-11-27", "fill-3")
  ]);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    accountId: "acct-a",
    isin: "INE002A01018",
    tradeDate: "2026-11-27",
    executionCount: 3,
    dpChargePaise: DEFAULT_DP_CHARGE_PAISE
  });
});

test("DP charge is separate for different clients, ISINs and trading dates", () => {
  const rows = aggregateDpChargesByScripDay([
    sell("acct-a", "INE002A01018", "2026-11-27", "a1"),
    sell("acct-b", "INE002A01018", "2026-11-27", "b1"),
    sell("acct-a", "INE002A01019", "2026-11-27", "a2"),
    sell("acct-a", "INE002A01018", "2026-11-28", "a3")
  ]);
  assert.equal(rows.length, 4);
  assert.equal(rows.reduce((sum, row) => sum + row.dpChargePaise, 0), 8000);
});

test("DP charge can be configured for another broker tariff", () => {
  const rows = aggregateDpChargesByScripDay([
    sell("acct-a", "INE002A01018", "2026-11-27", "a1")
  ], { dpChargePaise: 1650 });
  assert.equal(rows[0].dpChargePaise, 1650);
});

test("empty input produces no DP charges", () => {
  assert.deepEqual(aggregateDpChargesByScripDay([]), []);
});

test("rejects non-delivery sells, malformed identity and invalid date", () => {
  assert.throws(() => aggregateDpChargesByScripDay([
    { ...sell("acct-a", "INE002A01018", "2026-11-27"), segment: "EQUITY_INTRADAY" }
  ]), /delivery SELL/);
  assert.throws(() => aggregateDpChargesByScripDay([
    sell("", "INE002A01018", "2026-11-27")
  ]), /accountId/);
  assert.throws(() => aggregateDpChargesByScripDay([
    sell("acct-a", "", "2026-11-27")
  ]), /isin/);
  assert.throws(() => aggregateDpChargesByScripDay([
    sell("acct-a", "INE002A01018", "2026-02-30")
  ]), /valid YYYY-MM-DD/);
  assert.throws(() => aggregateDpChargesByScripDay([], { dpChargePaise: -1 }), /dpChargePaise/);
});
