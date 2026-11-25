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
    deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 0 }
  }));
  const snapshot = ledger.snapshot();
  assert.deepEqual(snapshot.events.map(x => [x.sequence, x.engine]), [[1, "EQUITY"], [2, "FUTURES"]]);
  assert.equal(snapshot.account.blockedFundsPaise, 10000);
  assert.equal(snapshot.account.availableFundsPaise, 99990000);
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
    type: "FILL_RECORDED", payload: { fillId: "fill-1", orderId: "missing", assetClass: "EQUITY", instrumentKey: "MOCK|NSE|EQ|0001", side: "BUY", quantity: 1, pricePaise: 125050, grossPaise: 125050 },
    deltas: { cashDeltaPaise: -125050, blockedDeltaPaise: 0 }
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
  ledger.append(event({ engine: "OPTIONS", type: "POSITION_CHANGED", deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 0 },
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
    payload: { fillId: "fill-1", orderId: "order-1", assetClass: "EQUITY", instrumentKey: "MOCK|NSE|EQ|0001", side: "BUY", quantity: 1, pricePaise: 125050, grossPaise: 125050 } }));
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
    deltas: { cashDeltaPaise: -375150, blockedDeltaPaise: -10000 },
    payload: { fillId: "fill-1", orderId: "order-1", assetClass: "EQUITY", instrumentKey: "MOCK|NSE|EQ|0001", side: "BUY", quantity: 3, pricePaise: 125050, grossPaise: 375150 }
  })), /FILL_QUANTITY_EXCEEDS_ORDER/);
});


test("fill gross value must equal quantity times execution price when supplied", () => {
  const ledger = createPaperDemoEventLedger(opening);
  ledger.append(event());
  assert.throws(() => ledger.append(event({
    eventId: "evt-2", idempotencyKey: "idem-2", sourceEventId: "fill-gross-mismatch",
    type: "FILL_RECORDED", occurredAt: "2026-11-25T09:30:01+05:30",
    deltas: { cashDeltaPaise: -125050, blockedDeltaPaise: -10000 },
    payload: {
      fillId: "fill-gross-1", orderId: "order-1", assetClass: "EQUITY",
      instrumentKey: "MOCK|NSE|EQ|0001", side: "BUY", quantity: 1,
      pricePaise: 125050, grossPaise: 125049
    }
  })), /INVALID_FILL_GROSS_VALUE/);
  assert.equal(ledger.snapshot().events.length, 1);
});

test("product-aware positions keep Delivery and Intraday cost basis separate", () => {
  const ledger = createPaperDemoEventLedger(opening);
  ledger.append(event({
    type: "POSITION_CHANGED", sourceEventId: "delivery-buy", idempotencyKey: "delivery-buy-1",
    deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 0 },
    payload: { assetClass: "EQUITY", instrumentKey: "MOCK|NSE|EQ|0001", product: "DELIVERY", quantityDelta: 2, costBasisDeltaPaise: 250100, realizedPnlDeltaPaise: 0 }
  }));
  ledger.append(event({
    eventId: "evt-2", idempotencyKey: "intraday-buy-1", sourceEventId: "intraday-buy",
    type: "POSITION_CHANGED", occurredAt: "2026-11-25T09:30:01+05:30",
    deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 0 },
    payload: { assetClass: "EQUITY", instrumentKey: "MOCK|NSE|EQ|0001", product: "INTRADAY", quantityDelta: 1, costBasisDeltaPaise: 125050, realizedPnlDeltaPaise: 0 }
  }));
  const positions = ledger.snapshot().positions;
  assert.equal(positions.length, 2);
  assert.equal(positions.find(x => x.product === "DELIVERY").averagePricePaise, 125050);
  assert.equal(positions.find(x => x.product === "INTRADAY").costBasisPaise, 125050);
});

