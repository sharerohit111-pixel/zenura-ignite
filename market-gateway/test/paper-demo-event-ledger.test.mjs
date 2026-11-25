import test from "node:test";
import assert from "node:assert/strict";
import { createPaperDemoEventLedger, replayPaperDemoEvents } from "../../markets/shared/paper-demo-event-ledger.mjs";

const opening = { accountId: "mock-account-user-a", sessionId: "demo-session-a", cashBalancePaise: 100000000, blockedFundsPaise: 0 };
function event(overrides = {}) {
  return {
    eventId: "evt-1", idempotencyKey: "idem-1", sourceEventId: "equity-order-1",
    accountId: opening.accountId, sessionId: opening.sessionId,
    occurredAt: "2026-11-25T09:30:00+05:30", engine: "EQUITY", type: "ORDER_ACCEPTED",
    deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 10000 },
    payload: { orderId: "order-1", assetClass: "EQUITY", instrumentKey: "MOCK|NSE|EQ|0001", side: "BUY", orderType: "LIMIT", quantity: 2, status: "PENDING" },
    ...overrides
  };
}
test("opening snapshot derives available cash and never claims reconciliation", () => {
  const snapshot = createPaperDemoEventLedger(opening).snapshot();
  assert.equal(snapshot.account.cashBalancePaise, 100000000);
  assert.equal(snapshot.account.blockedFundsPaise, 0);
  assert.equal(snapshot.account.availableFundsPaise, 100000000);
  assert.equal(snapshot.account.ledgerReconciled, false);
});
test("cross-engine events share one ordered immutable event stream", () => {
  const ledger = createPaperDemoEventLedger(opening);
  ledger.append(event());
  ledger.append(event({
    eventId: "evt-2", idempotencyKey: "idem-2", sourceEventId: "futures-order-1",
    engine: "FUTURES", type: "ORDER_ACCEPTED", occurredAt: "2026-11-25T09:30:01+05:30",
    payload: { orderId: "future-1", assetClass: "FUTURE", instrumentKey: "MOCK|NSE|FUT|NIFTY-2026-11", side: "BUY", orderType: "MARKET", quantity: 1, status: "PENDING" },
    deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 20000 }
  }));
  const snapshot = ledger.snapshot();
  assert.deepEqual(snapshot.events.map(x => [x.sequence, x.engine]), [[1, "EQUITY"], [2, "FUTURES"]]);
  assert.equal(snapshot.account.blockedFundsPaise, 30000);
  assert.equal(snapshot.account.availableFundsPaise, 99970000);
  assert.ok(Object.isFrozen(snapshot.events[0]));
  assert.ok(Object.isFrozen(snapshot.events));
});
test("idempotent retries return the original event without double reserving cash", () => {
  const ledger = createPaperDemoEventLedger(opening), input = event();
  assert.equal(ledger.append(input).accepted, true);
  const retry = ledger.append(input);
  assert.equal(retry.accepted, false);
  assert.equal(retry.duplicate, true);
  assert.equal(retry.snapshot.events.length, 1);
  assert.equal(retry.snapshot.account.blockedFundsPaise, 10000);
  assert.throws(() => ledger.append(event({ deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 20000 } })), /IDEMPOTENCY_KEY_REUSE_MISMATCH/);
});
test("fill must refer to an accepted order from the same engine and instrument", () => {
  const ledger = createPaperDemoEventLedger(opening);
  assert.throws(() => ledger.append(event({
    type: "FILL_RECORDED", payload: { fillId: "fill-1", orderId: "missing", assetClass: "EQUITY", instrumentKey: "MOCK|NSE|EQ|0001", side: "BUY", quantity: 1, pricePaise: 125050 },
    deltas: { cashDeltaPaise: -125050, blockedDeltaPaise: -10000 }
  })), /FILL_ORDER_MISMATCH/);
  assert.equal(ledger.snapshot().events.length, 0);
  assert.equal(ledger.snapshot().account.cashBalancePaise, opening.cashBalancePaise);
});
test("cash and reservation invariants reject negative cash, negative blocks and overspending", () => {
  const ledger = createPaperDemoEventLedger(opening);
  assert.throws(() => ledger.append(event({ deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 100000001 } })), /DEMO_CASH_RESERVATION_INVARIANT/);
  assert.throws(() => ledger.append(event({ eventId: "evt-2", idempotencyKey: "idem-2", sourceEventId: "cancel", deltas: { cashDeltaPaise: 0, blockedDeltaPaise: -1 } })), /DEMO_CASH_RESERVATION_INVARIANT/);
  assert.equal(ledger.snapshot().events.length, 0);
});
test("positions aggregate by asset class and MOCK instrument; realized P&L is projected", () => {
  const ledger = createPaperDemoEventLedger(opening);
  ledger.append(event({ type: "POSITION_CHANGED", deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 0 },
    payload: { assetClass: "OPTION", instrumentKey: "MOCK|NSE|OPT|NIFTY-CE-26000", quantityDelta: 50, realizedPnlDeltaPaise: 1250 } }));
  const snapshot = ledger.snapshot();
  assert.equal(snapshot.positions[0].quantity, 50);
  assert.equal(snapshot.positions[0].realizedPnlPaise, 1250);
  assert.equal(snapshot.account.realizedPnlPaise, 1250);
});
test("session and account boundaries reject cross-user events", () => {
  const ledger = createPaperDemoEventLedger(opening);
  assert.throws(() => ledger.append(event({ accountId: "mock-account-user-b" })), /DEMO_EVENT_SCOPE_MISMATCH/);
  assert.throws(() => ledger.append(event({ sessionId: "demo-session-b" })), /DEMO_EVENT_SCOPE_MISMATCH/);
  assert.equal(ledger.snapshot().events.length, 0);
});
test("event replay is deterministic and validates the original sequence", () => {
  const ledger = createPaperDemoEventLedger(opening);
  ledger.append(event());
  ledger.append(event({ eventId: "evt-2", idempotencyKey: "idem-2", sourceEventId: "equity-fill-1",
    type: "FILL_RECORDED", occurredAt: "2026-11-25T09:30:01+05:30",
    deltas: { cashDeltaPaise: -125050, blockedDeltaPaise: -10000 },
    payload: { fillId: "fill-1", orderId: "order-1", assetClass: "EQUITY", instrumentKey: "MOCK|NSE|EQ|0001", side: "BUY", quantity: 1, pricePaise: 125050 } }));
  const original = ledger.snapshot();
  const replayed = replayPaperDemoEvents(opening, original.events);
  assert.deepEqual(replayed, original);
  assert.throws(() => replayPaperDemoEvents(opening, original.events.map((x, i) => ({ ...x, sequence: i + 2 }))), /DEMO_EVENT_SEQUENCE_MISMATCH/);
});
test("rejects live symbols, mismatched engine asset classes and out-of-order timestamps", () => {
  const ledger = createPaperDemoEventLedger(opening);
  assert.throws(() => ledger.append(event({ payload: { ...event().payload, instrumentKey: "NSE|RELIANCE" } })), /INVALID_ORDER_EVENT/);
  assert.throws(() => ledger.append(event({ engine: "OPTIONS" })), /ENGINE_ASSET_MISMATCH/);
  ledger.append(event());
  assert.throws(() => ledger.append(event({ eventId: "evt-2", idempotencyKey: "idem-2", sourceEventId: "later", occurredAt: "2026-11-25T09:29:59+05:30" })), /DEMO_EVENT_TIME_ORDER_MISMATCH/);
});

