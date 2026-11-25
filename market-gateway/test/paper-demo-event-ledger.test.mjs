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
    deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 0 }
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
    payload: { fillId: "sell-fill-1", orderId: "sell-1", assetClass: "EQUITY", instrumentKey: "MOCK|NSE|EQ|0001", product: "DELIVERY", side: "SELL", quantity: 3, pricePaise: 100000 }
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


test("canonical events carry the supported schema version and reject unknown versions", () => {
  const ledger = createPaperDemoEventLedger(opening);
  const accepted = ledger.append(event());
  assert.equal(accepted.event.schemaVersion, "1.2.0");
  assert.throws(() => ledger.append(event({
    eventId: "evt-2", idempotencyKey: "idem-2", sourceEventId: "future-schema",
    occurredAt: "2026-11-25T09:30:01+05:30", schemaVersion: "2.0.0"
  })), /UNSUPPORTED_EVENT_SCHEMA_VERSION/);
  assert.equal(ledger.snapshot().events.length, 1);
});

test("event timestamps require an explicit ISO-8601 timezone", () => {
  const ledger = createPaperDemoEventLedger(opening);
  assert.throws(() => ledger.append(event({ occurredAt: "2026-11-25T09:30:00" })), /INVALID_EVENT_TIMESTAMP/);
  assert.throws(() => ledger.append(event({ occurredAt: "2026-11-25" })), /INVALID_EVENT_TIMESTAMP/);
  assert.equal(ledger.snapshot().events.length, 0);
});

test("replay rejects reordered events instead of silently sorting them", () => {
  const ledger = createPaperDemoEventLedger(opening);
  ledger.append(event());
  ledger.append(event({
    eventId: "evt-2", idempotencyKey: "idem-2", sourceEventId: "equity-fill-1",
    type: "FILL_RECORDED", occurredAt: "2026-11-25T09:30:01+05:30",
    deltas: { cashDeltaPaise: -125050, blockedDeltaPaise: -10000 },
    payload: { fillId: "fill-1", orderId: "order-1", assetClass: "EQUITY", instrumentKey: "MOCK|NSE|EQ|0001", side: "BUY", quantity: 1, pricePaise: 125050 }
  }));
  const reversed = ledger.snapshot().events.slice().reverse();
  assert.throws(() => replayPaperDemoEvents(opening, reversed), /DEMO_EVENT_SEQUENCE_MISMATCH/);
});

test("fill events derive partial and terminal order status; cancellation preserves executed fills", () => {
  const ledger = createPaperDemoEventLedger(opening);
  ledger.append(event({ payload: { ...event().payload, quantity: 3 } }));
  const fill = (id, quantity, second) => ledger.append(event({
    eventId: "evt-fill-" + id, idempotencyKey: "idem-fill-" + id, sourceEventId: "source-fill-" + id,
    type: "FILL_RECORDED", occurredAt: "2026-11-25T09:30:0" + second + "+05:30",
    deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 0 },
    payload: { fillId: "fill-" + id, orderId: "order-1", assetClass: "EQUITY",
      instrumentKey: "MOCK|NSE|EQ|0001", side: "BUY", quantity, pricePaise: 125050 }
  }));
  fill("1", 1, 1);
  assert.deepEqual(
    (({ status, filledQuantity, remainingQuantity, averageFillPricePaise }) =>
      ({ status, filledQuantity, remainingQuantity, averageFillPricePaise }))(ledger.snapshot().orders[0]),
    { status: "PARTIALLY_FILLED", filledQuantity: 1, remainingQuantity: 2, averageFillPricePaise: 125050 }
  );
  fill("2", 1, 2);
  ledger.append(event({
    eventId: "evt-cancel", idempotencyKey: "idem-cancel", sourceEventId: "source-cancel",
    type: "ORDER_UPDATED", occurredAt: "2026-11-25T09:30:03+05:30",
    deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 0 },
    payload: { ...event().payload, quantity: 3, status: "CANCELLED" }
  }));
  const cancelled = ledger.snapshot().orders[0];
  assert.equal(cancelled.status, "CANCELLED");
  assert.equal(cancelled.filledQuantity, 2);
  assert.equal(cancelled.remainingQuantity, 1);
  assert.equal(ledger.snapshot().fills.length, 2);
  assert.throws(() => ledger.append(event({
    eventId: "evt-reopen", idempotencyKey: "idem-reopen", sourceEventId: "source-reopen",
    type: "ORDER_UPDATED", occurredAt: "2026-11-25T09:30:04+05:30",
    deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 0 },
    payload: { ...event().payload, quantity: 3, status: "PARTIALLY_FILLED" }
  })), /INVALID_ORDER_STATUS_TRANSITION/);
  assert.equal(ledger.snapshot().events.length, 4);
});