test("SELL order acceptance reserves only unreserved shares; fills release reservation", () => {
  const ledger = createPaperDemoEventLedger(opening);
  ledger.append(event({
    type: "POSITION_CHANGED", sourceEventId: "seed-position", idempotencyKey: "seed-position-1",
    deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 0 },
    payload: { assetClass: "EQUITY", instrumentKey: "MOCK|NSE|EQ|0001", product: "DELIVERY", quantityDelta: 5, costBasisDeltaPaise: 500000, realizedPnlDeltaPaise: 0 }
  }));
  ledger.append(event({
    eventId: "evt-2", idempotencyKey: "sell-order-1", sourceEventId: "sell-order",
    type: "ORDER_ACCEPTED", occurredAt: "2026-11-25T09:30:01+05:30",
    deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 0 },
    payload: { orderId: "sell-1", assetClass: "EQUITY", instrumentKey: "MOCK|NSE|EQ|0001", product: "DELIVERY", side: "SELL", orderType: "LIMIT", quantity: 3, status: "PENDING" }
  }));
  assert.equal(ledger.snapshot().positions[0].reservedQuantity, 3);
  assert.throws(() => ledger.append(event({
    eventId: "evt-3", idempotencyKey: "sell-order-2", sourceEventId: "sell-order-2",
    type: "ORDER_ACCEPTED", occurredAt: "2026-11-25T09:30:02+05:30",
    deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 0 },
    payload: { orderId: "sell-2", assetClass: "EQUITY", instrumentKey: "MOCK|NSE|EQ|0001", product: "DELIVERY", side: "SELL", orderType: "MARKET", quantity: 3, status: "PENDING" }
  })), /DEMO_SHARE_RESERVATION_INVARIANT/);
  ledger.append(event({
    eventId: "evt-3", idempotencyKey: "sell-fill-1", sourceEventId: "sell-fill",
    type: "FILL_RECORDED", occurredAt: "2026-11-25T09:30:03+05:30",
    deltas: { cashDeltaPaise: 300000, blockedDeltaPaise: 0 },
    payload: { fillId: "sell-fill-1", orderId: "sell-1", assetClass: "EQUITY", instrumentKey: "MOCK|NSE|EQ|0001", product: "DELIVERY", side: "SELL", quantity: 3, pricePaise: 100000, grossPaise: 300000 }
  }));
  ledger.append(event({
    eventId: "evt-4", idempotencyKey: "sell-position-1", sourceEventId: "sell-position",
    type: "POSITION_CHANGED", occurredAt: "2026-11-25T09:30:04+05:30",
    deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 0 },
    payload: { assetClass: "EQUITY", instrumentKey: "MOCK|NSE|EQ|0001", product: "DELIVERY", quantityDelta: -3, costBasisDeltaPaise: -300000, realizedPnlDeltaPaise: 0 }
  }));
  const snapshot = ledger.snapshot();
  assert.equal(snapshot.positions[0].quantity, 2);
  assert.equal(snapshot.positions[0].reservedQuantity, 0);
  assert.equal(snapshot.positions[0].costBasisPaise, 200000);
  assert.equal(snapshot.account.cashBalancePaise, opening.cashBalancePaise + 300000);
});

test("cancelled SELL remainder releases reserved shares without changing filled quantity", () => {
  const ledger = createPaperDemoEventLedger(opening);
  ledger.append(event({
    type: "POSITION_CHANGED", sourceEventId: "seed-position", idempotencyKey: "seed-position-1",
    deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 0 },
    payload: { assetClass: "EQUITY", instrumentKey: "MOCK|NSE|EQ|0001", product: "DELIVERY", quantityDelta: 4, costBasisDeltaPaise: 400000, realizedPnlDeltaPaise: 0 }
  }));
  ledger.append(event({
    eventId: "evt-2", idempotencyKey: "sell-order-1", sourceEventId: "sell-order",
    type: "ORDER_ACCEPTED", occurredAt: "2026-11-25T09:30:01+05:30",
    deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 0 },
    payload: { orderId: "sell-1", assetClass: "EQUITY", instrumentKey: "MOCK|NSE|EQ|0001", product: "DELIVERY", side: "SELL", orderType: "LIMIT", quantity: 3, status: "PENDING" }
  }));
  ledger.append(event({
    eventId: "evt-3", idempotencyKey: "sell-cancel-1", sourceEventId: "sell-cancel",
    type: "ORDER_UPDATED", occurredAt: "2026-11-25T09:30:02+05:30",
    deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 0 },
    payload: { orderId: "sell-1", assetClass: "EQUITY", instrumentKey: "MOCK|NSE|EQ|0001", product: "DELIVERY", side: "SELL", orderType: "LIMIT", quantity: 3, status: "CANCELLED", reservedQuantityDelta: -3 }
  }));
  assert.equal(ledger.snapshot().positions[0].reservedQuantity, 0);
  assert.equal(ledger.snapshot().orders[0].status, "CANCELLED");
});

