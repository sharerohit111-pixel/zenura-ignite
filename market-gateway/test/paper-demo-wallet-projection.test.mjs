import test from "node:test";
import assert from "node:assert/strict";
import { createPaperDemoEventLedger } from "../../markets/shared/paper-demo-event-ledger.mjs";
import { projectPaperDemoWallet } from "../../markets/shared/paper-demo-wallet-projection.mjs";

const opening = {
  accountId: "mock-account-user-a",
  sessionId: "demo-session-a",
  cashBalancePaise: 100000000,
  blockedFundsPaise: 0
};
const at = "2026-11-25T09:30:00+05:30";
function addEvent(ledger, overrides = {}) {
  const sequence = ledger.snapshot().events.length + 1;
  const base = {
    eventId: "evt-" + sequence,
    idempotencyKey: "idem-" + sequence,
    sourceEventId: "source-" + sequence,
    accountId: opening.accountId,
    sessionId: opening.sessionId,
    occurredAt: "2026-11-25T09:30:" + String(sequence - 1).padStart(2, "0") + "+05:30",
    engine: "EQUITY",
    type: "ORDER_ACCEPTED",
    deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 10000 },
    payload: {
      orderId: "order-" + sequence,
      assetClass: "EQUITY",
      instrumentKey: "MOCK|NSE|EQ|0001",
      side: "BUY",
      orderType: "LIMIT",
      quantity: 2,
      status: "PENDING"
    }
  };
  return ledger.append({ ...base, ...overrides });
}

test("wallet is a read-only projection of canonical account, order, fill and position state", () => {
  const ledger = createPaperDemoEventLedger(opening);
  addEvent(ledger);
  ledger.append({
    eventId: "evt-fill-1", idempotencyKey: "idem-fill-1", sourceEventId: "source-fill-1",
    accountId: opening.accountId, sessionId: opening.sessionId,
    occurredAt: "2026-11-25T09:30:01+05:30", engine: "EQUITY", type: "FILL_RECORDED",
    deltas: { cashDeltaPaise: -250100, blockedDeltaPaise: -10000 },
    payload: {
      fillId: "fill-1", orderId: "order-1", assetClass: "EQUITY",
      instrumentKey: "MOCK|NSE|EQ|0001", side: "BUY", quantity: 2, pricePaise: 125050
    }
  });
  ledger.append({
    eventId: "evt-position-1", idempotencyKey: "idem-position-1", sourceEventId: "source-position-1",
    accountId: opening.accountId, sessionId: opening.sessionId,
    occurredAt: "2026-11-25T09:30:02+05:30", engine: "EQUITY", type: "POSITION_CHANGED",
    deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 0 },
    payload: {
      assetClass: "EQUITY", instrumentKey: "MOCK|NSE|EQ|0001",
      quantityDelta: 2, costBasisDeltaPaise: 250100, realizedPnlDeltaPaise: 0
    }
  });

  const source = ledger.snapshot();
  const before = JSON.stringify(source);
  const wallet = projectPaperDemoWallet(source);
  assert.equal(wallet.account.cashBalancePaise, 99749900);
  assert.equal(wallet.account.blockedFundsPaise, 0);
  assert.equal(wallet.account.availableFundsPaise, 99749900);
  assert.equal(wallet.orders[0].status, "FILLED");
  assert.equal(wallet.fills[0].fillId, "fill-1");
  assert.equal(wallet.positions[0].quantity, 2);
  assert.equal(wallet.eventCount, 3);
  assert.equal(wallet.lastSequence, 3);
  assert.equal(wallet.account.ledgerReconciled, false);
  assert.equal(JSON.stringify(source), before);
  assert.ok(Object.isFrozen(wallet));
  assert.ok(Object.isFrozen(wallet.orders));
});

test("wallet never creates a second event store or mutates the canonical ledger", () => {
  const ledger = createPaperDemoEventLedger(opening);
  const before = ledger.snapshot();
  const wallet = projectPaperDemoWallet(before);
  assert.deepEqual(wallet.orders, []);
  assert.deepEqual(wallet.fills, []);
  assert.deepEqual(wallet.positions, []);
  assert.equal(wallet.eventCount, 0);
  assert.equal(ledger.snapshot().events.length, 0);
  assert.throws(() => { wallet.account.cashBalancePaise = 1; }, TypeError);
  assert.equal(ledger.snapshot().account.cashBalancePaise, opening.cashBalancePaise);
});

test("wallet refuses inconsistent cash, blocked funds and available cash", () => {
  const ledger = createPaperDemoEventLedger(opening);
  const source = ledger.snapshot();
  assert.throws(() => projectPaperDemoWallet({
    ...source, account: { ...source.account, availableFundsPaise: 1 }
  }), /CANONICAL_WALLET_BALANCE_INVARIANT/);
  assert.throws(() => projectPaperDemoWallet({
    ...source, account: { ...source.account, blockedFundsPaise: source.account.cashBalancePaise + 1 }
  }), /CANONICAL_WALLET_BALANCE_INVARIANT/);
});

test("wallet refuses malformed event sequence, cross-session events and duplicate fills", () => {
  const ledger = createPaperDemoEventLedger(opening);
  addEvent(ledger);
  const source = ledger.snapshot();
  assert.throws(() => projectPaperDemoWallet({
    ...source, events: source.events.map(event => ({ ...event, sequence: 9 }))
  }), /CANONICAL_WALLET_EVENT_STREAM_INVALID/);
  assert.throws(() => projectPaperDemoWallet({
    ...source, events: source.events.map(event => ({ ...event, sessionId: "other-session" }))
  }), /CANONICAL_WALLET_EVENT_STREAM_INVALID/);
  const fill = {
    fillId: "fill-1", orderId: "order-1", quantity: 1, pricePaise: 10,
    occurredAt: at
  };
  assert.throws(() => projectPaperDemoWallet({
    ...source, fills: [fill, fill]
  }), /CANONICAL_WALLET_FILL_PROJECTION_INVALID/);
});

test("wallet refuses orphan fills and malformed order quantity projections", () => {
  const ledger = createPaperDemoEventLedger(opening);
  addEvent(ledger);
  const source = ledger.snapshot();
  assert.throws(() => projectPaperDemoWallet({
    ...source, fills: [{
      fillId: "orphan", orderId: "missing", quantity: 1, pricePaise: 10, occurredAt: at
    }]
  }), /CANONICAL_WALLET_FILL_PROJECTION_INVALID/);
  assert.throws(() => projectPaperDemoWallet({
    ...source, orders: [{ ...source.orders[0], filledQuantity: 1, remainingQuantity: 2 }]
  }), /CANONICAL_WALLET_ORDER_PROJECTION_INVALID/);
});

test("wallet refuses invalid position reservations and keeps reconciliation false", () => {
  const ledger = createPaperDemoEventLedger(opening);
  const source = ledger.snapshot();
  const position = {
    key: "EQUITY|MOCK|NSE|EQ|0001|DELIVERY", quantity: 1, reservedQuantity: 2,
    costBasisPaise: 100, averagePricePaise: 100, realizedPnlPaise: 0
  };
  assert.throws(() => projectPaperDemoWallet({
    ...source, positions: [position]
  }), /CANONICAL_WALLET_POSITION_PROJECTION_INVALID/);
  const wallet = projectPaperDemoWallet(source);
  assert.equal(wallet.account.ledgerReconciled, false);
});