test("full fill is terminal and cannot be reopened; fill receipts remain immutable", () => {
  const ledger = createPaperDemoEventLedger(opening);
  ledger.append(event());
  ledger.append(event({
    eventId: "evt-full-fill", idempotencyKey: "idem-full-fill", sourceEventId: "source-full-fill",
    type: "FILL_RECORDED", occurredAt: "2026-11-25T09:30:01+05:30",
    deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 0 },
    payload: { fillId: "fill-full", orderId: "order-1", assetClass: "EQUITY",
      instrumentKey: "MOCK|NSE|EQ|0001", side: "BUY", quantity: 2, pricePaise: 125050 }
  }));
  const receipt = ledger.snapshot().fills[0];
  assert.equal(ledger.snapshot().orders[0].status, "FILLED");
  assert.equal(receipt.grossPaise, 250100);
  assert.ok(Object.isFrozen(receipt));
  assert.throws(() => ledger.append(event({
    eventId: "evt-reopen", idempotencyKey: "idem-reopen", sourceEventId: "source-reopen",
    type: "ORDER_UPDATED", occurredAt: "2026-11-25T09:30:02+05:30",
    deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 0 },
    payload: { ...event().payload, status: "PENDING" }
  })), /INVALID_ORDER_STATUS_TRANSITION/);
  assert.throws(() => ledger.append(event({
    eventId: "evt-late-fill", idempotencyKey: "idem-late-fill", sourceEventId: "source-late-fill",
    type: "FILL_RECORDED", occurredAt: "2026-11-25T09:30:03+05:30",
    deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 0 },
    payload: { fillId: "fill-late", orderId: "order-1", assetClass: "EQUITY",
      instrumentKey: "MOCK|NSE|EQ|0001", side: "BUY", quantity: 1, pricePaise: 125050 }
  })), /FILL_ORDER_MISMATCH/);
  assert.equal(ledger.snapshot().fills.length, 1);
});

test("Equity, Futures and Options derive identical lifecycle invariants from canonical fills", () => {
  const cases = [
    { engine: "EQUITY", assetClass: "EQUITY", instrumentKey: "MOCK|NSE|EQ|0001" },
    { engine: "FUTURES", assetClass: "FUTURE", instrumentKey: "MOCK|NSE|FUT|NIFTY-2026-11" },
    { engine: "OPTIONS", assetClass: "OPTION", instrumentKey: "MOCK|NSE|OPT|NIFTY-26000-CE" }
  ];
  for (const [index, item] of cases.entries()) {
    const ledger = createPaperDemoEventLedger(opening);
    ledger.append(event({
      engine: item.engine,
      payload: { ...event().payload, orderId: "order-" + item.assetClass, assetClass: item.assetClass,
        instrumentKey: item.instrumentKey, quantity: 2 }
    }));
    ledger.append(event({
      eventId: "evt-" + item.assetClass + "-fill", idempotencyKey: "idem-" + item.assetClass + "-fill",
      sourceEventId: "source-" + item.assetClass + "-fill", engine: item.engine, type: "FILL_RECORDED",
      occurredAt: "2026-11-25T09:30:0" + (index + 1) + "+05:30",
      deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 0 },
      payload: { fillId: "fill-" + item.assetClass, orderId: "order-" + item.assetClass,
        assetClass: item.assetClass, instrumentKey: item.instrumentKey, side: "BUY",
        quantity: 2, pricePaise: 10000 }
    }));
    const snapshot = ledger.snapshot();
    assert.equal(snapshot.orders[0].status, "FILLED");
    assert.equal(snapshot.orders[0].filledQuantity, 2);
    assert.equal(snapshot.orders[0].remainingQuantity, 0);
    assert.equal(snapshot.fills.length, 1);
    assert.equal(snapshot.fills[0].grossPaise, 20000);
    assert.equal(replayPaperDemoEvents(opening, snapshot.events).orders[0].status, "FILLED");
  }
});