test("product-aware cost basis cannot become negative or outlive a flat position", () => {
  const ledger = createPaperDemoEventLedger(opening);
  assert.throws(() => ledger.append(event({
    type: "POSITION_CHANGED",
    deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 0 },
    payload: { assetClass: "EQUITY", instrumentKey: "MOCK|NSE|EQ|0001", product: "DELIVERY", quantityDelta: 0, costBasisDeltaPaise: -1, realizedPnlDeltaPaise: 0 }
  })), /DEMO_POSITION_INVARIANT/);
  assert.equal(ledger.snapshot().events.length, 0);
});


test("schema 1.2.0, strict timestamps and original replay order are enforced", () => {
  const ledger = createPaperDemoEventLedger(opening);
  ledger.append(event());
  assert.equal(ledger.snapshot().events[0].schemaVersion, "1.2.0");
  assert.throws(() => ledger.append(event({ eventId: "evt-2", idempotencyKey: "idem-2", sourceEventId: "bad-time", occurredAt: "2026-11-25T09:30:01" })), /INVALID_EVENT_TIMESTAMP/);
  assert.throws(() => ledger.append(event({ eventId: "evt-2", idempotencyKey: "idem-2", sourceEventId: "old-time", occurredAt: "2026-11-25T09:30:00+05:30" })), /DEMO_EVENT_TIME_ORDER_MISMATCH/);
  const later = ledger.append(event({ eventId: "evt-2", idempotencyKey: "idem-2", sourceEventId: "later", occurredAt: "2026-11-25T09:30:01+05:30", type: "RESERVATION_CHANGED", payload: {} }));
  assert.throws(() => replayPaperDemoEvents(opening, [later.event, ...ledger.snapshot().events]), /DEMO_EVENT_SEQUENCE_MISMATCH/);
});

test("fill gross is mandatory and Equity BUY cash movement must match gross exactly", () => {
  const ledger = createPaperDemoEventLedger(opening);
  ledger.append(event());
  const fill = { eventId: "evt-2", idempotencyKey: "idem-fill", sourceEventId: "fill-source",
    accountId: opening.accountId, sessionId: opening.sessionId,
    occurredAt: "2026-11-25T09:30:01+05:30", engine: "EQUITY", type: "FILL_RECORDED",
    deltas: { cashDeltaPaise: -125050, blockedDeltaPaise: -10000 },
    payload: { fillId: "fill-buy", orderId: "order-1", assetClass: "EQUITY",
      instrumentKey: "MOCK|NSE|EQ|0001", side: "BUY", quantity: 1, pricePaise: 125050, grossPaise: 125050 } };
  assert.throws(() => ledger.append({ ...fill, payload: { ...fill.payload, grossPaise: undefined } }), /INVALID_FILL_GROSS_VALUE/);
  assert.throws(() => ledger.append({ ...fill, deltas: { ...fill.deltas, cashDeltaPaise: 125050 } }), /EQUITY_FILL_CASH_SETTLEMENT_MISMATCH/);
  assert.equal(ledger.append(fill).accepted, true);
});

test("Futures and Options cannot move cash or blocked funds without authoritative receipt support", () => {
  for (const [engine, assetClass] of [["FUTURES", "FUTURE"], ["OPTIONS", "OPTION"]]) {
    const ledger = createPaperDemoEventLedger({ ...opening, cashBalancePaise: 1000000, blockedFundsPaise: 0 });
    ledger.append(event({ engine, type: "ORDER_ACCEPTED", deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 0 },
      payload: { orderId: "fo-order", assetClass, instrumentKey: "MOCK|NSE|FO|1", side: "BUY", orderType: "MARKET", quantity: 1, status: "PENDING" } }));
    const baseFill = { eventId: "fo-fill", idempotencyKey: "fo-fill-idem", sourceEventId: "fo-fill-source",
      accountId: opening.accountId, sessionId: opening.sessionId, occurredAt: "2026-11-25T09:30:01+05:30",
      engine, type: "FILL_RECORDED", payload: { fillId: "fo-fill", orderId: "fo-order", assetClass,
        instrumentKey: "MOCK|NSE|FO|1", side: "BUY", quantity: 1, pricePaise: 100000, grossPaise: 100000 } };
    assert.throws(() => ledger.append({ ...baseFill, deltas: { cashDeltaPaise: 100000, blockedDeltaPaise: 0 } }), /DERIVATIVE_CASH_SETTLEMENT_RECEIPT_REQUIRED/);
    assert.throws(() => ledger.append({ ...baseFill, deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 1 } }), /DERIVATIVE_CASH_SETTLEMENT_RECEIPT_REQUIRED/);
    assert.equal(ledger.append({ ...baseFill, deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 0 } }).accepted, true);
  }
});

