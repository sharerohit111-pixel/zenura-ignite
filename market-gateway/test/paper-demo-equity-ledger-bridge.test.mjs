import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { createEquityDemoLedgerBridge } from "../../markets/stocks/demo-equity-ledger-bridge.mjs";
import { replayPaperDemoEvents } from "../../markets/shared/paper-demo-event-ledger.mjs";

const require = createRequire(import.meta.url);
const { createEquityDemoExecutionEngine } = require("../lib/equity-demo-execution-engine.js");
const root = new URL("../../", import.meta.url);
const json = async path => JSON.parse(await readFile(new URL(path, root), "utf8"));
async function setup(accountPatch = {}) {
  const [fixture, envelope] = await Promise.all([
    json("market-gateway/mock/fixtures/equity-execution.json"),
    json("market-gateway/mock/fixtures/account.json")
  ]);
  const account = { ...envelope.data, ...accountPatch };
  const engine = createEquityDemoExecutionEngine({ fixture, account, env: { NODE_ENV: "test" } });
  let now = Date.parse("2026-11-25T09:30:00+05:30");
  const bridge = createEquityDemoLedgerBridge({
    engine, accountId: account.accountId, sessionId: "demo-session-equity-test",
    clock: () => now++
  });
  return { bridge, instrumentKey: fixture.data.instrument.instrumentKey, account };
}

test("BUY order, partial fills and completion project once into the canonical ledger", async () => {
  const { bridge, instrumentKey, account } = await setup();
  const request = {
    instrumentKey, side: "BUY", orderType: "MARKET", product: "DELIVERY",
    quantity: 3, idempotencyKey: "equity-buy-0001"
  };
  const first = bridge.submitOrder(request);
  const retry = bridge.submitOrder(request);
  assert.equal(retry.order.orderId, first.order.orderId);
  assert.equal(bridge.snapshot().orders.length, 1);
  assert.equal(bridge.snapshot().account.blockedFundsPaise, first.order.reservedCashPaise);

  const fill1 = bridge.matchNext(first.order.orderId, { executionId: "equity-exec-0001" });
  assert.equal(fill1.matched, true);
  assert.equal(bridge.snapshot().orders[0].status, "PARTIALLY_FILLED");
  assert.equal(bridge.snapshot().positions[0].quantity, 2);
  assert.equal(bridge.snapshot().positions[0].costBasisPaise, 250100);
  assert.equal(bridge.snapshot().account.cashBalancePaise, account.cashBalancePaise - 250100);

  const fill2 = bridge.matchNext(first.order.orderId, { executionId: "equity-exec-0002" });
  assert.equal(fill2.matched, true);
  const snapshot = bridge.snapshot();
  assert.equal(snapshot.orders[0].status, "FILLED");
  assert.equal(snapshot.positions[0].quantity, 3);
  assert.equal(snapshot.positions[0].costBasisPaise, 375200);
  assert.equal(snapshot.positions[0].averagePricePaise, Math.round(375200 / 3));
  assert.equal(snapshot.account.blockedFundsPaise, 0);
  assert.equal(snapshot.account.ledgerReconciled, false);
  assert.deepEqual(replayPaperDemoEvents({
    accountId: account.accountId, sessionId: "demo-session-equity-test",
    cashBalancePaise: account.cashBalancePaise, blockedFundsPaise: account.blockedFundsPaise
  }, snapshot.events), snapshot);
});

test("SELL partial fill and cancellation release share reservation and retain realized P&L", async () => {
  const instrumentKey = "MOCK|NSE|EQ|0001";
  const { bridge, account } = await setup({
    positions: {
      [instrumentKey]: { quantity: 5, costBasisPaise: 500000, averagePricePaise: 100000, reservedQuantity: 0 }
    }
  });
  const seeded = bridge.snapshot();
  assert.equal(seeded.positions[0].quantity, 5);
  const order = bridge.submitOrder({
    instrumentKey, side: "SELL", orderType: "LIMIT", product: "DELIVERY",
    quantity: 3, limitPricePaise: 100000, idempotencyKey: "equity-sell-0001"
  }).order;
  assert.equal(bridge.snapshot().positions[0].reservedQuantity, 3);

  const fill = bridge.matchNext(order.orderId, { executionId: "equity-sell-fill-0001" });
  assert.equal(fill.matched, true);
  assert.equal(bridge.snapshot().positions[0].quantity, 3);
  assert.equal(bridge.snapshot().positions[0].reservedQuantity, 1);
  assert.equal(bridge.snapshot().positions[0].costBasisPaise, 300000);
  assert.equal(bridge.snapshot().account.realizedPnlPaise, 49900);

  const cancelled = bridge.cancelOrder(order.orderId);
  assert.equal(cancelled.cancelled, true);
  const snapshot = bridge.snapshot();
  assert.equal(snapshot.orders[0].status, "CANCELLED");
  assert.equal(snapshot.positions[0].reservedQuantity, 0);
  assert.equal(snapshot.positions[0].quantity, 3);
  assert.equal(snapshot.account.cashBalancePaise, account.cashBalancePaise + 249900);
  assert.equal(snapshot.account.ledgerReconciled, false);
});

test("bridge refuses a non-MOCK engine scope and does not touch production paths", async () => {
  const { bridge } = await setup();
  assert.throws(() => createEquityDemoLedgerBridge({
    engine: bridge, accountId: "live-account-1", sessionId: "demo-session-x"
  }), /EQUITY_DEMO_SCOPE_REQUIRED/);
});


test("valid but unaffordable BUY requests produce one rejected order event without reserving cash", async () => {
  const { bridge, instrumentKey, account } = await setup({ startingCapitalPaise: 1000, cashBalancePaise: 1000 });
  const request = {
    instrumentKey, side: "BUY", orderType: "MARKET", product: "DELIVERY",
    quantity: 1, idempotencyKey: "equity-reject-0001"
  };
  assert.throws(() => bridge.submitOrder(request), /INSUFFICIENT_DEMO_CASH/);
  assert.throws(() => bridge.submitOrder(request), /INSUFFICIENT_DEMO_CASH/);
  const snapshot = bridge.snapshot();
  assert.equal(snapshot.orders.length, 1);
  assert.equal(snapshot.orders[0].status, "REJECTED");
  assert.equal(snapshot.events.filter(event => event.type === "ORDER_REJECTED").length, 1);
  assert.equal(snapshot.account.cashBalancePaise, account.cashBalancePaise);
  assert.equal(snapshot.account.blockedFundsPaise, 0);
  assert.equal(snapshot.account.ledgerReconciled, false);
});