test("order update cannot claim fill quantities that disagree with immutable fill receipts", () => {
  const ledger = createPaperDemoEventLedger(opening);
  ledger.append(event());
  ledger.append(event({
    eventId: "evt-fill", idempotencyKey: "idem-fill", sourceEventId: "source-fill",
    type: "FILL_RECORDED", occurredAt: "2026-11-25T09:30:01+05:30",
    deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 0 },
    payload: { fillId: "fill-1", orderId: "order-1", assetClass: "EQUITY",
      instrumentKey: "MOCK|NSE|EQ|0001", side: "BUY", quantity: 1, pricePaise: 125050 }
  }));
  assert.throws(() => ledger.append(event({
    eventId: "evt-bad-update", idempotencyKey: "idem-bad-update", sourceEventId: "source-bad-update",
    type: "ORDER_UPDATED", occurredAt: "2026-11-25T09:30:02+05:30",
    deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 0 },
    payload: { ...event().payload, status: "PARTIALLY_FILLED", filledQuantity: 0, remainingQuantity: 2 }
  })), /DEMO_ORDER_FILL_QUANTITY_MISMATCH/);
  assert.equal(ledger.snapshot().events.length, 2);
  assert.equal(ledger.snapshot().orders[0].status, "PARTIALLY_FILLED");
});

test("a rejected initial order is terminal and duplicate rejection identity is rejected", () => {
  const ledger = createPaperDemoEventLedger(opening);
  ledger.append(event({
    type: "ORDER_REJECTED", sourceEventId: "source-rejected", idempotencyKey: "idem-rejected",
    payload: { ...event().payload, orderId: "rejected-1", status: "REJECTED" },
    deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 0 }
  }));
  assert.equal(ledger.snapshot().orders[0].status, "REJECTED");
  assert.equal(ledger.snapshot().orders[0].filledQuantity, 0);
  assert.throws(() => ledger.append(event({
    eventId: "evt-rejected-duplicate", idempotencyKey: "idem-rejected-2", sourceEventId: "source-rejected-2",
    type: "ORDER_REJECTED", occurredAt: "2026-11-25T09:30:01+05:30",
    payload: { ...event().payload, orderId: "rejected-1", status: "REJECTED" },
    deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 0 }
  })), /DUPLICATE_ORDER_ID/);
});


test("partial SELL fill cancellation releases only the unfilled share reservation and replays exactly", () => {
  const ledger = createPaperDemoEventLedger(opening);
  ledger.append(event({
    type: "POSITION_CHANGED", sourceEventId: "seed-sell-position", idempotencyKey: "seed-sell-position",
    deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 0 },
    payload: { assetClass: "EQUITY", instrumentKey: "MOCK|NSE|EQ|0001", product: "DELIVERY",
      quantityDelta: 5, costBasisDeltaPaise: 500000, realizedPnlDeltaPaise: 0 }
  }));
  ledger.append(event({
    eventId: "evt-sell-accepted", idempotencyKey: "idem-sell-accepted", sourceEventId: "source-sell-accepted",
    occurredAt: "2026-11-25T09:30:01+05:30",
    deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 0 },
    payload: { ...event().payload, side: "SELL", quantity: 3, status: "PENDING" }
  }));
  assert.equal(ledger.snapshot().positions[0].reservedQuantity, 3);
  ledger.append(event({
    eventId: "evt-sell-fill", idempotencyKey: "idem-sell-fill", sourceEventId: "source-sell-fill",
    type: "FILL_RECORDED", occurredAt: "2026-11-25T09:30:02+05:30",
    deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 0 },
    payload: { fillId: "fill-sell-1", orderId: "order-1", assetClass: "EQUITY",
      instrumentKey: "MOCK|NSE|EQ|0001", side: "SELL", quantity: 1, pricePaise: 100000 }
  }));
  assert.equal(ledger.snapshot().positions[0].reservedQuantity, 2);
  ledger.append(event({
    eventId: "evt-sell-cancel", idempotencyKey: "idem-sell-cancel", sourceEventId: "source-sell-cancel",
    type: "ORDER_UPDATED", occurredAt: "2026-11-25T09:30:03+05:30",
    deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 0 },
    payload: { ...event().payload, side: "SELL", quantity: 3, status: "CANCELLED" }
  }));
  const snapshot = ledger.snapshot();
  assert.equal(snapshot.orders[0].status, "CANCELLED");
  assert.equal(snapshot.orders[0].filledQuantity, 1);
  assert.equal(snapshot.orders[0].remainingQuantity, 2);
  assert.equal(snapshot.positions[0].reservedQuantity, 0);
  assert.equal(snapshot.fills.length, 1);
  assert.deepEqual(replayPaperDemoEvents(opening, snapshot.events), snapshot);
});