test("order statuses require matching real fill quantities and terminal states cannot reopen", () => {
  const ledger = createPaperDemoEventLedger(opening);
  ledger.append(event());
  const status = (value, n, extra = {}) => event({
    eventId: "evt-status-" + n, idempotencyKey: "idem-status-" + n, sourceEventId: "status-" + n,
    type: "ORDER_UPDATED", occurredAt: "2026-11-25T09:30:0" + (n + 1) + "+05:30",
    deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 0 },
    payload: { ...event().payload, status: value, ...extra }
  });
  assert.throws(() => ledger.append(status("PARTIALLY_FILLED", 1)), /ORDER_FILL_STATUS_MISMATCH/);
  assert.throws(() => ledger.append(status("FILLED", 1)), /ORDER_FILL_STATUS_MISMATCH/);
  ledger.append(event({ eventId: "evt-fill", idempotencyKey: "idem-fill", sourceEventId: "fill-real",
    type: "FILL_RECORDED", occurredAt: "2026-11-25T09:30:01+05:30",
    deltas: { cashDeltaPaise: -250100, blockedDeltaPaise: -10000 },
    payload: { fillId: "fill-real", orderId: "order-1", assetClass: "EQUITY", instrumentKey: "MOCK|NSE|EQ|0001",
      side: "BUY", quantity: 2, pricePaise: 125050, grossPaise: 250100 } }));
  ledger.append(status("FILLED", 2, { filledQuantity: 2, remainingQuantity: 0 }));
  assert.throws(() => ledger.append(status("PENDING", 3)), /ORDER_TERMINAL_STATE_IMMUTABLE/);
});


test("rejected SELL orders cannot reserve or release position shares", () => {
  const ledger = createPaperDemoEventLedger(opening);
  ledger.append(event({
    type: "POSITION_CHANGED", sourceEventId: "seed-rejected-position", idempotencyKey: "seed-rejected-position",
    deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 0 },
    payload: { assetClass: "EQUITY", instrumentKey: "MOCK|NSE|EQ|0001", product: "DELIVERY", quantityDelta: 5, costBasisDeltaPaise: 500000, realizedPnlDeltaPaise: 0 }
  }));
  const rejected = (delta, suffix) => event({
    eventId: "rejected-" + suffix, idempotencyKey: "rejected-" + suffix, sourceEventId: "rejected-" + suffix,
    type: "ORDER_REJECTED", occurredAt: "2026-11-25T09:30:0" + (suffix === "reserve" ? "1" : "2") + "+05:30",
    deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 0 },
    payload: { orderId: "rejected-" + suffix, assetClass: "EQUITY", instrumentKey: "MOCK|NSE|EQ|0001", product: "DELIVERY", side: "SELL", orderType: "LIMIT", quantity: 2, status: "REJECTED", reservedQuantityDelta: delta }
  });
  assert.throws(() => ledger.append(rejected(2, "reserve")), /UNAUTHORIZED_REJECTION_SHARE_RESERVATION/);
  assert.equal(ledger.snapshot().positions[0].reservedQuantity, 0);
  assert.equal(ledger.append(rejected(0, "zero")).accepted, true);
  assert.equal(ledger.snapshot().positions[0].reservedQuantity, 0);
});


test("timestamps reject impossible dates, invalid clock fields and out-of-range timezone fields", () => {
  const invalid = [
    "2026-02-30T09:30:00+05:30", "2025-02-29T09:30:00+05:30",
    "2026-13-01T09:30:00+05:30", "2026-00-10T09:30:00+05:30",
    "2026-11-25T24:00:00+05:30", "2026-11-25T09:60:00+05:30",
    "2026-11-25T09:30:60+05:30", "2026-11-25T09:30:00+24:00",
    "2026-11-25T09:30:00+05:60", "2026-11-25T09:30:00"
  ];
  for (const occurredAt of invalid) {
    const ledger = createPaperDemoEventLedger(opening);
    assert.throws(() => ledger.append(event({ occurredAt })), /INVALID_EVENT_TIMESTAMP/, occurredAt);
    assert.equal(ledger.snapshot().events.length, 0, occurredAt);
  }
  const leapDay = createPaperDemoEventLedger(opening);
  assert.equal(leapDay.append(event({ occurredAt: "2024-02-29T09:30:00Z" })).accepted, true);
});

