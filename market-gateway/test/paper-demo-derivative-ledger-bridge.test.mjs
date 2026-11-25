import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { createDerivativeDemoLedgerBridge } from "../../markets/stocks/demo-derivative-ledger-bridge.mjs";
import { replayPaperDemoEvents } from "../../markets/shared/paper-demo-event-ledger.mjs";

const require = createRequire(import.meta.url);
const { createDerivativeMockSimulator } = require("../../markets/stocks/derivative-mock-simulator.js");
const root = new URL("../../", import.meta.url);
const readJson = async path => JSON.parse(await readFile(new URL(path, root), "utf8"));

async function setup({ thinOptionBid = false } = {}) {
  const fixture = await readJson("market-gateway/mock/fixtures/derivatives.json");
  if (thinOptionBid) {
    const quote = fixture.data.quotes.find(item => item.instrumentKey === fixture.data.options.instrumentKey);
    quote.bidQuantity = 25;
  }
  const now = Date.parse(fixture.asOf);
  const simulator = createDerivativeMockSimulator(fixture, { now });
  let tick = now;
  const bridge = createDerivativeDemoLedgerBridge({
    simulator, accountId: "mock-fo-bridge-test", sessionId: "demo-fo-bridge-test",
    clock: () => tick++
  });
  return { fixture, simulator, bridge };
}
const opening = { accountId: "mock-fo-bridge-test", sessionId: "demo-fo-bridge-test", cashBalancePaise: 0, blockedFundsPaise: 0 };

test("Futures long Intraday and short Delivery positions remain product-separated in the canonical ledger", async () => {
  const { fixture, bridge } = await setup();
  const future = fixture.data.futures.instrumentKey;
  const intradayRequest = {
    instrumentKey: future, side: "BUY", orderType: "MARKET", lots: 1,
    product: "INTRADAY", idempotencyKey: "future-intra-0001"
  };
  const intraday = bridge.submit(intradayRequest);
  const retry = bridge.submit(intradayRequest);
  assert.equal(retry.duplicate, true);
  assert.equal(retry.order.orderId, intraday.order.orderId);
  const delivery = bridge.submit({
    instrumentKey: future, side: "SELL", orderType: "MARKET", lots: 1,
    product: "DELIVERY", idempotencyKey: "future-deliv-0001"
  });
  assert.equal(delivery.order.status, "FILLED");

  const snapshot = bridge.snapshot();
  const positions = snapshot.positions.filter(item => item.instrumentKey === future);
  assert.equal(positions.length, 2);
  assert.equal(positions.find(item => item.product === "INTRADAY").quantity, 25);
  assert.equal(positions.find(item => item.product === "DELIVERY").quantity, -25);
  assert.ok(positions.every(item => item.costBasisPaise > 0));
  assert.equal(snapshot.orders.length, 2);
  assert.equal(snapshot.fills.length, 2);
  assert.equal(snapshot.account.cashBalancePaise, 0);
  assert.equal(snapshot.account.ledgerReconciled, false);
  assert.deepEqual(replayPaperDemoEvents(opening, snapshot.events), snapshot);
});

test("Futures close fills update realized P&L and remove the product-specific position", async () => {
  const { fixture, bridge } = await setup();
  const instrumentKey = fixture.data.futures.instrumentKey;
  bridge.submit({
    instrumentKey, side: "BUY", orderType: "MARKET", lots: 1,
    product: "INTRADAY", idempotencyKey: "future-close-buy-0001"
  });
  bridge.submit({
    instrumentKey, side: "SELL", orderType: "MARKET", lots: 1,
    product: "INTRADAY", idempotencyKey: "future-close-sell-01"
  });
  const snapshot = bridge.snapshot();
  assert.equal(snapshot.positions.length, 0);
  assert.equal(snapshot.account.realizedPnlPaise, -1250);
  assert.equal(snapshot.orders.every(order => order.status === "FILLED"), true);
  assert.deepEqual(replayPaperDemoEvents(opening, snapshot.events), snapshot);
});

test("Options SELL LIMIT partial fill releases only filled close quantity; cancellation releases remainder", async () => {
  const { fixture, bridge } = await setup({ thinOptionBid: true });
  const instrumentKey = fixture.data.options.instrumentKey;
  const buy = bridge.submit({
    instrumentKey, side: "BUY", orderType: "MARKET", lots: 2,
    idempotencyKey: "option-buy-0001"
  }).order;
  assert.equal(buy.status, "FILLED");
  const sell = bridge.submit({
    instrumentKey, side: "SELL", orderType: "LIMIT", lots: 2,
    limitPricePaise: 14950, idempotencyKey: "option-sell-0001"
  }).order;
  assert.equal(bridge.snapshot().positions[0].reservedQuantity, 50);

  const matched = bridge.processLimitFills();
  assert.equal(matched.partial, 1);
  let snapshot = bridge.snapshot();
  assert.equal(snapshot.positions[0].quantity, 25);
  assert.equal(snapshot.positions[0].reservedQuantity, 25);
  assert.equal(snapshot.orders.find(order => order.orderId === sell.orderId).status, "PARTIALLY_FILLED");

  bridge.cancel(sell.orderId);
  snapshot = bridge.snapshot();
  assert.equal(snapshot.positions[0].quantity, 25);
  assert.equal(snapshot.positions[0].reservedQuantity, 0);
  assert.equal(snapshot.orders.find(order => order.orderId === sell.orderId).status, "CANCELLED");
  assert.equal(snapshot.fills.length, 2);
  assert.deepEqual(replayPaperDemoEvents(opening, snapshot.events), snapshot);
});

test("invalid MOCK scope and idempotency-key reuse fail closed", async () => {
  const { fixture, simulator, bridge } = await setup();
  assert.throws(() => createDerivativeDemoLedgerBridge({
    simulator, accountId: "live-account", sessionId: "demo-fo-x"
  }), /DERIVATIVE_DEMO_SCOPE_REQUIRED/);
  const request = {
    instrumentKey: fixture.data.futures.instrumentKey, side: "BUY",
    orderType: "LIMIT", lots: 1, limitPricePaise: 2500050,
    idempotencyKey: "future-limit-0001"
  };
  bridge.submit(request);
  assert.throws(() => bridge.submit({ ...request, lots: 2 }), /IDEMPOTENCY_KEY_REUSE_MISMATCH/);
  assert.equal(bridge.snapshot().orders.length, 1);
  assert.equal(bridge.snapshot().account.ledgerReconciled, false);
});
