import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { createPaperDemoLedgerSession, getSharedPaperDemoLedgerSession } from "../../markets/shared/paper-demo-ledger-session.mjs";
import { replayPaperDemoEvents } from "../../markets/shared/paper-demo-event-ledger.mjs";
import { createEquityDemoLedgerBridge } from "../../markets/stocks/demo-equity-ledger-bridge.mjs";
import { createDerivativeDemoLedgerBridge } from "../../markets/stocks/demo-derivative-ledger-bridge.mjs";

const require = createRequire(import.meta.url);
const { createEquityDemoExecutionEngine } = require("../lib/equity-demo-execution-engine.js");
const { createDerivativeMockSimulator } = require("../../markets/stocks/derivative-mock-simulator.js");
const root = new URL("../../", import.meta.url);
const json = async path => JSON.parse(await readFile(new URL(path, root), "utf8"));

test("Equity, Futures and Options bridges append orders, fills and positions to one account-scoped ordered ledger", async () => {
  const [accountEnvelope, equityFixture, derivativeFixture] = await Promise.all([
    json("market-gateway/mock/fixtures/account.json"),
    json("market-gateway/mock/fixtures/equity-execution.json"),
    json("market-gateway/mock/fixtures/derivatives.json")
  ]);
  const account = accountEnvelope.data;
  const shared = createPaperDemoLedgerSession({
    accountId: account.accountId,
    cashBalancePaise: account.cashBalancePaise,
    blockedFundsPaise: account.blockedFundsPaise
  });
  const equityEngine = createEquityDemoExecutionEngine({
    fixture: equityFixture, account, env: { NODE_ENV: "test" }
  });
  const derivativeSimulator = createDerivativeMockSimulator(derivativeFixture, {
    now: Date.parse(derivativeFixture.asOf)
  });
  const equity = createEquityDemoLedgerBridge({ engine: equityEngine, ...shared });
  const derivatives = createDerivativeDemoLedgerBridge({ simulator: derivativeSimulator, ...shared });

  const future = derivativeFixture.data.futures.instrumentKey;
  derivatives.submit({
    instrumentKey: future, side: "BUY", orderType: "MARKET", lots: 1,
    product: "INTRADAY", idempotencyKey: "shared-future-0001"
  });
  const option = derivativeFixture.data.options.instrumentKey;
  derivatives.submit({
    instrumentKey: option, side: "BUY", orderType: "MARKET", lots: 1,
    idempotencyKey: "shared-option-0001"
  });
  const equityOrder = equity.submitOrder({
    instrumentKey: equityFixture.data.instrument.instrumentKey,
    side: "BUY", orderType: "MARKET", product: "DELIVERY",
    quantity: 1, idempotencyKey: "shared-equity-0001"
  });
  const equityFill = equity.matchNext(equityOrder.order.orderId, {
    executionId: "shared-equity-fill-0001"
  });
  assert.equal(equityFill.matched, true);

  const snapshot = shared.ledger.snapshot();
  assert.equal(equity.snapshot().events.length, derivatives.snapshot().events.length);
  assert.equal(equity.snapshot().account.sessionId, derivatives.snapshot().account.sessionId);
  assert.equal(snapshot.account.accountId, account.accountId);
  assert.deepEqual(new Set(snapshot.events.map(event => event.engine)), new Set(["EQUITY", "FUTURES", "OPTIONS"]));
  assert.ok(snapshot.events.every((event, index) => event.sequence === index + 1));
  assert.ok(snapshot.events.every((event, index, all) => index === 0 || Date.parse(event.occurredAt) >= Date.parse(all[index - 1].occurredAt)));

  assert.equal(snapshot.orders.length, 3);
  assert.ok(snapshot.orders.every(order => order.status === "FILLED"));
  assert.deepEqual(new Set(snapshot.orders.map(order => order.assetClass)), new Set(["EQUITY", "FUTURE", "OPTION"]));
  assert.equal(snapshot.fills.length, 3);
  assert.deepEqual(new Set(snapshot.fills.map(fill => fill.assetClass)), new Set(["EQUITY", "FUTURE", "OPTION"]));
  assert.deepEqual(new Set(snapshot.positions.filter(position => position.quantity !== 0).map(position => position.assetClass)),
    new Set(["EQUITY", "FUTURE", "OPTION"]));

  assert.equal(snapshot.account.ledgerReconciled, false);
  assert.deepEqual(replayPaperDemoEvents({
    accountId: account.accountId, sessionId: shared.sessionId,
    cashBalancePaise: account.cashBalancePaise, blockedFundsPaise: account.blockedFundsPaise
  }, snapshot.events), snapshot);
});

test("shared Demo ledger session rejects a different account or opening balance", () => {
  const session = createPaperDemoLedgerSession({
    accountId: "mock-session-test", cashBalancePaise: 10000, blockedFundsPaise: 0
  });
  assert.throws(() => createPaperDemoLedgerSession({
    accountId: "live-session-test", cashBalancePaise: 10000, blockedFundsPaise: 0
  }), /INVALID_SHARED_DEMO_LEDGER_SESSION/);
  assert.equal(session.ledger.snapshot().account.accountId, "mock-session-test");
});


test("module shared session is stable for one account and fails closed on account or opening-balance switches", () => {
  const opening = { accountId: "mock-global-session-test", cashBalancePaise: 50000, blockedFundsPaise: 5000 };
  const first = getSharedPaperDemoLedgerSession(opening);
  const repeated = getSharedPaperDemoLedgerSession(opening);
  assert.equal(repeated, first);
  assert.equal(repeated.sessionId, first.sessionId);
  assert.throws(() => getSharedPaperDemoLedgerSession({
    ...opening, accountId: "mock-other-global-session"
  }), /DEMO_LEDGER_SESSION_SCOPE_MISMATCH/);
  assert.throws(() => getSharedPaperDemoLedgerSession({
    ...opening, cashBalancePaise: 60000
  }), /DEMO_LEDGER_SESSION_SCOPE_MISMATCH/);
  assert.equal(getSharedPaperDemoLedgerSession(opening), first);
});