test("recorded fills remain immutable in snapshots and duplicate fill IDs are rejected", () => {
  const ledger = createPaperDemoEventLedger(opening);
  ledger.append(event());
  const fill = {
    eventId: "evt-fill-1", idempotencyKey: "idem-fill-1", sourceEventId: "source-fill-1",
    accountId: opening.accountId, sessionId: opening.sessionId,
    occurredAt: "2026-11-25T09:30:01+05:30", engine: "EQUITY", type: "FILL_RECORDED",
    deltas: { cashDeltaPaise: -125050, blockedDeltaPaise: -10000 },
    payload: { fillId: "immutable-fill-1", orderId: "order-1", assetClass: "EQUITY",
      instrumentKey: "MOCK|NSE|EQ|0001", side: "BUY", quantity: 1, pricePaise: 125050, grossPaise: 125050 }
  };
  ledger.append(fill);
  const snapshot = ledger.snapshot();
  assert.ok(Object.isFrozen(snapshot.fills[0]));
  assert.ok(Object.isFrozen(snapshot.events[1]));
  assert.throws(() => { snapshot.fills[0].quantity = 99; }, TypeError);
  assert.equal(ledger.snapshot().fills[0].quantity, 1);
  assert.throws(() => ledger.append({
    ...fill,
    eventId: "evt-fill-2", idempotencyKey: "idem-fill-2", sourceEventId: "source-fill-2",
    occurredAt: "2026-11-25T09:30:02+05:30",
    deltas: { cashDeltaPaise: -125050, blockedDeltaPaise: 0 }
  }), /DUPLICATE_FILL_ID/);
  assert.equal(ledger.snapshot().fills.length, 1);
  assert.equal(ledger.snapshot().events.length, 2);
});

test("fill IDs are unique across Equity, Futures and Options in the shared account ledger", () => {
  const ledger = createPaperDemoEventLedger(opening);
  const appendOrder = (engine, assetClass, instrumentKey, orderId, occurredAt) => ledger.append(event({
    eventId: "evt-" + orderId, idempotencyKey: "idem-" + orderId, sourceEventId: "source-" + orderId,
    engine, type: "ORDER_ACCEPTED", occurredAt,
    deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 0 },
    payload: { orderId, assetClass, instrumentKey, side: "BUY", orderType: "MARKET", quantity: 1, status: "PENDING" }
  }));
  const appendFill = (engine, assetClass, instrumentKey, orderId, eventId, fillId, occurredAt) => ledger.append(event({
    eventId, idempotencyKey: "idem-" + eventId, sourceEventId: "source-" + eventId,
    engine, type: "FILL_RECORDED", occurredAt,
    deltas: { cashDeltaPaise: engine === "EQUITY" ? -10000 : 0, blockedDeltaPaise: 0 },
    payload: { fillId, orderId, assetClass, instrumentKey, side: "BUY", quantity: 1, pricePaise: 10000, grossPaise: 10000 }
  }));
  const equityKey = "MOCK|NSE|EQ|0001";
  const futureKey = "MOCK|NSE|FUT|NIFTY-2026-11";
  const optionKey = "MOCK|NSE|OPT|NIFTY-2026-11-26000-CE";
  appendOrder("EQUITY", "EQUITY", equityKey, "equity-order", "2026-11-25T09:30:00+05:30");
  appendFill("EQUITY", "EQUITY", equityKey, "equity-order", "equity-fill-event", "shared-fill-id", "2026-11-25T09:30:01+05:30");
  appendOrder("FUTURES", "FUTURE", futureKey, "future-order", "2026-11-25T09:30:02+05:30");
  appendFill("FUTURES", "FUTURE", futureKey, "future-order", "future-fill-event", "future-fill-id", "2026-11-25T09:30:03+05:30");
  appendOrder("OPTIONS", "OPTION", optionKey, "option-order", "2026-11-25T09:30:04+05:30");
  assert.throws(() => appendFill("OPTIONS", "OPTION", optionKey, "option-order",
    "option-fill-event", "shared-fill-id", "2026-11-25T09:30:05+05:30"), /DUPLICATE_FILL_ID/);
  const snapshot = ledger.snapshot();
  assert.equal(snapshot.fills.length, 2);
  assert.deepEqual(snapshot.fills.map(fill => fill.engine), ["EQUITY", "FUTURES"]);
  assert.equal(snapshot.events.length, 5);
  assert.equal(snapshot.orders.length, 3);
  assert.equal(snapshot.account.cashBalancePaise, opening.cashBalancePaise - 10000);
  assert.equal(snapshot.account.ledgerReconciled, false);
});
