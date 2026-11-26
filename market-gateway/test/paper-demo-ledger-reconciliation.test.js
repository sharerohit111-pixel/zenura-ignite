"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { reconcileDemoEventStream } = require("../lib/paper-demo-ledger-reconciliation");

const opening = { accountId: "demo-account-a", sessionId: "demo-session-a", cashBalancePaise: 100000000, blockedFundsPaise: 0 };
const make = (overrides = {}) => ({
  schemaVersion: "1.2.0", eventId: "event-1", idempotencyKey: "idem-1", sourceEventId: "source-1",
  sequence: 1, accountId: opening.accountId, sessionId: opening.sessionId,
  occurredAt: "2026-11-26T09:30:00+05:30", engine: "EQUITY", type: "ORDER_ACCEPTED",
  deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 0 },
  payload: { orderId: "order-1", assetClass: "EQUITY", instrumentKey: "MOCK|NSE|EQ|ABC", side: "BUY", orderType: "LIMIT", quantity: 2, status: "PENDING" },
  ...overrides
});
function stream() {
  return [
    make({ deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 50000 } }),
    make({ sequence: 2, eventId: "event-2", idempotencyKey: "idem-2", sourceEventId: "source-2", occurredAt: "2026-11-26T09:31:00+05:30", type: "FILL_RECORDED",
      deltas: { cashDeltaPaise: -10000, blockedDeltaPaise: -50000 },
      payload: { fillId: "fill-1", orderId: "order-1", assetClass: "EQUITY", instrumentKey: "MOCK|NSE|EQ|ABC", side: "BUY", quantity: 1, pricePaise: 10000, grossPaise: 10000 } }),
    make({ sequence: 3, eventId: "event-3", idempotencyKey: "idem-3", sourceEventId: "source-3", occurredAt: "2026-11-26T09:32:00+05:30", type: "ORDER_UPDATED",
      deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 0 },
      payload: { orderId: "order-1", assetClass: "EQUITY", instrumentKey: "MOCK|NSE|EQ|ABC", side: "BUY", orderType: "LIMIT", quantity: 2, status: "PARTIALLY_FILLED", filledQuantity: 1, remainingQuantity: 1 } }),
    make({ sequence: 4, eventId: "event-4", idempotencyKey: "idem-4", sourceEventId: "source-4", occurredAt: "2026-11-26T09:33:00+05:30", type: "POSITION_CHANGED",
      deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 0 },
      payload: { assetClass: "EQUITY", instrumentKey: "MOCK|NSE|EQ|ABC", product: "DELIVERY", quantityDelta: 1, costBasisDeltaPaise: 10000, realizedPnlDeltaPaise: 0 } })
  ];
}
test("independently recomputes deterministic cash, blocked funds, fills and cost basis", () => {
  const events = stream();
  const a = reconcileDemoEventStream({ opening, events });
  const b = reconcileDemoEventStream({ opening, events: structuredClone(events) });
  assert.deepEqual(a, b);
  assert.equal(a.cashBalancePaise, 99990000);
  assert.equal(a.blockedFundsPaise, 0);
  assert.equal(a.availableCashPaise, 99990000);
  assert.equal(a.fillCount, 1);
  assert.equal(a.positionTotals[0].quantity, 1);
  assert.equal(a.positionTotals[0].costBasisPaise, 10000);
  assert.match(a.inputSha256, /^[a-f0-9]{64}$/);
  assert.equal(a.ledgerReconciled, false);
});
test("rejects duplicate event, idempotency and source identifiers", () => {
  const events = stream();
  events[1].idempotencyKey = events[0].idempotencyKey;
  assert.throws(() => reconcileDemoEventStream({ opening, events }), /DUPLICATE_EVENT_IDEMPOTENCY_OR_SOURCE/);
});
test("rejects sequence gaps and non-monotonic timestamps", () => {
  const events = stream();
  events[2].sequence = 9;
  assert.throws(() => reconcileDemoEventStream({ opening, events }), /INVALID_EVENT_ENVELOPE/);
  const reordered = stream();
  reordered[2].occurredAt = reordered[1].occurredAt;
  assert.throws(() => reconcileDemoEventStream({ opening, events: reordered }), /EVENT_TIME_ORDER_INVALID/);
});
test("rejects Equity gross/cash mismatches and overfilled orders", () => {
  const events = stream();
  events[1].deltas.cashDeltaPaise = -9999;
  assert.throws(() => reconcileDemoEventStream({ opening, events }), /EQUITY_FILL_CASH_GROSS_MISMATCH/);
  const overfill = stream();
  overfill[1].deltas.cashDeltaPaise = -30000;
  overfill[1].payload.quantity = 3;
  overfill[1].payload.grossPaise = 30000;
  overfill[1].payload.pricePaise = 10000;
  assert.throws(() => reconcileDemoEventStream({ opening, events: overfill }), /FILL_QUANTITY_EXCEEDS_ORDER/);
});
test("rejects derivative wallet movements without receipt-backed event contract", () => {
  const events = [make({ engine: "FUTURES", type: "ORDER_ACCEPTED", deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 1 },
    payload: { orderId: "future-1", assetClass: "FUTURE", instrumentKey: "MOCK|NSE|FUT|NIFTY", side: "BUY", orderType: "LIMIT", quantity: 1, status: "PENDING" } })];
  assert.throws(() => reconcileDemoEventStream({ opening, events }), /DERIVATIVE_CASH_REQUIRES_AUTHORITATIVE_RECEIPT/);
});

