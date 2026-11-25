import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { createPaperDemoLedgerSession } from "../../markets/shared/paper-demo-ledger-session.mjs";
import { replayPaperDemoEvents } from "../../markets/shared/paper-demo-event-ledger.mjs";
import { createEquityDemoLedgerBridge } from "../../markets/stocks/demo-equity-ledger-bridge.mjs";
import { createDerivativeDemoLedgerBridge } from "../../markets/stocks/demo-derivative-ledger-bridge.mjs";

const require = createRequire(import.meta.url);
const { createEquityDemoExecutionEngine } = require("../lib/equity-demo-execution-engine.js");
const { createDerivativeMockSimulator } = require("../../markets/stocks/derivative-mock-simulator.js");
const root = new URL("../../", import.meta.url);
const json = async path => JSON.parse(await readFile(new URL(path, root), "utf8"));

test("Equity, Futures and Options bridges append to one account-scoped ordered ledger", async () => {
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
  equity.submitOrder({
    instrumentKey: equityFixture.data.instrument.instrumentKey,
    side: "BUY", orderType: "MARKET", product: "DELIVERY",
    quantity: 1, idempotencyKey: "shared-equity-0001"
  });

  const snapshot = shared.ledger.snapshot();
  assert.equal(equity.snapshot().events.length, derivatives.snapshot().events.length);
  assert.equal(equity.snapshot().account.sessionId, derivatives.snapshot().account.sessionId);
  assert.equal(snapshot.account.accountId, account.accountId);
  assert.ok(snapshot.events.some(event => event.engine === "FUTURES"));
  assert.ok(snapshot.events.some(event => event.engine === "EQUITY"));
  assert.ok(snapshot.events.every((event, index) => event.sequence === index + 1));
  assert.ok(snapshot.events.every((event, index, all) => index === 0 || Date.parse(event.occurredAt) >= Date.parse(all[index - 1].occurredAt)));
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


test("actual Equity, Futures and Options fills replay in the same shared session", async () => {
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
  let timestamp = Date.parse(derivativeFixture.asOf);
  const nextTimestamp = () => ++timestamp;
  const equity = createEquityDemoLedgerBridge({ engine: equityEngine, ...shared, nextTimestamp });
  const derivatives = createDerivativeDemoLedgerBridge({
    simulator: derivativeSimulator, ...shared, nextTimestamp
  });

  const future = derivativeFixture.data.futures.instrumentKey;
  const option = derivativeFixture.data.options.instrumentKey;
  const futureResult = derivatives.submit({
    instrumentKey: future, side: "BUY", orderType: "MARKET", lots: 1,
    product: "INTRADAY", idempotencyKey: "shared-fill-future-01"
  });
  const optionResult = derivatives.submit({
    instrumentKey: option, side: "BUY", orderType: "MARKET", lots: 1,
    idempotencyKey: "shared-fill-option-01"
  });
  const equityResult = equity.submitOrder({
    instrumentKey: equityFixture.data.instrument.instrumentKey,
    side: "BUY", orderType: "MARKET", product: "DELIVERY",
    quantity: 1, idempotencyKey: "shared-fill-equity-01"
  });
  assert.equal(futureResult.order.status, "FILLED");
  assert.equal(optionResult.order.status, "FILLED");
  assert.equal(equity.matchNext(equityResult.order.orderId, {
    executionId: "shared-fill-equity-exec-01"
  }).matched, true);

  const snapshot = shared.ledger.snapshot();
  const fills = snapshot.events.filter(event => event.type === "FILL_RECORDED");
  assert.deepEqual(new Set(fills.map(event => event.engine)), new Set(["EQUITY", "FUTURES", "OPTIONS"]));
  assert.equal(fills.length, 3);
  assert.ok(fills.filter(event => event.engine !== "EQUITY").every(event =>
    event.deltas.cashDeltaPaise === 0 && event.deltas.blockedDeltaPaise === 0
  ));
  assert.ok(snapshot.events.every((event, index) => event.sequence === index + 1));
  assert.ok(snapshot.events.every((event, index, all) =>
    index === 0 || Date.parse(event.occurredAt) > Date.parse(all[index - 1].occurredAt)
  ));
  assert.equal(snapshot.account.ledgerReconciled, false);
  assert.deepEqual(replayPaperDemoEvents({
    accountId: account.accountId, sessionId: shared.sessionId,
    cashBalancePaise: account.cashBalancePaise, blockedFundsPaise: account.blockedFundsPaise
  }, snapshot.events), snapshot);
});
