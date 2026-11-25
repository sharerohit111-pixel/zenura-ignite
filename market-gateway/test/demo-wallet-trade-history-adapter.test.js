"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createDemoWalletLedger } = require("../lib/demo-wallet-ledger");
const { syncDemoWalletFromTradeHistory } = require("../lib/demo-wallet-trade-history-adapter");

const at = "2026-11-25T10:00:00+05:30";
const wallet = () => createDemoWalletLedger({ accountId: "mock-account-user-a",
  openingCashPaise: 100000000, openingEvidenceRef: "fixture:account:opening",
  env: { NODE_ENV: "test" } });
const history = (overrides = {}) => ({
  orders: [{ orderId: "order-eq-1", assetClass: "EQUITY", side: "BUY",
    createdAt: at, status: "FILLED", quantity: 2, filledQuantity: 2, remainingQuantity: 0 }],
  openOrders: [],
  trades: [{ fillId: "fill-eq-1", orderId: "order-eq-1", assetClass: "EQUITY",
    side: "BUY", quantity: 2, pricePaise: 125000, grossValuePaise: 250000, filledAt: at }],
  ...overrides
});

test("imports canonical Equity fills into wallet cash exactly once", () => {
  const w = wallet(), h = history();
  const first = syncDemoWalletFromTradeHistory({ wallet: w, historySnapshot: h });
  const second = syncDemoWalletFromTradeHistory({ wallet: w, historySnapshot: h });
  assert.equal(first.snapshot.cashPaise, 99750000);
  assert.equal(second.snapshot.cashPaise, 99750000);
  assert.equal(second.snapshot.settledFillIds.length, 1);
  assert.equal(second.snapshot.events.length, 2);
  assert.equal(second.snapshot.ledgerReconciled, false);
});

test("SELL fill credits proceeds and OPTIONS premium uses the same explicit fill receipt", () => {
  const w = wallet();
  const h = history({
    orders: [
      { orderId: "order-eq-sell", assetClass: "EQUITY", side: "SELL", createdAt: at },
      { orderId: "order-opt-buy", assetClass: "OPTION", side: "BUY", createdAt: at }
    ],
    trades: [
      { fillId: "sell-fill-1", orderId: "order-eq-sell", assetClass: "EQUITY",
        side: "SELL", quantity: 1, pricePaise: 10000, grossValuePaise: 10000, filledAt: at },
      { fillId: "opt-fill-1", orderId: "order-opt-buy", assetClass: "OPTION",
        side: "BUY", quantity: 1, pricePaise: 5000, grossValuePaise: 5000, filledAt: at }
    ]
  });
  const result = syncDemoWalletFromTradeHistory({ wallet: w, historySnapshot: h });
  assert.equal(result.snapshot.cashPaise, 100005000);
  assert.equal(result.snapshot.settledFillIds.length, 2);
});

test("refuses open orders until authoritative reservation receipts exist without mutating wallet", () => {
  const w = wallet(), before = w.snapshot();
  assert.throws(() => syncDemoWalletFromTradeHistory({ wallet: w,
    historySnapshot: history({ openOrders: [{ orderId: "order-eq-1" }] }) }),
    /ORDER_RESERVATION_RECEIPTS_REQUIRED/);
  assert.deepEqual(w.snapshot(), before);
});

test("refuses Futures until approved margin and settlement receipts exist", () => {
  const w = wallet(), before = w.snapshot();
  const h = history({
    orders: [{ orderId: "order-fut-1", assetClass: "FUTURE", side: "BUY", createdAt: at }],
    trades: [{ fillId: "future-fill-1", orderId: "order-fut-1", assetClass: "FUTURE",
      side: "BUY", grossValuePaise: 1000000, filledAt: at }]
  });
  assert.throws(() => syncDemoWalletFromTradeHistory({ wallet: w, historySnapshot: h }),
    /FUTURES_MARGIN_RECEIPT_REQUIRED/);
  assert.deepEqual(w.snapshot(), before);
});

test("rejects mismatched fill-to-order asset or side before ledger mutation", () => {
  const w = wallet(), before = w.snapshot();
  const h = history({ trades: [{ fillId: "bad-fill", orderId: "order-eq-1",
    assetClass: "OPTION", side: "BUY", quantity: 1, pricePaise: 1000, grossValuePaise: 1000, filledAt: at }] });
  assert.throws(() => syncDemoWalletFromTradeHistory({ wallet: w, historySnapshot: h }),
    /FILL_ORDER_ASSET_MISMATCH/);
  assert.deepEqual(w.snapshot(), before);
});

test("preflights insufficient cash and does not partially import order references", () => {
  const w = createDemoWalletLedger({ accountId: "mock-small", openingCashPaise: 10,
    openingEvidenceRef: "fixture:small", env: { NODE_ENV: "test" } });
  const h = history({ trades: [{ fillId: "large-fill", orderId: "order-eq-1",
    assetClass: "EQUITY", side: "BUY", quantity: 1, pricePaise: 11, grossValuePaise: 11, filledAt: at }] });
  assert.throws(() => syncDemoWalletFromTradeHistory({ wallet: w, historySnapshot: h }),
    /CASH_OUT_OF_RANGE/);
  assert.equal(w.snapshot().events.length, 0);
});

test("rejects duplicate source fills before mutation", () => {
  const w = wallet(), h = history();
  h.trades.push({ ...h.trades[0] });
  assert.throws(() => syncDemoWalletFromTradeHistory({ wallet: w, historySnapshot: h }),
    /DUPLICATE_CANONICAL_FILL/);
  assert.equal(w.snapshot().events.length, 0);
});

test("retains terminal Futures order references while importing supported Equity cash receipts", () => {
  const w = wallet();
  const h = history({
    orders: [
      { orderId: "order-eq-1", assetClass: "EQUITY", side: "BUY", createdAt: at,
        status: "FILLED", quantity: 2, filledQuantity: 2, remainingQuantity: 0 },
      { orderId: "order-fut-closed", assetClass: "FUTURE", side: "BUY", createdAt: at,
        status: "CANCELLED", quantity: 1, filledQuantity: 0, remainingQuantity: 1 }
    ]
  });
  const result = syncDemoWalletFromTradeHistory({ wallet: w, historySnapshot: h });
  assert.equal(result.snapshot.events.filter(x => x.type === "ORDER_REFERENCE").length, 2);
  assert.equal(result.snapshot.cashPaise, 99750000);
});

test("rejects canonical fill when quantity times price does not equal gross receipt", () => {
  const w = wallet(), before = w.snapshot();
  const h = history({ trades: [{ fillId: "bad-math", orderId: "order-eq-1",
    assetClass: "EQUITY", side: "BUY", quantity: 2, pricePaise: 100,
    grossValuePaise: 199, filledAt: at }] });
  assert.throws(() => syncDemoWalletFromTradeHistory({ wallet: w, historySnapshot: h }),
    /INVALID_CANONICAL_FILL/);
  assert.deepEqual(w.snapshot(), before);
});