test("rejects both Futures and Options wallet cash or blocked-fund movements without a trusted receipt", () => {
  for (const [engine, assetClass, instrumentKey] of [
    ["FUTURES", "FUTURE", "MOCK|NSE|FUT|NIFTY"],
    ["OPTIONS", "OPTION", "MOCK|NSE|OPT|NIFTY"]
  ]) {
    const events = [make({
      engine,
      type: "ORDER_ACCEPTED",
      deltas: { cashDeltaPaise: -100, blockedDeltaPaise: 100 },
      payload: { orderId: engine.toLowerCase()+"-1", assetClass, instrumentKey, side: "BUY", orderType: "LIMIT", quantity: 1, status: "PENDING" }
    })];
    assert.throws(() => reconcileDemoEventStream({ opening, events }), /DERIVATIVE_CASH_REQUIRES_AUTHORITATIVE_RECEIPT/);
  }
});
test("never attests reconciliation even for a structurally consistent event stream", () => {
  const report = reconcileDemoEventStream({ opening, events: stream(), provenance: { verified: true } });
  assert.equal(report.ledgerReconciled, false);
  assert.equal(report.reconciliationStatus, "blocked_demo_only");
  assert.ok(report.blockers.some(x => x.includes("fee/charge")));
  assert.ok(report.blockers.some(x => x.includes("Opening-balance")));
});
test("rejects an opening snapshot with blocked funds beyond cash", () => {
  assert.throws(() => reconcileDemoEventStream({ opening: { ...opening, blockedFundsPaise: opening.cashBalancePaise + 1 }, events: [] }), /INVALID_OPENING_SNAPSHOT/);
});

test("rejects a rejected order carrying a non-rejected state or any fill quantity", () => {
  const invalid = [make({ type: "ORDER_REJECTED", payload: { orderId: "reject-1", assetClass: "EQUITY", instrumentKey: "MOCK|NSE|EQ|ABC", side: "BUY", orderType: "MARKET", quantity: 1, status: "PENDING" } })];
  assert.throws(() => reconcileDemoEventStream({ opening, events: invalid }), /INVALID_REJECTION_STATUS/);
});
test("rejects terminal FILLED order states without full fill quantity", () => {
  const events = [
    make(),
    make({ sequence: 2, eventId: "event-2", idempotencyKey: "idem-2", sourceEventId: "source-2",
      occurredAt: "2026-11-26T09:31:00+05:30", type: "ORDER_UPDATED",
      payload: { orderId: "order-1", assetClass: "EQUITY", instrumentKey: "MOCK|NSE|EQ|ABC", side: "BUY", orderType: "LIMIT", quantity: 2, status: "FILLED" } })
  ];
  assert.throws(() => reconcileDemoEventStream({ opening, events }), /ORDER_STATUS_FILL_QUANTITY_MISMATCH|FINAL_FILLED_ORDER_QUANTITY_MISMATCH/);
});

test("rejects timestamps outside the canonical ISO-8601 event format", () => {
  const events = [make({ occurredAt: "November 26, 2026 09:30" })];
  assert.throws(() => reconcileDemoEventStream({ opening, events }), /INVALID_EVENT_TIMESTAMP/);
});

test("rejects invalid Demo product and non-MOCK position metadata", () => {
  const invalidOrder = [make({ payload: { ...make().payload, product: "MARGIN" } })];
  assert.throws(() => reconcileDemoEventStream({ opening, events: invalidOrder }), /INVALID_ORDER_FACT/);
  const invalidPosition = [make({ type: "POSITION_CHANGED", payload: {
    assetClass: "EQUITY", instrumentKey: "NSE|EQ|ABC", product: "DELIVERY",
    quantityDelta: 1, costBasisDeltaPaise: 10000, realizedPnlDeltaPaise: 0
  } })];
  assert.throws(() => reconcileDemoEventStream({ opening, events: invalidPosition }), /INVALID_POSITION_FACT/);
});

test("rejects position events that attempt to mutate share reservations", () => {
  const events = [make({ type: "POSITION_CHANGED", payload: {
    assetClass: "EQUITY", instrumentKey: "MOCK|NSE|EQ|ABC", product: "DELIVERY",
    quantityDelta: 1, costBasisDeltaPaise: 10000, realizedPnlDeltaPaise: 0,
    reservedQuantityDelta: 1
  } })];
  assert.throws(() => reconcileDemoEventStream({ opening, events }), /INVALID_POSITION_FACT/);
});
