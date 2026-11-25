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

test("BUY orders fail closed before engine mutation when no authoritative wallet receipt path exists", async () => {
  const { bridge, instrumentKey, account } = await setup();
  const request = {
    instrumentKey, side: "BUY", orderType: "MARKET", product: "DELIVERY",
    quantity: 3, idempotencyKey: "equity-buy-0001"
  };
  assert.throws(() => bridge.submitOrder(request), /EQUITY_WALLET_RECEIPT_GATE_CLOSED/);
  assert.throws(() => bridge.submitOrder(request), /EQUITY_WALLET_RECEIPT_GATE_CLOSED/);
  const snapshot = bridge.snapshot();
  assert.equal(snapshot.orders.length, 0);
  assert.equal(bridge.engineSnapshot().orders.length, 0);
  assert.equal(snapshot.account.cashBalancePaise, account.cashBalancePaise);
  assert.equal(snapshot.account.blockedFundsPaise, 0);
  assert.equal(snapshot.account.ledgerReconciled, false);
});

test("SELL orders fail closed before engine mutation when no authoritative settlement receipt path exists", async () => {
  const instrumentKey = "MOCK|NSE|EQ|0001";
  const { bridge, account } = await setup({
    positions: {
      [instrumentKey]: { quantity: 5, costBasisPaise: 500000, averagePricePaise: 100000, reservedQuantity: 0 }
    }
  });
  assert.equal(bridge.snapshot().positions[0].quantity, 5);
  assert.throws(() => bridge.submitOrder({
    instrumentKey, side: "SELL", orderType: "LIMIT", product: "DELIVERY",
    quantity: 3, limitPricePaise: 100000, idempotencyKey: "equity-sell-0001"
  }), /EQUITY_WALLET_RECEIPT_GATE_CLOSED/);
  assert.equal(bridge.snapshot().positions[0].quantity, 5);
  assert.equal(bridge.snapshot().positions[0].reservedQuantity, 0);
  assert.equal(bridge.engineSnapshot().orders.length, 0);
  assert.equal(bridge.snapshot().account.cashBalancePaise, account.cashBalancePaise);
  assert.equal(bridge.snapshot().account.ledgerReconciled, false);
});

test("bridge refuses a non-MOCK engine scope and does not touch production paths", async () => {
  const { bridge } = await setup();
  assert.throws(() => createEquityDemoLedgerBridge({
    engine: bridge, accountId: "live-account-1", sessionId: "demo-session-x"
  }), /EQUITY_DEMO_SCOPE_REQUIRED/);
});


test("unaffordable BUY also fails closed before the engine can create a rejected order", async () => {
  const { bridge, instrumentKey, account } = await setup({ startingCapitalPaise: 1000, cashBalancePaise: 1000 });
  const request = {
    instrumentKey, side: "BUY", orderType: "MARKET", product: "DELIVERY",
    quantity: 1, idempotencyKey: "equity-reject-0001"
  };
  assert.throws(() => bridge.submitOrder(request), /EQUITY_WALLET_RECEIPT_GATE_CLOSED/);
  const snapshot = bridge.snapshot();
  assert.equal(snapshot.orders.length, 0);
  assert.equal(bridge.engineSnapshot().orders.length, 0);
  assert.equal(snapshot.account.cashBalancePaise, account.cashBalancePaise);
  assert.equal(snapshot.account.blockedFundsPaise, 0);
  assert.equal(snapshot.account.ledgerReconciled, false);
});