test("event timestamps reject impossible calendar and clock values", () => {
  const ledger = createPaperDemoEventLedger(opening);
  assert.throws(() => ledger.append(event({ occurredAt: "2026-02-30T09:30:00+05:30" })), /INVALID_EVENT_TIMESTAMP/);
  assert.throws(() => ledger.append(event({ occurredAt: "2026-11-25T24:00:00+05:30" })), /INVALID_EVENT_TIMESTAMP/);
  assert.equal(ledger.snapshot().events.length, 0);
});


test("Options SELL cancellation and expiry release only unfilled contract reservations", () => {
  for (const [index, terminalStatus] of ["CANCELLED", "EXPIRED"].entries()) {
    const ledger = createPaperDemoEventLedger(opening);
    const instrumentKey = "MOCK|NSE|OPT|NIFTY-26000-CE";
    ledger.append(event({
      engine: "OPTIONS", type: "POSITION_CHANGED",
      eventId: "evt-option-position-" + index, idempotencyKey: "idem-option-position-" + index,
      sourceEventId: "source-option-position-" + index,
      deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 0 },
      payload: { assetClass: "OPTION", instrumentKey, quantityDelta: 5, costBasisDeltaPaise: 50000, realizedPnlDeltaPaise: 0 }
    }));
    ledger.append(event({
      engine: "OPTIONS", eventId: "evt-option-accepted-" + index,
      idempotencyKey: "idem-option-accepted-" + index, sourceEventId: "source-option-accepted-" + index,
      occurredAt: "2026-11-25T09:30:01+05:30",
      deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 0 },
      payload: { ...event().payload, orderId: "option-order-" + index, assetClass: "OPTION",
        instrumentKey, side: "SELL", quantity: 3, status: "PENDING" }
    }));
    assert.equal(ledger.snapshot().positions[0].reservedQuantity, 3);
    ledger.append(event({
      engine: "OPTIONS", type: "FILL_RECORDED",
      eventId: "evt-option-fill-" + index, idempotencyKey: "idem-option-fill-" + index,
      sourceEventId: "source-option-fill-" + index, occurredAt: "2026-11-25T09:30:02+05:30",
      deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 0 },
      payload: { fillId: "option-fill-" + index, orderId: "option-order-" + index,
        assetClass: "OPTION", instrumentKey, side: "SELL", quantity: 1, pricePaise: 10000 }
    }));
    assert.equal(ledger.snapshot().positions[0].reservedQuantity, 2);
    ledger.append(event({
      engine: "OPTIONS", type: "ORDER_UPDATED",
      eventId: "evt-option-terminal-" + index, idempotencyKey: "idem-option-terminal-" + index,
      sourceEventId: "source-option-terminal-" + index, occurredAt: "2026-11-25T09:30:03+05:30",
      deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 0 },
      payload: { ...event().payload, orderId: "option-order-" + index, assetClass: "OPTION",
        instrumentKey, side: "SELL", quantity: 3, status: terminalStatus }
    }));
    const snapshot = ledger.snapshot();
    assert.equal(snapshot.orders[0].status, terminalStatus);
    assert.equal(snapshot.orders[0].filledQuantity, 1);
    assert.equal(snapshot.orders[0].remainingQuantity, 2);
    assert.equal(snapshot.positions[0].reservedQuantity, 0);
    assert.equal(snapshot.fills.length, 1);
    assert.deepEqual(replayPaperDemoEvents(opening, snapshot.events), snapshot);
  }
});