test("source event identity cannot be replayed under a different event or idempotency key", () => {
  const ledger = createPaperDemoEventLedger(opening);
  ledger.append(event());
  assert.throws(() => ledger.append(event({
    eventId: "evt-2", idempotencyKey: "idem-2"
  })), /DUPLICATE_SOURCE_EVENT/);
});
test("order updates cannot mutate the original order identity", () => {
  const ledger = createPaperDemoEventLedger(opening);
  ledger.append(event());
  assert.throws(() => ledger.append(event({
    eventId: "evt-2", idempotencyKey: "idem-2", sourceEventId: "update-1",
    type: "ORDER_UPDATED", occurredAt: "2026-11-25T09:30:01+05:30",
    deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 0 },
    payload: { ...event().payload, quantity: 3, status: "PARTIALLY_FILLED" }
  })), /ORDER_IDENTITY_MUTATION/);
});
test("fill quantity cannot exceed the accepted order quantity", () => {
  const ledger = createPaperDemoEventLedger(opening);
  ledger.append(event());
  assert.throws(() => ledger.append(event({
    eventId: "evt-2", idempotencyKey: "idem-2", sourceEventId: "fill-oversized",
    type: "FILL_RECORDED", occurredAt: "2026-11-25T09:30:01+05:30",
    deltas: { cashDeltaPaise: -125050, blockedDeltaPaise: -10000 },
    payload: { fillId: "fill-1", orderId: "order-1", assetClass: "EQUITY", instrumentKey: "MOCK|NSE|EQ|0001", side: "BUY", quantity: 3, pricePaise: 125050 }
  })), /FILL_QUANTITY_EXCEEDS_ORDER/);
});
